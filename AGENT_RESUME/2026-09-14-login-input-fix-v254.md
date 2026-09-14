# v254 — restore lost v253 hunks (login CSS + banner hint), rebumped (2026-09-14)

## Why
v253 (PR #81, merged ea9024b) shipped INCOMPLETE: two same-file parallel edits
raced and only one hunk per file survived —
- `account-access.css`: v253 header present, but login single-frame/tighter
  rules missing (live file still 44px/17px, no autofill reset).
- `account-access.js`: `unavailableHint()` + ensureAvailable site present, but
  the `open()` banner site (line ~1663) lost its `+ unavailableHint()`.
Lesson: NEVER batch two `edit_file` calls to the SAME file in one block.

## Changes (on top of merged v253)
- Re-applied the full login-field CSS block (autofill reset, focus-visible
  reset, 38px/16px rhythm, toggle 36px) — verified `webkit-autofill` present.
- Restored `+ unavailableHint()` at the `open()` site — verified 3 refs.
- Rebumped for cache safety (v253 URLs already served the incomplete bundle):
  assets `20260914-login-input-v2`, shell `v254-login-input-20260914`,
  CSS header `Auth reference screens (v254)`.

## Validation
- Marker suites: 23/23 pass (same 10 files as v253 gate).
- Full-check the LIVE files after merge (with `grep -Fq --` for `-webkit…`
  patterns — a bare `grep -Fq "-webkit…"` misreads the pattern as a flag).
- Publish prerequisite unchanged: dispatch on main with PUBLISH_TELEGRAM_OTP.
