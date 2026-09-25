# PHASE 2 — LEARNING & STUDENT BEHAVIOR ANALYTICS

**Status:** In progress — M1 (Learning Instrumentation), M2 (Course & Lesson
Analytics) and M3 (Quiz & Practice Analytics) complete.
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

## 3. M2 + M3 completion record — Course/Lesson and Quiz/Practice depth

**Goal:** the two granularity gaps M1 left open — real per-lesson signals on the
live course surface, and per-question depth for every quiz mode.

### A live regression found and fixed on the way

M1's audit assumed `source-course-tool.js` had "one MCQ set per course, no
lesson partition". That was wrong on both counts, and looking properly surfaced
a **production outage**:

- The supplied course HTML *does* have real lessons —
  `section.lesson-sec#lessonN` plus the source's own "পড়া শেষ ✓" buttons
  (`button.done-btn[data-lesson]`). Sandhi has 8, prottoy 10, somas 13.
- `loadSource()` concatenated **every** `<script>` block into the payload and ran
  it through `new Function()`. The SEO commit (`24f6ade`) added a
  `<script type="application/ld+json">` block, so the concatenation became
  `{"@context":...}` + real JS → `SyntaxError: Unexpected token ':'` → **no course
  opened at all** on the live site. Confirmed in a headless browser against
  `admissionhub.pages.dev` before fixing.

The fix filters to executable script types only
(`''`/`text/javascript`/`application/javascript`/`module`), so the JSON-LD SEO
block is skipped. `source-course-lessons.test.mjs` m2-3…m2-5 fail if a non-JS
script ever gets concatenated again.

### Per-lesson instrumentation (M2)

`installLessonTracking(host)` in `source-course-tool.js` never re-implements
completion. It mirrors the source's own UI:

- An `IntersectionObserver` on each `section.lesson-sec` fires
  `LESSON_VIEW` + `LESSON_START` once per lesson, the first time it is scrolled
  into view. No observer (old browser / test DOM) falls back to counting all
  lessons as viewed.
- A delegated `click` listener on the host reads `button.done-btn[data-lesson]`
  after the source's own handler toggles `.on`, and fires `LESSON_COMPLETE`
  with `lesson_number`, `completion_percent: 100` and a `duration` (seconds since
  the lesson was first seen).
- When every `.done-btn` is `.on`, it fires `COURSE_COMPLETE` once
  (`lesson_count`, `completion_percent: 100`).
- Un-marking a lesson does not re-emit; a second full-pass does not re-fire
  `course_complete`.

### Per-question instrumentation (M3)

`index.html` now dispatches `QUESTION_ATTEMPT` from `selectMockAnswer` and
`selectFlashAnswer`. The exam `id` is the `quiz_id`, so attempts join their
`quiz_complete` row. The event carries `correct`, `duration` (seconds from the
existing `timing[questionId]`), `question_number`, `subject_id`, `topic_id` and
`mode`. It is repeatable (`once: false`) and is emitted only when an answer is
actually committed — re-clicking to clear an answer does not fire.

### Dictionary + dedupe changes

Two new events were added, so `EVENT_VERSION` moves to `ev2`
(`MAX_QUEUE` 200 → 400 to hold the higher event volume offline):

| Event | Required | Optional |
|---|---|---|
| `course_complete` | `course_id` | `course_type`, `lesson_count`, `completion_percent` |
| `question_attempt` | `quiz_id`, `question_id` | `quiz_type`, `correct`, `duration`, `question_number`, `subject_id`, `topic_id`, `attempt_no`, `mode` |

`LEARNING_BUS_TYPES` gained `COURSE_COMPLETE` and `QUESTION_ATTEMPT`.

**Dedupe bug fixed.** Once-only dedupe built its key from the *first* identity
field present — `course_id` came first, so `lesson_complete` was suppressed after
the first lesson of a course. The key now joins **every required parameter**
(`course_id=…|lesson_id=…`), pinned by tests a28 (three lessons all fire) and a29
(the same lesson twice still dedupes).

### Verification

- `analytics-service.test.mjs` **32/32** (was 27): a28–a32 cover per-lesson
  dedupe, `course_complete`, repeatable `question_attempt` with timing, and the
  missing-required-param rejection.
- `source-course-lessons.test.mjs` **6/6**: boots the real tool against the real
  sandhi HTML in jsdom, asserts the lesson selectors line up, and drives the
  actual "পড়া শেষ" buttons to completion.
- Full suite: `npm run test:native-auth` → **535/535 + 32/32 + 6/6**. Shell build
  bumped to `v286-lesson-quiz-analytics-20260925`; `source-course-tool.js` cache
  query bumped to `v24-lesson-analytics`.

---

## 4. Remaining milestones

The rest of the blueprint is unchanged and still ahead. Each will land as its
own completion record once the signals below exist to power it.

- **M2 — Course & lesson analytics.** ✅ Complete (§3). Drop-off, completion,
  average progress and time per course and lesson now have their signals:
  `course_view`, `course_start`, `lesson_view`, `lesson_start`,
  `lesson_complete` (with `duration`), `course_complete`.
- **M3 — Quiz & practice analytics.** ✅ Complete (§3). `question_attempt`
  (per-question `correct` + `duration`), `quiz_start` and `quiz_complete` now
  cover score/accuracy/retry/pace. Abandonment still has no explicit event — a
  `quiz_start` with no matching `quiz_complete` is the current proxy.
- **M4 — Funnel.** Course View → Start → Lesson Start → Lesson Complete → Quiz
  Start → Quiz Complete. Now fully buildable on M2/M3 events.
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

### Dictionary gaps that remain

- Quiz abandonment — no explicit event; inferred from a `quiz_start` without a
  `quiz_complete`.
- A standalone study-time event — `duration` now rides `lesson_complete`,
  `question_attempt` and `quiz_complete`, which covers the current need.
- Streak events (a `computeStreak()` exists; nothing emits).

Any new event name requires bumping `EVENT_VERSION` and extending the a1
coverage list in `analytics-service.test.mjs`.
