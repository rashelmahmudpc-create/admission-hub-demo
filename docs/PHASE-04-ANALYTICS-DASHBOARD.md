# Phase 04 — Analytics Dashboard & Smart Insights

Status: complete (2026-09-25) · build `v290-analytics-dashboard-20260925`

## What this phase is

Phases 1–3 collected data. Phase 4 is where the data starts answering questions:
**Raw Data → Meaningful Metrics → Visual Insights → Actionable Decisions.**

```
Firebase Analytics + on-device ledger
        │
        ├── Learning data (daily stats, exams, mistakes, course progress)
        └── Engagement data (events, activity, notification outcomes)
                        │
                        ▼
              analytics-engine.mjs          ← one server-side engine
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
  /api/analytics/me              /api/analytics/*
  (student dashboard)            (admin dashboard)
```

The single most important decision: **there is one engine and one set of metric
math.** Both the student card and the admin view call the same functions over the
same tables. Before this phase the browser computed a learning funnel on its own
(`analytics-service.js#buildLearningInsights`) and the server computed another,
so the two could disagree about the same student. They no longer can.

## The problem before this phase

| Symptom | Cause |
| --- | --- |
| "How is this student doing?" had no server answer | progress lived in the browser only |
| Admin had no engagement number | no DAU/WAU/MAU, no retention |
| Funnel drop-off was a number, not a signal | nothing compared the steps or required a sample |
| Notification performance was a log | sent/opened counts, but no conversion to *learning* |
| Nobody was told anything | metrics existed; meaning did not |

## The design

### `analytics-engine.mjs` — the engine

Pure functions over normalized inputs, plus a thin D1 store and a route handler.
Pure means the same numbers in the test and in production, with no clock or
network in the math.

| Layer | Exports |
| --- | --- |
| Normalization | `normalizeLearning`, `dayKey`, `dayRange`, `shiftDay`, `daysBetween` |
| Metrics | `computeLearningMetrics`, `computeStreak`, `liveStreak` |
| Comparison | `compareValue`, `splitPeriods`, `comparePeriods` |
| Trends | `linearTrend`, `detectTrends`, `summarizeTrends` |
| Segmentation | `SEGMENTS`, `classifyBehaviourSegment`, `classifyLearningStage` |
| Funnel | `FUNNEL_STEPS`, `buildFunnel`, `detectFunnelDropOff` |
| Course/lesson/quiz | `buildCourseAnalytics`, `buildLessonAnalytics`, `buildQuizAnalytics` |
| Engagement | `computeEngagement` (DAU/WAU/MAU, stickiness, returning) |
| Retention | `RETENTION_WINDOWS`, `computeRetention` (D1/D7/D14/D30) |
| Notifications | `computeNotificationAnalytics`, `computeCampaignAnalytics`, `rankCampaigns` |
| Milestones | `MILESTONES`, `computeMilestones` |
| Insights | `buildStudentInsights`, `buildAdminInsights` |
| Access | `AnalyticsStore`, `parseFilters`, `applyFilters`, `handleAnalyticsRequest` |

### The insight engine

An insight is a sentence a person can act on, built from a metric, a threshold
and a sample check. Every insight carries a `kind` (`positive`, `attention`,
`neutral`) and a stable `id`, so the UI can tone it and a test can name it.

Nothing fires on a small sample. `DROPOFF_MIN_SAMPLE = 5` and
`DROPOFF_ALERT_RATE = 0.4` are the same numbers Phase 2 used, so a drop-off alert
means the same thing on both surfaces.

### The funnel

Six steps, counted by distinct students — not by events, which would let one
student inflating a step hide a hundred who left:

```
course_view → course_start → lesson_start → lesson_complete → quiz_start → quiz_complete
```

### Retention

D1/D7/D14/D30 from each student's first active day. A cohort that is not old
enough to have reached a window is **excluded from that window's denominator** —
a student who joined yesterday cannot have returned on D30, and counting them as
a D30 failure would make every new cohort look like a catastrophe.

### Segmentation

Behaviour segment and learning stage are separate facts, because a pro can be at
risk and a beginner can be highly active.

- Behaviour: `new`, `active`, `highly_active`, `returning`, `at_risk`, `inactive`
- Stage: `beginner`, `intermediate`, `pro`

`returning` is derived from the student's own day history (a gap of ≥4 days
followed by a return), not from a caller hint — otherwise the admin view, which
has no hint, could never produce it.

### Access control

| Route | Who | Rule |
| --- | --- | --- |
| `GET /api/analytics/me` | student | session user, always. A `?user=` param is ignored. |
| `POST /api/analytics/events` | student | session user; idempotent on `(user, id)` |
| `GET /api/analytics/*` | admin | `Authorization: Bearer $ADMIN_TOKEN` |
| — | nobody | if `ADMIN_TOKEN` is unset, admin is **closed**, not open |

The admin payload is aggregate only. No per-student row and no user id reaches it
— pinned by a test that serializes the whole payload and asserts a seeded student
id is absent.

### Client: `analytics-dashboard.js`

Renders; does not compute. Two jobs:

1. **Ingest** the on-device learning ledger to the server, once. Only events that
   carry a course/lesson/quiz id are shipped — `app_open` and `screen_view` would
   be cost with no answer, because the daily counters already cover them. Each row
   id is a content hash, so an offline retry after a crash sends the same id and
   the server's `ON CONFLICT` makes it a no-op.
2. **Render** overview → metrics → trend → insights → detail, which is the order
   the brief asks for and the only one that reads well on a phone.

Numbers render in Bengali digits (`Intl.NumberFormat('bn-BD')`); labels are
Bengali. All injected text is escaped.

### Filters

One `parseFilters` + one `applyFilters` for every view: day window (`days`),
`course`, `lesson`, `category`, `segment`, `type`, `platform`. A nonsense `days`
is clamped to `[1, 365]` rather than trusted.

## Tests

`npm run test:analytics` — 120 tests, all named after the guarantee they pin.

| File | Count | Covers |
| --- | --- | --- |
| `analytics-engine.test.mjs` | 71 | the 20 completion guarantees + routes + helpers |
| `analytics-dashboard.test.mjs` | 24 | ingest queue, render, escaping, admin card, fail-soft, auto-boot |
| `analytics-engine-sqlite.test.mjs` | 13 | the engine against real SQLite DDL, including a fresh database |
| `analytics-routes-worker.test.mjs` | 12 | the routes through the worker's real `fetch`, source and bundle |

The dashboard test loads the shipped browser build via the UMD `self` the app
uses — the tested code is the code that ships. The engine unit test uses a
pattern-matched fake D1, so the metric tests exercise the real query shapes with
no network.

Two of the four files exist because the fake D1 is forgiving in a way real SQLite
is not: it returns `[]` for any query it does not recognise, so a read of a table
that does not exist yet passed every unit test and still returned 500 in
production. `analytics-engine-sqlite.test.mjs` runs the real DDL and
`analytics-routes-worker.test.mjs` goes through the worker's `fetch`, which is
where route registration and binding names are actually exercised. When adding a
metric that reads a table this module does not own, add it to the fresh-database
case.

## What this phase deliberately does not do

- **No client-side metric math.** The old browser funnel is not imported into the
  worker and the dashboard does not recompute it.
- **No per-student data in the admin view.** Aggregate only, enforced by test.
- **No new instrumentation.** The ledger and event dictionary are Phase 1's; this
  phase ships them and reads them.

## Files

| File | Change |
| --- | --- |
| `analytics-engine.mjs` | new — engine, store, routes |
| `analytics-dashboard.js` | new — client render + ingest |
| `analytics-engine.test.mjs` | new — 71 tests |
| `analytics-dashboard.test.mjs` | new — 24 tests |
| `analytics-engine-sqlite.test.mjs` | new — 13 tests, real DDL |
| `analytics-routes-worker.test.mjs` | new — 12 tests, worker `fetch`, source + bundle |
| `gk-agent-worker.js` | wire `handleAnalyticsRequest` after `userdata`, before the `/api/*` catch-all |
| `index.html` | mount `analytics-dashboard.js?v=analytics-p4-v1` |
| `sw.js` | add to `APP_SHELL`, build `v290` |
| `dashboard-v2.css` | `.ah-*` styles, mobile-first |
| `package.json` | `test:analytics`, added to `test:production-auth` |

## Verification

- `npm run test:analytics` → 120/120
- `node --test` (full suite) → green
- `npm run test:production-auth` → full chain green
- `npm run check:worker-bundle` → in sync
- `npm run check:sw-manifest` → digests current (24 assets)
