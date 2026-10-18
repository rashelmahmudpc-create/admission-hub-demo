# AdmissionSky Auth Roadmap

এজেন্ট: প্রথম ⬜/🟡 ধাপ থেকে কাজ শুরু করো। আগের ✅ ধাপ শুধু এক লাইনে যাচাই। পড়া/খোঁজা/PR এ অনুমতি লাগবে না; production deploy বা merge এর আগে মালিকের এক লাইনের "হ্যাঁ" লাগবে। প্রতি ধাপ আলাদা PR, আগে `admission-gk-staging` এ test। Session শেষে এই ফাইল আপডেট করো। উত্তর সহজ বাংলায়।

## কোথায় কী
| জিনিস | ঠিকানা |
|---|---|
| Frontend | `account-access.js` |
| Backend auth | `auth-native/worker/public-auth-handler.mjs`, `auth-native/providers/firebase-auth.mjs`, `auth-native/verification/providers.mjs` |
| Config | `wrangler.toml` (prod `admission-gk`), `wrangler.staging.toml` (`admission-gk-staging`) |
| Cloudflare account | `abb783e456e51a5d338419de93d5e576` |
| Firebase | `admissionsky-997d2` |
| OTP ক্রম | `VERIFICATION_ORCHESTRATOR_CONFIG` (Descope: `otp-l` OTP, `otp-m` Magic Link) |
| API | `/api/auth/v1/signup`, `/email-ownership/start`, `/email-ownership/verify`, `/password-reset` |

## জানা তথ্য (২০২৬-১০-১৮)
- Worker 64-variable সীমায় আছে: নতুন var যোগ করা যাবে না।
- Signup এ OTP এর আগেই Firebase account তৈরি হয়।
- Forgot password শুধু Firebase ডাকে; Descope যুক্ত নেই।
- OTP: server ~৪ সেকেন্ডে provider কে দেয়, পৌঁছায় দেরিতে; কোন provider গেল log হয় না।
- Mailjet (`otp-c`) gmail sender দিয়ে "success" বলে কিন্তু email পৌঁছায় না; Dead Simple (`otp-g`) spam এ যায়।
- Resend (`otp-d`) এর `RESEND_FROM_ADDRESS` secret বসানো নেই, তাই সম্ভবত বন্ধ।
- Temp mail/অনুমোদিত domain: ঠিক আছে, হাত দেবে না।

## ধাপ (⬜ বাকি · 🟡 চলছে · ✅ শেষ)
- 🟡 **০. Log/observability**: [x] wrangler.toml এ স্থায়ী log (PR) · [ ] wrangler.staging.toml · [ ] প্রতি OTP তে provider/সময়/ফল log · [ ] Telegram alert
- ⬜ **১. OTP যাচাইয়ের পরে account**: নাম→জন্ম তারিখ→স্কুল/কলেজ→email→password সাময়িক (১০ মিনিট) → OTP সঠিক হলে Firebase account → dashboard
- ⬜ **২. Bot/অপব্যবহার**: device প্রতি দিনে ৫ OTP (cookie+fingerprint+IP/ASN) · Turnstile server-যাচাই · Bot Fight Mode + WAF rate limit · ডেটা সেন্টার ASN আটকানো · honeypot/timing
- ⬜ **৩. OTP UX**: provider গ্রহণ না করা পর্যন্ত loading → তারপর OTP বক্স · সুন্দর countdown · ব্যর্থ হলে retry
- ⬜ **৪. Provider ক্রম/fallback**: branded (Brevo, AgentMail) আগে · বাকিরা আগের ক্রমে · spam-প্রবণ শেষে · Firebase সবার শেষে · live health দেখে ধীরকে পিছনে · ৫–৮s এ পরেরটায়
- ⬜ **৫. Forgot password**: আগে Descope Magic Link (`otp-m`), backup Firebase · নিজস্ব `/reset` পাতা · Firebase custom action URL · চাপা error log
- ⬜ **৬. চেনা device ৩০ দিন OTP ছাড়া**
- ⬜ **৭. নতুন ফ্রি provider (domain ছাড়া) খোঁজা ও test**
- ⬜ **৮. পুরো audit ও লক**: পুরো ধারা test · অব্যবহৃত secret পরিষ্কার · দৈনিক OTP probe · deploy শুধু CI দিয়ে

## শেষ অবস্থা
- ২০২৬-১০-১৮: কারণ খোঁজা শেষ; prod log dashboard থেকে চালু; ধাপ ০ এর প্রথম PR খোলা।
- পরের কাজ: ধাপ ০ এর বাকি অংশ।
