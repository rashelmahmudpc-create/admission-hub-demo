# 2026-09-14 — এক স্ক্রিনে ফিট, কিন্তু কিছুই লুকানো নেই (v247)

**Agent:** Arena Agent Mode · **Task type:** owner correction (মালিকের সংশোধন)

## ✅ যা করা হলো

- **কিছুই আর লুকানো নেই।** v246-এ ছোট স্ক্রিনে ৪টি benefit কার্ড (Learn / Practice / Improve / Achieve) `display:none` করে ফিট করা হয়েছিল — মালিক সেটা নাকচ করেছেন। এখন **প্রতিটি ডিভাইসে চারটি কার্ডই দেখা যায়**, শুধু সাইজ ছোট হয়।
- ফিট করার নতুন পদ্ধতি: উপরের কনটেন্ট (header + console + 4টি benefit) `.ah-welcome-fit` বাক্সে থাকে, আর ছোট ডিভাইসে দরকার হলে শুধু এই অংশটাই `--ah-fit` scale-এ হালকা ছোট হয় (JS `fitWelcomeView()`)। `height:100dvh` flex কাঠামোতে বাক্সটি আগেই ছোট আকারের জায়গা রিজার্ভ করে, transform-এর গায়ে লাগানো নয় — তাই কিছুই কাটা পড়ে না বা বাটনের নিচে ঢাকা পড়ে না।
- **নিচের চারটি বাটন কখনো ছোট/সঙ্কুচিত হয় না** — Sign Up / Log In / Google ৪৬–৫৮px, Guest ৪৪px+ touch target সব স্ক্রিনে। UI বড় করার কারণে স্কেল থাকলেও বাটনগুলো আসল সাইজেই থাকে।
- সব জায়গায় `vh`/`vw` clamp দেওয়া হয়েছে (brand, console, benefit কার্ড, গ্যাপ) — বড় স্ক্রিনে বড়, ছোট স্ক্রিনে ছোট; কোনো fixed ফাঁকা জায়গা নেই।
- শুধু সাজসজ্জার অংশ ছোট উচ্চতায় (≤৭০০px / ≤৬৬০px / ≤৫৬০px) লুকায়: নিচের landscape আর্ট, brand-এর tagline, console-এর ছোট label — কোনো তথ্য বা কনটেন্ট নয়।
- ভাষা-সিলেক্ট এখন `font-family:inherit` — আগে form control-এর ডিফল্ট ফন্টে বাংলা tofu বক্স হতে পারত।
- shell `v247-fit-welcome-20260914`, assets `20260914-fit-welcome-v2`

## ✅ যাচাই

- ১৩টি viewport (৩২০×৫৬৮ → ১৯২০×১০৮০): **scroll overflow ০**, ৪টি benefit কার্ডই দৃশ্যমান, প্রতিটি entry path ৪৪px+।
- `clip-check.mjs` দিয়ে headerTop / guestBottom মেপে দেখা হয়েছে — viewport-এর বাইরে কিছু বেরোয় না।
- unit suites: auth 62/62 · email 108/108 + 4/4 · native-auth 203/203 · browser audit pageErrors 0 · release file asserts ৫৩/৫৩ (0 failing)।

## 🔒 নতুন প্রোটেকশন

- `fit-check.mjs` এখন চারটি জিনিস কঠোরভাবে যাচাই করে: (১) এক স্ক্রিনে ফিট, (২) চারটি benefit কার্ড প্রতিটি viewport-এ দৃশ্যমান, (৩) প্রতিটি entry path ≥৪৪px, (৪) পুরো stack viewport-এর ভেতরে। যেকোনো একটি ফেল করলে exit code ≠ 0 — অর্থাৎ আবার কনটেন্ট লুকিয়ে ফিট করার চেষ্টা CI-তে ধরা পড়বে।
