# 2026-09-14 — Welcome clean-up (v245): মূল ডিজাইন রেখে 3D hero বাদ

**Agent:** Arena Agent Mode · **Task type:** UI fix (owner review)

## ✅ যা করা হলো

- মালিকের নির্দেশে Welcome-এর **আগের ডিজাইন অপরিবর্তিত** রাখা হয়েছে (STUDY PATH console + 4টি benefit + 4টি entry path)।
- শুধু উপরের **বড় 3D student scene** (student/campus/cloud/object/leaf/orbit) — মার্কআপ ও CSS — সম্পূর্ণ বাদ দেওয়া হয়েছে, যাতে পেজটা clean লাগে।
- Console Card এখন তার আসল কনটেন্ট দিয়েই উচ্চতা নেয় (fixed min-height সরানো হয়েছে); pointer parallax আগের মতোই আছে।
- shell `v246-fit-welcome-20260914`, assets `20260914-fit-welcome-v1`

## ✅ যাচাই

- auth 62/62 · email 108/108 + 4/4 · native-auth **203/203** · browser audit **ok, pageErrors 0**
- release workflow-এর ফাইল-assert **53/53** (এবার v242-এর পুরনো ২টি assert-ও ঠিক করা হয়েছে)
- মোবাইল 390/360 + ডেস্কটপ 1440 — overflow ০; Personal ধাপ অপরিবর্তিত

## ⏭️ Next

Publish (`PUBLISH_TELEGRAM_OTP`) চালিয়ে v245 live করা, তারপর Personal/Security ধাপে একই ধরনের clean-up দরকার হলে আলাদা phase।
