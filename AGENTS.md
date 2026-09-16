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

## Testing

- `node --test seo-routing.test.mjs` — routing/404 contract.
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
  rendering it — the v267 `green`/Premium Green bug.
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
  - Bengali must be NFC-normalised before dictionary lookup: য় is either U+09DF
    or য + ়, and the two look identical. A naive comparison silently misses
    entries — this cost 36 account strings when first written.
  - `language-engine.test.mjs` fails when the account or profile UI renders a
    Bengali string the table lacks, so the guard catches untranslated copy added
    later.
- The language and appearance engines each keep their own `localStorage` key
  (`ahLang`, `ah-appearance`) while `profile-ui.js` keeps the synced preference
  in `ah-profile-prefs-v1`. Only the profile picker writes both, so boot
  reconciles them (`reconcilePreferencesAtBoot`). Direction matters: with no
  preference saved the engine key is the real choice and seeds the preference,
  otherwise first run overwrites the user with defaults.

## Deployment access

- `wrangler pages deploy dist --project-name admissionhub --branch main` with
  `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` is the working deploy path.
  In sessions where neither variable is injected (verify with
  `echo ${CLOUDFLARE_API_TOKEN:+SET}` before blaming wrangler — it reports only
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
