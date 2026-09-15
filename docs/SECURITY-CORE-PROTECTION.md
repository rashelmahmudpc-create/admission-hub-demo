# 🛡️ Security Core — Protection Contract (Phase 6)

**Status:** PROTECTED (since Phase 6 closeout, 2026-09-15)
**Owner decision:** The Cloudflare Durable Object (SQLite) is the single
security authority. Risk decisions, device trust, security challenges and
step-up enforcement are computed server-side from the ledger; the client is a
thin UI around those decisions. Nothing in the browser may grant, skip or
weaken a security decision.

## What is protected

| Component | Path |
|---|---|
| Security policy + risk matrix | `auth-native/core/security-policy.mjs` (`evaluateRisk`, `cooldownForFailure`, `resolveFailSafe`) |
| Security config (TTLs, thresholds) | `auth-native/core/security-config.mjs` |
| Notification boundary | `auth-native/core/security-notifications.mjs` (catalog + dry-run dispatch) |
| Risk decision + challenge engine + step-up | `auth-native/core/auth-engine.mjs` (`#loginRiskDecision`, `#assertStepUp`, `requestChallenge`/`verifyChallenge`/`cancelChallenge`, `revokeAllSessions`, `revokeTrustedDevice`, `trustCurrentDevice`, `securityHistory`, `securityHealth`, `securityEventsPage`) |
| Trust + challenge storage (SQLite) | `auth-native/storage/sqlite-auth-repository.mjs` (`auth_trusted_devices`, `auth_security_challenges`, `recentSecurityHistory`, `securityEventCounts`, `listSecurityEvents`, `auth_security_events`) |
| Security authority routes (server-only) | `auth-native/worker/auth-authority-do.mjs` (`/internal/security/*`, `/internal/admin/security/*`) |
| Public security API | `auth-native/worker/public-auth-handler.mjs` (`/security/state`, `/security/history`, `/security/challenge/*`, `/security/device/trust`, `/security/devices/revoke`, `/admin/security/*`) |
| Client security UI | `account-access.js` (step-up challenge view, trust prompt, `performLogoutAll` STEP_UP_REQUIRED flow) |
| Regression suites | `security-policy.test.mjs` (13), `security-device-trust.test.mjs` (15), `security-challenge.test.mjs` (14), `security-challenge-ui.test.mjs` (4), `security-history-admin.test.mjs` (10), `security-chaos.test.mjs` (14) — inside `npm run test:native-auth` |

## Frozen invariants

1. **One security authority.** Risk, trust, challenge and step-up state live
   only in the DO's SQLite ledger. A client-supplied flag can never raise
   trust, skip a challenge or extend a session (blueprint §3).
2. **Fail-safe, never fail-open.** If the risk evaluation cannot complete
   (storage or signal outage), a sensitive action falls to the fail-safe
   policy — `sensitive` actions get a challenge, they never proceed silently
   (§30–§31).
3. **Challenge binding.** A security challenge is bound to (user, purpose,
   device) at creation; it is single-use, attempt-capped (default 3),
   expiring (15 min) and verified against the exact attempt. The single-use
   flip is proven by the stored MAC, not by re-reading the status.
4. **Step-up is 2-step and token-once.** A step-up-gated action (logout-all,
   trusted-device revocation) passes only while the session is recent
   (≤5 min) AND risk is below ELEVATED; otherwise the server answers
   `STEP_UP_REQUIRED` (409) and the client's two-step arm runs a challenge.
   The returned `stepUpToken` is user- and device-scoped, MAC-validated in
   constant time and consumed exactly once.
5. **Trust is consent, capped and revocable.** Device trust (30 days, max 10
   devices, LRU) is registered only by explicit consent (`/security/device/trust`
   or completing a new-device challenge on that device). Trust never outranks
   authority: a CRITICAL account fact blocks even a trusted device.
6. **Cooldown, never lockout.** Repeated login failures escalate delay
   (0 → 5 min → 15 min → 60 min ceiling) inside a rolling window. Window
   roll-over always restores login; no permanent lockout is ever recorded
   (§6).
7. **Privacy boundary (no location, ever).** `GET /security/history` returns
   method + coarse browser class + time only. No IP, no geolocation, no raw
   email, no raw device identifier may appear in any history, admin or
   notification payload — the admin ledger is refs-only and notifications
   accept the masked email or fail closed.
8. **Suspension is immediate and total.** Suspending an account revokes every
   live session and makes the risk decision CRITICAL (block) for any
   re-login. There is no path where a suspended account keeps or re-earns a
   session.
9. **Admin surface is token-gated.** `/admin/security/*` requires
   `X-AH-Admin-Token` (constant-time compared, ≥20 chars configured). The
   public handler is the only gate; the DO's admin routes are never exposed
   outside the worker.
10. **Notifications are dry-run in Phase 6.** The security notification
    catalog exists and is unit-tested, but live sending requires
    `SECURITY_NOTIFICATIONS_ACTIVATION=enabled` AND a configured sender
    (neither is set in Phase 6). A notification failure must never break an
    auth/security flow.
11. **Audit ledger integrity.** Every trust change, challenge lifecycle
    step, revocation, collision and step-up is written to
    `auth_security_events` with refs only. Cleanup purges after 90 days and
    never deletes a still-live row early.

## Change control

- Any change to the files above runs `native-auth-guard`
  (`.github/workflows/native-auth-guard.yml`): exact `worker-bundle.mjs`
  check + `test:native-auth` (332 tests, including all security suites) +
  `test:identity` + `account-retirement`.
- These paths are CODEOWNERS-protected to `@sheikhrashel47-stack`;
  PRs touching them require the owner's review.
- Version bumps rebuild `worker-bundle.mjs` exactly (`npm run build:worker`)
  and bump `sw.js`/`index.html` markers together; the publish verify step
  greps the live shell for the exact new marker.
- TOTP/passkey security methods are registry-ready but intentionally out of
  scope for Phase 6 (explicit non-goal).

## AGENT SECURITY RULE (§38)

1. Never weaken, bypass or "temporarily disable" a security invariant in a
   hotfix — extend the suite and the review gate instead.
2. Never add raw email, IP or geolocation to any new auth/security response,
   admin endpoint, event or notification.
3. Never make a fail-open change to the risk path: every new signal must
   have a fail-safe behaviour documented in `security-policy.mjs`.
4. Never store auth material in browser storage; new client UI must use the
   existing HttpOnly cookie + BroadcastChannel patterns.
5. Any new sensitive action must be wired through `#assertStepUp` (or a
   purpose-bound challenge) before it is exposed publicly.
6. Publish only the protected workflow (`PUBLISH_TELEGRAM_OTP`) with the
   canary-then-verify steps intact; never skip the live marker verification.
