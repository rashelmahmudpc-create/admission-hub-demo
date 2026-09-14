# 2026-09-15 — Phase 3 (Option A): account lifecycle + identity reconciliation engine

## ✅ যা করা হলো

**Owner decision (2026-09-15):** Option A approved — Firebase থাকবে canonical
authentication authority; Supabase binding আর হবে না। Phase 3-এর বাকি কাজ
এই architecture-এর উপর complete হবে।

**Chunk 1 — নতুন protected modules (কোনো existing behavior change নেই):**

1. `auth-native/core/account-lifecycle.mjs` — centralized account state machine:
   - ৭টা canonical state (blueprint §10): provisioning, verification_required,
     active, restricted, suspended, recovery, deactivated
   - legacy alias normalize: `disabled → suspended`
   - full transition table; invalid transition reject করে
     `ACCOUNT_STATE_INVALID` (নতুন normalized identity error, errors.mjs-এ)
   - session usability contract ফ্রিজ: **শুধু `active`** (live behavior অপরিবর্তিত)
   - deactivation policy frozen: identity retained, sessions revoked,
     User ID never reused, reactivation only via recovery (blueprint §32)
2. `auth-native/core/identity-reconciliation.mjs` — read-only reconciliation
   (blueprint §45-46 / EXTRA 06-07):
   - findings: orphan-external-identity, orphan-user,
     duplicate-provider-identity, unknown-provider, invalid-user-status,
     invalid-user, invalid-identity
   - `summarizeIdentityHealth()` — count/flag-only diagnostic summary;
     raw subject/email/token কখনো expose করে না
3. `identity-lifecycle.test.mjs` — ১৭টা test: exhaustive transition matrix
   (৭×৭ সব pair), legacy alias, session-usable contract, সব finding type,
   malformed-row safety, summary no-leak check

## 📂 বদলানো ফাইল

- `auth-native/core/account-lifecycle.mjs` (নতুন)
- `auth-native/core/identity-reconciliation.mjs` (নতুন)
- `auth-native/core/errors.mjs` (additive: `ACCOUNT_STATE_INVALID` code + message)
- `identity-lifecycle.test.mjs` (নতুন, 17 tests)

## Chunk 2 — DB status extension + transition-validated write path (done)

1. `auth-native/storage/sqlite-auth-repository.mjs`:
   - নতুন `auth_account_state` table (user_id PK, status, state_version,
     timestamps) — **existing `auth_users` rows-এ একটোও হাত দেওয়া হয়নি**
     (migration-safe: stateless user-রা implicit `active`)
   - schema_version 4 → 5
   - `getAccountState()` — stateless user-র জন্য default `active`
   - `setAccountState()` — **একমাত্র write path**: lifecycle transition
     validate করে; invalid transition = `ACCOUNT_STATE_INVALID` + zero write;
     non-usable state-এ গেলে user-র সব live session revoke (audit:
     `account-sessions-revoked` + `account-state-changed`)
2. `auth-native/testing/memory-auth-repository.mjs` — same contract mirror
3. `auth-native/core/auth-engine.mjs` — `requiredRepositoryMethods`-এ
   `getAccountState`/`setAccountState` যোগ (contract enforcement)
4. `errors.mjs` — additive `ACCOUNT_NOT_FOUND` (404)
5. `account-state-runtime.test.mjs` — 9 tests (sqlite + memory parity):
   default state, not-found, valid transition + audit, invalid transition
   no-write, session revocation on suspend, deactivated→recovery→active
   path, idempotent no-op, engine contract guard

## Chunk 4 — Identity Regression Suite + guard wiring + protection contract (done)

1. **Dedicated Identity Regression Suite:** `npm run test:identity`
   (3 suites: identity-lifecycle 17 + account-state-runtime 9 +
   account-state-api 10 = 36 tests)
2. **Guard wiring:** identity suites যোগ হয়েছে `test:native-auth`-এ (CI-তে
   auto-run) + `native-auth-guard.yml`-এ dedicated step
   "Verify Identity Regression Suite (Protected Identity Core)" + PR
   paths filter-এ identity test files
3. **CODEOWNERS:** identity core modules + 3 identity test files explicitly
   owner-protected
4. **Deactivation path API test:** deactivated → session 401, direct
   reactivation 409 (invalid), recovery → active OK
5. **`docs/IDENTITY-CORE-PROTECTION.md`:** protected components list,
   frozen invariants, mandatory change-control flow, deletion data
   relationship map (architecture only — কোনো destructive endpoint নেই),
   audit event inventory

## 📌 বর্তমান অবস্থা

- **TESTED:** local — test:production-auth সব green: auth 62/62 ·
  email 108/108 + 4/4 · native-auth 239/239 (identity suites included) ·
  test:identity 36/36 · worker bundle exact
- **PROTECTED:** Identity Core এখন guard + CODEOWNERS + protection doc-এ
  marked (blueprint §90 / EXTRA 17)
- Phase 3 (Option A) progress: **Chunk 4/4 — code complete, publish+verify
  চলছে**

## Chunk 3 — DO internal endpoints + public/admin contract API (done)

1. `auth-native/worker/auth-authority-do.mjs` — নতুন internal route:
   - `POST /internal/account/state` — session-bound, current lifecycle state
   - `POST /internal/account/identities` — session-bound, linked identities
     (provider + verification facts only, no raw subject)
   - `POST /internal/account/state/set` — transition-validated state change
     (throws normalized `ACCOUNT_STATE_INVALID`/`ACCOUNT_NOT_FOUND`)
   - `POST /internal/identity/health` — read-only reconciliation health
     summary (counts/flags only)
   - error contract: repository `{error}` → `NativeAuthError` → DO top-level
     catch → `toPublic()` (same convention as existing routes)
2. `auth-native/worker/public-auth-handler.mjs` — নতুন public route:
   - `GET /api/auth/v1/account` — current user's lifecycle state (session)
   - `GET /api/auth/v1/identities` — linked providers for current user (session)
   - `GET /api/auth/v1/admin/identity/health` — reconciliation health (admin token)
   - `POST /api/auth/v1/admin/account/state` — state change `{userId,status}` (admin token)
   - admin route `X-AH-Admin-Token` (constant-time) guard, same as verification admin
3. `auth-native/storage/sqlite-auth-repository.mjs` — `identitySnapshot()`
   (HMAC refs only) + `listLinkedIdentities()` (provider/facts only)
4. `auth-native/testing/memory-auth-repository.mjs` — same two methods mirror
5. `auth-native/core/auth-engine.mjs` — `requiredRepositoryMethods` +=
   `identitySnapshot`, `listLinkedIdentities`
6. `account-state-api.test.mjs` — 9 tests (session 401, identities no-leak,
   admin 403/token, health counts-only, suspend→session-revoked 401,
   invalid transition 409, unknown user 404)

## ⏭️ পরবর্তী কাজ (Phase 3 — Option A)

**Chunk 4 DONE** — Identity Regression Suite + guard wiring + protection
contract + deactivation path (see above).

Remaining:
1. **Protected publish** (dispatch `telegram-auth-canary-activate.yml` with
   `PUBLISH_TELEGRAM_OTP` on main) + live verify of the new endpoints
2. **Phase 3 final report** (owner approval gate — STOP after report)

## 🚨 STOP / সতর্কতা

- Session usability contract **`active`-only** — কোনো status change করবে না
  যার ফলে non-active state-এ session valid হবে
- Provider set `['firebase']`-এ frozen — নতুন provider যোগ করতে হবে শুধু
  নতুন mapping layer implement করার পর
- Identity Core এখনো protected-mark হবে **Phase 3 শেষে** (CODEOWNERS extension)
- Option A locked: Supabase binding শুরু করা যাবে না
