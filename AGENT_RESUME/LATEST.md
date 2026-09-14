# LATEST — Login input single-frame + tighter size; unavailable-hint (v253)

**Updated:** 2026-09-14 (Asia/Dhaka) · Agent: **Arena Agent Mode**

## STATUS

- **FIXED:** login EMAIL/PASSWORD extra inner box on iOS (autofill +
  focus-visible reset, login-scoped; outer focus ring kept) and slightly
  tighter login fields (38px inputs, 16px font = no iOS zoom).
- **FIXED:** "service not ready" banner now tells non-pages.dev visitors that
  real accounts open only on admissionhub.pages.dev (github.io is
  static-only and can never create accounts — verified backend works on
  pages.dev via identical API calls).
- **TESTED:** auth 62/62 · email 108+4 · jsdom UI 33/33 ·
  marker suites pass (5 non-gating files lack `jsdom` in sandbox,
  pre-existing).
- **DEPLOYED:** pending push + PR + merge + publish run (needs owner PAT).

## DETAIL

- `AGENT_RESUME/2026-09-14-login-input-fix-v253.md`
- History: v244 → v245 → v246/v247 → v248 → v249 → v250 (education) →
  v251 (Account Created) → v252 (auth reference screens) →
  **v253 (login input fix + unavailable-hint)**.
