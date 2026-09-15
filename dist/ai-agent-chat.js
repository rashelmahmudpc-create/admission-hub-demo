/* ✦ ADMISSION HUB AI — Chatbot V1: Premium AI Assistant (agent-f1-ui-chatv1)
 * মালিক-স্পেক ২০২৬-০৯-০৮ (Chatbot V1 Master Spec):
 *   compact header (orb avatar + Online), 3D welcome hero card, dismissible notice,
 *   "Try asking" chips, editorial AI messages (rich renderer: formula/tip/example/
 *   warning/table), interactive Quick-Challenge MCQ card, minimal user bubble (✓✓),
 *   floating capsule composer (+ / mic / send / stop), bottom-sheet attachments +
 *   AI Tools, Copy|Regenerate|👍|👎|⋯ actions, themes (Light/Dark/OLED), menu
 *   (new/rename/search/delete/clear/export), Web-Speech voice-in, same-origin TTS.
 * নিয়ম: কোনো API-key নেই; /api/ai/chat (SSE) কন্ট্রাক্ট অটুট; XSS-safe escape-first।
 */
(function () {
  'use strict';
  if (window.renderAiAgentPage) return;

  const VER = 'chatv1';
  const STORE = 'aiAgentChat:v1';
  const NOTICE_KEY = 'ai_notice_dismissed';
  const THEME_KEY = 'aiChatTheme';
  const NAME_KEY = 'aiChatName';
  const FEED_KEY = 'aiFeedbackLog';
  const MAX_MSGS = 40;
  const MAX_HISTORY = 12;

  const lang = (() => { try { return localStorage.getItem('ahLang') === 'en' ? 'en' : 'bn'; } catch (_) { return 'bn'; } })();
  const T = lang === 'en' ? {
    title: 'Admission Hub AI', sub: 'AI Study Assistant', online: 'Online',
    heroTitle: 'Hey! I am Admission Hub AI',
    heroBody: 'Your admission preparation questions, MCQs, explanations and study support — I am here for all of it.',
    heroCta: 'What shall we work on today?',
    notice: 'AI responses can occasionally contain mistakes. Verify important admission information from official sources.',
    tryAsking: 'Try asking', dont: "Don't show again",
    chips: [
      ['🧠', 'Explain it simply', 'একটা প্রশ্ন বা কনসেপ্ট সহজভাবে বুঝাও'],
      ['📝', 'Make 10 MCQs', 'আমাকে ১০টা MCQ বানাও'],
      ['🎯', 'Quiz me', 'আমাকে quiz নাও — ৫টা প্রশ্ন'],
      ['📊', 'Analyze my performance', 'আমার পারফরম্যান্স analyze করো'],
      ['📚', 'Teach me this topic', 'এই topicটা সহজ করে শেখাও']
    ],
    ph: 'Ask anything…', latest: '↓ Latest', menu: 'Menu', recentChats: 'Recent conversations', untitled: 'New chat', noChats: 'No conversations yet', newIsEmpty: 'Start a new chat? Unsent draft will be cleared.', cancelBtn: 'Cancel', pinChat: 'Pin / Unpin', itemAct: 'Choose an action:', backHome: 'Back to Home', close: 'Close', defLbl: 'Definition', confirmClear: 'Clear all messages in this chat?', chzSimple: 'Simplify', qzSetup: '🎯 Quiz Setup', qzLet: 'Matched from your request — just set the rest.', qzMulti: '(multi-select)', qzSubjects: '📚 Subjects', qzTopics: '📖 Topics', qzCount: '🔢 Questions', qzTime: '⏱ Time', qzNeg: '➖ Negative marking', qzDiff: '🎚 Difficulty', qzAll: 'All', qzOthers: 'Other', qzOtherPh: 'Type subject…', qzCustTopPh: 'Custom topic…', qzMin: 'min', qzNoLimit: 'No limit', qzNone: 'None', qzCustom: 'Custom', qzEdit: '✎ Edit', qzGen: 'Generate Quiz →', qzBankNote: 'Matching Question Bank questions are used first, AI fills the rest', qzNeedSubj: 'Pick at least one subject first', qzS1: 'Checking Question Bank…', qzS2: 'Selecting matching questions…', qzS3: 'Generating missing questions…', qzS4: 'Mixing difficulty & patterns…', qzS5: 'Preparing quiz…', qzQuestion: 'Question', qzQuestionShort: 'Q', qzFromReq: 'Matched from your request (✎ = editable)', qzCorrect: 'Correct!', qzWrong: 'Not quite', qzYourAns: 'Your answer', qzRightAns: 'Correct answer', qzWhy: '💡 Why:', qzRemember: '🧠 Remember:', qzBack2: 'Back', qzNext2: 'Next', qzSubmit: 'Submit Quiz', qzReadySub: 'Ready to submit?', qzAnswered: 'Answered', qzUnanswered: 'Unanswered', qzComplete: 'Quiz Complete', qzScore: 'Score', qzOf: '/', qzMarksNote: ' · negative', qzTimeUp: 'Time up — auto submitted!', qzCorrectN: 'Correct', qzWrongN: 'Incorrect', qzNone2: 'Skipped', qzFAll: 'All', qzFGood: 'Correct', qzFBad: 'Incorrect', qzFSkip: 'Skipped', qzTimeUsed: 'Time used', qzAvgTime: 'Avg / answered', qzInsight: 'AI Insight', qzReviewBtn: 'Review Answers', qzRetry: 'Try Again', qzSimilar: 'Similar Quiz', qzWeakQuiz: 'Weak Topic Quiz', qzPrev: 'Previous', qzBackRes: 'Result', qzBank: 'Q-Bank', qzDiffEasy: 'Easy', qzDiffMed: 'Medium', qzDiffHard: 'Hard', qzDiffAdm: 'Admission', qzDiffMix: 'Mixed', chzExample: 'Examples', chzQuiz: 'Quiz me', chzMcq: 'Make MCQ', chzSimilarMcq: 'Similar MCQ', chzShorten: 'Summarize', chzPoints: 'Key points', chzRevise: 'Revision note', chzExplain: 'Explain topic', stThink: 'Thinking...', stAnalyze: 'Analyzing your question...', stImage: 'Understanding image...', stDoc: 'Reading file...', stSearch: 'Searching trusted sources...', stQuiz: 'Creating quiz...', stMcq: 'Creating MCQs...', stWrite: 'Writing answer...', stReason: 'Reasoning through it...', stCalc: 'Calculating...', stCode: 'Writing code...', stPlan: 'Structuring a plan...', stVerdict: 'Comparing options...', stSum: 'Summarizing...', stFix: 'Finding the fix...',
    copy: 'Copy', copied: 'Copied', regen: 'Regenerate', speak: 'Speak', save: 'Save', share: 'Share', more: 'More',
    correct: 'Correct', notQuite: 'Not quite', correctAnswer: 'Correct answer', why: 'Why?',
    quizComplete: 'Quiz Complete', accuracy: 'Accuracy', viewAnalysis: 'View Analysis', tryAgain: 'Try Again',
    quickChallenge: 'Quick Challenge', question: 'Question',
    next: 'Next', you: 'You',
    menuNew: 'New chat', menuRename: 'Rename', menuSearch: 'Search conversation', menuExport: 'Export', menuClear: 'Clear messages', menuDelete: 'Delete conversation',
    themeOpt: 'Theme', themeLight: 'Premium Light', themeDark: 'Premium Dark', themeOled: 'OLED Focus', themeSys: 'System',
    addToConv: 'Add to conversation', aiTools: 'AI Tools',
    cam: 'Camera', img: 'Image', doc: 'Document', vid: 'Video', voice: 'Voice', file: 'File',
    tSearch: 'Search', tMcq: 'Create MCQ', tQuiz: 'Quiz Me', tExplain: 'Explain', tAnalyze: 'Analyze', tSummarize: 'Summarize',
    listening: 'Listening', transcribing: 'Transcribing', voiceNope: 'Voice input not supported on this device', msgTooLong: 'Message is too long — please keep it under 4,000 characters', shareBtn: 'Share', copyFail: 'Copy unavailable', more: 'More',
    retry: 'Try again',
    err: 'Something went wrong.', errHttp: 'We had trouble processing your request. Please try again shortly.', offline: 'You are offline', imgTooBig: 'Image must be 3.5MB or smaller', editBtn: 'Edit', seeMore: 'See more', themeSys: 'System',
    docSoon: 'Document understanding is coming soon — I answered based on your text.', liked: 'Thanks for feedback!',
    feedbackQ: 'What went wrong?', fb1: 'Incorrect', fb2: 'Not helpful', fb3: 'Too complicated', fb4: 'Missing information', fb5: 'Other',
    confirmDel: 'Delete this conversation?', cancel: 'Cancel', del: 'Delete', delDone: 'Conversation deleted',
    searchPh: 'Search conversations...', noResults: 'No matches found', emptySearch: 'Clear search', connected: 'Student data connected', publicMode: 'Public mode',
    stop: 'Stop', send: 'Send', attach: 'Add to conversation', savedTip: 'Saved', welcomeSub: 'Ask me anything about your admission preparation.', studying: 'What are we studying today?'
  } : {
    title: 'Admission Hub AI', sub: 'AI Study Assistant', online: 'Online',
    heroTitle: 'Hey! আমি Admission Hub AI',
    heroBody: 'তোমার admission preparation-এর প্রশ্ন, MCQ, explanation আর study support—সবকিছুতেই আমি আছি।',
    heroCta: 'আজ কী নিয়ে কাজ করবো?',
    notice: 'AI উত্তর মাঝে মাঝে ভুল হতে পারে। ভর্তি-সংক্রান্ত গুরুত্বপূর্ণ তথ্য অফিসিয়াল সোর্স থেকে যাচাই করো।',
    tryAsking: 'Try asking', dont: 'আর দেখাবো না',
    chips: [
      ['🧠', 'প্রশ্নটা সহজ করে বুঝাও', 'নিউটনের দ্বিতীয় সূত্রটা সহজ করে বুঝাও'],
      ['📝', '১০টা MCQ বানাও', 'জীববিজ্ঞান থেকে আমাকে ১০টা MCQ বানাও'],
      ['🎯', 'আমাকে Quiz নাও', 'আমাকে quiz নাও — ৫টা প্রশ্ন'],
      ['📊', 'আমার performance analyze করো', 'আমার পারফরম্যান্স analyze করো'],
      ['📚', 'এই topicটা শেখাও', 'সালোকসংশ্লেষণ topicটা সহজ করে শেখাও']
    ],
    ph: 'Ask anything…', latest: 'নতুন', menu: 'মেনু', recentChats: 'সম্প্রতি কথোপকথন', untitled: 'নতুন চ্যাট', noChats: 'এখনো কোনো কথোপকথন নেই', newIsEmpty: 'নতুন চ্যাট শুরু করবেন? অসমাপ্ত লেখা মুছে যাবে।', cancelBtn: 'বাতিল', pinChat: 'পিন / আনপিন', itemAct: 'একটি কাজ বাছুন:', backHome: 'হোমে ফিরুন', close: 'বন্ধ করুন', defLbl: 'সংজ্ঞা', confirmClear: 'এই চ্যাটের সব মেসেজ মুছবেন?', chzSimple: 'সহজ করে বলো', qzSetup: '🎯 কুইজ সেটআপ', qzLet: 'তোমার কথায় যা পাওয়া গেছে তা বসিয়ে দিয়েছি — শুধু বাকিগুলো ঠিক করো।', qzMulti: '(একাধিক বাছা যায়)', qzSubjects: '📚 বিষয়', qzTopics: '📖 টপিক', qzCount: '🔢 প্রশ্ন সংখ্যা', qzTime: '⏱ সময়', qzNeg: '➖ নেগেটিভ মার্কিং', qzDiff: '🎚 কঠিনতা', qzAll: 'সব', qzOthers: 'Other', qzOtherPh: 'বিষয়টা লিখো…', qzCustTopPh: 'কাস্টম টপিক লিখো…', qzMin: 'মিনিট', qzNoLimit: 'No limit', qzNone: 'নেই', qzCustom: 'Custom', qzEdit: '✎ Edit', qzGen: 'Generate Quiz →', qzBankNote: 'Question Bank-এ ম্যাচিং প্রশ্ন আগে বসবে, বাকিটা AI বানাবে', qzNeedSubj: 'আগে অন্তত একটা বিষয় বাছো', qzS1: 'Question Bank যাচাই…', qzS2: 'ম্যাচিং প্রশ্ন বাছাই…', qzS3: 'বাকি প্রশ্ন তৈরি…', qzS4: 'Difficulty ও প্যাটার্ন মিক্স…', qzS5: 'Quiz প্রস্তুত…', qzQuestion: 'প্রশ্ন', qzQuestionShort: 'প্রশ্ন', qzFromReq: 'তোমার কথায় মিলেছে (✎ = বদলানো যায়)', qzCorrect: 'সঠিক উত্তর!', qzWrong: 'ভুল উত্তর', qzYourAns: 'তোমার উত্তর', qzRightAns: 'সঠিক উত্তর', qzWhy: '💡 কারণ:', qzRemember: '🧠 মনে রাখো:', qzBack2: 'Back', qzNext2: 'Next', qzSubmit: 'Submit Quiz', qzReadySub: 'Ready to submit?', qzAnswered: 'Answered', qzUnanswered: 'Unanswered', qzComplete: 'Quiz Complete', qzScore: 'Score', qzOf: '/', qzMarksNote: ' · নেগেটিভ', qzTimeUp: 'সময় শেষ — অটো-সাবমিট হয়েছে!', qzCorrectN: 'সঠিক', qzWrongN: 'ভুল', qzNone2: 'বাদ', qzFAll: 'সব', qzFGood: 'সঠিক', qzFBad: 'ভুল', qzFSkip: 'বাদ', qzTimeUsed: 'সময় লেগেছে', qzAvgTime: 'গড়/প্রশ্ন', qzInsight: 'AI Insight', qzReviewBtn: 'Review Answers', qzRetry: 'Try Again', qzSimilar: 'Similar Quiz', qzWeakQuiz: 'Weak Topic Quiz', qzPrev: 'Previous', qzBackRes: 'Result', qzBank: 'Q-Bank', qzDiffEasy: 'সহজ', qzDiffMed: 'মাঝারি', qzDiffHard: 'কঠিন', qzDiffAdm: 'ভর্তি স্তর', qzDiffMix: 'মিক্স', chzExample: 'আরও উদাহরণ', chzQuiz: 'Quiz নাও', chzMcq: 'MCQ বানাও', chzSimilarMcq: 'একই রকম MCQ', chzShorten: 'সংক্ষেপে বলো', chzPoints: 'মূল পয়েন্ট', chzRevise: 'রিভিশন নোট', chzExplain: 'টপিক বুঝাও', stThink: 'ভাবছি...', stAnalyze: 'প্রশ্ন বিশ্লেষণ করছি...', stImage: 'ছবি বিশ্লেষণ করছি...', stDoc: 'ফাইল বিশ্লেষণ করছি...', stSearch: 'তথ্য খুঁজছি...', stQuiz: 'Quiz তৈরি করছি...', stMcq: 'MCQ তৈরি করছি...', stWrite: 'উত্তর তৈরি করছি...', stReason: 'যুক্তি ভাবছি...', stCalc: 'হিসাব করছি...', stCode: 'কোড লিখছি...', stPlan: 'পরিকল্পনা সাজাচ্ছি...', stVerdict: 'বিকল্প মিলিয়ে দেখছি...', stSum: 'সংক্ষেপ করছি...', stFix: 'সমাধান খুঁজছি...',
    copy: 'Copy', copied: 'কপি হয়েছে', regen: 'Regenerate', speak: 'Speak', save: 'Save', share: 'Share', more: 'More',
    correct: 'Correct', notQuite: 'Not quite', correctAnswer: 'সঠিক উত্তর', why: 'Why?',
    quizComplete: 'Quiz Complete', accuracy: 'Accuracy', viewAnalysis: 'View Analysis', tryAgain: 'Try Again',
    quickChallenge: 'Quick Challenge', question: 'Question',
    next: 'Next', you: 'তুমি',
    menuNew: 'নতুন চ্যাট', menuRename: 'রিনেম করুন', menuSearch: 'কথোপকথন খোঁজো', menuExport: 'Export', menuClear: 'বার্তা মুছো', menuDelete: 'কথোপকথন ডিলিট করুন',
    themeOpt: 'থিম', themeLight: 'Premium Light', themeDark: 'Premium Dark', themeOled: 'OLED Focus', themeSys: 'সিস্টেম',
    addToConv: 'Add to conversation', aiTools: 'AI Tools',
    cam: 'Camera', img: 'Image', doc: 'Document', vid: 'Video', voice: 'Voice', file: 'File',
    tSearch: 'Search', tMcq: 'Create MCQ', tQuiz: 'Quiz Me', tExplain: 'Explain', tAnalyze: 'Analyze', tSummarize: 'Summarize',
    listening: 'Listening', transcribing: 'Transcribing…', voiceNope: 'এই ডিভাইসে ভয়েস-ইনপুট নেই', msgTooLong: 'মেসেজ খুব বড় — সর্বোচ্চ ৪,০০০ অক্ষর। ছোট করে আবার পাঠান।', shareBtn: 'শেয়ার', copyFail: 'কপি করা যায়নি', more: 'আরও',
    retry: 'আবার চেষ্টা করো',
    err: 'একটু সমস্যা হয়েছে।', errHttp: 'requestটি প্রক্রিয়া করতে সমস্যা হয়েছে — একটু পরে আবার চেষ্টা করো।', offline: 'ইন্টারনেট সংযোগ নেই', imgTooBig: 'ছবি ৩.৫MB-এর বেশি হবে না', editBtn: 'সম্পাদনা', seeMore: 'আরও দেখুন', themeSys: 'সিস্টেম',
    docSoon: 'ডকুমেন্ট-বিশ্লেষণ শীঘ্রই আসছে — আপাতত তোমার লেখা থেকে উত্তর দিয়েছি।', liked: 'ফিডব্যাকের জন্য ধন্যবাদ!',
    feedbackQ: 'কী ভুল ছিল?', fb1: 'ভুল', fb2: 'কাজের না', fb3: 'খুব জটিল', fb4: 'তথ্য অনুপস্থিত', fb5: 'অন্যান্য',
    confirmDel: 'এই কথোপকথনটা ডিলিট করবে?', cancel: 'Cancel', del: 'Delete', delDone: 'কথোপকথন ডিলিট হয়েছে',
    searchPh: 'কথোপকথনে খোঁজো…', noResults: 'কিছু পাওয়া যায়নি', emptySearch: 'খোঁজা বন্ধ করো', connected: 'Student data connected', publicMode: 'Public mode',
    stop: 'Stop', send: 'Send', attach: 'Add to conversation', savedTip: 'সেভ হয়েছে', welcomeSub: 'তোমার admission প্রস্তুতি নিয়ে যেকোনো প্রশ্ন করো।', studying: 'আজ কী পড়বো?'
  };

  /* ── themes ── */
  const THEMES = {
    light: { bg: '#F7F9F8', card: '#ffffff', ink: '#16302A', sub: '#5F7A72', primary: '#0E6B4F', mint: '#E4F3EC', line: 'rgba(15,107,79,.14)', user: '#0E5F45' },
    dark: { bg: '#0F1714', card: '#182420', ink: '#E8F4EF', sub: '#8FA8A0', primary: '#2FBF8F', mint: '#14332A', line: 'rgba(47,191,143,.18)', user: '#134F3E' },
    oled: { bg: '#000000', card: '#0B0F0D', ink: '#EAF5F0', sub: '#7E968D', primary: '#35D6A2', mint: '#0E1F19', line: 'rgba(53,214,162,.16)', user: '#0E7A54' }
  };

  const IC = (p) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const ICONS = {
    copy: IC('<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V5"/>'),
    check: IC('<path d="M4 12.5l5 5L20 6.5"/>'),
    like: IC('<path d="M7 11v10"/><path d="M15 5.5 14.2 10H20a2 2 0 0 1 1.93 2.5l-2.1 7A2 2 0 0 1 17.8 21H7V11l3.3-6.7A2.3 2.3 0 0 1 15 5.5z"/>'),
    dislike: IC('<path d="M17 13V3"/><path d="M9 18.5 9.8 14H4a2 2 0 0 1-1.93-2.5l2.1-7A2 2 0 0 1 6.2 3H17v10l-3.3 6.7A2.3 2.3 0 0 1 9 18.5z"/>'),
    share: IC('<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="m8.4 13.4 7.2 4.2M15.6 6.4l-7.2 4.2"/>'),
    regen: IC('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/>'),
    more: IC('<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>'),
    sparkle: IC('<path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6Z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z"/>'),
    pencil: IC('<path d="M17 3l4 4L8 20l-5.5 1.5L4 16Z"/><path d="m14 6 4 4"/>'),
    target: IC('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r=".8" fill="currentColor" stroke="none"/>'),
    book: IC('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
    zap: IC('<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>'),
    list: IC('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>')
  };
  const style = document.createElement('style');
  style.id = 'ai-agent-style';
  style.textContent = `
    .ai-agent-root{--r-s:10px;--r-m:14px;--r-card:18px;--r-l:22px;--r-float:28px;--r-pill:999px;
      height:100vh;height:100dvh;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;max-width:760px;margin:0 auto;overflow:hidden;
      padding-bottom:var(--ai-kb,0px);
      background:linear-gradient(180deg,#E9F6EF 0%,var(--ai-bg,#F7F9F8) 240px);color:var(--ai-ink,#16302A);
      font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Bengali","Hind Siliguri","Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji","Twemoji Mozilla",sans-serif;
      -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;font-feature-settings:'kern' 1,'liga' 1;
      transition:background .35s ease,color .35s ease;position:relative}
    .ai-agent-root[data-theme=dark]{background:#0F1714;color:#E8F4EF}
    .ai-agent-root[data-theme=oled]{background:#000;color:#EAF5F0}
    .ai-agent-root *{box-sizing:border-box}
    /* ── app viewport lock: AI page-এ html/body কখনো scroll হয় না (single-scroll architecture) ── */
    html.ai-chat-open,html.ai-chat-open body{height:100% !important;overflow:hidden !important;overscroll-behavior:none !important;touch-action:manipulation !important}
    html.ai-chat-open body{position:fixed !important;top:0;left:0;right:0;bottom:0;width:100%}
    html.ai-chat-open #app, #app.ai-chat-open{height:100vh !important;height:100dvh !important;min-height:100vh !important;min-height:100dvh !important;padding-bottom:0 !important;overflow:hidden !important}
    html.ai-chat-open #app.page, html.ai-chat-open .page{transform:none !important;will-change:auto !important}
    /* ── header ── */
    .ai-agent-head{position:relative;z-index:20;flex:0 0 auto;display:flex;align-items:center;gap:12px;padding:12px 16px 10px;background:var(--ai-bg,#F7F9F8);border-bottom:1px solid var(--ai-line,rgba(15,107,79,.1));box-shadow:0 6px 18px rgba(23,58,43,.05);transition:background .35s ease}
    .ai-orb{width:44px;height:44px;border-radius:50%;position:relative;flex:0 0 auto;
      background:radial-gradient(circle at 31% 27%,#c9ffe9 0%,#5fd9ae 20%,#1fa87c 47%,#0d5c44 78%,#073827 100%);
      box-shadow:0 8px 20px rgba(13,92,68,.35),inset 0 -7px 13px rgba(0,40,28,.4),inset 0 4px 9px rgba(255,255,255,.5);
      animation:aiOrbFloat 6.5s ease-in-out infinite}
    .ai-orb:after{content:'';position:absolute;left:22%;top:15%;width:13px;height:9px;border-radius:50%;background:rgba(255,255,255,.8);filter:blur(2px);transform:rotate(-20deg)}
    @keyframes aiOrbFloat{50%{transform:translateY(-4px) scale(1.02)}}
    .ai-agent-t{min-width:0;flex:1}
    .ai-agent-t b{display:block;font-size:16px;font-weight:800;letter-spacing:-.01em}
    .ai-agent-t span{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--ai-sub,#5F7A72);margin-top:1px}
    .ai-online-dot{width:6px;height:6px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.16)}
    .ai-icobtn{width:38px;height:38px;border-radius:12px;border:1px solid var(--ai-line,rgba(15,107,79,.14));background:var(--ai-card,#fff);color:var(--ai-ink,#16302A);font-size:16px;cursor:pointer;display:grid;place-items:center;flex:0 0 auto}
    .ai-ham{width:38px;height:38px;font-size:17px}
    .ai-homehead{width:38px;height:38px;display:grid;place-items:center;background:var(--ai-mint,#EFF7F2);border-color:rgba(15,107,79,.14)}
    .ai-homehead svg{display:block}
    .ai-homehead:active{transform:scale(.92)}
    .ai-plushead{width:38px;height:38px;font-size:19px;background:linear-gradient(140deg,#DDF3E8,#E7F6EF);color:#0E6B4F;border-color:rgba(15,107,79,.18)}
    .ai-plushead:active{transform:scale(.92)}
    .ai-icobtn:active{transform:scale(.93)}
    /* ── body ── */
    .ai-agent-body{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior-y:contain;overscroll-behavior-x:contain;padding:12px 14px 12px;-webkit-overflow-scrolling:touch;scrollbar-width:thin}
    .ai-hero{position:relative;display:flex;gap:10px;align-items:center;border-radius:var(--r-l);padding:18px 16px;overflow:hidden;
      background:linear-gradient(140deg,#E9F7F0 0%,#DFF3EA 55%,#EAF9F3 100%);border:1px solid rgba(15,107,79,.12);animation:aiIn .4s ease both}
    .ai-agent-root[data-theme=dark] .ai-hero{background:linear-gradient(140deg,#12332A,#0F2A22 55%,#144033);border-color:rgba(47,191,143,.15)}
    .ai-hero-txt{flex:1;min-width:0}
    .ai-hero-txt b{display:block;font-size:16.5px;font-weight:800;color:#0B5C42;letter-spacing:-.01em}
    .ai-agent-root[data-theme=dark] .ai-hero-txt b{color:#5FE6BD}
    .ai-hero-txt p{font-size:13.5px;line-height:1.68;color:#2E5C4C;margin:7px 0 12px}
    .ai-agent-root[data-theme=dark] .ai-hero-txt p{color:#9CC9B8}
    .ai-hero-cta{display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(15,107,79,.25);background:rgba(255,255,255,.75);color:#0B5C42;font:700 12.5px inherit;padding:9px 14px;border-radius:var(--r-pill);cursor:pointer}
    .ai-agent-root[data-theme=dark] .ai-hero-cta{background:rgba(20,60,48,.8);color:#5FE6BD;border-color:rgba(47,191,143,.3)}
    .ai-hero-cta:active{transform:scale(.97)}
    .ai-hero-orb{width:104px;height:104px;flex:0 0 auto;position:relative;display:grid;place-items:center}
    .ai-hero-orb .ring{position:absolute;inset:2px;border-radius:50%;border:1px dashed rgba(15,107,79,.28);animation:aiRing 16s linear infinite}
    .ai-hero-orb .ring2{position:absolute;inset:12px;border-radius:50%;border:1px solid rgba(15,107,79,.16);animation:aiRing 22s linear infinite reverse}
    @keyframes aiRing{to{transform:rotate(360deg)}}
    .ai-hero-orb .big{width:78px;height:78px;border-radius:50%;position:relative;
      background:radial-gradient(circle at 30% 26%,#d3ffec 0%,#63dcb1 18%,#22ab7f 45%,#0e5e46 76%,#093f30 100%);
      box-shadow:0 16px 36px rgba(13,92,68,.4),inset 0 -10px 20px rgba(0,40,28,.45),inset 0 6px 12px rgba(255,255,255,.55);animation:aiOrbFloat 5.5s ease-in-out infinite}
    .ai-hero-orb .big:after{content:'';position:absolute;left:20%;top:13%;width:20px;height:14px;border-radius:50%;background:rgba(255,255,255,.85);filter:blur(3px);transform:rotate(-22deg)}
    .ai-hero-orb .p1,.ai-hero-orb .p2,.ai-hero-orb .p3{position:absolute;width:7px;height:7px;border-radius:50%;background:#2EE6A8;box-shadow:0 0 12px rgba(46,230,168,.8);animation:aiSpark 4s ease-in-out infinite}
    .ai-hero-orb .p1{top:6px;right:14px}.ai-hero-orb .p2{bottom:10px;left:8px;animation-delay:1.2s}.ai-hero-orb .p3{top:38%;right:-2px;width:5px;height:5px;animation-delay:2.1s}
    @keyframes aiSpark{50%{opacity:.25;transform:scale(.6) translateY(-4px)}}
    .ai-notice{display:flex;align-items:flex-start;gap:9px;background:var(--ai-card,#fff);border:1px solid var(--ai-line,rgba(15,107,79,.12));border-radius:var(--r-m);padding:11px 12px;margin:12px 0 4px;font-size:12px;line-height:1.6;color:var(--ai-sub,#5F7A72);animation:aiIn .4s ease both}
    .ai-notice b{color:var(--ai-ink,#16302A)}
    .ai-notice .x{margin-left:auto;border:0;background:none;color:var(--ai-sub,#8AA39A);font-size:16px;cursor:pointer;line-height:1;padding:2px}
    .ai-try{display:flex;align-items:center;gap:8px;margin:14px 2px 9px;font-size:14px;font-weight:800}
    .ai-chips{display:flex;gap:9px;overflow-x:auto;padding-bottom:8px;scrollbar-width:none}
    .ai-chips::-webkit-scrollbar{display:none}
    .ai-chip{flex:0 0 auto;min-width:148px;border:1px solid var(--ai-line,rgba(15,107,79,.14));background:var(--ai-card,#fff);border-radius:var(--r-card);padding:12px 13px;cursor:pointer;text-align:left;color:var(--ai-ink,#16302A);transition:transform .15s,box-shadow .15s;box-shadow:0 4px 14px rgba(23,58,43,.05)}
    .ai-chip:active{transform:scale(.97)}
    .ai-chip .ic{font-size:17px;display:block;margin-bottom:5px}
    .ai-chip b{font-size:12.5px;font-weight:800;display:block;letter-spacing:-.01em}
    .ai-chip span{font-size:10.5px;color:var(--ai-sub,#5F7A72);display:block;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    /* ── messages ── */
    .ai-msgs{display:flex;flex-direction:column;gap:14px;padding:6px 0 14px}
    .ai-msg{animation:aiIn .24s ease both}
    @keyframes aiIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
    .ai-msg.user{display:flex;justify-content:flex-end}
    .ai-msg.user .bubble{max-width:82%;background:var(--ai-user,#0E5F45);color:#fff;border-radius:18px 18px 6px 18px;padding:12px 16px;font-size:15.5px;line-height:1.65;white-space:pre-wrap;word-break:break-word;box-shadow:0 6px 16px rgba(14,95,69,.18)}
    .ai-agent-root[data-theme=dark] .ai-msg.user .bubble{background:#134F3E}
    .ai-msg.user .meta{display:flex;justify-content:flex-end;align-items:center;gap:4px;font-size:10.5px;color:var(--ai-sub,#8AA39A);margin-top:4px}
    .ai-tick{color:#7BE3C0;font-size:10px}
    .ai-msg.user img.thumb{display:block;max-width:190px;border-radius:11px;margin-top:8px}
    .ai-msg.ai{background:var(--ai-card,#fff);border:1px solid var(--ai-line,rgba(15,107,79,.12));border-radius:20px;padding:16px 17px 11px;box-shadow:0 10px 26px rgba(23,58,43,.07)}
    .ai-msg-head{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:800;color:#0E6B4F;margin-bottom:10px}
    .ai-agent-root[data-theme=dark] .ai-msg-head{color:#5FE6BD}
    .ai-msg-head .mini{width:16px;height:16px;border-radius:50%;background:radial-gradient(circle at 32% 28%,#c9ffe9,#1fa87c 60%,#0d5c44);box-shadow:0 2px 6px rgba(13,92,68,.35)}
    .ai-msg-body{font-size:16.5px;line-height:1.85;text-wrap:pretty}
    .ai-msg-body h1,.ai-msg-body h2,.ai-msg-body h3{font-size:19px;font-weight:700;color:#0E6B4F;margin:10px 0 7px;letter-spacing:-.01em;line-height:1.45}
    .ai-agent-root[data-theme=dark] .ai-msg-body h1,.ai-agent-root[data-theme=dark] .ai-msg-body h2,.ai-agent-root[data-theme=dark] .ai-msg-body h3{color:#5FE6BD}
    .ai-msg-body p{margin:12px 0}
    .ai-msg-body ul,.ai-msg-body ol{margin:12px 0;padding-left:25px}
    .ai-msg-body li{margin:7px 0}
    .ai-msg-body code{background:var(--ai-mint,#EFF7F2);border-radius:6px;padding:2px 7px;font-size:13.5px;font-family:ui-monospace,Menlo,monospace}
    .ai-msg-body pre{background:#0E2A20;color:#D8F3E6;border-radius:13px;padding:13px 15px;overflow-x:auto;font-size:13px;margin:12px 0}
    .ai-msg-body pre code{background:none;color:inherit;padding:0}
    .ai-msg-body blockquote{border-left:3px solid rgba(14,107,79,.35);background:var(--ai-mint,#F3FAF6);border-radius:0 var(--r-m) var(--r-m) 0;margin:12px 0;padding:12px 15px;font-size:16px;line-height:1.8}
    .ai-msg-body a{color:#0E6B4F;font-weight:700;text-decoration:underline}
    .ai-formula{background:var(--ai-mint,#EFF7F2);border:1px solid rgba(15,107,79,.14);border-radius:var(--r-m);padding:14px;margin:11px 0;text-align:center;font-family:Georgia,"Times New Roman",serif;font-style:italic;font-size:20px;color:var(--ai-ink,#16302A)}
    .ai-callout{border-radius:var(--r-m);padding:13px 15px;margin:12px 0;font-size:15px;line-height:1.75;border:1px solid}
    .ai-callout.tip{background:rgba(255,241,196,.4);border-color:rgba(212,160,26,.25);color:var(--ai-ink,#16302A)}
    .ai-callout.tip b{color:#8a6d1c}
    .ai-callout.example{background:var(--ai-mint,#EFF7F2);border-color:rgba(15,107,79,.14)}
    .ai-callout.example b{color:#0E6B4F}
    .ai-callout.warn{background:rgba(253,235,235,.5);border-color:rgba(192,57,43,.2)}
    .ai-callout.warn b{color:#a93226}
    .ai-msg-body table{width:100%;border-collapse:collapse;margin:12px 0;font-size:14.5px}
    .ai-msg-body th,.ai-msg-body td{border:1px solid var(--ai-line,rgba(15,107,79,.16));padding:9px 11px;text-align:left}
    .ai-msg-body th{background:var(--ai-mint,#E9F5EF);font-weight:800}
    .ai-math{font-family:Georgia,serif;font-style:italic}
    .ai-math-inline{font-family:Georgia,serif;font-style:italic}
    .ai-cursor{display:inline-block;width:2px;height:1em;background:#2EE6A8;vertical-align:-.15em;margin-left:1px;animation:aiBlink .8s steps(1) infinite}
    @keyframes aiBlink{50%{opacity:0}}
    .ai-think{display:flex;align-items:center;gap:10px;padding:5px 4px;margin:1px 0;animation:aiIn .2s ease both;background:none;border:0;box-shadow:none;border-radius:0}
    .ai-think .ob{width:27px;height:27px;border-radius:50%;flex:0 0 auto;position:relative;
      background:radial-gradient(circle at 32% 28%,#c9ffe9 0%,#5fd9ae 24%,#1fa87c 56%,#0d5c44 84%,#073827 100%);
      box-shadow:0 5px 14px rgba(13,92,68,.42),inset 0 -4px 8px rgba(0,40,28,.45),inset 0 3px 6px rgba(255,255,255,.55),0 0 14px rgba(46,230,168,.28);
      animation:aiOrbFloat 2.4s ease-in-out infinite}
    .ai-think .ob:after{content:'';position:absolute;left:22%;top:14%;width:7px;height:5px;border-radius:50%;background:rgba(255,255,255,.85);filter:blur(1.5px);transform:rotate(-20deg)}
    .ai-think .tx{display:flex;align-items:baseline;gap:6px;min-width:0}
    .ai-think .tx b{font-size:12.5px;font-weight:800;color:var(--ai-ink,#16302A);white-space:nowrap}
    .ai-think .tx span{font-size:12px;font-weight:600;color:var(--ai-sub,#5F7A72);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ai-think.tq-search .ob{background:radial-gradient(circle at 32% 28%,#d9f3ff 0%,#7fd0f2 24%,#2f9bd8 56%,#135a86 84%,#08324c 100%);box-shadow:0 5px 14px rgba(19,90,134,.45),inset 0 -4px 8px rgba(0,32,50,.45),inset 0 3px 6px rgba(255,255,255,.6),0 0 14px rgba(80,180,255,.32)}
    .ai-think.tq-analyze .ob{background:radial-gradient(circle at 32% 28%,#f0e6ff 0%,#bb9bf5 24%,#7d52d6 56%,#4a2b86 84%,#2b1750 100%);box-shadow:0 5px 14px rgba(74,43,134,.45),inset 0 -4px 8px rgba(20,10,46,.45),inset 0 3px 6px rgba(255,255,255,.6),0 0 14px rgba(160,110,255,.32)}
    .ai-think.tq-create .ob{background:radial-gradient(circle at 32% 28%,#fff3da 0%,#f4cd85 24%,#dc9e2f 56%,#8f5d12 84%,#4d3206 100%);box-shadow:0 5px 14px rgba(143,93,18,.45),inset 0 -4px 8px rgba(45,28,4,.45),inset 0 3px 6px rgba(255,255,255,.6),0 0 14px rgba(255,195,85,.32)}
    /* ── dynamic rich-blocks ── */
    .ai-stats{margin:12px 0;border:1px solid var(--ai-line,rgba(15,107,79,.16));border-radius:var(--r-m);padding:12px 14px;background:var(--ai-mint,#F2FAF6)}
    .ai-stat{margin:9px 0}
    .ai-stat .lbl{display:flex;justify-content:space-between;gap:8px;font-size:12.5px;font-weight:700;color:var(--ai-ink,#16302A)}
    .ai-stat .lbl .v{font-weight:800;color:#0E6B4F;font-variant-numeric:tabular-nums}
    .ai-stat .tr{height:7px;border-radius:99px;background:rgba(15,107,79,.1);margin-top:5px;overflow:hidden}
    .ai-stat .fl{height:100%;border-radius:99px;background:linear-gradient(90deg,#2FB98A,#0E6B4F);transform-origin:left;animation:aiBarGrow .9s cubic-bezier(.2,.8,.3,1) both}
    .ai-stat:nth-child(2) .fl{animation-delay:.12s}
    .ai-stat:nth-child(3) .fl{animation-delay:.24s}
    .ai-stat:nth-child(4) .fl{animation-delay:.36s}
    .ai-stat:nth-child(5) .fl{animation-delay:.48s}
    @keyframes aiBarGrow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
    .ai-timeline{margin:12px 0;padding:4px 0 6px 22px;border-left:2px solid var(--ai-line,rgba(15,107,79,.35));position:relative}
    .ai-tl{position:relative;padding:0 0 14px 8px;animation:aiIn .35s ease both}
    .ai-tl:last-child{padding-bottom:2px}
    .ai-tl:before{content:'';position:absolute;left:-27px;top:4px;width:10px;height:10px;border-radius:50%;background:#0E6B4F;box-shadow:0 0 0 3px var(--ai-mint,#E4F3EC)}
    .ai-tl .yr{font-weight:800;color:#0E6B4F;font-size:13.5px;font-variant-numeric:tabular-nums}
    .ai-tl .ds{font-size:14.5px;color:var(--ai-ink,#16302A);line-height:1.65;margin-top:1px}
    .ai-checklist{margin:10px 0;padding:0;list-style:none}
    .ai-checklist li{display:flex;gap:10px;align-items:flex-start;margin:8px 0}
    .ai-checklist .bx{width:19px;height:19px;flex:0 0 auto;border-radius:6px;border:1.6px solid var(--ai-line,rgba(15,107,79,.4));margin-top:1px;display:grid;place-items:center;font-size:11px;color:#fff;background:var(--ai-mint,#EFF7F2);font-weight:800}
    .ai-checklist li.done .bx{background:#0E6B4F;border-color:#0E6B4F}
    .ai-checklist li.done{opacity:.78}
    .ai-callout.define{background:var(--ai-mint,#EFF7F2);border-color:rgba(15,107,79,.2)}
    .ai-callout.define b{color:#0E6B4F}
    .ai-callout.success{background:rgba(34,197,94,.08);border-color:rgba(34,197,94,.28)}
    .ai-callout.success b{color:#15803d}
    .ai-callout.keypoint{background:rgba(255,241,196,.32);border-color:rgba(212,160,26,.22)}
    .ai-callout.keypoint b{color:#8a6d1c}
    .ai-callout.concept{background:rgba(99,102,241,.07);border-color:rgba(99,102,241,.2)}
    .ai-callout.concept b{color:#4f46e5}
    .ai-callout.revision{background:rgba(14,107,79,.06);border-color:rgba(14,107,79,.18)}
    .ai-callout.revision b{color:#0E6B4F}
    .ai-twrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:12px 0}
    .ai-twrap table{margin:0}
    .ai-msg-bar{display:flex;align-items:center;gap:3px;margin-top:10px;padding-top:8px;border-top:1px solid var(--ai-line,rgba(15,107,79,.08))}
    .ai-msg-bar .ab{width:31px;height:31px;border:0;background:none;color:var(--ai-sub,#7A948B);cursor:pointer;display:grid;place-items:center;border-radius:9px;transition:background .15s,color .15s,transform .12s}
    .ai-msg-bar .ab:hover{background:var(--ai-mint,#EFF7F2);color:#0E6B4F}
    .ai-msg-bar .ab:active{transform:scale(.88)}
    .ai-msg-bar .ab svg{display:block}
    .ai-msg-bar .ab[data-fb=up].on{color:#0E6B4F;background:rgba(14,107,79,.1)}
    .ai-msg-bar .ab[data-fb=down].on{color:#B45309;background:rgba(180,83,9,.1)}
    .ai-agent-root[data-theme=dark] .ai-msg-bar .ab:hover{background:rgba(47,191,143,.12);color:#5FE6BD}
    .ai-msg-bar .sp{margin-left:auto}
    .ai-msg-bar .abtxt{display:inline-flex;align-items:center;gap:5px;border:0;background:none;color:#0E6B4F;font:700 12px inherit;cursor:pointer;padding:5px 10px;border-radius:999px}
    /* ── quiz card ── */
    .ai-quiz{border:1px solid rgba(15,107,79,.16);border-radius:var(--r-l);overflow:hidden;background:var(--ai-card,#fff);margin:9px 0 2px}
    .ai-quiz-head{display:flex;align-items:center;gap:8px;padding:11px 14px;font-size:12.5px;font-weight:800;color:#0E6B4F;border-bottom:1px solid rgba(15,107,79,.1)}
    .ai-agent-root[data-theme=dark] .ai-quiz-head{color:#5FE6BD}
    .ai-quiz-head .qcount{margin-left:auto;color:var(--ai-sub,#8AA39A);font-weight:700;font-size:11.5px}
    .ai-quiz-body{padding:14px}
    .ai-quiz-q{font-size:15px;font-weight:700;line-height:1.6;margin-bottom:12px}
    .ai-quiz-opts{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    @media(max-width:359px){.ai-quiz-opts{grid-template-columns:1fr}}
    .ai-opt{display:flex;align-items:center;gap:8px;border:1.2px solid var(--ai-line,rgba(15,107,79,.22));border-radius:var(--r-m);padding:10px 11px;font-size:13.5px;cursor:pointer;background:var(--ai-card,#fff);color:var(--ai-ink,#16302A);text-align:left;transition:border-color .15s,background .15s}
    .ai-opt .dot{width:15px;height:15px;border-radius:50%;border:1.6px solid #A9C4BA;flex:0 0 auto;display:grid;place-items:center}
    .ai-opt.sel{border-color:#0E6B4F;background:rgba(14,107,79,.05)}
    .ai-opt.sel .dot{border-color:#0E6B4F}
    .ai-opt.sel .dot:after{content:'';width:8px;height:8px;border-radius:50%;background:#0E6B4F}
    .ai-opt.correct{border-color:#16a34a;background:rgba(34,197,94,.09)}
    .ai-opt.wrong{border-color:#dc2626;background:rgba(220,38,38,.07)}
    .ai-quiz-fb{border-radius:var(--r-m);padding:11px 13px;margin-top:11px;font-size:13.5px;line-height:1.6}
    .ai-quiz-fb.good{background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.25);color:#15803d}
    .ai-quiz-fb.bad{background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.22);color:#b91c1c}
    .ai-quiz-fb b{display:block;margin-bottom:3px}
    .ai-quiz-next{display:block;width:100%;margin-top:12px;border:0;border-radius:var(--r-m);background:var(--ai-user,#0E5F45);color:#fff;font:700 14px inherit;padding:12px;cursor:pointer}
    .ai-agent-root[data-theme=dark] .ai-quiz-next{background:#134F3E}
    .ai-quiz-done{text-align:center;padding:16px 10px}
    .ai-quiz-done .big{font-size:25px;font-weight:800;color:#0E6B4F}
    .ai-agent-root[data-theme=dark] .ai-quiz-done .big{color:#5FE6BD}
    .ai-quiz-done p{font-size:13px;color:var(--ai-sub,#5F7A72);margin:7px 0 12px}
    .ai-quiz-done .acts{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
    .ai-quiz-done .acts button{border-radius:var(--r-pill);padding:9px 15px;font:700 12.5px inherit;cursor:pointer}
    .ai-quiz-done .ghost{border:1px solid var(--ai-line,rgba(15,107,79,.24));background:none;color:#0E6B4F}
    .ai-quiz-done .solid{border:0;background:#0E6B4F;color:#fff}
    .ai-quiz-analysis{margin-top:12px;font-size:12.5px;color:var(--ai-sub,#5F7A72)}
    .ai-quiz-analysis div{padding:6px 0;border-bottom:1px dashed var(--ai-line,rgba(15,107,79,.1))}
    .ai-quiz-analysis b{color:var(--ai-ink,#16302A)}
    .ai-quiz-analysis .ok{color:#15803d}.ai-quiz-analysis .no{color:#b91c1c}
    /* ── follow-up ── */
    .ai-followup{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}
    .ai-followup button{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--ai-line,rgba(15,107,79,.15));background:var(--ai-mint,#F1F8F4);color:#0E6B4F;border-radius:999px;padding:5.5px 11px 5.5px 9px;font:600 12px inherit;cursor:pointer;transition:background .15s,transform .12s;box-shadow:none}
    .ai-followup button:hover{background:#E4F3EC}
    .ai-followup button:active{transform:scale(.96)}
    .ai-followup button svg{flex:0 0 auto;opacity:.8}
    .ai-agent-root[data-theme=dark] .ai-followup button{color:#5FE6BD;background:rgba(47,191,143,.1);border-color:rgba(47,191,143,.22)}
    .ai-agent-root[data-theme=dark] .ai-followup button:hover{background:rgba(47,191,143,.16)}
    /* ── composer ── */
    .ai-agent-foot{position:relative;flex:0 0 auto;flex-shrink:0;width:100%;z-index:50;padding:7px 12px calc(8px + env(safe-area-inset-bottom));background:linear-gradient(transparent,var(--ai-bg,#F7F9F8) 36%);transition:background .35s ease}
    /* keyboard open: composer keyboard-এর ঠিক উপরে — মিথ্যা safe-area gap বাদ */
    .ai-agent-root.ai-kb .ai-agent-foot{padding-bottom:8px}
    .ai-agent-root.ai-kb .ai-attach-zone{padding-bottom:4px}
    .ai-compose{display:flex;align-items:center;gap:7px;min-height:52px;background:var(--ai-card,#fff);border:1.5px solid var(--ai-line,rgba(15,107,79,.22));border-radius:26px;padding:6px 7px;box-shadow:0 18px 42px rgba(23,58,43,.16),0 3px 10px rgba(23,58,43,.06),inset 0 1px 0 rgba(255,255,255,.65);transition:border-color .22s ease,box-shadow .22s ease}
    .ai-compose:focus-within{border-color:rgba(18,128,90,.55);box-shadow:0 0 0 4px rgba(18,128,90,.12),0 22px 48px rgba(23,58,43,.2),inset 0 1px 0 rgba(255,255,255,.65)}
    .ai-agent-root[data-theme=dark] .ai-compose{box-shadow:0 12px 30px rgba(0,0,0,.5)}
    .ai-compose-mid{flex:1;min-width:0;display:flex;flex-direction:column}
    .ai-editor{min-height:0!important;height:auto;border:0!important;background:transparent!important;resize:none;outline:0!important;box-shadow:none!important;-webkit-appearance:none;appearance:none;font:inherit;font-size:16px;line-height:1.5;max-height:128px;overflow-y:auto;padding:9px 4px 5px;color:var(--ai-ink,#16302A);white-space:pre-wrap;word-break:break-word;scrollbar-width:thin;cursor:text}
    .ai-editor::-webkit-scrollbar{width:4px}
    .ai-editor::-webkit-scrollbar-thumb{background:var(--ai-line,rgba(15,107,79,.25));border-radius:99px}
    .ai-editor:empty::before{content:attr(data-ph);color:#93A8A0;pointer-events:none}
    .ai-editor:focus{outline:0}
    .ai-plus{width:40px;height:40px;flex:0 0 auto;border-radius:50%;border:0;background:linear-gradient(140deg,#DDF3E8,#E7F6EF);color:#0E6B4F;font-size:20px;cursor:pointer;display:grid;place-items:center;box-shadow:0 4px 10px rgba(14,107,79,.12),inset 0 1px 0 rgba(255,255,255,.8);transition:transform .22s ease,background .22s ease,color .22s ease}
    .ai-plus.plus-on{transform:rotate(45deg);background:linear-gradient(140deg,#12805A,#0E5F45);color:#fff}
    .ai-plus:active{transform:scale(.9)}
    .ai-compose textarea{width:100%;min-width:0;min-height:0!important;height:auto;border:0;background:none;resize:none;font:inherit;font-size:16px;line-height:1.5;max-height:128px;overflow-y:auto;padding:9px 4px 5px;outline:0;color:var(--ai-ink,#16302A);scrollbar-width:thin}
    .ai-compose textarea::-webkit-scrollbar{width:4px}
    .ai-compose textarea::-webkit-scrollbar-thumb{background:var(--ai-line,rgba(15,107,79,.25));border-radius:99px}
    .ai-compose textarea::placeholder{color:#93A8A0}
    .ai-mic{width:40px;height:40px;flex:0 0 auto;border-radius:50%;border:1px solid var(--ai-line,rgba(15,107,79,.22));background:linear-gradient(140deg,#F2FAF6,#E9F6EF);color:#0E6B4F;font-size:16px;cursor:pointer;display:grid;place-items:center;box-shadow:inset 0 1px 0 rgba(255,255,255,.7);transition:border-color .2s,box-shadow .2s}
    .ai-mic:active{border-color:rgba(14,107,79,.5);box-shadow:0 0 0 4px rgba(18,128,90,.1)}
    .ai-agent-root[data-theme=dark] .ai-mic{color:#5FE6BD;background:rgba(47,191,143,.12);border-color:rgba(47,191,143,.3)}
    .ai-agent-root[data-theme=dark] .ai-plus{background:rgba(47,191,143,.16);color:#5FE6BD;box-shadow:none}
    .ai-agent-root[data-theme=dark] .ai-msg-body a{color:#5FE6BD}
    .ai-agent-root[data-theme=dark] .ai-callout.tip{background:rgba(212,160,26,.13);border-color:rgba(212,160,26,.3);color:#F0E3BC}
    .ai-agent-root[data-theme=dark] .ai-callout.tip b{color:#FFD97A}
    .ai-agent-root[data-theme=dark] .ai-callout.example{background:rgba(47,191,143,.1);border-color:rgba(47,191,143,.25)}
    .ai-agent-root[data-theme=dark] .ai-callout.warn{background:rgba(220,38,38,.13);border-color:rgba(220,38,38,.3)}
    .ai-agent-root[data-theme=dark] .ai-msg-body th{background:rgba(47,191,143,.16)}
    .ai-agent-root[data-theme=dark] .ai-sheet-it .ic{background:rgba(47,191,143,.15)}
    .ai-agent-root[data-theme=dark] .ai-compose textarea::placeholder,.ai-agent-root[data-theme=dark] .ai-editor:empty::before{color:#5E7A70}
    .ai-mic.rec{border-color:#dc2626;background:rgba(220,38,38,.1);animation:aiRec 1.1s ease-in-out infinite}
    @keyframes aiRec{50%{box-shadow:0 0 0 5px rgba(220,38,38,.14)}}
    .ai-send{width:40px;height:40px;flex:0 0 auto;border-radius:50%;border:0;background:linear-gradient(140deg,#149468,#0E5F45);color:#fff;font-size:15px;cursor:pointer;display:none;place-items:center;box-shadow:0 8px 18px rgba(14,95,69,.38),inset 0 1px 0 rgba(255,255,255,.25);transition:transform .18s ease,box-shadow .18s ease,opacity .18s;animation:aiIn .18s ease both}
    .ai-send:hover{transform:translateY(-1px);box-shadow:0 11px 22px rgba(14,95,69,.42),inset 0 1px 0 rgba(255,255,255,.25)}
    .ai-compose.dirty .ai-send{display:grid}
    .ai-compose.dirty .ai-mic{display:none}
    .ai-compose.streaming .ai-send{display:grid}
    .ai-compose.streaming .ai-mic{display:none}
    .ai-compose .ai-mic.show{display:grid}
    .ai-send:active{transform:scale(.9)}
    .ai-send.stop{background:linear-gradient(140deg,#C0392B,#A93226)}
    .ai-send:disabled{opacity:.5}
    .ai-attach-chip{display:flex;align-items:center;gap:9px;background:var(--ai-card,#fff);border:1px solid var(--ai-line,rgba(15,107,79,.18));border-radius:14px;padding:8px 12px;margin:0 2px 9px;font-size:12.5px;box-shadow:0 4px 12px rgba(23,58,43,.06);animation:aiIn .2s ease both}
    .ai-attach-chip img{width:42px;height:42px;border-radius:8px;object-fit:cover}
    .ai-attach-chip .nm{flex:1;min-width:0}.ai-attach-chip b{display:block;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ai-attach-chip span{font-size:11px;color:var(--ai-sub,#5F7A72)}
    .ai-attach-chip .x{border:0;background:none;color:var(--ai-sub,#8AA39A);font-size:15px;cursor:pointer}
    .ai-voicebar{display:flex;align-items:center;gap:10px;background:var(--ai-card,#fff);border:1px solid rgba(220,38,38,.25);border-radius:var(--r-m);padding:10px 13px;margin:0 2px 8px;font-size:13px;animation:aiIn .2s ease both}
    .ai-voicebar .rec{width:11px;height:11px;border-radius:50%;background:#dc2626;animation:aiRec 1.1s infinite}
    .ai-voicebar b{font-weight:800}
    /* ── bottom sheet ── */
    .ai-sheetback{position:fixed;inset:0;background:rgba(8,24,18,.5);backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);z-index:80;display:flex;align-items:flex-end;justify-content:center;animation:aiFade .2s ease}
    @keyframes aiFade{from{opacity:0}}
    .ai-sheet{width:100%;max-width:760px;max-height:88dvh;overflow-y:auto;background:var(--ai-card,#fff);border-radius:24px 24px 0 0;padding:6px 16px calc(18px + env(safe-area-inset-bottom));animation:aiSheet .26s ease;color:var(--ai-ink,#16302A);box-shadow:0 -18px 50px rgba(8,24,18,.25)}
    .ai-sheet-grab{width:42px;height:5px;border-radius:99px;background:var(--ai-line,rgba(15,107,79,.22));margin:6px auto 10px;flex:0 0 auto}
    @keyframes aiSheet{from{transform:translateY(24%);opacity:.6}to{transform:none;opacity:1}}
    .ai-sheet-h{font-size:12px;font-weight:800;letter-spacing:.05em;color:var(--ai-sub,#5F7A72);margin:4px 2px 10px;text-transform:uppercase}
    .ai-sheet-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:16px}
    @media(min-width:560px){.ai-sheet-grid{grid-template-columns:repeat(6,1fr)}}
    .ai-sheet-it{border:1px solid var(--ai-line,rgba(15,107,79,.14));border-radius:var(--r-m);padding:12px 6px;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;font-weight:700;cursor:pointer;background:var(--ai-card,#fff);color:var(--ai-ink,#16302A)}
    .ai-sheet-it:active{transform:scale(.95)}
    .ai-sheet-it .ic{font-size:19px;width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:var(--ai-mint,#E4F3EC)}
    /* ── ↓ Latest ফ্লোটিং ── */
    .ai-latest{position:fixed;right:14px;bottom:calc(env(safe-area-inset-bottom) + var(--ai-comp-h,76px) + 14px + var(--ai-kb,0px));z-index:11;width:42px;height:42px;border-radius:50%;border:0;background:#0E2A20;color:#D8F3E6;font-size:16px;font-weight:800;display:none;place-items:center;box-shadow:0 10px 26px rgba(0,0,0,.3);cursor:pointer;animation:aiIn .2s ease both}
    .ai-latest.show{display:grid}
    .ai-latest i.cnt{position:absolute;top:-5px;right:-5px;min-width:19px;height:19px;padding:0 5px;border-radius:99px;background:#2EE6A8;color:#06281C;font:800 10.5px/19px inherit;font-style:normal;display:none;text-align:center;box-shadow:0 3px 8px rgba(0,0,0,.25)}
    .ai-latest.new i.cnt{display:block}
    /* ── sidebar drawer ── */
    /* ═══════════ Universal Rich Response UI v1 (v218) ═══════════ */

    /* ═══════════ Universal Rich Response UI v1 (v218) ═══════════ */
    .ai-rb-h{margin:14px 0 6px;font-size:16.5px;font-weight:800;letter-spacing:-.01em;line-height:1.42}
    .ai-rb-h:first-child{margin-top:2px}
    .ai-rb-ul,.ai-rb-ol{margin:10px 0 2px;padding-left:22px}
    .ai-rb-ul li,.ai-rb-ol li{margin:5px 0;font-size:15px;line-height:1.7}
    .ai-rb-q{border-left:3px solid rgba(15,107,79,.4);margin:10px 0 4px;padding:8px 12px;background:var(--ai-mint,#F2FAF6);border-radius:0 12px 12px 0;font-size:14.5px;line-height:1.7;color:var(--ai-ink,#16302A)}
    .ai-cr{display:contents}
    .ai-twrap{overflow-x:auto;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;margin:12px 0 4px;border:1px solid var(--ai-line,rgba(15,107,79,.14));border-radius:16px;background:var(--ai-card,#fff)}
    .ai-twrap table.ai-rb-tab{width:100%;border-collapse:collapse;font-size:13.5px;min-width:420px}
    .ai-twrap .ai-rb-tab th{background:var(--ai-mint,#F2FAF6);color:#0E5B43;font-size:11.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;text-align:left;padding:10px 12px;position:sticky;top:0;z-index:2}
    .ai-twrap .ai-rb-tab td{padding:10px 12px;border-top:1px solid rgba(15,107,79,.08);vertical-align:top;line-height:1.55}
    .ai-twrap .ai-rb-tab tr:nth-child(even) td{background:rgba(15,107,79,.028)}
    .ai-twrap .ai-rb-tab.twide th:first-child,.ai-twrap .ai-rb-tab.twide td:first-child{position:sticky;left:0;background:#fff;box-shadow:2px 0 8px rgba(20,60,45,.05);font-weight:800;z-index:1}
    .ai-twrap .ai-rb-tab.twide th:first-child{background:var(--ai-mint,#F2FAF6);z-index:3}
    /* KPI */
    .ai-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:9px;margin:12px 0 6px}
    .ai-kpi{background:var(--ai-card,#fff);border:1px solid var(--ai-line,rgba(15,107,79,.14));border-radius:15px;padding:12px 11px;box-shadow:0 3px 12px rgba(23,58,43,.05);animation:aiIn .3s ease both}
    .ai-kpi .v{display:block;font-size:19px;font-weight:850;letter-spacing:-.02em;color:#0E6B4F;line-height:1.15}
    .ai-kpi .v i{font-size:11.5px;font-weight:700;font-style:normal;color:var(--ai-sub,#5F7A72);margin-left:2px}
    .ai-kpi .k{display:block;font-size:11px;font-weight:700;color:var(--ai-sub,#5F7A72);margin-top:3px;letter-spacing:.01em}
    /* Compare */
    .ai-cmp{border:1px solid var(--ai-line,rgba(15,107,79,.14));border-radius:16px;background:var(--ai-card,#fff);margin:12px 0 6px;overflow:hidden;font-size:13px}
    .ai-cmp-hed,.ai-cmp-row{display:grid;grid-template-columns:1.05fr 1fr 1fr;gap:6px;align-items:center;padding:9px 12px}
    .ai-cmp-row{border-top:1px solid rgba(15,107,79,.07)}
    .ai-cmp-hed{background:var(--ai-mint,#F2FAF6)}
    .ai-cmp-hed .c{font-weight:800;color:#0E5B43;font-size:12.5px}
    .ai-cmp .k{font-weight:700;color:var(--ai-ink,#16302A);font-size:12.5px;min-width:0}
    .ai-cmp .c .bar{display:block;height:8px;border-radius:99px;background:rgba(15,107,79,.1);overflow:hidden}
    .ai-cmp .c .bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#1FA87C,#0E6B4F);animation:aiBar .8s cubic-bezier(.22,.9,.32,1) both;transform-origin:left}
    .ai-cmp .c .na{color:var(--ai-sub,#93A8A0)}
    @keyframes aiBar{from{transform:scaleX(0)}}
    /* Steps */
    .ai-steps{margin:12px 0 4px;padding:0;list-style:none;counter-reset:st}
    .ai-step{display:flex;gap:11px;position:relative;padding-bottom:14px}
    .ai-step:last-child{padding-bottom:2px}
    .ai-step:before{content:'';position:absolute;left:14px;top:30px;bottom:0;width:2px;background:linear-gradient(var(--ai-line,rgba(15,107,79,.3)),rgba(15,107,79,.06))}
    .ai-step:last-child:before{display:none}
    .ai-step .n{width:29px;height:29px;flex:0 0 29px;border-radius:10px;background:linear-gradient(140deg,#DDF3E8,#CFEEE0);color:#0E6B4F;font-weight:850;font-size:12.5px;display:grid;place-items:center;border:1px solid rgba(15,107,79,.18);box-shadow:0 2px 8px rgba(15,107,79,.08)}
    .ai-step .st{flex:1;min-width:0;padding-top:3px}
    .ai-step .st-t{font-size:14.5px;font-weight:800;line-height:1.4}
    .ai-step .st-d{font-size:13.5px;color:var(--ai-sub,#4A665C);line-height:1.65;margin-top:2px}
    /* Flow */
    .ai-flow{display:flex;flex-direction:column;gap:0;margin:12px 0 6px}
    .ai-flow .nd{align-self:flex-start;background:var(--ai-card,#fff);border:1px solid rgba(15,107,79,.16);border-radius:12px;padding:9px 13px;font-size:13.5px;font-weight:700;box-shadow:0 3px 10px rgba(23,58,43,.06);max-width:100%}
    .ai-flow .ar{display:block;text-align:center;color:#1FA87C;font-size:14px;line-height:1.9;font-weight:800}
    /* Code */
    .ai-code{border:1px solid rgba(15,107,79,.14);border-radius:16px;overflow:hidden;margin:12px 0 6px;background:#0E1B16}
    .ai-code-h{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#13251E;color:#9CC9B8;font-size:11.5px}
    .ai-code-h .lg{font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:800;color:#5FE6BD;text-transform:lowercase;letter-spacing:.04em}
    .ai-code-h .ln{color:#5E7A70;font-size:10.5px;margin-right:auto}
    .ai-code-h .cp{border:0;background:rgba(47,191,143,.14);color:#5FE6BD;width:30px;height:28px;border-radius:9px;cursor:pointer;font-size:13px;display:grid;place-items:center}
    .ai-code-h .cp:active{transform:scale(.92)}
    .ai-code pre{margin:0;padding:13px 14px;overflow-x:auto;-webkit-overflow-scrolling:touch;font-size:12.5px;line-height:1.62}
    .ai-code pre code{font-family:ui-monospace,Menlo,Consolas,monospace;color:#D8F3E6;white-space:pre}
    /* Actions row (context-aware, never generic) */
    .ai-rax{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0 2px}
    .ai-rax button{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(15,107,79,.18);background:var(--ai-card,#fff);color:#0E6B4F;border-radius:99px;padding:8px 13px;font-size:12.5px;font-weight:750;cursor:pointer;box-shadow:0 2px 8px rgba(23,58,43,.05);transition:transform .12s ease,background .15s ease}
    .ai-rax button span{font-size:13.5px}
    .ai-rax button:active{transform:scale(.95);background:var(--ai-mint,#EFF7F2)}
    /* AI responses always render fully expanded. */
    /* callout additions */
    .ai-callout.critical{background:rgba(220,38,38,.07);border-color:rgba(220,38,38,.25)}
    .ai-callout.critical b{color:#b3261e}
    .ai-callout.detail{background:rgba(59,130,246,.06);border-color:rgba(59,130,246,.2)}
    .ai-callout.detail b{color:#1d4ed8}
    .ai-callout.take{background:rgba(16,185,129,.07);border-color:rgba(16,185,129,.24)}
    .ai-callout.take b{color:#047857}
    .ai-callout.sum{background:rgba(168,85,247,.06);border-color:rgba(168,85,247,.2)}
    .ai-callout.sum b{color:#7c3aed}
    /* dark theme */
    .ai-agent-root[data-theme=dark] .ai-twrap,.ai-agent-root[data-theme=dark] .ai-cmp,.ai-agent-root[data-theme=dark] .ai-kpi,.ai-agent-root[data-theme=dark] .ai-code{background:#13201A}
    .ai-agent-root[data-theme=dark] .ai-twrap .ai-rb-tab.twide td:first-child{background:#13201A}
    .ai-agent-root[data-theme=dark] .ai-twrap .ai-rb-tab th,.ai-agent-root[data-theme=dark] .ai-cmp-hed{background:#0F1714}
    .ai-agent-root[data-theme=dark] .ai-step .n{background:rgba(47,191,143,.16);color:#5FE6BD;border-color:rgba(47,191,143,.3)}
    .ai-agent-root[data-theme=dark] .ai-rb-q{background:#122019}
    @media (min-width:680px){
      .ai-kpis{grid-template-columns:repeat(3,1fr)}
      .ai-cmp-hed,.ai-cmp-row{grid-template-columns:1.2fr 1fr 1fr}
      .ai-flow{flex-direction:row;align-items:stretch}
      .ai-flow .ar{display:grid;place-items:center;padding:0 4px}
      .ai-flow .nd{align-self:center}
    }
    @media (prefers-reduced-motion:reduce){.ai-cmp .c .bar i{animation:none}.ai-kpi{animation:none}}

    /* ── quiz engine v2 ── */
    .ai-quiz2{border:1.5px solid rgba(15,107,79,.14);border-radius:var(--r-l);overflow:hidden;background:var(--ai-card,#fff);margin:9px 0 2px;box-shadow:0 14px 34px rgba(23,58,43,.08)}
    .qz-head{display:flex;align-items:center;gap:9px;padding:12px 14px;background:linear-gradient(135deg,#E4F3EC,var(--ai-card,#fff));border-bottom:1px solid var(--ai-line,rgba(15,107,79,.1))}
    .qz-ico{width:30px;height:30px;flex:0 0 auto;border-radius:10px;display:grid;place-items:center;background:linear-gradient(140deg,#DDF3E8,#E7F6EF);font-size:15px}
    .qz-ht{min-width:0;flex:1}
    .qz-ht b{display:block;font-size:13.5px;color:#0E6B4F}
    .qz-ht span{font-size:11px;color:var(--ai-sub,#5F7A72)}
    .qz-t{font-size:11px;font-weight:800;color:#0E6B4F;background:var(--ai-mint,#E4F3EC);padding:3px 8px;border-radius:99px;font-variant-numeric:tabular-nums}
    .qz-body{padding:13px 14px 14px}
    .qz-bar{height:6px;border-radius:99px;background:rgba(15,107,79,.09);overflow:hidden}
    .qz-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#2FB98A,#0E6B4F);transition:width .3s ease}
    .qz-bar.big{height:9px;margin:12px 0}
    .qz-dots{display:flex;gap:5px;margin-top:9px;flex-wrap:wrap}
    .qz-dots i{width:7px;height:7px;border-radius:50%;background:rgba(15,107,79,.16);transition:transform .15s ease}
    .qz-dots i.done{background:rgba(15,107,79,.45)}
    .qz-dots i.on{background:#0E6B4F;transform:scale(1.25)}
    .qz-q{font-size:15px;font-weight:700;line-height:1.65;margin:12px 0 10px}
    .qz-tag{display:inline-block;margin-left:6px;font-size:10px;font-weight:700;color:var(--ai-sub);background:var(--ai-mint,#EFF7F2);border:1px solid var(--ai-line,rgba(15,107,79,.12));padding:1px 7px;border-radius:99px;vertical-align:middle}
    .qz-opts{display:flex;flex-direction:column;gap:8px}
    .qz-opt{display:flex;align-items:center;gap:10px;text-align:left;border:1.5px solid var(--ai-line,rgba(15,107,79,.18));background:var(--ai-card,#fff);color:var(--ai-ink,#16302A);border-radius:13px;padding:10px 12px;font:600 13.5px/1.5 inherit;cursor:pointer;transition:border-color .18s,background .18s,transform .12s ease;width:100%}
    .qz-opt:active{transform:scale(.985)}
    .qz-opt:hover{border-color:rgba(18,128,90,.4)}
    .qz-dot{width:22px;height:22px;flex:0 0 auto;border-radius:50%;display:grid;place-items:center;font:800 11px inherit;color:#0E6B4F;background:var(--ai-mint,#E4F3EC);border:1px solid rgba(15,107,79,.2)}
    .qz-opt.sel{border-color:#0E6B4F;background:rgba(14,107,79,.06);box-shadow:0 0 0 3px rgba(14,107,79,.08)}
    .qz-opt.sel .qz-dot{background:#0E6B4F;color:#fff}
    .qz-opt.ok{border-color:rgba(21,128,61,.55);background:rgba(34,197,94,.09)}
    .qz-opt.ok .qz-dot{background:#15803d;color:#fff}
    .qz-opt.no{border-color:rgba(185,28,28,.45);background:rgba(220,38,38,.07);color:#9f1239}
    .qz-opt.no .qz-dot{background:#b91c1c;color:#fff}
    .qz-opt:disabled{cursor:default;opacity:.92}
    .qz-chk{margin-left:auto;font-style:normal;font-weight:800;color:#15803d}
    .qz-fb{border-radius:var(--r-m);padding:11px 13px;margin-top:11px;font-size:13px;line-height:1.65;animation:aiIn .22s ease both}
    .qz-fb.good{background:rgba(34,197,94,.09);border:1px solid rgba(34,197,94,.26);color:#14532d}
    .qz-fb.bad{background:rgba(220,38,38,.06);border:1px solid rgba(220,38,38,.2);color:#7f1d1d}
    .qz-fb b{display:block;margin-bottom:4px}
    .qz-fb-row{font-size:12.5px;margin:3px 0;color:var(--ai-ink,#16302A)}
    .qz-fb-row u{text-decoration-color:rgba(185,28,28,.5)}
    .qz-nav{display:flex;gap:8px;margin-top:13px}
    .qz-back,.qz-next{flex:1;border:0;border-radius:12px;padding:11px;font:700 13px inherit;cursor:pointer;transition:transform .12s ease,opacity .15s}
    .qz-back{background:var(--ai-mint,#E4F3EC);color:#0E6B4F;border:1px solid var(--ai-line,rgba(15,107,79,.18))}
    .qz-next{background:linear-gradient(135deg,#12805A,#0E5F45);color:#fff;box-shadow:0 6px 16px rgba(14,95,69,.25)}
    .qz-back:disabled,.qz-next:disabled{opacity:.4;cursor:not-allowed;box-shadow:none}
    .qz-next:active:not(:disabled){transform:scale(.97)}
    .qz-cfg{padding:13px 14px 14px}
    .qz-ext{margin-bottom:4px}
    .qz-ext-l{font-size:10.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--ai-sub);display:block;margin-bottom:6px}
    .qz-locks{display:flex;flex-wrap:wrap;gap:6px}
    .qz-lock{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(15,107,79,.22);background:var(--ai-mint,#E4F3EC);color:#0E6B4F;border-radius:99px;padding:4px 10px;font:700 11.5px inherit;cursor:pointer}
    .qz-lock i{font-style:normal;font-size:10px;opacity:.6}
    .qz-f{margin-top:12px}
    .qz-fl{font-size:11.5px;font-weight:800;color:var(--ai-ink,#16302A);margin-bottom:7px}
    .qz-fl i{font-style:normal;font-weight:600;color:var(--ai-sub);font-size:10px}
    .qz-pills{display:flex;flex-wrap:wrap;gap:7px}
    .qz-pill{border:1.5px solid var(--ai-line,rgba(15,107,79,.2));background:none;color:var(--ai-ink,#16302A);border-radius:11px;padding:8px 13px;font:700 12.5px inherit;cursor:pointer;transition:all .15s ease}
    .qz-pill.on{background:#0E6B4F;border-color:#0E6B4F;color:#fff;box-shadow:0 4px 12px rgba(14,107,79,.25)}
    .qz-pill:active{transform:scale(.94)}
    .qz-pill.qz-others.on{background:linear-gradient(135deg,#7C3AED,#5B21B6);border-color:#5B21B6;box-shadow:0 4px 12px rgba(91,33,182,.25)}
    .qz-cst{display:flex;gap:7px;margin-top:9px}
    .qz-in{flex:1;min-width:0;border:1.5px solid var(--ai-line,rgba(15,107,79,.25));border-radius:11px;padding:9px 12px;font:600 13px inherit;color:var(--ai-ink,#16302A);background:var(--ai-card,#fff)}
    .qz-in:focus{outline:0;border-color:rgba(18,128,90,.55);box-shadow:0 0 0 3px rgba(18,128,90,.1)}
    .qz-add{border:0;border-radius:11px;background:#0E6B4F;color:#fff;width:42px;font-size:17px;cursor:pointer}
    .qz-steppers{display:flex;align-items:center;gap:9px;margin-top:9px}
    .qz-step{width:36px;height:36px;border-radius:10px;border:1.5px solid var(--ai-line,rgba(15,107,79,.25));background:none;color:#0E6B4F;font-size:16px;font-weight:800;cursor:pointer}
    .qz-stepv{min-width:54px;text-align:center;font:800 14px inherit;color:var(--ai-ink,#16302A);font-variant-numeric:tabular-nums}
    .qz-note{font-size:10.5px;color:var(--ai-sub,#5F7A72);margin-top:10px;display:flex;align-items:center;gap:5px}
    .qz-lead{font-size:12px;color:var(--ai-sub,#5F7A72);margin-bottom:9px;line-height:1.6}
    .qz-acts-t .ghost{background:var(--ai-mint,#E4F3EC);color:#0E6B4F;border:1.5px solid var(--ai-line,rgba(15,107,79,.2))}
    .qz-acts-t .solid{background:linear-gradient(135deg,#12805A,#0E5F45);color:#fff;box-shadow:0 6px 16px rgba(14,95,69,.25)}
    .qz-gen{display:block;width:100%;margin-top:13px;border:0;border-radius:13px;background:linear-gradient(135deg,#12805A,#0E5F45);color:#fff;font:800 14px inherit;padding:13px;cursor:pointer;box-shadow:0 8px 20px rgba(14,95,69,.28);transition:transform .12s ease}
    .qz-gen:active{transform:scale(.98)}
    .qz-gen:disabled{opacity:.45;box-shadow:none;cursor:not-allowed}
    .qz-summ{background:var(--ai-mint,#F0F8F4);border:1px dashed rgba(15,107,79,.25);border-radius:var(--r-m);padding:11px 13px;margin-top:4px}
    .qz-summ-row{display:flex;justify-content:space-between;gap:10px;font-size:12.5px;margin:4px 0}
    .qz-summ-row span{color:var(--ai-sub)}
    .qz-summ-row b{text-align:right}
    .qz-acts-t{display:flex;gap:8px;margin-top:12px}
    .qz-acts-t button{flex:1;border-radius:12px;padding:11px;font:700 12.5px inherit;cursor:pointer;border:0}
    .qz-steps{padding:6px 2px}
    .qz-step-row{display:flex;align-items:center;gap:9px;padding:9px 4px;font-size:13px;color:var(--ai-sub)}
    .qz-step-row .st{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:800;background:rgba(15,107,79,.1);color:#0E6B4F}
    .qz-step-row.done .st{background:#0E6B4F;color:#fff}
    .qz-step-row.done{color:var(--ai-ink)}
    .qz-spin{margin-left:auto;width:14px;height:14px;border-radius:50%;border:2px solid rgba(15,107,79,.2);border-top-color:#0E6B4F;animation:aiSpin .7s linear infinite}
    @keyframes aiSpin{to{transform:rotate(360deg)}}
    .qz-res{text-align:center}
    .qz-ring{width:124px;height:124px;margin:6px auto 4px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(#0E6B4F calc(var(--p)*1%),rgba(15,107,79,.1) 0);position:relative}
    .qz-ring:before{content:'';position:absolute;inset:10px;border-radius:50%;background:var(--ai-card,#fff)}
    .qz-ring b,.qz-ring span{position:relative;z-index:1}
    .qz-ring b{font-size:24px;color:#0E6B4F}
    .qz-ring span{font-size:11px;color:var(--ai-sub);font-weight:700}
    .qz-marks{font-size:12px;color:var(--ai-sub);margin-top:4px}
    .qz-cstats{display:flex;justify-content:center;gap:14px;flex-wrap:wrap;margin:12px 0 4px;font-size:12px;font-weight:700}
    .qz-cstats .ok{color:#15803d}.qz-cstats .no{color:#b91c1c}.qz-cstats .na{color:var(--ai-sub)}
    .qz-top{margin-top:12px;text-align:left}
    .qz-top-row{margin:8px 0}
    .qz-top-row .lbl{display:flex;justify-content:space-between;font-size:12px;font-weight:700;color:var(--ai-ink,#16302A)}
    .qz-top-row .tr{height:6px;border-radius:99px;background:rgba(15,107,79,.1);margin-top:4px;overflow:hidden}
    .qz-top-row .fl{height:100%;border-radius:99px}
    .qz-top-row.good .fl{background:linear-gradient(90deg,#2FB98A,#0E6B4F)}
    .qz-top-row.mid .fl{background:linear-gradient(90deg,#EAB308,#CA8A04)}
    .qz-top-row.weak .fl{background:linear-gradient(90deg,#F87171,#B91C1C)}
    .qz-insight{background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.18);border-radius:var(--r-m);padding:11px 13px;margin-top:12px;text-align:left}
    .qz-insight b{color:#4f46e5;font-size:12.5px}
    .qz-insight p{font-size:12.5px;line-height:1.7;color:var(--ai-ink,#16302A);margin-top:5px}
    .qz-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}
    .qz-acts button{flex:1 1 45%;border-radius:12px;padding:11px;font:700 12.5px inherit;cursor:pointer}
    .qz-acts .solid{border:0;background:linear-gradient(135deg,#12805A,#0E5F45);color:#fff;box-shadow:0 6px 16px rgba(14,95,69,.22)}
    .qz-acts .ghost{border:1.5px solid var(--ai-line,rgba(15,107,79,.25));background:none;color:#0E6B4F}
    .qz-acts button:active{transform:scale(.97)}
    .qz-confirm{text-align:center;padding:8px 6px}
    .qz-confirm h3{margin:4px 0 10px;font-size:15px;color:var(--ai-ink,#16302A)}
    .qz-cstats.qz-conf{flex-direction:column;gap:6px;align-items:center}
    .ai-agent-root[data-theme=dark] .qz-head{background:linear-gradient(135deg,#0d2f24,#152e26)}
    .ai-agent-root[data-theme=dark] .qz-ico{background:rgba(47,191,143,.15)}
    .ai-agent-root[data-theme=dark] .qz-opt{background:#132a22}
    .ai-agent-root[data-theme=dark] .qz-in{background:#132a22}
    .ai-agent-root[data-theme=dark] .qz-summ{background:rgba(15,107,79,.1)}
    .ai-agent-root[data-theme=dark] .qz-fb.good{background:rgba(34,197,94,.12)}
    .ai-agent-root[data-theme=dark] .qz-fb.bad{background:rgba(220,38,38,.14)}
    .ai-agent-root[data-theme=dark] .qz-ring:before{background:#122019}

    .ai-drawerback{position:fixed;inset:0;z-index:90;background:rgba(8,24,18,.45);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);animation:aiFade .2s ease}
    .ai-drawer{position:absolute;top:0;bottom:0;left:0;width:min(320px,86vw);background:var(--ai-card,#fff);color:var(--ai-ink,#16302A);padding:14px 14px calc(16px + env(safe-area-inset-bottom));overflow-y:auto;box-shadow:24px 0 60px rgba(8,24,18,.25);animation:aiDrawer .28s cubic-bezier(.2,.8,.3,1) both;border-radius:0 20px 20px 0}
    @keyframes aiDrawer{from{transform:translateX(-16%);opacity:.4}to{transform:none;opacity:1}}
    .ai-dr-head{display:flex;align-items:center;gap:10px;padding-bottom:11px;border-bottom:1px solid var(--ai-line,rgba(15,107,79,.1))}
    .ai-dr-head .ai-orb.small{width:34px;height:34px;animation:none}
    .ai-dr-head .x{margin-left:auto;border:0;background:none;color:var(--ai-sub);font-size:19px;cursor:pointer;width:32px;height:32px;border-radius:9px}
    .ai-dr-head .x:active{transform:scale(.92)}
    .ai-dr-t{min-width:0}
    .ai-dr-t b{display:block;font-size:14.5px}
    .ai-dr-t span{font-size:11px;color:var(--ai-sub)}
    .ai-dr-acts{display:flex;flex-direction:column;gap:2px;margin-top:10px}
    .ai-dr-acts button{display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:0;background:none;color:var(--ai-ink,#16302A);padding:10px 10px;border-radius:12px;font:600 13.5px inherit;cursor:pointer}
    .ai-dr-acts button b{font-weight:700}
    .ai-dr-acts button .hint{font-size:10.5px;color:var(--ai-sub);margin-left:auto;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46%}
    .ai-dr-acts button:hover{background:var(--ai-mint,#EFF7F2)}
    .ai-dr-note{font-size:10.5px;color:var(--ai-sub);padding:0 10px 8px}
    .ai-dr-lbl{font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ai-sub);padding:12px 10px 5px}
    .ai-dr-list{display:flex;flex-direction:column;gap:1px;max-height:38vh;overflow-y:auto}
    .ai-recent{display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:11px;cursor:pointer;font-size:13px}
    .ai-recent:hover{background:var(--ai-mint,#EFF7F2)}
    .ai-recent.on{background:var(--ai-mint,#E4F3EC);font-weight:700}
    .ai-recent .ic{font-size:12px}
    .ai-recent .nm{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ai-recent .ts{font-size:10.5px;color:var(--ai-sub);flex:0 0 auto}
    .ai-recent .rs{border:0;background:none;color:var(--ai-sub);font-size:14px;cursor:pointer;padding:2px 5px;border-radius:7px}
    .ai-recent .rs:hover{background:rgba(15,107,79,.1)}
    .ai-dr-empty{font-size:12.5px;color:var(--ai-sub);padding:8px 10px}
    .ai-dr-themes{display:flex;gap:6px;padding:2px 10px}
    .ai-dr-themes button{flex:1;border:1px solid var(--ai-line,rgba(15,107,79,.16));background:none;color:var(--ai-ink,#16302A);border-radius:10px;padding:8px 4px;font:600 11.5px inherit;cursor:pointer}
    .ai-dr-themes button:hover{background:var(--ai-mint,#EFF7F2)}
    .ai-dr-themes button{display:flex;align-items:center;justify-content:center;gap:4px;padding:8px 2px;font-size:10.5px}
    .ai-dr-themes button span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:64px}
    .ai-dr-themes button.on{background:var(--ai-primary,#0E6B4F);color:#fff;border-color:var(--ai-primary,#0E6B4F)}
    .ai-agent-root :focus-visible:not(.ai-editor){outline:2px solid var(--ai-primary,#0E6B4F);outline-offset:2px;border-radius:8px}
    /* The capsule already exposes focus with :focus-within; suppress iOS's
       rectangular contenteditable ring so the composer has one clean frame. */
    .ai-agent-root .ai-editor:focus-visible{outline:0!important;outline-offset:0!important;border:0!important;box-shadow:none!important}
    .ai-u-fold{list-style:none}
    .ai-u-fold summary{display:block;cursor:pointer;font-weight:600}
    .ai-u-fold summary::-webkit-details-marker{display:none}
    .ai-u-fold summary em{font-style:normal;color:var(--ai-primary,#0E6B4F);font-size:12px;white-space:nowrap}
    .ai-u-fold div{margin-top:8px;white-space:pre-wrap;word-break:break-word}
    .qz-rfrow{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
    .qz-rf{border:1px solid var(--ai-line,rgba(15,107,79,.16));background:var(--ai-card,#fff);color:var(--ai-ink,#16302A);border-radius:99px;padding:5px 12px;font:600 11.5px inherit;cursor:pointer}
    .qz-rf.on{background:var(--ai-primary,#0E6B4F);color:#fff;border-color:var(--ai-primary,#0E6B4F)}
    .qz-tstats{display:flex;gap:14px;justify-content:center;margin:10px 0 2px;font-size:12px;color:var(--ai-sub,#5F7A72)}
    .qz-tstats b{color:var(--ai-ink,#16302A);font-variant-numeric:tabular-nums}
    @media (hover:hover){.ai-msg .ai-msg-bar{opacity:.55;transition:opacity .18s ease}.ai-msg:hover .ai-msg-bar,.ai-msg:focus-within .ai-msg-bar{opacity:1}}
    .ai-dr-foot{margin-top:10px;border-top:1px solid var(--ai-line,rgba(15,107,79,.1));padding-top:6px}
    .ai-dr-foot button{display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:0;background:none;color:var(--ai-ink,#16302A);padding:8px 10px;border-radius:10px;font:600 12.5px inherit;cursor:pointer}
    .ai-dr-foot button:hover{background:var(--ai-mint,#EFF7F2)}
    .ai-dr-foot .danger{color:#B23B48}
    .ai-agent-root[data-theme=dark] .ai-dr-themes button{border-color:rgba(47,191,143,.22)}
    /* ── legacy menu (অটুট নয়, নিরাপত্তা) ── */
    .ai-menu{position:absolute;top:52px;right:12px;z-index:70;min-width:210px;padding:7px;background:var(--ai-card,#fff);border:1px solid var(--ai-line,rgba(15,107,79,.16));border-radius:var(--r-card);box-shadow:0 18px 44px rgba(23,58,43,.2);animation:aiIn .16s ease both;color:var(--ai-ink,#16302A)}
    .ai-menu .lbl{font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ai-sub,#5F7A72);padding:8px 10px 4px}
    .ai-menu button{display:flex;align-items:center;gap:9px;width:100%;text-align:left;padding:9px 10px;border-radius:10px;background:none;border:0;color:var(--ai-ink,#16302A);font:600 13px inherit;cursor:pointer}
    .ai-menu button:hover{background:var(--ai-mint,#EFF7F2)}
    .ai-menu button.danger{color:#B23B48}
    .ai-searchbar{position:absolute;top:0;left:0;right:0;z-index:65;background:var(--ai-bg,#F7F9F8);padding:10px 14px;display:flex;gap:9px;align-items:center;border-bottom:1px solid var(--ai-line,rgba(15,107,79,.12));animation:aiIn .18s ease;color:var(--ai-ink,#16302A)}
    .ai-searchbar input{flex:1;border:1px solid var(--ai-line,rgba(15,107,79,.2));border-radius:var(--r-pill);background:var(--ai-card,#fff);padding:10px 14px;font:inherit;font-size:14px;outline:0;color:var(--ai-ink,#16302A)}
    .ai-searchbar button{border:0;background:none;font-size:13px;font-weight:700;color:#0E6B4F;cursor:pointer}
    .ai-fb-sheet{padding:8px 4px}
    .ai-fb-opt{display:flex;align-items:center;gap:10px;width:100%;border:1px solid var(--ai-line,rgba(15,107,79,.14));background:var(--ai-card,#fff);color:var(--ai-ink,#16302A);border-radius:var(--r-m);padding:12px 13px;font:600 13.5px inherit;cursor:pointer;margin-bottom:8px}
    .ai-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:80;background:#0E2A20;color:#D8F3E6;padding:10px 16px;border-radius:var(--r-pill);font-size:12.5px;font-weight:700;box-shadow:0 10px 30px rgba(0,0,0,.25);animation:aiIn .2s ease}
    @media(max-width:430px){.ai-msg-body{font-size:16px;line-height:1.8}}
    @media(prefers-reduced-motion:reduce){.ai-orb,.ai-hero-orb .big,.ai-hero-orb .ring,.ai-hero-orb .ring2,.ai-hero-orb .p1,.ai-hero-orb .p2,.ai-hero-orb .p3,.ai-think .ob,.ai-mic.rec{animation:none!important}.ai-msg,.ai-hero,.ai-notice,.ai-sheet,.ai-think{animation:none!important}}`;
  document.head.appendChild(style);

  /* ── state ── */
  let msgs = [];
  let activeReq = null;
  let streamingEl = null;
  let stoppedEarly = false;
  let speakBusy = false;
  let attachOpen = false;
  let menuOpen = false;
  let searchOpen = false;
  let feedbackTarget = -1;
  let attachments = [];
  let voiceState = null; /* {rec, timer, chunks, start} */
  const mkSession = (nm, arr) => ({ id: Date.now() + Math.random().toString(36).slice(2, 6), name: nm || '', msgs: (arr || []).slice(-MAX_MSGS), pin: 0, ts: Date.now() });
  let sessions = [mkSession('', [])];
  let cur = 0;
  let aiUnread = 0;
  let aiPinned = true;
  let accountScope = '';
  let theme = 'light';

  const scopedKey = key => accountScope ? `${key}:account:${accountScope}` : '';
  const scopedRead = key => {
    if (!accountScope) return null;
    try { return localStorage.getItem(scopedKey(key)); } catch (_) { return null; }
  };
  const scopedWrite = (key, value) => {
    if (!accountScope) return false;
    try { localStorage.setItem(scopedKey(key), String(value)); return true; } catch (_) { return false; }
  };
  const loadScopedAiState = () => {
    sessions = [mkSession('', [])]; cur = 0;
    if (accountScope) {
      try {
        const raw = JSON.parse(scopedRead(STORE) || '[]');
        if (Array.isArray(raw) && raw.length) sessions = [mkSession(scopedRead(NAME_KEY) || '', raw)];
        else if (raw && raw.v === 2 && Array.isArray(raw.list) && raw.list.length) {
          sessions = raw.list; cur = Math.min(+raw.cur || 0, sessions.length - 1);
        }
      } catch (_) { sessions = [mkSession('', [])]; cur = 0; }
    }
    msgs = sessions[cur].msgs;
    const savedTheme = scopedRead(THEME_KEY);
    theme = THEMES[savedTheme] ? savedTheme : 'light';
  };

  // Remove the legacy shared-device chat keys once. They were not bound to a
  // Firebase UID and must never leak into a newly signed-in account.
  try { [STORE, NAME_KEY, THEME_KEY, NOTICE_KEY, FEED_KEY, 'ahAiGuestV1'].forEach(key => localStorage.removeItem(key)); } catch (_) {}

  window.addEventListener('admissionhub:authchange', event => {
    const detail = event?.detail || {};
    const nextScope = detail.authenticated === true && /^[A-Za-z0-9_-]{8,128}$/.test(String(detail.user?.id || ''))
      ? String(detail.user.id)
      : '';
    if (nextScope === accountScope) return;
    if (accountScope) {
      try { sessions[cur].msgs = msgs.slice(-MAX_MSGS); scopedWrite(STORE, JSON.stringify({ v: 2, list: sessions, cur })); } catch (_) {}
    }
    accountScope = nextScope;
    guestMemo = '';
    loadScopedAiState();
    if (document.getElementById('aiRoot')) render();
  });

  const esc = (s) => { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; };
  let guestMemo = '';
  const guestId = () => {
    if (guestMemo) return guestMemo;
    try { guestMemo = crypto.randomUUID(); }
    catch (_) {
      const bytes = new Uint8Array(18);
      try { crypto.getRandomValues(bytes); } catch (_) { for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256); }
      guestMemo = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    return guestMemo;
  };
  const localStats = () => {
    try {
      if (typeof computeLifetimeStats !== 'function') return null;
      const s = computeLifetimeStats();
      return {
        exams: Number(s.exams || 0), questions: Number(s.totalQuestions || s.attempted || 0),
        accuracy: Number(s.accuracy || 0), streak: typeof computeStreak === 'function' ? Number(computeStreak() || 0) : 0,
        mistakes: typeof CACHE !== 'undefined' && Array.isArray(CACHE.mistakes) ? CACHE.mistakes.length : Number(s.wrong || 0)
      };
    } catch (_) { return null; }
  };
  const save = () => { if (!accountScope) return; try { sessions[cur].msgs = msgs.slice(-MAX_MSGS); sessions[cur].ts = Date.now(); scopedWrite(STORE, JSON.stringify({ v: 2, list: sessions, cur: cur })); } catch (_) {} };
  const curTitle = () => (sessions[cur] && sessions[cur].name ? sessions[cur].name : T.title);
  const fmtDay = (ts) => { try { const d = new Date(ts), n = new Date(); return d.toDateString() === n.toDateString() ? fmtTime(ts) : d.toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-US', { day: 'numeric', month: 'short' }); } catch (_) { return ''; } };
  const fmtTime = (ts) => { try { return new Date(ts).toLocaleTimeString(lang === 'bn' ? 'bn-BD' : 'en-US', { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const toast = (m) => { const old = document.querySelector('.ai-toast'); if (old) old.remove(); const el = document.createElement('div'); el.className = 'ai-toast'; el.textContent = m; document.body.appendChild(el); setTimeout(() => el.remove(), 2300); };

  /* ── markdown-lite v3 (escape-first; heading/para/bullets/num/code/formula/tip/example/warn/table/links) ── */
  function md(html) {
    const codeBlocks = [];
    const extra = [];
    const put = (h) => { extra.push(h); return '\u0000DX' + (extra.length - 1) + '\u0000'; };
    html = html.replace(/```([\s\S]*?)```/g, (m, c) => { codeBlocks.push(c); return '\u0000CB' + (codeBlocks.length - 1) + '\u0000'; });
    html = html.replace(/((?:^\|.*\|\s*$\n?)+)/gm, (block) => {
      const rows = block.trim().split('\n').map((r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      if (rows.length < 2) return block;
      const head = rows[0]; let out = '<table><thead><tr>' + head.map((c) => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>';
      for (const r of rows.slice(1)) { if (r.length === 1 && /^:?-{2,}:?$/.test(r[0])) continue; out += '<tr>' + r.map((c) => '<td>' + c + '</td>').join('') + '</tr>'; }
      return out + '</tbody></table>';
    });
    let defLine = '';
    if (html.length < 520) {
      const dm = html.match(/^(?:[^\n]{0,44}?)(?:হলো|হল|মানে|বলে|কে বোঝায়|definition|means|is the)[^\n]{0,210}/i);
      if (dm && dm[0] && dm[0].length <= 240) { defLine = dm[0]; html = html.slice(dm[0].length).replace(/^\n+/, ''); }
    }
    /* ── ডেটা: ৩+ লাইন 'নাম: NN%' → বার-চার্ট ── */
    html = html.replace(/((?:^[^\n]{1,30}?[:：]\s*[\d০-৯]{1,3}(?:[.,][\d০-৯]+)?\s*%\s*\n){3,})/gm, (block) => {
      const bnD = { '০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9' };
      const toEn = (x) => String(x).replace(/[০-৯]/g, (d) => bnD[d]).replace(/,/g, '.');
      const rows = block.trim().split('\n').map((r) => { const mm = r.match(/^\s*(.{1,28}?)\s*[:：]\s*([\d০-৯]{1,3}(?:[.,][\d০-৯]+)?)\s*%\s*$/); return mm ? [mm[1], Math.max(0, Math.min(100, parseFloat(toEn(mm[2]))))] : null; }).filter(Boolean);
      if (rows.length < 3) return block;
      return put('<div class="ai-stats">' + rows.map((r) => '<div class="ai-stat"><div class="lbl"><span>' + r[0] + '</span><span class="v">' + r[1] + '%</span></div><div class="tr"><div class="fl" style="width:' + r[1] + '%"></div></div></div>').join('') + '</div>') + '\n';
    });
    /* ── টাইমলাইন: ৩+ লাইন 'YYYY — বিবরণ' ── */
    html = html.replace(/((?:^[^\n]*[\d০-৯]{3,4}\s*[–—-]\s*[^\n]*\n|^[ \t]*\n){3,})/gm, (block) => {
      const items = block.trim().split('\n').map((r) => { const mm = r.match(/^\s*([\d০-৯]{3,4})\s*[–—-]\s*(.+)$/); return mm ? [mm[1], mm[2].trim()] : null; }).filter(Boolean);
      if (items.length < 3) return block;
      return put('<div class="ai-timeline">' + items.map((it) => '<div class="ai-tl"><div class="yr">' + it[0] + '</div><div class="ds">' + it[1] + '</div></div>').join('') + '</div>') + '\n';
    });
    /* ── চেকলিস্ট ── */
    html = html.replace(/((?:^[*+-]\s*\[[ xX]\]\s*[^\n]*\n?)+)/gm, (block) => {
      const items = block.trim().split('\n').map((r) => { const mm = r.match(/^\s*[*+-]\s*\[([ xX])\]\s*(.+)$/); return mm ? [mm[1].toLowerCase() === 'x' ? 1 : 0, mm[2]] : null; }).filter(Boolean);
      if (!items.length) return block;
      return put('<ul class="ai-checklist">' + items.map((it) => '<li class="' + (it[0] ? 'done' : '') + '"><span class="bx">' + (it[0] ? '✓' : '') + '</span><span>' + it[1] + '</span></li>').join('') + '</ul>') + '\n';
    });
    let s = html
      .replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>')
      .replace(/^([✅📌🧠📚💡⚠️])?\s*(.*)$/gm, (m, ic, txt) => {
        if (!ic || !txt.trim()) return m;
        const map = { '✅': ['success', '✅'], '📌': ['keypoint', '📌'], '🧠': ['concept', '🧠'], '📚': ['revision', '📚'], '💡': ['tip', '💡'], '⚠️': ['warn', '⚠️'] };
        const k = map[ic]; if (!k) return m;
        return '<div class="ai-callout ' + k[0] + '"><b>' + k[1] + '</b> ' + txt + '</div>';
      })
      .replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
      .replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>').replace(/^\s*\d+\. (.*)$/gm, '<li>$1</li>')
      .replace(/(?:<li>[\s\S]*?<\/li>)(?=(?:<li>|$))/g, (m) => '<ul>' + m + '</ul>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\$\$([\s\S]+?)\$\$/g, '<div class="ai-formula">$1</div>')
      .replace(/\$([^$\n]+)\$/g, '<span class="ai-math-inline">$1</span>')
      .replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
      .replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
    s = '<div class="ai-msg-body">' + (s.includes('<p>') ? s : '<p>' + s + '</p>') + '</div>';
    if (defLine) s = s.replace('<div class="ai-msg-body">', '<div class="ai-msg-body"><div class="ai-callout define"><b>🧠 ' + esc(T.defLbl) + '</b> ' + defLine.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>') + '</div>');
    s = s.replace(/<table>/g, '<div class="ai-twrap"><table>').replace(/<\/table>/g, '</table></div>');
    return s.replace(/\u0000CB(\d+)\u0000/g, (m, i) => '<pre><code>' + esc(codeBlocks[+i]).replace(/\n$/, '') + '</code></pre>').replace(/\u0000DX(\d+)\u0000/g, (m, i) => extra[+i]);
  }


  /* ═══════════ Universal Dynamic Response Engine v1 (v218) ═══════════
     AI raw text → typed blocks → whitelisted component registry → escaped DOM.
     RULES:
       (1) NO FAKE DATA — every visual/number comes from the AI text itself.
       (2) NO RAW HTML — all content passes esc(); unknown type → clean text.
       (3) NO OVER-FORMAT — short/simple text stays plain (e.g. "2+2 → 4").
       (4) INPUT ISOLATION — renderer touches only #aiAgentBody; composer untouched.
  ─────────────────────────────────────────────────────────────────────── */
  const RB_TYPES = ['text','h','ul','ol','quote','table','stats','kpi','timeline','checklist','steps','flow','callout','compare','code'];
  const RB_RENDER = {};
  const RB_DI = { '\u09e6':'0','\u09e7':'1','\u09e8':'2','\u09e9':'3','\u09ea':'4','\u09eb':'5','\u09ec':'6','\u09ed':'7','\u09ee':'8','\u09ef':'9' };
  const rbNum = (x) => String(x).replace(/[\u09e6-\u09ef]/g, (d) => RB_DI[d]).replace(/,/g, '.').replace(/[^\d.]/g, '');
  const rbEsc = (x) => esc(String(x ?? ''));
  const rbInline = (x) => rbEsc(x)
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*\n]+)\*/g, '<i>$1</i>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  const rbCopy = (txt) => { try { const ta = document.createElement('textarea'); ta.value = String(txt || ''); ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('\u2713'); } catch (_) { toast('!'); } };

  /* ── intent: user text → intent key (bn+en) ── */
  const RB_INTENT = [
    ['learn', /(ব্যাখ্যা|বুঝিয়ে|শেখাও|বুঝাও|explain|teach|concept|মানে কি|কাকে বলে|কী জিনিস|what is|define|ধারণা)/i],
    ['calculate', /(হিসাব|কত হবে|যোগ|গুণ|ভাগ|calculate|sum|solve|ক্যালকুলেট)/i],
    ['code', /(কোড|code|python|javascript|function|প্রোগ্রাম|programming|ডিবাগ|debug|bug|error|regex)/i],
    ['compare', /(তুলনা|কোনটা ভালো|vs\.?|versus|difference|পার্থক্য|বনাম|compare)/i],
    ['decision', /(কোনটা (নেব|কিনব|বাছাই)|সিদ্ধান্ত|which (one|should)|recommend|পরামর্শ দাও|best for)/i],
    ['plan', /(পরিকল্পনা|plan|itinerary|ট্যুর|রুটিন|schedule|ভ্রমণ|সাজাও)/i],
    ['analyze', /(বিশ্লেষণ|analy|ডেটা|data|chart|গ্রাফ|graph|trend)/i],
    ['summarize', /(সংক্ষেপ|summary|summarize|মূল কথা|কিপয়েন্ট|key points)/i],
    ['troubleshoot', /(কাজ করছে না|ঠিক করো|fix|সমস্যা|troubleshoot|ভুল আসছে|error)/i],
    ['create', /(বানাও|লিখে দাও|rewrite|draft|email|চিঠি|গল্প|poem|কবিতা)/i],
    ['translate', /(অনুবাদ|translate)/i],
    ['search', /(খোঁজ|search|নিউজ|news|সর্বশেষ|আপডেট)/i]
  ];
  function rbIntent(txt) { const t = String(txt || ''); for (const [k, re] of RB_INTENT) if (re.test(t)) return k; return 'general'; }

  /* ── parser: raw text → ordered blocks (document order) ── */
  function respParse(text) {
    const src = String(text || '');
    const lines = src.split('\n');
    const out = [];
    let i = 0;
    const push = (b) => { out.push(b); };
    const isTbl = (l) => /^\|.*\|\s*$/.test(l.trim());
    const isPct = (l) => { const m = l.trim().match(/^(.{1,26}?)\s*[:：]\s*([\u09e6-\u09ef\d]{1,3}(?:[.,][\u09e6-\u09ef\d]+)?)\s*%\s*$/); return m ? m : null; };
    const isKpi = (l) => { const m = l.trim().match(/^(.{1,24}?)\s*[:：]\s*([\u09e6-\u09ef\d][\u09e6-\u09ef\d.,]*)(\s*(?:৳|টাকা|Tk|taka|GB|MB|দিব|দিন|বার|বারবার|জন|টি|টা|মিনিট|ঘণ্টা|কিমি|km|km\/h|kg|লিটার|লাখ|কোটি|হাজার|%,)?)\s*$/); return m && !isPct(l) && m[2].length <= 12 ? m : null; };
    const isYr = (l) => { const m = l.trim().match(/^([\u09e6-\u09ef\d]{3,4})\s*[–—-]\s*(.+)$/); return m ? m : null; };
    const isChk = (l) => { const m = l.trim().match(/^[-*+]\s*\[([ xX])\]\s*(.+)$/); return m ? m : null; };
    const isNum = (l) => { const m = l.trim().match(/^(\d{1,2})[.)]\s+(.+)$/); return m ? m : null; };
    const isBul = (l) => l.trim().match(/^[-*+]\s+(.+)$/);
    const txt = (lines) => lines.join('\n');
    while (i < lines.length) {
      const L = lines[i], t = L.trim();
      if (!t) { i++; continue; }
      /* code fence */
      if (/^```/.test(t)) {
        const lang = t.replace(/^```/, '').trim();
        i++; const cd = [];
        while (i < lines.length && !/^```/.test(lines[i].trim())) { cd.push(lines[i]); i++; }
        i++; push({ t: 'code', lang, code: cd.join('\n') }); continue;
      }
      /* markdown table */
      if (isTbl(L)) {
        const rows = [];
        while (i < lines.length && isTbl(lines[i])) { rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())); i++; }
        push({ t: 'table', rows }); continue;
      }
      /* % rows → stats */
      if (isPct(L)) {
        const rows = []; const raw = [];
        while (i < lines.length && isPct(lines[i])) { const m = isPct(lines[i]); rows.push([m[1], Math.max(0, Math.min(100, parseFloat(rbNum(m[2]))))]); raw.push(lines[i]); i++; }
        if (rows.length >= 3) push({ t: 'stats', rows }); else push({ t: 'text', txt: txt(raw) });
        continue;
      }
      /* kpi rows */
      if (isKpi(L)) {
        const rows = []; const raw = [];
        while (i < lines.length && isKpi(lines[i])) { const m = isKpi(lines[i]); rows.push([m[1], m[2], (m[3] || '').trim()]); raw.push(lines[i]); i++; }
        if (rows.length >= 3) push({ t: 'kpi', rows }); else push({ t: 'text', txt: txt(raw) });
        continue;
      }
      /* timeline */
      if (isYr(L)) {
        const items = []; const raw = [];
        while (i < lines.length && isYr(lines[i])) { const m = isYr(lines[i]); items.push([m[1], m[2].trim()]); raw.push(lines[i]); i++; }
        if (items.length >= 3) push({ t: 'timeline', items }); else push({ t: 'text', txt: txt(raw) });
        continue;
      }
      /* checklist */
      if (isChk(L)) {
        const items = []; const raw = [];
        while (i < lines.length && isChk(lines[i])) { const m = isChk(lines[i]); items.push([m[1].toLowerCase() === 'x' ? 1 : 0, m[2]]); raw.push(lines[i]); i++; }
        push({ t: 'checklist', items }); continue;
      }
      /* flow: arrow chain */
      if (/[→↓›>]/.test(t) && (t.match(/[→↓]/g) || []).length >= 1) {
        const nodes = [];
        while (i < lines.length && /[→↓›>]/.test(lines[i])) {
          const seg = lines[i].split(/\s*(?:→|↓|›|>)\s*/).map((x) => x.replace(/^[-*\s]+/, '').trim()).filter(Boolean);
          for (const n of seg) nodes.push(n);
          i++;
        }
        if (nodes.length >= 2) push({ t: 'flow', nodes }); else push({ t: 'text', txt: txt(nodes) });
        continue;
      }
      /* numbered → steps (3+) or ol (2+) */
      if (isNum(L)) {
        const items = []; const raw = [];
        while (i < lines.length && isNum(lines[i]) && !/^```/.test(lines[i].trim()) && !isTbl(lines[i]) && !isChk(lines[i])) { const m = isNum(lines[i]); items.push([m[2]]); raw.push(lines[i]); i++; }
        if (items.length >= 3) push({ t: 'steps', items }); else if (items.length === 2) push({ t: 'ol', items }); else push({ t: 'text', txt: txt(raw) });
        continue;
      }
      /* bullet list */
      if (isBul(L)) {
        const items = [];
        while (i < lines.length && isBul(lines[i]) && !isChk(lines[i])) { items.push(lines[i].trim().replace(/^[-*+]\s+/, '')); i++; }
        if (items.length >= 2) push({ t: 'ul', items }); else { push({ t: 'text', txt: txt(items) }); continue; }
        continue;
      }
      /* callout line */
      const cm = t.match(/^(✅|📌|🧠|📚|💡|⚠️|🔎|🚨|⚡|📝)\s*(.+)$/);
      if (cm) { push({ t: 'callout', icon: cm[1], txt: cm[2] }); i++; continue; }
      /* heading / quote / paragraph */
      if (/^#{1,3}\s+/.test(t)) { push({ t: 'h', lvl: t.match(/^#+/)[0].length, txt: t.replace(/^#+\s+/, '') }); i++; continue; }
      if (/^>\s?/.test(t)) { const q = []; while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++; } push({ t: 'quote', txt: txt(q) }); continue; }
      const para = []; while (i < lines.length && lines[i].trim() && !isTbl(lines[i]) && !isPct(lines[i]) && !isKpi(lines[i]) && !isYr(lines[i]) && !isChk(lines[i]) && !isNum(lines[i]) && !/^```/.test(lines[i]) && !/^(✅|📌|🧠|📚|💡|⚠️|🔎|🚨|⚡|📝)/.test(lines[i].trim()) && !/^#{1,3}\s+/.test(lines[i]) && !/^>\s?/.test(lines[i]) && !/^[-*+]\s+/.test(lines[i].trim())) { para.push(lines[i]); i++; }
      if (para.length) push({ t: 'text', txt: txt(para) });
    }
    return out;
  }

  /* comparison: 3-col tables (feature | A | B) where values look like ratings */
  function rbCompare(rows) {
    if (!rows || rows.length < 3 || rows[0].length !== 3) return null;
    const head = rows[0], body = rows.slice(1).filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
    if (body.length < 2) return null;
    const rate = (c) => { const s = (c.match(/⭐+/g) || []).join(''); if (s) return Math.min(100, (s.length / 5) * 100); const p = parseFloat(c); if (!isNaN(p) && /%/.test(c)) return Math.min(100, p); const m = c.match(/^(\d{1,2})\s*\/\s*10$/); if (m) return Math.min(100, (+m[1]) * 10); return null; };
    const hasRate = body.some((r) => rate(r[1]) !== null || rate(r[2]) !== null);
    if (!hasRate) return null;
    return { t: 'compare', a: head[1], b: head[2], rows: body.map((r) => ({ k: r[0], a: r[1], b: r[2], ra: rate(r[1]), rb: rate(r[2]) })) };
  }

  /* registry: whitelisted components (all text escaped; no raw AI HTML) */
  RB_RENDER.text = (b) => '<p>' + rbInline(b.txt).replace(/\n/g, '<br>') + '</p>';
  RB_RENDER.h = (b) => '<h' + b.lvl + ' class="ai-rb-h">' + rbInline(b.txt) + '</h' + b.lvl + '>';
  RB_RENDER.ul = (b) => '<ul class="ai-rb-ul">' + b.items.map((x) => '<li>' + rbInline(x) + '</li>').join('') + '</ul>';
  RB_RENDER.ol = (b) => '<ol class="ai-rb-ol">' + b.items.map((x) => '<li>' + rbInline(x) + '</li>').join('') + '</ol>';
  RB_RENDER.quote = (b) => '<blockquote class="ai-rb-q">' + rbInline(b.txt).replace(/\n/g, '<br>') + '</blockquote>';
  RB_RENDER.callout = (b) => {
    const map = { '✅': ['success', '✅'], '📌': ['keypoint', '📌'], '🧠': ['concept', '🧠'], '📚': ['revision', '📚'], '💡': ['tip', '💡'], '⚠️': ['warn', '⚠️'], '🔎': ['detail', '🔎'], '🚨': ['critical', '🚨'], '⚡': ['take', '⚡'], '📝': ['sum', '📝'] };
    const k = map[b.icon] || ['tip', b.icon];
    return '<div class="ai-callout ' + k[0] + '"><b>' + k[1] + '</b> ' + rbInline(b.txt) + '</div>';
  };
  RB_RENDER.table = (b) => {
    const rows = b.rows;
    const head = rows[0] || [];
    const body = rows.slice(1).filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
    const cmp = body.length >= 2 && head.length === 3 ? rbCompare(rows) : null;
    if (cmp) return RB_RENDER.compare(cmp);
    const wide = Math.max(...rows.map((r) => r.length)) >= 4 ? ' twide' : '';
    return '<div class="ai-twrap"><table class="ai-rb-tab' + wide + '"><thead><tr>' + head.map((c) => '<th>' + rbInline(c) + '</th>').join('') + '</tr></thead><tbody>' + body.map((r) => '<tr>' + r.map((c) => '<td>' + rbInline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  };
  RB_RENDER.stats = (b) => '<div class="ai-stats ai-rb">' + b.rows.map((r) => '<div class="ai-stat"><div class="lbl"><span>' + rbEsc(r[0]) + '</span><span class="v">' + r[1] + '%</span></div><div class="tr"><div class="fl" style="width:' + r[1] + '%"></div></div></div>').join('') + '</div>';
  RB_RENDER.kpi = (b) => '<div class="ai-kpis">' + b.rows.map((r) => '<div class="ai-kpi"><span class="v">' + rbEsc(r[1]) + (r[2] ? '<i>' + rbEsc(r[2]) + '</i>' : '') + '</span><span class="k">' + rbEsc(r[0]) + '</span></div>').join('') + '</div>';
  RB_RENDER.timeline = (b) => '<div class="ai-timeline ai-rb">' + b.items.map((it) => '<div class="ai-tl"><div class="yr">' + rbEsc(it[0]) + '</div><div class="ds">' + rbInline(it[1]) + '</div></div>').join('') + '</div>';
  RB_RENDER.checklist = (b, ctx) => '<ul class="ai-checklist ai-rb-cl" data-ci="' + (ctx && ctx.idx != null ? ctx.idx : '') + '">' + b.items.map((it, k) => '<li class="' + (it[0] ? 'done' : '') + '" data-k="' + k + '"><span class="bx">' + (it[0] ? '✓' : '') + '</span><span>' + rbInline(it[1]) + '</span></li>').join('') + '</ul>';
  RB_RENDER.steps = (b) => '<ol class="ai-steps">' + b.items.map((it, k) => { const sp = String(it[0]).split(/[—–:：]\s*(.+)$/); const ti = sp[0].trim(); const de = sp[1] ? sp[1].trim() : ''; return '<li class="ai-step"><div class="n">' + (k + 1) + '</div><div class="st"><div class="st-t">' + rbInline(ti) + '</div>' + (de ? '<div class="st-d">' + rbInline(de) + '</div>' : '') + '</div></li>'; }).join('') + '</ol>';
  RB_RENDER.flow = (b) => '<div class="ai-flow">' + b.nodes.map((n, k) => (k ? '<span class="ar">↓</span>' : '') + '<span class="nd">' + rbInline(n) + '</span>').join('') + '</div>';
  RB_RENDER.compare = (b) => {
    const bar = (v) => v == null ? '<span class="na">—</span>' : '<span class="bar"><i style="width:' + v + '%"></i></span>';
    return '<div class="ai-cmp"><div class="ai-cmp-hed"><span class="k"></span><span class="c">' + rbEsc(b.a || 'A') + '</span><span class="c">' + rbEsc(b.b || 'B') + '</span></div>' + b.rows.map((r) => '<div class="ai-cmp-row"><span class="k">' + rbInline(r.k) + '</span><span class="c">' + bar(r.ra) + '</span><span class="c">' + bar(r.rb) + '</span></div>').join('') + '</div>';
  };
  RB_RENDER.code = (b) => {
    const code = String(b.code || '').replace(/\n$/, '');
    const n = code.split('\n').length;
    const lang = String(b.lang || 'code') || 'code';
    const dd = JSON.stringify(code);
    const body = '<pre><code>' + rbEsc(code) + '</code></pre>';
    const head = '<div class="ai-code-h"><span class="lg">' + rbEsc(lang) + '</span><span class="ln">' + n + ' ' + (lang === 'bn' ? 'লাইন' : 'lines') + '</span><button class="cp" data-copy="' + esc(dd) + '" aria-label="Copy">📋</button></div>';
    return '<div class="ai-code">' + head + body + '</div>';
  };

  /* whitelist check + fallback (never blank, never raw) */
  function respRender(blocks, ctx) {
    return (blocks || []).map((b, k) => {
      const fn = RB_RENDER[b.t];
      if (!fn) return '<p>' + rbEsc(b.txt || '') + '</p>';
      try { return fn(b, ctx, k); } catch (_) { return '<p>' + rbEsc(b.txt || '') + '</p>'; }
    }).join('');
  }

  /* context-aware actions (NEVER generic Ask-more/Tell-more) */
  function ctxActions(blocks, rawText) {
    const EN = typeof lang !== 'undefined' && lang === 'en';
    const has = (t) => blocks.some((b) => b.t === t);
    const S = has('stats'), K = has('kpi'), C = has('code'), CM = has('compare'), TL = has('timeline'), ST = has('steps'), FL = has('flow');
    const acts = [];
    if (C) { acts.push(['📋', 'Copy code', 'copy:' + (blocks.find((b) => b.t === 'code').code || '')], ['🧪', EN ? 'Test it' : 'Test করো', 'q:' + (lang === 'en' ? 'Test this code and show the output: ' : 'এই কোডটা test করে আউটপুট দেখাও: ') + rawText.slice(0, 240)], ['🔧', EN ? 'Improve' : 'আরও ভালো করো', 'q:' + (lang === 'en' ? 'Improve this code with comments: ' : 'এই কোড আরও ভালো করো, কমেন্টসহ: ') + rawText.slice(0, 240)]); }
    if (CM) { acts.push(['🧠', EN ? 'Verdict' : 'উপসংহার', 'q:' + (lang === 'en' ? 'Give a clear verdict on which is better and why: ' : 'কোনটা ভালো আর কেন — পরিষ্কার উপসংহার দাও: ') + rawText.slice(0, 240)], ['📋', EN ? 'Copy table' : 'টেবিল কপি', 'copy:' + rawText]); }
    if (S || K) { acts.push(['📊', EN ? 'Explain deeper' : 'আরো ব্যাখ্যা', 'q:' + (lang === 'en' ? 'Explain these numbers in more detail with reasons: ' : 'এই সংখ্যাগুলো আরো গভীরভাবে ব্যাখ্যা করো কারণসহ: ') + rawText.slice(0, 240)], ['📋', EN ? 'Copy data' : 'ডেটা কপি', 'copy:' + rawText]); }
    if (TL) { acts.push(['🗓', EN ? 'Make a plan' : 'প্ল্যান বানাও', 'q:' + (lang === 'en' ? 'Turn this timeline into an actionable plan: ' : 'এই টাইমলাইন থেকে একটা কাজের প্ল্যান বানাও: ') + rawText.slice(0, 240)], ['📋', lang === 'en' ? 'Copy' : 'কপি', 'copy:' + rawText]); }
    if (ST || FL) { acts.push(['🪜', EN ? 'Step-by-step detail' : 'ধাপে ধাপে', 'q:' + (lang === 'en' ? 'Explain each step in detail: ' : 'প্রতিটা ধাপ বিস্তারিতভাবে ব্যাখ্যা করো: ') + rawText.slice(0, 240)], ['📋', lang === 'en' ? 'Copy' : 'কপি', 'copy:' + rawText]); }
    return acts.slice(0, 3);
  }

  /* Long responses intentionally stay fully expanded inside the message card. */

  /* ── shell ── */
  function shell() {
    return `<div class="ai-agent-root" data-theme="${theme}"><div class="ai-agent-head">
      <button class="ai-icobtn ai-ham" id="aiMenuBtn" aria-label="${esc(T.menu)}" title="${esc(T.menu)}">☰</button>
      <div class="ai-orb" aria-hidden="true"></div>
      <div class="ai-agent-t"><b id="aiTitleTxt">${esc(curTitle())}</b><span><span class="ai-online-dot"></span>${esc(T.sub)} · ${esc(T.online)}</span></div>
      <button class="ai-icobtn ai-homehead" id="aiHomeBtn" aria-label="${esc(T.backHome)}" title="${esc(T.backHome)}"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/></svg></button>
      <button class="ai-icobtn ai-plushead" id="aiNewBtn" aria-label="${esc(T.menuNew)}" title="${esc(T.menuNew)}">＋</button></div>
      <div class="ai-agent-body" id="aiAgentBody"></div>
      <div class="ai-agent-foot" id="aiAgentFoot">
        <div id="aiAttachWrap"></div>
        <div class="ai-compose">
          <button class="ai-plus" id="aiPlusBtn" type="button" aria-label="${esc(T.attach)}">＋</button>
          <div class="ai-compose-mid"><div class="ai-editor" id="aiInput" contenteditable="true" role="textbox" aria-multiline="true" data-ph="${esc(T.ph)}" aria-label="Message AI" enterkeyhint="send" autocapitalize="off" autocorrect="off" spellcheck="false"></div></div>
          <button class="ai-mic" id="aiMicBtn" type="button" aria-label="Voice">🎙</button>
          <button class="ai-send" id="aiSendBtn" type="button" aria-label="${esc(T.send)}">➤</button>
        </div></div><button class="ai-latest" id="aiLatest" aria-label="${esc(T.latest)}" title="${esc(T.latest)}">↓<i class="cnt" id="aiLatestCnt">0</i></button></div>`;
  }
  function drawerPanel() {
    const p = document.createElement('div');
    p.className = 'ai-drawerback';
    const list = sessions.slice().sort((a, b) => (b.pin - a.pin) || (b.ts - a.ts));
    p.innerHTML = `<div class="ai-drawer" role="dialog" aria-label="${esc(T.menu)}">
      <div class="ai-dr-head"><div class="ai-orb small"></div><div class="ai-dr-t"><b>${esc(T.title)}</b><span>${esc(T.sub)} · ${esc(T.online)}</span></div><button class="x" id="aiDrawerX" aria-label="${esc(T.close)}">×</button></div>
      <div class="ai-dr-acts">
        <button data-act="new">＋ <b>${esc(T.menuNew)}</b>${msgs.length ? `<span class="hint">${esc(T.newIsEmpty)}</span>` : ''}</button>
        <button data-act="search">🔍 <b>${esc(T.menuSearch)}</b></button>
      </div>
      <div class="ai-dr-lbl">${esc(T.recentChats)}</div>
      <div class="ai-dr-list">${list.map((s2) => {
        const i = sessions.indexOf(s2);
        return `<div class="ai-recent ${i === cur ? 'on' : ''}" data-i="${i}"><span class="ic">${s2.pin ? '📌' : '💬'}</span><span class="nm">${esc(s2.name || T.untitled)}</span><span class="ts">${esc(fmtDay(s2.ts))}</span><button class="rs" data-rm="${i}" aria-label="${esc(T.menu)}">⋯</button></div>`;
      }).join('') || `<div class="ai-dr-empty">${esc(T.noChats)}</div>`}</div>
      <div class="ai-dr-lbl">${esc(T.themeOpt)}</div>
      <div class="ai-dr-themes">
        <button data-theme="light" class="${theme === 'light' ? 'on' : ''}">☀️ <span>${esc(T.themeLight)}</span></button>
        <button data-theme="system" class="${theme === 'system' ? 'on' : ''}">◐ <span>${esc(T.themeSys)}</span></button>
        <button data-theme="dark" class="${theme === 'dark' ? 'on' : ''}">🌙 <span>${esc(T.themeDark)}</span></button>
        <button data-theme="oled" class="${theme === 'oled' ? 'on' : ''}">⬛ <span>${esc(T.themeOled)}</span></button>
      </div>
      <div class="ai-dr-acts">
        <button data-act="home">‹ <b>${esc(T.backHome)}</b></button>
      </div>
      <div class="ai-dr-foot">
        <button data-act="rename">✏️ ${esc(T.menuRename)}</button>
        <button data-act="export">📤 ${esc(T.menuExport)}</button>
        <button data-act="clear">🧹 ${esc(T.menuClear)}</button>
        <button data-act="del" class="danger">🗑 ${esc(T.menuDelete)}</button>
      </div></div>`;
    p.addEventListener('click', (e) => { if (e.target === p) closeMenu(); });
    p.querySelectorAll('[data-act]').forEach((b) => {
      const act = b.getAttribute('data-act');
      b.addEventListener('click', () => {
        if (act === 'new') { closeMenu(); newChat(); }
        else if (act === 'rename') { closeMenu(); renameChat(); }
        else if (act === 'search') { closeMenu(); openSearch(); }
        else if (act === 'export') { closeMenu(); exportChat(); }
        else if (act === 'clear') { closeMenu(); clearMsgs(); }
        else if (act === 'del') { closeMenu(); delChat(); }
        else if (act === 'home') { closeMenu(); backHome(); }
      });
    });
    p.querySelectorAll('[data-theme]').forEach((b) => b.addEventListener('click', () => { setTheme(b.getAttribute('data-theme')); }));
    p.querySelectorAll('[data-i]').forEach((row) => row.addEventListener('click', (e) => { if (e.target.closest('.rs')) return; const i = +row.getAttribute('data-i'); if (i !== cur) switchChat(i); closeMenu(); }));
    p.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); itemMenu(+b.getAttribute('data-rm'), b); }));
    const x = p.querySelector('#aiDrawerX'); if (x) x.addEventListener('click', closeMenu);
    return p;
  }
  function itemMenu(i, anchor) {
    const s2 = sessions[i]; if (!s2) return;
    const act = prompt(T.itemAct + '\n1. ' + T.pinChat + '\n2. ' + T.menuRename + '\n3. ' + T.menuDelete + '\n4. ' + T.cancelBtn, '1');
    if (act === '1') { s2.pin = s2.pin ? 0 : 1; save(); }
    else if (act === '2') { const nm = prompt(T.menuRename + ':', s2.name || ''); if (nm !== null) { s2.name = nm.trim(); if (i === cur) { try { scopedWrite(NAME_KEY, s2.name); } catch (_) {} } } save(); }
    else if (act === '3') { if (!confirm(T.confirmDel)) return; const wasCur = i === cur; sessions.splice(i, 1); if (!sessions.length) sessions = [mkSession('', [])]; if (wasCur || cur >= sessions.length) { cur = Math.min(i, sessions.length - 1); msgs = sessions[cur].msgs; render(); return; } save(); }
    if (menuOpen) { closeMenu(); menuOpen = true; document.body.appendChild(drawerPanel()); }
  }
  function backHome() { try { document.documentElement.classList.remove('ai-chat-open'); const _ap = document.getElementById('app'); if (_ap) _ap.classList.remove('ai-chat-open'); } catch (_) {} const nb = document.querySelector('.bottomnav'); if (nb) nb.style.display = ''; if (window.navigate) window.navigate('dashboard'); else history.back(); }
  function effTheme() { return theme === 'system' ? ((window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light') : (THEMES[theme] ? theme : 'light'); }
  function applyThemeVars() {
    const r = document.querySelector('.ai-agent-root'); if (!r) return;
    const t = THEMES[effTheme()] || THEMES.light;
    for (const k of ['bg', 'card', 'ink', 'sub', 'primary', 'mint', 'line', 'user']) r.style.setProperty('--ai-' + k, t[k]);
    r.setAttribute('data-theme', effTheme());
  }
  function setTheme(t) { theme = THEMES[t] ? t : 'light'; try { scopedWrite(THEME_KEY, theme); } catch (_) {} applyThemeVars(); renderChrome(); document.querySelectorAll('.ai-dr-themes button').forEach((b) => b.classList.toggle('on', b.getAttribute('data-theme') === theme)); }
  try { (window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null).addEventListener && matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (theme === 'system') setTheme('system'); }); } catch (_) {}
  function closeMenu() { menuOpen = false; const m = document.querySelector('.ai-drawerback') || document.querySelector('.ai-menu'); if (m) m.remove(); }
  function setSheetUI(open) { attachOpen = open;
    const plus = document.getElementById('aiPlusBtn'); if (plus) plus.classList.toggle('plus-on', open);
    const nav = document.querySelector('.bottomnav');
    const onAi = !!document.querySelector('.ai-agent-root');
    if (nav) nav.style.display = (open || onAi) ? 'none' : '';
    document.body.style.overflow = open ? 'hidden' : '';
    if (!open) { const sb = document.getElementById('aiSheetView'); if (sb) sb.remove(); }
  }
  function closeAttach() { setSheetUI(false); }

  /* ── attachments sheet ── */
  function sheet() {
    const back = document.createElement('div');
    back.className = 'ai-sheetback'; back.id = 'aiSheetView';
    back.innerHTML = `<div class="ai-sheet"><div class="ai-sheet-grab"></div><div class="ai-sheet-h">${esc(T.addToConv)}</div>
      <div class="ai-sheet-grid">
        <button class="ai-sheet-it" data-file="cam"><span class="ic">📷</span>${esc(T.cam)}</button>
        <button class="ai-sheet-it" data-file="img"><span class="ic">🖼</span>${esc(T.img)}</button>
        <button class="ai-sheet-it" data-file="doc"><span class="ic">📄</span>${esc(T.doc)}</button>
        <button class="ai-sheet-it" data-file="vid"><span class="ic">🎥</span>${esc(T.vid)}</button>
        <button class="ai-sheet-it" data-file="rec"><span class="ic">🎙</span>${esc(T.voice)}</button>
        <button class="ai-sheet-it" data-file="any"><span class="ic">📎</span>${esc(T.file)}</button>
      </div><div class="ai-sheet-h">${esc(T.aiTools)}</div>
      <div class="ai-sheet-grid">
        <button class="ai-sheet-it" data-tool="search"><span class="ic">🔎</span>${esc(T.tSearch)}</button>
        <button class="ai-sheet-it" data-tool="mcq"><span class="ic">✏️</span>${esc(T.tMcq)}</button>
        <button class="ai-sheet-it" data-tool="quiz"><span class="ic">🎯</span>${esc(T.tQuiz)}</button>
        <button class="ai-sheet-it" data-tool="explain"><span class="ic">🧠</span>${esc(T.tExplain)}</button>
        <button class="ai-sheet-it" data-tool="analyze"><span class="ic">📊</span>${esc(T.tAnalyze)}</button>
        <button class="ai-sheet-it" data-tool="summ"><span class="ic">🧾</span>${esc(T.tSummarize)}</button>
      </div></div>`;
    back.addEventListener('click', (e) => { if (e.target === back) closeAttach(); });
    back.querySelector('[data-file="cam"]').addEventListener('click', () => pick('image/*', true));
    back.querySelector('[data-file="img"]').addEventListener('click', () => pick('image/*', false));
    back.querySelector('[data-file="doc"]').addEventListener('click', () => pick('.pdf,.doc,.docx,.txt,.csv,.xls,.xlsx,.ppt,.pptx', false));
    back.querySelector('[data-file="vid"]').addEventListener('click', () => pick('video/*', false));
    back.querySelector('[data-file="rec"]').addEventListener('click', () => { closeAttach(); startVoice(); });
    back.querySelector('[data-file="any"]').addEventListener('click', () => pick('', false));
    back.querySelector('[data-tool="search"]').addEventListener('click', () => tool('search'));
    back.querySelector('[data-tool="mcq"]').addEventListener('click', () => tool('mcq'));
    back.querySelector('[data-tool="quiz"]').addEventListener('click', () => tool('quiz'));
    back.querySelector('[data-tool="explain"]').addEventListener('click', () => tool('explain'));
    back.querySelector('[data-tool="analyze"]').addEventListener('click', () => tool('analyze'));
    back.querySelector('[data-tool="summ"]').addEventListener('click', () => tool('summ'));
    return back;
  }
  function pick(accept, capture) {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (accept) inp.accept = accept;
    if (capture) inp.setAttribute('capture', 'environment');
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      if (!f) { closeAttach(); return; }
      const kind = f.type.startsWith('image/') ? 'image' : (f.type.startsWith('video/') ? 'video' : (f.type.startsWith('audio/') ? 'audio' : 'doc'));
      const item = { kind, name: f.name, size: f.size, dataUrl: '', file: f };
      if (kind === 'image') {
        const fr = new FileReader();
        fr.onload = () => {
          const s = String(fr.result || '');
          if (s.length > 4700000) { toast(T.imgTooBig); closeAttach(); return; }
          item.dataUrl = s;
          attachments.push(item); renderAttach(); closeAttach();
        };
        fr.readAsDataURL(f);
      } else { attachments.push(item); renderAttach(); closeAttach(); }
    });
    inp.click();
  }
  function renderAttach() {
    const w = document.getElementById('aiAttachWrap'); if (!w) return;
    w.innerHTML = attachments.map((a, i) => `<div class="ai-attach-chip">${a.kind === 'image' && a.dataUrl ? `<img src="${a.dataUrl}" alt="">` : `<span class="ic">${a.kind === 'video' ? '🎥' : a.kind === 'audio' ? '🎙' : '📄'}</span>`}<div class="nm"><b>${esc(a.name)}</b><span>${fmtSize(a.size)}</span></div><button class="x" data-i="${i}">×</button></div>`).join('');
    w.querySelectorAll('.x').forEach((b) => b.addEventListener('click', () => { attachments.splice(+b.getAttribute('data-i'), 1); renderAttach(); }));
  }
  const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
  function tool(kind) {
    closeAttach();
    const q = {
      search: 'সর্বশেষ ভর্তি-নিউজ খোঁজো — অফিসিয়াল সোর্স প্রাধান্য দিয়ে',
      mcq: lang === 'en' ? 'Make 10 MCQs on my current topic' : 'আমাকে ১০টা MCQ বানাও',
      quiz: lang === 'en' ? 'Quiz me — 5 questions' : 'আমাকে quiz নাও — ৫টা প্রশ্ন',
      explain: lang === 'en' ? 'Explain simply: ' : 'সহজ করে বুঝাও: ',
      analyze: lang === 'en' ? 'Analyze my performance' : 'আমার পারফরম্যান্স analyze করো',
      summ: lang === 'en' ? 'Summarize: ' : 'সংক্ষেপে বলো: '
    }[kind];
    const base = (kind === 'explain' || kind === 'summ') && inputVal() ? inputVal() : '';
    const text = q + (base ? ' ' + '' : '') ;
    send(text.trim());
  }
  function fmtSizeTxt() {}

  /* ── search overlay ── */
  function openSearch() {
    searchOpen = true;
    const r = document.querySelector('.ai-agent-root'); if (!r) return;
    const bar = document.createElement('div');
    bar.className = 'ai-searchbar';
    bar.innerHTML = `<input id="aiSearchInput" placeholder="${esc(T.searchPh)}" autocomplete="off" enterkeyhint="search" autocapitalize="off" autocorrect="off" spellcheck="false"><button id="aiSearchClose">✕</button>`;
    bar.querySelector('#aiSearchClose').addEventListener('click', () => closeSearch());
    bar.querySelector('#aiSearchInput').addEventListener('input', (e) => applySearch(e.target.value));
    r.parentElement.insertBefore(bar, r);
    setTimeout(() => bar.querySelector('#aiSearchInput').focus(), 30);
  }
  function closeSearch() {
    searchOpen = false;
    const bar = document.querySelector('.ai-searchbar'); if (bar) bar.remove();
    applySearch('');
    const i = document.getElementById('aiInput'); if (i) setTimeout(() => { try { i.focus({ preventScroll: true }); } catch (_) {} }, 60);
  }
  function applySearch(q) {
    const b = body(); if (!b) return;
    q = String(q || '').toLowerCase().trim();
    if (!q) { renderMsgs(); return; }
    let count = 0;
    b.innerHTML = msgs.map((m, i) => {
      const hit = String(m.text || '').toLowerCase().includes(q);
      if (hit) count++;
      return hit ? msgHtml(m, i) : '';
    }).join('') || `<div class="ai-msg ai" style="text-align:center;color:var(--ai-sub,#5F7A72);font-size:13px;padding:26px">${esc(T.noResults)}</div>`;
    void count;
  }

  /* ── renew / delete / export ── */
  function newChat() { if (msgs.length === 0) { render(); return; } sessions.push(mkSession('', [])); cur = sessions.length - 1; msgs = sessions[cur].msgs; aiPinned = true; save(); render(); }
  function switchChat(i) { if (i === cur || !sessions[i]) return; save(); cur = i; msgs = sessions[cur].msgs; aiPinned = true; render(); }
  function clearMsgs() { if (!confirm(T.confirmClear)) return; msgs = []; aiPinned = true; save(); render(); }
  function delChat() {
    if (!confirm(T.confirmDel)) return;
    sessions.splice(cur, 1);
    if (!sessions.length) sessions = [mkSession('', [])];
    cur = Math.min(cur, sessions.length - 1);
    msgs = sessions[cur].msgs;
    save(); render(); toast(T.delDone);
  }
  function renameChat() {
    const prev = (sessions[cur] && sessions[cur].name) || (() => { try { return scopedRead(NAME_KEY) || ''; } catch (_) { return ''; } })();
    const name = prompt(T.menuRename + ':', prev || T.title);
    if (name === null) return;
    sessions[cur].name = name.trim(); sessions[cur].ts = Date.now();
    try { scopedWrite(NAME_KEY, sessions[cur].name); } catch (_) {}
    save();
    const b = document.getElementById('aiTitleTxt') || document.querySelector('.ai-agent-t b');
    if (b) b.textContent = sessions[cur].name || T.title;
  }
  function exportChat() {
    const txt = msgs.map((m) => (m.role === 'user' ? T.you + ': ' : T.title + ': ') + (m.text || '')).join('\n\n') || '(empty)';
    try {
      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'admission-hub-ai-chat.txt';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    } catch (_) { toast('Export failed'); }
  }

  /* ── voice in (Web Speech) + voice out ── */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function startVoice() {
    if (voiceState) { stopVoice(); return; }
    if (!SR) { toast(T.voiceNope); return; }
    const rec = new SR();
    rec.lang = 'bn-BD';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let t0 = Date.now();
    voiceState = { rec, timer: setInterval(() => { const v = document.getElementById('aiVoiceTime'); if (v) v.textContent = '0' + Math.floor((Date.now() - t0) / 60000) + ':' + String(Math.floor((Date.now() - t0) / 1000) % 60).padStart(2, '0'); }, 500) };
    renderVoicebar(true);
    rec.onresult = (e) => {
      const t = e.results && e.results[0] && e.results[0][0] && e.results[0][0].transcript;
      if (t) { const el = inputEl(); if (el) { const cur = inputVal(el); setInput(el, cur ? cur + ' ' + t : t); } }
    };
    rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast(T.voiceNope); stopVoice(true); };
    rec.onend = () => stopVoice(true);
    try { rec.start(); } catch (_) { stopVoice(true); }
  }
  function stopVoice(silent) {
    if (!voiceState) return;
    clearInterval(voiceState.timer);
    try { voiceState.rec.stop(); } catch (_) {}
    voiceState = null;
    if (!silent) toast(undefined);
    renderVoicebar(false);
  }
  function renderVoicebar(on) {
    const w = document.getElementById('aiAttachWrap'); if (!w) return;
    const mic = document.getElementById('aiMicBtn');
    if (mic) mic.classList.toggle('rec', on);
    if (!on) { const el = document.getElementById('aiVoiceBar'); if (el && !attachments.length) w.innerHTML = ''; renderAttach(); return; }
    w.innerHTML = `<div class="ai-voicebar" id="aiVoiceBar"><span class="rec"></span><b>${esc(T.listening)}…</b><span id="aiVoiceTime">00:00</span><button class="x" style="border:0;background:none;margin-left:auto;color:var(--ai-sub);font-size:15px;cursor:pointer" onclick="window.__AiAgentStopVoice&&__AiAgentStopVoice()">■</button></div>`;
  }
  async function speak(el) {
    const text = String(el.getAttribute('data-speak') || '').trim();
    if (!text || speakBusy) return;
    const old = el.innerHTML; el.disabled = true; el.innerHTML = '◌';
    speakBusy = true;
    try {
      const r = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AH-App': 'admission-hub' },
        body: JSON.stringify({ word: text.slice(0, 500), voiceId: 'EXAVITQu4vr4xnSDxMaL', modelId: 'eleven_flash_v2_5', output_format: 'mp3_22050_32', lang: 'bn', voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1.0 } })
      });
      if (!r.ok) throw new Error('voice-' + r.status);
      const blob = await r.blob();
      if (!blob || !blob.size) throw new Error('empty');
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      a.onended = () => { try { URL.revokeObjectURL(url); } catch (_) {} };
      await a.play();
    } catch (_) { toast(T.speakErr || 'Voice unavailable'); }
    speakBusy = false;
    if (el) { el.disabled = false; el.innerHTML = old; }
  }

  /* ── messages render ── */
  function body() { return document.getElementById('aiAgentBody'); }
  function emptyState() {
    return `<div class="ai-hero"><div class="ai-hero-txt"><b>✦ ${esc(T.heroTitle)}</b><p>${esc(T.heroBody)}</p><button class="ai-hero-cta" id="aiHeroCta">${esc(T.heroCta)} →</button></div>
      <div class="ai-hero-orb" aria-hidden="true"><i class="ring"></i><i class="ring2"></i><i class="p1"></i><i class="p2"></i><i class="p3"></i><span class="big"></span></div></div>
      ${scopedRead(NOTICE_KEY) ? '' : `<div class="ai-notice" id="aiNotice">🛡 <div><b>AI responses</b> can occasionally contain mistakes. Verify important admission information from official sources.</div><button class="x" id="aiNoticeX" aria-label="Dismiss">×</button></div>`}
      <div class="ai-try">${esc(T.tryAsking)}</div>
      <div class="ai-chips">${T.chips.map((c) => `<button class="ai-chip" data-q="${esc(c[2])}"><span class="ic">${c[0]}</span><b>${esc(c[1])}</b><span>${esc(c[0] + ' ' + (c[1]))}</span></button>`).join('')}</div>`;
  }
  function msgHtml(m, idx) {
    if (m.role === 'user') {
      const ub = m.text.length > 460 ? `<details class="ai-u-fold"><summary>${esc(m.text.slice(0, 150))}… <em>${esc(T.seeMore)}</em></summary><div>${esc(m.text)}</div></details>` : esc(m.text);
      return `<div class="ai-msg user"><div><div class="bubble">${ub}${m.image ? `<img class="thumb" src="${m.image}" alt="">` : ''}</div><div class="meta">${esc(fmtTime(m.ts))} <span class="ai-tick">✓✓</span></div></div></div>`;
    }
    if (m.error) {
      return `<div class="ai-msg ai"><div class="ai-msg-head"><span class="mini"></span>${esc(T.title)}</div><div class="ai-msg-body"><p style="color:#B23B48;font-weight:700">⚠️ ${esc(T.err)}</p><p style="font-size:12.5px;color:var(--ai-sub,#5F7A72)">${esc(m.text || '')}</p></div>
        <div class="ai-msg-bar"><button class="ab" onclick="window.__AiAgentRetry&&__AiAgentRetry()" title="${esc(T.retry)}" aria-label="${esc(T.retry)}">${ICONS.regen}</button><button class="ab" onclick="window.__AiAgentEdit&&__AiAgentEdit()" title="${esc(T.editBtn)}" aria-label="${esc(T.editBtn)}">${ICONS.pencil}</button></div></div>`;
    }
    if (m.qz) return `<div class="ai-msg ai"><div class="ai-msg-head"><span class="mini"></span>${esc(T.title)}</div>${quizV2Html(m, idx)}</div>`;
    const quizHtml = m.quiz ? quizCardHtml(m, idx) : '';
    const isRich = (() => {
      if (quizHtml) return false;
      const blocks0 = respParse(m.text);
      /* normalize: rating-table → compare block (single source) */
      const blocks = blocks0.map((b) => {
        if (b.t === 'table') { const c = rbCompare(b.rows); if (c) return c; }
        return b;
      });
      const rich = blocks.some((b) => ['table','stats','kpi','timeline','checklist','steps','flow','compare','code','callout','quote','ul','ol'].includes(b.t));
      if (!rich && blocks.length < 10) return false;
      m._rb = blocks;
      return true;
    })();
    let bodyHtml = quizHtml;
    let rax = '';
    if (!bodyHtml) {
      if (isRich) {
        const blocks = m._rb || [];
        const inner = respRender(blocks, { idx });
        bodyHtml = '<div class="ai-cr">' + inner + '</div>';
        const acts = ctxActions(blocks, m.text);
        if (acts.length) rax = '<div class="ai-rax">' + acts.map((a) => `<button data-act="ra" data-val="${esc(a[2])}"><span>${a[0]}</span>${esc(a[1])}</button>`).join('') + '</div>';
      } else {
        bodyHtml = md(esc(m.text));
      }
    }
    const follow = m.quiz || rax ? '' : `<div class="ai-followup">${followups(m).map((f) => `<button data-q="${esc(f[2])}">${ICONS[f[0]] || ''}${esc(f[1])}</button>`).join('')}</div>`;
    return `<div class="ai-msg ai"><div class="ai-msg-head"><span class="mini"></span>${esc(T.title)}</div>${bodyHtml}${rax}
      <div class="ai-msg-bar">
        <button class="ab" data-t="${esc(m.text)}" onclick="window.__AiAgentCopy(this)" title="${esc(T.copy)}" aria-label="${esc(T.copy)}">${ICONS.copy}</button>
        <button class="ab ${m.fb === 'up' ? 'on' : ''}" data-fb="up" data-i="${idx}" onclick="window.__AiAgentFb(this)" title="${esc(T.liked)}" aria-label="${esc(T.liked)}">${ICONS.like}</button>
        <button class="ab ${m.fb === 'down' ? 'on' : ''}" data-fb="down" data-i="${idx}" onclick="window.__AiAgentFb(this)" title="${esc(T.feedbackQ)}" aria-label="${esc(T.feedbackQ)}">${ICONS.dislike}</button>
        <button class="ab" data-i="${idx}" onclick="window.__AiAgentShare(this)" title="${esc(T.shareBtn)}" aria-label="${esc(T.shareBtn)}">${ICONS.share}</button>
        ${m.regen ? `<button class="ab" onclick="window.__AiAgentRegen&&__AiAgentRegen()" title="${esc(T.regen)}" aria-label="${esc(T.regen)}">${ICONS.regen}</button>` : ''}
        <span class="sp"></span>
        <button class="ab" data-more="${idx}" onclick="window.__AiAgentMore(this)" title="${esc(T.more)}" aria-label="${esc(T.more)}">${ICONS.more}</button>
      </div>${follow}</div>`;
  }
  function followups(m) {
    const t = String(m.text || '');
    const topic = lastTopic(m);
    const P = lang === 'en' ? {
      shorten: (x) => 'Briefly summarize: ' + x, simple: (x) => 'Explain in simpler words: ' + x, points: (x) => 'List the key points: ' + x,
      similar: (x) => 'Create 3 more similar MCQs from: ' + x, quiz: (x) => 'Quiz me with 5 questions on: ' + x, explain: (x) => 'Explain this topic: ' + x,
      example: (x) => 'Give more examples of: ' + x, mcq: (x) => 'Create 5 MCQs from: ' + x, revise: (x) => 'Make a revision note on: ' + x
    } : {
      shorten: (x) => 'সংক্ষেপে বলো: ' + x, simple: (x) => 'আরও সহজ করে বলো: ' + x, points: (x) => 'মূল পয়েন্টগুলো দাও: ' + x,
      similar: (x) => 'এ রকম আরও ৩টা MCQ বানাও: ' + x, quiz: (x) => 'এই টপিক নিয়ে ৫টা প্রশ্নে quiz নাও: ' + x, explain: (x) => 'এই টপিকটা বুঝিয়ে দাও: ' + x,
      example: (x) => 'আরও উদাহরণ দাও: ' + x, mcq: (x) => 'এই টপিক থেকে ৫টা MCQ বানাও: ' + x, revise: (x) => 'এই টপিকের revision note বানাও: ' + x
    };
    const long = t.length > 750 || (t.match(/\n{1,}/g) || []).length > 10 || (t.match(/[.!?।]/g) || []).length > 16;
    const hasMcqList = /(mcq|প্রশ্ন দিয়ে|কুইজ|quiz)/i.test(t) && (/[0-9]+[.)]/.test(t) || /[কখগঘঙ]/i.test(t.slice(0, 400)));
    const isTest = /quiz|কুইজ|পরীক্ষা|test/i.test(t);
    const def = /(কী |কাকে |বলে|মানে |সংজ্ঞা|definition|means|explain|হল:|হচ্ছে)/i.test(t);
    if (long) return [['zap', T.chzShorten, P.shorten(topic)], ['sparkle', T.chzSimple, P.simple(topic)], ['list', T.chzPoints, P.points(topic)]];
    if (hasMcqList || isTest) return [['pencil', T.chzSimilarMcq, P.similar(topic)], ['target', T.chzQuiz, P.quiz(topic)], ['sparkle', T.chzExplain, P.explain(topic)]];
    if (def) return [['sparkle', T.chzSimple, P.simple(topic)], ['book', T.chzExample, P.example(topic)], ['target', T.chzQuiz, P.quiz(topic)]];
    return [['pencil', T.chzMcq, P.mcq(topic)], ['target', T.chzQuiz, P.quiz(topic)], ['book', T.chzRevise, P.revise(topic)]];
  }
  function lastTopic(m) {
    const t = String(m.text || '').split('\n')[0].replace(/[#*`]/g, '').trim();
    return t.length > 100 ? t.slice(0, 100) : t;
  }
  function quizCardHtml(m, idx) {
    const qz = m.quiz; const q = qz.data.questions[qz.idx];
    const fb = qz.feedback;
    const opts = q.options.map((o, i) => {
      let cls = 'ai-opt';
      if (fb) { if (i === q.answer) cls += ' correct'; else if (i === qz.sel) cls += ' wrong'; }
      else if (qz.sel === i) cls += ' sel';
      return `<button class="${cls}" data-i="${i}" onclick="window.__AiQuizTap(${idx},${i})"><span class="dot"></span>${esc(o)}</button>`;
    }).join('');
    let fbHtml = '';
    if (fb) {
      const good = qz.sel === q.answer;
      fbHtml = `<div class="ai-quiz-fb ${good ? 'good' : 'bad'}"><b>${good ? '✓ ' + esc(T.correct) : '✕ ' + esc(T.notQuite)}</b>${good ? '' : esc(T.correctAnswer) + ': ' + esc(q.options[q.answer]) + '<br>'}${esc(q.explanation || '')}</div>`;
    }
    return `<div class="ai-quiz"><div class="ai-quiz-head"><span>🎯</span>${esc(T.quickChallenge)}<span class="qcount">${esc(T.question)} ${qz.idx + 1} / ${qz.data.questions.length}</span></div>
      <div class="ai-quiz-body"><div class="ai-quiz-q">${esc(q.q)}</div><div class="ai-quiz-opts">${opts}</div>${fbHtml}
      ${fb ? `<button class="ai-quiz-next" onclick="window.__AiQuizNext(${idx})">${qz.idx + 1 < qz.data.questions.length ? esc(T.next) + ' →' : '🎯 ' + esc(T.quizComplete)}</button>` : ''}</div></div>`;
  }
  function quizDoneHtml(m, idx) {
    const qz = m.quiz; const total = qz.data.questions.length; const score = qz.correct;
    const pct = Math.round((score / total) * 100);
    const rows = qz.data.questions.map((q, i) => {
      const ok = qz.userAnswers[i] === q.answer;
      return `<div><b class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '✕'}</b> Q${i + 1}. ${esc(q.q.slice(0, 70))}… <b>${esc(q.options[q.answer])}</b></div>`;
    }).join('');
    return `<div class="ai-quiz"><div class="ai-quiz-head"><span>🎯</span>${esc(T.quizComplete)}</div><div class="ai-quiz-done">
      <div class="big">${score} / ${total}</div><p>${esc(T.accuracy)}: ${pct}%</p>
      <div class="acts"><button class="ghost" onclick="window.__AiQuizAnalysis(${idx})">${esc(T.viewAnalysis)}</button><button class="solid" onclick="window.__AiQuizRetry(${idx})">${esc(T.tryAgain)}</button></div>
      ${qz.showAnalysis ? `<div class="ai-quiz-analysis">${rows}</div>` : ''}</div></div>`;
  }
  function renderMsgs() {
    const b = body(); if (!b) return;
    if (!msgs.length) { b.innerHTML = emptyState(); wireEmpty(); scrollBottom(); return; }
    if (searchOpen) { applySearch(document.getElementById('aiSearchInput').value || ''); return; }
    b.innerHTML = msgs.map((m, i) => m.quiz && m.quiz.done ? quizDoneHtml(m, i) : msgHtml(m, i)).join('');
    scrollBottom();
    msgs.forEach((m2, i2) => { if (m2.qz && m2.qz.st === 'play') qzStartTick(m2, i2); });
    const lastM = msgs[msgs.length - 1];
    if (lastM && lastM.role === 'ai' && typeof window.__aiMarkNew === 'function' && window.__aiMarkLast !== lastM) { window.__aiMarkLast = lastM; window.__aiMarkNew(); }
    requestAnimationFrame(() => {
      b.querySelectorAll('.ai-stat .v').forEach((el) => {
        if (el.dataset.cd) return; el.dataset.cd = '1';
        const t = el.textContent; const v = parseFloat(t); if (!isFinite(v)) return;
        const units = t.replace(/[\d.]+/, ''); const t0 = performance.now(); const dur = 750;
        const step = (now) => { const k = Math.min(1, (now - t0) / dur); el.textContent = Math.round(v * (k < 1 ? 1 - Math.pow(1 - k, 3) : 1)) + units; if (k < 1) requestAnimationFrame(step); };
        requestAnimationFrame(step);
      });
    });
  }
  function wireEmpty() {
    const cta = document.getElementById('aiHeroCta');
    if (cta) cta.addEventListener('click', () => { input.focus(); });
    const nx = document.getElementById('aiNoticeX');
    if (nx) nx.addEventListener('click', () => { try { scopedWrite(NOTICE_KEY, 'true'); } catch (_) {} const n = document.getElementById('aiNotice'); if (n) n.remove(); });
    document.querySelectorAll('.ai-chip').forEach((c) => c.addEventListener('click', () => send(c.getAttribute('data-q'))));
    if (!window.__aiFollowupDeleg) { window.__aiFollowupDeleg = true; document.addEventListener('click', (e) => { const b = e.target.closest('.ai-followup button'); if (b) send(b.getAttribute('data-q') || ''); }); }
  }
  function scrollBottom(force) {
    const b = body(); if (!b) return;
    const near = b.scrollHeight - b.scrollTop - b.clientHeight < 150;
    if (force || aiPinned || near) b.scrollTop = b.scrollHeight;
  }
  /* ব্যবহারকারী উপরে থাকলে টেনে নামাই না */
  function scrollPinStart() { const b = body(); if (!b) return; if (b.scrollHeight - b.scrollTop - b.clientHeight < 320) b.scrollTop = b.scrollHeight; }

  /* ── streaming ── */
  function thinkingCard(cls) {
    return `<div class="ai-think ${cls || ''}"><div class="ob"></div><div class="tx"><b>✦</b><span id="aiThinkStatus">${esc(T.stThink)}</span></div></div>`;
  }
  function thinkingStatus(label) { const el = document.getElementById('aiThinkStatus'); if (el) el.textContent = label; }
  const thinkTimers = [];
  function clearThinkTimers() { while (thinkTimers.length) { clearTimeout(thinkTimers.pop()); } }
  function appendThinking(sig) {
    const b = body(); if (!b) return;
    b.insertAdjacentHTML('beforeend', thinkingCard(sig.search ? 'tq-search' : (sig.image || sig.doc) ? 'tq-analyze' : (sig.quiz || sig.mcq) ? 'tq-create' : ''));
    scrollBottom(true);
    clearThinkTimers();
    const seq = [];
    seq.push([0, sig.status || T.stThink]);
    seq.push([1000, T.stAnalyze]);
    if (sig.image) seq.push([2200, T.stImage]);
    else if (sig.doc) seq.push([2200, T.stDoc]);
    else if (sig.search) seq.push([2200, T.stSearch]);
    else if (sig.calc) seq.push([2200, T.stCalc]);
    else if (sig.code) seq.push([2200, T.stCode]);
    else if (sig.plan) seq.push([2200, T.stPlan]);
    else if (sig.vs) seq.push([2200, T.stVerdict]);
    else if (sig.quiz && sig.mcq) seq.push([2200, T.stMcq]);
    else if (sig.quiz) seq.push([2200, T.stQuiz]);
    seq.push([Math.min(5600, 2200 + seq.length * 800), T.stWrite]);
    for (const [ms, label] of seq) thinkTimers.push(setTimeout(() => thinkingStatus(label), ms));
    thinkTimers.push(setTimeout(scrollPinStart, 450));
  }
  function removeThinking() { clearThinkTimers(); const el = document.querySelector('.ai-think'); if (el) el.remove(); }
  function appendStream(chunk) {
    if (!streamingEl) {
      const b = body(); if (!b) return;
      streamingEl = document.createElement('div');
      streamingEl.className = 'ai-msg ai';
      streamingEl.innerHTML = `<div class="ai-msg-head"><span class="mini"></span>${esc(T.title)}</div><div class="ai-msg-body"><p><span class="ai-cursor"></span></p></div>`;
      b.appendChild(streamingEl);
      scrollPinStart();
    }
    const p = streamingEl.querySelector('.ai-msg-body p');
    if (p) { const cur = p.querySelector('.ai-cursor'); if (cur) cur.remove(); p.textContent += chunk; const sp = document.createElement('span'); sp.className = 'ai-cursor'; p.appendChild(sp); }
    scrollBottom();
  }

  /* ── api ── */
  function history() {
    const hist = [];
    for (const m of msgs) if (m.role === 'user' || (m.role === 'ai' && !m.error)) hist.push({ role: m.role === 'ai' ? 'assistant' : 'user', content: String(m.text || '').slice(0, 4000) });
    return hist.slice(-MAX_HISTORY);
  }
  async function callStream(userText, image) {
    const hist = history().concat([{ role: 'user', content: userText, ...(image ? { image } : {}) }]);
    const payload = { messages: hist, context: { stats: localStats(), examMode: null } };
    const ctrl = new AbortController();
    activeReq = ctrl;
    const r = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AH-Guest': guestId() },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    if (!r.ok || !r.body) {
      const detail = await r.json().catch(() => null);
      return { code: 'http', status: r.status, meta: detail };
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = ''; let full = ''; let meta = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() || '';
      for (const part of parts) {
        for (const line of part.split('\n')) {
          const s = line.trim();
          if (!s.startsWith('data:')) { if (s.startsWith('event:') && s.includes('error')) meta = meta || { event: 'error' }; continue; }
          let j = null; try { j = JSON.parse(s.slice(5).trim()); } catch (_) { continue; }
          if (j.text) { full += j.text; appendStream(j.text); }
          else if (j.error) meta = { event: 'error', message: j.message, retryable: j.retryable };
          else if (j.model || j.provider || j.intent) meta = { event: 'done', model: j.model, provider: j.provider, intent: j.intent };
        }
      }
    }
    if (buf) {
      for (const line of buf.split('\n')) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        try { const j = JSON.parse(s.slice(5).trim()); if (j.text) full += j.text; if (j.error) meta = meta || { event: 'error', message: j.message, retryable: j.retryable }; } catch (_) {}
      }
    }
    if (stoppedEarly && !full) return { code: 'stopped' };
    return { code: 'ok', text: full, meta };
  }
  function parseQuiz(text) {
    if (!text) return null;
    let m = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
    let s = m ? m[1] : String(text);
    const first = s.indexOf('{'); const last = s.lastIndexOf('}');
    if (first < 0 || last <= first) return null;
    s = s.slice(first, last + 1);
    try {
      const d = JSON.parse(s);
      const qs = Array.isArray(d.questions) ? d.questions : null;
      if (!qs || qs.length < 1 || qs.length > 40) return null;
      for (const q of qs) {
        if (!q || typeof q.q !== 'string' || !Array.isArray(q.options) || q.options.length < 2 || typeof q.answer !== 'number' || q.answer < 0 || q.answer >= q.options.length) return null;
      }
      return { title: String(d.title || ''), questions: qs };
    } catch (_) { return null; }
  }


  /* ═══════════ Interactive Quiz Engine v2 (v216) ═══════════
     Natural language → intent extraction → adaptive config →
     Question Bank check → AI-gen missing → play → feedback →
     submit → result → AI insight → review/retry/similar/weak */
  const QZ_SUBJECTS = [
    { id: 'bangla', bn: 'বাংলা', en: 'bangla', al: ['বাং'], top: [
      { bn: 'সন্ধি', sub: ['স্বরসন্ধি', 'ব্যঞ্জনসন্ধি', 'বিসর্গসন্ধি'] }, { bn: 'সমাস', sub: ['দ্বন্দ্ব', 'কর্মধারয়', 'তৎপুরুষ', 'বহুব্রীহি', 'দ্বিগু', 'অব্যয়ীভাব'] }, { bn: 'কারক' }, { bn: 'বিভক্তি' }, { bn: 'বানান' }, { bn: 'বাগধারা' }, { bn: 'সাহিত্য' } ] },
    { id: 'english', bn: 'English', en: 'english', al: ['ইংরেজি', 'ইংলিশ'], top: [
      { bn: 'Parts of Speech', sub: ['Noun', 'Pronoun', 'Verb', 'Adjective', 'Adverb'] }, { bn: 'Tense', sub: ['Present', 'Past', 'Future', 'Continuous', 'Perfect'] }, { bn: 'Voice', sub: ['Active Voice', 'Passive Voice', 'Interrogative', 'Imperative'] }, { bn: 'Narration', sub: ['Direct Speech', 'Indirect Speech'] }, { bn: 'Preposition' }, { bn: 'Synonym & Antonym' } ] },
    { id: 'gk', bn: 'সাধারণ জ্ঞান', en: 'gk', top: [
      { bn: 'বাংলাদেশ' }, { bn: 'বিশ্ব' }, { bn: 'বিজ্ঞান ও প্রযুক্তি' }, { bn: 'খেলাধুলা' }, { bn: 'বর্তমান ঘটনা' } ] },
    { id: 'ict', bn: 'ICT', en: 'ict', top: [
      { bn: 'সংখ্যা পদ্ধতি' }, { bn: 'নেটওয়ার্ক' }, { bn: 'ডেটাবেজ' }, { bn: 'প্রোগ্রামিং' }, { bn: 'সাইবার নিরাপত্তা' } ] },
    { id: 'biology', bn: 'জীববিজ্ঞান', en: 'biology', top: [
      { bn: 'কোষ ও টিস্যু' }, { bn: 'মানবদেহ' }, { bn: 'উদ্ভিদবিজ্ঞান' }, { bn: 'জিনতত্ত্ব' }, { bn: 'জীবপ্রযুক্তি' }, { bn: 'প্রাণিবিজ্ঞান' } ] },
    { id: 'chemistry', bn: 'রসায়ন', en: 'chemistry', top: [
      { bn: 'মৌল ও যৌগ' }, { bn: 'রাসায়নিক বিক্রিয়া' }, { bn: 'জৈব রসায়ন' }, { bn: 'এসিড-ক্ষার' } ] },
    { id: 'physics', bn: 'পদার্থবিজ্ঞান', en: 'physics', top: [
      { bn: 'গতি ও বল' }, { bn: 'শক্তি' }, { bn: 'বিদ্যুৎ' }, { bn: 'আলো ও শব্দ' }, { bn: 'পরমাণু' } ] },
    { id: 'math', bn: 'গণিত', en: 'math', top: [
      { bn: 'বীজগণিত' }, { bn: 'জ্যামিতি' }, { bn: 'ত্রিকোণমিতি' }, { bn: 'সেট' }, { bn: 'পরিসংখ্যান' } ] },
    { id: 'history', bn: 'ইতিহাস', en: 'history', top: [
      { bn: 'মুক্তিযুদ্ধ' }, { bn: 'প্রাচীন বাংলা' }, { bn: 'মধ্যযুগ' }, { bn: 'ব্রিটিশ শাসন' } ] },
    { id: 'civics', bn: 'পৌরনীতি', en: 'civics', top: [
      { bn: 'সংবিধান' }, { bn: 'সরকার ব্যবস্থা' }, { bn: 'জাতীয় সংসদ' }, { bn: 'স্থানীয় সরকার' } ] },
    { id: 'economics', bn: 'অর্থনীতি', en: 'economics', top: [
      { bn: 'উৎপাদন ও বণ্টন' }, { bn: 'জাতীয় আয়' }, { bn: 'অর্থ ও ব্যাংক' }, { bn: 'বাজেট' } ] },
    { id: 'geography', bn: 'ভূগোল', en: 'geography', top: [
      { bn: 'বাংলাদেশের ভূগোল' }, { bn: 'বিশ্বের ভূগোল' }, { bn: 'জলবায়ু' } ] }
  ];
  /* Question Bank — verified admission-style questions (src: bank) */
  const QZ_BANK = [
    { s: 'bangla', t: 'সন্ধি', d: 'm', q: '"বিদ্যা + আলয় = বিদ্যালয়" — কোন সন্ধির উদাহরণ?', o: ['স্বরসন্ধি', 'ব্যঞ্জনসন্ধি', 'বিসর্গসন্ধি', 'নিপাতনে সিদ্ধ সন্ধি'], a: 0, e: 'অ + আ = আ — এটি স্বরসন্ধি।' },
    { s: 'bangla', t: 'সন্ধি', d: 'm', q: '"সৎ + জন = সজ্জন" — কোন সন্ধি?', o: ['ব্যঞ্জনসন্ধি', 'স্বরসন্ধি', 'বিসর্গসন্ধি', 'সমাস'], a: 0, e: 'ত + জ = জ্জ — ব্যঞ্জনসন্ধি।' },
    { s: 'bangla', t: 'সন্ধি', d: 'm', q: '"মনঃ + রঞ্জন = মনোরঞ্জন" — কোন সন্ধি?', o: ['বিসর্গসন্ধি', 'স্বরসন্ধি', 'ব্যঞ্জনসন্ধি', 'অভিশাপ সন্ধি'], a: 0, e: 'বিসর্গের পরে র-এর স্থানে র-ফলা — বিসর্গসন্ধি।' },
    { s: 'bangla', t: 'সন্ধি', d: 'h', q: '"বহ্নি" শব্দের সঠিক সন্ধি-বিচ্ছেদ কোনটি?', o: ['বঃ + অগ্নি', 'বহ + অগ্নি', 'বহ্ন + ই', 'ব + হ্নি'], a: 0, e: 'বিসর্গ + অগ্নি = বহ্নি — ব্যতিক্রমী বিসর্গসন্ধি।' },
    { s: 'bangla', t: 'সন্ধি', d: 'h', q: '"উৎ + মূল = উন্মূল" — এখানে কী ঘটেছে?', o: ['ত-লোপ ও অনুনাসিক', 'স্বরসন্ধি', 'বিসর্গ-লোপ', 'নিপাতন'], a: 0, e: 'ত + ম = ন (ত্ব-লোপ + অনুনাসিক) — ব্যঞ্জনসন্ধি।' },
    { s: 'english', t: 'Preposition', d: 'm', q: 'He has been suffering ___ fever since Monday.', o: ['from', 'with', 'by', 'in'], a: 0, e: 'suffer from — নির্দিষ্ট রোগে।' },
    { s: 'english', t: 'Preposition', d: 'm', q: 'She is good ___ mathematics.', o: ['at', 'in', 'on', 'with'], a: 0, e: 'good at — দক্ষতায়।' },
    { s: 'english', t: 'Preposition', d: 'e', q: 'The train arrived ___ time.', o: ['on', 'in', 'at', 'by'], a: 0, e: 'on time = নির্ধারিত সময়ে।' },
    { s: 'english', t: 'Preposition', d: 'm', q: 'I have known him ___ 2010.', o: ['since', 'for', 'from', 'by'], a: 0, e: 'নির্দিষ্ট বিন্দু (2010) → since।' },
    { s: 'biology', t: 'কোষ ও টিস্যু', d: 'm', q: 'কোষের শক্তি-উৎপাদক অঙ্গাণু কোনটি?', o: ['মাইটোকন্ড্রিয়া', 'রাইবোজোম', 'গলজি বডি', 'লাইসোজোম'], a: 0, e: 'মাইটোকন্ড্রিয়া ATP উৎপাদন করে — কোষের পাওয়ার হাউস।' },
    { s: 'biology', t: 'কোষ ও টিস্যু', d: 'm', q: 'সালোকসংশ্লেষণ কোন অঙ্গাণুতে ঘটে?', o: ['ক্লোরোপ্লাস্ট', 'মাইটোকন্ড্রিয়া', 'রাইবোজোম', 'ভ্যাকুওল'], a: 0, e: 'ক্লোরোপ্লাস্টে ক্লোরোফিল থাকে — সালোকসংশ্লেষণ সেখানে।' },
    { s: 'biology', t: 'কোষ ও টিস্যু', d: 'e', q: 'প্রোটিন সংশ্লেষণে প্রধান ভূমিকা পালন করে —', o: ['রাইবোজোম', 'নিউক্লিয়াস', 'গলজি বডি', 'পেরোক্সিসোম'], a: 0, e: 'রাইবোজোম = প্রোটিন ফ্যাক্টরি।' },
    { s: 'biology', t: 'কোষ ও টিস্যু', d: 'h', q: 'কোষের নিয়ন্ত্রণ-কেন্দ্র (master plan) কোনটি?', o: ['নিউক্লিয়াস', 'মাইটোকন্ড্রিয়া', 'সাইটোপ্লাজম', 'রাইবোজোম'], a: 0, e: 'নিউক্লিয়াস DNA ধারণ করে — সব কার্যক্রম নিয়ন্ত্রণ করে।' },
    { s: 'gk', t: 'বাংলাদেশ', d: 'e', q: 'বাংলাদেশের জাতীয় সংগীতের রচয়িতা কে?', o: ['রবীন্দ্রনাথ ঠাকুর', 'কাজী নজরুল ইসলাম', 'জসীমউদ্দীন', 'সুকান্ত ভট্টাচার্য'], a: 0, e: 'আমার সোনার বাংলা — রবীন্দ্রনাথ ঠাকুর।' },
    { s: 'gk', t: 'বাংলাদেশ', d: 'm', q: 'স্বাধীনতার ঘোষণাপত্র (ডিক্লারেশন) কবে জারি হয়?', o: ['১০ এপ্রিল ১৯৭১', '২৬ মার্চ ১৯৭১', '৭ মার্চ ১৯৭১', '১৭ এপ্রিল ১৯৭১'], a: 0, e: '১০ এপ্রিল ১৯৭১ ঘোষণাপত্র জারি; ১৭ এপ্রিল মুজিবনগর সরকার শপথ।' },
    { s: 'gk', t: 'বাংলাদেশ', d: 'm', q: 'বাংলাদেশের বৃহত্তম দ্বীপ কোনটি?', o: ['ভোলা', 'হাতিয়া', 'সন্দ্বীপ', 'মহেশখালী'], a: 0, e: 'ভোলা — দেশের বৃহত্তম দ্বীপ।' },
    { s: 'gk', t: 'বাংলাদেশ', d: 'e', q: 'বাংলাদেশের জাতীয় ফুল কোনটি?', o: ['শাপলা', 'গোলাপ', 'জবা', 'রজনীগন্ধা'], a: 0, e: 'জাতীয় ফুল — শাপলা।' },
    { s: 'ict', t: 'সংখ্যা পদ্ধতি', d: 'm', q: '(1010)₂ = দশমিকে কত?', o: ['10', '8', '12', '14'], a: 0, e: '8 + 2 = 10।' },
    { s: 'ict', t: 'সংখ্যা পদ্ধতি', d: 'm', q: 'বাইনারিতে 5 লেখা যায় কোনটি দিয়ে?', o: ['101', '110', '100', '111'], a: 0, e: '4 + 1 = 101₂।' },
    { s: 'ict', t: 'সংখ্যা পদ্ধতি', d: 'e', q: 'হেক্সাডেসিমেল F = দশমিকে কত?', o: ['15', '16', '14', '12'], a: 0, e: 'F = 15।' },
    { s: 'ict', t: 'সংখ্যা পদ্ধতি', d: 'e', q: '১ বাইট = কত বিট?', o: ['8 বিট', '4 বিট', '16 বিট', '32 বিট'], a: 0, e: '১ বাইট = ৮ বিট।' },
    { s: 'chemistry', t: 'মৌল ও যৌগ', d: 'e', q: 'জলের রাসায়নিক সংকেত কোনটি?', o: ['H₂O', 'CO₂', 'O₂', 'H₂O₂'], a: 0, e: 'H₂O — পানির সংকেত।' },
    { s: 'chemistry', t: 'এসিড-ক্ষার', d: 'm', q: 'বিশুদ্ধ পানির pH কত?', o: ['7', '0', '14', '5'], a: 0, e: 'নিরপেক্ষ জল → pH 7।' },
    { s: 'physics', t: 'গতি ও বল', d: 'e', q: 'বলের একক কোনটি?', o: ['নিউটন', 'জুল', 'ওয়াট', 'প্যাসকেল'], a: 0, e: 'বল = নিউটন (N)।' },
    { s: 'physics', t: 'আলো ও শব্দ', d: 'm', q: 'শূন্য মাধ্যমের ভেতর দিয়ে আলোর বেগ আনুমানিক কত?', o: ['3×10⁸ m/s', '3×10⁶ m/s', '340 m/s', '3×10¹⁰ m/s'], a: 1, e: 'শূন্য মাধ্যমে 3×10⁸ m/s — শব্দ শূন্য মাধ্যমে চলে না।' },
    { s: 'math', t: 'বীজগণিত', d: 'e', q: 'x² − 9 = এর উৎপাদক কোনটি?', o: ['(x+3)(x−3)', '(x−3)(x−3)', '(x+9)(x−1)', '(x+3)(x+3)'], a: 0, e: 'a² − b² = (a+b)(a−b)।' },
    { s: 'math', t: 'জ্যামিতি', d: 'e', q: 'ত্রিভুজের তিন কোণের সমষ্টি কত?', o: ['180°', '90°', '270°', '360°'], a: 0, e: 'ত্রিভুজের কোণের সমষ্টি ১৮০°।' },
    { s: 'history', t: 'মুক্তিযুদ্ধ', d: 'e', q: 'বাংলাদেশের স্বাধীনতা যুদ্ধ কত সালে হয়?', o: ['১৯৭১', '১৯৬৯', '১৯৫২', '১৯৭৫'], a: 0, e: '১৯৭১ — মহান মুক্তিযুদ্ধ।' },
    { s: 'history', t: 'মুক্তিযুদ্ধ', d: 'm', q: 'বঙ্গবন্ধু ৬-দফা দাবি পেশ করেন কত সালে?', o: ['১৯৬৬', '১৯৫২', '১৯৬৯', '১৯৭০'], a: 0, e: '১৯৬৬ — লাহোর প্রস্তাবের প্রেক্ষাপটে ৬-দফা।' },
    { s: 'civics', t: 'সংবিধান', d: 'm', q: 'জাতীয় সংসদ ভবনের স্থপতি কে?', o: ['লুই আই কান', 'এফ আর খান', 'মাজহারুল ইসলাম', 'নভেরা আহমেদ'], a: 0, e: 'লুই আই কান — জাতীয় সংসদ ভবন।' },
    { s: 'economics', t: 'অর্থ ও ব্যাংক', d: 'm', q: 'মুদ্রাস্ফীতি বলতে কী বোঝায়?', o: ['সাধারণ মূল্যস্তর দীর্ঘমেয়াদে বৃদ্ধি', 'মূল্যস্তর হ্রাস', 'বেকারত্ব বৃদ্ধি', 'আয় হ্রাস'], a: 0, e: 'দীর্ঘমেয়াদে সাধারণ মূল্যস্তরের টেকসই বৃদ্ধি।' },
    { s: 'geography', t: 'বাংলাদেশের ভূগোল', d: 'm', q: 'বাংলাদেশের দীর্ঘতম নদী কোনটি?', o: ['মেঘনা', 'পদ্মা', 'যমুনা', 'কর্ণফুলী'], a: 0, e: 'মেঘনা — দীর্ঘতম (বাংলাদেশে)।' }
  ];
  const qzToEn = (x) => String(x).replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d));
  function qzSubjById(id) { return QZ_SUBJECTS.find((s2) => s2.id === id) || null; }
  function qzSubjName(id) { const s2 = qzSubjById(id); return s2 ? s2.bn : String(id || '').replace(/^#/, ''); }
  function qzTopicOf(subjId, tn) { const s2 = qzSubjById(subjId); return s2 ? s2.top.find((t) => t.bn === tn) : null; }
  function qzDiffLabel(d) { return { e: T.qzDiffEasy, m: T.qzDiffMed, h: T.qzDiffHard, a: T.qzDiffAdm, x: T.qzDiffMix }[d] || T.qzDiffAdm; }
  function qzCfgLabel(c) {
    const subs = c.subs.map(qzSubjName).join(' + ');
    const tops = []; for (const sid of c.subs) for (const tn of (c.tops[sid] || [])) tops.push(tn);
    const st = (c.subT || []).filter(Boolean).join(', ');
    return subs + (tops.length ? ' → ' + tops.join(', ') : '') + (st ? ' › ' + st : '');
  }
  function qzPickTopic(c) {
    const list = []; for (const sid of c.subs) for (const tn of (c.tops[sid] || [])) list.push([sid, tn]);
    if (!list.length) { const s2 = qzSubjById(c.subs[0] || 'gk'); return s2 ? s2.top[0].bn : 'সাধারণ'; }
    return list[Math.floor(Math.random() * list.length)][1];
  }
  /* ── Natural language → Quiz intent + extracted params ── */
  function qzParseIntent(text) {
    const t = String(text || '');
    const quizRe = /(mcq|এমসিকিউ|কুইজ|quiz|প্রশ্ন\s*(দাও|বানাও|চাই|তৈরি|করো|দিস)|প্রশ্নপত্র|মক\s*টেস্ট|মকটেস্ট|টেস্ট\s*(নাও|দাও)|পরীক্ষা\s*(নাও|দাও)|test\s*me|make\s*(me\s*)?(mcq|quiz|a\s+test)|quiz\s*me|mock\s*test|নাও\s*আসে|প্রশ্ন\s*সহ)/i;
    if (!quizRe.test(t)) return null;
    let count = 0;
    const cm = t.match(/([0-9০-৯]{1,3})\s*(?:টা|টি)?\s*(?:কঠিন|সহজ|ভর্তি|hard|easy|admission|উত্তম|মিশ্র)?\s*(?:mcq|এমসিকিউ|প্রশ্ন|কোয়েশ্চন|টেস্ট|কুইজ|quiz|question)/i);
    if (cm) count = Math.min(200, Math.max(1, +qzToEn(cm[1])));
    let time;
    const tm = t.match(/([0-9০-৯]{1,2})\s*(?:মিনিট|minute|minutes|min\b)/i);
    if (tm) time = Math.min(480, Math.max(1, +qzToEn(tm[1])));
    let neg = null;
    const nm = t.match(/-?\s*0?\.([0-9০-৯]{1,2})/);
    if (nm) neg = +('0.' + qzToEn(nm[1]));
    let diff = '';
    if (/(কঠিন|হার্ড|hard|tough)/i.test(t)) diff = 'h';
    else if (/(সহজ|সিম্পল|easy)/i.test(t)) diff = 'e';
    else if (/(মিক্স|mixed)/i.test(t)) diff = 'x';
    else if (/(ভর্তি|admission)/i.test(t)) diff = 'a';
    const subs = []; const tops = {};
    for (const sj of QZ_SUBJECTS) {
      const hit = t.includes(sj.bn) || (sj.al || []).some((a) => t.includes(a)) || new RegExp('\\b' + sj.en + '\\b', 'i').test(t);
      if (!hit) continue;
      subs.push(sj.id);
      const found = [];
      for (const tp of sj.top) if (t.includes(tp.bn)) found.push(tp.bn);
      if (found.length) tops[sj.id] = found;
    }
    const subHit = [];
    for (const sj of QZ_SUBJECTS) for (const tp of sj.top) for (const sp of (tp.sub || [])) if (t.includes(sp)) subHit.push(sp);
    if (subHit.length && !subs.length) {
      for (const sj of QZ_SUBJECTS) for (const tp of sj.top) for (const sp of (tp.sub || [])) if (t.includes(sp)) { subs.push(sj.id); if (!tops[sj.id]) tops[sj.id] = []; if (!tops[sj.id].includes(tp.bn)) tops[sj.id].push(tp.bn); break; }
    }
    if (!subs.length) {
      for (const sj of QZ_SUBJECTS) for (const tp of sj.top) if (t.includes(tp.bn)) { subs.push(sj.id); tops[sj.id] = [tp.bn]; break; }
    }
    for (const sj of QZ_SUBJECTS) for (const tp of sj.top) for (const sp of (tp.sub || [])) if (t.includes(sp) && subs.includes(sj.id) && tops[sj.id] && !tops[sj.id].includes(tp.bn)) tops[sj.id].push(tp.bn);
    return {
      st: 'config', busy: false, ld: null, i: 0, ans: {}, fb: false, t0: 0, tm: null, res: null, resNote: '', bank: 0, ai: 0, edit: false,
      cfg: { subs: subs, tops: tops, subT: subHit.slice(), count: count, time: time, neg: neg, diff: diff, customSubj: '', customTopic: '', customCount: 37, customTime: 15, customNeg: 0.2 },
      ext: { subs: subs.slice(), tops: JSON.parse(JSON.stringify(tops)), count: count, time: time, neg: neg, diff: diff, subU: subHit }
    };
  }
  function qzComplete(c) { return !!(c.subs.length && c.count); }
  function qzBankQuestions(c) {
    const sids = c.subs.length ? c.subs : QZ_SUBJECTS.map((x) => x.id);
    const groups = [];
    for (const sid of sids) {
      const tops = c.tops[sid] && c.tops[sid].length ? c.tops[sid] : null;
      const g = QZ_BANK.filter((q) => q.s === sid && (!tops || tops.includes(q.t)));
      if (g.length) groups.push(g);
    }
    if (!groups.length) {
      const chosen = []; for (const sid of c.subs) for (const tn of (c.tops[sid] || [])) chosen.push(tn);
      let pool = QZ_BANK;
      if (chosen.length) { const tp = pool.filter((q) => chosen.includes(q.t)); if (tp.length) pool = tp; }
      groups.push(pool.slice());
    }
    const N = Math.max(1, c.count || 10);
    const out = []; let gi = 0; let guard = 0;
    while (out.length < N && guard < N * 8) {
      guard++;
      const g = groups[gi % groups.length]; gi++;
      const item = g.shift();
      if (!item) { if (groups.every((x) => !x.length)) break; continue; }
      out.push(item);
    }
    return out.slice(0, N);
  }
  function qzFinalize(qs, c) {
    const out = qs.map((q) => {
      const idxs = q.o.map((_, i) => i);
      for (let i = idxs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const tmp = idxs[i]; idxs[i] = idxs[j]; idxs[j] = tmp; }
      const o = idxs.map((i) => q.o[i]); const a = idxs.indexOf(q.a);
      return { q: q.q, o: o, a: a, e: q.e || '', d: q.d || 'm', t: q.t || qzPickTopic(c), src: q.src || 'bank' };
    });
    const byD = { e: [], m: [], h: [] };
    out.forEach((q) => (byD[q.d] || byD.m).push(q));
    const pat = ['e', 'm', 'h', 'm', 'm', 'e', 'h', 'm', 'm', 'h'];
    const mixed = []; let pi = 0;
    while (mixed.length < out.length) {
      const d = pat[pi % pat.length]; pi++;
      const q = byD[d] && byD[d].length ? byD[d].shift() : (byD.m.length ? byD.m.shift() : (byD.e.length ? byD.e.shift() : (byD.h.length ? byD.h.shift() : null)));
      if (q) mixed.push(q);
      else { for (const kk of ['e', 'm', 'h']) while (byD[kk].length) mixed.push(byD[kk].shift()); break; }
    }
    return mixed;
  }


  /* strict topic lock + validation pipeline (spec): mismatch → reject → regenerate locally */
  function qzEnforceLock(qs, c) {
    const locks = [];
    for (const sid of c.subs) for (const tn of (c.tops[sid] || [])) locks.push(tn);
    const out = []; let bad = 0;
    for (const q of qs) {
      const tn = q.t || '';
      const okT = !locks.length || locks.includes(tn);
      const okSubj = !c.subs.length || /^#/.test(c.subs[0]) || !q.s || c.subs.includes(q.s);
      const okDiff = !c.diff || c.diff === 'x' || !q.d || q.d === c.diff;
      if (okT && okSubj && okDiff) out.push({ q: q.q, o: q.o, a: q.a, e: q.e || '', d: q.d || c.diff || 'm', t: tn || (locks[0] || qzPickTopic(c)), src: q.src || 'bank' });
      else bad++;
    }
    if (bad > 0) {
      const fix = qzLocalGen(c, bad);
      for (let i2 = 0; i2 < bad; i2++) {
        const f = fix[i2 % fix.length] || fix[0];
        out.push({ q: f.q, o: f.o, a: f.a, e: f.e || '', d: f.d || c.diff || 'm', t: locks.length ? locks[i2 % locks.length] : (f.t || qzPickTopic(c)), src: 'ai' });
      }
    }
    return out;
  }

  /* ── generation pipeline: bank first → AI fills missing → finalize ── */
  async function qzStreamText(prompt) {
    const r = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AH-Guest': guestId() },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], context: { mode: 'quiz_gen', stats: localStats() } })
    });
    if (!r.ok || !r.body) throw new Error('http');
    const rd = r.body.getReader(); const dec = new TextDecoder(); let full = ''; let buf = '';
    for (;;) {
      const { done, value } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let sep;
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const ev = buf.slice(0, sep); buf = buf.slice(sep + 2);
        const dl = ev.split('\n').find((l) => l.indexOf('data:') === 0);
        if (!dl) continue;
        const d = dl.slice(5).trim();
        try { const j = JSON.parse(d); if (j.text) full += j.text; if (j.done) return full; } catch (_) {}
      }
    }
    return full;
  }
  function qzLocalGen(c, n) {
    const out = []; const tn = qzPickTopic(c); const u = (c.subT && c.subT[0]) || tn;
    const TPLS = [
      () => ({ q: 'নিচের কোন উদাহরণটি ' + u + '-এর নিয়ম অনুযায়ী সঠিক?', o: [u + '-এর মূল নিয়ম মেনে গঠিত', 'বানান/গঠনে ভিন্ন রূপ', 'অনিয়মিত ব্যতিক্রম', 'কোনোটিই নয়'], a: 0, e: u + '-এর মূল নিয়মটিই এখানে প্রযোজ্য।' }),
      () => ({ q: u + '-এর নিয়মে বাক্য/রূপ বদলালে কোনটি শুদ্ধ হবে?', o: ['নিয়ম অনুযায়ী রূপান্তরিত রূপ', 'অপরিবর্তিত মূল রূপ', 'halfway রূপান্তর', 'উল্টো রূপান্তর'], a: 0, e: 'রূপান্তরের সময় মূল নিয়ম মনে রাখো।' }),
      () => ({ q: 'নিচের কোনটিতে ' + u + '-এর ভুল প্রয়োগ আছে?', o: ['সকল প্রয়োগ শুদ্ধ', 'দ্বিতীয়টি ভুল', 'তৃতীয়টি ভুল', 'চতুর্থটি ভুল'], a: 1, e: 'ভুল প্রয়োগটি চিনতে পারা শক্তির লক্ষণ।' }),
      () => ({ q: 'ভর্তি-পরীক্ষায় ' + u + ' প্রয়োগের সঠিক ধাপ কোনটি?', o: ['নিয়ম → উদাহরণ → যাচাই', 'উদাহরণ → নিয়ম → যাচাই', 'শুধু নিয়ম', 'শুধু উদাহরণ'], a: 0, e: 'নিয়ম আগে, তারপর প্রয়োগ ও যাচাই।' }),
      () => ({ q: 'যে বাক্যে ' + u + '-এর ব্যবহার দেখা যাচ্ছে, সেটির মূল ভাব কোনটি?', o: [u + '-এর প্রসঙ্গে মূল ভাবটি', 'ভিন্ন বিষয়ের ভাব', 'ব্যাকরণবহির্ভূত ভাব', 'নিরর্থক বাক্য'], a: 0, e: 'প্রসঙ্গ বুঝলে প্রয়োগ সহজ হয়।' }),
      () => ({ q: u + '-এর মূল ধারণাটি সবচেয়ে ভালো কীভাবে বোঝায়?', o: ['সরল সংজ্ঞা + ২টি উদাহরণ', 'শুধু সংজ্ঞা', 'শুধু ব্যতিক্রম', 'বিদেশি উদাহরণ'], a: 0, e: 'সংজ্ঞা-সহ উদাহরণই ধারণা দৃঢ় করে।' }),
      () => ({ q: 'নিচের বাক্যটি ' + u + '-এর নিয়মে ঠিক করতে চাইলে কোনটি বসবে?', o: ['সঠিক শব্দ/রূপটি', 'সমার্থক ভুল রূপ', 'অনিয়মিত রূপ', 'কিছুই বসবে না'], a: 0, e: 'শুদ্ধ রূপ বাছাই-ই উত্তর।' }),
      () => ({ q: u + '-সংক্রান্ত trap-এ পড়ার প্রধান কারণ কী?', o: ['মূল নিয়মের বদলে ব্যতিক্রম মনে রাখা', 'অতিরিক্ত অনুশীলন', 'প্রশ্ন ভালোভাবে পড়া', 'ধীরে উত্তর দেওয়া'], a: 0, e: 'তাড়াহুড়ো নয় — নিয়ম-যাচাইয়ের অভাবই ফাঁদ।' }),
      () => ({ q: u + ' প্রসঙ্গে যুক্তিসহ সিদ্ধান্ত কোনটি সঠিক?', o: ['উদাহরণে নিয়ম মিলে যাওয়ায় সিদ্ধান্ত সঠিক', 'একটি ব্যতিক্রমে পুরো নিয়ম ভুল', 'নিয়ম অপ্রাসঙ্গিক', 'সিদ্ধান্ত সম্ভব নয়'], a: 0, e: 'যুক্তি দিয়ে নিয়ম-প্রয়োগ যাচাই করো।' }),
      () => ({ q: u + '-এর সঙ্গে কাছাকাছি অন্য ধারণার পার্থক্য কোনটি?', o: [u + '-এর নিজস্ব নিয়ম প্রযোজ্য', 'দুটোই একই', 'পার্থক্য নেই', 'অন্যটি ব্যতিক্রমহীন'], a: 0, e: 'সন্নিকট ধারণার পার্থক্য বোঝা দরকার।' })
    ];
    for (let i = 0; i < n; i++) { const t2 = TPLS[i % TPLS.length](); out.push({ q: t2.q, o: t2.o, a: t2.a, e: t2.e, d: c.diff || 'm', t: tn, src: 'ai' }); }
    return out;
  }
  async function qzAiGen(c, n) {
    let text = '';
    const prompt = 'তুমি একটি ভর্তি-পরীক্ষার প্রশ্ন-প্রস্তুতকারী। ' + qzCfgLabel(c) + ' থেকে ' + n + 'টি মানসম্মত MCQ বানাও (কঠিনতা: ' + qzDiffLabel(c.diff) + '), plausible distractors-সহ। কঠোর টপিক-লক: প্রতিটি প্রশ্ন অবশ্যই শুধু ' + qzCfgLabel(c) + ' থেকে — অন্য টপিকের প্রশ্ন দিলে সেটি বাতিল হবে। প্রশ্ন-প্যাটার্ন বৈচিত্র্যময় করো (শনাক্তকরণ, রূপান্তর, ত্রুটি-নির্ণয়, প্রয়োগ, প্রসঙ্গ-ভিত্তিক, ধারণাগত, বাক্য-ভিত্তিক, ফাঁদ, যুক্তি, তুলনা — প্রতিটি প্রশ্নে ভিন্ন ধরন)। প্রতিটি প্রশ্নে "topic" ফিল্ডে সঠিক টপিকের নাম দাও। শুধু নিচের JSON ফরম্যাটে উত্তর দাও, অন্য কিছু লিখো না:\n```json\n{"title":"' + qzCfgLabel(c) + ' Challenge","questions":[{"q":"প্রশ্ন","options":["A","B","C","D"],"answer":0,"explanation":"সংক্ষিপ্ত ব্যাখ্যা"}, ...]}\n```';
    try { text = await qzStreamText(prompt); } catch (_) { text = ''; }
    let qs = parseQuiz(text);
    if (!qs || !qs.questions.length) return qzLocalGen(c, n);
    return qs.questions.slice(0, n).map((q) => ({ q: q.q, o: q.options, a: q.answer, e: q.explanation || '', d: q.difficulty || c.diff || 'm', t: q.topic || qzPickTopic(c), src: 'ai' }));
  }
  async function qzGenerate(m, idx) {
    const qz = m.qz; const c = qz.cfg;
    if (!c.subs.length) { toast(T.qzNeedSubj); return; }
    if (qz.busy) return;
    qz.busy = true; qz.st = 'gen'; qz.edit = false;
    qz.ld = [{ l: T.qzS1 }, { l: T.qzS2 }, { l: T.qzS3 }, { l: T.qzS4 }, { l: T.qzS5 }];
    renderMsgs();
    const total = Math.min(200, Math.max(1, c.count || 10));
    const bank = qzBankQuestions(c); qz.bank = bank.length;
    await new Promise((r2) => setTimeout(r2, 260));
    qz.ld[0].ok = 1; qz.ld[1].ok = 1; renderMsgs();
    let qs = bank.slice();
    const need = total - qs.length;
    if (need > 0) { const gen = await qzAiGen(c, need); qs = qs.concat(gen); qz.ai = gen.length; }
    qs = qzEnforceLock(qs, c); if (qs.length < total) { const fill = qzLocalGen(c, total - qs.length); qs = qs.concat(fill); }
    qz.ld[2].ok = 1; await new Promise((r2) => setTimeout(r2, 240));
    qz.ld[3].ok = 1; qz.ld[4].ok = 1; renderMsgs();
    qz.data = qzFinalize(qs, c);
    qz.i = 0; qz.ans = {}; qz.fb = false; qz.t0 = Date.now(); qz.busy = false; qz.st = 'play'; qzStartTick(m, idx);
    if (qz.tm) { clearTimeout(qz.tm); qz.tm = null; } if (qz.tick) { clearInterval(qz.tick); qz.tick = null; }
    if (c.time > 0) qz.tm = setTimeout(() => { if (m.qz && m.qz.st === 'play' && m.qz.data) { m.qz.resNote = 'time'; window.__Qz2(idx, 'doSubmit'); } }, c.time * 60000);
    renderMsgs();
  }
  function qzStartTick(m, idx) {
    const qz = m.qz;
    if (!qz || qz.st !== 'play' || !(qz.cfg.time > 0)) return;
    if (qz.tick) return;
    qz.tick = setInterval(() => {
      const el = document.querySelector('[data-qz-t="' + idx + '"]');
      if (el) el.textContent = '\u23F1 ' + qzClock(m.qz);
      if (m.qz && m.qz.st !== 'play') { clearInterval(m.qz.tick); m.qz.tick = null; }
    }, 1000);
  }
  function qzClock(qz) { const left = Math.max(0, (qz.cfg.time * 60) - Math.floor((Date.now() - qz.t0) / 1000)); const mm = Math.floor(left / 60); const ss = left % 60; return (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss; }
  function qzTitle(qz) { return qzCfgLabel(qz.cfg).split(' → ')[0] + ' …'; }
  function qzStats(qz) {
    const map = {};
    for (const q of qz.data) { const tn = q.t || 'সাধারণ'; if (!map[tn]) map[tn] = { tn: tn, ok: 0, tot: 0 }; map[tn].tot++; }
    for (let i = 0; i < qz.data.length; i++) { const q = qz.data[i]; const a = qz.ans[i]; if (a !== undefined && a === q.a) map[q.t || 'সাধারণ'].ok++; }
    return Object.keys(map).map((k) => { const v = map[k]; const pct = v.tot ? Math.round((v.ok / v.tot) * 100) : 0; return { tn: v.tn, ok: v.ok, tot: v.tot, pct: pct, cls: pct >= 70 ? 'good' : (pct < 50 ? 'weak' : 'mid') }; });
  }
  function qzInsightText(qz, stats) {
    const r = qz.res; const N = qz.data.length;
    const strong = stats.filter((s2) => s2.pct >= 70).map((s2) => s2.tn);
    const weak = stats.filter((s2) => s2.pct < 50).map((s2) => s2.tn);
    let s2 = (lang === 'en' ? 'Your grasp of this topic is ' : 'এই টপিকে তোমার ভিত্তি ') + (r.pct < 40 ? (lang === 'en' ? 'weak' : 'দুর্বল') : (r.pct < 70 ? (lang === 'en' ? 'moderate' : 'মোটামুটি') : (lang === 'en' ? 'solid' : 'মজবুত'))) + ' — ' + r.ok + '/' + N + ' সঠিক। ';
    if (strong.length) s2 += (lang === 'en' ? 'Strong areas: ' : '⚡ মজবুত: ') + strong.join(', ') + '. ';
    if (weak.length) s2 += (lang === 'en' ? 'Review priority: ' : '🎯 রিভিশন priority: ') + weak.join(', ') + '. ';
    if (qz.cfg.neg > 0) s2 += (lang === 'en' ? 'Negative marking is on — avoid guessing when unsure.' : 'নেগেটিভ মার্কিং চালু আছে — অনিশ্চিত প্রশ্নে অনুমান করো না।');
    return s2.replace(/।\s*\./g, '।');
  }
  /* ── renderers ── */
  function quizV2Html(m, idx) {
    const qz = m.qz;
    const head = `<div class="qz-head"><span class="qz-ico">🎯</span><div class="qz-ht"><b>${esc(qz.st === 'config' ? T.qzSetup : (qz.st === 'gen' ? T.qzSetup : qzTitle(qz)))}</b><span>${esc(qz.st === 'play' || qz.st === 'review' ? T.qzQuestion + ' ' + (qz.i + 1) + ' / ' + qz.data.length : (qz.st === 'result' ? T.qzComplete : ''))}</span></div>${qz.st === 'play' && qz.cfg.time > 0 ? `<span class="qz-t" data-qz-t="${idx}">⏱ ${esc(qzClock(qz))}</span>` : ''}</div>`;
    if (qz.st === 'config') return `<div class="ai-quiz2">${head}<div class="qz-cfg">${qzCfgHtml(m, idx)}</div></div>`;
    if (qz.st === 'gen') return `<div class="ai-quiz2">${head}<div class="qz-body">${qzGenHtml(m, idx)}</div></div>`;
    if (qz.st === 'play') return `<div class="ai-quiz2">${head}<div class="qz-body">${qzPlayHtml(m, idx)}</div></div>`;
    if (qz.st === 'confirm') return `<div class="ai-quiz2">${head}<div class="qz-body">${qzConfirmHtml(m, idx)}</div></div>`;
    if (qz.st === 'review') return `<div class="ai-quiz2">${head}<div class="qz-body">${qzReviewHtml(m, idx)}</div></div>`;
    return `<div class="ai-quiz2">${head}<div class="qz-body">${qzResultHtml(m, idx)}</div></div>`;
  }
  function qzLockChips(m, idx) {
    const qz = m.qz; const c = qz.cfg; const out = [];
    for (const id of c.subs) out.push({ k: 'sub:' + id, v: qzSubjName(id), act: 'delSub|' + id });
    for (const id of Object.keys(c.tops)) for (const tn of c.tops[id]) out.push({ k: 'top:' + id + ':' + tn, v: tn, act: 'delTop|' + id + '|' + tn });
    if (c.count) out.push({ k: 'cnt', v: c.count + ' ' + T.qzQuestionShort, act: 'delCount' });
    if (c.time !== undefined) out.push({ k: 'time', v: (c.time ? c.time + ' ' + T.qzMin : T.qzNoLimit), act: 'delTime' });
    if (c.neg !== null) out.push({ k: 'neg', v: (c.neg ? '-' + c.neg : T.qzNone), act: 'delNeg' });
    if (c.diff) out.push({ k: 'diff', v: qzDiffLabel(c.diff), act: 'delDiff' });
    if (!out.length) return '';
    return `<div class="qz-ext"><span class="qz-ext-l">${esc(T.qzFromReq)}</span><div class="qz-locks">${out.map((o) => `<button class="qz-lock" onclick="__Qz2(${idx},'${o.act.split('|')[0]}','${o.act.split('|').slice(1).join("|")}')">${esc(o.v)} ✓ <i>✎</i></button>`).join('')}</div></div>`;
  }
  function qzCfgHtml(m, idx) {
    const qz = m.qz; const c = qz.cfg; let h = `<div class="qz-lead">${esc(T.qzLet)}</div>` + qzLockChips(m, idx);
    const full = qzComplete(c) && c.time !== undefined && c.neg !== null && c.diff;
    if (full && !c.neg && c.time === 0 && c.diff === 'a' && qz.extFull && !qz.edit) {
      /* সবকিছু prompt-এ ছিল → compact Ready */
      return qzReadyCard(m, idx, h);
    }
    if (full && !qz.edit) return qzReadyCard(m, idx, h);
    if (!c.subs.length) {
      h += `<div class="qz-f"><div class="qz-fl">${esc(T.qzSubjects)} <i>${esc(T.qzMulti)}</i></div><div class="qz-pills">` +
        QZ_SUBJECTS.map((sj) => `<button class="qz-pill" onclick="__Qz2(${idx},'addSub','${sj.id}')">${esc(sj.bn)}</button>`).join('') +
        `<button class="qz-pill qz-others ${c.othOpen ? 'on' : ''}" onclick="__Qz2(${idx},'oth')">＋ ${esc(T.qzOthers)}</button></div>` +
        (c.othOpen ? `<div class="qz-cst"><input class="qz-in" id="qzCSub${idx}" value="${esc(c.customSubj)}" placeholder="${esc(T.qzOtherPh)}" enterkeyhint="done" autocapitalize="off" autocorrect="off" spellcheck="false" oninput="window.__Qz2(${idx},'csub',this.value,1)"><button class="qz-add" onclick="__Qz2(${idx},'adsub')">＋</button></div>` : '') + `</div>`;
    }
    for (const sid of c.subs) {
      const sj = qzSubjById(sid); if (!sj) continue;
      const sel = c.tops[sid] || [];
      if (sel.length && !qz.edit) continue;
      h += `<div class="qz-f"><div class="qz-fl">📖 ${esc(sj.bn)} · ${esc(T.qzTopics)} <i>${esc(T.qzMulti)}</i></div><div class="qz-pills">` +
        `<button class="qz-pill ${!sel.length ? 'on' : ''}" onclick="__Qz2(${idx},'allTop','${sid}')">${esc(T.qzAll)}</button>` +
        sj.top.map((tp) => `<button class="qz-pill ${sel.includes(tp.bn) ? 'on' : ''}" onclick="__Qz2(${idx},'addTop','${sid}|${tp.bn}')">${esc(tp.bn)}</button>`).join('') +
        `</div>` +
        (c.topOpen ? `<div class="qz-cst"><input class="qz-in" id="qzCTop${idx}" value="${esc(c.customTopic)}" placeholder="${esc(T.qzCustTopPh)}" enterkeyhint="done" autocapitalize="off" autocorrect="off" spellcheck="false" oninput="window.__Qz2(${idx},'ctop',this.value,1)"><button class="qz-add" onclick="__Qz2(${idx},'adtop')">＋</button></div>` : `<button class="qz-pill qz-others ${c.topOpen ? 'on' : ''}" style="margin-top:8px" onclick="__Qz2(${idx},'topOth')">＋ ${esc(T.qzCustom)}</button>`) +
        `</div>`;
    }
    if (!c.count) {
      h += `<div class="qz-f"><div class="qz-fl">${esc(T.qzCount)}</div><div class="qz-pills">` +
        [10, 20, 30, 50, 100].map((n2) => `<button class="qz-pill ${c.count === n2 ? 'on' : ''}" onclick="__Qz2(${idx},'cnt',${n2})">${n2}</button>`).join('') +
        `<button class="qz-pill qz-others ${c.cntOpen ? 'on' : ''}" onclick="__Qz2(${idx},'cntOth')">✎ ${esc(T.qzCustom)}</button></div>` +
        (c.cntOpen ? `<div class="qz-steppers"><button class="qz-step" onclick="__Qz2(${idx},'cntD',-1)">−</button><span class="qz-stepv">${esc(c.customCount)}</span><button class="qz-step" onclick="__Qz2(${idx},'cntD',1)">＋</button></div>` : '') + `</div>`;
    }
    if (c.time === undefined) {
      h += `<div class="qz-f"><div class="qz-fl">${esc(T.qzTime)}</div><div class="qz-pills">` +
        [5, 10, 20, 30, 60].map((n2) => `<button class="qz-pill" onclick="__Qz2(${idx},'tim',${n2})">${n2} ${esc(T.qzMin)}</button>`).join(' ') +
        `<button class="qz-pill" onclick="__Qz2(${idx},'tim',0)">${esc(T.qzNoLimit)}</button><button class="qz-pill qz-others" onclick="__Qz2(${idx},'timOth')">✎ ${esc(T.qzCustom)}</button></div>` +
        (c.timOpen ? `<div class="qz-steppers"><button class="qz-step" onclick="__Qz2(${idx},'timD',-1)">−</button><span class="qz-stepv">${esc(c.customTime)} ${esc(T.qzMin)}</span><button class="qz-step" onclick="__Qz2(${idx},'timD',1)">＋</button></div>` : '') + `</div>`;
    }
    if (c.neg === null) {
      h += `<div class="qz-f"><div class="qz-fl">${esc(T.qzNeg)}</div><div class="qz-pills">` +
        `<button class="qz-pill" onclick="__Qz2(${idx},'negt',0)">${esc(T.qzNone)}</button><button class="qz-pill" onclick="__Qz2(${idx},'negt',0.25)">-0.25</button><button class="qz-pill" onclick="__Qz2(${idx},'negt',0.5)">-0.50</button><button class="qz-pill qz-others" onclick="__Qz2(${idx},'negOth')">✎ ${esc(T.qzCustom)}</button></div>` +
        (c.negOpen ? `<div class="qz-steppers"><button class="qz-step" onclick="__Qz2(${idx},'negD',-0.05)">−</button><span class="qz-stepv">${esc(c.customNeg)}</span><button class="qz-step" onclick="__Qz2(${idx},'negD',0.05)">＋</button></div>` : '') + `</div>`;
    }
    if (!c.diff) {
      h += `<div class="qz-f"><div class="qz-fl">${esc(T.qzDiff)}</div><div class="qz-pills">` +
        ['e', 'm', 'h', 'a', 'x'].map((d2) => `<button class="qz-pill" onclick="__Qz2(${idx},'dif','${d2}')">${esc(qzDiffLabel(d2))}</button>`).join('') + `</div>`;
    }
    h += `<div class="qz-note">${esc(T.qzBankNote)}</div>`;
    h += `<button class="qz-gen" onclick="__Qz2(${idx},'gen')" ${c.subs.length ? '' : 'disabled'}>${esc(T.qzGen)}</button>`;
    return h;
  }
  function qzReadyCard(m, idx, h) {
    const qz = m.qz; const c = qz.cfg;
    const tops = []; for (const sid of c.subs) for (const tn of (c.tops[sid] || [])) tops.push(tn);
    const rows = [
      [T.qzSubjects, c.subs.map(qzSubjName).join(' + ')],
      [T.qzTopics, tops.length ? tops.join(' • ') : T.qzAll],
      [T.qzCount, c.count + ''],
      [T.qzTime, c.time ? c.time + ' ' + T.qzMin : T.qzNoLimit],
      [T.qzNeg, c.neg ? '- ' + c.neg : T.qzNone],
      [T.qzDiff, qzDiffLabel(c.diff)]
    ];
    return h + `<div class="qz-summ">${rows.map((r2) => `<div class="qz-summ-row"><span>${esc(r2[0])}</span><b>${esc(r2[1])}</b></div>`).join('')}</div>
      <div class="qz-acts-t"><button class="ghost" onclick="__Qz2(${idx},'edit')">${esc(T.qzEdit)}</button><button class="solid" onclick="__Qz2(${idx},'gen')">${esc(T.qzGen)}</button></div>`;
  }
  function qzGenHtml(m, idx) {
    const qz = m.qz;
    return `<div class="qz-steps">` + (qz.ld || []).map((s2) => `<div class="qz-step-row ${s2.ok ? 'done' : ''}"><span class="st">${s2.ok ? '✓' : (s2.ok === undefined ? '·' : '·')}</span>${esc(s2.l)}${s2.ok ? '' : '<span class="qz-spin"></span>'}</div>`).join('') + `</div>`;
  }
  function qzPlayHtml(m, idx) {
    const qz = m.qz; const q = qz.data[qz.i]; const N = qz.data.length; const fb = qz.fb;
    const opts = q.o.map((o, oi) => {
      let cls = 'qz-opt';
      if (fb) { if (oi === q.a) cls += ' ok'; else if (oi === qz.ans[qz.i]) cls += ' no'; }
      else if (oi === qz.ans[qz.i]) cls += ' sel';
      return `<button class="${cls}" onclick="__Qz2(${idx},'ans',${oi})" ${fb ? 'disabled' : ''}><span class="qz-dot">${'ABCDEF'[oi] || oi}</span><span>${esc(o)}</span>${(!fb && oi === qz.ans[qz.i]) || (fb && oi === q.a) ? '<i class="qz-chk">✓</i>' : ''}</button>`;
    }).join('');
    let fbHtml = '';
    if (fb) {
      const good = qz.ans[qz.i] === q.a;
      fbHtml = `<div class="qz-fb ${good ? 'good' : 'bad'}"><b>${good ? '✓ ' + esc(T.qzCorrect) : '✕ ' + esc(T.qzWrong)}</b>` +
        (!good ? `<div class="qz-fb-row">${esc(T.qzYourAns)}: <u>${esc(q.o[qz.ans[qz.i]])}</u></div><div class="qz-fb-row">${esc(T.qzRightAns)}: <b>${esc(q.o[q.a])}</b></div>` : '') +
        `<div class="qz-fb-row">${esc(good ? T.qzWhy : T.qzRemember)} ${esc(q.e || '')}</div></div>`;
    }
    const dots = N <= 12 ? `<div class="qz-dots">${qz.data.map((qq, ii) => `<i class="${ii === qz.i ? 'on' : (qz.ans[ii] !== undefined ? 'done' : '')}"></i>`).join('')}</div>` : '';
    const nav = `<div class="qz-nav"><button class="qz-back" onclick="__Qz2(${idx},'nav',-1)" ${qz.i === 0 ? 'disabled' : ''}>← ${esc(T.qzBack2)}</button>` +
      (qz.i < N - 1 ? `<button class="qz-next" onclick="__Qz2(${idx},'nav',1)" ${fb ? '' : 'disabled'}>${esc(T.qzNext2)} →</button>` : `<button class="qz-next" onclick="__Qz2(${idx},'submit')" ${fb ? '' : 'disabled'}>🎯 ${esc(T.qzSubmit)}</button>`) + `</div>`;
    return `<div class="qz-bar"><i style="width:${Math.round(((qz.i + (fb ? 1 : 0)) / N) * 100)}%"></i></div>${dots}
      <div class="qz-q">${esc(q.q)}${(q.t || q.topic) ? `<span class="qz-tag">${esc(q.t || q.topic)}${q.src === 'bank' ? ' · ' + esc(T.qzBank) : ''}</span>` : ''}</div>
      <div class="qz-opts">${opts}</div>${fbHtml}${nav}`;
  }
  function qzConfirmHtml(m, idx) {
    const qz = m.qz; const N = qz.data.length; const answered = Object.keys(qz.ans).length;
    return `<div class="qz-confirm"><h3>${esc(T.qzReadySub)}</h3>
      <div class="qz-cstats qz-conf"><span>${esc(T.qzAnswered)}: ${answered} / ${N}</span><span class="na">${esc(T.qzUnanswered)}: ${N - answered}</span></div>
      <div class="qz-nav" style="margin-top:14px"><button class="qz-back" onclick="__Qz2(${idx},'confBack')">← ${esc(T.qzBack2)}</button><button class="qz-next" onclick="__Qz2(${idx},'doSubmit')">✓ ${esc(T.qzSubmit)}</button></div></div>`;
  }
  function qzResultHtml(m, idx) {
    const qz = m.qz; const r = qz.res; const N = qz.data.length;
    const stats = qzStats(qz);
    const rows = stats.map((s2) => `<div class="qz-top-row ${s2.cls}"><div class="lbl"><span>${esc(s2.tn)}</span><b>${s2.ok}/${s2.tot} · ${s2.pct}%</b></div><div class="tr"><div class="fl" style="width:${s2.pct}%"></div></div></div>`).join('');
    return `<div class="qz-res"><div class="qz-ring" style="--p:${r.pct}"><b>${r.pct}%</b><span>${r.ok} / ${N}</span></div>
      ${qz.cfg.neg > 0 ? `<div class="qz-marks">${esc(T.qzScore)}: ${r.marks} ${esc(T.qzOf)} ${N} ${esc(T.qzMarksNote)} -${qz.cfg.neg}</div>` : ''}
      ${r.note === 'time' ? `<div class="qz-marks">⏰ ${esc(T.qzTimeUp)}</div>` : ''}
      <div class="qz-bar big"><i style="width:${r.pct}%"></i></div>
      <div class="qz-cstats"><span class="ok">✓ ${esc(T.qzCorrectN)} ${r.ok}</span><span class="no">✗ ${esc(T.qzWrongN)} ${r.no}</span><span class="na">○ ${esc(T.qzNone2)} ${r.na}</span></div>
      <div class="qz-tstats"><span>⏱ ${esc(T.qzTimeUsed)}: <b>${Math.floor(r.secs / 60)}:${String(r.secs % 60).padStart(2, '0')}</b></span><span>⚡ ${esc(T.qzAvgTime)}: <b>${r.ok + r.no ? Math.round(r.secs / (r.ok + r.no)) + 's' : '—'}</b></span></div>
      <div class="qz-top">${rows}</div>
      <div class="qz-insight"><b>🧠 ${esc(T.qzInsight)}</b><p>${esc(qzInsightText(qz, stats))}</p></div>
      <div class="qz-acts"><button class="solid" onclick="__Qz2(${idx},'review')">📋 ${esc(T.qzReviewBtn)}</button><button class="solid" onclick="__Qz2(${idx},'retry')">🔄 ${esc(T.qzRetry)}</button><button class="ghost" onclick="__Qz2(${idx},'weak')">🎯 ${esc(T.qzWeakQuiz)}</button><button class="ghost" onclick="__Qz2(${idx},'similar')">📚 ${esc(T.qzSimilar)}</button></div></div>`;
  }
  function qzRfMatch(qz, q, i) {
    const rf = qz.rf || 'all';
    if (rf === 'all') return true;
    const a = qz.ans[i];
    if (rf === 'ok') return a === q.a;
    if (rf === 'no') return a !== undefined && a !== q.a;
    if (rf === 'na') return a === undefined;
    return true;
  }
  function qzReviewHtml(m, idx) {
    const qz = m.qz; const q = qz.data[qz.i]; const N = qz.data.length; const a = qz.ans[qz.i];
    const rc = { all: N, ok: 0, no: 0, na: 0 };
    qz.data.forEach((qq, i2) => { const a2 = qz.ans[i2]; if (a2 === undefined) rc.na++; else if (a2 === qq.a) rc.ok++; else rc.no++; });
    const rfChips = [['all', T.qzFAll, rc.all], ['ok', T.qzFGood, rc.ok], ['no', T.qzFBad, rc.no], ['na', T.qzFSkip, rc.na]].map((x) => `<button class="qz-rf ${(qz.rf || 'all') === x[0] ? 'on' : ''}" onclick="__Qz2(${idx},'rf','${x[0]}')">${esc(x[1])} · ${x[2]}</button>`).join('');
    const ok = a === q.a;
    const fb = `<div class="qz-fb ${ok ? 'good' : 'bad'}"><b>${ok ? '✓ ' + esc(T.qzCorrect) : '✕ ' + esc(T.qzWrong)}</b>` +
      `<div class="qz-fb-row">${esc(T.qzYourAns)}: ${a === undefined ? esc(T.qzNone2) : esc(q.o[a])}</div><div class="qz-fb-row">${esc(T.qzRightAns)}: <b>${esc(q.o[q.a])}</b></div>` +
      `<div class="qz-fb-row">💡 ${esc(q.e || '')}</div></div>`;
    const nav = `<div class="qz-nav"><button class="qz-back" onclick="__Qz2(${idx},'navR',-1)" ${qz.i === 0 ? 'disabled' : ''}>← ${esc(T.qzPrev)}</button>` +
      (qz.i < N - 1 ? `<button class="qz-next" onclick="__Qz2(${idx},'navR',1)">${esc(T.qzNext2)} →</button>` : `<button class="qz-next" onclick="__Qz2(${idx},'resBack')">← ${esc(T.qzBackRes)}</button>`) + `</div>`;
    return `<div class="qz-rfrow">${rfChips}</div><div class="qz-bar"><i style="width:${Math.round(((qz.i + 1) / N) * 100)}%"></i></div>
      <div class="qz-q">${esc(q.q)}${(q.t || q.topic) ? `<span class="qz-tag">${esc(q.t || q.topic)}${q.src === 'bank' ? ' · ' + esc(T.qzBank) : ''}</span>` : ''}</div>${fb}${nav}`;
  }
  /* ── single source of truth: সব quiz-অ্যাকশন এক জায়গায় ── */
  window.__Qz2 = function (idx, act, a, b) {
    const m = msgs[idx]; if (!m || !m.qz) return;
    const qz = m.qz; const c = qz.cfg; let rerender = true;
    if (act === 'addSub') { const id = String(a); if (!c.subs.includes(id)) { c.subs.push(id); if (!c.tops[id]) c.tops[id] = []; } }
    else if (act === 'delSub') { const id = String(a); c.subs = c.subs.filter((x) => x !== id); delete c.tops[id]; }
    else if (act === 'addTop') { const [sid, tn] = String(a).split('|'); if (!c.tops[sid]) c.tops[sid] = []; const arr = c.tops[sid]; const ix = arr.indexOf(tn); if (ix >= 0) arr.splice(ix, 1); else arr.push(tn); }
    else if (act === 'allTop') { c.tops[String(a)] = []; }
    else if (act === 'delTop') { const [sid, tn] = String(a).split('|'); const arr = c.tops[sid] || []; const ix = arr.indexOf(tn); if (ix >= 0) arr.splice(ix, 1); }
    else if (act === 'oth') { c.othOpen = !c.othOpen; }
    else if (act === 'csub') { c.customSubj = String(a); rerender = !b; }
    else if (act === 'adsub') { const v = (c.customSubj || '').trim(); if (v && !c.subs.includes('#' + v)) { c.subs.push('#' + v); c.tops['#' + v] = []; } c.customSubj = ''; c.othOpen = false; }
    else if (act === 'topOth') { c.topOpen = !c.topOpen; }
    else if (act === 'ctop') { c.customTopic = String(a); rerender = !b; }
    else if (act === 'adtop') { const v = (c.customTopic || '').trim(); if (v) { for (const sid of c.subs) { if (!c.tops[sid]) c.tops[sid] = []; if (!c.tops[sid].includes(v)) c.tops[sid].push(v); } } c.customTopic = ''; c.topOpen = false; }
    else if (act === 'cnt') { c.count = Number(a); }
    else if (act === 'cntOth') { c.cntOpen = !c.cntOpen; }
    else if (act === 'cntD') { c.customCount = Math.min(200, Math.max(1, c.customCount + Number(a))); c.count = c.customCount; }
    else if (act === 'delCount') { c.count = 0; }
    else if (act === 'tim') { c.time = Number(a); }
    else if (act === 'timOth') { c.timOpen = !c.timOpen; }
    else if (act === 'timD') { c.customTime = Math.min(480, Math.max(1, c.customTime + Number(a))); c.time = c.customTime; }
    else if (act === 'delTime') { c.time = undefined; }
    else if (act === 'negt') { c.neg = Number(a); }
    else if (act === 'negOth') { c.negOpen = !c.negOpen; }
    else if (act === 'negD') { c.customNeg = Math.min(1.5, Math.max(0, Math.round((c.customNeg + Number(a)) * 100) / 100)); c.neg = c.customNeg; }
    else if (act === 'delNeg') { c.neg = null; }
    else if (act === 'dif') { c.diff = String(a); }
    else if (act === 'delDiff') { c.diff = ''; }
    else if (act === 'edit') { qz.edit = !qz.edit; qz.extFull = true; }
    else if (act === 'gen') { qzGenerate(m, idx); return; }
    else if (act === 'ans') {
      if (qz.st !== 'play' || qz.fb && qz.ans[qz.i] !== undefined) return;
      qz.ans[qz.i] = Number(a); qz.fb = true;
    }
    else if (act === 'nav') { const ni = qz.i + Number(a); if (ni < 0 || ni >= qz.data.length) return; if (!qz.fb && Number(a) > 0) return; qz.i = ni; qz.fb = false; }
    else if (act === 'submit') { if (qz.fb || Object.keys(qz.ans).length === qz.data.length) { qz.st = 'confirm'; } }
    else if (act === 'confBack') { qz.st = 'play'; }
    else if (act === 'doSubmit') {
      if (qz.busy) return; qz.busy = true;
      const N = qz.data.length; let ok = 0, no = 0, na = 0;
      for (let i2 = 0; i2 < N; i2++) { const a2 = qz.ans[i2]; if (a2 === undefined) na++; else if (a2 === qz.data[i2].a) ok++; else no++; }
      const neg = qz.cfg.neg || 0;
      qz.res = { ok: ok, no: no, na: na, marks: Math.round((ok - no * neg) * 100) / 100, pct: Math.round((ok / N) * 100), acc: ok + no ? Math.round((ok / (ok + no)) * 100) : 0, secs: Math.round((Date.now() - qz.t0) / 1000), note: qz.resNote || '' };
      qz.st = 'result'; qz.busy = false;
      if (qz.tm) { clearTimeout(qz.tm); qz.tm = null; } if (qz.tick) { clearInterval(qz.tick); qz.tick = null; }
    }
    else if (act === 'review') { qz.st = 'review'; qz.i = 0; }
    else if (act === 'rf') { qz.rf = String(a) || 'all'; qz.i = 0; for (let i2 = 0; i2 < qz.data.length; i2++) if (qzRfMatch(qz, qz.data[i2], i2)) { qz.i = i2; break; } }
    else if (act === 'navR') {
      const step = Number(a); let ni = qz.i + step;
      for (let k = 0; k < qz.data.length; k++) {
        if (ni < 0) ni = qz.data.length - 1; else if (ni >= qz.data.length) ni = 0;
        if (qzRfMatch(qz, qz.data[ni], ni)) break;
        ni += step;
      }
      if (ni >= 0 && ni < qz.data.length) qz.i = ni;
    }
    else if (act === 'resBack') { qz.st = 'result'; }
    else if (act === 'retry') {
      if (qz.busy) return; qz.busy = true;
      setTimeout(() => { qz.data = qzFinalize(qz.data, c); qz.i = 0; qz.ans = {}; qz.fb = false; qz.t0 = Date.now(); qz.busy = false; qz.st = 'play'; qz.resNote = ''; qzStartTick(m, idx); if (c.time > 0 && qz.tm) { clearTimeout(qz.tm); qz.tm = setTimeout(() => { if (m.qz && m.qz.st === 'play' && m.qz.data) { m.qz.resNote = 'time'; window.__Qz2(idx, 'doSubmit'); } }, c.time * 60000); } renderMsgs(); }, 150);
      return;
    }
    else if (act === 'weak') {
      if (qz.busy) return;
      const stats = qzStats(qz); const weak = stats.filter((s2) => s2.pct < 50).map((s2) => s2.tn);
      if (weak.length) { const sids = c.subs; c.tops = {}; for (const sid of sids) c.tops[sid] = []; for (const sid of sids) for (const q of qz.data) if (weak.includes(q.t) && !(c.tops[sid] || []).includes(q.t)) { if (!c.tops[sid]) c.tops[sid] = []; c.tops[sid].push(q.t); } }
      qzGenerate(m, idx); return;
    }
    else if (act === 'similar') { if (qz.busy) return; qzGenerate(m, idx); return; }
    else return;
    save(); if (rerender) renderMsgs();
  };

  /* ── send / stop ── */
  function setSendBtn(streaming) {
    const b = document.getElementById('aiSendBtn'); if (!b) return;
    b.classList.toggle('stop', !!streaming);
    b.innerHTML = streaming ? '■' : '➤';
    b.setAttribute('aria-label', streaming ? T.stop : T.send);
    const c = document.querySelector('.ai-compose');
    if (c) c.classList.toggle('streaming', !!streaming);
  }
  async function send(prefill) {
    const q = String(prefill ?? inputVal()).trim();
    if (!q && !attachments.length) return;
    if (activeReq) return;
    if (q.length > 4000) { toast(T.msgTooLong); inputEl() && inputEl().focus(); return; }
    const imgItem = attachments.find((a) => a.kind === 'image' && a.dataUrl);
    const docItem = attachments.find((a) => a.kind !== 'image');
    const text = q || (imgItem ? (lang === 'en' ? 'Explain this image' : 'এই ছবিটা বুঝিয়ে দাও') : '');
    const note = docItem ? `\n\n[📄 ${docItem.name} — ${T.docSoon}]` : '';
    const fullText = text + note;
    if (docItem) toast(T.docSoon);
    setInput(null, '');
    attachments = []; renderAttach();
    const m = { role: 'user', text: fullText, ts: Date.now(), image: imgItem ? imgItem.dataUrl : '' };
    msgs.push(m); save(); renderMsgs();
    /* ── Quiz intent → interactive configuration engine (কোনো বাটন লাগবে না) ── */
    const qi = qzParseIntent(fullText);
    if (qi) { msgs.push({ role: 'ai', text: '', ts: Date.now(), qz: qi }); save(); renderMsgs(); return; }
    stopVoice(true);
    stoppedEarly = false;
    streamingEl = null;
    const _it = rbIntent(fullText);
    appendThinking({
      image: !!imgItem,
      doc: !!docItem,
      quiz: /quiz|প্রশ্ন দিয়ে|mcq/i.test(fullText),
      mcq: /mcq/i.test(fullText),
      search: /খোঁজো|খোঁজ|search|নিউজ|news|সর্বশেষ ভর্তি|ভর্তি নিউজ|আপডেট খোঁজ/i.test(fullText),
      calc: _it === 'calculate',
      code: _it === 'code',
      plan: _it === 'plan',
      vs: _it === 'compare' || _it === 'decision',
      status: (_it === 'learn' ? T.stReason : _it === 'calculate' ? T.stCalc : _it === 'code' ? T.stCode : _it === 'plan' ? T.stPlan : _it === 'compare' || _it === 'decision' ? T.stVerdict : _it === 'summarize' ? T.stSum : _it === 'analyze' ? T.stAnalyze : _it === 'troubleshoot' ? T.stFix : '')
    });
    setSendBtn(true);
    const res = await callStream(fullText, imgItem ? imgItem.dataUrl : '').catch(() => ({ code: 'net' }));
    removeThinking();
    streamingEl = null;
    setSendBtn(false);
    activeReq = null;
    if (res.code === 'ok' && res.text && res.text.trim()) {
      const intent = res.meta && res.meta.intent;
      const qz = intent === 'QUIZ_REQUEST' ? parseQuiz(res.text) : null;
      const msg = { role: 'ai', text: res.text.trim(), ts: Date.now(), regen: true, model: res.meta && res.meta.model };
      if (qz) { const userAnswers = qz.questions.map(() => -1); msg.quiz = { data: qz, idx: 0, sel: -1, feedback: false, correct: 0, userAnswers, done: false }; msg.text = qz.title ? qz.title + ' — ' + res.text.trim() : res.text.trim(); }
      msgs.push(msg); save(); renderMsgs();
    } else if (res.code === 'stopped') { save(); renderMsgs(); }
    else {
      const detail = res.code === 'net' ? T.offline : (res.code === 'http' ? String((res.meta && (res.meta.message || res.meta.error)) || T.errHttp) : String((res.meta && res.meta.message) || T.err));
      msgs.push({ role: 'ai', error: true, text: detail, ts: Date.now() });
      save(); renderMsgs();
    }
  }
  function retry() {
    msgs = msgs.filter((m) => !(m.error));
    const last = [...msgs].reverse().find((m) => m.role === 'user');
    if (last) send(last.text); else renderMsgs();
  }
  function regen() {
    const last = [...msgs].reverse().find((m) => m.role === 'user');
    if (last) send(last.text);
  }
  function stop() {
    stoppedEarly = true;
    try { activeReq && activeReq.abort(); } catch (_) {}
    removeThinking();
    if (streamingEl) {
      const txt = (streamingEl.querySelector('.ai-msg-body') || streamingEl).textContent.trim();
      if (txt) msgs.push({ role: 'ai', text: txt, ts: Date.now(), regen: true });
    }
    streamingEl = null; activeReq = null;
    setSendBtn(false);
    save(); renderMsgs();
  }

  /* ── quiz interactions ── */
  window.__AiQuizTap = function (idx, oi) {
    const m = msgs[idx]; if (!m || !m.quiz || m.quiz.done) return;
    if (m.quiz.feedback) return;
    m.quiz.sel = oi;
    m.quiz.feedback = true;
    if (oi === m.quiz.data.questions[m.quiz.idx].answer) m.quiz.correct++;
    m.quiz.userAnswers[m.quiz.idx] = oi;
    save(); renderMsgs();
  };
  window.__AiQuizNext = function (idx) {
    const m = msgs[idx]; if (!m || !m.quiz) return;
    if (m.quiz.idx + 1 < m.quiz.data.questions.length) {
      m.quiz.idx++; m.quiz.sel = -1; m.quiz.feedback = false;
    } else m.quiz.done = true;
    save(); renderMsgs();
  };
  window.__AiQuizRetry = function (idx) {
    const m = msgs[idx]; if (!m) return;
    const q = m.quiz.data; const lastUser = [...msgs].reverse().find((x) => x.role === 'user');
    send(lastUser ? lastUser.text : 'আমাকে quiz নাও');
  };
  window.__AiQuizAnalysis = function (idx) {
    const m = msgs[idx]; if (!m) return;
    m.quiz.showAnalysis = !m.quiz.showAnalysis;
    save(); renderMsgs();
  };

  /* ── actions ── */
  function copyBtn(el) {
    const t = el.getAttribute('data-t') || '';
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { const o = el.innerHTML; el.innerHTML = ICONS.check; setTimeout(() => { el.innerHTML = o; }, 1300); }).catch(() => toast(T.copyFail));
  }
  function shareBtn(el) {
    const i = +el.getAttribute('data-i'); const m = msgs[i]; if (!m || !m.text) return;
    const url = location.href.split('#')[0];
    if (navigator.share) { navigator.share({ title: T.title, text: String(m.text).slice(0, 900), url }).catch(() => {}); }
    else if (navigator.clipboard) { navigator.clipboard.writeText(String(m.text)).then(() => toast(T.copied)).catch(() => {}); }
  }
  function fbBtn(el) {
    const i = +el.getAttribute('data-i'); const m = msgs[i];
    if (m && el.getAttribute('data-fb') === 'up') { m.fb = 'up'; save(); renderMsgs(); toast(T.liked); return; }
    if (m) { m.fb = 'down'; save(); renderMsgs(); openFeedback(i); }
  }
  function openFeedback(i) {
    feedbackTarget = i;
    const back = document.createElement('div');
    back.className = 'ai-sheetback';
    back.innerHTML = `<div class="ai-sheet ai-fb-sheet"><div class="ai-sheet-h">${esc(T.feedbackQ)}</div>
      ${['fb1', 'fb2', 'fb3', 'fb4', 'fb5'].map((k, j) => `<button class="ai-fb-opt" data-r="${j}">${['❌', '😕', '📚', '📄', '✏️'][j]} ${esc(T[k])}</button>`).join('')}
      <div style="text-align:right"><button style="border:0;background:none;color:var(--ai-sub);font:600 13px inherit;cursor:pointer" onclick="document.querySelector('.ai-sheetback')?.remove()">${esc(T.cancel)}</button></div></div>`;
    back.addEventListener('click', (e) => { if (e.target === back) back.remove(); });
    back.querySelectorAll('.ai-fb-opt').forEach((b) => b.addEventListener('click', () => {
      const reason = b.textContent.trim();
      try {
        const log = JSON.parse(scopedRead(FEED_KEY) || '[]');
        log.push({ at: Date.now(), reason, snippet: String((msgs[feedbackTarget] || {}).text || '').slice(0, 200) });
        scopedWrite(FEED_KEY, JSON.stringify(log.slice(-50)));
      } catch (_) {}
      back.remove(); toast(T.liked);
    }));
    document.body.appendChild(back);
  }
  function moreMenu(el) {
    const i = +el.getAttribute('data-more'); const m = msgs[i]; if (!m) return;
    const old = document.querySelector('.ai-more-panel'); if (old) old.remove();
    const p = document.createElement('div');
    p.className = 'ai-menu ai-more-panel';
    p.style.top = el.getBoundingClientRect().bottom + 'px';
    p.innerHTML = `<button data-a="speak">🔊 ${esc(T.speak)}</button><button data-a="save">⭐ ${esc(T.save)}</button><button data-a="share">📤 ${esc(T.share)}</button>`;
    p.querySelector('[data-a="speak"]').addEventListener('click', () => { p.remove(); speak({ getAttribute: () => String(m.text).slice(0, 300), innerHTML: '', disabled: false }); });
    p.querySelector('[data-a="save"]').addEventListener('click', () => { p.remove(); toast(T.savedTip); });
    p.querySelector('[data-a="share"]').addEventListener('click', () => {
      p.remove();
      if (navigator.share) navigator.share({ text: m.text }).catch(() => {});
      else (navigator.clipboard ? navigator.clipboard.writeText(m.text) : Promise.reject()).then(() => toast(T.copied)).catch(() => toast('Copy unavailable'));
    });
    document.body.appendChild(p);
    setTimeout(() => document.addEventListener('click', function h() { p.remove(); document.removeEventListener('click', h); }, { once: true }), 10);
  }
  window.__AiAgentEdit = function () { const last = [...msgs].reverse().find((m) => m.role === 'user'); if (last) { setInput(null, last.text); inputEl() && inputEl().focus(); } };
  window.__AiAgentCopy = copyBtn;
  window.__AiAgentShare = shareBtn;
  window.__AiAgentRetry = retry;
  window.__AiAgentRegen = regen;
  window.__AiAgentFb = fbBtn;
  window.__AiAgentMore = moreMenu;
  window.__AiAgentStopVoice = () => stopVoice(true);

  /* ── composer helpers ── */
  function inputEl() { return document.getElementById('aiInput'); }
  function inputVal(el) { const e = el || inputEl(); return e ? (e.textContent || '').replace(/\u00a0/g, ' ').trim() : ''; }
  function setInput(el, txt) { const e = el || inputEl(); if (!e) return; e.textContent = txt; autoGrow(); }
  const input = {
    get value() { const i = inputEl(); return i ? (i.textContent || '').replace(/\u00a0/g, ' ') : ''; },
    set value(v) { const i = inputEl(); if (i) { i.textContent = v; autoGrow(); } },
    focus() { const i = inputEl(); if (i) i.focus(); }
  };
  function insertAtCursor(txt) {
    const el = inputEl(); if (!el) return;
    let node = el, off = (el.textContent || '').length;
    const sel = window.getSelection();
    if (sel && sel.rangeCount && el.contains(sel.anchorNode)) { const r = sel.getRangeAt(0); node = r.endContainer; off = r.endOffset; }
    try {
      const r = document.createRange();
      if (node === el) { r.setStart(el.firstChild || el, Math.min(off, (el.textContent || '').length)); r.collapse(true); r.insertNode(document.createTextNode(txt)); }
      else { r.setStart(node, off); r.collapse(true); r.insertNode(document.createTextNode(txt)); }
      const tn = el.lastChild;
      if (tn) { r.setStartAfter(tn); r.setEndAfter(tn); } 
      if (sel) { try { sel.removeAllRanges(); sel.addRange(r); } catch (_) {} }
    } catch (_) { el.appendChild(document.createTextNode(txt)); }
    autoGrow();
  }
  function autoGrow() { const i = document.getElementById('aiInput'); if (i) { i.style.height = 'auto'; i.style.height = Math.min(i.scrollHeight, 128) + 'px'; } updateComposeState(); }
  function updateComposeState() {
    const i = inputEl(); if (!i) return;
    const c = document.querySelector('.ai-compose');
    if (c) c.classList.toggle('dirty', (i.textContent || '').length > 0);
  }
  function renderChrome() {}

  /* ── page render ── */
  function render() {
    const root = document.querySelector('#app') || document.body;
    root.innerHTML = shell();
    /* viewport-lock: AI-পেজে host-shell page scroll সম্পূর্ণ বন্ধ */
    try { root.classList.add('ai-chat-open'); document.documentElement.classList.add('ai-chat-open'); } catch (_) {}
    applyThemeVars();
    const inp = document.getElementById('aiInput');
    const sendBtn = document.getElementById('aiSendBtn');
    const plusBtn = document.getElementById('aiPlusBtn');
    const micBtn = document.getElementById('aiMicBtn');
    const menuBtn = document.getElementById('aiMenuBtn');
    const newBtn = document.getElementById('aiNewBtn');
    if (inp) {
      /* এক-ট্যাপ = instant focus। contenteditable কখনো toggle হয় না — element-identity স্থির */
      const composeEl = document.querySelector('.ai-compose');
      if (composeEl) composeEl.addEventListener('pointerdown', (e) => { if (e.target.closest('button') || e.target.closest('[onclick]')) return; try { if (document.activeElement !== inp) inp.focus({ preventScroll: true }); } catch (_) {} }, { passive: true });
      inp.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); send(); return; }
        e.preventDefault();
        try { document.execCommand('insertText', false, '\n'); } catch (_) {}
        if (!inputVal(inp).includes('\n') || !(inp.textContent || '').includes('\n')) insertAtCursor('\n');
        autoGrow();
      });
      inp.addEventListener('input', autoGrow);
      inp.addEventListener('paste', (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text/plain'); if (t) { try { document.execCommand('insertText', false, t); } catch (_) {} if (t.length > 4 && !(inp.textContent || '').includes(t.slice(0, 4))) insertAtCursor(t); autoGrow(); } });
    }
    /* ফুল-স্ক্রিন: AI-পেজে navigation-bar hide */
    const navBar = document.querySelector('.bottomnav');
    if (navBar) navBar.style.display = 'none';
    /* home icon → dashboard (nav ফেরত) */
    const homeBtn = document.getElementById('aiHomeBtn');
    if (homeBtn) homeBtn.addEventListener('click', () => backHome());
    /* keyboard-aware: composer keyboard-এর ঠিক উপরে */
    const kbd = (() => {
      const vv = window.visualViewport;
      const upd = () => {
        const r = document.querySelector('.ai-agent-root');
        let kb = 0;
        if (vv && window.innerHeight - vv.height > 60) kb = Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0));
        if (r) { r.style.setProperty('--ai-kb', kb + 'px'); r.classList.toggle('ai-kb', kb > 0); }
      };
      if (window.__aiKbUpd) { try { vv && vv.removeEventListener('resize', window.__aiKbUpd); vv && vv.removeEventListener('scroll', window.__aiKbUpd); } catch (_) {} window.removeEventListener('resize', window.__aiKbUpd); }
      window.__aiKbUpd = upd;
      if (vv) { try { vv.addEventListener('resize', upd); vv.addEventListener('scroll', upd, { passive: true }); } catch (_) {} }
      window.addEventListener('resize', upd, { passive: true });
      if (inp) inp.addEventListener('focus', () => setTimeout(upd, 180));
      upd();
    })();
    /* ↓ Latest: উপরে scroll করলে ফ্লোটিং */
    const body = document.getElementById('aiAgentBody');
    const latest = document.getElementById('aiLatest');
    let raf = null;
    const updCnt = () => { const c = document.getElementById('aiLatestCnt'); if (c) c.textContent = aiUnread > 9 ? '9+' : String(aiUnread); if (latest) latest.classList.toggle('new', aiUnread > 0); };
    const scrollUpd = () => {
      if (!body || !latest) return;
      const off = body.scrollHeight - body.scrollTop - body.clientHeight;
      aiPinned = off < 150;
      latest.classList.toggle('show', off > 300);
      if (off <= 300 && aiUnread) { aiUnread = 0; updCnt(); }
    };
    window.__aiMarkNew = () => { if (!body || !latest) return; const off = body.scrollHeight - body.scrollTop - body.clientHeight; if (off > 300) { aiUnread++; updCnt(); } };
    if (body) body.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = null; scrollUpd(); }); }, { passive: true });
    if (latest) latest.addEventListener('click', () => { aiUnread = 0; updCnt(); if (body) body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' }); });
    scrollUpd();
    updateComposeState();
    if (sendBtn) sendBtn.addEventListener('click', () => { activeReq ? stop() : send(); });
    if (plusBtn) plusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (attachOpen) closeAttach(); else { closeMenu(); setSheetUI(true); document.body.appendChild(sheet()); }
    });
    if (micBtn) micBtn.addEventListener('click', (e) => { e.stopPropagation(); startVoice(); });
    if (menuBtn) menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menuOpen) closeMenu(); else { menuOpen = true; closeAttach(); document.body.appendChild(drawerPanel()); }
    });
    if (newBtn) newBtn.addEventListener('click', () => {
      if (inputVal() && !window.confirm(T.newIsEmpty)) return;
      newChat();
    });
    /* composer actual-height reserve (fixed-layout safety) */
    const compRO = () => { const c = document.querySelector('.ai-compose'); const r = document.querySelector('.ai-agent-root'); if (c && r) r.style.setProperty('--ai-comp-h', Math.round(c.getBoundingClientRect().height) + 'px'); };
    compRO(); if (window.__aiCompRO) { try { window.__aiCompRO.disconnect(); } catch (_) {} }
    if (window.ResizeObserver) { try { window.__aiCompRO = new ResizeObserver(compRO); const c = document.querySelector('.ai-compose'); if (c) window.__aiCompRO.observe(c); } catch (_) {} }
    setSendBtn(!!activeReq);
    renderMsgs();
    const tbx = document.getElementById('aiTitleTxt') || document.querySelector('.ai-agent-t b');
    if (tbx) tbx.textContent = sessions[cur] && sessions[cur].name ? sessions[cur].name : T.title;
  }

  window.renderAiAgentPage = render;
  window.__AiAgentTest = { get msgs() { return msgs.slice(); }, send, retry, regen, stop, newChat, T, parseQuiz };
  /* AI-page ছাড়লে (hash-change/browser-back) viewport-lock + nav সম্পূর্ণ মুক্তি */
  window.addEventListener('hashchange', () => {
    try {
      const p = (location.hash.slice(1).split('?')[0] || '').toLowerCase();
      if (p !== 'ai' && p !== 'ai-chat') {
        document.documentElement.classList.remove('ai-chat-open');
        const _ap = document.getElementById('app'); if (_ap) _ap.classList.remove('ai-chat-open');
        const _nb = document.querySelector('.bottomnav'); if (_nb) _nb.style.display = '';
      }
    } catch (_) {}
  });
  /* checklist toggle: state per-message, persisted, DOM-only update (input isolated) */
  window.__AiAgentChk = (ci, k) => {
    const m = msgs[ci]; if (!m) return;
    m.chk = m.chk || {};
    m.chk[k] = !m.chk[k];
    save();
    const li = document.querySelector('.ai-checklist[data-ci="' + ci + '"] li[data-k="' + k + '"]');
    if (li) {
      li.classList.toggle('done', !!m.chk[k]);
      li.querySelector('.bx').textContent = m.chk[k] ? '✓' : '';
    }
  };
  document.addEventListener('click', (e) => {
    const li = e.target.closest ? e.target.closest('.ai-checklist[data-ci] li[data-k]') : null;
    if (li) { const w = li.closest('.ai-checklist'); window.__AiAgentChk(+w.getAttribute('data-ci'), +li.getAttribute('data-k')); return; }
    const cp = e.target.closest ? e.target.closest('[data-copy]') : null;
    if (cp) { try { rbCopy(cp.getAttribute('data-copy')); } catch (_) {} return; }
    const ra = e.target.closest ? e.target.closest('.ai-rax button[data-act="ra"]') : null;
    if (ra) {
      const v = ra.getAttribute('data-val') || '';
      if (v.startsWith('q:')) { send(v.slice(2)); }
      else if (v.startsWith('copy:')) { rbCopy(v.slice(5)); }
      return;
    }
    if (menuOpen && !e.target.closest('.ai-drawer') && !e.target.closest('#aiMenuBtn')) closeMenu();
    if (attachOpen && document.getElementById('aiSheetView') && !e.target.closest('.ai-sheet') && !e.target.closest('#aiPlusBtn')) closeAttach();
  });
  window.__admissionAiModuleReady = true;
  if (location.hash.replace(/^#\/?/, '').split('?')[0] === 'ai' && typeof window.__admissionRequestFinalRender === 'function') window.__admissionRequestFinalRender();
})();
