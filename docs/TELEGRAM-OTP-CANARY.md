# Telegram START → OTP account-verification canary

Status: **publicly deployed verification beta, protected by the same canary-grade controls**. The owner requested public visibility before the final phone test. It must not be called production-ready until one real phone completes START → receives the bot code → submits the code in Admission Hub.

## Canonical identity contract

- Firebase Authentication remains the only canonical identity authority.
- Telegram is an optional account-verification alternative to Firebase email-address verification.
- Telegram verification is attached to the existing Firebase subject/UID; it never creates a Telegram login identity, second Firebase UID, or separate account database.
- A successful Telegram check returns `accountVerified=true`, `telegramVerified=true`, and preserves the real Firebase value `emailVerified=false`.
- Telegram proves control of a Telegram account only. It never claims Gmail/email ownership.

## Required user journey

1. The student signs up with Email + Password, or reauthenticates an existing unverified Firebase account with its password.
2. Admission Hub still attempts the normal Firebase verification email.
3. After Signup, Admission Hub sends nothing automatically and presents **Gmail/ইমেইল যাচাই** and **Telegram যাচাই** as explicit choices.
4. The server creates an expiring, one-time deep link to the configured official bot.
5. The student opens the bot and presses **START** in a private same-user chat.
6. Telegram sends the webhook with its configured secret header.
7. The authority binds the stable Telegram numeric user ID by HMAC, then the bot sends a cryptographically random six-digit code.
8. The student enters that code in Admission Hub.
9. The SQLite Durable Object validates the code atomically and links the Telegram HMAC reference to the same Firebase-linked local projection.
10. Only after that authoritative result does Admission Hub issue its normal opaque session cookies.

Opening Telegram or pressing START is not verification success by itself.

## Public selector boundary

`VERIFICATION_AUTH_ACTIVATION=enabled` publishes the dedicated Email-or-Telegram selector on the ordinary app URL. The query below remains available only for protected generic-backup diagnostics:

- `GET /api/auth/v1/config?telegramCanary=1`
- `POST /api/auth/v1/signup?telegramCanary=1`
- `POST /api/auth/v1/login?telegramCanary=1`
- `GET /api/auth/v1/telegram/verification/pending?telegramCanary=1`
- `POST /api/auth/v1/telegram/verification/resend?telegramCanary=1`
- `POST /api/auth/v1/telegram/verification/verify?telegramCanary=1`

The Telegram webhook itself is server-to-server:

- `POST /api/auth/v1/telegram/webhook`
- Requires `X-Telegram-Bot-Api-Secret-Token`.
- Accepts only a private chat where `message.from.id === message.chat.id`.
- Accepts only a valid `/start <one-time-token>` update from a non-bot Telegram user.

Ordinary `/config`, signup, and unverified login expose the dedicated Email-or-Telegram selector, and the generic backup flow is published. Public Google, Passkey, and Email/Password remain available.

## OTP and abuse policy

- six decimal digits generated with Web Crypto;
- five-minute lifetime;
- single use and atomic replay rejection;
- maximum five wrong attempts;
- fifteen-minute lockout after the fifth wrong attempt;
- sixty-second resend cooldown;
- resend invalidates the older code and START link;
- independent Firebase-user, IP, device, and global send limits;
- one stable Telegram identity can link to only one Firebase account;
- a Firebase account can have only one active Telegram identity link.

Wrong-code handling never resends automatically and never switches provider.

## Data minimization and recovery

The existing singleton SQLite Durable Object remains the authority; no external database is added.

Stored data is limited to:

- HMAC references for Firebase subject, normalized email, Telegram numeric ID, IP, device, session, challenge, and destination;
- masked email display value;
- challenge/session state and bounded timestamps;
- AES-GCM encrypted Firebase refresh material for an HttpOnly pre-verification ticket;
- AES-GCM encrypted OTP and deep-link material only until Bot API delivery is confirmed, or until expiry/supersession.

The system never persists plaintext password, raw email, raw Telegram ID, plaintext OTP, raw refresh token, bot token, or raw Admission Hub session token. Browser JavaScript cannot read the pre-verification, Firebase, session, or device cookies.

Refresh/reopen recovery is bound to the same HttpOnly pre-verification ticket and device reference. Before START it can reconstruct the same expiring bot link. After confirmed bot delivery it restores the code-entry state without putting Firebase credentials or OTPs in browser storage.

## Failure behavior

- Missing/invalid webhook secret: reject before parsing or touching authority state.
- Non-private, bot-authored, mismatched-user, malformed, expired, or superseded START: fail closed; stale links do not send a code.
- Bot API temporary failure: retain the same encrypted expiring challenge so Telegram can retry safely.
- Wrong/expired/used/locked code: reject with bounded public errors; no session is created.
- Identity conflict: reject the second Firebase-account link.
- Email delivery starts only after the Email button is selected. A delivery failure leaves Telegram selectable; if both channels are temporarily unavailable after canonical preparation, the matching Firebase subject is retained so password reauthentication can resume safely instead of leaving an orphaned local subject.
- Telegram outage never disables the existing Email/Password or public Google routes.

## AI boundary

The AI may explain where to press START and where to enter the code. OTP-bearing input is intercepted before any model or chat-memory call. The AI must not generate, guess, repeat, store, or validate an OTP and must not announce success; only the backend response is authoritative.

## Verification and rollout

Automated coverage includes correct, wrong, expired, locked, used, superseded and replayed codes; resend cooldown and old-code invalidation; private webhook authentication; one-to-one identity conflicts; concurrent correct submission; Bot API retry; same-device refresh/reopen; another-device rejection; Mobile Safari UI states; email-delivery failover; existing-unverified password reauthentication; encrypted SQLite lifecycle; ordinary-visitor isolation; and AI OTP guards.

Protected deployment is performed only by `.github/workflows/telegram-auth-canary-activate.yml`. It:

1. runs the complete production Auth suite and exact-bundle check;
2. verifies required encrypted bindings by name without reading values;
3. deploys with bounded Worker rollback;
4. validates bot identity and binds the secret webhook using a transient activation secret;
5. reruns live Firebase Email/Password lifecycle evidence;
6. deploys the same-origin UI;
7. proves public selector, Passkey, and generic backup readiness;
8. rechecks the public Google browser origin;
9. removes the transient activation secret and confirms the activation route is closed.

Final production-ready status still requires the physical phone E2E. Passkey is now published and is not Telegram rollout evidence.
