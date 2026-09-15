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
