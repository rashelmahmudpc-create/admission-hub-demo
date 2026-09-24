# AGENTS.md

## Project

Static SPA for https://admissionhub.pages.dev, deployed to Cloudflare Pages
(project `admissionhub`, production branch `main`). `index.html` and
`courses/*/index.html` are hash-routed entry pages; `_worker.js` is an
advanced-mode Pages worker that proxies `/api/*` and gates asset serving.

## Build and deploy

- `dist/` is **not** committed. CI (`.github/workflows/cf-pages.yml`) rebuilds it
  from the repo root with an `rsync` exclude list; root files are the source of
  truth, so never commit the `dist/` mirror.
- Deployment is a manual `workflow_dispatch`:
  `wrangler pages deploy dist --project-name admissionhub --branch main`.
  Requires `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`.
- **Manual deploy workflow:** `.github/workflows/deploy-pages-worker.yml`
  (`confirmation: DEPLOY`) publishes both the Worker bundle and the Pages UI from
  `main` using repository secrets. It is deploy-only — no Firebase, mailbox or
  secret mutation. Merging to `main` does **not** deploy on its own; run this
  workflow (or dispatch it via the API) whenever `main` must reach production.
- Local deploy without `rsync` (not installed here): replicate the exclude list
  in Python, then run wrangler via `npx --yes wrangler@3 pages deploy dist ...`.

## SEO invariants (enforced by the CI bundle guard)

- Crawler files ship as real files, never the SPA shell: `robots.txt`,
  `sitemap.xml`, `favicon.ico`, `og-image.png`, `apple-touch-icon.png`.
- Root page: unique `<title>`, canonical, OG/Twitter tags, JSON-LD `@graph`
  (`WebSite`, `Organization`, `WebApplication`).
- Each course landing page needs its own canonical, description, OG tags and a
  parseable JSON-LD `@graph` containing a `Course` node.
- `_worker.js` converts Pages' catch-all 200 HTML fallback into a real 404 for
  unknown paths and missing assets, while keeping `/`, `/courses/*`,
  `/AH-[A-Z2-9]{6}` and hash routes at 200.
- The root `<body>` is an app shell, so without JS it exposes only the loading
  splash (84 characters) while every course landing page is fully prerendered.
  A `<noscript>` block after `#modalRoot` carries the real pitch and links to
  the course pages; `intro.test.mjs` guards it. Keep that markup *inside*
  `<noscript>` — the splash, `body.app-booting` and `#app` are a tested boot
  contract (tests ১–১১), and the engine/`renderShell` replace `#app`'s innerHTML
  wholesale, so prerendered copy placed there would simply be thrown away.
  Its `<style id="ah-nojs-min">` sits in `<head>` next to `ah-boot-min` because
  `<style>` is only valid there; JS-on browsers ignore it as nothing then
  matches `.ah-nojs`.

## Testing

- `node --test seo-routing.test.mjs` ÔÇö routing/404 contract.
- Baseline failures unrelated to SEO: `account-retirement.test.mjs`,
  `p18-legacy-dashboard-kill.test.mjs`, `startup-ai-regression.test.mjs`.
  Compare against `git worktree add /tmp/base origin/main` before blaming a change.

## Conventions

- Public profile IDs match `^AH-[A-Z2-9]{6}$` (no `0`/`1`); `/AH-* / 200` in
  `_redirects` hands the path to the SPA.
- `rsync` and `file` are unavailable in this sandbox; use Python equivalents.
- Preference values have two sources of truth that must agree: the default and
  allow-list in `loadPrefs()` (`profile-ui.js`) and the modes accepted by the
  global `AhAppearance` engine (`index.html`). Adding a mode in only one place
  makes the saved value silently reset on reload while the engine keeps
  rendering it ÔÇö the v267 `green`/Premium Green bug.
- Any change to a versioned asset requires a coordinated bump: the `?v=` query
  in `index.html`, `BUILD_ID` + `expectedSwVersion` in `index.html`/`sw.js`, and
  the shell version asserted across many `*.test.mjs` files. Bump the `SW shell`
  and `profile-vNN` markers together, then run `node scripts/sw-manifest.mjs` to
  regenerate `ASSET_DIGESTS` in `sw.js`, or the SW precache rejects the shell.
  The `BUILD_ID` literal also lives in
  `.github/workflows/telegram-auth-canary-activate.yml`, which verifies the
  deployed shell; a partial bump fails `interactive-native-personal-v1.test.mjs`.
- User-facing copy is Bengali by default and English is applied at runtime by
  `language-engine.js`, not by per-module conditionals. Modules keep writing
  Bengali; the engine rewrites text nodes plus `placeholder`/`aria-label`/`title`
  on `ah:lang` and on DOM insertion. Add new copy to its `DICT`.
  - Bengali must be NFC-normalised before dictionary lookup: Óª»Óª╝ is either U+09DF
    or Óª» + Óª╝, and the two look identical. A naive comparison silently misses
    entries ÔÇö this cost 36 account strings when first written.
  - `language-engine.test.mjs` fails when the account or profile UI renders a
    Bengali string the table lacks, so the guard catches untranslated copy added
    later. The scan reads plain JS string literals too, not only markup: copy in
    a `row('­ƒîÉ', 'Language', ...)` call or a toast is never inside a tag, and
    scanning markup alone is what let ~230 strings ship untranslated.
  - `language-coverage-runtime.test.mjs` boots the real modules with the engine
    in English mode and fails on any Bengali text node or attribute still on
    screen. Keep both: the static scan catches a missing key, the runtime one
    catches a key that exists but never reaches the DOM.
  - Strings that embed a live number (resend timers, passkey totals, the
    multi-device logout notice) cannot have a fixed key, so `RULES` matches them
    by shape. `translateSegment` additionally translates one segment of a
    `┬À`-joined string, a Bengali date (`ÓººÓºº ÓªÅÓª¬ÓºìÓª░Óª┐Óª▓, Óº¿ÓºªÓºªÓº¡`) and digit-only runs.
    Bengali digits are U+09E6ÔÇôU+09EF and are outside `\d`, so a bare `\d` pattern
    silently fails on them.
  - The engine writes node values, so it must distinguish its own output from a
    module's later rewrite. `lastOut` holds what the engine wrote; when the node
    no longer matches it, that new value is the source to translate. Without
    this, a count-up animation is frozen at its first frame and keeps the
    Bengali digits it started with.
- The language and appearance engines each keep their own `localStorage` key
  (`ahLang`, `ah-appearance`) while `profile-ui.js` keeps the synced preference
  in `ah-profile-prefs-v1`. Only the profile picker writes both, so boot
  reconciles them (`reconcilePreferencesAtBoot`). Direction matters: with no
  preference saved the engine key is the real choice and seeds the preference,
  otherwise first run overwrites the user with defaults.
  - `AhI18n.set` now mirrors the choice into an existing `ah-profile-prefs-v1`
    record (it does not create one). Without this the welcome picker — the first
    language control a visitor meets — moved `ahLang` alone, and boot reconcile
    then read the stale saved preference and snapped the app back to Bengali.
  - Never persist the choice from `account-access.js`: `native-auth-protection`
    scans that file for the browser storage globals and fails the build if any
    appear, comments included. Persistence stays in the engines.
  - A runtime test that seeds English *before* boot cannot see a picker that
    fails to store the choice. `language-coverage-runtime.test.mjs` boots in
    Bengali and drives the real `<select>` for this reason; keep it that way.
- `Intl.DateTimeFormat('bn', {weekday:'short'})` renders `বুধ`, `বৃহস্পতি` — short
  forms that are *not* the dictionary's `বুধবার`/`বৃহস্পতিবার`, so the dashboard
  weekly dots stayed Bengali even though the table looked complete. Match the
  exact form the formatter emits, not the word you expect it to.
- The dashboard builds most of its copy around a live count (`🎯 আজ আর 58টি প্রশ্ন
  বাকি`), so `DICT` can never hold those — they belong in `RULES`. Audit both the
  empty and the populated data states: the two branches render different
  sentences, and a state-blind audit misses half of them.

## FCM notification system (all 5 phases / 8 stages built)

`FCM-NOTIFICATION-BLUEPRINT.md` is the owner-locked 5-phase blueprint for
the FCM + Cloudflare smart notification system (Foundation → Global
topics → Personalized → Events/Automation/Analytics → AI/Scale/Hardening).
Owner decisions: NO Vercel — backend = Cloudflare Worker + D1 `PROFILE_DB`;
Telegram stays backup. **Phase 1 is DEPLOYED to production (Pages 70220493,
admission-gk 1406fb48)** and awaiting the owner's on-device confirmation
(enable FCM push → receive test notification).
Do NOT start Phase 2 work before the owner confirms Phase 1 works on a
real device.

All eight stages are implemented and green in-repo: foundation (permission +
token lifecycle), global fanout, personalization, event notifications,
daily/weekly/monthly digests, open/click analytics, and the Phase 5 pair —
quota-aware resumable fanout + AI-scored send timing (`send-planner.mjs`).
`docs/FCM-PHASES-EXPLAINED.md` maps the owner's 8 stages onto the 5 blueprint
phases. The production-deploy gate still stands: a phase is only "done" once
its output is verified on production and the owner confirms.

SECURITY: the R2 account id must NEVER be hardcoded — read it from the
`R2_ACCOUNT_ID`/`CLOUDFLARE_ACCOUNT_ID` Worker secret via `r2Host(env)`.
A real id was committed in `files-storage.mjs` + `worker-bundle.mjs`; both
are scrubbed and `files-storage.test.mjs` guards the binding. Do not print or
paste any `ADMISSIONHUB_*` secret value.


 Phases are gated: a phase is done only when its
Output is verified on production, tests are added and green, the full gate
passes, and the
owner confirms — only then may the next phase begin. It extends (never
replaces) the existing Telegram channel + `NotificationHub` in-app system.

## Dual-language UI rule (owner mandate, 2026-09-16 — permanent)

Every piece of NEW UI text (buttons, rows, toasts, sheet/modal copy) must be
written in BOTH Bengali and English, and only the user's active language is
rendered — both languages must NEVER be visible at the same time.

Mechanics (the global i18n engine, index.html):
- Static markup: elements carry `data-bn` + `data-en` (placeholders:
  `data-ph-bn`/`data-ph-en`, aria: `data-aria-bn`/`data-aria-en`); the
  engine's `apply()` picks the active language.
- Dynamically rendered HTML: after inserting it, call
  `window.AhI18n.apply(container)`; or pick the language yourself with
  `window.AhI18n.get()` (returns `'bn'` default / `'en'`) and render one.
- Copy style: official, short, polished (casual/tutorial tone is banned).
Reference implementation: `openSheet()` in `notification-hub.js`
(`SHEET_I18N` table + `sheetT()` helper).

## Deployment access

- `wrangler pages deploy dist --project-name admissionhub --branch main` with
  `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` is the working deploy path.
  In sessions where neither variable is injected (verify with
  `echo ${CLOUDFLARE_API_TOKEN:+SET}` before blaming wrangler ÔÇö it reports only
  "necessary to set a CLOUDFLARE_API_TOKEN"), defer the deploy.
- GitHub Actions dispatch is unavailable on this repo: the API returns
  `422 Actions has been disabled for this user`, so the manual
  `workflow_dispatch` publish cannot be triggered with the PAT either. A session
  with no wrangler credentials therefore cannot publish, only commit and push.
- The GitHub PAT in the remote URL can stop working mid-session even though
  pushes succeeded earlier (reflog shows prior `update by push`). A 404 from
  `api.github.com/repos/<owner>/<repo>` while the token itself is valid means
  the repo is gone/renamed or the token's account lost access — it is not a
  push-format problem. Confirm with `GET /user` (token identity) before
  retrying; the deployed site can still ship via wrangler without GitHub.

## FCM / web push

- Two independent faults block push, and fixing the first hides the second:
  1. `/firebase-messaging-sw.js` must exist at the site root (the SDK registers
     that exact path itself). Missing file => `failed-service-worker-registration`.
  2. The SDK registers the SW but **subscribes without waiting for it to
     activate**; on a cold first enable `pushManager.subscribe()` throws
     `no active Service Worker` (error 20). `notification-fcm.js` therefore
     registers the SW itself, waits for `reg.active`, and passes the ready
     registration to `getToken({ serviceWorkerRegistration })` on all three
     paths (enable / disable / refresh). Do not "simplify" that back to a bare
     `getToken()`.
- `vapidKey` is optional: the SDK falls back to its built-in default
  (`BDOU99-h67H...`). An empty `vapidKey` from `/api/notifications/config` is
  not by itself a failure. It cannot be read from any API either — neither the
  FCM v1 REST API nor the Firebase Management API exposes the Web Push
  certificate; it exists only in the Firebase Console, so treat it as
  Console-only and never block a deploy waiting for it.
- The compat SDK exposes **no** `useVapidKey()` / `useVapidKeyIfAvailable()`.
  Verified against the vendored `sdk/firebase-messaging-compat.js` (10.12.2):
  the string does not appear at all, so any branch calling it is dead code and
  the configured key silently never applies. The key must be passed as
  `getToken({ vapidKey })`.
- A real FCM token IS obtainable in this sandbox — the earlier "impossible here"
  note was wrong. Headless Chromium refuses push only because Playwright's
  default context is incognito-like; `launch_persistent_context(dir, ...)` with
  `permissions: ['notifications']` yields a real token. That is the only way to
  exercise the whole client path before shipping. To test the page as it is
  deployed, serve the repo over localhost and `ctx.route()` `/api/notifications/**`
  through to the real worker; the session cookie is then absent, so expect
  `register-401` — reaching 401 is success, it proves the token was created and
  POSTed.
- `firebase-messaging-sw.js` must not call `onBackgroundMessage` when payloads
  carry a `notification` block: the SDK already calls `showNotification()`
  itself, so adding a handler produced two notifications per push.
- Background FCM display happens on the push-scope worker
  (`firebase-messaging-sw.js`), not on `sw.js`: an FCM subscription lives on that
  registration, so the `push` handler in `sw.js` never sees these messages.
  Likewise `navigator.serviceWorker.ready` resolves to the *shell* worker, so
  listening only there silently drops every foreground message — attach the
  `message` listener to every registration instead.
- Cached FCM state lives under `ahFcmEnabled` / `ahFcmLastErr` in localStorage;
  read `ahFcmLastErr` first when diagnosing an owner report. It carries a
  `detail` field with the raw browser/SDK message; without it every distinct
  failure collapses into one unactionable code.
- A KV probe is the cheapest proof of whether a device ever registered: an empty
  `fcm:reg:*` prefix in `GK_KV` means the request never reached the server, so
  the fault is client-side and no amount of worker/secret checking will help.
- Two failure modes are pre-existing on `main` and unrelated to FCM work:
  `p11-dashboard-v2` (2 assertions) and the `dash2f10-main-ai` pins asserted by
  `p13`/`p16`/`p18`/`p21`/`startup-ai-regression` (the repo carries
  `dash2f13-theme`). Confirm any of these against a pristine `git worktree add
  /tmp/base HEAD` before blaming your own change.
- Bumping `BUILD_ID` requires updating every pin at once: `sw.js`, `index.html`
  (3 spots), the `SHELL_VERSION` const in `interactive-native-personal-v1.test.mjs`,
  *and* the `grep -Fq "const BUILD_ID = ..."` assertion in
  `.github/workflows/telegram-auth-canary-activate.yml`. `npm run sw:manifest`
  then rewrites the digests. Miss the workflow file and that test fails only in
  a full-suite run, not when run alone.
- `D1Database.batch()` takes `D1PreparedStatement`s, never raw SQL strings.
  Passing strings throws `D1_ERROR: Malformed input: [{}], should be {sql:
  string, params?: any[]} ...` and aborts the whole sequence. This is how
  `FcmStore.#ensureTables()` silently prevented every push for a day: the
  `CREATE TABLE` batch threw, so `fcm_devices` was never created and every
  register-token write failed. Always wrap DDL in `d1.prepare(...)` before
  batching it.
- Corollary: any D1 test double must *reject* raw strings with that same error.
  A fake that accepts them (`// schema DDL is a no-op here`) turns a
  production-breaking bug into a green suite — the FCM double did exactly that
  for the `batch()` mistake above.
- When a "push never arrives" report reaches you, check the *server* before the
  client. Absent `fcm_devices` / `notification_settings` tables in production D1
  mean registration never succeeded, whatever the client logs say. A non-zero
  `fcm:reg:<user>` counter in `GK_KV` alongside missing tables proves the
  request reached the worker, authenticated, and then died in the store.
- The fastest way to settle a Cloudflare-runtime question (D1 semantics, binding
  behaviour) is a throwaway worker bound to the real resource, deployed, curled,
  then `wrangler delete`d. That produced the definitive `batch()` evidence in
  minutes; reading the docs alone would not have.
- "The server accepted the push" and "the user saw something" are different
  questions — prove them separately. A live HTTP v1 send returning
  `projects/<id>/messages/<uuid>` means FCM took the message; it says nothing
  about display. The v278 report ("enable works, nothing arrives") was entirely
  the second question: `.toast` carried `z-index:100` while the sheet that
  triggers the test renders in `#modalRoot` (`z-index:2000`), so every
  confirmation and every foreground push appeared *behind* the open sheet. When
  feedback is reported missing, check the z-index of the surface that carries it
  against the surface that was open at the time.
- The foreground-push display surface is `.toast` (via `window.toast`). If you
  add another one, keep it above `#modalRoot`/`.modal-bg` too, and extend the
  `notif-sheet.test.mjs` z-index assertion rather than adding a parallel check.
- Payload `src` values are a family, not a single token: the worker sends
  `fcm-welcome`, `fcm-test` and `fcm-self-test`. Service workers must match the
  `fcm` *prefix* — an `=== 'fcm'` test silently sends every tapped notification
  to the default URL. Both `sw.js` and `firebase-messaging-sw.js` handle
  `notificationclick`, so a routing change belongs in both.
- `/internal/notifications/*` is matched by exact path in
  `handleFcmNotificationRequest` (`path === '/internal/notifications/health'`).
  A new `/internal/...` diagnostic returns `null`, falls through to the app
  guard, and answers `403 forbidden` — widen the `isInternal` test while the
  diagnostic exists, and put the exact-path form back when you remove it.
- Two public hosts look like the app but are not: the legacy GitHub Pages
  mirror `sheikhrashel47-stack.github.io/admission-hub-demo` is fully dead
  (every path, including `/index.html` and `/api/...`, returns GitHub's 404),
  and `admission-hub.pages.dev` (hyphenated) serves a stale bundle with no
  auth backend, so `/api/auth/v1/*` answers 405 HTML. The only working origin
  is `admissionhub.pages.dev`. When an auth step dies on a mirror the browser
  receives HTML rather than JSON — `api()` in `account-access.js` labels that
  `ENDPOINT_UNAVAILABLE` so the banner names the wrong host instead of showing
  the generic "সাময়িক সমস্যা" dead end.

## Push delivery: FCM HTTP v1 takes ONE token per send

The global-notification fallback used to POST `{message:{tokens:[...]}}` to
`/v1/projects/<p>/messages:send`. That body belongs to the *batch* endpoint
(`:sendEachForMulticast`, a different URL). Every fallback request got a 400,
so devices that never subscribed to the topic received nothing while the stored
`global_notifications` row still read `sent` and `reachEstimate` counted them.
The failure was invisible because `res.ok` alone was checked.

Rules to keep this correct:
- One request per device: `{message:{token:'<one>', notification, data}}`.
  `fcmSendOne` is the only sender; `fcmSendToTokens` fans out with bounded
  concurrency (`FCM_SEND_CONCURRENCY`) and stops at `FCM_FALLBACK_MAX`.
- `fcm-global.test.mjs`'s stub rejects a `tokens` body with 400, so reverting to
  the array shape fails the suite instead of silently "passing".
- `fcm_devices.topics` is a comma-separated list matched by WHOLE name
  (`activeDevicesMissingTopic` splits it). A bare `LIKE %topic%` would treat
  `course_beginner` as subscribed to `beginner`.
- Client topic subscribe is best-effort and no-ops without a VAPID key, so the
  admin send path also records the sender's own device topic from
  `payload.deviceToken` (`window.AhFcm.getToken()`).

## Deploying without GitHub

The repo lives at `rashelmahmudpc-create/admission-hub-demo` (default branch
`main`). `sheikhrashel47-stack/admission-hub-demo` no longer exists (404), so any
`sheikhrashel47-stack` remote is dead. The in-session `GITHUB_TOKEN` may be
absent; a PAT with `repo`+`workflow` works for the push.

Cloudflare is reachable directly, so ship both halves by hand when CI is not
enough:

```
# worker
CLOUDFLARE_API_TOKEN=... npx wrangler@4.35.0 deploy
# pages (rsync is absent in this image — use tar)
tar -cf - --exclude='./.git' --exclude='./node_modules' ... ./ | (cd dist && tar -xf -)
CLOUDFLARE_API_TOKEN=... npx wrangler@4.35.0 pages deploy dist \
  --project-name=admissionhub --branch=main
```

Without `--branch=main` the deploy lands as a preview and `admissionhub.pages.dev`
keeps serving the old bundle. Verify with
`curl -s https://admissionhub.pages.dev/ | grep -o 'notification-admin.js?v=[^"]*'`.
An asset can keep the same `?v=` query across a real content change, so a
plain edit ships stale behind the browser/service-worker cache. **Bump the
query string** (`notification-admin.js?v=admin-notif-v7` -> `v8`) and run
`npm run sw:manifest` before every client deploy, then confirm the change is
really live (`curl -s https://admissionhub.pages.dev/notification-admin.js?v=admin-notif-v8 | grep -c keyboard-inset`).

## Deploys shipped (2026-09-24)

| Half | Version | Notes |
|---|---|---|
| Worker `admission-gk` | `1caafb52-bcea-4077-8212-72650ae516ef` | FCM Phases 4-5 + `R2_ACCOUNT_ID` secret set |
| Pages `admissionhub` | main (v8 assets) | admin keyboard fix + cache bump |

Set `R2_ACCOUNT_ID` on the worker (`wrangler secret put`) or the R2 usage
probe reports "unknown" (fail-soft; uploads still work).


The working credential pair (verified 2026-09-24) is the injected secret
`ADMISSIONHUB_CLOUDFLARE_API` as the token and `ADMISSIONHUB_CLODFLARE_ACCOUNT_ID`
(note the spelling) as the account id — pass them as `CLOUDFLARE_API_TOKEN` /
`CLOUDFLARE_ACCOUNT_ID` to wrangler. The env-api pair is **not** a Cloudflare
token/account; use the Cloudflare pair above.

The Pages project `admissionhub` is not Git-connected (`source: null`), so a
push to `main` does not rebuild it — every client release is a manual
`pages deploy`. Build the sanitized bundle with `python3` (no `rsync` in the
image): copy the tracked tree minus `.git`, `node_modules`, `dist`, `docs`,
`AGENT_RESUME`, `ai-proxy`, `auth*`, `email-gateway`, `uploads`, `.github`,
`*worker*.js`, `wrangler.toml`, `package*.json`, `*.test.mjs`, `*.md`.

The `workflow_dispatch` deploy pipelines currently cannot run: the repo and both
environments (`github-pages`, `email-gateway-production`) have zero Actions
secrets, so `verify-firebase-config.mjs` aborts with `code=API_KEY_MISSING`. Do
not rely on those workflows until the owner configures secrets.

## Notification delivery invariants (owner bug reports 2026-09-24)

Three production bugs were root-caused from live D1 data and fixed. Keep these
invariants when touching `fcm-notification.mjs` / `notification-admin.js`:

- **One phone = one push.** `fcm_devices.id` is `hash(userId|token)`, so one
  physical device signed into several accounts is several rows. `fcmSendToTokens`
  now de-dupes by `fcm_token` before sending and `activeDeviceCount` counts
  `COUNT(DISTINCT fcm_token)`. Never fan out on raw rows.
- **Icon is the live logo, never a literal.** The FCM payload carries no icon by
  default, so Android showed the OS default "A" avatar. Both send paths set
  `webpush.notification` + `android.notification` icon/badge from the absolute URL
  of `/icons/icon-192.png` (`iconAbsolute(request)`). To change the logo shown in
  notifications, replace that file — no code change, no redeploy.
- **Send and schedule are different dedup intents.** The dedup key used to be
  `type|title|body`, so a test-send of some text made the real scheduled copy of
  the same text impossible to create (409) for 10 days; as a result the
  `global_notifications` table had zero `scheduled_at` rows ever. The key now
  includes the mode (`|now` / `|scheduled|<time>`). A cron sweep also fails rows
  stuck in `status='sending'` (worker killed mid-send) so history never lies.
- **Notification images come from R2.** `POST /api/notifications/global/image`
  (admin Bearer) stores the bytes under `notify/<day>/` and returns a same-origin
  `/api/files/<key>` URL. The admin panel picks a photo from the phone and
  re-encodes it on a canvas first (max 1200px, JPEG 0.85) so a camera shot fits
  the server's 4 MB cap.


## Client button integrity (owner bug report 2026-09-24)

Buttons that "do nothing" are almost always inline handlers calling a function
that no longer exists after a refactor. `dead-handler-guard.test.mjs` scans all
shipped client JS plus `index.html` for `onclick`/`oninput`/etc. attributes that
reference an undefined global, and fails the build on a match. Run it via
`npm run test:ui-guards` (also folded into `test:production-auth`).

- When you remove or rename a global that inline HTML calls, the guard catches
  it. Never silence it by adding a name to `BUILTINS` unless it truly is a
  browser builtin.
- The guard found `openQuestionDetail` (Question Bank "Show Answer") — defined
  nowhere, so every feed card's button was dead. Its real implementation now
  lives in `urgent-fix.js` and renders the answer in the shared `openModal`.
- Inline handlers resolve names at click time from the global scope, so a
  handler defined inside an IIFE is invisible unless it is assigned to `window`.

## Student data: pre-account (legacy) record adoption

`index.html` scopes every IndexedDB record as `DATA_SCOPE::id` with `__ahOwner`,
and `fromScopedRecord` returns `null` for rows owned by a different (or empty)
scope. Rows written before per-account scoping therefore looked wiped on sign-in.

`legacy-adoption.js` (`window.AHLegacyAdoption`) runs once per account, from the
`admissionhub:authchange` handler **before** `seedIfEmpty`, and relabels unscoped
rows in place. Invariants to keep:

- **Relabel, never copy/delete.** The adopted doc is exactly what
  `toScopedRecord` produces, so the physical row count per store is unchanged.
- **Never overwrite account rows.** Same bare id already owned by the account
  means the legacy row is skipped, not merged.
- **Never cross accounts.** Only rows with `__ahOwner === undefined` are
  eligible. Guest rows live in `MEMORY_DB` (session-only) and are cleared on
  sign-out without being adopted.
- **Idempotent + retryable.** A per-account localStorage flag
  (`ahLegacyAdopt:v1:<scope>`) stops re-runs; a store whose write fails is left
  untouched and retried on the next sign-in.
- **Snapshot first, then sync.** A `pre-legacy-adoption` snapshot is taken
  before writes, and each adopted row is announced via `announceLocalWrite` so
  the rescue reaches the cloud instead of staying local-only.
- Raw access lives in `dbScanRaw` / `dbRelabelRaw`, kept separate from the
  scoped `dbGet*` API. Do not loosen `fromScopedRecord` to accept unscoped rows
  -- that would leak one account's data to another.
- Tests: `npm run test:legacy-adoption` (unit + integration against the real
  scoping functions + real IndexedDB via fake-indexeddb).

## AI routes: the gk → public dispatcher env allowlist

`/api/ai/*` is served by `public-worker.js`, but the live Worker is
`gk-agent-worker.js` (name `admission-gk`). Requests are forwarded, and the
`env` the public handler receives is a **hand-built allowlist** (`envPub` in
`gk-agent-worker.js`), not the Worker's full environment.

Consequence: **binding a secret or var is not enough — its name must also be in
`envPub`.** A binding missing there reads as `undefined` downstream no matter
how correctly it was set. This bit twice in one session:

- `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_AI_API_KEY` / `AGENT_CLOUDFLARE_MODELS`
  (Phase 9 M2.5) — the Cloudflare backup stayed invisible
  (`providers.cloudflare: false`) after the secrets were bound and redeployed.
- `USE_CONTEXT_ENGINE` (Phase 9 M4) — enabling the Context Engine had no effect;
  `agentStatus.context` stayed `{ enabled: false }`.

When adding anything the AI path reads from `env`, add it to `envPub` in the
same change, and extend the `account-retirement` guard
(`dispatcher forwards every anonymous-AI provider binding`) so it cannot
regress. Keep the list minimal: it is also the boundary that keeps account
secrets (`GOOGLE_CLIENT_SECRET`, Twilio, mail providers) away from the public AI
handler.

**Deploy propagation:** a `wrangler deploy` can take a minute or two before the
new version serves every edge. A status probe right after deploy may still show
the previous behaviour; re-check before concluding a change did nothing.

**Workers Free variable ceiling is 64** (secrets + text). This Worker sits on it.
Adding a var therefore requires removing one; `AGENT_CLOUDFLARE_MODELS` was
dropped in favour of `USE_CONTEXT_ENGINE` because the router already defaults to
the identical `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.

## Student profile → AI context: sanitize twice, consent once (Phase 9 M4.1)

The signed-in student's academic profile reaches the Context Engine at SUMMARY,
but identity fields must never leave the browser. Two gates, both required:

1. **Client** (`ai-agent-chat.js` → `localProfile()`/`profilePayload()`) projects
   the cached profile down to academic fields. A projection is an allowlist: it
   reads named fields only, so a new PII field on the profile cannot leak by
   default.
2. **Server** (`ai-agent.js` → `sanitizeProfileContext()`) re-sanitizes the
   request body, drops every unknown key, and only runs for an `account-` uid.
   A hand-crafted request cannot smuggle a field past the client, and a guest
   uid resolves `profile` to NONE even with a payload attached.

A client-side projection is never sufficient on its own — the server is the only
gate the user cannot edit.

**The first name is automatic — no setting.** The AI greets the signed-in student
by first name with zero setup; there is no toggle anywhere in the UI. Only a
single name token passes, so a full name is rejected even if one is sent. All
other identity fields (mobile, email, DOB, bio, public AH-ID) never leave the
device. Do not reintroduce a name-sharing preference: it made the AI feel harder
to use, and a stale stored `false` from an earlier build would silently keep the
name off for existing accounts.

**New UI copy must be added to `language-engine.js`'s `DICT` in the same change** —
`language-engine.test.mjs` scans `profile-ui.js` and fails on any Bengali literal
without an English key.

## System prompt lives in the registry, not inline (Phase 9 M5)

`buildSystemPrompt()` in `ai-agent.js` starts from `getPromptText(BASE_PROMPT_ID)`;
the actual wording lives in `prompt-registry.js` as a frozen `v1` entry with
`promptId / version / purpose / createdAt / status`, plus a `legacyVersion` alias
to `SYSTEM_PROMPT_V`.

- **Never edit the prompt text in `ai-agent.js`** — it is no longer there. Change
  `prompt-registry.js`, and add a new version entry rather than overwriting `v1`.
- The composed base prompt is pinned by SHA-256 in
  `phase9-m5-prompt-registry.test.mjs` (2044 bytes). Any wording change must
  update that hash deliberately — an accidental drift fails the suite.
- Conditional blocks (onboarding, exam mode, quiz, prefs, stats) still append on
  top of the shared base in `buildSystemPrompt()`; keep them there, not in the
  registry.
- `prompt-registry.js` is pure data plus helpers: no `env`, no I/O, no worker API.

## Tools are declared, never executed yet (Phase 9 M6)

`tool-registry.js` declares tools and enforces cross-user isolation at the tool
boundary (finding S6). It is pure data plus pure guards — no `env`, no I/O.

- **Nothing executes.** The chat path in `ai-agent.js` must not call
  `authorizeToolCall()` until a later, owner-approved step wires execution. A test
  (M6-১৩) fails if `executeTool`/`runTool`/`invokeTool`/`authorizeToolCall`
  appears in `ai-agent.js`.
- **Owner comes from the uid alone.** `resolveToolOwner()` accepts only an
  `account-` uid. Never trust an owner supplied by the model or the request body;
  `authorizeToolCall()` rejects eight owner-ish argument keys and returns the
  caller as the owner, and `guardToolResult()` blocks any result whose `ownerUid`
  does not match the caller.
- **READ-only is the ceiling.** `validateToolRegistry()` fails if any non-READ
  tool is enabled; WRITE/EXECUTE stay off until M9. Every tool must be
  `ownerScoped: true`.
- Adding a tool means adding a full declaration (name/description/permission/
  inputSchema/outputSchema/riskLevel/enabled); the validator rejects partial ones.

## Memory is a typed engine, automatic for accounts, closed to guests (Phase 9 M7)

`memory-engine.js` adds the long-term memory layer the audit called missing. The
short-term layer (`chatmem:<uid>`, rolling window, `summarizeTo`) is unchanged.
It is pure data plus pure guards — no `env`, no I/O, no model call.

- **Owner override.** The plan's M7 gate was "default OFF, explicit consent"; the
  owner overrode it. Long-term memory is automatic for a signed-in student with
  **no toggle, no prompt and no expiry**. `sanitizeAiPrefs()` no longer accepts a
  `memory` field, and the AI Personalization sheet has no MEMORY switch. Do not
  reintroduce a toggle without an owner decision.
- **Guests have no memory.** `resolveMemoryOwner()` returns a uid only for an
  `account-` prefix. Guest AI is refused outright: `agentChat` returns
  `401 sign_in_required` before parsing, and the chat client + quiz generator stop
  before the request. `identity.uid` alone is the owner — never the body.
- **No PII.** `isPiiFree()` rejects email, BD mobile, long digit runs, dates and
  password/OTP/PIN/CVV wording. A record is checked at both write and read.
- **Isolation is a second gate.** `parseMemory()`/`upsertMemory()`/
  `guardMemoryRecord()` drop any record whose `ownerUid` is not the caller.
- **Only three kinds** are storable: `studies`, `preference`, `habit`. Confidence
  must be ≥ `CONFIDENCE_MIN` (0.7); `MAX_RECORDS` (500) bounds storage and
  `RENDER_LIMIT` (24) bounds the prompt.
- **Both extraction triggers** live in `extractMemoryCandidates()`: an explicit
  "মনে রাখো" and a study/preference/habit fact stated in passing. A candidate
  still has to clear `makeMemory()`.
- `agentStatus` advertises `memory: { version: 'mem-v1', mode: 'auto',
  scope: 'account-only' }` — metadata only; the prompt base and its SHA-256 are
  untouched.

## Responses are validated before render, high-precision only (Phase 9 M8)

`response-validator.js` checks every model response on four dimensions — schema,
safety, data, action — and returns a structured envelope
`{version, type, message, insights, recommendations, actions, confidence}`. It is
pure data plus pure guards — no `env`, no I/O, no model call. `ai-agent.js` runs it
inside `finalize()` (persist decision) and around the provider loop (returned
text); the client learned one new SSE frame.

- **Rewriting is deliberately rare.** Only six classes replace the text: schema,
  internal-leak, credential-request, secret-material, action-claim, false-success.
  `invented-stats` and `quiz-contract` are recorded, never rewritten. A guard that
  rewrites a legitimate academic answer is worse than the risk it covers — so if
  you add a pattern, it must be self-disclosure shaped, not keyword shaped, and
  must ship with a passing counterpart test.
  - "My system prompt is …" blocks; *"System prompt কী?"* passes.
  - "তোমার OTP দাও" blocks; "লগইন করতে password দাও" passes (`APP_TARGET_RE`
    recognizes instructions aimed at the app's own field).
  - "ভেরিফিকেশন হয়ে গেছে" blocks; "ভেরিফিকেশন সফল হলে ইমেইল পাবে" passes.
  - `invented-stats` needs a *provided* value to contradict; with no stats the
    claim is a guess, not proof.
- **No new Worker variable.** `wrangler.toml` is at the 64-var cap, so enforcement
  is the `ENFORCE` constant in the module (currently `true`), not a binding.
- **A blocked reply is never persisted.** `finalize()` returns early unless
  `validateResponse(...).persistable`; an unsafe reply cannot become a conversation
  turn or a memory record. Guards run after the guest `401` gate, so guests are
  still refused before anything is parsed.
- **Streaming uses `event: replace`.** Text is already on the wire when the full
  reply is known, so the server sends the safe text in a `replace` frame before
  `done`; the client swaps it in via `textContent` (never `innerHTML`). A clean
  stream emits no `replace` frame.
- **Shape stays backward compatible.** `text`/`intent`/`pv`/`agent`/`authoritative`
  are unchanged; `structured` is additive. Envelope `actions` stays empty until M9.
- `agentStatus` advertises `response: { version: 'rv-v1', enforced: true,
  classes, blocking }`.

## Write/execute actions ship OFF and need a single-use confirmation (Phase 9 M9)

`action-engine.js` is the write/execute permission layer the audit called missing:
READ/WRITE/EXECUTE are separate classes, WRITE/EXECUTE are off by default, every
action needs an explicit confirmation, and every attempt is audited. Like M6/M7 it
is pure data plus pure guards — no `env`, no I/O, no model call. The Worker's
`/api/ai/actions/*` routes do the KV writes; the engine only decides whether they
may happen.

- **The layer is OFF.** `ENABLED` is `false`, so the three routes refuse with
  `layer-disabled` and the chat advertises `actions.enabled: false`. Do not flip
  it without an owner decision. `validateActionEngine()` fails if any action would
  be live while the switch is off.
- **`ready` ≠ enabled.** `prefs.write` is declared `ready: true` (the declaration
  is complete) but `listActions()` reports `enabled: ENABLED && ready`, so it stays
  inert. Turning it on is a separate, owner-approved step that also needs a
  confirmation UI in the chat.
- **Confirmation is mandatory, short-lived, single-use.** A proposal carries
  `expiresAt = now + 5 min`. `confirmProposal()` checks the layer, the caller's
  ownership, the token and the expiry. The Worker deletes the stored proposal
  *before* the write, so a replayed token finds nothing (`no-proposal`).
- **Owner is the server-validated uid, never the body.** `resolveActionOwner()`
  only accepts an `account-` prefix. `sanitizeActionArgs()` *rejects* (does not
  strip) a payload naming an owner, and keeps only declared argument keys.
- **Every attempt is audited** under `actaudit:<uid>`: `proposed`, then
  `confirmed` / `denied` / `expired` / `failed`. `parseAudit()` keeps only the
  caller's own records and treats corrupt history as empty; history is bounded at
  `MAX_AUDIT` (200).
- **Guests leave no trace** — all three routes return `401 sign_in_required`
  before reading a body or touching KV.
- `agentStatus` advertises `actions: { version: 'act-v1', enabled: false,
  confirmTtlMs, declared }` — shape only, never a capability.

