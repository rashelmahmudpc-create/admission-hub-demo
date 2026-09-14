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

## 📌 বর্তমান অবস্থা

- **TESTED:** local — test:production-auth সব green: auth 62/62 ·
  email 108/108 + 4/4 · native-auth 203/203 · identity-lifecycle 17/17
- নতুন module-গুলো এখনো **wired নয়** (DO endpoint / public API / DB status
  migration আসন্ন chunk-এ) — তাই production bundle-এ কোনো পরিবর্তন নেই
- Phase 3 (Option A) progress: **Chunk 1/4**

## ⏭️ পরবর্তী কাজ (Phase 3 — Option A)

1. **Chunk 2:** DB status extension — `auth_users.status` CHECK set-এ নতুন
   ৭ state যোগ (migration-safe: existing 'active'/'disabled'/'suspended'
   rows বৈধ থেকে যাবে; legacy 'disabled' read-এ 'suspended' হিসেবে normalize)
   + repository-তে transition-validated status write path
2. **Chunk 3:** DO-তে internal endpoints — `set-account-status`
   (transition-validated, audit event-সহ), `identity/reconcile`,
   `identity/health` + public contract endpoints
   (`/api/auth/v1/account`, `/api/auth/v1/identities`, admin health)
   + audit event coverage (account-created, status-changed, identity-linked,
   verification-completed)
3. **Chunk 4:** deactivation/deletion architecture + admin diagnostics +
   dedicated Identity Regression Suite + guard wiring + deploy (protected
   publish) + live verify + Phase 3 final report

## 🚨 STOP / সতর্কতা

- Session usability contract **`active`-only** — কোনো status change করবে না
  যার ফলে non-active state-এ session valid হবে
- Provider set `['firebase']`-এ frozen — নতুন provider যোগ করতে হবে শুধু
  নতুন mapping layer implement করার পর
- Identity Core এখনো protected-mark হবে **Phase 3 শেষে** (CODEOWNERS extension)
- Option A locked: Supabase binding শুরু করা যাবে না
