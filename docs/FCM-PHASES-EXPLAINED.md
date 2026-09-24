# FCM Push — the phases, in plain language

Two lists describe the same build. The **five major phases** are the
blueprint's contract (`FCM-NOTIFICATION-BLUEPRINT.md`). The **eight stages**
are the finer steps those phases actually decompose into in the code. Eight
stages, five phases — the grouping is below.

## The 3-line version

1. Phase 1 lays the pipe: permission, a device token, and a way to store it.
2. Phases 2–3 decide *who* gets a message: everyone (global) or only the
   students it is relevant to (personalized).
3. Phases 4–5 make it run itself and stay cheap at scale: events and cron
   send it, quota and cleanup keep it honest.

## The eight stages, grouped under the five phases

| Stage | What it is | Major phase | Status |
|-------|-----------|-------------|--------|
| 1 | Firebase + FCM project, secrets, FCM HTTP v1 sender | 1 · Foundation | ✅ done |
| 2 | Service worker + permission UX (one tap, never an auto-popup) | 1 · Foundation | ✅ done |
| 3 | Token lifecycle: register, refresh on boot, unsubscribe, invalid-token cleanup | 1 · Foundation | ✅ done |
| 4 | Foreground/background display, click→deep-link routing, hidden test panel | 1 · Foundation | ✅ done |
| 5 | Global fanout: `all_students` topic + admin composer (instant/scheduled/preview) | 2 · Global | ✅ done |
| 6 | Personalization: user signals → eligibility engine → batching → FCM | 3 · Personalized | ✅ done |
| 7 | Event + automation + analytics: cron (daily/weekly/monthly), event notifications | 4 · Automation | ⏳ next |
| 8 | AI + scale + production hardening: quota-aware sends, cleanup at size | 5 · Scale | ⏳ later |

## Why stage 3 and stage 5 matter most for "users get push with no steps"

Stage 3 is the one users feel. The permission grant is the durable signal; a
rotating token or a cleared local flag must not silently turn push off. Boot
now **reconciles**: if permission is granted and the user has not opted out,
the current token is re-registered automatically. The user never re-enables by
hand, and never sees a prompt they already answered.

Stage 5 is the one that makes "everyone" actually mean everyone. A global send
fans out through the topic **and** a memory-bounded per-device fallback, so a
device that failed the topic subscribe still gets the message, and a row is
only marked `sent` when something really landed.

## How a message travels

```
Stage 1–3  permission + token + stored device
                ↓
Stage 5    global path  → topic all_students → fanout fallback → FCM
Stage 6    personal path → eligibility engine → batching → FCM
                ↓
Stage 4    delivered: foreground toast, or background push → tap → deep link
                ↓
Stage 7–8  cron triggers the sends; quota + cleanup keep them in budget
```

## What is left

- **Stage 7 (Phase 4):** cron-driven event notifications — lesson completed,
  achievement unlocked, streak milestone — plus weekly/monthly digests and
  open/click analytics.
- **Stage 8 (Phase 5):** quota-aware fanout for very large audiences and
  AI-scored send timing.
