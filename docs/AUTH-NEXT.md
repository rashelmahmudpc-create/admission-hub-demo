# AUTH-NEXT — এই session এর কাজ (শুধু এই ফাইল পড়ো)

এখন: ধাপ ১ 🟡 — OTP যাচাইয়ের পরে Firebase account। পুরো নকশা: `docs/AUTH-STEP1-PLAN.md` (দরকার হলেই, শুধু "করণীয়" অংশ)।

## এই session এর কাজ
করণীয় ১ + ২ (STEP1-PLAN):
- নতুন ফাইল `auth-native/worker/pending-signup.mjs`: table `auth_pending_signups` + `auth_pending_signup_challenges` (FK নেই), TTL ১০ মিনিট, email/password `AuthSecretVault` দিয়ে encrypt।
- `auth-native/verification/orchestrator.mjs`: ছোট `deliverOnly()` method (provider loop + `onDeliveryEvent` একই, purpose `signup`)।
- নতুন test `pending-signup.test.mjs`।
- এখনো handler/frontend বদলাবে না, deploy না। Branch: `auth/step1-pending-signup`, PR খোলা রাখো।

## Test (sandbox, `npm ci` ছাড়া)
`git clone --depth 1` → `node --test --test-concurrency=1 native-auth.test.mjs native-auth-operations.test.mjs native-auth-protection.test.mjs verification-orchestrator.test.mjs pending-signup.test.mjs`
আশা: শুধু পুরোনো ২টা fail (HttpOnly cookie, release guard literals)।

## মনে রাখো
- `auth-native/` এ `console.*` নিষেধ। নতুন env var নিষেধ। Temp-mail/domain list ছোঁবে না।
- বড় ফাইল পুরোটা commit করবে না; নতুন logic ছোট আলাদা ফাইলে।
- Deploy: `deploy-staging.yml` → `deploy-pages-worker.yml` (`confirmation=DEPLOY`), শুধু পুরো ধাপ test pass হলে।

## শেষ অবস্থা (৩ লাইন, প্রতি session এ বদলাও)
1. Session ৭: ধাপ ১ এর নকশা ঠিক হলো (FK এর কারণে আলাদা pending table)। Code হয়নি।
2. Docs: PR #112 merged। এই ফাইল যোগ হলো।
3. পরের কাজ: উপরের "এই session এর কাজ"।
