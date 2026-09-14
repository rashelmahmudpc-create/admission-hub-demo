# 🔐 Identity Core — Protection Contract (Phase 3)

**Status:** PROTECTED (since Phase 3 closeout, 2026-09-15)
**Owner decision:** Option A — Firebase is the canonical authentication
authority; the Admission Hub account layer (this core) is the canonical
application account layer.

## What is protected

| Component | Path |
|---|---|
| Account lifecycle state machine | `auth-native/core/account-lifecycle.mjs` |
| Identity reconciliation engine | `auth-native/core/identity-reconciliation.mjs` |
| Account state storage + write path | `auth-native/storage/sqlite-auth-repository.mjs` (`auth_account_state`, `setAccountState`) |
| Identity API (DO + public + admin) | `auth-native/worker/auth-authority-do.mjs`, `auth-native/worker/public-auth-handler.mjs` (`/internal/account/*`, `/internal/identity/*`, `/api/auth/v1/account`, `/api/auth/v1/identities`, `/api/auth/v1/admin/identity/*`, `/api/auth/v1/admin/account/*`) |
| Identity regression suite | `identity-lifecycle.test.mjs`, `account-state-runtime.test.mjs`, `account-state-api.test.mjs` (`npm run test:identity`) |

## Frozen invariants

1. **Session usability is `active`-only.** No change may allow a session to
   be valid in any other account state.
2. **One write path.** Account state may only change through
   `SqliteAuthRepository.setAccountState` (transition-validated, audited).
3. **Provider set frozen at `['firebase']`** until a new provider mapping
   layer is explicitly implemented and approved.
4. **No raw identity leakage.** Public/admin responses expose HMAC refs,
   counts and flags only — never raw subjects, emails, tokens or OTPs.
5. **Identity is never deleted or reused.** Deactivation retains the
   identity; a User ID is never reassigned.

## Change control (mandatory, in order)

```text
Impact Analysis
   ↓
Architecture Review (vs. NEW-AUTH-SYSTEM-10-PHASE-ROADMAP.md invariants)
   ↓
Identity Regression Test (npm run test:identity — must pass)
   ↓
Full Production Auth Regression (npm run test:production-auth — must pass)
   ↓
Security Review (error contract, redaction, rate limits, admin gating)
   ↓
Explicit owner approval
   ↓
Change + exact Worker bundle rebuild (worker-bundle.mjs)
   ↓
Protected publish + live verification
```

The Cloudflare Native Auth Guard runs the Identity Regression Suite on every
push/PR; a failing suite blocks the merge path.

## Account deletion — architecture only (no destructive feature)

Per Phase 3 scope, **no destructive deletion endpoint exists or may be
added without a new explicit approval**. The data relationship map below is
the required architecture (§33):

| Area | Storage | Key | Deletion impact |
|---|---|---|---|
| Account | `auth_users` | `user_id` | identity row — retained by default (blueprint: identity retained) |
| Lifecycle state | `auth_account_state` | `user_id` | removed with account |
| Profile | `auth_profiles` | `user_id` | removed with account |
| External identities | `auth_external_identities` | `user_id` | removed with account |
| Sessions | `auth_sessions` | `user_id` | revoked |
| Passkeys | `auth_passkey_credentials` (+ handles/challenges/tickets) | `user_id`/device | removed with account |
| Security events | `auth_security_events` | `user_id` | retained for audit window (90 days), then pruned by retention |
| Verification state | verification repository (tickets) | session/user bound | expired/invalidated |
| Provider account | Firebase Auth (external authority) | Firebase UID | provider-side deletion is a separate, explicit owner action |

Deletion policy (when/if approved in a future phase):
`deactivated` → explicit verified deletion request → controlled
`recovery`-gated window → area-by-area removal (non-identity first) →
provider account deletion last → audit record `account-deleted` →
User ID permanently unusable (never reused).

## Audit events (identity core)

`firebase-account-linked` (account created/identity linked),
`firebase-login`, `account-state-changed`, `account-sessions-revoked`,
`logout`, `firebase-identity-conflict` — all in `auth_security_events`
(HMAC refs only, 90-day retention, never credentials/OTP/raw subjects).
