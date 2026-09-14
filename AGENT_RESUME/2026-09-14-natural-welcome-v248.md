# 2026-09-14 — Welcome আবার আগের মতোই, স্ক্রল থাকতে পারে (v248)

**Agent:** Arena Agent Mode · **Task type:** owner correction (মালিকের সংশোধন)

## ✅ মালিকের কথা

> "দূর ভাই এগুলো কি বাদ দে আগের মতো করে দে মানে কিছু বাদ যাবে না আবার কিছু ছোট ও হবে না scrolling থাকলে থাকুক সমস্যা নাই"

অর্থাৎ: ফিট করার জন্য কনটেন্ট লুকানো, স্কেল/ছোট করা — সব বন্ধ। Welcome আগের (v245) ডিজাইনেই ফিরবে; পেজ স্ক্রল করলে অসুবিধা নেই।

## ✅ যা করা হলো

- `account-access.css` + `account-access.js` **হুবহু v245 অবস্থায়** ফেরানো হলো (`git checkout 3f9f0a0 -- …`)। ফলে:
  - `.ah-welcome-fit` / `.ah-welcome-fit-inner` / `--ah-fit` scaling / `is-scaled` — **সব বাদ** (০ রেফারেন্স)।
  - `height:100dvh` + `overflow:hidden` জোর করে এক স্ক্রিনে আটকানোর লেয়ার — বাদ।
  - `vh`/`vw` clamp করে ছোট করার মাপ — বাদ; সব এলিমেন্ট আবার **নিজের আসল সাইজে**।
  - উচ্চতার কারণে সাজসজ্জা লুকানোর মিডিয়া কোয়ারি — বাদ; **কিছুই লুকায় না**।
- পেজ এখন স্বাভাবিকভাবে **স্ক্রল করে** (ছোট ফোনে ~৯০–৪০০px) — মালিকের অনুমতি অনুযায়ী।
- শুধু একটা ছোট আসল বাগফিক্স রাখা হলো: `.ah-language-picker select{font-family:inherit}` — নাহলে কোনো ব্রাউজারে ভাষার নাম placeholder বক্স হয়ে যেতে পারে (ডিজাইনে কোনো পরিবর্তন নয়)।
- shell `v248-natural-welcome-20260914`, assets `20260914-natural-welcome-v1`

## ✅ যাচাই (১৩টি viewport)

- ৩২০×৫৬৮ → ১৯২০×১০৮০: **কিছুই লুকানো নেই** (brand + console + ৪/৪ benefit কার্ড), **কিছুই স্কেল/ছোট করা নেই** (scalers=0, transform=none), horizontal overflow **০**, প্রতিটি entry path **৪৪px+** (আসল ৫০–৫৬px)।
- unit suites: auth 62/62 · email 108/108 + 4/4 · native-auth 203/203 · account-retirement 30/30 · worker bundle exact · release file asserts ৫৩/৫৩ (0 failing)।
- Browser audit: পাস, pageErrors 0।

## 🔒 প্রোটেকশন আপডেট (গুরুত্বপূর্ণ)

- v246-এ যোগ করা *"Welcome must fit one screen without scrolling"* assertion **তোলা হলো** — এখন স্ক্রল বৈধ।
- তার বদলে নতুন assertion: (১) ফোনে ৪টি benefit কার্ডই দৃশ্যমান থাকতে হবে, (২) Welcome-এ কোনো `ah-welcome-fit` / `is-scaled` / `--ah-fit` স্কেল-লেয়ার ফিরলে release আটকে যাবে, (৩) console + heading + Welcome আর্ট সব দৃশ্যমান থাকতে হবে, (৪) প্রতিটি entry path ≥৪৪px।
- `fit-check.mjs` (লোকাল) নতুন নিয়মে লেখা: স্ক্রল রিপোর্ট করে (ফেল নয়), কিন্তু **লুকানো/স্কেল/আড়াআড়ি overflow/ছোট বাটন** — যেকোনো একটা থাকলে exit ≠ 0।
