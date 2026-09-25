# Admin Passkey Login — Design

Status: proposal for owner review. Replaces repeated `ADMIN_TOKEN` entry in the
Notification Command Center.

## Problem

Today the Admin Center asks for the raw `ADMIN_TOKEN` and keeps it in
`sessionStorage`. On every new device the owner re-keys a long secret, and a
leaked token is a full admin grant with no device binding.

## What already exists (reuse, do not rebuild)

- `auth-native/core/webauthn.mjs` — CBOR decode, attestation and assertion
  verification, ECDSA DER→raw, counter monotonicity, origin/RP-ID checks.
- `auth-native/core/auth-engine.mjs` — passkey register/authenticate against the
  `AUTH_AUTHORITY` Durable Object.
- `auth-native/core/secret-vault.mjs` — at-rest encryption of stored keys.
- `passkey-auth.test.mjs` — a full authenticator fixture, so new tests can drive
  real registration and assertion flows without a browser.

## Proposed flow

1. **Enroll once.** In Admin → Security, the owner registers a passkey. The
   worker calls `verifyPasskeyRegistration`, stores `credentialId`,
   `publicKeyJwk`, `counter`, `userHandle` via the auth engine, tagged
   `role: admin`.
2. **Challenge.** `POST /api/admin/webauthn/challenge` returns a single-use
   challenge bound to `rpId = admissionhub.pages.dev`, origin-allowlisted,
   TTL ≤ 120s.
3. **Assert.** The browser calls `navigator.credentials.get()`;
   `POST /api/admin/webauthn/assert` verifies with
   `verifyPasskeyAuthentication` and, on success, mints a short-lived admin
   session (HttpOnly, SameSite=Strict, ≤ 30 min, device-bound).
4. **Authorize.** `ADMIN_PATHS` in `fcm-notification.mjs` accepts either the
   existing `ADMIN_TOKEN` bearer (break-glass) or a valid admin session. The
   token path stays until the owner removes it.
5. **Revoke.** Deleting the passkey or the session row kills the grant; the
   stolen-token case disappears because nothing long-lived sits in the browser.

## Guardrails

- The challenge is single-use and consumed before verification.
- Counters must advance; a cloned authenticator is rejected (already enforced).
- Origin and RP-ID are fixed server-side, never echoed from the client.
- Sessions are admin-scoped and cannot read student records.
- `ADMIN_TOKEN` rotates independently; passkey login does not depend on it.

## Work items

1. ✅ Worker: challenge/assert handlers + admin session mint (`admin-passkey.mjs`).
2. ✅ Worker: accept admin session in `ADMIN_PATHS` (contract test in
   `admin-passkey.test.mjs`).
3. ✅ UI: passkey button on the gate, keep token as an optional fallback.
4. ✅ Docs: recovery path if the passkey device is lost (break-glass token).

## Status: shipped

`admin-passkey.mjs` implements the flow; `fcm-notification.mjs` accepts a
passkey session for `ADMIN_PATHS`; `notification-command-center.html` shows a
"Sign in with passkey" button when the worker reports an enrollment, plus an
"Add a passkey to this device" action in Settings. Tests:
`admin-passkey.test.mjs` (8 cases, real P-256 WebAuthn verification — no mocks).

### Storage keys (`GK_KV`)

| Key | Contents | TTL |
| --- | --- | --- |
| `admin:pk:cred:<credentialId>` | credential id, public JWK, counter, label | none |
| `admin:pk:chal:<challengeId>` | purpose, challenge, MAC | 120 s |
| `admin:pk:sess:<sha256(session)>` | credential id, expiry | 30 min |

Sessions are stored hashed, so a KV dump does not yield a usable bearer.
`ADMIN_TOKEN` doubles as the HMAC key for challenge MACs: rotating it
invalidates every outstanding challenge and session, while enrolled credentials
survive (they are public keys).

### Deliberate limits

- Enrollment requires `ADMIN_TOKEN`. Enrolling a new passkey is a privileged
  change, so it is not reachable from an assert-only path.
- At most 8 admin credentials (`MAX_ADMIN_CREDENTIALS`).
- `attestation: 'none'` — we do not verify device provenance, only possession.
- No per-credential revocation UI yet; delete the `admin:pk:cred:*` key to
  revoke.

