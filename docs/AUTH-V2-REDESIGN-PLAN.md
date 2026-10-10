# Auth v2 — Sign-in / Onboarding Redesign Plan

_Status: DRAFT · branch `design/auth-v2-preview` · nothing wired or deployed_

Visual preview: `design-preview/auth-v2.html` (standalone, zero-raster, no auth calls).

## Goal
Replace the current welcome slides + multi-step signup in `account-access.js` / `account-access.css`
with a single clean entry card (desktop split layout) and a short, skippable onboarding.
**UI only. The Worker auth backend (`/api/auth/v1/*`, Firebase, Passkey, Telegram/backup OTP) stays unchanged.**

## Current UI inventory (to be replaced)
- Views (`showView`): welcome, login, signup, email-intro, email-ownership, verify, verified, created,
  success, signed, security-setup, forgot, google-link, step-up, backup, backup-prepare,
  telegram-intro, telegram, whatsapp-info
- Signup sub-steps (`setSignupStep`): personal → school → college → security (+ target/previous/state)
- Public contract that MUST be kept: `window.AdmissionAccount`, events `admissionhub:authchange`,
  `admissionhub:entry-complete`, `admissionhub:profile-ready`, `ah:lang`; cookies `ah_entry_v1`,
  `ah_signup_pending_v1`; header `X-AH-Auth-UI` (server enforces `auth-premium-v6`, bump together).

## Backend endpoints the new UI must call (unchanged)
| Flow | Endpoint(s) |
|---|---|
| Config / session | `GET /config`, `GET /session`, `/session/logout`, `/session/logout-all` |
| Google | `/google`, `/google/link` |
| Passkey | `/passkey/authentication/begin|finish`, `/passkey/registration/begin|finish`, `/passkey/status`, `/passkey/remove` |
| Email + password | `POST /signup {email,password}`, `POST /login`, `/password-reset` |
| Email ownership (6-digit OTP, falls back to Firebase link) | `/email-ownership/start|verify`, `/account-verification/email/start|status`, `/verification/resend` |
| Telegram / generic backup | `/telegram/verification/*`, `/backup/request|verify` |
| Step-up / device trust | `/security/challenge/*`, `/security/device/trust` |
| Profile | `POST /profile` and `/profile/pending` with `{fullName, mobile, dob, school, higherInstitution}` |

## ⚠️ Gaps between the preview and the backend
1. **No passwordless email sign-in exists.** `/signup` and `/login` are Firebase email+password.
   The 6-digit email code only proves ownership *after* signup. So the real flow must be:
   - Login: email → password (or Google / Passkey).
   - Signup: email + password → 6-digit ownership code → onboarding.
   - True passwordless would need a new Worker route = backend change + new tests (separate phase).
2. **"Goal" and "level" are not profile fields.** The profile API only accepts
   `fullName, mobile, dob, school, higherInstitution`. Options: (a) keep goal/level client-side
   (existing study prefs), or (b) extend `/profile` = backend change.
3. **Required profile fields** (name, mobile, DOB, school) are currently validated before `/signup`.
   Plan: move them *after* account creation via `/profile/pending` so the entry card stays short.

## Phases
1. **Design sign-off** — owner reviews preview; decide password vs passwordless, colours, questions.
2. **New UI module** — rewrite `account-access.js/.css` views against the endpoint table above,
   keeping every public contract listed. Remove welcome slides and old step markup entirely.
3. **Tests** — update UI guards that pin old copy/markup: `premium-onboarding-ui`,
   `code-native-welcome-v1`, `interactive-native-personal-v1`, `multimethod-auth-ui`,
   `telegram-otp-ui`, `signup-autosave`, `firebase-auth-ui`, `security-challenge-ui`,
   `relogin-device-challenge-ui`, `profile-uni-suggest`; keep `native-auth-protection` invariants
   (no localStorage/sessionStorage, only 2 `document.cookie =` writes, `credentials: 'same-origin'`,
   `auth-premium-v6` header, no provider names in client).
4. **Shell bump** — new asset version tokens in `index.html` + `sw.js` (`npm run sw:manifest`) and the
   matching literals in `.github/workflows/telegram-auth-canary-activate.yml`.
5. **Release** — PR → all guards green → owner approval → `Deploy Pages UI + Worker (manual)`.

## Constraints honoured
- Zero-raster rule (SVG/CSS only). Bengali-first copy, NFC-normalised.
- Light/dark themes, `prefers-reduced-motion`, 44px+ tap targets, visible focus.
