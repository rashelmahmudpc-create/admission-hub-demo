# Descope email OTP — opt-in draft

Base commit: `3def9cc29d07fd0a002e0ce24706317743aebc63`.

## Status

Adapter and offline tests only. No live Descope request, email, account creation,
GitHub publication, deployment, or production activation has been performed.
`wrangler.toml` is deliberately unchanged: `otp-l` is absent and defaults disabled.
Existing provider order and the last-resort pair are unchanged.

## Project configuration

Public Project ID supplied by the owner: `P3Km4McYmZUg8ZzIJfEnf9ZCDkFD`.
No management key is needed by the send/verify endpoints. Do not add secret keys
to source or conversation. The ID has NOT yet been validated against a live API.

In the Descope Console, confirm that OTP email is enabled, Trigger Method permits
API & SDK, the built-in email connector is selected, OTPs have six decimal digits,
and their expiry does not exceed the app's ten-minute challenge expiry.
Do not enable paid connectors or substitute a custom SMTP provider.

After owner approval and a successful controlled test, add this row to the
EXISTING `VERIFICATION_ORCHESTRATOR_CONFIG` JSON; do not add a new Worker variable:

```json
{"id":"otp-l","enabled":true,"priority":38,"dailyQuota":1000,"timeoutMs":12000,"label":"secure backup","projectId":"P3Km4McYmZUg8ZzIJfEnf9ZCDkFD"}
```

This row is an activation example, NOT applied configuration. Keep enabled=false
while reviewing. A 1000/day quota is the configured admission ceiling; it is not
a remaining-quota API result or an inbox-delivery guarantee. Other activity in
the same Descope project can consume quota too. Published free limits can change.

The adapter currently targets the documented default `https://api.descope.com`.
If the project requires another regional endpoint, do not activate this draft;
verify its official endpoint and add an explicit allowlist plus tests first.

## Security and student experience

No hosted login, popup, Descope UI, or new frontend token storage is introduced.
The existing app collects the code and forwards it to its backend. The backend
uses the official signup-in and verify OTP APIs; Descope generates the code.
The app's locally generated OTP is never sent to Descope.

Verification uses the address resolved from the same trusted identity already
bound by the repository to the challenge, user, device, session and email hash.
Client-supplied destination and provider JWTs are not accepted as evidence.
The direct TLS verify response must identify that exact email as verified.
The existing repository enforces attempts, expiry, locks and atomic consumption.
No new KV writes or raw-email persistence are introduced.

Descope's signup-in flow DOES create/use a Descope user record and successful
verification DOES issue upstream session/refresh tokens. They are not a second
Admission Sky account: no Firebase UID is replaced, and upstream tokens and
cookies are not persisted or exposed to the browser. No automatic deletion or
revocation is performed. Review provider retention and upstream-session policy
before production; deletion would need separate approval and management access.

A successful send API reply means accepted, not delivered. checkAvailability
is configuration readiness only, not a live connector or deliverability test.
Built-in sender/subject customization has not been promised.

## Verification

Baseline: 96 tests passed across the existing provider/orchestrator suites.
Draft: 123 tests passed (27 new Descope tests plus those existing tests).
All HTTP calls in these tests use mocks; no network/OTP is sent.
The full production-auth gate and complete Worker rebuild are NOT run in this
minimal sandbox and are required before any deploy.

```sh
node --test --test-concurrency=1 descope-otp.test.mjs verification-providers.test.mjs verification-orchestrator.test.mjs
npm run test:production-auth
npm run build:worker
npm run check:worker-bundle
```

The sandbox used Node 20 with --experimental-global-webcrypto; production/test CI
should use the project's supported runtime.

## Controlled rollout — separate approvals required

1. Publish a disabled draft on a new review branch only; do not merge or deploy.
2. Run the full test/build gate in a full checkout; review config/admin seams.
3. Confirm project settings and get a test recipient and explicit send consent.
4. Send a single approved test, verify inbox/spam placement and code completion.
5. Obtain explicit deployment/activation approval. Preserve existing providers.
6. Roll back by disabling/removing only the otp-l row.

Official contracts:
- https://docs.descope.com/api/otp/email/sign-in-auto-sign-up
- https://docs.descope.com/api/otp/email/verify-otp
- https://docs.descope.com/auth-methods/otp/settings
- https://www.descope.com/pricing
