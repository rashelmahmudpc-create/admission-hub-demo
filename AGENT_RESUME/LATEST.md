# LATEST — এক স্ক্রিনে ফিট, কিন্তু কিছুই লুকানো নেই (v247)

**Updated:** 2026-09-14 (Asia/Dhaka) · Agent: **Arena Agent Mode**

## STATUS

- **IMPLEMENTED:** The Welcome still fills exactly one viewport on every device (320×568 → 1920×1080, zero overflow) — but **nothing is hidden any more**. All four benefit cards (Learn / Practice / Improve / Achieve), the brand header, the journey console and all four entry paths stay visible on every screen; they only get smaller. The four entry buttons never scale down (46–58px, Guest 44px+).
- **HOW:** the upper content lives in a `.ah-welcome-fit` box that reserves its own scaled height (`fitWelcomeView()` sets `--ah-fit` + an explicit box height and scales only the inner layer from its top), so a scaled layout can never clip or slide under the buttons. Every size is a `vh`/`vw` clamp; only decorative items (landscape art, tagline, console micro-labels) hide on very short screens.
- **TESTED:** auth 62/62 · email 108/108 + 4/4 · native-auth 203/203 · browser audit pageErrors 0 · 13/13 viewports fit with 4/4 benefit cards visible and every button ≥44px · 53/53 release file asserts.
- **HARDENED:** `fit-check.mjs` now fails (exit ≠ 0) if any viewport scrolls, any benefit card is hidden, any entry path drops below 44px, or the stack leaves the viewport.
- **DEPLOYED:** pending the publish run after merge.

## DETAIL

- `AGENT_RESUME/2026-09-14-fit-all-content-v247.md`
- History: v244 (premium scene rebuild, reverted by owner) → v245 (3D hero removed, original design kept) → v246 (one-screen fit, but benefits hidden on mobile — rejected) → v247 (one-screen fit with zero hidden content).
