# Descope Magic Link (otp-m)

- Button: "Email-এ login link পাঠাও" (verification method list, next to Email OTP).
- Send: `POST https://api.descope.com/v1/auth/magiclink/signup-in/email` `{loginId, URI: "https://admissionsky.pages.dev/?magic=1"}`; Descope appends `&t=<token>`.
- Verify: `POST /v1/auth/magiclink/verify {token}` from the Worker; requires `user.verifiedEmail === true` and an exact match with the challenge-bound email.
- Auth: `Authorization: Bearer <projectId>` only. No management key. sessionJwt/refreshJwt are never logged, returned or stored.
- otp-m is never part of the code failover; a magic-link request never falls back to another provider.
- Browser: the attemptId lives in a 10-minute `ah_magic_v1` cookie (no Web Storage). The token is read once from the URL and removed immediately with `history.replaceState`.
- The link must be opened in the same browser that requested it, because the HttpOnly verification ticket is needed.
- Free plan: the email subject/template stays the Descope default.
