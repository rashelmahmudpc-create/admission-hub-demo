# 🎓 Profile System V2 (Phase 7B) · IMPLEMENTATION PLAN

**Status:** ⏸ AWAITING OWNER APPROVAL
**Date:** 2026-09-16 (Asia/Dhaka)
**Blueprint:** owner-supplied "Profile System V2" blueprint (27 sections), 2026-09-16
**Process (owner directive, 2026-09-16):** Blueprint → Plan → Approval → Build.
No straight-to-UI. Every dynamic behavior ships with
Trigger / Reason / Priority / Expected / Fallback (anti-chaos table in code).
**Version target:** `v258-profile-v2-<MMDD>`

## 0. What Phase 7 already delivered (foundation V2 builds on)

| V2 blueprint need | Phase 7 status |
|---|---|
| Permanent identity ID (`AH-XXXXXX`) | ✅ Done — base-31, stored once, never reassigned (protected) |
| Avatar upload / default / remove | ✅ Done — D1 store, magic-byte validation, generated SVG default (zero-raster) |
| Privacy (public/limited/private) + public URL | ✅ Done — allowlist boundary, `/AH-XXXXXX` page, suspension-aware |
| Name / mobile / bio / targets (array in storage) | ✅ Done — PATCH + optimistic versioning + validators |
| Completion | ✅ Done (weights differ from V2 — see decision D1) |
| Profile context (greeting/section order) | ✅ Done — server-side, frozen (owner decision 7B-7) |
| Account security entry (Log Out/Passkey/Devices) | ✅ Just moved into Profile tab (launcher pill removed, 2026-09-16) |

**V2 = experience + architecture rebuild on top of this core. No re-creation
of identity/ID/avatar/privacy mechanisms — only extend.**

## 1. Owner decisions (PROPOSED — approve / amend)

1. **Completion weights — superset of the V2 table.** V2's table drops
   school/higher-institution (onboarding data), which would make a fully
   onboarded student score less than a blank one. Proposed (sums to 100):
   Name 15 · DOB 10 · Mobile 10 · School 5 · Higher 5 · Avatar 10 ·
   Academic goal 15 · Target universities 15 · Subjects 10 · Session 5 ·
   Bio 5 · Preferences 5. Percent is always computed from real fields —
   never faked.
2. **Public profile v2 allowlist (beyond current name/avatar):**
   public adds → all target universities, admission session, academic goal,
   bio, completion band, joined year, **achievements (honest, earned only)**.
   NEVER public: email, mobile, DOB, school/higher detail, subjects
   preference detail, progress stats, AI conversations. *(If you want
   subjects public too, say so.)*
3. **Preferences in 7B:** build the **explicit-preference store + UI**
   (language bn/en, notifications on/off, appearance) as user-controlled
   local-first data with server sync contract stub. Phase 8's
   Personalization Engine **consumes** this store — it does not reinvent it.
4. **Sequencing with Phase 8:** **7B (Profile V2) first, then Phase 8**
   (the already-drafted personalization plan becomes the consumer of the V2
   data model). Alternative: merge into one mega-phase (not recommended —
   smaller protected publishes).
5. **Journey + Achievements scope:** display-only, computed from real
   existing data (first practice, first mock, streaks, mistakes reviewed,
   100/500 MCQs). Locked = "not yet reached". **No reward engine, no XP,
   no fake states** (respects the Phase 8 "Reward Engine out of scope" line
   and the no-fake rule).
6. **Academic additions = schema v8 (additive, PRAGMA-guarded):**
   `admission_session TEXT` (e.g. '2026'), `subjects TEXT DEFAULT '[]'`
   (preferred subjects), both in `auth_profiles`. Multiple targets already
   fit the existing `targets` JSON column (UI currently shows only the
   first — V2 shows all with add/remove).
7. **Frozen (protected, unchanged):** Identity/Session/Security cores,
   AH-ID scheme, avatar pipeline, DO auth authority, email (read-only
   "Verified ✓", never editable in profile), zero-raster, no credentials in
   web storage. `profileContext` (Phase 7 server) stays as-is.
8. **Visual language:** emerald/mint app identity (existing `--emerald`
   family, warm white, deep charcoal) — the profile's current indigo tint
   is restyled to the app palette. No glassmorphism, no neon, no giant
   shadows.

## 2. Target page architecture (blueprint §02)

```
Profile (header: "Profile — Your identity & journey")
├── HERO (compact)  Avatar · Name(or "নাম যোগ করো") · AH-ID chip
│   · identity line "Admission Candidate · 2026" · [Edit Profile →]
├── ACADEMIC IDENTITY  Session · Targets (multi, add/remove) ·
│   Preferred subjects · Academic goal ("Set a goal →" CTA when empty)
├── JOURNEY  Joined → Started Practice → First Mock → First Achievement
│   → Admission Ready (honest milestones; future-ready slots)
├── ACHIEVEMENTS  earned + locked (display-only, real data only)
├── COMPLETION  % + bar + "Complete Profile →" (gentle copy, never pressure)
├── PRIVACY & VISIBILITY  public toggle + what's-shared explainer
├── PREFERENCES  language · notifications · appearance (explicit controls)
├── PERSONAL INFO  name/mobile/DOB/bio/avatar — per-field status + Edit
└── ACCOUNT  Security · Passkey · Devices · Log Out (existing account page)
```

Desktop: centered single column (max 520px). Mobile: full width, safe-area,
one-hand thumb reach. One screen, progressive reveal — not a card mountain:
hero first paint, sections hydrate below (skeleton → identity → academic →
journey), no full-page spinner.

## 3. Data contract (schema v8 + local preferences)

```
auth_profiles (DO SQLite, additive v8):
  admission_session TEXT DEFAULT ''        -- e.g. '2026'
  subjects          TEXT DEFAULT '[]'      -- ["Bengali","English","Physics"]
  (existing: full_name, date_of_birth, mobile, bio, targets[],
   school_*, higher_*, visibility, profile_version, created_at, updated_at)

preferences (local-first, new IndexedDB store 'profilePreferences',
  DATA_SCOPE-locked like Phase 8 plan):
  { language: 'bn'|'en', notifications: 'on'|'off',
    appearance: 'light'|'dark'|'system', v: 1, updatedAt }
  -- server sync contract stubbed, not wired (same pattern as Phase 8 plan)
```

Edit flow (blueprint §15): tap field → bottom sheet → Editing →
Validating → Saving → Success toast (no modal popups). Errors are inline
per field. Session-expired / unauthorized / network / invalid-name /
invalid-mobile / upload-failed / image-too-large all have explicit states
(§17) — never a blank page, never a fake success.

## 4. Chunks (build → test → commit → push each)

- **Chunk 1 — schema v8 + engine fields + validators**
  `admission_session`, `subjects[]`, multi-target ops (add/remove/reorder),
  validation (session year 1990–2100, subject strings ≤40, ≤8 subjects,
  targets ≤5, name/unit/year per target). Public allowlist v2 per D2.
  Memory + SQLite repos. Tests: `profile-v2-core.test.mjs` (~18).
- **Chunk 2 — Profile V2 UI rebuild**
  Compact hero + identity line, emerald restyle, Personal Info section with
  per-field status chips, Academic Identity (multi-target picker, session,
  subjects, goal CTA), edit flow states, empty states (§16), progressive
  loading (§18), completion v2 (D1 weights) with "Complete Profile →".
  `profile-ui-v2.test.mjs` contract + behavior tests (~16).
- **Chunk 3 — Journey + Achievements + Public v2**
  Honest milestones from real local data (first attempt, first completed
  mock, streak ≥7, mistakes reviewed, 100/500 MCQ) — no fakes; locked
  states explicit. Public page v2 (D2 allowlist incl. achievements).
  Tests (~14) incl. "no data → honest empty, no fake milestone".
- **Chunk 4 — Preferences**
  `profilePreferences` store (scoped, versioned, corrupt-recovery), UI card
  (language/notifications/appearance), language preference wired to UI
  strings where a bn/en toggle already exists (else stored for Phase 8),
  appearance preference honored if a theme hook exists (else stored).
  Tests (~12).
- **Chunk 5 — Docs + release**
  `docs/PHASE7B-PROFILE-V2.md` (architecture, anti-chaos table, protection,
  rollback), version bump `v258-profile-v2-<MMDD>` (all pinned files +
  dist mirror), full gate (383+ new suites + P3–P7 regression hard gate),
  push, **owner-protected publish**, live verify, report, **STOP**.

## 5. Testing matrix (per blueprint §17/§19 + standing gates)

- Functional: empty profile / partial / full, multi-target, large history,
  guest (no account) vs signed-in
- Failure: network off, DB unavailable, session expired mid-edit, corrupt
  preferences cache, duplicate PATCH (409 path), upload oversize/invalid
- Security: cross-scope preference read (DATA_SCOPE), public allowlist
  re-assertion, client cannot inject server fields
- Visual: 320px, iPhone Pro Max, tablet, desktop centering, reduced-motion,
  no layout jump, no horizontal scroll
- Regression: `test:production-auth` (383) + identity + session + bundle

## 6. Risks

| Risk | Mitigation |
|---|---|
| Scope creep into Phase 8 (personalization behavior) | 7B stores prefs + displays; no adaptive reordering (that's Phase 8) |
| V2 UI rewrite touches protected dashboard/account flows | Only profile page + its CSS; account page opened via existing `AdmissionAccount.open()` |
| Completion weight change shifts stored percent | Percent is computed, not stored — no migration of data |
| Subjects/session public leakage | Allowlist re-asserted by existing public-projection tests (v2) |

## 7. Explicitly OUT of scope (Phase 8+ or later)

Adaptive dashboard ordering, behavior-signal inference, AI context bridge
wiring, reward/XP engine, autonomous agent, cross-device preference sync
(contract stubbed only).

---

**Plan complete — STOP. Awaiting owner approval (or amendments) before
implementation begins.**
