# AdmissionHub AI System Blueprint

Status: draft for owner review. Grounded in the modules that already ship in this
repo; it names the target shape so new work has one reference instead of five.

## 1. Goal

One assistant that answers a student, runs an owner action, and sends a
notification through a single audited path — with the model swappable and the
failure modes bounded.

## 2. Layers

| Layer | Module today | Responsibility |
| --- | --- | --- |
| Edge | `gk-agent-worker.js` | route, auth, CORS, dispatch |
| Identity | `auth-native/` + `AUTH_AUTHORITY` DO | sessions, device trust, passkeys |
| Context | `context-engine.js` | typed, permission-scoped context bundle |
| Prompts | `phase9-m5` registry | versioned system prompts |
| Tools | `phase9-m6` registry | declared, permissioned tools |
| Memory | `phase9-m7` engine | short + long-term recall |
| Actions | `action-engine.js` (`ENABLED = true`) | proposal → confirm → execute |
| Providers | `ai-provider-adapters.js` | LLM failover + cost caps |
| Validation | `phase9-m8` | schema + safety gate on output |
| Delivery | `fcm-notification.mjs` | push, history, analytics |

## 3. Request flow

1. Edge authenticates (session or passkey) and resolves the caller's uid.
2. Context engine builds a scoped bundle from allowed stores only.
3. Prompt registry selects a version; provider adapters pick a live model.
4. Tool registry exposes only tools the caller's permission grants.
5. An action never runs inline: the model proposes, the user confirms, the
   action engine executes and audits one single-use token.
6. Response validation checks schema and policy before anything is returned.
7. Notification delivery is a first-class tool, so "tell the students" is the
   same audited path as any other write.

## 4. Trust boundaries

- Students: read own data, run read-only tools. No action execution.
- Admins: `ADMIN_TOKEN` bearer (currently) → target is passkey + short-lived
  session, so no long-lived token is stored in a browser.
- The model is never trusted to authorize itself: `authorizeAction` decides,
  not the prompt.

## 5. Failure policy

- Provider down → adapter failover, then a typed error, never a silent empty.
- Storage down → the route answers 503 rather than pretending success.
- Ambiguous action → refuse and re-propose; no partial writes.
- Every path emits an audit record with uid, tool, args hash, outcome.

## 6. Near-term work

1. Passkey-gated admin sessions replacing the pasted `ADMIN_TOKEN` flow.
2. One config surface for caps (now split across `wrangler.toml` and secrets).
3. A single context/permission matrix doc so engine and registry cannot drift.
4. Keep the Worker under the 64-variable Free ceiling: bind switches as secrets,
   never as `[vars]` entries.
