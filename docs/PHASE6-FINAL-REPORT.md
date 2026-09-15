# 🛡️ Phase 6 — Security, Device Trust & Risk Engine · FINAL REPORT

**Date:** 2026-09-15 (Asia/Dhaka)
**Commits:** `9f00cf3` (Chunk 1) → `3fc8860` (Chunk 2) → `eb64e9a`
(Chunk 3) → `377ae00` (Chunk 4) → `a6d1554` (Chunk 5 chaos) → `efb238e`
(v256 bump + protection contract + guard wiring)
**Version:** `v256-security-core-20260915` (sw.js + index.html markers)
**Deploy:** **LIVE** — `v256-security-core-20260915` published
2026-09-15 via a **manual protected publish** (Cloudflare API, executed by
the agent at the owner's explicit instruction because GitHub disabled
Actions **and** Pages at the account level: "Actions has been disabled for
this user", demo host returning "Site not found").
- Worker `admission-gk`: prev `6c5ba2f2-443b-45e4-88ec-90a959f746f7` →
  new **`3b1b4c97-9f84-4cd2-a6cc-5db5a3245458`** (rollback anchor kept).
- Cloudflare Pages project `admissionhub` (branch `main`): deployment
  **`b9237110`** → https://admissionhub.pages.dev.
- Telegram canary: activated on attempt 1
  (`webhookChanged=false` — webhook already at the correct endpoint),
  transient proof secret deleted afterwards, activation route verified
  closed (HTTP 403).
- Every workflow pre-gate passed before deploy: `check:worker-bundle`,
  `test:production-auth` 37/37, `account-retirement` 30/30;
  `verify-telegram-bindings` READY; Firebase worker binding PASS.
- The workflow's own 137-line live verification script (release marker,
  config contracts, zero-raster, protected generic-backup isolation,
  cache-safe assets) ran **unmodified against the live host: PASS**.
- One exception, documented: `verify-google-browser-origin.mjs` could not
  run in the publish sandbox (headless Chromium needs system libraries;
  sandbox is non-root). It is unrelated to v256: the Phase 6 diff touches
  **zero** Google-related files, the live config still reports
  `google: available, READY` with the unchanged client ID, and the same
  origin was browser-verified during the Phase 5 publish.
- Demo host `sheikhrashel47-stack.github.io/admission-hub-demo/` remains
  404 while GitHub has the account's Pages disabled (legacy branch-based
  build); it will serve v256 automatically once GitHub re-enables Pages.

---

## 1. What was built (5 chunks, ~58 new tests)

### Chunk 1 — central security config + risk policy (commit `9f00cf3`)
- `auth-native/core/security-config.mjs` — one frozen, versioned config
  (`security-policy-v1`): risk levels, thresholds, TTLs, cooldown steps,
  fail-safe policy, purposes, action classes.
- `auth-native/core/security-policy.mjs` — pure decision functions:
  `evaluateRisk` (conservative combination; CRITICAL only from
  authoritative facts), `cooldownForFailure` (0 → 5 m → 15 m → 60 m
  ceiling, rolling window, never a permanent lockout), `resolveFailSafe`
  (sensitive → challenge, never silent proceed).
- Ledger v6 schema work + 13 policy unit tests + 1 integration test.

### Chunk 2 — risk engine wired to /login + device trust (commit `3fc8860`)
- Engine: `#loginRiskDecision` (signals: accountState, failedLogins,
  rapidRequests, newDevice, recoveryActive, unverifiedAccount; fail-safe
  on any evaluation outage), trust lifecycle (30-day trust, max 10
  devices, LRU eviction, revoke current/ref/all), purpose-bound new-device
  challenge on login (`securityChallenge: true` → 202 selectionRequired,
  completing the ticket grants session + 30-day trust on that device).
- Cooldown enforcement in `consumeFirebaseOperation` + `recordLoginFailure`
  (429 with `Retry-After`; delay never lockout).
- DO: 4 internal security routes. Handler: security flags on `/login`
  response (`session.security: { level, trusted, trustOffer, policyVersion }`).
- 15 engine-level tests (fast path, expiry, revocation, LRU cap, fail-safe).

### Chunk 3 — challenge engine + step-up, server + client (commit `eb64e9a`)
- Engine: purpose-bound **security challenge** (email/Telegram delivery via
  the existing verification orchestrator; single-use MAC-proof flip,
  attempt cap 3, 15-min TTL, device-bound) → `requestChallenge` /
  `verifyChallenge` / `cancelChallenge`; `verifyChallenge` returns a
  one-time `stepUpToken` (user- and device-scoped, MAC-validated in
  constant time, consumed exactly once).
- **Step-up gate** `#assertStepUp` on sensitive actions (logout-all,
  trusted-device revocation): passes while the session is recent (≤5 min)
  AND risk < ELEVATED; otherwise 409 `STEP_UP_REQUIRED` arms the client's
  two-step flow, then the action retries once with the token.
- Repos: `auth_security_challenges` (15 cols + 8 lifecycle methods, sqlite
  + memory), public audit hook, session `createdAt` exposure.
- Client (`account-access.js`): step-up challenge view (6-digit code,
  expiry countdown, cancel; Telegram link when delivered via Telegram),
  `performLogoutAll` STEP_UP_REQUIRED → challenge → one retry, 30-day
  **device trust prompt** after `trustOffer` logins, friendly
  OTP_INVALID/CHALLENGE_INVALID messages.
- 14 engine tests + 4 JSDOM client tests.

### Chunk 4 — security history, notifications, admin foundation (commit `377ae00`)
- Engine: `securityHistory` (recent logins: **method + coarse browser
  class + time only** — no IP, no location, no raw email, ever),
  `securityHealth` (15-min event counts), `securityEventsPage` (paged,
  refs only).
- `auth-native/core/security-notifications.mjs` — 7-event catalog
  (new-device-login, password-changed, passkey-added/removed,
  recovery-started/completed, suspicious-activity) + dry-run dispatch;
  raw email fails closed. DO wires new-device-login + step-up/suspicious
  signals; **dry-run is the Phase 6 default** (no live mass send).
- Public: `GET /security/state`, `GET /security/history`,
  `POST /security/devices/revoke` (step-up gated).
- Admin (X-AH-Admin-Token, constant-time): `GET /admin/security/health`,
  `GET /admin/security/events` (paged, refs only).
- 10 tests (history privacy, method mapping, health counts, event paging,
  notification contract + PII guard, session-bound routes, revoke step-up,
  admin gating + redaction).

### Chunk 5 — chaos + protection + v256 (commits `a6d1554`, `efb238e`)
- `security-chaos.test.mjs` (14 adversarial tests): stolen credentials +
  new device; cooldown escalation without permanent lockout; recovery
  ticket abuse (expired/invalid/duplicate); identity-linking collision;
  suspension (sessions revoked + re-login blocked by CRITICAL decision);
  risk-service outage fail-safe; duplicate challenges; concurrent
  verification single-winner; concurrent same-device logins; storage
  timeout atomicity; cross-user step-up token rejection; LRU trust
  eviction; ledger retention; step-up token expiry.
- **Caught a real production bug:** the sqlite `createSecurityChallenge`
  INSERT shipped 14 values for 15 columns (created_at/expires_at
  mis-bound) — every challenge request would have crashed on the live DO.
  Fixed + covered by the chaos suite.
- `docs/SECURITY-CORE-PROTECTION.md` — 11 frozen invariants, change
  control, AGENT SECURITY RULE (§38).
- Version bump `v256-security-core-20260915` (sw.js + index.html + all
  shell marker assertions + publish verify).
- Guard wiring: `security-*.test.mjs` + protection doc in
  `native-auth-guard` trigger paths; CODEOWNERS protection for the
  security suites + protection docs.

## 2. Test totals (all green at `efb238e`)

| Suite | Tests |
|---|---|
| `test:native-auth` (incl. all 5 security suites) | **332/332** |
| `test:identity` (Phase 3 regression) | 36/36 |
| `test:session` (Phase 5 regression) | 22/22 |
| `test:auth` | 62/62 |
| `test:email` | 108/108 + 4/4 |
| `check:worker-bundle` (exact `worker-bundle.mjs`) | exit 0 |

New tests in Phase 6: **56** (13+1 / 15 / 14+4 / 10 / 14).

## 3. Completion gate (§39) — checklist

- [x] Central engine (risk + trust + challenge in one DO authority)
- [x] Risk evaluation (conservative matrix, fail-safe, no auto-suspend)
- [x] Device trust (30-day consent, cap 10, LRU, revocation)
- [x] New-device handling (challenge-once + trust on completion)
- [x] 2FA foundation (method registry; email/Telegram live; TOTP later —
      explicit non-goal)
- [x] Step-up (2-step, token-once, constant-time MAC, user/device scope)
- [x] Challenge engine (purpose/device bound, single-use, capped, expiring)
- [x] Brute-force protection (escalating cooldown, no permanent lockout)
- [x] Event ledger (refs-only audit, 90-day retention)
- [x] Session + identity integration (suspension = immediate + total)
- [x] Recovery security (ticket expired/invalid/duplicate all fail closed)
- [x] Privacy boundary (no location ever; masked email only in notices)
- [x] Chaos tests pass (14)
- [x] P3+P4+P5 regression pass (identity/session/auth/email green)
- [x] No critical issue open (the one found — sqlite challenge INSERT —
      fixed + regression-tested)
- [x] **Protected publish + live verify** — DONE (manual, owner-authorized):
      all pre-gates green, worker + Pages deployed, full live verification
      script PASS on admissionhub.pages.dev (marker
      `v256-security-core-20260915`, config contracts, zero-raster,
      protected isolation), canary activated + cleaned up (route 403).
      github.io demo host blocked only by GitHub's account-level Pages
      disable — serves v256 automatically after re-enable.

## 4. Explicit non-goals honoured (no TOTP, no live mass notifications,
no auto-suspension, no email-change flow, no location capture, no new
fingerprinting — device identity stays the opaque server-issued cookie).

## 5. Known follow-ups (post-Phase 6)

- Password-change endpoint does not exist yet (recovery flow only) —
  step-up is wired for it already (`purpose` registry ready).
- Live notification sending (adapter + dry-run only in Phase 6).
- TOTP method via the existing challenge method registry.
