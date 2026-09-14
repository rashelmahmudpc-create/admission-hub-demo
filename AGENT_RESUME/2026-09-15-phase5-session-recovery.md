# 2026-09-15 — Phase 5: Session & Recovery Engine (Chunk 1 — server session core)

## ✅ যা করা হলো (Chunk 1/4)

**Owner approval received** for Phase 5 (previous message: "Next" after
Phase 5 gap analysis).

1. **`POST /api/auth/v1/session/logout-all`** (blueprint §12):
   - session-bound; সব device-এর session revoke করে (current device সহ)
   - অন্য user-র session আক্ষুণ্য (multi-device isolation §10-11 verified)
   - response: `{ ok, authenticated: false, revoked: N }` + clear auth cookies
   - DO route: `/internal/session/revoke-all`
   - repository: `revokeUserSessions()` (atomic, idempotent, `logout-all`
     audit event)
2. **Session refresh telemetry** (§25):
   - `session-refreshed` audit event — শুধু explicit `/session`
     bootstrap path-এ track করা হয় (অন্য protected route-এ না — no noise)
   - `firebaseReadySession({ trackRefresh })` — single DO round-trip
     (extra network call যোগ করা হয়নি — §34 performance)
3. **Engine contract:** `requiredRepositoryMethods += revokeUserSessions`;
   `getFirebaseSession` trackRefresh passthrough
4. **Memory repository:** same contract mirror
5. **`session-recovery-api.test.mjs`** — 6 tests:
   - multi-device revoke (user-1's 2 sessions dead, user-2 alive)
   - idempotent + unknown user error
   - trackRefresh on/off event accounting
   - API: logout-all 200 + revoked count + cookie cleared + audit event
   - API: logout-all without session → 401, nothing revoked
   - API: /session tracks refresh, /account does not

## 📂 বদলানো ফাইল

- `auth-native/storage/sqlite-auth-repository.mjs` (trackRefresh,
  revokeUserSessions)
- `auth-native/testing/memory-auth-repository.mjs` (mirror)
- `auth-native/core/auth-engine.mjs` (contract + passthrough)
- `auth-native/worker/auth-authority-do.mjs` (/internal/session/revoke-all)
- `auth-native/worker/public-auth-handler.mjs` (/session/logout-all,
  firebaseReadySession trackRefresh, /session tracked)
- `package.json` (test:session script; session suite → test:native-auth)
- `.github/workflows/native-auth-guard.yml` (PR paths)
- `.github/CODEOWNERS`
- `session-recovery-api.test.mjs` (new, 6 tests)
- `worker-bundle.mjs` (rebuilt, exact)

## 📌 বর্তমান অবস্থা

- **TESTED:** local — test:production-auth সব green: 62 + 108 + 4 + 239
  · session-recovery-api 6/6 · worker bundle exact
- Phase 5 progress: **Chunk 1/4** (server session core)

## ⏭️ পরবর্তী কাজ (Phase 5)

1. **Chunk 2 (client):** session state machine (INITIALIZING/AUTHENTICATED/
   REFRESHING/RECOVERING/LOGGING_OUT/ERROR) + refresh coordinator
   (single-flight, near-expiry, max retry, no infinite loop) + "Recovering…"
   UX + session error classification (§3, §7-8, §21-22, §24, §27, §35)
2. **Chunk 3 (client):** multi-tab sync (BroadcastChannel) + deep-link
   restoration + Remember Me session lifecycle + "সব device থেকে Log Out"
   button (signed view-তে)
3. **Chunk 4:** Phase 5 regression/chaos suite (expired/revoked/concurrent
   refresh/two-tab/network) + guard wiring + protected publish + live
   verify + Phase 5 final report + Protected Session Core doc

## 🚨 STOP / সতর্কতা

- Session engine Phase 3 identity core ও Phase 4 login flow **replace
  করবে না** (§1 absolute rule)
- Client কখনো authoritative session authority হবে না — session সবসময়
  server (DO) authority (§1, §23)
- Refresh: max retry + terminal state — infinite loop নিষিদ্ধ (§8)
- Network failure ≠ logout (§17) — client state clear হবে শুধু auth
  error-এ

---

## ✅ Chunk 2+3+4 — DONE (2026-09-15, same day)

### Chunk 2 — client session engine (account-access.js)
- **State machine** `INITIALIZING → CHECKING_SESSION → AUTHENTICATED →
  REFRESHING/RECOVERING/EXPIRING/LOGGING_OUT → UNAUTHENTICATED/ERROR` with a
  legal-transition table; illegal transitions are no-ops. Exposed on the
  account page as `data-session-state` (readable by UI + tests).
- **Refresh coordinator** `coordinatedRefresh()` — single-flight: 10
  concurrent callers share exactly one `/session` call.
- **`performSessionRefresh()`** — retries network failures (status 0) at most
  twice with 400/1200 ms backoff; network exhaustion KEEPS the signed state
  (blueprint §17); 401/403 is terminal → clears only local session state
  (§30), never identity. View redirect to login happens only when the tab
  actually held a session (cold bootstrap view choice stays with bootstrap).
- **Near-expiry schedule** — refresh scheduled `expiresAt − 1h`, clamped
  60 s…6 h; cleared on logout/clear.
- **Recovery-before-retry in `api()`** — a `401 SESSION_INVALID` on a
  protected route (while AUTHENTICATED/LOGGING_OUT) triggers ONE coordinated
  refresh, then retries the original request exactly once. `/session` uses
  `noRecovery` → no recovery loops.
- **Error classification** — status 0 = network (keep state, retry); 401/403
  = terminal auth (clear session state only); other = surface friendly error.

### Chunk 3 — multi-tab + deep-link + remember-me + logout-all UI
- **Multi-tab sync** via BroadcastChannel `admission-hub-auth-v1` only —
  zero browser storage (owner rule + protection tests). Login in one tab
  makes other tabs re-check; logout / logout-all in one tab signs out the
  others. Own-tab messages filtered by `TAB_ID`.
- **Deep-link restore** — `location.hash` captured while logged out on
  `open()`; restored exactly once after a successful re-login (page closes,
  hash restored, anchor scrolled).
- **Remember-me lifecycle** — login passes the "Remember me" checkbox as
  `remember`; server honors explicit `remember: false` with a 7-day session
  (`REMEMBER_OFF_TTL_MS`); default stays 30 days (`SESSION_TTL_MS`); refreshes
  always extend the full TTL.
- **"সব device থেকে Log Out" button** in the signed view with 2-step arm
  (4 s), `POST /session/logout-all`, revoked count in the success message,
  broadcast to other tabs.

### Chunk 4 — chaos suite + wiring + docs
- **`session-recovery-chaos.test.mjs` (16 tests)**:
  - server: expired→relogin identity intact · logout-all every device +
    relogin · suspension revokes session (401) & identity intact ·
    non-active user row blocks session+relogin (403) · 10 parallel reads no
    corruption · remember-me 30d vs 7d TTL
  - client (JSDOM): AUTHENTICATED bootstrap · 10 concurrent refreshes = 1
    `/session` call · network failure keeps signed (bounded) · terminal 401
    bounded to login view · stale 401 → one refresh → retry succeeds ·
    logout-all success clears + reports · 2-tab logout propagation ·
    2-tab login re-check propagation · deep-link restore · remember
    passthrough (true/false)
- Wired into `test:session` (now 22 tests) + `test:native-auth` + guard PR
  paths + CODEOWNERS.
- **`docs/SESSION-CORE-PROTECTION.md`** — Protected Session Core contract
  (11 frozen invariants + change control).
- **Version bump v255** — `BUILD_ID v255-session-engine-20260915`, assets
  `?v=20260915-session-engine-v1` across index.html, sw.js, canary-verify
  workflow + 16 marker tests.
- `worker-bundle.mjs` rebuilt (engine + handler remember change) — exact.
- `npm run test:production-auth` all green: 62 + 108 + 4 + 261.

## 📌 বর্তমান অবস্থা (post 2-4)

- Phase 5 progress: **Chunks 2/3/4 coded + tested locally** (before publish)
- Remaining: protected publish (confirmation PUBLISH_TELEGRAM_OTP) + live
  verify (both hosts) + final report commit.
