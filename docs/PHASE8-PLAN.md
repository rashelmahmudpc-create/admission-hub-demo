# 🎓 Phase 8 — Personalization + Smart Navigation Engine · PLAN

**Status:** ⏸ AWAITING OWNER APPROVAL
**Date:** 2026-09-15 (Asia/Dhaka) · Agent: Arena Agent Mode
**Version target:** `v258-personalization-<MMDD>`
**Blueprint:** Phase 8 master engineering blueprint (owner-supplied, 45 sections)

## Owner decisions (PROPOSED — approve / amend before implementation)

1. **Storage: device-local first (IndexedDB), no server writes in Phase 8.**
   All learning data (exams, mistakes, progress, activity) already lives on the
   device — personalization state lives beside it, in the same protected
   IndexedDB under the same `DATA_SCOPE` isolation. A `syncBridge` interface is
   built (and tested) but **not wired to the DO** — server sync becomes a
   later, separately-approved step. *Reason: offline-first app; blueprint
   §26 requires offline personalization; zero new write path into the
   protected AUTH_AUTHORITY DO.*
2. **Preference + control UI lives in the Profile tab (👤)** — a
   "Personalization" card with master ON/OFF, level indicator, granular
   toggles, and Reset. *Reason: Profile is the user-identity surface
   (owner's Phase 7 decision #4); Settings currently routes to dashboard.*
3. **Default level at launch = Level 2 (academic-aware).** Uses only the
   user's own local exam/progress data, every item explainable ("কেন দেখাচ্ছি"
   one-liner). Level 0/1 available via toggle; Level 3+ (behavior-aware)
   OFF by default until the user enables it. *Reason: data-driven from day
   one, but no inference from raw behavior without explicit opt-in.*
4. **AI Context Bridge: built in Phase 8 (Chunk 5)** — sanitized
   context package on the existing AI request path (`context:` field),
   permission-filtered. AI remains non-authoritative (blueprint §20-§21).
5. **Blueprint §42.5 "inspect Supabase schema" = template residue.**
   This repository has no Supabase. Authoritative data contracts:
   IndexedDB `STORES` (device) + DO SQLite v7 (identity/profile core) +
   D1 `avatars`. Confirmed by inspection 2026-09-15.
6. **Phase 7 `profileContext` (server, profile-page-only) is FROZEN.**
   Phase 8's Context Engine is a separate, client-side, app-wide engine.
   It MAY consume profile data read-only; it does not replace or touch the
   Profile Core.
7. **Release: same protected pattern as v257** — 5 chunks (build→test→
   commit→push each), full P3–P7 regression hard gate, owner-protected
   publish, report, STOP.

---

## 0. Audit findings (what already exists → Phase 8 treatment)

| Existing | Where | Treatment |
|---|---|---|
| IndexedDB `STORES` (20 stores, `activityLogs` included) + `CACHE` + memory fallback | `index.html` | **Extend** with 3 new stores: `personalizationState`, `personalizationSignals`, `personalizationHistory` (same scoped-ID pattern, same migrations chain) |
| `AdmissionDataProtection` + `DATA_SCOPE` scoping (`scopedRecordId`) | `data-protection.js` | **Reuse** — personalization records are scope-locked exactly like the rest |
| `getSmartFocusTopics()` (topic accuracy + mistake density) | `index.html:1168` | **Consume** via Academic Context adapter (read-only; function untouched) |
| `computeLifetimeStats`, `computeStreak`, `todayPerformance`, DSTATS | `index.html` / `dashboard-v2.js` | **Consume** via Progress adapter |
| `CACHE.examResults` (with per-question `snapshot`), `CACHE.mistakes` (`wrongCount`), `CACHE.notes` | IndexedDB | **Consume** — weak/strong areas, post-exam context |
| Phase 7 `profileContext` (server, profile page) | `auth-engine.mjs` | **Frozen** (owner decision #6); profile data consumed read-only |
| AI agent request path `context: {mode, stats: localStats()}` | `ai-agent-chat.js:751` | **Extend** — the AI Context Bridge plugs in here; `localStats` reused as stats source |
| Dashboard card modules (mission, target, smart focus, streak) | `dashboard-v2.js` | **Extend** — stable sections stay; dynamic priority section inserted (progressive, non-blocking) |
| Bottom nav (6 stable tabs, `NAV_TABS`) | `index.html` | **Stable** — badges/indicators only; no reorder (blueprint §12) |
| `notifications` store + NotificationHub | IndexedDB / dashboard | **Consume** for reminder-type preferences; notification delivery untouched |
| `activityLogs` store (currently: import tracking, streak days) | IndexedDB | **Reuse** as the signal substrate — no new tracking pixels; only the §8 meaningful-signal list |

**Boundaries respected (frozen, from Phases 3–7 protection docs):**
Authentication, Identity, Session, Security cores; Profile Core (incl.
visibility allowlist + public ID scheme); Exam scoring; Exam Engine
internals; zero-raster rule; no credentials in web storage; Telegram/
external services out of scope.

---

## 1. Architecture (blueprint §2, §20)

```
Identity (who)          →  Session/Security (authority)      [PROTECTED, untouched]
Profile (shared facts)  →  DO SQLite v7 / local profile view [PROTECTED, untouched]
Academic data           →  Exam/Progress/Mistake/Profile engines [READ-ONLY adapters]
            ↓
   Academic Context Engine (normalized, no duplication)
            ↓
   Behavior Signal Engine (§8 allowlist only, quality tiered §9)
            ↓
   Preference Engine (explicit user choices = top authority §5-§6)
            ↓
   Context Engine (app-wide state, priority §10-§11)
            ↓
   Personalization Core (priority score §15, repetition control §16,
                         explainability §18, levels §19, versioned policy §35)
            ↓
   ┌──────────────┬──────────────────┬────────────────────┐
   ↓              ↓                  ↓                    ↓
 Navigation     Dashboard        Recommendations      AI Context Bridge
 (badges/       (stable +        (foundation,          (sanitized package;
  shortcuts)     dynamic)         explainable)          AI never authoritative)
```

**Non-negotiable:** no UI component computes personalization from raw data —
everything flows through the Personalization Core (single decision point).
Failure anywhere → `DEFAULT_STABLE_EXPERIENCE` fallback (§27, §28).

### Module layout (new, code-native, zero dependencies)

```
personalization/
  personalization-core.mjs     — engine, state machine (§4), policy version (§35),
                                 explainability records (§18, §36), reset/pause (§34)
  personalization-store.mjs    — IndexedDB stores + scoped records + snapshot cache
                                 (§24: LIVE/RECENT/CACHED/STALE/UNKNOWN), corrupt-cache
                                 recovery
  context-engine.mjs           — app context + priority chain (§10-§11)
  preference-engine.mjs        — explicit prefs (value/source/updatedAt/version),
                                 override rule §6
  signal-engine.mjs            — §8 allowlist, §9 quality tiers, idempotent events (§25)
  recommendation-engine.mjs    — categories §17, priority formula §15,
                                 repetition control §16, empty states §33
  ai-context-bridge.mjs        — permission filter → context builder → sanitization
                                 (§20); AI MUST-NOT list enforced by construction (§21)
  adapters/
    progress-adapter.mjs       — consumes computeLifetimeStats/streak/DSTATS
    exam-adapter.mjs           — consumes CACHE.examResults snapshots
    mistake-adapter.mjs        — consumes CACHE.mistakes
    profile-adapter.mjs        — consumes Phase 7 profile view (read-only, optional)
    activity-adapter.mjs       — consumes activityLogs + dashboard tool usage
personalization-ui.js          — Profile-tab control card, dashboard dynamic section,
                                 nav badges, "why am I seeing this?" sheet, empty states
personalization.css
```

All engines are pure/deterministic where possible (injectable `now`, seeded
ordering) → fully unit-testable without DOM.

---

## 2. Chunk plan (build → test → commit → push per chunk)

### Chunk 1 — Personalization Core + Store + Preference Engine
- 3 new IndexedDB stores (schema migration v11, additive, idempotent,
  memory-mode compatible) + scoped records + corrupt-cache recovery test
- `PersonalizationEngine` with the 10 core APIs (§3) + state machine (§4)
  (INITIALIZING/LOADING/READY/UPDATING/PAUSED/OFFLINE/STALE/ERROR) —
  never blocks UI; `getPersonalizedDashboard()` must resolve with default
  order on any failure
- Preference Engine: CRUD with `value/source/updatedAt/version`, override
  rule (§6: user choice is sticky until explicit reset), policy versioning
  (§35)
- Events: idempotent `preference.updated` (§25)
- Tests: `personalization-core.test.mjs` (~20 tests incl. corrupt cache,
  duplicate events, memory-mode fallback, reset semantics §34 — academic
  data never reset)

### Chunk 2 — Academic Context + Signal Engine
- 5 read-only adapters (progress/exam/mistake/profile/activity) — single
  source rule (§7): adapters never write, never recompute what engines
  already compute (weak topics come from `getSmartFocusTopics()`)
- Academic Context normalization: targets/units/weak+strong areas/recent
  performance/revision status — one object, no duplication
- Signal Engine: §8 allowlist only (EXAM_COMPLETED, QUESTION_ATTEMPTED,
  MISTAKE_REVIEWED, TOPIC_COMPLETED, PROFILE_UPDATED, DASHBOARD_TOOL_USED,
  …), quality tiers LOW→VERIFIED (§9), no click-soup tracking (§23 data
  minimization)
- Tests: `personalization-context.test.mjs` (~18 tests: empty data, large
  history, multi-goal §31, adapter failure isolation, signal quality
  escalation LOW→HIGH→VERIFIED)

### Chunk 3 — Context Engine + Priority + Recommendations
- App context state machine: FIRST_SESSION / RETURNING_USER /
  ACTIVE_STUDY_SESSION / POST_EXAM / POST_MISTAKE_REVIEW / REVISION_MODE /
  LOW_ACTIVITY_PERIOD / HIGH_ACTIVITY_PERIOD (§10) with the §11 priority
  chain (Critical Academic > Immediate Action > Recent Result > Current
  Goal > Long-Term Preference > Generic)
- Smart Priority Engine: documented score formula (§15) — deterministic,
  no randomization; every score traceable (§36 audit record: trigger,
  reason, signals, rule, timestamp)
- Recommendation Engine foundation: Academic/Performance/Exam categories
  (§17), explanation strings in simple Bengali (§18 — no creepy copy),
  repetition control with shown/clicked/dismissed/completed tracking
  (§16, dismissal lowers priority), smart empty states (§33)
- Conflict resolution order §32 (Security > Explicit User Choice > Current
  Intent > Academic Importance > Long-Term Preference > Generic)
- Tests: `personalization-recommend.test.mjs` (~22 tests: context
  transitions, priority ties, repetition decay, dismissal loop, explain
  string presence for every emitted item)

### Chunk 4 — Smart Navigation + Dashboard + Control UI
- **Navigation (stable core guaranteed §12, §29):** badges + contextual
  quick-destination chip (e.g. post-exam → "Review mistakes" chip above the
  nav) — tabs never reorder, never disappear; back/deep-link/refresh safe
- **Dashboard:** stable sections unchanged; ONE dynamic priority section
  (max 3 items) rendered as progressive enhancement — dashboard paint
  happens first, personalization fills in (< 100 ms local); skeleton →
  content with no layout jump (visual QA §39)
- **Profile tab → Personalization card:** master ON/OFF, current level
  badge, granular toggles (§22: academic activity / preferences /
  recommendation history / AI), Reset Personalization (confirm sheet,
  §34 semantics), "কেন?" explanation sheet for any dynamic item
- **Quick actions:** context-prioritized, permanent tools never hidden
  (§13)
- Anti-chaos table in code comments: every dynamic behavior ships with
  Trigger/Reason/Priority/Expected/Fallback (§40)
- Tests: `personalization-ui.test.mjs` (static contract + behavior: nav
  stability, fallback on engine crash, no blocking, reduced-motion, 320px)

### Chunk 5 — AI Bridge + Offline/Chaos + Docs + Release prep
- AI Context Bridge: permission filter (visibility-aware — private profile
  fields never enter the package), context builder (sanitized: no
  email/phone/internal refs), attaches to the existing `context:` field;
  §21 MUST-NOT enforced structurally (bridge exposes read-only views only)
- Offline mode (§26): full preference + context + recommendation path on
  local data; online-only features (none at launch) degrade gracefully;
  snapshot status LIVE/RECENT/CACHED/STALE/UNKNOWN surfaced honestly (§24)
- Chaos suite: duplicate/out-of-order events, concurrent preference
  writes, slow DB, corrupt cache, offline→online, rapid toggling (§38) —
  core app must stay functional in every scenario
- Docs: `docs/PHASE8-PERSONALIZATION.md` (architecture, protection rules,
  anti-chaos table, release/rollback runbook); SCALING-PLAN note if any
  storage growth (local only → none expected)
- Version bump `v258-personalization-<MMDD>` (index.html, sw.js, pinned
  tests, canary workflow, dist mirror) — same pattern as v257
- Full gate: `test:production-auth` (381+) + new personalization suites +
  identity + session + bundle check; **P3–P7 regression hard gate**
  (blueprint §44)
- Push, then owner-protected publish (same pattern as v257), live
  verification, report, **STOP** (no Phase 9 auto-start)

---

## 3. Testing matrix coverage (blueprint §37-§39)

| Blueprint area | Where covered |
|---|---|
| Functional personas (new/returning/active/inactive/multi-goal/no-data/large-history) | Chunk 2+3 unit tests (personas as fixtures) |
| Preference change/override/dismissal/context change/recalc/reset | Chunks 1+3 |
| Failure (network/db/progress/profile/AI/corrupt cache) | Chunks 1+5 chaos suite |
| Security (unauthorized pref update, cross-user access, manipulated signal, client priority manipulation) | Store scope-lock tests (DATA_SCOPE), server-side N/A (local-first), signal provenance checks, priority computed only in Core (UI can't inject scores) |
| Chaos (duplicate/out-of-order events, concurrent updates, offline→online) | Chunk 5 |
| Visual QA (devices, no jump/flash/clutter) | Chunk 4 contract tests + reduced-motion + 320px assertions |

## 4. Release + rollback (same pattern as v257)

- Owner-protected publish via wrangler (Pages + worker if worker changes —
  Phase 8 is **client-side only** at launch, so likely Pages-only deploy;
  worker untouched unless owner approves sync wiring)
- Rollback: previous Pages deployment (one click) + previous worker version
  unchanged
- Schema: IndexedDB migration v11 additive only → no data rollback needed

## 5. Risks

| Risk | Mitigation |
|---|---|
| Dashboard becomes slow/animating | Personalization strictly post-paint, memoized, snapshot-cached; visual QA asserts no layout jump |
| Creepy/unpredictable feel | Deterministic scoring, explanations everywhere, user override sticky, default L2 (own-data only) |
| Scope creep into AI behavior | Bridge is read-only context packaging; no new AI flows |
| Local-first state lost on device change | Acceptable at launch (same as all learning data); sync = later approved step |
| Cross-user data bleed | Same `DATA_SCOPE` isolation as existing stores + explicit tests |

---

**Plan complete — STOP. Awaiting owner approval (or amendments) before
implementation begins.**
