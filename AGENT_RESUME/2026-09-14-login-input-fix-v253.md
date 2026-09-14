# v253 — login input single-frame + tighter size; unavailable-hint (2026-09-14)

## Why
Owner screenshots (21:11/21:22 Dhaka) showed two live issues:
1. Signup impossible on `*.github.io`: banner "Account service এখন প্রস্তুত নয়—Guest
   হিসেবে Dashboard ব্যবহার করতে পারো।" and Create Account silently does nothing.
   Root cause: github.io is static-only (no `/api` worker), so `ensureAvailable()`
   is always false there. Backend on admissionhub.pages.dev verified working via
   identical API calls (signup 202 `accountCreated:true` + email/start 202
   `sent:true` for hwwukqlf4o@olipii.com). Fix: when unavailable AND host is not
   admissionhub.pages.dev, append "Real account শুধু admissionhub.pages.dev
   সাইটে খোলা যায়।" to the banner (2 call sites + `unavailableHint()`).
2. Login page (pages.dev): EMAIL/PASSWORD fields render an extra inner box, and
   fields feel too big. Root cause: no `:-webkit-autofill` / `:focus-visible`
   reset on the transparent inner input, so iOS paints its pale autofill box /
   outline ring inside the designed outer frame. Fix (login-scoped only):
   autofill white-inset override + `:focus-visible{outline:0}` (outer frame keeps
   its `:focus-within` ring, so no a11y loss) + `-webkit-appearance:none`;
   tighter rhythm (field padding 10/14/12→8/14/9, radius 18→16, input 44px→38px,
   font 17→16 (still ≥16 = no iOS zoom), label 10.5→10, toggle height 44→36).

## Markers (cache-busting)
- Assets: `20260914-login-verify-v1` → `20260914-login-input-v1`
- Shell/SW/release: `v252-login-verify-20260914` → `v253-login-input-20260914`
- CSS header: `Auth reference screens (v253)`; JS comment `(v253)`.
- 20 files: workflow yml, account-access.{js,css}, index.html, sw.js, 15 test files.

## Validation (sandbox)
- Marker-touched UI tests: 23/23 pass (5 files fail pre-existing: missing `jsdom`,
  identical on pristine tree, non-gating in CI).
- Gating suites: test:auth 62/0, test:email 108+4/0, jsdom UI
  (firebase-auth-ui, multimethod-auth-ui, premium-onboarding-ui, telegram-otp-ui)
  33/0 after `npm i --no-save jsdom`. sqlite-auth-runtime needs
  `better-sqlite3` (native, pre-existing env gap, unrelated).
- Publish prerequisite unchanged: dispatch telegram-auth-canary-activate.yml on
  main with confirmation=PUBLISH_TELEGRAM_OTP; Pages does NOT auto-deploy.
