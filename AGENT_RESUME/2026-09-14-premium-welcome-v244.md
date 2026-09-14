# 2026-09-14 — Premium Welcome (v244) — কোড-নেটিভ, ইমেজ ছাড়া

**Agent:** Arena Agent Mode · **Task type:** UI rebuild (Welcome / first-entry)

## ✅ যা করা হলো

- মালিকের দেওয়া ২য় রেফারেন্স ছবি অনুযায়ী প্রথম স্ক্রিন (Welcome) সম্পূর্ণ নতুন করে বানানো — **শুধু DOM + CSS + SVG কোড**, কোনো ছবি/রাস্টার নেই (zero-raster contract অক্ষুণ্ন)।
- **নতুন জার্নি স্ক্রিন:** গোলাকার scene কার্ড, মাঝখানে স্নাতক-টুপি কোর orb (কোড-আঁকা), ভেতরে-বাইরে দুটি dashed orbit, চারপাশে ভাসমান ৩টি satellite চিপ (compass / help / Verified), নিচে dotted progress track।
- **ব্র্যান্ড লকআপ:** টুপি-মার্ক টাইল + "Admission Hub" + "তোমার admission companion"।
- **অ্যাকশন:** Sign Up (সলিড গ্রিন) · Log In · Continue with Google · Continue as Guest (আন্ডারলাইন লিংক) — আগের চারটি path/id/aria অপরিবর্তিত, তাই কোনো auth লজিক বদলায়নি।
- ভাসমান AI helper (Need help? / I'm here!) কোড-আঁকা বট হিসেবে আছে (ডেস্কটপ)।
- **সরানো হয়েছে:** পুরনো v241 zero-raster 3D student/campus/cloud scene, console head/foot, ambient landscape, পিল স্ট্রিপ — সব ডেড CSS/মার্কআপ মুছে ফেলা হয়েছে।

## 🐞 আগের ব্লকারও ঠিক হলো

`Publish Telegram OTP Verification` workflow-এ আটকে থাকা ২টি পুরনো assert (`.ah-dob-wheel{`, `'চলো, তৈরি করি'`) ঠিক করা হয়েছে এবং নতুন Welcome marker যোগ করা হয়েছে।

## ✅ যাচাই (সব পাস)

- `npm run test:auth` → 62/62 · `npm run test:email` → 108/108 + 4/4 · `npm run test:native-auth` → **203/203** + agent-core 37/37
- `npm run audit:premium-browser` → **ok, pageErrors 0** (iPhone 13 + 1440×900)
- release workflow-এর ৫৬টি ফাইল-assert → **৫৬/৫৬ পাস** (`check_asserts`)
- iPhone 390 / 360 এবং ডেস্কটপ 1440 — horizontal overflow ০

## 📦 ভার্সন

Merged হলে: shell `v244-premium-welcome-20260914`, assets `20260914-premium-welcome-v1`

## ⏭️ Next

1. এই PR merge → তারপর `Publish Telegram OTP Verification` (confirmation: `PUBLISH_TELEGRAM_OTP`) চালিয়ে লাইভে publish।
2. খোলা PR #71 (পুরনো 3D hero কাজ) close করা।
