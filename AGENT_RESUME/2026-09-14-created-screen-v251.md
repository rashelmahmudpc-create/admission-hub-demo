# v251 — "Account Created!" success screen rebuilt as a premium screen

**Updated:** 2026-09-14 (Asia/Dhaka) · Agent: **Arena Agent Mode**

## WHAT THE OWNER ASKED

> "এবার এটি করে দাও বর্তমানে যেটি আছে সেটি পরিবর্তন করে অনেক premium clean professional করো"

Reference (current, unchanged) screen supplied as `IMG_4448.png`: back arrow, a loose ✦◆✓✦ glyph row,
`Account Created!`, one Bengali line, a flat `Continue →` button and a large empty area.

## WHAT CHANGED (only the success screen)

- **Hero** — layered success emblem (green gradient disc, soft halo, three tiny sparks) with an inline
  SVG tick, then `Account Created!` and the Bengali confirmation line.
- **Saved-profile card** — a real recap of what the user just entered, rendered at runtime:
  নাম · জন্ম তারিখ (Bengali numerals/date) · বিদ্যালয় · কলেজ / বিশ্ববিদ্যালয় (or `এখন পড়ছ না`) · Account
  (masked email from the API when available) + a small “পরে profile থেকে যেকোনো তথ্য বদলাতে পারবে” line.
- **Primary action** — one full-width `Continue →` (`data-role="created-continue"` unchanged, still opens
  the verification selector). Placed directly under the recap so it is visible without scrolling on
  phones; a one-line privacy footnote sits under it.
- **What-happens-next card** — “পরের ধাপ / একটি verification বাকি” with the two real methods
  (Email verification link, Telegram 6-digit code) so the empty space now carries useful information.
- **Phone behaviour** — the success view starts scrolled to the top (the security step used to leave the
  page scrolled down), nothing is hidden, nothing is shrunk, and the v249 scroll cushion stays intact.

## FILES

- `account-access.js` — created view markup, `renderCreatedSummary()`, scroll-to-top when the view opens.
- `account-access.css` — “Account Created screen — premium success screen (v251)” block (scoped to
  `.ah-created-view`, code-native only: inline SVG + gradients, no raster, no `url()` backgrounds).
- `.github/workflows/telegram-auth-canary-activate.yml` — 5 new release asserts.
- Markers: assets `?v=20260914-created-screen-v1`, service worker + `BUILD_ID`
  `v251-created-screen-20260914`.

## VERIFIED

- auth 62/62 · native-auth 203/203 · email 108/108 + 4/4 · worker bundle exact · release file asserts 66/66.
- Browser audit: `pageErrors 0`, touch targets ≥44px, no duplicate ids, no dialog semantics.
- 360 / 390 / 430 / 1024: recap values correct, `Continue` reachable on first paint at ≥390,
  no horizontal overflow, `pageErrors 0`.
