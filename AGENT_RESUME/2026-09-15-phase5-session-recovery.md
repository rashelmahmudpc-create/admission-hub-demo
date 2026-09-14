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
