# Phase 03 — Notification & Engagement Intelligence

Status: complete (2026-09-25) · build `v289-notification-intelligence-20260925`

## What this phase is

Phase 1–2 taught the app to *observe* learning: `analytics-service.js` records
lesson views, lesson starts, completions, question attempts and quiz results, and
the server keeps that data per student. Phase 3 is the part that *acts* on it —
it makes the FCM notification system intelligent, so the right student gets the
right notification at the right time, and we can prove whether it worked.

The goal is not "send more". It is send less, send better, and measure the
result. Silence is a valid and frequent outcome.

## The problem before this phase

Four notification engines already existed and each was correct on its own:

| Module | Question it answered |
| --- | --- |
| `personalized-notification.mjs` (Phase G) | "what is the one daily nudge?" |
| `event-notifications.mjs` | "what did the student just achieve?" |
| `digest-notifications.mjs` | "what happened this week?" |
| `analytics-notifications.mjs` | "how did the notifications perform?" |

But nothing **ranked** them against each other, nothing learned from whether the
student ever acted, and every send time was hardcoded to Asia/Dhaka. A student in
Dubai got Dhaka quiet hours. Two engines could both fire in one morning. And a
student who ignored twenty notifications kept getting the same cadence.

## The design

One module, `notification-intelligence.mjs`, is the missing decision layer. It
turns behaviour into signals, builds every candidate a student qualifies for, and
runs them through a single ordered pipeline:

```
eligible? → enabled? → quiet hours? → relevant? → duplicate? → priority
          → daily/category limit → cooldown → SEND | SKIP
```

Four rules shaped it:

1. **One pipeline, not eight.** Every stage appends a trace entry, so
   "why did nobody get notified?" has one answer instead of eight.
2. **Restraint is the feature.** The default is one notification a day, one per
   category, with a six-hour cooldown.
3. **Nothing sends that cannot be measured.** Every send records an A/B variant,
   and the outcome row links the send to a later learning action.
4. **Rules now, AI later.** The decision core is pure — no I/O, no model — so a
   Phase 5 optimiser can sit in front of the same interface without touching
   eligibility, priority or frequency.

## The eight notification kinds

Each kind belongs to a category (which the student can switch off) and carries a
priority rank. `celebration: true` means good news: a fatigued student keeps
receiving these even when nudges are silenced.

| Kind | Category | Priority | Celebration | Fires when |
| --- | --- | --- | --- | --- |
| `streak-risk` | streak | 90 | no | streak ≥ 2, nothing studied today, after 17:00 local |
| `certificate` | achievement | 88 | yes | a course reaches 100% |
| `achievement` | achievement | 85 | yes | a course crosses 50% or 100% |
| `comeback` | streak | 70 | no | inactive ≥ 3 days |
| `weak-topic` | learning | 65 | no | ≥ 12 attempts, accuracy < 55%, a topic with misses |
| `progress` | learning | 60 | yes | within 2 lessons of the 25/50/75/100 mark |
| `pending-learning` | learning | 55 | no | ≥ 5 pending revisions |
| `challenge` | challenge | 45 | no | high engagement, streak ≥ 3, no weak topic |

## The five intelligences

The brief asks for five separate intelligences. Each is a pure function, tested
on its own, and they are the reason the candidates above fire when they do.

- **Streak** — only after 17:00 local, so it protects a streak in the evening
  rather than nagging at breakfast.
- **Comeback** — needs a real gap (`inactive_days`, default 3). One quiet day is
  not a comeback.
- **Progress** — computes lessons-to-go from the student's own course progress,
  and stays silent when the milestone is far away.
- **Achievement** — announces a crossed mark (50%, 100%) the student has not
  been told about anywhere else.
- **Weak topic** — requires evidence: enough attempts *and* low accuracy *and* a
  topic that actually has misses. One bad day is not a weak topic.

## Smart audience selection

`classifySegment` gives each student exactly one label, most urgent first:
`new` → `dormant` → `streak-risk` → `struggling` → `milestone-near` →
`cooling` → `engaged` → `active`. The label is derived from behaviour, never
typed in by an admin.

## Timezone-aware delivery

Quiet hours and the send window follow the **student's** clock. The client sends
its real UTC offset once per session (`AhFcm.syncTimezone()`); the server stores
it in `notification_intel_state` and clamps it to the real range (−720…+840
minutes). Asia/Dhaka (UTC+6) remains the default for a student who has never
reported an offset.

## Fatigue detection

Fatigue is sent-up / opened-down, measured over a 30-day window with a minimum
sample of 8 sends, so two ignored notifications cannot label a student fatigued.
When a student *is* fatigued:

- nudges are silenced entirely;
- celebrations still get through (a certificate should never be withheld);
- the daily cap drops accordingly.

## Frequency control

| Control | Default | Enforced by |
| --- | --- | --- |
| Daily cap | 1 | `notification_sends`, **shared with Phase G** |
| Per-category cap | 1 | `notification_outcomes` |
| Cooldown | 6 hours | last send timestamp |
| Duplicate protection | — | stable candidate `key` |

The shared daily cap matters: turning this engine on cannot double a student's
daily allowance, because both engines claim the same row in `notification_sends`.

A blocked candidate does **not** stop the list. If the learning category is
capped but the streak nudge is still allowed, the streak nudge goes out.

## A/B testing foundation

Variants are assigned by FNV-1a hash of `userId|kind`, so the same student keeps
the same variant across cron ticks — otherwise an A/B result would measure the
assignment rather than the message. Variants differ in **copy only, never in
eligibility**: nobody gets a worse-timed notification because they landed in
group B. Every kind has copy in all three variants, asserted by test.

## Notification → learning conversion

This is the measurement that matters. A notification is only effective if the
student then *learned*.

- The push carries a `key` (the candidate key).
- The service worker records a click against that key.
- When the student starts a lesson, the client reports the action name only.
- The server credits the **most recent convertible send**, and refuses to credit
  learning that happened *before* the open — a lesson started before the tap
  cannot have been caused by it.

Only real learning kinds count: `lesson_start`, `lesson_complete`,
`quiz_complete`, `question_attempt`, `course_complete`.

## The feedback loop

`computeFeedback` learns two things from the outcome rows and hands both back to
the decision core:

- the **best hour** (highest conversion, minimum 3 sends in that hour), which
  feeds smart timing once the student has enough history;
- the **winning variant** (minimum 20 sends per variant, compared on conversion
  then open rate), which is only named once there is enough data to mean it.

## Storage

Three tables, all created by `IntelligenceStore.init()`:

| Table | Holds |
| --- | --- |
| `notification_intel_state` | per-student timezone offset + preferences JSON |
| `notification_outcomes` | one row per send: kind, category, variant, sent/opened/clicked/learning |
| `notification_fatigue` | the cached fatigue verdict |

Behaviour reads (`user_daily_stats`, `user_exam_results`, `user_mistakes`,
`user_activity`, `user_settings`) are **read-only** — this engine never writes
another feature's tables.

## Routes

Student (session cookie required):

- `GET  /api/notifications/intel-pref` — read timezone + preferences
- `POST /api/notifications/intel-pref` — set timezone and/or per-category switches
- `POST /api/notifications/outcome` — report opened / clicked / learning

Admin (Bearer `ADMIN_TOKEN`):

- `GET  /api/notifications/intel/preview?user=<id>` — explain one decision, send nothing
- `GET  /api/notifications/intel/preview-all` — the whole audience's plan
- `POST /api/notifications/intel/run` — run the scheduler now
- `GET  /api/notifications/intel/performance` — the funnel + feedback
- `GET  /api/notifications/intel/fatigue?user=<id>` — one student's fatigue verdict

These are registered **before** `handleFcmNotificationRequest`, because that
handler answers 404 for any `/api/notifications/*` path it does not recognise.
The handler also claims only its own paths before answering OPTIONS — an
unguarded early return there would answer CORS preflight for the whole app.

## Client surface

- `AhFcm.syncTimezone()` — reports the device offset once per session.
- `AhFcm.intelRow()` — the per-category switches, rendered inside the existing
  settings modal (extends it, no fork).
- `AhFcm.reportOutcome()` — forwards `opened` / `clicked` / `learning`.
- The settings modal gains one row; the inbox and hub keep their existing shape.

## What changed in the existing stack

- `gk-agent-worker.js` — imports and routes the handler; calls the scheduler in
  `scheduled()` after Phase G.
- `notification-fcm.js` — the bridge above.
- `notification-hub.js` — mounts the intelligence row; logs intelligence clicks
  against the engine key.
- `firebase-messaging-sw.js` — records a click for a `key`-bearing push as well
  as a `gid`-bearing one.

## Verification

- `notification-intelligence.test.mjs` — 66 tests, one per completion-standard
  guarantee. Wired into `npm run test:fcm` (252/252).
- `npm run test:native-auth` — 535 + 49 + 12, green.
- `npm run test:student-data` — 63 green; `test:legacy-adoption` 19 green.
- `npm run test:ui-guards` — 4 green.
- Worker bundle rebuilt and in sync (`npm run check:worker-bundle`).

Two pre-existing tests were repaired rather than worked around:

- the Phase G "running twice in one day" test passed *vacuously* — with a fresh
  store the run stopped at `fcm-not-configured` before reaching the duplicate
  guard, so it proved nothing. It now reuses one store across both runs.
- the service-worker click contract test pinned the old single-branch shape; it
  now covers both branches.

## What Phase 4/5 can build on

- The decision core is pure, so an optimiser (learned send time, learned kind
  preference) can replace `bestSendWindow` / `rankCandidates` without touching
  eligibility or frequency.
- `computeFeedback` already produces the per-kind, per-variant, per-hour funnel
  an ML layer would train on.
- The trace is a structured record of every decision, so an offline replay can
  compare a candidate policy against the shipped one.
