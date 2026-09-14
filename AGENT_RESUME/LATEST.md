# LATEST — Welcome আগের ডিজাইনেই ফিরেছে, স্ক্রল থাকতে পারে (v248)

**Updated:** 2026-09-14 (Asia/Dhaka) · Agent: **Arena Agent Mode**

## STATUS

- **IMPLEMENTED:** Owner rule (2026-09-14): *nothing may be hidden, nothing may be shrunk, scrolling is fine.* `account-access.css` + `account-access.js` are restored exactly to the v245 state — the design of the owner's reference screenshots — so every element (brand header, journey console, all four benefit cards, all four entry paths, Welcome art) keeps its **natural size on every device**. The whole fit/shrink machinery of v246/v247 (`.ah-welcome-fit`, `--ah-fit`, `100dvh` lock, `vh`/`vw` clamps, height-based decorative hiding) is **gone (0 references)**.
- **SCROLLING:** allowed and expected — small phones scroll ~90–400px; the page is a normal scrolling web page again.
- **TESTED:** auth 62/62 · email 108/108 + 4/4 · native-auth 203/203 · account-retirement 30/30 · worker bundle exact · browser audit ok (pageErrors 0) · 13/13 viewports with nothing hidden, nothing scaled, no horizontal overflow, 50–56px targets · 53/53 release file asserts.
- **HARDENED:** the audit's old *"must fit one screen without scrolling"* assertion was replaced by: 4/4 benefit cards visible, **no** `ah-welcome-fit`/`is-scaled`/`--ah-fit` layer allowed, console+heading+art visible, every entry path ≥44px.
- **DEPLOYED:** pending the publish run after merge.

## DETAIL

- `AGENT_RESUME/2026-09-14-natural-welcome-v248.md`
- History: v244 (premium rebuild, rejected) → v245 (3D hero removed, original design kept) → v246 (one-screen fit + premium buttons) → v247 (one-screen fit with all cards, still scaled) → **v248 (fit requirement dropped by the owner: natural sizes, scrolling allowed, nothing hidden)**.
