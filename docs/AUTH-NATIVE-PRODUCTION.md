# Firebase-canonical multi-method Auth — production contract

Status: Email/Password, Google, and Passkey are public production methods. The explicit Email-or-Telegram verification selector is publicly deployed at the owner’s request, and the generic backup flow is published; Telegram START → OTP remains pending the final physical phone E2E before it is called production-ready. After successful verification, supported devices may enroll an optional Passkey or Skip.

## Canonical identity and verification

Firebase Authentication is the only canonical identity authority. Admission Hub does not create a second provider-owned UID or an independent account database.

An account may become usable after either:

- a fresh Firebase lookup reports `emailVerified=true`; or
- the same Firebase subject/UID has an authoritative Admission Hub Telegram link created by the protected START → six-digit OTP flow.

Telegram is an optional account-verification alternative, not a login identity and not proof of Gmail/email ownership. A Telegram-verified response keeps these facts separate:

- `accountVerified=true`
- `telegramVerified=true`
- `emailVerified=false` unless Firebase itself reports otherwise

See `docs/TELEGRAM-OTP-CANARY.md` for the protected deployment and physical-validation contract.

## Email + Password journey

1. A user signs up with email and password.
2. Firebase Authentication creates the account and returns its canonical subject/UID.
3. Admission Hub asks Firebase to send a standard `VERIFY_EMAIL` address-verification email.
4. The user may click Firebase's link, then log in with the same password.
5. Signup sends nothing automatically when Telegram is available. The student explicitly chooses Firebase Email or Telegram; only that choice starts delivery. Telegram opens the official bot, requires START, sends a six-digit code, and accepts the code only in Admission Hub.
6. No authenticated Admission Hub session is issued until one accepted verification path is authoritative.

Email-link sign-in is not implemented. Firebase's link verifies the address; it does not sign the user in.

## Same-origin public boundary

Core browser routes:

- `GET /api/auth/v1/config`
- `POST /api/auth/v1/signup`
- `POST /api/auth/v1/verification/resend`
- `POST /api/auth/v1/login`
- `POST /api/auth/v1/google`
- `POST /api/auth/v1/google/link`
- `GET /api/auth/v1/session`
- `POST /api/auth/v1/session/logout`

Protected Telegram-canary routes are documented separately. The browser never receives a Firebase ID token, Firebase refresh token, raw Admission Hub session token, bot token, Telegram numeric ID, or plaintext server OTP in JSON.

## Firebase operations

The Worker uses Firebase's documented REST boundaries:

- `accounts:signUp`
- `accounts:sendOobCode` with `requestType=VERIFY_EMAIL`
- `accounts:signInWithPassword`
- `accounts:signInWithIdp` for Google
- `accounts:lookup`
- Secure Token refresh
- bounded account cleanup for a rejected newly-created duplicate identity

`FIREBASE_WEB_API_KEY` is an encrypted Worker binding. `FIREBASE_CONTINUE_URL` is fixed to `https://admissionhub.pages.dev/?firebaseVerified=1`. Activation rejects a Firebase project whose authorized domains do not contain `admissionhub.pages.dev`.

Passwords exist only in the bounded request body while the Worker forwards signup, login, resend, or explicit Google-link reauthentication to Firebase over HTTPS. They are not written to SQLite, browser storage, logs, analytics, or API responses.

## Authorization and session policy

Every Email/Password login performs password reauthentication and a fresh Firebase lookup. Session refresh performs a Firebase token refresh and another lookup. The Worker requires:

- signed and looked-up Firebase subjects to match;
- the Firebase user not to be disabled;
- authoritative account verification by Firebase email state or a UID-bound Telegram link;
- the Firebase subject/email HMAC references to match the local canonical projection.

Only then does the SQLite authority issue or accept a session. Credentials travel only in Secure, HttpOnly cookies:

- `__Host-ah_session` — random opaque Admission Hub session;
- `__Host-ah_firebase` — server-only Firebase refresh credential;
- `__Host-ah_device` — server-readable device binding;
- `__Host-ah_verification` — expiring, device-bound pre-verification ticket used by the explicit Email-or-Telegram choice before authentication.

Invalid, disabled, expired, mismatched, or no-longer-verified state is denied. Session failures revoke the local session and clear Auth cookies.

## Data minimization

`AdmissionAuthAuthority` is the existing singleton SQLite Durable Object. It atomically owns HMAC-linked Firebase identity projections, sessions, rate controls, verification challenges, Telegram one-to-one links, and security events.

Persistent authority data uses:

- HMAC references for normalized email, Firebase subject, Telegram numeric ID, network, device, session, and challenge values;
- a masked email display value;
- local status and bounded timestamps;
- AES-GCM ciphertext only where temporary recovery is required.

It does not store plaintext email, password, raw Firebase token, raw Telegram ID, plaintext OTP, bot token, or raw Admission Hub session token. No additional external database is used.

## No-cost controls

The Firebase Spark contract used here provides 1,000 standard address-verification emails per day and does not impose an application lifetime registered-user cap. The Durable Object applies a stricter atomic global email-send admission limit plus recipient, IP, device, resend, and login controls.

The ordinary Telegram Bot API is used for the canary. No Telegram Gateway API, paid SMS, paid broadcast, unofficial browser automation, Cloud Function, or extra paid database is required.

## Protected deployment evidence

Email/Password activation proves real disposable-mailbox delivery, Firebase address verification, verified login, session refresh, logout, and cleanup. Google publication separately proves Firebase provider configuration and accepted `https://admissionhub.pages.dev` browser origin.

Protected Telegram publication additionally runs all production Auth tests, exact Worker bundle comparison, secret-name-only binding checks, bot identity and secret-webhook checks, public selector and generic-backup isolation assertions, live Email/Password regression, and Google-origin regression. The app shell uses bounded network-first document refresh, and the API rejects stale pre-selector signup clients before Firebase account creation or Email delivery. Automated evidence does not replace the final physical START → receive code → submit code test.
