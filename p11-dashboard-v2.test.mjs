// P11 — DASHBOARD v2 (ছবি-অনুযায়ী ১৪ মডিউল) ভেরিফিকেশন-টেস্ট (v195)
import { readFileSync } from 'fs';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };
const H = readFileSync('index.html', 'utf8');
const SW = readFileSync('sw.js', 'utf8');
const V2 = readFileSync('dashboard-v2.js', 'utf8');
const CSS = readFileSync('dashboard-v2.css', 'utf8');

/* ১ — ফাইল-লোড + ক্যাশ-কী */
t('dashboard-v2.js defer-লোড (?v=dash2)', H.includes('<script defer src="./dashboard-v2.js?v=dash2f15-inbox"></script>'));
t('dashboard-v2.css link (?v=dash2)', H.includes('<link rel="stylesheet" href="./dashboard-v2.css?v=dash2f13-theme">'));
t('sw APP_SHELL-এ dashboard-v2 (js+css)', SW.includes("'./dashboard-v2.js?v=dash2f15-inbox'") && SW.includes("'./dashboard-v2.css?v=dash2f13-theme'"));

t('sw BUILD_ID v286-lesson-quiz-analytics-20260925', SW.includes("const BUILD_ID = 'v286-lesson-quiz-analytics-20260925'"));
t('index sw-marker v195', H.includes('sw.js?v=v286-lesson-quiz-analytics-20260925'));

/* ২ — ১৪ মডিউল (ছবির প্রতিটি সেকশন) */
t('১ Personal Header (avatar+তারিখ+🔔)', V2.includes('dv2-header') && V2.includes('Intl.DateTimeFormat') && V2.includes('dv2-bell'));
t('২ Smart Daily Mission (63/100-স্টাইল + Focus Mode + Continue + ★)', V2.includes('dv2-mission') && V2.includes('Mission') && V2.includes('Focus Mode') && V2.includes('Continue →') && V2.includes('dv2-star') && V2.includes('MCQ'));
t('৩ Streak Card (7-day dots + badge)', V2.includes('dv2-days') && V2.includes('Day Streak') && V2.includes('10 Day Badge'));
t('৪ Today\u2019s Performance (Mastery-ring + Solved/Correct/Wrong + Time)', V2.includes('dv2-ring') && V2.includes('Mastery') && V2.includes('Solved') && V2.includes('Total Time'));
t('৫ Study Insight (saved progress + Practice Weak Topic)', V2.includes('Study Insight') && V2.includes('>Progress</span>') && V2.includes('Practice Weak Topic →') && V2.includes('insightText'));
t('৬ Continuous Learning (প্রগ্রেস-বার + Resume/কোর্স)', V2.includes('Continuous Learning') && V2.includes('dv2-bar') && V2.includes('subjectProgress'));
t('৭ Command Center (Quick Practice/Mistakes/Courses + See more)', V2.includes('Command Center') && V2.includes('Quick Practice') && V2.includes('See more →') && V2.includes('dv2AllTools'));
t('৮ Performance Graph (SVG লাইন-চার্ট + ৭-দিন)', V2.includes('graphSvg') && V2.includes('<svg viewBox') && V2.includes('সাপ্তাহিক'));
t('৯ Weakness Radar (Topic-wise Accuracy + রঙিন বার)', V2.includes('Your Weakness Radar') && V2.includes('Topic-wise Accuracy') && V2.includes('topicWeak'));
t('১০ Admission Goal (বিশ্ববিদ্যালয় + Days Left + ⚙-বদল)', V2.includes('Admission Goal') && V2.includes('Days Left') && V2.includes('dv2EditGoal') && V2.includes('Rajshahi University'));
t('১১ 90-Day Roadmap (Day X/90 + checklist + Full Plan)', V2.includes('90-Day Roadmap') && V2.includes('Day ') && V2.includes('Study Checklist') && V2.includes('progress/plan'));
t('১২ Study Tools (Notes/Vocabulary/Dictionary/More — Problem Solver বাদ)', V2.includes('Study Tools') && V2.includes('Notes') && V2.includes("navigate(\\'notes\\')") && V2.includes("navigate(\\'vocabulary-master\\')") && !V2.includes('Problem Solver'));
t('১৩ Bottom Nav 4 core tabs (Home/Bank/Exam/Profile; AI → dashboard Command Center, History → Exam-এর ভিতরে)', (() => { const nav = (H.match(/const NAV_TABS=\[[\s\S]*?\];/) || [''])[0]; return /key:'dashboard'[\s\S]*key:'question-bank'[\s\S]*key:'exam'[\s\S]*key:'my-profile'/.test(nav) && !nav.includes("key:'ai'") && !nav.includes("key:'history'") && (nav.match(/\{key:/g) || []).length === 4; })() && !H.includes("key:'profile'") && !H.includes("key:'ai-chat'"));
t('১৪ মূল অ্যাপের AI Assistant script/dashboard-এন্ট্রি/direct route চালু (floating FAB নেই)', H.includes('ai-agent-chat.js?v=agent-f1-ui-chatv20-autoprefs') && !H.includes('juju-floating') && H.includes("if(p==='ai'){ if(window.renderAiAgentPage)") && V2.includes("navigate('ai')") && V2.includes("navigate(\\'ai\\')"));
t('পুরনো-ড্যাশ-সম্পূর্ণ-বিলুপ্ত (মালিক-নির্দেশ ২০২৬-০৯-০৭): renderV2-এ previous()/intel-ক্যাপচার-নেই + dv2Cleanup-পরিচ্ছন্নতা', !V2.includes('data-dv2-phase5') && !V2.includes('intel = el.outerHTML') && V2.includes('function dv2Cleanup') && V2.includes('[data-phase5-dashboard],[data-phase34-dashboard]') && !/previous\(\);[\s\S]{0,300}data-phase5-dashboard/.test(V2));

/* ৩ — ডেটা-সততা: CACHE-ভিত্তিক, কোনো ফেক সংখ্যা নয় */
t('সব-সংখ্যা CACHE-সূত্র (dailyStats/examResults/questions)', V2.includes('if (window.CACHE) return window.CACHE;') && V2.includes('examResults') && V2.includes('dailyStats'));
t('শূন্য-অবস্থা-বার্তা (সৎ, কোনো বানানো-সংখ্যা নয়)', V2.includes('কোনো ডেটা নেই') && V2.includes('এখনো') && V2.includes('নেই'));
t('অফলাইন: dashboard-v2.js-এ কোনো fetch/XHR/https-কল নেই', !/fetch\(|XMLHttpRequest|https:\/\//.test(V2));
t('নতুন DB-স্কিমা নেই (idb-স্টোর-স্পর্শ নয়)', !/dbCreateStore|objectStore\(/.test(V2) || /dbPut\('settings'\)/.test(V2));
t('goal-ডিফল্ট-স্যাম্পল + সেটিংস-সেভ (dv2SaveGoal)', V2.includes('dv2SaveGoal') && V2.includes("dbPut('settings'"));
t('insightText: নিয়ম-ভিত্তিক (weak topic + streak-উল্লেখ)', V2.includes('weak') && V2.includes('insightText') && V2.includes('দিনের ধারাবাহিকতা'));

/* ৪ — ইঞ্জিন-অক্ষত (additive-chain + গার্ড) */
t('renderDashboard override: path-গার্ড + previous-ডেলিগেট', /if \(path !== 'dashboard'\) \{ if \(typeof previous === 'function'\) return previous\.apply/.test(V2));
t('renderShell-রেন্ডার + no-renderShell-ফলব্যাক', V2.includes("typeof window.renderShell === 'function'") && V2.includes('renderShell(html'));
t('__dashboardV2Installed গার্ড (দ্বিগুণ-ইনস্টল নয়)', V2.includes('window.__dashboardV2Installed'));
t('dv2AllTools: পুরনো ১১+ টুল No-loss (Bank/Mock/Progress/Settings…)', V2.includes("navigate('question-bank')") && V2.includes("navigate('progress')") && V2.includes("navigate('settings')") && V2.includes("navigate('vocabulary-master')"));

/* ৫ — রিগ্রেশন লক (অর্থাৎ আগের পোস্টার-কি অক্ষত) */
t('retired account/onboarding assets are absent from index and shell', !/premium-auth|auth-svg|onboarding\.js|onboarding\.css|curriculum-config/.test(H + SW));
t('performance-hardening.js?v=2 remains deferred outside lean shell', H.includes('<script defer src="performance-hardening.js?v=2"></script>') && !SW.includes("'./performance-hardening.js?v=2'"));

/* ৬ — CSS-শৈলী-উপস্থিতি */
t('দৃশ্য-কোর: dv2-card/dv2-mission/dv2-ring/dv2-tools/bottomnav-রিস্টাইল', CSS.includes('.dv2-card') && CSS.includes('.dv2-mission') && CSS.includes('.dv2-ring') && CSS.includes('.dv2-tools') && CSS.includes('.bottomnav'));
t('মোবাইল-ফার্স্ট: dv2-root এক-কলাম flex + media-কোয়েরি', CSS.includes('.dv2-root') && CSS.includes('@media(min-width:720px)'));
t('কোনো এক্সটার্নাল ফন্ট/ইমেজ-URL নেই', !/url\(https?:|@import/.test(CSS));

console.log(`\nP11-DASHBOARD-V2: ${pass} pass / ${fail} fail`);
if (fail) process.exit(1);
