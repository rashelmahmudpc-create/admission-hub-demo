# 🔐 Phase 3 — Identity & Account System · FINAL REPORT (Option A)

**Date:** 2026-09-15 (Asia/Dhaka)
**Architecture decision:** **Option A (owner-approved)** — Firebase is the
canonical authentication authority; the Admission Hub account layer is the
canonical application account layer. **No Supabase binding** (blueprint §2
requirement consciously replaced by owner decision; recorded in
`AGENT_RESUME/2026-09-15-phase3-optiona-lifecycle-reconciliation.md`).
**Status: PHASE 3 COMPLETE (Option A) — awaiting owner approval for Phase 4.**

---

## 1. Authority binding status
- Firebase is the bound canonical auth authority (pre-existing, production):
  `FIREBASE_WEB_API_KEY` encrypted Worker binding, authorized-domain check
  at activation, REST boundary (`accounts:signUp/lookup/signInWithPassword/
  signInWithIdp`, secure token refresh).
- Supabase: **not bound, by owner decision (Option A).**

## 2. Adapter status
- `auth-native/providers/firebase-auth.mjs` — provider adapter behind the
  engine boundary (least-privilege, secret via encrypted binding).

## 3. Identity architecture
- Permanent user identity = HMAC-referenced internal `user_id`
  (provider-stable, opaque to clients) in the SQLite Durable Object
  authority (`AdmissionAuthAuthority`).
- Option A caveat (accepted): the internal ID is deterministically derived
  from the Firebase UID, so provider migration would require an identity
  migration (documented in the protection contract).

## 4. Permanent User ID implementation
- `auth_users.user_id` — unique, stable, never reused, never exposed raw to
  clients (HMAC ref only in storage; masked email in responses).

## 5. Account lifecycle
- **New: 7-state machine** (`account-lifecycle.mjs`):
  provisioning → verification_required → active → restricted / suspended /
  recovery / deactivated; centralized transition table; invalid transitions
  rejected (`ACCOUNT_STATE_INVALID`).
- **New: `auth_account_state` table** (schema v5; legacy rows untouched;
  stateless users implicitly `active`).
- Session usability frozen at **`active`-only** (live behavior preserved).
- Deactivation: identity retained, sessions revoked, ID never reused,
  reactivation only via `recovery` (API-tested).

## 6. Provider mappings
- `auth_external_identities` — PRIMARY KEY(provider, subject_ref) +
  UNIQUE(provider, user_id): unique-constrained provider mapping (pre-existing).
- **New: `listLinkedIdentities()`** — provider + verification facts only,
  no raw subjects.

## 7. Duplicate prevention
- Unique email_ref + unique provider mapping (DB constraints).
- Identity conflict → `ACCOUNT_CONFLICT` + audit event
  `firebase-identity-conflict`; signup failure → bounded duplicate cleanup.
- **New: reconciliation detects** duplicate-provider-identity, orphan-user,
  orphan-external-identity, unknown-provider, invalid-user(-status),
  malformed rows (count-only findings).

## 8. Identity linking
- Multi-method on one account: email/password, Google (reauth-gated
  `/google/link`), passkey registration, Telegram verification link —
  all bound to the same internal user. Linking is server-driven; client
  cannot declare identity (HMAC ref match + Firebase lookup required).

## 9. Verification integration
- Single canonical verification flow (Firebase email verify / Telegram
  START→OTP canary); no session issued before authoritative verification
  (pre-existing, unchanged, still enforced).

## 10. Recovery behavior
- `recovery` state in the lifecycle machine; recovery never creates a new
  identity (identity = stable internal ID). Deactivation→recovery→active
  path API-tested.

## 11. Security tests
- Spoofing: client-declared identity impossible (server-derived ID, HMAC
  match, session join on user+identity+email ref).
- Unauthorized linking: conflict detection + reauth requirement.
- Sensitive data: no plaintext email/OTP/token in storage (HMAC refs,
  AES-GCM only where required); responses redacted (tested no-leak).
- Secret exposure: protection suite (no provider keys in bundle/source).
- Admin endpoints: constant-time token check, 403 without token (tested).
- Enumeration: generic error contracts (no account-existence oracles).

## 12. Concurrency tests
- Durable Object = single-writer authority (atomic state transitions).
- Pre-existing concurrency suite: 10 rapid clicks → 1 mutation, two
  independent tab instances, login interrupted by logout (all pass).

## 13. Chaos tests
- `auth-foundation-chaos` + native-auth chaos pass (provider timeout,
  network loss, permanent outage, hanging session creation, 200
  login/logout cycles). No infinite loading/retry.

## 14. Performance tests
- Identity resolution = in-DO SQLite reads (no network round-trips);
  pre-existing load tests (1,000 boots, 25,000 state reads) pass.
  Reconciliation is a single snapshot pass (admin-only, not on hot path).

## 15. Phase 2 regression
- `test:production-auth` fully green after Phase 3: auth foundation
  62/62 · email gateway 108+4/112 · native-auth 239/239 (includes the
  36 identity-suite tests) · worker bundle byte-exact.

## 16. Migration status
- No data migration performed: `auth_account_state` is an additive overlay
  (schema v4→v5); every existing user implicitly `active`; zero legacy row
  rewrites.

## 17. Known limitations
- Option A: internal ID derived from Firebase UID → provider migration
  would need an identity migration (accepted by owner).
- Account status is currently admin-driven only (no user-facing self-service
  suspend/reactivate UI) — by design, matches Phase 3 scope.
- Deletion: architecture + data map defined; **no destructive feature**
  (per blueprint §33 scope).

## 18. Security risks
- Admin token (`ADMIN_TOKEN` binding) is the only write authority for
  account state — protect its rotation; wrong token = 403 (verified live).
- Telegram canary still awaits the physical phone E2E (pre-existing,
  Phase 4/9 territory, unrelated to identity core).

## 19. Technical debt
- Phase 2 `auth/` ports layer remains unwired to production login
  (pre-existing; production path is the `auth-native` worker). Documented,
  not expanded in Phase 3.

## 20. Files/modules changed (Phase 3, 4 commits f04ddde → 00e4a4b + publish d6f5bed→00e4a4b)
- `auth-native/core/account-lifecycle.mjs` (new)
- `auth-native/core/identity-reconciliation.mjs` (new)
- `auth-native/core/errors.mjs` (additive: ACCOUNT_STATE_INVALID,
  ACCOUNT_NOT_FOUND)
- `auth-native/core/auth-engine.mjs` (contract: +4 required repo methods)
- `auth-native/storage/sqlite-auth-repository.mjs` (state table, state
  engine, snapshot, linked identities)
- `auth-native/testing/memory-auth-repository.mjs` (contract mirror)
- `auth-native/worker/auth-authority-do.mjs` (4 internal routes)
- `auth-native/worker/public-auth-handler.mjs` (4 public/admin routes)
- `worker-bundle.mjs` (rebuilt, byte-exact)
- Tests: `identity-lifecycle.test.mjs`, `account-state-runtime.test.mjs`,
  `account-state-api.test.mjs` (36 tests)
- `package.json` (test:identity + guard wiring)
- `.github/workflows/native-auth-guard.yml` (identity suite step + paths)
- `.github/CODEOWNERS` (identity core protected)
- `docs/IDENTITY-CORE-PROTECTION.md` (new protection contract)
- AGENT_RESUME updates

## 21. Database/schema changes
- `auth_account_state(user_id PK, status, state_version, created_at,
  updated_at)` + status index; schema_version 4→5. Additive only.

## 22. Configuration changes
- No new environment variables or bindings. Existing `ADMIN_TOKEN` reused
  for the admin identity endpoints.

## 23. Recommended Phase 4 dependencies
- Phase 4 (Login/Signup final UI) should consume the new contract:
  `GET /api/auth/v1/account`, `GET /api/auth/v1/identities` (session-bound)
  for post-login state display; do NOT call the admin routes from client
  code; do NOT mutate account state outside the admin path.
- Live endpoints verified: `/account` → 401 without session, `/identities`
  → 401 without session, admin routes → 403 without token; `/config` → 200
  (no regression); homepage v254 markers intact. Publish run #42 success.

---

## ACCEPTANCE CHECKLIST (blueprint §92, Option A)

- [x] Authority bound (Firebase — owner decision) + adapter working +
      secrets secured + auth configuration verified
- [x] Permanent User ID + provider mapping + resolver + duplicate
      prevention + linking architecture + recovery preservation
- [x] Account creation + **7-state account status** + lifecycle +
      deactivation architecture + safe retry + idempotent state writes
- [x] Spoofing blocked + unauthorized linking blocked + sensitive data
      protected + secret exposure tests + enumeration protection
- [x] Race condition tests + chaos tests + recovery tests + regression
      tests (413 local tests green; CI guards green; publish #42 green)
- [x] Identity Core marked PROTECTED (guard suite on every push/PR +
      CODEOWNERS + protection contract doc)

**🔐 PHASE 3 (Option A) COMPLETE — STOP. Waiting for owner approval before
Phase 4 (Login/Signup final UI). Agent must not start Phase 4 on its own.**
