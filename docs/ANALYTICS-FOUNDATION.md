# Analytics Foundation (Phase 1) — Admission Hub

**Status:** Phase 1 complete. GA4 transmission is dormant until the owner adds a
measurement ID (see "Switching GA4 on" below).
**Module:** `analytics-service.js` (browser), `fcm-notification.mjs`
(`/api/notifications/config`).
**Blueprint:** 5-phase Google Analytics for Firebase master blueprint (see the
persistent memory entity `Admission Hub GA4 Firebase Analytics Blueprint`).

---

## 1. Why a service layer exists

The app never talks to the Firebase Analytics SDK directly. Every surface calls
`window.AhAnalytics`, which is the single choke point. That buys five things:

1. **One dictionary.** Event and parameter names are declared in one place, so
   the collected data stays queryable instead of drifting into free-form keys.
2. **Privacy by construction.** Unknown parameters, and anything resembling
   identity, credentials or free text, are dropped *before* the call, not
   filtered later in a dashboard.
3. **Failure isolation.** Analytics can never break the app: every public call
   is wrapped and degrades to a no-op.
4. **Provider independence.** Swapping GA4 for another backend is one file.
5. **Testability.** The validation layer is pure and unit-tested.

## 2. Event naming rules

- `snake_case`, lowercase, ASCII.
- The name states **object + action**: `lesson_complete`, not `completedLesson`.
- Grouped by surface, which is also the prefix: `course_*`, `lesson_*`,
  `quiz_*`, `notification_*`, `feature_*`, `ai_*`, `auth_*` / `login` / `sign_up`.
- **Past tense for completed actions** (`lesson_complete`), present for state
  (`screen_view`).
- An event that is not in `EVENTS` is **rejected**. To track something new, add
  it to the dictionary first — that is the point.

## 3. Parameter rules

- `snake_case`. Callers may write camelCase (`courseId`); the service converts.
- Only `string | number | boolean`. Objects, arrays, `null`, `NaN` and
  `Infinity` are dropped.
- Strings are trimmed, stripped of control characters, and capped at 120 chars.
- At most 24 parameters per event.
- Enum parameters (`quiz_type`, `login.method`, …) accept only their declared
  values; an out-of-range value is dropped rather than sent.
- **Never sent:** password, secret, token, api key, credential, cookie, session
  id, email, phone/mobile, address, full name, answer, explanation, message,
  transcript, prompt, response, free text, bio, dob, avatar — see
  `FORBIDDEN_PARAM`. This is a hard filter, independent of the dictionary.

## 4. The dictionary (Phase 1)

| Event | Required | Optional | Once? |
|---|---|---|---|
| `app_open` | — | `launch_source` | yes |
| `screen_view` | `screen_name` | `screen_group`, `previous_screen` | no |
| `session_start` | — | `signed_in` | yes |
| `course_view` | `course_id` | `course_type`, `category` | no |
| `course_start` | `course_id` | `course_type` | yes |
| `lesson_view` | `course_id`, `lesson_id` | `lesson_number`, `topic_id` | no |
| `lesson_start` | `course_id`, `lesson_id` | `lesson_number` | yes |
| `lesson_complete` | `course_id`, `lesson_id` | `lesson_number`, `completion_percent`, `duration` | yes |
| `quiz_start` | `quiz_id` | `quiz_type`, `question_count`, `subject_id`, `topic_id` | yes |
| `quiz_complete` | `quiz_id` | `quiz_type`, `question_count`, `correct`, `wrong`, `skipped`, `accuracy`, `score`, `duration` | yes |
| `search` | `search_scope` | `result_count` | no |
| `feature_open` | `feature_name` | `feature_group` | no |
| `feature_use` | `feature_name` | `feature_group`, `action` | no |
| `feature_complete` | `feature_name` | `feature_group`, `duration` | yes |
| `notification_open` | `notification_id` | `notification_type`, `notification_source` | yes |
| `notification_click` | `notification_id` | `notification_type`, `link_route` | yes |
| `auth_landing_view` | — | `auth_step` | no |
| `sign_up` | `method` | `verification_required` | yes |
| `login` | `method` | `returning` | yes |
| `logout` | — | `reason` | yes |
| `ai_chat_open` | — | `signed_in` | no |
| `ai_message_sent` | — | `intent`, `tier`, `provider` | no |
| `error_seen` | `error_area` | `error_code` | no |

"Once" means: at most one send per session/key, so a page re-render or a double
tap never inflates a completion count.

## 5. How screens are tracked

Screen views ride the router's own render event:

```js
document.addEventListener('admission:route-rendered', e => trackScreen(e.detail.path));
```

`trackScreen('question-bank/settings')` sends `screen_name: 'question-bank'`,
`screen_group: 'question-bank'`, and `previous_screen`, and refuses to re-send
the same screen back-to-back.

## 6. Identity

`setUserContext` sets **only** an opaque student id and the first name — read the
same way the AI chat reads it (`ah-profile-cache-key` → `profile.fullName`'s
first token). No email, no phone, no full name, ever. Signed-out students get no
user context.

## 7. Environment separation

| Origin | Mode | Behaviour |
|---|---|---|
| `admissionhub.pages.dev` | production | sends to GA4 (once a measurement ID exists) |
| any other origin | disabled | records nothing |
| any origin with `?ahanalytics=debug` | debug | `console.info` only, never the network |

Test and preview traffic can therefore never pollute the production property.

## 8. Debugging

Add `?ahanalytics=debug` to the URL, then watch the console for
`[AhAnalytics] <event> {params}`. Inspect health at any time:

```js
window.AhAnalytics.status()
// { mode, appVersion, measurementConfigured, signalled:{sent,dropped,queued,rejected}, reasons, queue, user }
```

`reasons` explains every drop (`duplicate`, `unknown-or-invalid`,
`mode-disabled`, `same-screen`), so a "missing" event is never a mystery.

## 9. Offline behaviour

When the browser is offline, events are queued in `localStorage`
(`ahAnalyticsQueueV1`, last 200) and flushed automatically on the `online`
event.

## 10. Versioning

Every event carries `event_version` (`ev1`) and `app_version` (the shell build
id, e.g. `v284-analytics-foundation-20260924`), plus `environment`. Bump
`EVENT_VERSION` when the dictionary changes shape in a way old dashboards would
misread.

## 11. Switching GA4 on (already done, in code)

The measurement ID for the `admission-hub-web` stream is `G-06DEZGLFJE`, read
from the project's own web-app config. It ships as `DEFAULT_MEASUREMENT_ID` in
`fcm-notification.mjs`.

The original plan was a `FIREBASE_MEASUREMENT_ID` Worker variable. That is not
used, because this Worker already sits on the Workers Free **64-variable
ceiling** (verified live: 15 plain-text + 49 secrets = 64), and a 65th binding
is rejected on deploy with `code: 10055`. A GA4 measurement ID is public by
design — every browser receives it — so a code default leaks nothing. If the
stream ever changes, bind `FIREBASE_MEASUREMENT_ID` as a dashboard secret *after*
freeing a slot; an env value always wins over the default.

To confirm it is live: `GET /api/notifications/config` returns
`webConfig.measurementId`. Once present, the client transmits by itself — no
Pages redeploy is needed, since the config is fetched at runtime.

## 12. Tests

`analytics-service.test.mjs` (part of `npm run test:native-auth`) pins the
contract: dictionary coverage, rejection of unknown events/params, the privacy
filter, value coercion, enum enforcement, dedupe, screen normalisation,
never-throws under a bare environment, identity minimisation, and (Phase 2 M1)
the `admission:activity` bus → dictionary-event routing. 27 tests.

Phase 2 — Learning & Student Behavior Analytics — continues on this foundation;
see `docs/PHASE-02-LEARNING-ANALYTICS.md`.
