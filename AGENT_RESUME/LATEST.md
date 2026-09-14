# LATEST — ফোনে স্ক্রল করে সব অপশন দেখা যায় (v249)

**Updated:** 2026-09-14 (Asia/Dhaka) · Agent: **Arena Agent Mode**

## STATUS

- **IMPLEMENTED:** v248 restored the owner's natural design (nothing hidden, nothing shrunk, scrolling allowed). The owner then reported that on his phone the page would not scroll, so the lower options stayed out of reach. Root cause: the page only overflowed the viewport by ~10px while a floating browser address bar covered the bottom ~100px of the screen. Fixed with `min-height:100svh` on the Welcome view plus a **96px phone scroll cushion** (`padding-bottom:calc(24px + env(safe-area-inset-bottom) + 96px)` at ≤760px).
- **UNCHANGED DESIGN:** nothing is hidden, nothing is scaled/shrunk; the cushion only adds empty space below the last option so it can be scrolled clear of the browser bar (scroll room is now ~116px at 430×932 and ~193px at 390×844).
- **TESTED:** auth 62/62 · email 108/108 + 4/4 · native-auth 203/203 · account-retirement 30/30 · worker bundle exact · browser audit ok (pageErrors 0) · 13/13 viewports (nothing hidden, nothing scaled, no horizontal overflow, 50–56px targets, last option reachable) · 55/55 release file asserts.
- **HARDENED:** the audit now fails if the last Welcome option cannot be scrolled clear of an 80px browser-bar band; the release workflow asserts `min-height:100svh` and the phone scroll-cushion block are present.
- **DEPLOYED:** pending the publish run after merge.

## DETAIL

- `AGENT_RESUME/2026-09-14-scroll-safe-v249.md`
- History: v244 (premium rebuild, rejected) → v245 (3D hero removed) → v246/v247 (fit attempts: hidden + scaled, rejected) → v248 (natural sizes, scrolling allowed) → **v249 (phone scroll room so every option is reachable)**.
