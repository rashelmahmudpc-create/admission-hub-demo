# PHASE 2 — LEARNING & STUDENT BEHAVIOR ANALYTICS

**Status:** ✅ Complete — M1 (Learning Instrumentation), M2 (Course & Lesson
Analytics), M3 (Quiz & Practice Analytics), M4 (Funnel), M5 (Drop-off
Intelligence, detection), M6 (Engagement/Streak/Retention) and M7 (Data Quality)
all shipped. The admin *display* of these numbers remains parked with the rest of
the admin panel (needs the GA4 Data API + a Property ID).
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
  - **Threshold must stay 0.** A lesson section is routinely taller than the
    phone viewport — sandhi lesson 1 measured **3270px** against an ~844px
    viewport — so `threshold: 0.25` with a `-40%` bottom margin could never be
    satisfied. `intersectionRatio` stayed `0` and `lesson_view`/`lesson_start`
    fired for **nobody** on a real device, while `lesson_complete` still worked.
    The config is now `threshold: 0` with `-25%`; `markViewed` de-dupes, so the
    looser trigger cannot double-count. Found by driving the live site in a
    headless browser, not by the suite: jsdom has no `IntersectionObserver`, so
    every test was silently taking the no-observer fallback. `m2-7`/`m2-8` now
    stub the observer to pin the threshold and the emitted signals.
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
- `source-course-lessons.test.mjs` **8/8**: boots the real tool against the real
  sandhi HTML in jsdom, asserts the lesson selectors line up, drives the actual
  "পড়া শেষ" buttons to completion, and stubs `IntersectionObserver` to pin the
  threshold-0 config and the `lesson_view`/`lesson_start` signals.
- Full suite: `npm run test:native-auth` → **535/535 + 32/32 + 8/8**. Shell build
  bumped to `v287-lesson-observer-threshold-20260925`; `source-course-tool.js`
  cache query bumped to `v25-lesson-observer`.

---

## 4. M3 completion — the course MCQ engine is instrumented

M3 was marked complete while one surface still emitted nothing: the course's own
question bank (`SourceCourse.answer` in `source-course-tool.js`). The exam engine
fired `question_attempt`; the course MCQ engine — the one students actually reach
from `source-courses/*` — did not.

It does now:

- Answering a course MCQ dispatches `QUESTION_ATTEMPT` with `quiz_id`
  (`<course-id>:course`), `question_id`, `correct`, `question_number`,
  `subject_id`/`topic_id` (the source's own question family) and a real
  `duration`. Think-time comes from a `questionSeenAt` stamp taken when the
  question first rendered, not from the click.
- Reaching the result screen dispatches `QUIZ_COMPLETE` (via a new
  `QUIZ_COMPLETE` bus mapping) with accuracy, counts and the attempt duration
  measured from `quiz_start`. This replaced the old `TEST_COMPLETED` emission,
  which is the *exam* engine's signal and was mislabelling a persisted course
  attempt as `mode: 'flash'`.
- Only which question and whether it was right leaves the browser. The option
  text and explanation never do — pinned by `m3-2`.

---

## 5. M4–M7 completion record — funnel, drop-off, engagement, data quality

M4–M7 are one derived engine, `buildLearningInsights()`, in
`analytics-service.js`. It is **pure**: it takes events (or pre-counted funnel
counts) and returns the four reports. No DOM, no storage, no network — so the
same function serves the browser, a future admin panel, and `node:test`.

### M4 — Funnel

`FUNNEL_STEPS` defines the funnel once:
Course View → Course Start → Lesson Start → Lesson Complete → Quiz Start → Quiz
Complete. Each step reports `count`, `reachRate` (share of the step before) and
`dropRate`.

Every step is an **event name**, never a screen name. `trackScreen` collapses
`source-courses/sandhi` to `source-courses` (pinned by a16), so a screen-based
funnel would silently merge every course into one bar. `m4-2` pins this.

### M5 — Drop-off intelligence

The steepest stage that matters is surfaced with a plain-language sentence a
non-technical admin can act on — *"পাঠ শুরু করে শেষ করেনি — ৭৬% এখানেই থেমে
গেছে।"*

Two guards keep it from crying wolf:

- **Minimum sample (5).** A 67% drop between 3 and 1 student is noise, not a
  signal (`m5-2`).
- **Threshold (40%).** A healthy funnel — every step above 90% — raises nothing
  (`m5-3`).

Ties break toward the earliest step, because that is the one worth fixing first
(`m5-4`).

### M6 — Engagement, streak, retention

Derived entirely from the events already collected — no new collection:

- `activeDays`, `firstDay`, `lastDay` — distinct calendar days with activity.
- `streak` — the longest run of *consecutive* days (`m6-1`).
- `retention` — D1/D7/D30 counts of later active days after the first (`m6-2`).

### M7 — Data quality monitoring

`checkDataQuality()` answers the three questions that matter, reusing the
dictionary so it cannot drift from what `normalizeEvent` enforces:

- **Missing** — an expected event that never fired (`m7-1`, `m7-5`).
- **Incomplete** — a row missing a dictionary-required parameter (`m7-2`).
- **Duplicate** — a once-only event seen twice (`m7-3`).

`ok` is true only when all three are clean (`m7-4`).

### The on-device ledger

GA4 owns the aggregate view. For the admin panel and the quality check to read
something before the Data API is enabled, `trackEvent` now also appends each
already-filtered row to a bounded local trail (`ahLearningLedgerV1`, 500 rows,
`readLedger()`). It stores exactly what was sent — no new personal data, no new
Worker variable.

### Honest limit — the admin display is still parked

M5 says "surface it to the admin panel". The **detection** ships and is exposed
as `AhAnalytics.learningInsights()`; the **display** does not, for the same
reason the whole admin panel is parked: the GA4 numbers need the Google Analytics
Data API enabled and a numeric Property ID, and neither exists yet. This was the
owner's explicit decision. When that lands, the engine is ready — it already
accepts `{ counts }`, so a Data API response can be fed straight in.

---

## 6. Verification

- `analytics-service.test.mjs` **49/49** (was 32). New coverage: a33
  (`QUIZ_COMPLETE` from the course result), m4-1/m4-2 (funnel shape + event-based
  steps), m5-1…m5-4 (steepest stage, sample guard, healthy funnel, tie-break),
  m6-1/m6-2 (streak + engagement), m7-1…m7-5 (missing/incomplete/duplicate/clean), and m4-3…m4-5 (the on-device ledger holds only sent rows, stays bounded, and feeds the reports).
- `source-course-lessons.test.mjs` **12/12** (was 12): m3-1…m3-4 cover a course
  MCQ attempt (verdict + real think-time), the privacy of that attempt, the
  no-double-count on re-answer, and the `quiz_complete` on the result screen.
- Full suite: `npm run test:native-auth` → **535/535 + 49/49 + 12/12**.
- **Live end-to-end (production, `admissionhub.pages.dev`, v288).** A headless
  Chromium run drove the real signed-in course path — scroll to intersect each
  lesson, tap every "পড়া শেষ", then answer all 60 MCQs. The on-device ledger
  recorded the whole funnel:
  `course_view 3, course_start 1, lesson_view 8, lesson_start 8,
  lesson_complete 8, course_complete 1, quiz_start 1, question_attempt 60,
  quiz_complete 1` (95 rows), and `learningInsights()` reported
  `quality.ok = true` with no missing, incomplete, or duplicate events. This is
  the M3 confirmation: the course MCQ engine emits per-question attempts and a
  quiz completion on the live site, not just under jsdom.
- Shell build `v288-learning-insights-20260925`; `analytics-service.js` query
  `analytics-p2-v2-insights`; `source-course-tool.js` query
  `v26-course-mcq-analytics`. `scripts/cache-bump.mjs` now also bumps
  `analytics-service.js`, which it had been missing.

---

## 7. Remaining gaps

- **Admin panel display.** Parked by the owner; needs the GA4 Data API + a
  numeric Property ID. The insights engine is ready to feed from it.
- **Quiz abandonment.** Still no explicit event; a `quiz_start` with no matching
  `quiz_complete` remains the proxy.
- **Streak events.** `engagement.streak` is now derived, but nothing *emits* a
  streak event to GA4. Deliberate — a derived number needs no event.

---

## 8. Blueprint status

- **M2 — Course & lesson analytics.** ✅ Complete.
- **M3 — Quiz & practice analytics.** ✅ Complete (course MCQ engine now
  instrumented too).
- **M4 — Funnel.** ✅ Complete.
- **M5 — Drop-off intelligence.** ✅ Detection complete; display parked with the
  admin panel.
- **M6 — Engagement, streak, retention.** ✅ Complete.
- **M7 — Data quality monitoring.** ✅ Complete.

Any new event name still requires bumping `EVENT_VERSION` and extending the a1
coverage list.
