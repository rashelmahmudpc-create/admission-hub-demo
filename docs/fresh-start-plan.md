# Fresh Start plan (owner order 2026-10-17)

Keep: Firebase project `admissionsky-997d2` (only project; OTP chain first, Firebase link = last-resort backup, 1000/day).
Goal: delete the old Firebase project, wipe all user data, rebuild a structured user database, private student profiles in the Control Center, old test emails can sign up again.

Rule: "ধাপ X শুরু করো" = permission to merge + deploy that phase. Only Phase 4 (wipe) asks one final yes with exact counts.

## Progress
- [x] Phase 0: inventory (this file, 2026-10-17)
- [x] Phase 1 (2026-10-17): `email-intro-continue` button -> `beginEmailOwnership` (OTP chain first, Firebase link fallback). sw:manifest. merge + deploy
- [x] Phase 2 (2026-10-17): new versioned schema + migrations + tests (students, login_methods, email_verifications, otp_attempts, sessions, devices, profiles, activity_log; normalized unique email)
- [x] Phase 3 (2026-10-17): Control Center Students section (list/search, profile, timeline; admin token only, noindex, no secrets)
- [ ] Phase 4: wipe all users (Firebase Auth of admissionsky-997d2 + Cloudflare user data; keep OTP config) -- final yes with counts
- [ ] Phase 5: owner deletes old Firebase project in console
- [ ] Phase 6: end-to-end test (signup -> otp-a Brevo SENT/VERIFIED, Google login, student visible in Control Center)

## Phase 0 findings

### Old Firebase project
- `admission-hub-auth` (verification mail came from `admission-hub-auth.firebaseapp.com`, see docs/FIREBASE-VERIFICATION-DELIVERABILITY-AUDIT.md). Not used by live code: only the unrelated strings `admission-hub-auth-v1` (BroadcastChannel in account-access.js) and `admission-hub-auth-vault-v1` (hash salt in auth-native/core/secret-vault.mjs) remain -- do NOT rename those (renaming the salt breaks stored secrets).
- `admission-hub-test` = test fixture only.
- Old Google OAuth clients seen in history: `673030739375-...` (2026-09, docs only), `203304845427-...` (2026-10-15 workflow only). Live client = `916950643726-...`.
- Console: https://console.firebase.google.com/project/admission-hub-auth/settings/general (owner deletes; Google keeps 30 days for recovery).

### Where user data lives (worker `admission-gk`, wrangler.toml)
- Durable Object SQLite `AUTH_AUTHORITY` (AdmissionAuthAuthority): auth_users, auth_profiles, auth_sessions, auth_trusted_devices, auth_external_identities, auth_public_identities, auth_telegram_identity_links, auth_email_ownership_links, auth_account_verification_tickets, auth_account_state, auth_passkey_*, auth_security_*, auth_rate_limits, auth_meta, auth_verification_challenges, auth_verification_events, auth_verification_daily_quota, auth_verification_provider_state, auth_verification_runtime_config.
  KEEP on wipe: auth_verification_runtime_config, auth_verification_provider_state, auth_verification_daily_quota (OTP settings).
- D1 `PROFILE_DB` = `admission-profile` (8f7cf101-66a3-437d-bc98-a8984698d7f5): user_* (settings, plans, plan_days, notes, mistakes, exams, exam_results, daily_stats, activity, sync_meta), avatars, fcm_devices, notification_*, analytics_events, ai_*; content tables (questions, content_lists, content_meta, global_notifications) are NOT user data -- keep.
- KV `GK_KV`, `PUB_KV`, `OLD_KV`; R2 `FILE_BUCKET` (avatars/files); DO `AI_STATE`, `VOICE_AGENT`, `EMAIL_COORDINATOR` -- check per-user keys in Phase 4.

### Firebase user deletion
- No service account in the worker; code only deletes with the user's own idToken (`accounts:delete`). Bulk delete needs either the owner in Firebase console (Authentication -> Users) or a one-off service account key used only in a GitHub Actions secret. Decide in Phase 4.
- User count: not measured yet (no admin listing endpoint). Phase 3 adds one.

### Known live facts
- Public auth API needs headers `X-AH-Auth-UI: auth-premium-v6` + `Origin`; admin POST needs `Origin: https://admissionsky.pages.dev`.
- `/email-ownership/start` needs Turnstile (cannot be curl-tested). `/account-verification/email/start` = Firebase link directly (used by `email-intro-continue`, Phase 1 fixes).
- Test account created 2026-10-17: rashelmahmudpc+otptest1017@gmail.com (wiped in Phase 4).

## Phase 2 schema
- Code: `auth-native/storage/student-directory-schema.mjs`, test `student-directory-schema.test.mjs` (in `test:native-auth`).
- Where: same Durable Object SQLite as auth (`AUTH_AUTHORITY`). Runs on every DO start, after the auth_* migrations, inside try/catch (never blocks sign-in).
- Versioning: `schema_migrations(version, name, applied_at)`. v1 = `student_directory_v1`. New change = new version; never edit an applied one. Each version runs in one transaction.
- Tables (v1): students (email + email_normalized UNIQUE, trim+NFKC+lowercase, plus-aliases kept; status pending/active/disabled; auth_user_id UNIQUE), login_methods (password/google/facebook/telegram/passkey; one identity -> one student), email_verifications (otp/firebase-link/telegram/oauth), otp_attempts (provider, outcome, latency; no codes), devices, sessions (opaque id, no tokens), profiles, activity_log (json_valid). All children ON DELETE CASCADE -> deleting a student removes everything.
- Purely additive: no auth_* table touched, old data not migrated, new tables start empty. Writes/reads come in Phase 3 (Control Center) -- nothing writes into them yet.

## Phase 3 Students (Control Center)
- Page: `/students-control-center` (noindex, no-store, CSP with script/style hashes, network-only in sw.js, robots Disallow). Token is typed each time and kept only in memory.
- API (GET, `X-AH-Admin-Token` required, read-only): `/api/auth/v1/admin/students?q=&limit=&before=` (counts + newest-first list) and `/api/auth/v1/admin/students/profile?id=<userId>`.
- Source: the live auth tables of `AUTH_AUTHORITY` (`auth-native/storage/student-admin-view.mjs`), so existing accounts show up too. Test: `student-admin-view.test.mjs`.
- Shows: account (created, last login, status), profile, login methods (firebase = password or Google, Firebase does not tell the Worker which; passkey; telegram), email verification (OTP ownership + Firebase links), OTP history (challenges + provider events), trusted devices, sessions, timeline.
- Never shows: plaintext email (none is stored; mask only), codes, MACs, ciphers, tokens, public keys, IP refs, full user agents; device/session refs cut to 8 chars; mobile masked.
- Search: full email (hashed with the same `email-ref-v1` HMAC, exact match), name substring or user id prefix.
- `counts.total` = the Cloudflare-side user count for Phase 4.
- Not done on purpose: the Phase 2 directory tables still get no writes. Writing them needs a decision: store plaintext email (needed for `students.email`) or keep only refs/masks like the auth tables. Decide before/with Phase 4.


## Phase 4 wipe (prepared 2026-10-17)
- Code: `auth-native/storage/student-wipe.mjs` (+ `student-wipe.test.mjs`), admin route `POST /api/auth/v1/admin/students/wipe` (admin token + Origin; dry run by default; real wipe needs `WIPE-ALL-<users>`).
- Workflow: `.github/workflows/fresh-start-wipe-20261017.yml` -> `scripts/fresh-start-wipe.mjs`.
  - `mode=list`: read-only, exact counts + masked Firebase list (repo is public, so no full emails in logs) + confirm phrase `WIPE-FB<n>-CF<m>`.
  - `mode=wipe`: only if `confirm` equals the phrase for the counts measured in the same run.
- Deletes: Firebase Auth users of admissionsky-997d2 (batchDelete, force); AUTH_AUTHORITY tables except the kept ones; D1 tables that have a user column (content tables kept); KV user prefixes (tok, user, sess, pkid, ustate, profile, chatmem, achat, mem, aiprefs, act, actaudit); R2 user files `<folder>/<user>/<date>/<file>` (not `notify/`).
- Keeps: auth_verification_runtime_config, auth_verification_provider_state, auth_verification_daily_quota, auth_meta, schema_migrations; D1 questions/content_*/global_notifications/ai_cache/ai_experiments; system KV keys (secret:, admin:, backup:, pubContent, ...); R2 backups and notify/ images.
