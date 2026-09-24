# Personalized Smart Notifications (Phase G)

One student, one nudge a day, chosen from their own learning data.

## Why this exists

The global broadcaster sends one message to everybody. It cannot say "you have
9 mistakes waiting for revision" or "you have not studied in 4 days". Phase G
reads the server-side student data that Phase B–F now stores (via
`userdata-api.mjs`) and sends the right message to the right person.

## The five reasons, in priority order

The engine picks the first one that applies:

| # | Kind | Fires when | Goes to |
|---|------|-----------|---------|
| 1 | `revision-due` | unmastered mistakes ≥ 5 (default) and no study today | smart-revision |
| 2 | `streak-risk` | studied yesterday, not today, after 18:00 | dashboard |
| 3 | `exam-weak` | latest exam score < 60% and no study today | smart-revision |
| 4 | `inactive-3d` | last study day ≥ 3 days ago | dashboard |
| 5 | `daily-glow` | studied today, ≥ 10 correct | dashboard |

If none apply, nothing is sent. Silence is a valid outcome.

## The three restraint rules

1. **Per-day cap** (default 1). Enforced by a `notification_sends` primary key
   on `(user_id, kind, day_key)`. The slot is claimed *before* the send, so a
   crash or a retried cron tick cannot double-deliver.
2. **Quiet hours** (default 23:00–07:00, Dhaka time) plus a send window
   (08:00–22:00). A malformed quiet range is ignored rather than silencing the
   student forever.
3. **Opt-out.** Students can turn it off from the notification settings modal.
   Off means the engine skips them before it even reads their data.

## Where it runs

Cron, immediately after the global send, in `gk-agent-worker.js`:

```js
try { await runScheduledPersonalizedNotifications(env); } catch (_) {}
```

One bad account is caught per-student; it cannot stop the run.

## Admin tools

Admin-token routes for looking before you leap (nothing is sent):

- `GET /api/notifications/personal/preview?user=<id>` — the decision inputs and
  the message that *would* go out for one student.
- `GET /api/notifications/personal/preview-all` — the current plan for the whole
  audience.
- `POST /api/notifications/personal/run` — run the engine now (same code path as
  cron).

## Student switch

- `GET /api/notifications/personal-pref` — current setting (session cookie).
- `POST /api/notifications/personal-pref` — `{ "personalized_enabled": false }`.

## Files

- `personalized-notification.mjs` — decision core (pure) + storage + routes.
- `personalized-notification.test.mjs` — 24 tests.

Run: `npm run test:personalized`.
