# Verification provider audit

Scope: the verification providers wired into `auth-native/`, checked against the
live deployment at `https://admissionhub.pages.dev` on 2026-09-17.

## Summary

| Provider | Kind | Status | Action |
| --- | --- | --- | --- |
| `otp-a` (Brevo) | email OTP | Working | Fixed earlier in #90 |
| `otp-b` (Apps Script / Gmail) | email OTP fallback | Working | Fixed earlier in #90 |
| `otp-c` (bridge) | email OTP | Not configured | Left off; no credentials |
| WhatsApp | link/OTP | Working | None |
| Telegram | link | Working | None |
| Passkey | link | Working | None |
| Firebase email verification | email link | Broken (see below) | **Do not fix** |

Live readiness probe reports `{"available":true,"backup":true,"code":"READY","passkey":true,"telegram":true}`.

## Fixed one by one

### `otp-a` — Brevo

Was failing because the sender address was an unverified Gmail account. Brevo
refuses to relay from a sender it has not authenticated, and the domain was not
in the account, so every send was rejected before leaving the API.

Fixed by sending through an authenticated Brevo sender with `BREVO_FROM_NAME`
set, and by treating the daily free-tier ceiling as a routable condition rather
than an error. Daily budget is about 300 messages.

### `otp-b` — Google Apps Script

The backup path existed but was not wired to take over automatically. It now
sends when `otp-a` reports the daily ceiling, so a day that exhausts Brevo still
delivers OTPs. Daily budget is 100 messages on a consumer Gmail account and
1,500 on Workspace; the declared quota is configuration, not a hardcoded value.

### `otp-c` — bridge provider

Present in the catalog with no origin or key configured. It stays disabled. No
credentials were invented for it.

## Not fixed, by explicit instruction

### Firebase email verification

Firebase sends its own verification email from Google infrastructure. Its sender
identity, subject, and body cannot be restyled, and its logo cannot be
substituted. It is reported here so the gap is on record, and it is deliberately
left untouched.

Consequence: a user who verifies through Firebase sees a generic Google-branded
message, not the branded Admission Hub template. The only way to remove that
inconsistency is to stop routing verification through Firebase and use the Brevo
and Apps Script providers for that flow as well. That is a product decision, not
a bug fix, so it is out of scope for this audit.

## Inbox avatar: why it still shows "A"

This is not an email-body problem and cannot be fixed by editing the template.

Gmail draws the circular avatar beside a message from one of three sources:

1. The sender address's Google account profile photo, when the sender is a
   Gmail or Google Workspace account.
2. A BIMI logo, when the sending domain publishes a BIMI record **and** the
   record carries a certificate Gmail accepts.
3. A generated monogram from the display name — the "A" — when neither of the
   above is present.

Two findings explain the current behaviour:

- The sender address is a `gmail.com` mailbox. The logo in the message header is
  served by the domain, so it appears when the message is opened, but the avatar
  is resolved from the Gmail account and is unaffected by anything in the HTML.
- No domain publishes a BIMI record, and no domain is DMARC-enforced, so Gmail
  has nothing to substitute and falls back to the monogram.

### Gravatar does not solve this

Gravatar is sometimes suggested for sender avatars. Gravatar's own support
documentation states that most popular email services, including Gmail, Outlook,
and Apple Mail, do not read it. It is consulted by third-party clients such as
Thunderbird, Spark, and Superhuman. Creating a Gravatar is harmless but will not
change the avatar in Gmail, so it is not part of this plan.

### What a BIMI rollout actually requires

All of the following are needed. All but the certificate are DNS work; the
certificate is a purchase with a lead time.

| Requirement | Current state |
| --- | --- |
| Sender on a custom domain, not `gmail.com` | Not done — sending from Gmail |
| DKIM signing, aligned with the From domain | Not present on any domain |
| DMARC at `p=quarantine` or stricter, aligned | `.net` is `p=quarantine`; `.app` is `p=none`; `.com` and `.org` have none |
| BIMI record at `default._bimi.<domain>` | Absent on every domain |
| SVG Tiny PS logo, square, HTTPS | Prepared: `email-preview/admissionhub-bimi.svg` |
| VMC or CMC for Gmail | **Not obtained — required** |

Gmail requires a Verified Mark Certificate or a Common Mark Certificate. A
standalone SVG is not displayed by Gmail. A VMC needs a registered trademark and
is issued by DigiCert or Entrust; a CMC does not need a trademark and shows the
logo without the blue checkmark. Trademark registration runs 6 to 12 months,
which is the long pole in any timeline.

### Checking the records

`auth-native/operations/verify-email-branding.mjs` reports every record above in
one pass and exits non-zero while a gating requirement is missing:

```
node auth-native/operations/verify-email-branding.mjs admissionhub.net
```

Current results:

| Domain | Result |
| --- | --- |
| `admissionhub.net` | 3/9 — DMARC enforces at `p=quarantine`; SPF, DKIM, BIMI, and the certificate are missing |
| `admissionhub.com` | SPF present; no DMARC; no BIMI |
| `admissionhub.app` | SPF present; DMARC `p=none`; no BIMI |
| `admissionhub.org` | No records resolve |

The DKIM check probes the `google._domainkey` selector, which is only correct
for Google-hosted mail, so that line is reported but does not gate the exit code.
The certificate line likewise reports without gating, because it is a purchase
rather than a configuration step.

`admissionhub.net` is the closest to BIMI-ready, since its DMARC policy is
already enforcing. No domain is reachable through the Cloudflare API token
available here (the zone list is empty), so records must be published wherever
DNS is actually hosted: `admissionhub.net` is on GoDaddy
(`domaincontrol.com`), `.app` is on DigitalOcean, `.com` is on
`bulletproofhost.ca`, and `.org` does not resolve.

### Sender name versus sender avatar

These are separate and both worth setting deliberately:

- `BREVO_FROM_NAME` is `Admission Hub`. This is the text Gmail shows, and the
  first letter of it is what the monogram fallback uses.
- The logo in the message header comes from the template and works today.
- The avatar is governed by BIMI, which is unresolved pending a certificate.

## Email design

The message is deliberately surface-flat. The body, the outer wrapper, and the
card all paint the same colour, so nothing frames the content as a box:

- Light: all three are `#ffffff`.
- Dark: all three are `#1f1f1f`, matching the tone Gmail's mobile dark mode uses
  for its own chrome.

The card carries no border and no shadow, and there are no inner boxes. Sections
are separated by spacing and 1px hairlines. The code sits large, bold, and
centered in monospace with nothing behind it. The security note is a lock glyph
plus muted text with no card of its own, and the lock is an inline SVG data URI,
so it depends on neither a network request nor an icon font.

Width is fluid rather than fixed: the wrapper is `width:100%` and the card is
`width:100%; max-width:600px; margin:0 auto`, so a phone gets the full width
instead of a narrow column.

Rendered output:

- https://admissionhub.pages.dev/email-preview/otp-email-light.png
- https://admissionhub.pages.dev/email-preview/otp-email-dark.png
- BIMI candidate: `email-preview/admissionhub-bimi.svg`

## Tests

- `verification-providers.test.mjs` — 16/16, including the design contract
  checked against markup only, so the style block cannot satisfy an assertion
  that the inline layout should
- `npm run test:native-auth` — 481/481
- `npm run check:worker-bundle` — exit 0
