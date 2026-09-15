# 🎓 Profile System V2 (Phase 7B) — SHIPPED

**Version:** `v258-profile-v2-<MMDD>`
**Date:** 2026-09-16 (Asia/Dhaka)
**Blueprint:** owner "Profile System V2" (27 sections) — approved with reference screens
**Process:** Blueprint → Plan (`PHASE7B-PROFILE-V2-PLAN.md`) → Owner approval → Build ✓

## What shipped

### Chunk 1 — Data (schema v8, additive)
- `auth_profiles` + 3 columns: `admission_session`, `academic_goal`, `subjects`
  (PRAGMA-guarded ALTER migration — existing rows keep working, defaults applied)
- Multi-target ops: `targets` PATCH now accepts an array (≤5, per-target rules
  identical to the existing `target` contract; `targets: null` clears)
- **Completion V2 weights (owner-approved D1, sums to 100):**
  name 15 · dob 10 · mobile 10 · school 5 · higher 5 · targets 15 ·
  session 5 · subjects 10 · goal 15 · bio 5 · avatar 10
  (percent is computed — never stored, never faked; no migration needed)
- **Public v2 allowlist (D2):** public = name, avatar, AH-ID, all targets,
  admission session, goal, bio, completion, joined year.
  NEVER: email, mobile, DOB, school/higher details, subjects, progress.
  Key name is `admissionSession` (protected leak test forbids a `session` key)
- `normalizeProfilePatch` hardened: explicit allowlist — unknown/privileged
  keys (version, email, school, createdAt…) rejected with INVALID_INPUT
- Tests: `profile-v2-core.test.mjs` (14) + protected suite updates (V2 weights)

### Chunk 2 — UI (identity space, emerald)
- **Compact hero:** avatar (camera badge) · name + saved ✓ · AH-ID chip (copy) ·
  "Admission Candidate · <session|year>" · bio · Edit Profile
- **Stats strip (real data only):** Day Streak / MCQs Done / Mock Tests /
  Achievements — computed from existing IndexedDB-backed `CACHE`
  (`computeStreak()`, `examResults`). No data → honest "—", no invented numbers.
- **Completion ring** + gentle copy (`gentle-completion-v1` kept) + "Complete Profile →"
- **Academic Identity card:** Target Universities (multi, add/remove, ≤5) ·
  Admission Session (4-digit year) · Academic Goal (≤160) · Preferred Subjects
  (chips, ≤8) — each a bottom sheet, PATCH with optimistic versioning
- **Your Journey:** Joined → Started Practice → First Mock → First Achievement →
  Admission Ready (completion=100). **Real data only; locked = honest, no fakes**
- **Achievements:** First Mock / 100 MCQs / 7 Day Streak / 500 MCQs —
  display-only, earned/locked states, **no XP, no reward engine** (D5)
- **Preferences (D3):** explicit local-first store `ah-profile-prefs-v1`
  (language/notifications/appearance/aiAssistant/avatarStyle) — user-controlled;
  Phase 8's Personalization Engine will consume it. Unavailable options
  (English UI, Dark mode) shown **disabled with "শীঘ্রই আসছে"** — never faked
- **Edit Profile page:** photo, Full Name*, Mobile (✓ Saved chip), DOB, Bio
  (0/280 counter) → Save Changes (Editing→Validating→Saving→Success).
  No email row — email is auth-managed and not client-readable (honest)
- **Change Avatar page:** Upload / Camera (getUserMedia) / Default (6 generated
  SVG styles, zero-raster). Upload pipeline unchanged (downscale ≤512, ≤2MB JPEG)
- **Privacy & Visibility:** Public Profile switch + 3-tier sheet (private/
  limited/public) + link copy; private-fields guarantee restated in-sheet
- **Account card** (from the launcher-removal hotfix) remains the single
  account entry; guest = Sign In prompt
- Visual: emerald `#0f6b4f` family, warm white, deep charcoal — indigo removed;
  no glassmorphism/neon/giant shadows; 320px + reduced-motion safe

## Anti-chaos (Trigger / Reason / Priority / Expected / Fallback)
| Behavior | Trigger | Reason / Priority | Expected | Fallback |
|---|---|---|---|---|
| Skeleton | profile fetch in flight | P1 first paint | 3 shimmer blocks | on error → `pp-fallback` + retry (session untouched) |
| Stats "—" | `CACHE` not ready | honest data | no numbers invented | after boot, real numbers render |
| Locked milestone/achievement | condition not met | no fake progress | gray, "—" date | unlock automatically from real data |
| English/Dark options | infra not ready | no fake feature | disabled + note | enable in Phase 8 |
| PATCH 409 | concurrent edit | optimistic lock | inline conflict msg | auto-reload profile |
| PATCH 429 | rate limit | abuse guard | "একটু পরে" msg | no retry storm |
| Camera unavailable | no getUserMedia/permission | device reality | inline guidance | Upload tab still works |
| Preferences storage blocked | private mode | browser reality | session-only prefs | no crash, no retry loop |

## Protected (unchanged)
- Identity/Session/Security cores, AH-ID scheme, avatar D1 pipeline
  (magic-byte jpeg/png), public projection authz, DO auth authority
- `profileContext` (frozen 7B-7) — V2 extends data, not context
- All prior protected tests: 390/390 green incl. `native-auth-protection`,
  `profile-core`, `profile-v2-core`, `profile-ui`

## Rollback
- Client: revert Pages deployment (previous deploy URL kept by CF)
- Worker: `wrangler deployments rollback <id>` (schema v8 is additive —
  old client works with new columns; new client needs new worker)
- Local prefs: clear `ah-profile-prefs-v1` from localStorage

## Explicitly OUT (Phase 8 / later)
Adaptive dashboard ordering, behavior-signal inference, AI context bridge
wiring, reward/XP engine, cross-device sync (contract stubbed only).
