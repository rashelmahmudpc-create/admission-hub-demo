# Sky AI — Agent Handoff Status (READ FIRST)

Source of truth: Notion "Sky AI v1.0" → main page section **"🚦 এজেন্ট হ্যান্ডঅফ বোর্ড"**
(https://app.notion.com/p/3fe578b86589812da119f975cdf1881a). This file mirrors it.

## Rules for every agent (mandatory)
1. **Before starting:** read the Notion handoff board, the task status in
   Notion page 07, this file, and the task doc `docs/sky-blueprint/<task>.md`.
   Verify against real files / live URLs. Never redo a step marked ✅ or 🟡-done.
2. **After every finished step (immediately, before reporting):**
   - update "Current status" below and on the Notion board,
   - add one line to the work log: `date time · task ID · what · commit/PR · next step`,
   - mark the task in Notion 07 (🟡 Doing / ✅ Done; tick the checkbox only when fully Done).
3. **Out of time (Study Lock 23:00–23:59 Dhaka):** still write
   "🟡 Doing — where I stopped, which branch/PR".
4. **Mismatch:** repo / live URL wins over Notion. Fix Notion first, log it as a correction.

## Current status (2026-10-21 23:20 Dhaka)
- Phase: **F0 — Doing**
- **F0.1 / DV-01 — Doing.** Steps 1–3 ✅: `sky-ai/` Worker live
  (https://sky-ai.admissionhub.workers.dev/health), `sky-ai-deploy.yml`,
  `SKY_AI` service binding in admission-gk forwarding only `GET /api/ai/sky-health`.
  **Left: step 4** — move `/api/ai/*` routes one by one behind a flag, `/api/ai/chat` last
  (provider secrets must be added to sky-ai by the owner). See `F0.1-DV-01.md`.
- **F0.2 / DV-02 — Doing.** ✅ `sky-ai/flags.mjs` (+tests), `GET /api/ai/sky-flags` in sky-ai,
  ✅ **2026-10-24: admission-gk now answers the route** (`public-worker.js`, forwarded with the
  uid via `SKY_AI_IDENTITY_ROUTES`; a guest keeps the all-off defaults). Live check the same
  night showed the public URL answering 404 before this change. All defaults OFF.
  **Left:** deploy `admission-gk`, create the `SKY_FLAGS` KV namespace + binding on sky-ai
  (override needs it; without it the defaults apply), then use a flag for real routing.
- **F0.3–F0.8 — Todo.**
- **Next:** deploy this branch's worker, add the `SKY_FLAGS` KV binding, then continue
  F0.1 step 4 — move the remaining `/api/ai/*` routes into sky-ai one at a time, `/api/ai/chat` last.

## Work log (append at the bottom)
- 2026-10-19 · — · Blueprint v1.0 created (Notion).
- 2026-10-20 (approx.) · F0.1 steps 1–3 + F0.2 flags.mjs · merged to main, sky-ai deployed · (Notion not updated at the time).
- 2026-10-21 23:20 · handoff system · Notion board + pages 07/09 updated, this file added · next: F0.1 step 4a.
- 2026-10-24 23:2x · F0.2 · `GET /api/ai/sky-flags` was 404 on the public host: sky-ai has served it
  since F0.2, admission-gk had no handler. Added the handler (`forwardWithIdentity`, guest keeps
  all-off defaults), listed the route in `SKY_AI_IDENTITY_ROUTES`, +2 pins, worker bundle rebuilt,
  sky-ai suites 24/24 · `4b467b3` on `cline/yc69z6y0` · next: deploy (worker creds absent in that
  session) + `SKY_FLAGS` KV binding.
