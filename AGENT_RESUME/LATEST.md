# LATEST — Education ধাপের school/college পেজ (v250)

**Updated:** 2026-09-14 (Asia/Dhaka) · Agent: **Arena Agent Mode**

## STATUS

- **IMPLEMENTED:** the signup **Education** step now matches the owner's two reference screens —
  school-select (`তোমার বিদ্যালয়ের নাম লিখো`) and college-select (`তুমি কোন কলেজ / বিশ্ববিদ্যালয়ে পড়েছ?`).
  Code-native only (inline SVG, gradients, no raster): `Education` header with the existing back control,
  compact `✓ Personal — ② Education — ③ Security` stepper, magnifier search field with green focus ring,
  result rows with icon chip + bold name + `type · district` line + selection circle (green tick and
  tinted row for the current choice), one full-width `Next →`, and the round helper button above it that
  opens a small local tips card.
- **UNCHANGED:** Welcome, Personal, Security, Log In and everything else stay exactly as approved
  (v248 design; v249 phone scroll room). Nothing hidden, nothing shrunk, no content dropped; the school
  suggestion cap (3 matches + 1 manual row) and every id/role used by the tests are unchanged.
- **TESTED:** auth 62/62 · native-auth 203/203 · email 108/108 + 4/4 · release file asserts 61/61
  (0 failing) · browser audit `pageErrors 0`, touch targets ≥44px, no dialog semantics ·
  8 viewports 320→1440 with no horizontal overflow and a reachable Next button.
- **DEPLOYED:** pending the publish run after merge.

## DETAIL

- `AGENT_RESUME/2026-09-14-education-reference-pages-v250.md`
- History: v244 (premium rebuild, rejected) → v245 (3D hero removed) → v246/v247 (fit attempts: hidden +
  scaled, rejected) → v248 (natural sizes, scrolling allowed) → v249 (phone scroll room) →
  **v250 (education reference pages)**.
