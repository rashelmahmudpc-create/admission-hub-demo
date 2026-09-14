# v252 — Login / Verify / Email / Telegram / Passkey: owner reference screens

**Updated:** 2026-09-14 (Asia/Dhaka) · Agent: **Arena Agent Mode**

## WHAT THE OWNER ASKED

> "এখন যে পেইজ গুলো দিলাম সেগুলো … এই সংক্রান্ত signup/sign in যে onboarding page গুলো ছিলো সেগুলোর বদলে ইমেজের মতো দিবে মনে রাখবে এগুলো ডেমো ইমেজ তাই তুমি এগুলো সরাসরি বসিয়ে না দিয়ে high quality coding করে করবে"

Reference screens supplied: `IMG_4018.png` (verification-method selector),
`IMG_4013.png` (Log In), `IMG_4010.png` (Create Passkey),
`IMG_4012.png` (Telegram verify), `IMG_4009.png` (Email verify).

## WHAT CHANGED (only these five screens, code-native only)

1. **Log In** (`data-login-contract="reference-login-v1"`) — green hero orb,
   `আবার দেখা হলো` + preparation sub-copy, EMAIL / PASSWORD card fields with
   icons, eye-icon password toggle, **Remember me** (session-memory email
   prefill — browser-persisted credential stores stay forbidden by the
   native-auth-protection guard), `Forgot password?`, gradient `Log In →`,
   `OR` divider, Google host, white `Use Passkey` card, help fab + tips card,
   `Don't have an account? Sign Up`.
2. **Verification selector** (`data-verify-contract="reference-verify-v1"`) —
   title `একটি verification method বেছে নাও`, four SVG icon-chip cards
   (Email Recommended + selected check, Passkey locked/disabled, WhatsApp
   with the exact unavailable line, Telegram with the real-code line), truth
   note kept verbatim, help fab + `অন্য কোনো সমস্যা? Help নাও`.
3. **Email** (`data-email-contract="reference-email-v1"`) — mail hero + shield
   badge shared by `email-intro` and the waiting panel; address card with
   shield; `Open Email →`; status flips to `✓ Verification email sent`;
   resend summary renamed `Verification email আবার পাঠান`.
4. **Telegram intro** (`data-telegram-contract="reference-telegram-v1"`) —
   paper-plane orb + dashed orbit + check badges, `Telegram Verification Bot`
   card, blue `Continue with Telegram`, START/code truth line,
   `অন্য পদ্ধতি ব্যবহার করো` back button. The OTP form view is untouched.
5. **Passkey setup** (`data-passkey-contract="reference-passkey-v1"`) — phone
   + fingerprint hero with Face-ID/key badges, Face ID / Fingerprint /
   Device Lock cards, `Create Passkey →`, built-in-security footnote,
   `পরে করব`, optional-note kept.

Shared: one generic `[data-help-toggle]` handler (plain div show/hide, no
dialog semantics, no network); password eye/eye-off SVG swap in the shared
toggle handler (login + both signup fields); Remember-me is tab-session
memory only.

## TRUTH KEPT (tests enforce these)

- 4 method cards; `Email OTP নয়` + unavailable + real-code lines intact;
  Passkey stays `disabled`; WhatsApp still routes to the info view.
- `whatsapp-info` view and the Telegram OTP form are byte-identical.
- Zero raster: no img/picture/canvas/video tags, no `url()` backgrounds.
- No `localStorage`/`sessionStorage`/cookie credential storage anywhere.

## FILES

- `account-access.js` — five view templates + help/eye/remember logic.
- `account-access.css` — `Auth reference screens (v252)` block.
- `.github/workflows/telegram-auth-canary-activate.yml` — 6 new asserts.
- Markers: assets `?v=20260914-login-verify-v1`, service worker + `BUILD_ID`
  `v252-login-verify-20260914` (renamed from `auth-screens`: that substring
  trips the retirement guard's retired-marker check).

## VERIFIED

- auth 62/62 · native-auth 203/203 · agent-core 37/37 · retirement 30/30 ·
  marker suites 12/12 · release asserts local 78 grep-checks incl. 6 new.
- jsdom smoke (3 flows, since deleted): login controls, signup→created→
  verify→email-intro→waiting, telegram-intro→login→security-setup —
  zero JS errors, no duplicate ids, no media tags, no dialog semantics.
- Browser audit not re-runnable here (no Playwright browsers in sandbox);
  unit + smoke coverage is green, CI runs the audit on publish.
