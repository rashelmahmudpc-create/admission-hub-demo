# LATEST — v254 DEPLOYED + VERIFIED (both hosts) · publish-verify CI hardened

**Updated:** 2026-09-14 (Asia/Dhaka) · Agent: **Arena Agent Mode**

## STATUS

- **DEPLOYED:** v254 (login input fix, complete) live on
  `admissionhub.pages.dev` AND `sheikhrashel47-stack.github.io/admission-hub-demo/`.
  Publish run #41 on main HEAD `be414fa` = success; all guards green.
- **VERIFIED:** shell marker `v254-login-input-20260914` + asset
  `?v=20260914-login-input-v2` on both hosts; live CSS has the restored
  `webkit-autofill` reset + 38px/16px single-frame login inputs;
  live JS has `unavailableHint()` ×3 (open() banner site restored).
- **FIXED:** publish verify step is now settle-first + retry (PR #83,
  `d5bd510a`) — the v252 cutover-race false-negative is root-fixed.

## DETAIL

- `AGENT_RESUME/2026-09-14-v254-live-verified-closeout.md`
- History: … → v252 (auth reference screens) → v253 (incomplete, superseded)
  → v254 (login input fix, complete) → **closeout: DEPLOYED + VERIFIED**.

## STOP

- Next phase requires owner approval (10-phase roadmap gate).
- No parallel `edit_file` calls to the same file (v253 race lesson).
