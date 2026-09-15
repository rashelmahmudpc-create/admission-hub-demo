# 🛡️ Phase 6 — Security, Device Trust & Risk Engine · EXECUTION PLAN

**Status:** DRAFT — awaiting owner approval (Phase 6 blueprint §40:
PREPARE SECURITY PLAN → STOP FOR APPROVAL → IMPLEMENT)
**Date:** 2026-09-15 (Asia/Dhaka)
**Prerequisite phases (untouched, regression-protected):** Phase 3 identity
core · Phase 4 login/signup/verification · Phase 5 session engine.

---

## 1. Audit — what already exists (reuse, never replace)

| Existing asset | Where | Role in Phase 6 |
|---|---|---|
| Layered rate limits (email / IP / device / global scopes) | `auth-engine.mjs` limit definitions + `auth_rate_limits` (SQLite) | Brute-force core (§13) — thresholds move into the central config, behavior unchanged |
| Security event ledger (19 event types) | `auth_security_events` | Event ledger base (§15) — extended with `device_ref`, `purpose`, `policy_version` |
| Verification tickets (single-use, device-bound, expiring, superseded) | `auth_account_verification_tickets` | First challenge methods (email link, Telegram OTP) |
| Opaque server-issued device cookie (`__Host-` style, HttpOnly, 1 y) + `isNewDevice` | `public-auth-handler.mjs` `clientContext` | Device identity (§5) — no fingerprinting, no client JS device ID |
| Account state machine (ACTIVE/RESTRICTED/SUSPENDED, transition-validated) | Phase 3 `account-lifecycle.mjs` + `setAccountState` | §25 integration — risk policies may propose RESTRICTED; suspension stays admin/authority-driven |
| Session engine (refresh, revocation, logout-all, telemetry) | Phase 5 | §23 integration — risk decision → continue / challenge / revoke |
| Passkey (WebAuthn, `last_used_at`, `sign_count`, per-operation limits) | existing | Step-up method + duplicate-registration protection already present |
| Admin token pattern (`X-AH-Admin-Token`) | existing admin routes | Security admin foundation (§37) |
| Email gateway (Phase 1/2) | email infra | Notification boundary (§17) |
| Single auth Durable Object (`AdmissionAuthAuthority`) | `auth-authority-do.mjs` | Security engine home (see decision D1) |

## 2. Gap map — what Phase 6 adds

1. **Central Security Engine** (`evaluateRisk`, `getSecurityState`,
   `isDeviceTrusted`, `requestChallenge`, `verifyChallenge`,
   `registerTrustedDevice`, `revokeTrustedDevice`, `getSecurityEvents`)
2. **Risk evaluation** — LOW/NORMAL/ELEVATED/HIGH/CRITICAL from signals
   (new device, failed attempts, rapid requests, recovery events, account
   state, session behavior). Conservative: **no single signal accuses**
   (§4); no automatic SUSPEND from risk (§25 conservative policy)
3. **Device trust** — trusted-device registry (30-day default trust),
   trust-after-verification, revoke current/individual/all
4. **Challenge engine** — generic, method-agnostic, purpose-bound,
   user-bound, single-use, attempt-capped, short-lived; states
   CREATED→SENT→VERIFIED/FAILED/EXPIRED/CANCELLED. v1 methods: email OTP
   (existing verification link), Telegram OTP, passkey. **No TOTP in v1**
   — the method registry is designed so TOTP slots in later without
   architecture change (§9)
5. **Step-up authentication** — sensitive actions (change password,
   logout-all, future email change / passkey removal) require a
   purpose-matched challenge
6. **Security configuration layer** — all thresholds (attempts, cooldowns,
   challenge lifetime, risk thresholds, trust TTL, session policy) in one
   frozen config object; per-environment overridable; policy version
   stamped on events
7. **Fail-safe policy** (§30-31) — risk evaluation error → low-risk
   actions proceed with normal auth; sensitive actions require stronger
   verification or are temporarily blocked; never blind-allow sensitive,
   never lock everyone out
8. **Security history + notification boundary** — user-facing recent
   logins (method, browser class, time — **no location**), structured
   security notification events for the email gateway (adapter + tests,
   no live spam in Phase 6)
9. **Security admin foundation** — token-protected health + event query
   (no raw PII), metrics counters (failed login rate, challenge
   success/failure, new device rate, false-positive input: repeat
   successful trusted behavior)

## 3. Architecture decisions (proposed)

- **D1 — One authority.** The security engine lives **inside the existing
  auth DO** (same SQLite). Risk evaluation on the login hot path is a
  local read — no new DO, no extra network hop (blueprint §34 rule from
  earlier phases: never double authority calls on hot paths).
- **D2 — Conservative v1 risk actions.**
  - LOW/NORMAL → proceed (current behavior, unchanged)
  - ELEVATED → challenge via existing verification methods (email link or
    Telegram OTP) before session establishment
  - HIGH → challenge + session policy tightening (shorter TTL for that
    session, no trust offered until a second successful verification)
  - CRITICAL → block action + security recovery path (password reset /
    account state); **no automatic suspension** — suspension remains an
    explicit authority decision (admin), with safe recovery
- **D3 — Trust after verified success.** A device that completes a
  successful verification (email/Telegram/passkey) can be marked trusted
  (30-day default). First-time trusted behavior reduces future friction
  (§33 false-positive control). Trust is always revocable by the user and
  expires; revocation is immediate.
- **D4 — No permanent lockout** (§14). Repeated failure → escalating
  cooldown (e.g. 5 min → 15 min → 60 min) + step-up challenge, never a
  permanent state.
- **D5 — Privacy floor** (§26). No fingerprinting, no exact location, no
  contact data, no device content. Security responses expose browser
  class + method + timestamp + approximate context only.
- **D6 — Identity core untouched** (§24). Security engine reads
  account/identity state; it never mutates permanent identity.
- **D7 — Client never authoritative.** The client renders challenges and
  trust UI; every decision comes from the DO.

## 4. Chunk plan

### Chunk 1 — Security core: config + policy + ledger extension (server)
- `auth-native/core/security-config.mjs` — frozen central config: policy
  version (`security-policy-v1`), risk thresholds, attempt caps, cooldown
  schedule, challenge TTL/max attempts, trust TTL, per-scope rate limits
  (existing values migrated verbatim), fail-safe matrix.
- `auth-native/core/security-policy.mjs` — risk level enum, signal
  catalog, deterministic `evaluateRisk(signals, config)` →
  `{ level, reasons[], actions[] }` (reasons are internal, never leaked
  raw), conservative combination rules (single signal never exceeds
  ELEVATED), fail-safe resolver.
- SQLite migration (additive): `auth_security_events` + `device_ref`,
  `purpose`, `policy_version` columns (nullable, back-compatible);
  security event name catalog frozen.
- Existing flows emit standardized events (login success/failure already
  partially covered — completed).
- Tests: ~8 (config frozen/valid, policy versioning, event extension,
  conservative combination rules, fail-safe matrix).

### Chunk 2 — Risk engine + device trust (server)
- SQLite: `auth_trusted_devices` (user_id, device_ref, browser_class,
  trusted_at, expires_at, revoked_at, policy_version).
- Engine + DO routes: `isDeviceTrusted`, `registerTrustedDevice`,
  `revokeTrustedDevice` (current / by-ref / all), `getSecurityState`,
  `evaluateRisk` wired to `/login`: after credential verification, risk
  decision before `session/create`:
  - trusted device → proceed (event `login-trusted-device`)
  - new device on verified account → ELEVATED → return
    `verification.selectionRequired` (existing client flow already
    renders it) — challenge-first-then-proceed
  - unverified account → existing verification (unchanged)
- Failed-login risk signals from `auth_rate_limits` state (no new table).
- Session integration: HIGH-risk sessions get shortened TTL + no
  trust-offer flag in the session response (client uses it).
- Tests: ~12 (risk matrix per signal, trust lifecycle incl. expiry +
  revocation, new-device challenge path, trusted-device fast path,
  fail-safe on evaluation error, multi-device isolation).

### Chunk 3 — Challenge engine + step-up (server + client)
- SQLite: `auth_security_challenges` (challenge_ref, user_id, purpose,
  method, status, attempts, max_attempts, created_at, expires_at,
  policy_version).
- Engine: `requestChallenge(purpose, method)` (reuses existing
  verification ticket material for email/Telegram methods),
  `verifyChallenge` (single-use, purpose-bound, attempt-capped,
  expiring, non-replayable).
- Step-up enforcement: `POST /session/logout-all` and password change
  require a verified challenge of purpose `step-up` (client: 2-step arm
  stays; after arm, if session is older than N or risk ≥ ELEVATED, the
  server demands the challenge).
- Client: security challenge view (code entry, countdown, cancel),
  "Trust this device for 30 days" prompt after successful
  verification, step-up wiring on logout-all/password change.
- Tests: ~14 (lifecycle, purpose binding, replay, attempts, expiry,
  concurrent verify race, step-up enforced on logout-all, client
  challenge flow JSDOM, trust prompt flow).

### Chunk 4 — Security history + notifications + admin foundation
- Public (session-bound): `GET /security/state`,
  `GET /security/history` (recent logins: method, browser class, time;
  **no location**), `POST /security/devices/revoke` (current | ref |
  all) with step-up.
- Notification boundary: `security-notifications.mjs` — structured event
  catalog (new-device-login, password-changed, passkey-added/removed,
  recovery-started/completed, suspicious-activity) + email-gateway
  adapter (unit-tested, dry-run flag for Phase 6 — no live mass send).
- Admin (token): `GET /admin/security/health` (counts + rates: failed
  login, challenge success/failure, new device, revocations),
  `GET /admin/security/events` (paged, ref-only, no PII).
- Tests: ~10 (history privacy assertions, revoke step-up, notification
  contract + dry-run, admin gating + redaction).

### Chunk 5 — Chaos + takeover + regression + deploy
- `security-chaos.test.mjs` (~14): stolen credential + new device →
  challenge; repeated failure → escalating cooldown, no permanent
  lockout; recovery abuse (expired/invalid/duplicate recovery);
  identity-linking abuse; session/security state mismatch; risk service
  unavailable → fail-safe matrix; duplicate/delayed challenge;
  concurrent verification; concurrent login on same device; DB timeout.
- Full regression: Phase 3 (`test:identity`) + Phase 4/5
  (`test:production-auth`, `test:session`) all green.
- `docs/SECURITY-CORE-PROTECTION.md` — protected contract + change
  control + AGENT SECURITY RULE (§38) codified.
- Version bump (v256 line), exact `worker-bundle.mjs` rebuild, guard
  wiring (new test files in paths + CODEOWNERS), protected publish
  (`PUBLISH_TELEGRAM_OTP`), live verify (both hosts + API contract),
  `docs/PHASE6-FINAL-REPORT.md`, resume + LATEST, STOP.

## 5. Estimation

- New tests: ~58 (8+12+14+10+14) across 3 new suites
  (`security-policy.test.mjs`, `security-device-trust.test.mjs`,
  `security-challenge-stepup.test.mjs`, `security-history-admin.test.mjs`,
  `security-chaos.test.mjs`)
- Chunks: 5 (each = code + tests + local green before next chunk)
- Deploys: 1 protected publish at the end (all chunks in one release)

## 6. Explicit non-goals (Phase 6)

- No TOTP implementation (registry-ready, method added later)
- No live mass notifications (adapter + dry-run only)
- No automatic account suspension from risk (admin/authority only)
- No email-change flow (foundation + policy hooks only — Profile phase)
- No exact location capture, ever
- No new browser fingerprinting — device identity stays the opaque
  server-issued cookie
- No client-side authoritative security logic

## 7. Open question for owner (recommendation marked)

**Q1 — New device on a verified account:** recommended v1 = challenge
once (email link or Telegram OTP — user's choice, existing UI), then
offer "Trust this device for 30 days". Alternative: silent proceed (more
friction-free, weaker ATO protection). **Recommendation: challenge once
+ trust** (standard practice; friction removed by trust).

## 8. Workflow gate

Per blueprint §40: this plan is the STOP point. Implementation starts only
after explicit owner approval (and Q1 answer, if different from the
recommendation).
