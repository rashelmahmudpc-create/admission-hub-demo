# v250 — Education step: school-select ও college-select পেজ (owner reference design)

**Updated:** 2026-09-14 (Asia/Dhaka) · Agent: **Arena Agent Mode**

## WHAT THE OWNER ASKED

> "আগের কোনো কিছু পরিবর্তন না করে এখানে বিদ্যালয় সিলেক্ট করার পেইজ এবং কলেজ সিলেক্ট করার পেইজগুলো বর্তমানে দিছি এরকম করে মনে রাখবে এগুলো ডেমো তুমি কোড দিয়ে করবে"

Reference screens supplied by the owner: `IMG_4016.png` (school select) and `IMG_4008.png` (college select).
Everything else in the app must stay exactly as approved (v248 design + v249 phone scrolling).

## WHAT CHANGED (only the Education step)

1. **Top row** — the signup brand block is replaced by a plain `Education` title on the two education
   steps, so the existing back control reads exactly like the reference screen.
2. **Stepper** — compact segmented row `✓ Personal — ② Education — ③ Security`: green tick chip for a
   finished step, green numeral chip for the current step, grey numeral for the upcoming one, flat
   connector lines (the old 01/02/03 circles and the filler bars are gone).
3. **Headings** — school: `তোমার বিদ্যালয়ের নাম লিখো`; college: `তুমি কোন কলেজ / বিশ্ববিদ্যালয়ে পড়েছ?`
   with the reference sub-copy under each.
4. **Search field** — magnifier glyph + green focus ring (`:focus-within`).
5. **Result rows** — icon chip (house for schools, graduation cap for college/university, `+` for the
   manual row), bold institution name, `type · district` line, trailing selection circle that turns into
   a green tick with a light-green tinted row for the current choice. Still max 3 matches + 1 manual row
   (`button[role="option"]`, ids `#ah-school-results` / `#ah-college-results` unchanged).
   The school step keeps the English type word, the college step uses the Bengali one
   (`বিশ্ববিদ্যালয় · Dhaka`, `কলেজ · Dhaka`) exactly like the two reference screens.
6. **Bottom actions** — one full-width `Next →`. Step-back stays on the tap-able stepper chips, so no
   extra control is added that the reference screens do not show.
7. **Helper button** — the round robot button above Next opens/closes a small code-native tips card
   (no dialog semantics, no network call, no AI routing).
8. **Phone layout** — the education card fills the phone height and the Next button sits at the bottom
   edge, matching the reference screens; nothing is hidden, nothing is shrunk and the v249 phone scroll
   cushion is untouched.

## FILES

- `account-access.js` — education panels, stepper markup, numeral `1/2/3`, `INSTITUTION_ICONS`,
  `institutionKindOf`, `institutionTypeLabel`, `buildInstitutionOption`, `setupEducationAssist`.
- `account-access.css` — new "Education step (school / college) — owner reference design" block.
- `interactive-native-personal-v1.test.mjs`, `premium-onboarding-ui.test.mjs`,
  `auth-native/operations/premium-onboarding-browser-audit.mjs` — numerals updated to `1/2/3`.
- `.github/workflows/telegram-auth-canary-activate.yml` — 6 new release asserts (education markup,
  option rows, helper role, CSS block, `!ah-search-option`).

## VERIFIED

- auth 62/62 · native-auth 203/203 · email 108/108 + 4/4 · release file asserts 61/61 (0 failing).
- Browser audit: `pageErrors 0`, 44px+ touch targets, no dialog semantics.
- 8 viewports (320→1440): no horizontal overflow, no off-screen element inside the panel,
  4 option rows, Next reachable everywhere, `pageErrors 0`.
- Markers: assets `?v=20260914-education-page-v1`, service worker + `BUILD_ID`
  `v250-education-page-20260914`.
