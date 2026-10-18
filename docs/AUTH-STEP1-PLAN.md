# ধাপ ১ এর পরিকল্পনা: OTP যাচাইয়ের পরে account তৈরি (১৮ অক্টোবর ২০২৬)

অবস্থা: code এর জায়গা খোঁজা হয়েছে, code এ কোনো পরিবর্তন হয়নি। Token শেষ হয়ে আসছিল, আর অর্ধেক কাজ deploy করলে signup ভাঙতে পারত, তাই deploy করা হয়নি।

## এখনকার ধারা
- `auth-native/worker/public-auth-handler.mjs` লাইন ~722: `POST /api/auth/v1/signup` করলে সাথে সাথে `provider.signUp()` চলে, অর্থাৎ Firebase এ account তৈরি হয়ে যায় (লাইন ~735)। লাইন ~1090 এও আরেকটা `signUp` আছে।
- এরপর session নিয়ে `/email-ownership/start` আর `/verify` চলে (লাইন ~1243, এখানে Turnstile যাচাই হয় ~1251)। লাইন ~367 এ `emailOwnershipProven` না হলে login এ `EMAIL_NOT_VERIFIED` আসে।
- Frontend `account-access.js`: OTP start/verify হয় ৩ জায়গায়, লাইন ~2940/3007 (সাধারণ আর magic-link ~2988), ~3397/3423, আর ~3747/3763 (Sky onboarding)।

## পরিকল্পনা
1. নতুন `POST /signup/start`: Turnstile যাচাই করবে → email আর password যাচাই (আগের `prepared` logic) → নাম, জন্ম তারিখ, স্কুল আর password `AUTH_AUTHORITY` DO তে ১০ মিনিটের জন্য রাখবে (password রাখার আগে secret-vault দিয়ে encrypt করতে হবে) → orchestrator এর `requestVerification` কে `userId` ছাড়াই ডাকবে, subjectRef হবে email এর HMAC (আগে দেখতে হবে `#identity` এ userId লাগে কিনা)।
2. নতুন `POST /signup/verify`: OTP যাচাই → তবেই `provider.signUp()` → emailVerified/ownership চিহ্ন দেওয়া → session cookie → dashboard। কাজ শেষে pending row মুছে ফেলা।
3. DO alarm বা cron দিয়ে ১০ মিনিট পুরোনো pending row মুছে ফেলা।
4. পুরোনো `/signup` কিছুদিন রেখে দেওয়া, যাতে cache এ থাকা পুরোনো frontend না ভাঙে। Frontend এর তিনটা জায়গা নতুন API তে নেওয়া, আর `sw.js` এ BUILD_ID বাড়ানো।
5. Test: নতুন unit test লিখতে হবে, আর `test:native-auth` এ আগের মতোই শুধু ২টা পুরোনো ব্যর্থ test থাকবে। Bundle CI তে build করতে হবে (আগের self-removing workflow এর নিয়মে)। Deploy এর পরে মালিক একটা signup করে দেখবেন।

মালিকের অনুমতি (১৮ অক্টোবর): অপেক্ষা না করে merge আর deploy করা যাবে।
