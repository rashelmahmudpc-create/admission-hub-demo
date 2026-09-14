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

## 📌 বর্তমান অবস্থা

- **TESTED:** local — test:production-auth সব green: auth 62/62 ·
  email 108/108 + 4/4 · native-auth 203/203 · identity-lifecycle 17/17 ·
  account-state-runtime 9/9
- Bundle rebuild + commit (exact-bundle guard-এর জন্য)
- DO endpoint / public API wiring আসছে Chunk 3-এ — state engine এখনো
  production traffic-এ wired নয় (read-only safe)
- Phase 3 (Option A) progress: **Chunk 2/4**

## ⏭️ পরবর্তী কাজ (Phase 3 — Option A)

1. **Chunk 3:** DO-তে internal endpoints — `set-account-status`
   (transition-validated, audit event-সহ), `identity/reconcile`,
   `identity/health` + public contract endpoints
   (`/api/auth/v1/account`, `/api/auth/v1/identities`, admin health)
   + audit event coverage (account-created, status-changed, identity-linked,
   verification-completed)
2. **Chunk 4:** deactivation/deletion architecture + admin diagnostics +
   dedicated Identity Regression Suite + guard wiring + deploy (protected
   publish) + live verify + Phase 3 final report

## 🚨 STOP / সতর্কতা

- Session usability contract **`active`-only** — কোনো status change করবে না
  যার ফলে non-active state-এ session valid হবে
- Provider set `['firebase']`-এ frozen — নতুন provider যোগ করতে হবে শুধু
  নতুন mapping layer implement করার পর
- Identity Core এখনো protected-mark হবে **Phase 3 শেষে** (CODEOWNERS extension)
- Option A locked: Supabase binding শুরু করা যাবে না
