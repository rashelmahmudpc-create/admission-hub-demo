# F-04 — moving auth out of `admission-gk` into its own Worker

Owner decision D-4 (2026-10-22): auth gets its own Worker. This is the design for
that move. Nothing here is implemented yet.

## Why

Today one script, `admission-gk` (`worker-bundle.mjs`), holds the student app,
the AI gateway, the OTP chain **and** the whole auth surface
(`/api/auth/v1/*` from `auth-native/worker/public-auth-handler.mjs`).

- A bad deploy of the app takes login down with it, and a bad auth deploy takes
  the app down. Neither has to be true.
- Auth-only secrets (Firebase, Turnstile, the mail provider keys, the HMAC
  secret) sit in the same script that serves AI traffic.
- One request budget for everything: a burst of AI calls and a student trying to
  sign in compete for the same Worker limits.

## Non-goals

- No change for the student. Same URLs, same cookies, same screens.
- No new paid service. Workers Free allows a second script at no cost.
- No database move in phase 1.

## The two facts that shape everything

1. **The session cookie is `SameSite=Strict`** (`public-auth-handler.mjs:69`).
   A separate hostname such as `admission-auth.workers.dev` would mean the
   browser never sends it. So the public origin must stay
   `https://admissionsky.pages.dev/api/auth/v1/*` and the split has to happen
   *behind* that URL, not in front of it.
2. **`AUTH_AUTHORITY` owns real student data.** `AdmissionAuthAuthority` keeps
   its SQLite tables (challenges, sessions, student directory) inside Durable
   Object storage. A DO instance is addressed by (script, class, id), so simply
   declaring the same class in a new script would give every student a **blank**
   authority — every session invalid, every pending OTP lost.

## Target shape

```
browser
  └─ admissionsky.pages.dev/api/auth/v1/*      (same origin, same cookie)
       └─ _worker.js on Pages                  (already proxies to the Worker)
            └─ admission-gk                   (public entry, unchanged URL)
                 └─ service binding AUTH_WORKER
                      └─ admission-auth        (new: auth logic only)
                           └─ script_name binding AUTH_AUTHORITY
                                └─ AdmissionAuthAuthority   (STAYS in admission-gk)
```

The Durable Object deliberately stays where it is: its storage is the data. Moving
the class to another script is a separate migration with its own plan, and it is
not needed for F-04 to pay off.

## Phases

**Phase 1 — stand up the script, route nothing.**
Build `admission-auth` from the same sources (`auth-native/**`), with its own
`wrangler.auth.toml` and a `fetch` entry that serves exactly the handler's
routes. Deploy it to `workers.dev` only. Verify with the existing auth test suite
plus a live `/api/auth/v1/config` call against the new script. Nothing points at
it, so nothing can break.

**Phase 2 — move the traffic, keep a switch.**
Give `admission-gk` the `AUTH_WORKER` service binding and a var
`AUTH_ROUTE: local | service`. In `service` mode the public route forwards to
`admission-auth`; on any transport error it falls back to the in-process handler
that is still there.

Honest note on the rollback: the var lives in `wrangler.toml`, so switching back
is a one-line revert plus the automatic deploy (about two minutes), not an
instant runtime flip. That is still the safest shape here — no code change, and
the fallback path means a broken forward never becomes a broken login.

**Phase 3 — auth secrets move.**
Set the auth-only secrets on `admission-auth` (`FIREBASE_*`, `TURNSTILE_SECRET_KEY`,
the mail provider keys, `AUTH_HMAC_SECRET`, Telegram bot token) and remove them
from `admission-gk` once Phase 2 has run clean for a few days. Cron stays on
`admission-gk` until the alarm migration in the DO is planned.

**Phase 4 — retire the local path.**
Delete the fallback handler wiring, keep `AUTH_ROUTE` for a release as a
safety valve, update `.github/workflows/deploy-pages-worker.yml` to deploy both
scripts (auth first, then the app, so the entry never points at a stale auth).

## Rollback

Every phase is reversible with a var flip or a redeploy of the previous bundle.
Phase 2 is the only one that touches live traffic, and its fallback is the code
already running today.

## Risks

| Risk | Handling |
|---|---|
| DO storage reset | Do not move the DO. Bind it cross-script. |
| Cookie / CORS breakage | Keep the public origin; the browser never learns a second host. |
| Double deploy forgetting one script | The deploy workflow publishes auth first, then the app. |
| Secret drift between scripts | Phase 3 sets the new copy before removing the old one. |
| Workers Free limits | Two scripts, each with its own daily request allowance — a small win, not a cost. |

## Open questions for the owner

1. Phase 3 order: can the auth secrets be re-set on a second script without
   touching the existing ones? (Yes, but it means typing the same keys twice —
   the deploy workflow can do it from the same GitHub secrets, no manual step.)
2. Do we want the teacher/student directory routes to follow auth later, or stay
   on `admission-gk`?
