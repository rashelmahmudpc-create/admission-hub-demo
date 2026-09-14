# LATEST — Restore lost v253 hunks, rebumped (v254)

**Updated:** 2026-09-14 (Asia/Dhaka) · Agent: **Arena Agent Mode**

## STATUS

- **FIXED:** v253 shipped incomplete (parallel-edit race dropped the login CSS
  block + one banner-hint site). v254 restores both, verified in file, and
  rebump markers so no stale bundle can stick.
- **TESTED:** marker suites 23/23.
- **DEPLOYED:** pending push + PR + merge + publish run.

## DETAIL

- `AGENT_RESUME/2026-09-14-login-input-fix-v254.md`
- History: … → v252 (auth reference screens) → v253 (incomplete, superseded)
  → **v254 (login input fix, complete)**.
