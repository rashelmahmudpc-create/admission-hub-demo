# 🔒 Profile V2 — STRICT REBUILD: AUDIT + ARCHITECTURE MAP

**Date:** 2026-09-16 · **Owner master prompt:** 40-section strict rebuild contract
**Principle:** One student, one identity, one source of truth, one consistent Profile.

## 01 — CURRENT SYSTEM AUDIT (findings)

| Data | Where it lives | Source of truth |
|---|---|---|
| Canonical identity (email, status, created_at) | `auth_users` (DO SQLite) via auth engine | **Server (DO)** |
| Canonical profile (name, DOB, mobile, bio, school, college, targets, session, goal, subjects, visibility) | `auth_profiles` (same DO) | **Server (DO)** |
| Avatar | `avatars` table in D1 (`PROFILE_DB`), keyed by subject ref | **Server (D1)** |
| Study data (exam results, streak, mistakes, vocab) | IndexedDB stores (`examResults`, `mistakes`, …) in `CACHE` | **Local (by design)** |
| Dashboard header | Reads `CACHE` (local) — **does not display the user's name** (no local user store exists) | — |
| Local app state | `session-persist.js` (route/scroll only), prefs `ah-profile-prefs-v1` | Local (explicit prefs only) |

**Audit verdict on the §02 "blank profile" bug:**
- There is **exactly one profile store** — the server `auth_profiles`. No duplicate
  local profile database exists (no `user` key in CACHE, no profile localStorage).
- **New signups DO write the profile server-side:** signup step 1 (Personal)
  collects name + DOB, step 2 (Education) collects school + college →
  `collectProfile()` → `POST /api/auth/v1/profile/pending` (during signup) →
  `POST /api/auth/v1/profile` (full, after account ready).
- **Gap found & fixed now:** the signup flow never collected **Mobile** — and the
  full-save server validator dropped it. Fixed: mobile field added to signup
  personal step; `normalizeOnboardingProfile` accepts `mobile` (same rules as PATCH).
- **Legacy accounts** (created before the profile core) have an empty provisioned
  row. Their signup data was never written to the server by the old flow — there is
  no local copy to backfill from. Honest handling: the Profile Edit flow populates
  it; the system never injects fake data. (Verified: no local profile store exists
  anywhere in the repo.)
- **Save flow already persists** (PATCH → server confirm → state update → re-render);
  this rebuild adds the visible state machine (SAVE → SAVING… → SUCCESS ✓ / FAILED →
  Try Again) and the mandatory reload/login persistence tests.

## 02 — Data flow (locked)

```
SIGN UP (name, mobile, DOB, school, college)
  → VALIDATE (client + normalizeOnboardingProfile)
  → CREATE USER (auth engine)
  → SAVE PROFILE (POST /profile/pending → /profile)
  → PERSIST (DO SQLite auth_profiles)
  → AUTH SESSION
  → PROFILE LOAD (GET /profile v2)
  → DISPLAY SAME DATA
```
Profile UI reads ONLY the server profile. Local `ah-profile-prefs-v1` holds
explicit preferences only (language/notifications/appearance/aiAssistant/avatarStyle).

## 03 — UI rebuild (reference-matched)

- Hero: light mint card (dark text), emerald ring avatar + camera badge,
  AH-ID chip, "Admission Candidate · <session|year>", bio, emerald Edit Profile.
- Stats strip: real data from CACHE (0 when none) — streak/MCQs/mocks/achievements.
- Completion ring: dynamic %, gentle copy, "Complete Profile →".
- Academic Identity card → **dedicated edit page** (targets multi, session, goal,
  subjects) with single Save Changes.
- Journey: real milestones only; locked = honest.
- Achievements (real data): First Mock · 100 MCQs · 7 Day Streak · 500 MCQs ·
  Mistake Crusher (mastered ≥5). Top-10% style rankings NOT faked (no leaderboard
  exists). Empty state: "প্রথম achievement-এর জন্য প্রস্তুত?"
- Preferences: explicit tappable rows (English/Dark marked "শীঘ্রই আসছে" — honest).
- Privacy & Visibility: working Public toggle + 3-tier sheet + link copy.
- Account card: single account entry (launcher pill removed by owner directive).
- Guest: no fake identity — placeholder, "Guest Profile", Login + Create Account,
  benefits checklist.
- Edit Profile page: photo, name, mobile, DOB, bio + save state machine.
- Visual: 16px content padding, 4/8/12/16/20/24 spacing scale, emerald identity,
  white cards, subtle borders, no visible scrollbar (scroll stays functional),
  safe-area aware, 320px safe, no horizontal scroll.

## 04 — Protected (untouched)

Identity/Session/Security cores, AH-ID, avatar D1 pipeline, public projection
authz + allowlist, `profileContext` freeze, bottom nav, AI (guest = no private
context — AI reads server profile/context, unchanged).
