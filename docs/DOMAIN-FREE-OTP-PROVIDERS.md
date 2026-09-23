# Domain-free OTP providers

Which mailers can carry a login OTP when the owner does **not** own a custom domain.

## Why this matters

The email OTP slots (`otp-a`/`otp-b`/`otp-c`) are the ones that actually deliver login
codes. They are configured in `VERIFICATION_ORCHESTRATOR_CONFIG` in `wrangler.toml` and
built by `createConfiguredVerificationProviders` in
`auth-native/verification/providers.mjs`.

The eight-provider gateway under `email-gateway/` is a **separate** subsystem. Nothing in
the OTP path imports it, and `EMAIL_PROVIDER_ACTIVATION` is not set, so enabling a
gateway provider changes nothing about login. Do not confuse the two when planning work.

## Verified provider policy

Checked against official provider documentation, September 2026.

| Provider | Custom domain required | Sender verification | Free tier |
|---|---|---|---|
| **Brevo** | No | Confirm link to a single address | 300/day |
| **Mailjet** | No | Confirm link to a single address | 200/day, 6,000/month |
| **SMTP2GO** | No | Confirm link to a single address | free plan caps at 5 senders; **Gmail excluded** by DMARC |
| **Elastic Email** | No | Single sender | 100/day |
| **Resend** | **Yes** | DNS record on the domain | 3,000/month, 100/day |
| **MailerSend** | **Yes** | Domain DNS | — |
| **Mailtrap** | **Yes** | Domain DNS | 4,000/month |
| **EmailOctopus** | — | — | no one-to-one transactional API; permanently ineligible for OTP |
| **Courier** | — | — | routes through another provider |

A Gmail sender address is the practical choice here: it needs no domain, but it carries
Gmail's DMARC record. That is why SMTP2GO rejects it. Brevo and Mailjet accept it.

## Active slots

| Slot | Provider | Daily cap | Notes |
|---|---|---|---|
| `otp-a` | Brevo | 300 | primary |
| `otp-b` | Google Apps Script (Gmail) | 100 | needs the full 20s timeout; cold start measured at ~11s |
| `otp-c` | Mailjet | 200 | wired here; skipped until its sender is confirmed |
| `otp-d` | Resend | 100 | needs a verified domain; dormant without one |
| `otp-e` | AgentMail | 100 | needs neither a domain nor a from-address |
| `otp-f` | MailerSend | 100 | sends from MailerSend's own verified trial domain |
| `telegram` | Telegram bot | 172,800 | unchanged |

## Senders that reach arbitrary recipients without a custom domain

Most no-domain senders only deliver to the account owner, which makes them useless for
student OTPs. Measured by reading the receiving mailbox and its authentication headers:

| Sender | Cross-recipient | Evidence |
|---|---|---|
| AgentMail | works | recipient inbox received it |
| MailerSend trial domain | works | received with `spf=pass`, `dkim=pass`, `dmarc=pass` |
| Resend `onboarding@resend.dev` | owner only | acceptable, never delivered off-account |
| Elastic Email | fails | recipient MTA refused: `DKIM authentication didn't pass` |
| Mailtrap demo domain | owner only | API returns 403 for other recipients |
| Courier | fails | accepted 202, then `status: UNMAPPED`, no provider bound |
| Mailjet | fails | API returns `success`, Mailjet logs `Status: "sent"`, but no `delivered` event and the recipient never receives it |

## Why Mailjet cannot carry a freemail sender here

Mailjet validates the sender's own domain, so a `gmail.com` or `icloud.com` sender needs DNS
records on a zone the owner does not control. Validation ends in `DKIMStatus: Error` /
`SPFStatus: Error` and Mailjet reports `Status: "sent"` without ever reaching `delivered`.
MailerSend and AgentMail avoid this by sending from their own domain, which is why they are the
no-domain senders we rely on. Mailjet would need a domain the owner controls.



Total reachable email OTP capacity: **600/day** from the signed no-domain senders
(`otp-a` Brevo, `otp-b` Apps Script, `otp-e` AgentMail, `otp-f` MailerSend), plus
whatever Gmail accepts from `otp-b`. `otp-c` and `otp-d` stay dormant until their
senders are verified.

## Activating Mailjet

The credentials are already on the Worker (`MAILJET_API_KEY`, `MAILJET_SECRET_KEY`,
`MAILJET_API_BASE`, `MAILJET_FROM_ADDRESS`, `MAILJET_FROM_NAME`) — written by the
provisioning flow in `auth-native/operations/prepare-production-secrets.mjs`. The `otp-c`
slot now consumes them.

Readiness is decided by a live API probe, never by the stored evidence flags.
`MAILJET_SENDER_VERIFIED` and `MAILJET_SANDBOX_SENDER_VERIFIED` belong to the separate
`email-gateway/` subsystem; the OTP path ignores them.

The probe reads **both** `/v3/REST/sender` and `/v3/REST/metasender`. A sender registered
under a Mailjet subaccount is absent from `/sender` and listed only by `/metasender`, so
reading one endpoint alone reports a working address as `SENDER_NOT_VERIFIED` and drops
the slot. A rejected probe is rethrown as an outage instead of being reported as an
unverified sender, so a transient API failure cannot masquerade as a missing sender.

If the sender is genuinely not active yet, the fix is a browser action:

1. Mailjet dashboard → Account → Sender domains & addresses → Add a sender address.
2. Enter the address in `MAILJET_FROM_ADDRESS` and submit.
3. Open that inbox and click the confirmation link. Status becomes `Active`.

Until then the orchestrator skips `otp-c`: the slot is dropped from the candidate list and
no partially configured request is ever sent. `otp-a` and `otp-b` keep serving.

## Checking a slot without reading a secret

`GET /api/auth/v1/config` reports `methods.backup.availabilityCode`. `READY` means at
least one OTP provider passed its sender check. Provider identities and per-slot state
stay server-side — they are deliberately never exposed to the client.

`GET /api/auth/v1/admin/verification/status` exposes per-slot state to an operator. It
requires the `X-AH-Admin-Token` header to match the `ADMIN_TOKEN` Worker secret and
returns 403 otherwise.
