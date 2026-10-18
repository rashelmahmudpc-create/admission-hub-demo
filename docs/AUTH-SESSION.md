# AdmissionSky Auth — Session Instructions (এজেন্ট প্রতি session এ আগে এটা পড়বে)

মালিক প্রতি session এ শুধু ৩ লাইনের একটা বার্তা দেন। বাকি সব নিয়ম এখানে আছে।
কোন ধাপ কতদূর এগোল, সেটা লেখা আছে `docs/AUTH-ROADMAP.md` এ। Roadmap শেষ না হওয়া পর্যন্ত এই দুইটা ফাইল রাখতে হবে।

## প্রতি session এ কী করবে
1. `docs/AUTH-SESSION.md` (এই ফাইল) আর `docs/AUTH-ROADMAP.md` পড়ো। ধাপ ১ এর কাজ হলে `docs/AUTH-STEP1-PLAN.md` ও পড়ো। কোনো ধাপের আলাদা plan ফাইল থাকলে সেটাও।
2. Roadmap এ প্রথম যে 🟡 বা ⬜ ধাপ, সেখান থেকে কাজ শুরু করো। আগের ✅ ধাপ শুধু এক লাইনে verify করো।
3. কম token: GitHub raw/grep দিয়ে শুধু দরকারি অংশ পড়ো, log দেখতে Cloudflare telemetry। বড় ফাইল print করবে না। Sandbox এ `npm ci` চালাবে না।
4. Read/test/branch/commit/PR এ অনুমতি লাগবে না। মালিক আগাম অনুমতি দিয়েছেন (১৮ অক্টোবর ২০২৬): test pass করলে অপেক্ষা না করে merge আর staging → production deploy করো। অর্ধেক বা test না হওয়া কাজ deploy করবে না।
5. প্রতিটা ধাপ আলাদা PR এ করো। Deploy এর ক্রম: `deploy-staging.yml` → `deploy-pages-worker.yml` (input `confirmation=DEPLOY`, শুধু main থেকে)।
6. Token ফুরিয়ে আসলে নতুন কাজ শুরু করবে না। পরের session এর জন্য কোন ফাইলের কোন জায়গায় কী করতে হবে, সেটা `docs/AUTH-STEPn-PLAN.md` এ লিখে রাখো।
7. Session শেষে `docs/AUTH-ROADMAP.md` এ চিহ্ন বদলাও (⬜→🟡→✅), "শেষ অবস্থা" অংশে ৩ লাইনে কী হলো আর পরের কাজ লেখো। নতুন কিছু জানলে এই ফাইলের "যা জানা আছে" অংশে যোগ করো। উত্তর দেবে সহজ বাংলায়, সংক্ষেপে।
8. সব ধাপ ✅ হলে মালিককে জানাও যে auth এর কাজ শেষ।

## কোথায় কী আছে
| জিনিস | ঠিকানা |
|---|---|
| Repo | `rashelmahmudpc-create/admission-hub-demo` (branch `main`) |
| Frontend | `account-access.js` (OTP: ~2940/3007, ~3397/3423, ~3747/3763) |
| Backend | `auth-native/worker/public-auth-handler.mjs` (signup ~722, email-ownership ~1243), `auth-native/providers/firebase-auth.mjs`, `auth-native/verification/orchestrator.mjs`, `auth-native/worker/auth-authority-do.mjs` |
| Log/Alert | `observability/otp-delivery-log.mjs`, `observability/otp-alert.mjs` |
| Config | `wrangler.toml` (production), `wrangler.staging.toml` (staging) |
| Cloudflare account | `abb783e456e51a5d338419de93d5e576` |
| Workers | `admission-gk` (production), `admission-gk-staging` |
| Log খোঁজা | Workers telemetry তে `otp_delivery` / `otp_request` |
| Site / Firebase | `admissionsky.pages.dev` / `admissionsky-997d2` |
| OTP ক্রম | `VERIFICATION_ORCHESTRATOR_CONFIG` (`otp-l` OTP, `otp-m` Magic Link) |
| Secrets | `TURNSTILE_SECRET_KEY`, `TG_BOT_TOKEN`, `TG_CHAT_ID` (শুধু production এ) |

## যা জানা আছে
- `admission-gk-staging` এ একটাও secret নেই, তাই সেখানে আসল OTP test করা যায় না। আসল test production এ হয়, মালিক site থেকে করেন।
- OTP API তে Turnstile লাগে, তাই agent নিজে OTP পাঠাতে পারে না।
- Worker ৬৪ variable সীমায় আছে। নতুন var যোগ করা যাবে না, secret বা code default ব্যবহার করো।
- `worker-bundle.mjs` ~১.৫ MB। Bundle বানাতে branch এ একটা self-removing workflow দাও (PR #106 এর নিয়মে)। Deploy এর আগে CI তে `check:worker-bundle` pass করতে হবে।
- `test:native-auth` এ ২টা test আগে থেকেই ব্যর্থ (HttpOnly cookie, release guard literals)। কিছু guard check main এও ব্যর্থ। এগুলো নতুন সমস্যা না।
- `auth-native/` এর ভেতরে `console.*` লেখা নিষেধ (guard test আছে)। Log এর জন্য `observability/` এর sink ব্যবহার করো।
- Temp-mail blocking আর allowed-domain list বদলাবে না।
- `auth_verification_challenges` আর `auth_email_ownership_links` এ `user_id` → `auth_users` FK আছে; account ছাড়া OTP পাঠাতে আলাদা table লাগবে (দেখো `AUTH-STEP1-PLAN.md`)।
- Sandbox এ `git clone --depth 1` করে `node --test` চলে (`npm ci` লাগে না): `native-auth.test.mjs native-auth-operations.test.mjs native-auth-protection.test.mjs verification-orchestrator.test.mjs` → 126/128, পুরোনো ২টা fail।
- Composio দিয়ে commit করতে পুরো ফাইল পাঠাতে হয়; `public-auth-handler.mjs` (~২১০০ লাইন) বড়, তাই নতুন logic আলাদা ছোট ফাইলে রাখো (যেমন `auth-native/worker/pending-signup.mjs`) আর handler এ শুধু কয়েক লাইন যোগ করো।
