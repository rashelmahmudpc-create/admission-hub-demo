# otp-b (ফ্রি Gmail backup) চালু করার গাইড

Brevo (দিনে ৩০০) + Apps Script/Gmail (দিনে ১০০) = **দিনে ৪০০ OTP**, আর Brevo
শেষ হলে orchestrator নিজে থেকেই otp-b-তে ঘুরে যায়। কোনো domain, DNS, SPF/DKIM
বা টাকা লাগে না।

## Worker-এর দিক: শেষ (আমি করে দিয়েছি)

- `OTP_B_PROVIDER_SHARED_SECRET` — Cloudflare Worker `admission-gk`-এ **set করা আছে**
- `OTP_B_DAILY_QUOTA=100` — `wrangler.toml`-এ আছে
- orchestrator config — `otp-b` আগেই `enabled:true, priority:20`

শুধু `OTP_B_PROVIDER_APPS_SCRIPT_URL` বাকি, যেটা নিচের ধাপ ২ থেকে আসে।

## আপনার দিক: ২ ধাপ, ~৫ মিনিট

### ধাপ ১ — script.google.com-এ script বানান

1. <https://script.google.com> → **New project**
2. ডিফল্ট কোড মুছে `apps-script/Code.gs`-এর পুরো কনটেন্ট পেস্ট করুন
3. **Project Settings → Script Properties → Add script property** — দুটো দিন:

   | Property | Value |
   | --- | --- |
   | `SHARED_SECRET` | chat-এ দেওয়া ৪৩-অক্ষরের secret-টা হুবহু পেস্ট করুন |
   | `DAILY_LIMIT` | `100` |

   এই secret-টা ইতিমধ্যেই Cloudflare Worker `admission-gk`-এ
   `OTP_B_PROVIDER_SHARED_SECRET` হিসেবে বসানো আছে, তাই **হুবহু একই** দিতে হবে।
   মান দুই দিকে না মিললে Apps Script প্রতিটা কল `403 forbidden` দিয়ে ফিরিয়ে দেবে।

   > Secret-টা কখনো repo, ডক, screenshot বা chat-এর বাইরে কোথাও লিখে রাখবেন না।
   > নতুন secret দরকার হলে: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
   > — তারপর আমাকে দিন, আমি Cloudflare-এ আপডেট করে দেব।

### ধাপ ২ — Web app হিসেবে deploy করুন

**Deploy → New deployment → Web app**

- **Execute as:** `Me`
- **Who has access:** `Anyone` ← এটা অবশ্যই `Anyone`, নইলে Worker ঢুকতে পারবে না

> `Anyone` মানে উন্মুক্ত নয় — প্রতিটা কলে HMAC signature, ৩০০ সেকেন্ডের clock-skew
> চেক আর single-use nonce লাগে, তাই শুধু URL জানলেই কেউ মেইল পাঠাতে পারবে না।

Deploy করার পর **`/exec` URL** কপি করুন (`https://script.google.com/macros/s/.../exec`)।

### ধাপ ৩ — আমাকে URL-টা দিন

URL পেলেই আমি বসিয়ে, deploy করে, live যাচাই করে দেখাব।

## যাচাই যেভাবে হয়

repo-র **আসল** provider কোড দিয়েই (mock ছাড়া):

```sh
node scripts/verify-otp-b.mjs "<exec-url>" "<the 43-char shared secret>"
```

তিনটা live চেক চলে — `checkAvailability` (GET health), `getRemainingQuota`
(GET quota), আর চাইলে `sendVerification` (POST send, সত্যিকারের মেইল)।

সব ঠিক থাকলে `/api/auth/v1/config`-এ `backup.availabilityCode` `READY` দেখাবে
আর Brevo-র quota শেষ হলে OTP নিজে থেকেই Gmail দিয়ে যাবে।
