# PHASE 2 — LEARNING & STUDENT BEHAVIOR ANALYTICS

**Status:** In progress — M1 (Learning Instrumentation) complete.
**Module:** `analytics-service.js` + the learning surfaces that emit on the
`admission:activity` bus.
**Depends on:** Phase 1 (`docs/ANALYTICS-FOUNDATION.md`).

Phase 1 built the collection foundation: one choke point (`window.AhAnalytics`),
one event dictionary, one privacy filter, production-only transmission. Phase 2
turns that foundation into an actual picture of *how* students learn — course,
lesson, quiz, practice, search, feature usage, funnel, drop-off, engagement and
retention.

The whole phase is one blueprint with milestone completion records, not twenty
tiny phases.

```
Student Activity → Firebase Analytics → Learning Events → Behavior Signals
      → Funnel + Engagement + Retention → Student / Course Insights
```

---

## 1. Starting point — the honest inventory

An audit of the Phase 1 dictionary against the app found that **23 events were
declared but almost none were emitted**. The dictionary was real; the
instrumentation was not.

- `course_start`, `lesson_view`, `lesson_start`, `lesson_complete`,
  `quiz_start`, `search`, `feature_use`, `feature_complete`, `notification_open`,
  `notification_click`, `ai_message_sent` — **zero dispatch sites**.
- `course_view` and `feature_open` were *derived from the rendered route* in
  `trackRouteContext()`, not from user behaviour.
- `quiz_complete` was the only learning event truly wired, and it arrived from
  the exam engine's `TEST_COMPLETED` bus signal.
- `interactive-course-tool.js` was instrumented first and then **reverted**: the
  `interactive-courses` route is deliberately retired in `index.html` (the
  `removedRoute` list), so that file is dead code. The live course surface is
  `source-course-tool.js` (`source-courses/*`).

That gap is why Phase 2 starts with M1 rather than a dashboard: a dashboard over
events that never fire is a dashboard of zeros.

---

## 2. M1 completion record — Learning Instrumentation

**Goal:** make the declared learning events fire from real user actions, without
adding a single Worker variable and without teaching any module about the
analytics service.

### Design

Emitters never import `analytics-service.js`. They keep dispatching on the
app-wide `admission:activity` bus, exactly as `smart-revision-tool.js` already
did. The service owns the mapping from bus signal to dictionary event.

`analytics-service.js` now holds a `LEARNING_BUS_TYPES` table:

```
COURSE_VIEW      → course_view        QUIZ_START          → quiz_start
COURSE_START     → course_start       SEARCH              → search
LESSON_VIEW      → lesson_view        NOTIFICATION_OPEN   → notification_open
LESSON_START     → lesson_start       NOTIFICATION_CLICK  → notification_click
LESSON_COMPLETE  → lesson_complete    AI_MESSAGE_SENT     → ai_message_sent
```

The bus handler reads `detail.type`, looks up the dictionary event, and passes
the remaining fields through `normalizeEvent`. Because that function snake_cases
every key, an emitter writes `{ type: 'LESSON_COMPLETE', courseId, lessonId }`
and the wire carries `lesson_complete { course_id, lesson_id }`. Unknown bus
types (`DB_WRITE`, `QUESTION_REVIEWED`) are ignored.

The two quiz-completion signals keep an explicit mapping, because their bus
field names differ from the dictionary: `resultId`/`sessionId` → `quiz_id`.
Building them through the generic path would have silently produced `result_id`
and dropped the event's required `quiz_id` — a regression, not a feature.

### What now fires

| Surface | File | Bus signal |
|---|---|---|
| Smart Practice start | `index.html` (`startSmartPractice`) | `QUIZ_START` |
| Exam finish | `index.html` (`recordCompletedExamDaily`) | `TEST_COMPLETED` (now carries `questionCount`, `correct`, `wrong`, `skipped`, `accuracy`, `duration`, `mode`, `testType`) |
| Smart Revision finish | `smart-revision-tool.js` (`finish`) | `REVISION_COMPLETED` (now carries `correct`, `wrong`, `skipped`, `accuracy`, `duration`) |
| Source course open | `source-course-tool.js` (`open`) | `COURSE_VIEW`, `COURSE_START` |
| Course MCQ quiz | `source-course-tool.js` (`renderNativeQuiz`, `renderResult`) | `QUIZ_START`, `TEST_COMPLETED` |
| Question-bank search | `index.html` (`renderQuestionExplorerResults`) | `SEARCH` (scope `question_bank`, with `resultCount`) |
| Notification seen / tapped | `notification-inbox.js` (`renderList`, `__nifTap`) | `NOTIFICATION_OPEN`, `NOTIFICATION_CLICK` |
| AI tutor message | `ai-agent-chat.js` (`send`) | `AI_MESSAGE_SENT` |

The `TEST_COMPLETED` mismatch is worth naming: the Phase 1 handler already read
`questionCount`/`correct`/`wrong`/`accuracy`, but the exam engine never sent
them, so `quiz_complete` left the browser with an id and a score. The emitter
now sends the full summary it already computed.

### Privacy holds

`AI_MESSAGE_SENT` is emitted with **no message text** — the privacy filter would
strip `text`/`message`/`prompt` anyway, but the example is not passed at all.
Search sends the match count, never the query. Notifications send the opaque id.
No new parameter names collide with `FORBIDDEN_PARAM`, and since no new event
name was added, `EVENT_VERSION` stays `ev1` and the 64-variable Worker ceiling is
untouched.

### Verification

`analytics-service.test.mjs` **27/27** (was 22): new tests a23–a27 drive the
**real** bus with a fake DOM and assert that `LESSON_COMPLETE` becomes
`lesson_complete` with snake_case params, an out-of-enum `quizType` is dropped
while the event survives, `TEST_COMPLETED` keeps `quiz_id` and now carries
score/accuracy, `AI_MESSAGE_SENT` never carries text/prompt, and unknown bus
types emit nothing and never throw.

Full suite: `npm run test:native-auth` → **535/535**. Shell build bumped to
`v285-learning-instrumentation-20260925` via `scripts/cache-bump.mjs` +
`npm run sw:manifest` (the service is in `APP_SHELL`).

---

## 3. Remaining milestones

The rest of the blueprint is unchanged and still ahead. Each will land as its
own completion record once the signals below exist to power it.

- **M2 — Course & lesson analytics.** Drop-off, completion, average progress and
  time per course and lesson. Needs a real lesson model on the live course
  surface; `source-course-tool.js` currently has one MCQ set per course, no
  lesson partition, so `lesson_*` cannot yet be derived there.
- **M3 — Quiz & practice analytics.** Score/accuracy/retry/abandonment trends.
  Quiz completion and Smart Practice start are instrumented; per-question and
  time-on-task events still need dictionary entries.
- **M4 — Funnel.** Course View → Start → Lesson Start → Lesson Complete → Quiz
  Start → Quiz Complete. Buildable on M1 events once lesson granularity exists.
  Note that `trackScreen` collapses deep routes to their first segment (pinned by
  test a16), so funnel steps must come from events, not screen names.
- **M5 — Drop-off intelligence.** Detect the unusually steep stage and surface it
  to the admin panel.
- **M6 — Engagement, streak, progress, retention, segmentation, behavioural and
  at-risk signals.** Derived from M1–M5; no new collection where avoidable.
- **M7 — Data quality monitoring.** Expected-event validation (fired? correct
  params? duplicate? missing?) on top of the Phase 1 architecture.
- **Admin panel display.** Parked by the owner: the GA4 numbers will live inside
  the future app admin panel, not a separate dashboard. Requires the Google
  Analytics Data API enabled and a numeric Property ID — neither exists yet.

### Dictionary gaps to close in M2–M4

These are deliberately not added yet — each needs its consumer designed first:

- `course_complete` (only `course_start` exists).
- A per-question event (attempt/reveal) for practice depth.
- Time-on-task (`duration` rides `lesson_complete`/`quiz_complete` but there is
  no standalone study-time event).
- Streak events (a `computeStreak()` exists; nothing emits).

Any new event name requires bumping `EVENT_VERSION` and extending the a1
coverage list in `analytics-service.test.mjs`.
