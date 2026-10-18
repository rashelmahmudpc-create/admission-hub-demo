# AUTH-NEXT — এই session এর কাজ (শুধু এই ফাইল পড়ো)

এখন: ধাপ ১ 🟡 — OTP যাচাইয়ের পরে Firebase account। পুরো নকশা: `docs/AUTH-STEP1-PLAN.md` (দরকার হলেই, শুধু "করণীয়" অংশ)।
Branch: `auth/step1-pending-signup` (PR খোলা)। এই branch এই কাজ চালিয়ে যাও।

## হয়ে গেছে (session ৮)
- `auth-native/worker/pending-signup.mjs`: `PendingSignupStore` (DO KV, prefix `psu:`; TTL ১০ মিনিট; email+password একসাথে vault দিয়ে encrypt; device-bound `p.` ticket; rate limit email 5/device 10/ip 30 প্রতি ঘণ্টায়; `cleanup()`/`nextExpiry()`), `requestPendingSignupCode()` (orchestrator এর providers/repository/onDeliveryEvent দিয়ে পাঠায়, log purpose `signup`), `verifyPendingSignupCode()` (local code বা Logto এর মতো provider-evidence)।
- `pending-signup.test.mjs` (৮টা test)। Orchestrator ছোঁয়া হয়নি।

## এই session এর কাজ (করণীয় ৩–৪)
1. `auth-native/worker/auth-authority-do.mjs`: constructor এ `this.pendingSignups = new PendingSignupStore({ storage: state.storage, hmacSecret: env.AUTH_HMAC_SECRET })`; route `/internal/signup/pending/{begin,profile,request,verify,consume}`; `alarm()` এ `pendingSignups.cleanup()`, `#scheduleExpiry()` এ `pendingSignups.nextExpiry()`।
2. `public-auth-handler.mjs` ~735: `/signup` এ `signUp()` এর বদলে `pending/begin`, cookie তে `p.` ticket, response আগের আকারে (`accountCreated:false`, telegram `available:false`)। `/profile/pending` ~1484, `/email-ownership/start` ~1243, `/verify` ~1311: `isPendingSignupTicket(ticket)` হলে নতুন ধারা। Verify সফল → `provider.signUp` → `account-verification/begin` → profile `save-pending` → ownership link (verification repo তে `recordEmailOwnership`) → `complete` → `authSuccess` → `pending/consume`। সব provider বিকল হলে তখনই account বানিয়ে Firebase link।
3. `package.json` এর `test:native-auth` এ `pending-signup.test.mjs` যোগ।
4. Bundle: self-removing workflow (PR #106 এর মতো) → CI `check:worker-bundle`।

## Test (sandbox, `npm ci` ছাড়া)
`git clone --depth 1 -b auth/step1-pending-signup` → `node --test --test-concurrency=1 native-auth.test.mjs native-auth-operations.test.mjs native-auth-protection.test.mjs verification-orchestrator.test.mjs pending-signup.test.mjs`
এখন: 136 এর মধ্যে 134 pass, শুধু পুরোনো ২টা fail (HttpOnly cookie, release guard literals)।

## মনে রাখো
- `auth-native/` এ `console.*` নিষেধ (comment এও লিখবে না)। নতুন env var নিষেধ। Temp-mail/domain list ছোঁবে না।
- বড় ফাইল পুরোটা commit না; নতুন logic ছোট আলাদা ফাইলে।
- Deploy: `deploy-staging.yml` → `deploy-pages-worker.yml` (`confirmation=DEPLOY`), শুধু পুরো ধাপ test pass হলে।

## শেষ অবস্থা (৩ লাইন)
1. Session ৮: pending signup store + account ছাড়া OTP পাঠানো/যাচাই লেখা হলো, test সহ। এখনো signup বোতামের সাথে যুক্ত না।
2. Test: 134/136 pass (পুরোনো ২টা fail বাদে সব ঠিক)। Deploy হয়নি।
3. পরের কাজ: উপরের "এই session এর কাজ" ১–৪।
