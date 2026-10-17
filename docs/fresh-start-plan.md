# Fresh Start plan (owner order 2026-10-17)

Keep: Firebase project `admissionsky-997d2` (only project; OTP chain first, Firebase link = last-resort backup, 1000/day).
Goal: delete the old Firebase project, wipe all user data, rebuild a structured user database, private student profiles in the Control Center, old test emails can sign up again.

Rule: "ধাপ X শুরু করো" = permission to merge + deploy that phase. Only Phase 4 (wipe) asks one final yes with exact counts.

## Progress
- [x] Phase 0: inventory (this file, 2026-10-17)
- [x] Phase 1: `email-intro-continue` button -> `beginEmailOwnership` (OTP chain first, Firebase link fallback). sw:manifest. merge + deploy
- [ ] Phase 2: new versioned schema + migrations + tests (students, login_methods, email_verifications, otp_attempts, sessions, devices, profiles, activity_log; normalized unique email)
- [ ] Phase 3: Control Center Students section (list/search, profile, timeline; admin token only, noindex, no secrets)
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
