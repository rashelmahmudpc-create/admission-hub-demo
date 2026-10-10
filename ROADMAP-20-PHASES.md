# 🚀 ADMISSION HUB — ২০-ফেজ ওয়ার্ল্ড-ক্লাস মাস্টার রোডম্যাপ (লক্ষ্য-ডক)

> **Golden Rule:** প্রতিটি Phase → Build → Test → Bug Fix → মালিক নিজে ব্যবহার → মালিক APPROVE → তবেই পরের Phase।
> এক ফেজের কাজ আরেক ফেজের ভেতরে লুকানো যাবে না। ফাইনাল পাবলিক-লঞ্চ শুধু মালিকের "✅ APPROVED FOR PUBLIC LAUNCH"-এর পর।
> (দ্রষ্টব্য: আগে-থেকে-লাইভ থাকা অংশগুলো "লিগ্যাসি-কভারেজ" হিসেবে চিহ্নিত; নতুন কাজ ফেজ-বাউন্ডারিতে।)

## ✅ অগ্রগতি-চিহ্ন (২০২৬-০৯-০৪)
| ফেজ | অবস্থা |
|---|---|
| P01 Exact Clone | ✅ **FREEZE** — docs/PHASE-01-FREEZE.md (৩৭ render-পথ, ৬৯ মডিউল; অ্যাডমিন-লিক ০; D-P01-1/2) |
| P02 Cloud Content | ✅ **সম্পন্ন** — ড্রাফট→পাবলিশ→ভার্সন→রোলব্যাক (লাইভ); +pagination+duplicate-protection+offline-marker — docs/PHASE-02-CONTENT.md |
| P03 User Identity | ✅ **সম্পন্ন** — ইমেইল/পাসওয়ার্ড/Google/Passkey/সেশন/মডারেশন (লাইভ); স্মার্ট-সিএমএস-গেট — docs/PHASE-03-IDENTITY.md |
| P04 Personal Cloud | ✅ **সম্পন্ন** — ৬→৯ স্টোর সিঙ্ক (প্ল্যান/ডে/লুকানো-প্রশ্ন), conflict-free per-id মার্জ (সর্বশেষ-সময়), export-বাটন, সিঙ্ক-স্ট্যাটাস UI — docs/PHASE-04-PERSONAL.md |
| P05 AI Core/Brain | ✅ **সম্পন্ন** — একক `/api/ai`-গেটওয়ে + মডেল-রাউটার (failover-chain), টোকেন-বাজেট+কোষ্ট-ক্যাশ, pv-প্রম্পট-ভার্সন, মেট্রিক — docs/PHASE-05-AI.md |
| P06–P20 | পরবর্তী ক্রমে (গ্যাপ-রিপোর্ট নিচে সংরক্ষিত) |

## ২০ ফেজ এক লাইনে
01 Exact Clone · 02 Cloud Content · 03 User Identity · 04 Personal Cloud · 05 AI Core · 06 Personal AI Tutor · 07 Intelligent Questions · 08 Advanced Exam Engine · 09 Deep Analytics · 10 Smart Mistakes · 11 Adaptive Learning · 12 Smart Vocabulary · 13 Scale & Performance · 14 Security · 15 PWA/Offline · 16 UX & Accessibility · 17 AI Agents · 18 Admission Intelligence · 19 Production+SEO · 20 Final QA + Launch

---
# ADMISSION HUB — ২০-ফেজ গ্যাপ-রিপোর্ট (২০২৬-০৯-০৪)

**যাচাই-ভিত্তি:** লাইভ `admission-gk.admissionhub.workers.dev` (health ✓, auth/config ✓) · `demo/` সোর্স (index.html, public-worker.js, gk-agent-worker.js, sw.js, manifest) · `admin/` (AC-1..5 লাইভ, build `ac5-20260904-d`) · D1 `ahai-db` টেবিল-তালিকা · GitHub CI।
**লেজেন্ড:** 🟢 প্রায়-সম্পন্ন · 🟡 আংশিক (কী আছে → কী বাকি) · 🔴 শুরুতেই না।

---

## 🔷 P01 — Exact Admission Hub Clone — 🟡 ~৮০%
**আছে (লাইভ প্রমাণিত):** ড্যাশবোর্ড · বটম-নেভ · কোয়েশন-ব্যাংক (subject→topic→sub-topic→card) · এক্সাম-সেন্টার (Mock/Flash/Mistake) · ফলাফল+ইতিহাস · প্রগ্রেস+স্ট্রিক · ভোকাবুলারি · AI-টুলস (AI-mentor, Admihub AI 3D, شرح, বিশ্লেষণ) · থিম/অ্যানিমেশন/অনবোর্ডিং · PWA-শেল · `index.html`-এ title+description।
**বাদ-যাওয়া-তালিকা যাচাই:** public UI-তে `purser`/`editQuestion`/`deleteQuestion` **নেই** ✓ (grep-প্রমাণ)।
**বাকি:** ① "Clone Freeze" — ফিচার-ম্যাট্রিক্স-ডক (প্রতিটি স্ক্রিন/কার্ড/workflow-এর তালিকা+চেকবক্স) ② API-কনফিগ UI (user-API-key সেটিংস এখনো আছে — কোনো অপশনাল হিসেবে থাকবে কি বাদ যাবে: Owner-সিদ্ধান্ত) ③ স্পেক-লক (পরবর্তী ফেজে কোনো অননুমোদিত রিডিজাইন নয়)।

## 🔵 P02 — Central Cloud Content Engine — 🟡 ~৬০%
**আছে:** `/api/content` + `/api/content/meta` (লগইন-গেটেড) · `/api/cloud/publish` · `/api/admin/{content,publish,status,users}` · `cloud-content-sync.js` (ক্লায়েন্ট-সিঙ্ক) · D1-এ `content_draft`/`qb_versions`/`voc_versions` (admin-পাশ) · PUB_KV read-bind।
**বাকি:** ① কেন্দ্রীয়-ডেটাবেস একত্রীকরণ (বর্তমানে KV+D1-মিশ্র; পাবলিক-কাজে D1 চালু) ② Bulk-import UI+API ③ version-control-এর পূর্ণ জীবনচক্র (diff/rollback) ④ Incremental sync-ডেল্টা ⑤ Duplicate-protection-ব্যাপক (dictionary-parser-এ আছে) ⑥ Offline fallback-ক্যাশ-স্তর ⑦ লাখ-প্রশ্ন হ্যান্ডলিং (পেজিনেশন)।

## 🟣 P03 — World-Class User Identity — 🟢 ~৮০% (লাইভ)
**আছে (লাইভ):** register-email · login · logout · `otp/send`+`otp/verify` · password+forgot/reset · **Google** (`/api/auth/google` + link/unlink; client-id লাইভ) · **Passkey** (register/add/remove/login, begin/finish) · confirm/verify/verify-link/delete · me · session-management (tok+ sess list) · ব্র্যান্ডিং UI (`premium-auth`, auth-screens)।
**বাকি:** ① SMS-সক্রিয়করণ (config-এ `sms:false`; TWILIO/GREENWEB/BULKSMS secrets ঠিক আছে — নম্বর-সেটআপ+যাচাই) ② Account-status মডারেশন ③ প্রোফাইল-সমৃদ্ধি (নাম/ছবি/ইউনিট-প্রেফারেন্স) ④ KV→DB মাইগ্রেশন (ভবিষ্যৎ-স্কেল) ⑤ OTP/রেট-লিমিট-কঠোর-যাচাই।

## 🟠 P04 — Personal Cloud Data Engine — 🟡 ~৬৫%
**আছে:** token-ভিত্তিক per-user আইসোলেশন (`user:<id>`, `tok:<token>`, `sess:<uid>`) · cross-device (login → data ফেরত) · `collectPersonal` → examResults/mistakes/settings/dailyStats/activityLogs/notes · `/api/auth/delete` (GDPR-ধাঁচ)।
**বাকি:** ① ডেটা-কভারেজ পূর্ণতা (progress/vocab-state/রুটিন-ডেটা সিঙ্কে যুক্ত) ② Conflict-মার্জিং (মাল্টি-ডিভাইস একই-সময়ে) ③ ডেটা-স্তর DB-তে ④ Export-ফিচার ⑤ সিঙ্ক-স্ট্যাটাস-ইউআই।

## 🔥 P05 — AI Core / AI Brain — ✅ **সম্পন্ন (২০২৬-০৯-০৪, sw v184-aigw)**
**আছে (লাইভ-পথ):** একক server-side `/api/ai` (env `GEMINI_KEYS` multi-key — ইউজার-কী লাগে না) · **Model-Router** `aiChain(keys, GEM_CHAIN, badSet)` — ২-মডেল চেইন failover, আজ-মার্ক-করা combo (`aibad:`) skip · **Context Engine ৪-স্তর** `aiBuildBrain` (SYSTEM→GLOBAL→USER→REQUEST) · **Token-বাজেট** `AI_BUDGET` (msgs 24k/brain 6k/perMsg 4k) + `clipMessages`/`fitText` · **Prompt-ভার্সন** `PROMPT_V=p05-1` + `pv:` রেসপন্স · **Cost-cache** `aicache` ৬০০s + রেট ১২/মিনিট + timeout ৪৫s (ছবি ৬০s) · মেট্রিক `aim:<model|total|fail>:<date>` · retryable-সংকেত · `achat` per-user ইতিহাস।
**বাকি:** ① সিক্রেট-রোটেশন-অটোমেশন (env-বদল-মাত্র কার্যকর; ক্লাউডফ্লেয়ার-সিক্রেট-টুল-তালিকা) ② টোকেন-কোষ্ট-সূক্ষ্ম-সংগ্রহ (usage-মেটাডেটা) ③ P06-টিউটর-স্তর (নিচে)।

## 🧠 P06 — Personal AI Tutor — 🟡 ~৪০%
**আছে:** AI-mentor (Gemini) · `result-ai-analysis` · `mistake-analysis` · Admihub AI-চ্যাট (ডেটা-মেমোরি: "এজেন্ট তোমার ব্যাংক থেকেই উত্তর") · weekly-report-tool।
**বাকি:** ① সত্যিকারের পার্সোনালাইজেশন: ইউজারের accuracy/weak-topic/সময়-ডেটা AI-প্রম্পটে ইনজেকশন ② "তোমার এই topic-এ accuracy কম → এটা revise করো" ধরনের শিক্ষা-রেকমেন্ডেশন ③ টিউটর-কনভারসেশন-মেমোরি (prior sessions)।

## 🧬 P07 — Intelligent Question Engine — ✅ **সম্পন্ন (২০২৬-১০-১০, sw v295)**
**আছে:** per-question মেটাডেটা (subject/topic/sub-topic) · dictionary-parser-এ duplicate-protection · qbank-performance · phase3-intelligence · interactive-course।
**নতুন (সম্পূর্ণ ইঞ্জিন):** `question-engine.js` — difficulty/type/concept/expected-time ট্যাগ · দৃঢ় similarity (word-Jaccard + char-Dice) · blocked duplicate-detection (লাখ-প্রশ্ন-রেডি) · explanation-কোয়ালিটি-চেক · answer-consistency ভেরিফিকেশন · single-pass `analyzeBank`। `question-engine-panel.js` — প্রশ্নভান্ডারের বিশ্লেষণ-প্যানেল (difficulty/type মিক্স, কোয়ালিটি-গ্যাপ, ডুপ্লিকেট-গ্রুপ) + এক-ট্যাপে ট্যাগ-রাইট-ব্যাক। টেস্ট: `question-engine.test.mjs` ২০/২০।
**অবস্থা:** ছয়টিই সম্পন্ন। ভবিষ্যৎ-ঐচ্ছিক: ইম্পোর্টের সময়েই স্বয়ংক্রিয়ভাবে ট্যাগ বসানো (এখন প্যানেল থেকে এক-ট্যাপে হয়), এবং ব্যবহার-ডেটা বাড়লে difficulty-অনুমান আরও নিখুঁত হবে।

## 📝 P08 — World-Class Exam Engine — ✅ **সম্পন্ন (২০২৬-১০-১০, sw v296)**
**আছে:** Mock/Flash/Mistake টেস্ট · exam-dropdowns · session-persist (route+scroll, PWA-reopen) · nav-resume · mock-result-experience · result-analysis-500 · one-time-mock-seed/tool · টাইমার/নেগেটিভ-মার্ক/র্যান্ডমাইজেশন।
**রিকভারি:** mid-exam বন্ধ/রিফ্রেশে question-state+টাইমার (startTime+endTime থেকে recompute) · auto-save (debounced IDB + sessionStorage backup) · auto-submit (endTime-এ scheduled) · নেট-ফেল ব্যাকঅফ-retry, আর অনলাইনে ফিরলেই pending submit সাথে সাথে যায়।
**নতুন:** adaptive-testing foundation — `ExamSelect` (pure module): difficulty filter + easy→medium→hard warm-up order + target difficulty-mix; setup-এ Adaptive order-চিপ। এখন দৃশ্যমান সব সেটআপ-টগল (auto-save, confirm-before-submit, resume) সত্যিই কাজ করে। টেস্ট: `p08-adaptive.test.mjs` ১২/১২ + আগের p08-exam-ac3 (২৩) ও p08-state-preserve (২৪)।

## 📊 P09 — Advanced Analytics — ✅ **সম্পন্ন (২০২৬-১০-১০, sw v297)**
**আছে:** progress-tool · weekly-report · daily-streak · result-analysis-500 · mistake-analysis।
**নতুন (সম্পূর্ণ ইঞ্জিন):** `analytics-insight-engine.js` (pure UMD) — exam-snapshot থেকে per-topic Strong/Weak/Improving/Declining/Needs-Revision ক্লাসিফিকেশন · difficulty-wise নির্ভুলতা · time-spent (মোট/গড়/per-difficulty) · wrong-pattern (একাধিকবার-ভুল) · improvement-rate (আগের বনাম পরের অর্ধেক) · বাংলায় insight-কার্ড। `analytics-insights-panel.js` — Progress পেজে "📊 বিশ্লেষণ ও পরামর্শ" বোতামে খোলে এমন read-only প্যানেল। ট্রেন্ড কেবল একাধিক পরীক্ষা-থাকলে দাবি করে। টেস্ট: `p09-analytics.test.mjs` ১৪/১৪।

## 🎯 P10 — Smart Mistake & Revision — 🟡 ~৫০%
**আছে:** mistakes-bank · smart-revision · mistake-notebook/note-icon · mistake-analysis (improving-ইঙ্গিত)।
**বাকি:** ① অটো-ক্যাটেগরি (careless/conceptual/memory/confusion/time/repeated) ② revision-priority-স্তর (Critical→High→Medium→Mastered) ③ repeated-mistake-ফ্ল্যাগ ④ "Mastered"-রূপান্তর-লজিক।

## 🧠 P11 — Adaptive Learning Engine — 🔴 ~১০%
**আছে:** শুধু blueprint (INTERACTIVE_QUIZ_MODE_BLUEPRINT.md, SUPER_UPGRADE_BLUEPRINT.md) + result-analysis-ইঙ্গিত।
**বাকি:** **সব** — পারফরম্যান্স-মডেল, ডিফিকাল্টি-অ্যাডজাস্টমেন্ট, per-student practice-pattern, strategy-ভিন্নতা (speed-vs-accuracy)।

## 📚 P12 — Smart Vocabulary — 🟢 ~৭৫%
**আছে:** vocabulary-master (CSS/JS) · Smart Memorizing (New→Learning→Review→**Mastered** spaced-status) · ElevenLabs-অডিও+উচ্চারণ · match-tool · dictionary-parser/ফাইনাল-ফিক্স · বড়-সেট-পারফরম্যান্স।
**বাকি:** ① per-word weak/forgotten ডিটেকশন → customized frequency ② ব্যক্তিগত review-schedule (সময়-ভিত্তিক SRS) ③ mastery-ড্যাশবোর্ড ④ অডিও-ফলব্যাক (ElevenLabs-কী ছাড়া)।

## ⚡ P13 — Performance & Scale — 🟡 ~৩০%
**আছে:** Cloudflare এজ · KV-ক্যাশ · question-bank-performance.js · sw-ক্যাশ-শেল · offline-performance-QA-নোট।
**বাকি:** ① ডেটাবেস+ইনডেক্স (পাবলিক D1) ② পেজিনেশন/লেজি-লোডিং ③ ভার্চুয়ালাইজড-লিস্ট ④ CDN-অ্যাসেট ⑤ API-কম্প্রেশন/বান্ডল-বিভাজন ⑥ লোড-টেস্ট (মিলিয়ন-প্রশ্ন/ইউজার-সিম)।

## 🔐 P14 — Security & Privacy — 🟡 ~৫৫%
**আছে:** B-GUESTISO **Resolved** (ভুয়া-গেস্ট-কী) · token-সেশন + সেশন-লিস্ট · admin-পাশে অডিট/লকআউট/রেট-লিমিট (AC-1) · secret-ম্যানেজমেন্ট (সব env-সিক্রেট, ফ্রন্টএন্ড-লিক নয় — verified) · delete-এন্ডপয়েন্ট।
**বাকি:** ① Public-API রেট-লিমিট/অ্যাবিউজ-গার্ড ② User A↛B আইসোলেশন-অটো-টেস্ট (যাচাই) ③ input-validation-অডিট ④ KV→DB (RLS) ⑤ কনটেন্ট-ইনটিগ্রিটি (admin-publish যাচাই)।

## 🌐 P15 — PWA + Offline-First — 🟡 ~৬০%
**আছে:** manifest.webmanifest (standalone+icons) · sw.js v179-aiengine (ক্যাশ-ভার্সনিং, build-header, update-check) · session-persist · অফলাইন-perf-QA।
**বাকি:** ① অফলাইন-প্রশ্ন-প্র্যাকটিস ② অফলাইন-পরীক্ষা (যেখানে সম্ভব) ③ background-sync (ব্যর্থ-সিঙ্ক-কিউ) ④ পূর্ণ update-ফ্লো-ইউআই ⑤ অফলাইন-ডেটা-বাউন্ডারি-ডক।

## 🎨 P16 — UX/Accessibility/Device — 🟡 ~৫০%
**আছে:** mobile-ux-fix · onboarding · experience-studio (themes/animation/hooks) · 3d-loader · touch-অপটিমাইজেশন · ভাষা-কাস্টম।
**বাকি:** ① aria/focus-কভারেজ (মাত্র ২২ aria-attribute) ② keyboard-nav ③ screen-reader-যাচাই ④ dynamic-text ⑤ desktop/tablet-রেসপন্সিভ-অডিট ⑥ gesture-পলিশ।

## 🤖 P17 — AI Automation & Agents — 🟡 ~৪০%
**আছে:** GK-এজেন্ট (দৈনিক cron, ৩-key failover, TG-নোটিফ) · notification-worker · voice-worker · admin-এজেন্ট-সিস্টেম+grants (AC-5) · bug-agent।
**বাকি:** ① student-মুখী action-agents: "আমাকে প্রস্তুত করো" → analyze→weakness→select→plan→practice→analyze→reco (লুপ) ② task-অর্কেস্ট্রেশন+যাচাই ③ agent-কল-অডিট (student-পাশ)।

## 🏆 P18 — Admission Intelligence Engine — 🔴 ০%
**বাকি: সব** — ইউনিভার্সিটি/ইউনিট/সাবজেক্ট/টপিক-ম্যাপ · প্রশ্ন-প্যাটার্ন-বিশ্লেষণ · priority/রিভিশন-প্ল্যান · weakness-report · data-driven গাইডেন্স (**নীতি-লক: কোনো rank-guarantee নয়** — blueprint-লেভেল থেকেই ঠিক)।

## 🌍 P19 — Production, SEO & Global Infrastructure — 🟡 ~৫০%
**আছে:** live HTTPS (workers.dev) · title+description · CI-deploy (admin+public, GitHub Actions) · `/api/health` · আপডেট-লগ (sw-build-header) · PWA-মেটাডেটা।
**বাকি:** ① **robots.txt + sitemap.xml (নেই — grep-প্রমাণ)** ② Open-Graph/সোশ্যাল-শেয়ার (`og:` কাউন্ট **0**) ③ কাস্টম-ডোমেইন — ✅ **ফ্রি-পথ সমাপ্ত**: https://admissionhub.pages.dev লাইভ (CF-Pages, ০-টাকা; docs/PHASE-19-DOMAIN.md) — নিজের-ডোমেইন ঐচ্ছিক-ভবিষ্যৎ (Freenom-মৃত) ④ সার্চ-ইনডেক্সিং-যাচাই ⑤ monitoring/error-tracking ⑥ backup/recovery ⑦ staging-env ⑧ Core-Web-Vitals-অডিট।

## 🚀 P20 — Final QA + World-Class Launch — 🔴 ০%
**বাকি:** সম্পূর্ণ QA-ম্যাট্রিক্স (UI/workflow/exam/cloud/users/security/AI/performance/PWA/mobile/desktop) → আপনার নিজে ব্যবহার → **NO-লঞ্চ ছাড়া APPROVED**। শুধু আপনার "✅ APPROVED FOR PUBLIC LAUNCH"-এর পর।

---

## 📌 মূল সিদ্ধান্ত-বিন্দু
1. **দ্রুত-জয় (আপনার অপেক্ষা ছাড়া):** P19-এর robots/sitemap/OG (ছোট প্যাকেজ) · P01-এর Clone-Freeze-ডক · P08-এর state-recovery-টেস্ট।
2. **বড়-বিল্ড:** P07 → P09 → P10 → P11 → P18 (ইন্টেলিজেন্স-স্তর) · P02/P04-তে D1-মাইগ্রেশন (ফাউন্ডেশন)।
3. **নিরাপত্তা-গেট:** P14-এ User A↛B অটো-টেস্ট — P20-র আগে বাধ্যতামূলক।
4. **Golden Rule:** প্রতিটি ফেজ build→test→**আপনি ব্যবহার/APPROVE**→পরের ফেজ; একটি ফেজের কাজ আরেকটিতে লুকানো হবে না (আগে-থেকে-লাইভ অংশগুলো "লিগ্যাসি-কভারেজ" হিসেবে চিহ্নিত, নতুন কাজ ফেজ-বাউন্ডারিতে)।
