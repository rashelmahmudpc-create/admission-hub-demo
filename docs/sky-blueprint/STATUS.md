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
- **F0.2 / DV-02 — Doing.** ✅ `sky-ai/flags.mjs` (+tests), `GET /api/ai/sky-flags`, all defaults OFF.
  **Left:** wire flags into admission-gk routing, create `SKY_FLAGS` KV binding.
- **F0.3–F0.8 — Todo.**
- **Next:** F0.1 step 4a — flag-gated proxy in admission-gk (empty allowlist,
  fallback to local handler on sky-ai 404/5xx), with tests.

## Work log (append at the bottom)
- 2026-10-19 · — · Blueprint v1.0 created (Notion).
- 2026-10-20 (approx.) · F0.1 steps 1–3 + F0.2 flags.mjs · merged to main, sky-ai deployed · (Notion not updated at the time).
- 2026-10-21 23:20 · handoff system · Notion board + pages 07/09 updated, this file added · next: F0.1 step 4a.
