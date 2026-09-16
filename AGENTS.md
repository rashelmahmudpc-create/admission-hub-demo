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

## FCM notification system (LOCKED blueprint — not started)

`FCM-NOTIFICATION-BLUEPRINT.md` is the owner-locked 5-phase blueprint for
the FCM + Cloudflare smart notification system (Foundation → Global
topics → Personalized → Events/Automation/Analytics → AI/Scale/Hardening).
Owner decisions: NO Vercel — backend = Cloudflare Worker + Durable
Objects DB; Telegram stays backup. Only open item: owner creates the free
Firebase project. Do NOT start implementation until a phase is explicitly
released. Phases are gated: a phase is done only when its Output is verified
on production, tests are added and green, the full gate passes, and the
owner confirms — only then may the next phase begin. It extends (never
replaces) the existing Telegram channel + `NotificationHub` in-app system.

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
  the repo is gone/renamed or the token's account lost access ÔÇö it is not a
  push-format problem. Confirm with `GET /user` (token identity) before
  retrying; the deployed site can still ship via wrangler without GitHub.
