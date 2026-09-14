# 🛡️ Session Core — Protection Contract (Phase 5)

**Status:** PROTECTED (since Phase 5 closeout, 2026-09-15)
**Owner decision:** The Cloudflare Durable Object (SQLite) is the single
session authority. The client session engine is a state machine around that
authority — it never creates, extends or decides auth by itself.

## What is protected

| Component | Path |
|---|---|
| Session storage + revocation | `auth-native/storage/sqlite-auth-repository.mjs` (`auth_sessions`, `getExternalSession` (+`trackRefresh`), `revokeUserSessions`) |
| Session engine (TTL, establish, verify) | `auth-native/core/auth-engine.mjs` (`SESSION_TTL_MS`, `REMEMBER_OFF_TTL_MS`, `establishFirebaseSession`, `getFirebaseSession`) |
| Session authority routes (server-only) | `auth-native/worker/auth-authority-do.mjs` (`/internal/firebase/session/create`, `/internal/firebase/session/get`, `/internal/session/revoke-all`) |
| Public session API | `auth-native/worker/public-auth-handler.mjs` (`/api/auth/v1/session`, `/session/logout`, `/session/logout-all`, `/login` with `remember`) |
| Client session engine | `account-access.js` (state machine `INITIALIZING…ERROR`, `coordinatedRefresh`, `performSessionRefresh`, `api()` recovery, `broadcastAuthEvent`/`handleAuthSyncMessage`, `captureReturnDestination`/`restoreReturnDestination`, `performLogoutAll`) |
| Session regression suites | `session-recovery-api.test.mjs` (6), `session-recovery-chaos.test.mjs` (16) — `npm run test:session` |

## Frozen invariants

1. **One session authority.** A session is valid only while its SQLite row is
   unrevoked and unexpired. The client may never treat a local flag as
   authenticated; the HttpOnly session cookie is the only credential.
2. **Network failure is not logout.** A transport failure (status 0) keeps the
   signed state and retries at most twice (400 ms, 1200 ms backoff). The
   state machine must never drop an authenticated tab because the network
   dipped (blueprint §17).
3. **Terminal auth errors clear session state only.** 401/403 clear local
   session/verification/telegram/backup state and go to `UNAUTHENTICATED`.
   Identity, profile, pending signup and device cookies are never touched by
   the client (§30).
4. **One refresh at a time.** All refresh triggers (bootstrap, near-expiry
   schedule, recovery, multi-tab login) funnel through `coordinatedRefresh`
   — concurrent callers share exactly one `/session` request.
5. **One recovery per request.** A `401 SESSION_INVALID` on a protected route
   may trigger at most one coordinated refresh followed by at most one retry
   of the original request. `/session` itself uses `noRecovery` — there is no
   recovery loop.
6. **Session ≠ identity.** Logout, logout-all and suspension revoke session
   rows only. User/identity rows are never deleted, disabled-by-session or
   reused. Re-login after any of these must work (or be blocked explicitly by
   account state, never by accident).
7. **Remember-me semantics.** Default session TTL is 30 days
   (`SESSION_TTL_MS`). Only an explicit `remember: false` on password login
   shortens the established session to 7 days (`REMEMBER_OFF_TTL_MS`).
   Refreshes always extend by the full TTL.
8. **Zero browser storage for auth sync.** Multi-tab login/logout propagation
   uses BroadcastChannel only. No auth state, token or session flag may ever
   land in `localStorage`/`sessionStorage`/non-HttpOnly cookies.
9. **logout-all is session-bound and audited.** `POST /session/logout-all`
   requires a valid session, calls the server-only
   `/internal/session/revoke-all`, returns `{ ok, authenticated:false,
   revoked }`, clears the device's session cookies, and writes audited events
   (`logout-all`, `account-sessions-revoked`) without any token material.
10. **Audited refreshes without tokens.** `session-refreshed` events are
    written only for explicit `/session` refreshes (`trackRefresh: true`),
    never by protected-route session checks, and never contain tokens.
11. **Client state is explicit.** The account page exposes
    `data-session-state` with the legal transition table; UI must not infer
    auth from anything else. Illegal transitions are no-ops, not errors.

## Change control (mandatory, in order)

```text
Impact Analysis
   ↓
Architecture Review (vs. NEW-AUTH-SYSTEM-10-PHASE-ROADMAP.md invariants)
   ↓
Session Regression (npm run test:session — must pass)
   ↓
Full Production Auth Regression (npm run test:production-auth — must pass)
   ↓
Security Review (error contract, cookie hygiene, zero-storage, audit)
   ↓
Explicit owner approval
   ↓
Change + exact Worker bundle rebuild (worker-bundle.mjs)
   ↓
Protected publish + live verification
```

Any change to `auth-native/**` requires the exact `worker-bundle.mjs` rebuild
in the same change set (checked byte-for-byte by the guard).

## Test entry points

- `npm run test:session` — 22 tests: API contract (6) + chaos regression (16)
  covering expiry→relogin, multi-device revocation, suspension, parallel
  reads, remember-me TTL, state machine, single-flight refresh, network
  resilience, bounded terminal 401, recovery-before-retry, logout-all,
  two-tab propagation (BroadcastChannel), deep-link restore, remember
  passthrough.
- `npm run test:production-auth` — full regression including the above.
