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
| `telegram` | Telegram bot | 172,800 | unchanged |

Total reachable email OTP capacity: **600/day**, all domain-free.

## Activating Mailjet

The credentials are already on the Worker (`MAILJET_API_KEY`, `MAILJET_SECRET_KEY`,
`MAILJET_FROM_ADDRESS`, `MAILJET_FROM_NAME`). One step remains, and it must be done in a
browser — the `SenderEmail` address must click Mailjet's confirmation link before it can
send.

1. Mailjet dashboard → Account → Sender domains & addresses → Add a sender address.
2. Enter the address in `MAILJET_FROM_ADDRESS` and submit.
3. Open that inbox and click the confirmation link. Status becomes `Active`.

Until then the orchestrator skips `otp-c`: `checkAvailability` returns
`SENDER_NOT_VERIFIED`, the provider is dropped from the candidate list, and no partially
configured request is ever sent. `otp-a` and `otp-b` keep serving.

## Checking a slot without reading a secret

`GET /api/auth/v1/config` reports `methods.backup.availabilityCode`. `READY` means at
least one OTP provider passed its sender check. Provider identities and per-slot state
stay server-side — they are deliberately never exposed to the client.
