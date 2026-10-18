# ধাপ ১ এর পরিকল্পনা: OTP যাচাইয়ের পরে account তৈরি (হালনাগাদ: ১৮ অক্টোবর ২০২৬, ৭ম session)

অবস্থা: 🟡 code পড়া শেষ, নকশা ঠিক হয়েছে। Code এ কোনো পরিবর্তন বা deploy হয়নি।

## এখনকার ধারা (যাচাই করা)
- `public-auth-handler.mjs` ~722 `POST /signup`: সাথে সাথে `provider.signUp()` (~735) → `/internal/firebase/account-verification/begin` দিয়ে ticket (refreshToken encrypt করে) → `__Host-ah_verification` cookie → 202 `{accountCreated:true, verification:{selectionRequired:true, options:{email, telegram}}}`।
- Frontend (`account-access.js` ~3266 আর Sky ~3852) এরপর `/profile/pending` (~1484, ticket দিয়ে profile রাখে) → `/email-ownership/start` (~1243, Turnstile ~1251) → `/email-ownership/verify` (~1311) → `account-verification/complete` → session cookie।
- DO: `auth-authority-do.mjs` `#preverificationIdentity` ticket থেকে `userId/subjectRef/emailRef` নিয়ে orchestrator এর `trustedIdentity` বানায়। Alarm ~521: `engine.cleanup()` + `verification.cleanup()`।

## কেন পুরোনো পরিকল্পনা চলবে না
- `auth_verification_challenges` আর `auth_email_ownership_links` (`verification/sqlite-verification-repository.mjs`) এ `FOREIGN KEY(user_id) REFERENCES auth_users`। DO SQLite এ FK চালু, তাই ভুয়া userId দিয়ে OTP challenge লেখা যাবে না।
- `auth_users.status` শুধু `active/disabled/suspended` — "pending" user রাখার জায়গা নেই, আর রাখলে admin student list এ দেখা যাবে।

## নতুন নকশা (frontend API একই থাকবে, শুধু server বদলাবে)
Frontend আগের মতোই `/signup` → `/profile/pending` → `/email-ownership/start` → `/verify` ডাকবে। Server ভেতরে ticket এর ধরন দেখে ঠিক করবে আগের ধারা না নতুন ধারা।

## করণীয় (ক্রম অনুযায়ী)
1. **নতুন ফাইল `auth-native/worker/pending-signup.mjs`** (handler ছোট রাখতে সব logic এখানে):
   - DO তে নতুন table `auth_pending_signups(ticket_ref PK, email_ref UNIQUE, email_cipher, password_cipher, email_mask, profile_json, device_ref, ip_ref, created_at, expires_at)` — FK নেই। Email আর password `AuthSecretVault.seal(..., 'pending-signup:<ticketRef>')` দিয়ে encrypt।
   - TTL ১০ মিনিট। একই email এ আবার signup করলে পুরোনো row বদলে যাবে।
2. **OTP এর জন্য আলাদা challenge** (FK সমস্যা এড়াতে): `auth_pending_signup_challenges(attempt_id PK, ticket_ref, code_mac, attempts, expires_at, provider_id)`। Code পাঠাতে orchestrator এর provider delivery আর rate limit (destination/IP/device) ব্যবহার, কিন্তু `#record`/challenge লেখা এই নতুন table এ। সহজ উপায়: orchestrator এ ছোট `deliverOnly({email, recipientName, code, context})` method যোগ (provider loop + `onDeliveryEvent` log একই থাকবে, purpose `signup`)।
3. **DO route** (`auth-authority-do.mjs`): `/internal/signup/pending/begin`, `/pending/profile`, `/pending/request`, `/pending/verify`, `/pending/consume`। `alarm()` আর `#scheduleExpiry()` এ মেয়াদ শেষ row মুছে ফেলা যোগ।
4. **Handler** (`public-auth-handler.mjs`, শুধু কয়েক লাইন):
   - `/signup` ~735: `signUp()` এর বদলে `pending/begin`; response একই আকারের, কিন্তু `accountCreated:false`, `telegram.available:false`। Cookie এ ticket এর আগে `p.` prefix (যেমন `p.<token>`) যাতে ধরন বোঝা যায়।
   - `/profile/pending`, `/email-ownership/start`, `/verify`: ticket `p.` দিয়ে শুরু হলে নতুন ধারা।
   - `/verify` সফল হলে: `provider.signUp(email, password)` → `account-verification/begin` (আসল ticket) → pending profile কে `save-pending` এ সরানো → ownership link আসল userId তে লেখা (verification repo তে `recordEmailOwnership` method যোগ, sqlite + memory দুটোতেই) → `account-verification/complete` → `authSuccess` → pending row মুছে ফেলা।
   - `EMAIL_EXISTS` হলে পরিষ্কার message: "এই ইমেইলে আগেই অ্যাকাউন্ট আছে, লগইন করুন"। সম্ভব হলে `/signup` এই `emailRef` দিয়ে `auth_users` এ খুঁজে আগেই জানিয়ে দেবে।
   - সব OTP provider ব্যর্থ হলে (`BACKUP_UNAVAILABLE`): তখনই account বানিয়ে আগের মতো Firebase link পাঠানো (শেষ ভরসা, ধাপ ৪ এর নিয়ম)।
5. **Test**: নতুন `pending-signup.test.mjs` (signup এ Firebase ডাকা হয় না; ভুল OTP তে account হয় না; সঠিক OTP তে একবারই `signUp`; ১০ মিনিট পরে row মুছে যায়; password log/response এ আসে না)। `package.json` এর `test:native-auth` এ যোগ। পুরোনো test যেগুলো `/signup` এ `accountCreated:true` ধরে নেয়, সেগুলো হালনাগাদ।
6. **Bundle**: branch এ self-removing workflow দিয়ে `npm run build:worker` (PR #106 এর নিয়মে), CI তে `check:worker-bundle` pass।
7. **Deploy**: `deploy-staging.yml` → (staging এ secret নেই, তাই শুধু unit test + `/api/auth/v1` health) → merge → `deploy-pages-worker.yml` (`confirmation=DEPLOY`)। এরপর মালিক site থেকে একটা নতুন signup করে দেখবেন; telemetry তে `otp_delivery` purpose `signup`।
8. পুরোনো ধারা (`accountCreated:true` ticket) কিছুদিন চালু থাকবে, যাতে cache এ থাকা পুরোনো frontend বা মাঝপথের signup না ভাঙে।

## খেয়াল রাখো
- `auth-native/` এ `console.*` নিষেধ; log শুধু `observability/` sink দিয়ে।
- নতুন env var যোগ করা যাবে না (৬৪ সীমা); TTL ইত্যাদি code default।
- Temp-mail blocking আর allowed-domain list বদলাবে না।
