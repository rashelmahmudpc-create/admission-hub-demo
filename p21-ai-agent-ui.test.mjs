// P21 — CHATBOT V1 (Premium AI Assistant) ইন্টিগ্রেশন-টেস্ট
// মালিক-স্পেক ২০২৬-০৯-০৮: hero-card/notice/chips/quiz-card/sheet/themes/menu …
import { readFileSync, existsSync } from 'fs';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };
const H = readFileSync('index.html', 'utf8');
const SW = readFileSync('sw.js', 'utf8');
const V2 = readFileSync('dashboard-v2.js', 'utf8');
const PW = readFileSync('public-worker.js', 'utf8');
const UI = existsSync('ai-agent-chat.js') ? readFileSync('ai-agent-chat.js', 'utf8') : '';
const AG = existsSync('ai-agent.js') ? readFileSync('ai-agent.js', 'utf8') : '';
const ACCOUNT = readFileSync('account-access.js', 'utf8');
const ACCOUNT_CSS = readFileSync('account-access.css', 'utf8');

/* ── ১. রুট + স্ক্রিপ্ট ── */
t('১. index.html-এ ai-রুট dispatch (renderAiAgentPage)', H.includes("if(p==='ai'){ if(window.renderAiAgentPage)"));
t('২. ai-agent-chat.js স্ক্রিপ্ট-ট্যাগ (chatv1)', H.includes('./ai-agent-chat.js?v=agent-f1-ui-chatv18-fresh'));
t('৩. ai-agent-chat.js ফাইল-বিদ্যমান + renderAiAgentPage-এক্সপোজ', existsSync('ai-agent-chat.js') && UI.includes('window.renderAiAgentPage = render'));
t('৪. NAV_TABS-এ 🤖 AI ট্যাব', H.includes("{key:'ai', icon:'🤖', label:'AI'}"));
t('৫. dashboard-v2: Command Center + All-Tools এ AI-এন্ট্রি', V2.includes("navigate(\\'ai\\')") && V2.includes("'AI', \"navigate('ai')\""));

/* ── ২. সিক্রেট-নিরাপত্তা ── */
const secretHits = ['x-goog-api-key', 'GEMINI_KEYS', 'Bearer  ', 'api_key='];
t('৬. ক্লায়েন্ট-ফাইল/HTML-তে কোনো API-key-প্যাটার্ন নেই', !secretHits.some((x) => UI.includes(x) || H.includes(x) || V2.includes(x)) && !/AIza[0-9A-Za-z_-]{30,}/.test(H + UI + V2) && !UI.includes('generativelanguage') && !UI.includes('elevenlabs.io'));
t('৭. server-মডিউল ai-agent.js আছে + import-প্রতিচিহ্ন public-worker-এ', existsSync('ai-agent.js') && PW.includes("from './ai-agent.js'"));

/* ── ৩. Gateway-রুট ── */
t('৮. public-worker: /api/ai/chat + /api/ai/status + লিগ্যাসি /api/ai → account-aware agent', PW.includes("path === '/api/ai/chat'") && PW.includes("path === '/api/ai/status'") && PW.includes('persistMemory: identity.persistMemory'));
t('৯. gk-agent-worker: agent-env পাস-থ্রু', readFileSync('gk-agent-worker.js','utf8').includes('GROQ_API_KEY: env.GROQ_API_KEY'));

/* ── ৪. পুরনো AI-প্রোডাক্ট বিলুপ্ত-অটুট ── */
t('১০. ১০-টা পুরনো AI-ফাইল এখনো নেই', !existsSync('ah-ai-client.js') && !existsSync('study-ai-tool.js') && !existsSync('gk-agent-tool.js') && !existsSync('ai-explain-tool.js') && !existsSync('web-chat-rebuild.js') && !existsSync('web-search-fix.js') && !existsSync('ai-mentor-integration.js') && !existsSync('bug-agent-tool.js') && !existsSync('result-ai-analysis.js') && !existsSync('manual-gemini-helper.js'));
t('১১. পুরনো AI-রুট dispatch এখনো নেই', !H.includes('renderAIChat(') && !H.includes('renderWebChatV2(') && !H.includes('renderWebChatRebuild'));
t('১২. removedRoute-এ পুরনো AI-রুট-ব্লক অটুট + ai-রুট আনব্লক', H.includes("p === 'ai-chat'") && H.includes("p === 'study-ai'") && !H.includes("p === 'ai' ||"));

/* ── ৫. Chatbot-V1 UI (মালিক-স্পেক) ── */
t('১৩. Hero-card: 3D-orb + CTA (Hey! আমি Admission Hub AI)', UI.includes('ai-hero') && UI.includes('aiHeroCta') && UI.includes('ai-hero-orb'));
t('১৪. Dismissible notice (ai_notice_dismissed + এন-ভাষা-বার্তা)', UI.includes('ai_notice_dismissed') && UI.includes('ai-notice') && UI.includes('Verify important admission information'));
t('১৫. Try-asking chips (৫টা, প্রম্পট-কী-সহ)', UI.includes('ai-chips') && UI.includes('Try asking') && ['🧠','📝','🎯','📊','📚'].every(e => UI.includes("'" + e + "'")));
t('১৬. Composer: capsule + plus + mic + send/stop-morph', UI.includes('ai-compose') && UI.includes('aiMicBtn') && UI.includes('activeReq ? stop() : send()') && UI.includes('ai-send'));
t('১৭. Bottom-sheet: Add to conversation (৬) + AI Tools (৬)', UI.includes('ai-sheet') && UI.includes('Add to conversation') && UI.includes('AI Tools') && UI.includes('data-file="cam"') && UI.includes('data-tool="summ"'));
t('১৮. Voice-in: Web-Speech (উপলব্ধ-চেক + fallback)', (UI.includes('webkitSpeechRecognition') || UI.includes('SpeechRecognition')) && UI.includes('voiceNope'));
t('১৯. TTS-out: same-origin /api/voice + X-AH-App', UI.includes("'/api/voice'") && UI.includes("'X-AH-App': 'admission-hub'"));
t('২০. Editorial AI-msg: formula + tip/example/warn + table + msg-bar (Copy/Regen/👍/👎/⋯)', UI.includes('ai-formula') && UI.includes('ai-callout') && UI.includes('<table>') && UI.includes('ai-msg-bar') && UI.includes('__AiAgentFb') && UI.includes('__AiAgentMore'));
t('২১. Interactive Quick-Challenge: quiz-card + tap/next/score/analysis/retry', UI.includes('ai-quiz') && UI.includes('__AiQuizTap') && UI.includes('__AiQuizNext') && UI.includes('Quiz Complete') && UI.includes('__AiQuizAnalysis') && UI.includes('__AiQuizRetry'));
t('২২. Quiz-JSON parser (```json-সহ tolerant) + intent-গেটেড', UI.includes('parseQuiz') && UI.includes('QUIZ_REQUEST') && UI.includes('questions'));
t('২৩. Themes (Light/Dark/OLED) + css-var + localStorage', UI.includes('data-theme') && UI.includes('aiChatTheme') && UI.includes('oled') && UI.includes('themeDark'));
t('২৪. Menu: new/rename/search/export/clear/delete + confirm', UI.includes('aiMenuBtn') && UI.includes('menuRename') && UI.includes('menuExport') && UI.includes('confirmDel') && UI.includes('menuDelete'));
t('২৫. Search-কথোপকথন overlay + feedback-sheet (৫ কারণ) + feedback-log', UI.includes('ai-searchbar') && UI.includes('aiFeedbackLog') && UI.includes('fb4') && UI.includes('ai-fb-opt'));
t('২৬. Follow-up chips + লেখক-রিজেন + marker (⭐-save/share)', UI.includes('ai-followup') && UI.includes('__AiAgentRegen') && UI.includes('navigator.share'));
t('২৭. Thinking-state (✦ Thinking + অবস্থা-টেক্সট) + streaming-caret', UI.includes('ai-think') && UI.includes('aiThinkStatus') && UI.includes('ai-cursor') && UI.includes('thinkingStatus'));
t('২৮. ephemeral guest + account-scoped chat access and error-state retry', UI.includes("'X-AH-Guest': guestId()") && UI.includes('scopedWrite(STORE') && UI.includes("window.addEventListener('admissionhub:authchange'") && !UI.includes("localStorage.setItem('ahAiGuestV1'") && UI.includes('__AiAgentRetry'));
t('২৯. Mobile-first: safe-area + keyboard (visualViewport নয়, d-i n-এ padding) + reduced-motion', UI.includes('safe-area-inset') && UI.includes('prefers-reduced-motion'));
t('৩০. ক্লায়েন্ট-কোডে SSE-পার্স (data:/event:) + AbortController', UI.includes("startsWith('data:')") && UI.includes("startsWith('event:')") && UI.includes('AbortController'));

/* ── ৬. ভার্সন-অখণ্ডতা v208 ── */
t('৩১. sw BUILD_ID v208-aiagent (index-marker + expectedSwVersion)', SW.includes("const BUILD_ID = 'v271-lang-dashboard-memory-20260916'") && H.includes('sw.js?v=v271-lang-dashboard-memory-20260916') && H.includes("const expectedSwVersion = 'v271-lang-dashboard-memory-20260916'"));
t('৩২. sw APP_SHELL: anonymous AI chatv14 + dash2f10-main-ai', SW.includes('./ai-agent-chat.js?v=agent-f1-ui-chatv18-fresh') && SW.includes('./dashboard-v2.js?v=dash2f13-theme') && H.includes('dashboard-v2.js?v=dash2f13-theme'));


/* ── ৭. মালিক-ফিডব্যাক v209 (chatv2): Enter-newline · sheet-nav-hide · premium-composer · typography ── */
t('৩৩. Enter = নতুন লাইন; Ctrl/⌘+Enter = পাঠান; বাটন-সেন্ড অটুট', UI.includes("e.key !== 'Enter' || e.isComposing") && UI.includes("document.execCommand('insertText', false, '\\n')") && UI.includes('e.ctrlKey || e.metaKey') && UI.includes('function send('));
t('৩৪. Sheet-খোলায় nav-bar hide + body-scroll-lock + plus-rotate', UI.includes("document.querySelector('.bottomnav')") && UI.includes("(open || onAi) ? 'none' : ''") && UI.includes("document.body.style.overflow = open ? 'hidden' : ''") && UI.includes('plus-on'));
t('৩৫. Premium composer: focus-ring + hint-row + বড় textarea (150px)', UI.includes('.ai-compose:focus-within') && UI.includes('Math.min(i.scrollHeight, 128)') && UI.includes('.ai-editor:empty::before') && !UI.includes('ai-compose-hint'));
t('৩৬. টাইপোগ্রাফি-লিফট: 16.5px/1.85 body + 20px emerald heading + blockquote + antialiased', UI.includes('.ai-msg-body{font-size:16.5px;line-height:1.85') && UI.includes('font-size:20px') && UI.includes('.ai-msg-body blockquote') && UI.includes('-webkit-font-smoothing:antialiased') && UI.includes('.ai-editor') && UI.includes('contenteditable="true"') && !UI.includes('ai-compose-hint') && !UI.includes('aiCharCount') && !UI.includes('enterHint'));
t('৩৭. chatv3 + v210 অখণ্ডতা', H.includes('./ai-agent-chat.js?v=agent-f1-ui-chatv18-fresh') && H.includes('sw.js?v=v271-lang-dashboard-memory-20260916') && H.includes("const expectedSwVersion = 'v271-lang-dashboard-memory-20260916'") && SW.includes("const BUILD_ID = 'v271-lang-dashboard-memory-20260916'") && SW.includes('./ai-agent-chat.js?v=agent-f1-ui-chatv18-fresh'));


/* ── ৮. v211 (chatv4): ফুল-স্ক্রিন AI + Final Composer Workflow ── */
t('৩৮. AI-পেজ ফুল-স্ক্রিন: nav-hide + back-button + নিজস্ব-scroll root', UI.includes("document.querySelector('.bottomnav')") && UI.includes("navBar.style.display = 'none'") && UI.includes('aiHomeBtn') && UI.includes('function backHome()') && UI.includes("window.navigate('dashboard')") && UI.includes('height:100vh;height:100dvh;min-height:100vh;min-height:100dvh'));
t('৩৯. Composer workflow: 52px compact + 128px max + mic↔send swap + dirty/streaming', UI.includes('min-height:52px') && UI.includes('max-height:128px') && UI.includes(".ai-compose.dirty .ai-send{display:grid}") && UI.includes('.ai-compose.streaming .ai-send{display:grid}') && UI.includes("'Ask anything…'"));
t('৪০. Keyboard-aware + ↓ Latest + char-count', UI.includes('--ai-kb') && UI.includes('visualViewport') && UI.includes('__aiKbUpd') && UI.includes('aiLatest') && UI.includes("latest.classList.toggle('show'") && !UI.includes('aiCharCount'));
t('৪১. chatv4 + v211 অখণ্ডতা (index+sw)', H.includes('./ai-agent-chat.js?v=agent-f1-ui-chatv18-fresh') && H.includes('sw.js?v=v271-lang-dashboard-memory-20260916') && SW.includes("const BUILD_ID = 'v271-lang-dashboard-memory-20260916'") && SW.includes('./ai-agent-chat.js?v=agent-f1-ui-chatv18-fresh'));


/* ── ৯. v212 (chatv5): মালিক-ফিডব্যাক — no-hint/no-counter, contenteditable, theme-vars, long-cap ── */
t('৪২. Composer-এ কোনো hint/character-count নেই; editor contenteditable + :empty::before placeholder', UI.includes('contenteditable=\"true\"') && UI.includes('.ai-editor:empty::before') && UI.includes("document.execCommand('insertText', false, '\\n')") && !UI.includes('ai-compose-hint') && !UI.includes('enterHint') );
t('৪৩. Theme-CSS-vars apply হয় (dark-mode-র সাদা-লেখা বাগ-ফিক্স)', UI.includes("for (const k of ['bg', 'card', 'ink'") && UI.includes("r.style.setProperty('--ai-' + k, t[k])") && UI.includes('applyThemeVars()'));
t('৪৪. Dark-mode overrides: plus/mic/link/callout/th', UI.includes("[data-theme=dark] .ai-plus{background:rgba(47,191,143,.16)") && UI.includes('[data-theme=dark] .ai-msg-body a') && UI.includes('[data-theme=dark] .ai-callout.tip') && UI.includes('[data-theme=dark] .ai-msg-body th'));
t('৪৫. বড়-টেক্সট গার্ড: 4000-অক্ষর ক্যাপ + msgTooLong toast + focus', UI.includes('q.length > 4000') && UI.includes('msgTooLong') && UI.includes('মেসেজ খুব বড়'));
t('৪৬. Paste → plain-text-only + IME-safe Enter', UI.includes("getData('text/plain')") && UI.includes('e.isComposing'));
t('৪৭. chatv5 + v212 অখণ্ডতা', H.includes('./ai-agent-chat.js?v=agent-f1-ui-chatv18-fresh') && H.includes('sw.js?v=v271-lang-dashboard-memory-20260916') && SW.includes("const BUILD_ID = 'v271-lang-dashboard-memory-20260916'") && SW.includes('./ai-agent-chat.js?v=agent-f1-ui-chatv18-fresh'));


/* ── ১০. v213 (chatv6): কিবোর্ড-নিরাপদ layout + inline thinking + iOS-accessory fix ── */
t('৪৮. Thinking কোনো কার্ড-নয়: inline .ai-think row (3D orb + status), dynamic-status-seq', UI.includes('.ai-think{display:flex') && UI.includes('aiThinkStatus') && UI.includes('clearThinkTimers') && UI.includes('T.stAnalyze') && UI.includes('T.stWrite') && !UI.includes('.ai-thinking{'));
t('৪৯. কিবোর্ড-নিরাপদ layout: relative-foot (fixed/sticky-নয়) + root --ai-kb padding + body-তে কোনো giant padding নেই', UI.includes('.ai-agent-foot{position:relative;flex:0 0 auto;flex-shrink:0;width:100%;z-index:50') && UI.includes('padding-bottom:var(--ai-kb,0px)') && UI.includes('.ai-agent-body{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden'));
t('৫০. iOS ↑↓✓ দমন: single stable contenteditable (কোনো toggle নয়) + pointerdown pre-focus', !UI.includes("setAttribute('contenteditable'") && UI.includes("composeEl.addEventListener('pointerdown'") && UI.includes("inp.focus({ preventScroll: true })") && UI.includes('enterkeyhint="send"'));
t('৫১. send()-এ payload-aware thinking signals (image/doc/search/quiz/mcq)', UI.includes('image: !!imgItem') && UI.includes('doc: !!docItem') && UI.includes('search: /খোঁজো|খোঁজ|search') && UI.includes('mcq: /mcq/i'));
t('৫২. chatv6 + v213 অখণ্ডতা', H.includes('./ai-agent-chat.js?v=agent-f1-ui-chatv18-fresh') && H.includes('sw.js?v=v271-lang-dashboard-memory-20260916') && SW.includes("const BUILD_ID = 'v271-lang-dashboard-memory-20260916'") && SW.includes('./ai-agent-chat.js?v=agent-f1-ui-chatv18-fresh'));


/* ── ১১. v214 (chatv7): মালিক-স্পেক — SVG icon action-row + dynamic chips ── */
t('৫৩. Consistent SVG icon-system (stroke: currentColor, 16px, একই-weight) + msg-bar-এ আর emoji নেই', UI.includes('const ICONS = {') && UI.includes('stroke="currentColor"') && UI.includes('width="16"') && !UI.includes('data-fb="up" onclick="window.__AiAgentFb(this)">👍') && !UI.includes('⧉ '));
t('৫৪. Action-row: icon-only Copy/Like/Dislike/Share/Regenerate/More + __AiAgentShare + navigator.share', UI.includes('__AiAgentShare') && UI.includes('navigator.share') && UI.includes('ICONS.share') && UI.includes('ICONS.regen') && UI.includes('ICONS.more') && UI.includes('.ai-msg-bar .ab{'));
t('৫৫. Suggested chips: compact premium (solid border, mint bg, pill, no shadow/dash)', UI.includes('.ai-followup button{display:inline-flex') && UI.includes('border-radius:999px') && UI.includes('rgba(15,107,79,.15)') && UI.includes('padding:5.5px') && !UI.includes('border:1px dashed rgba(15,107,79,.3)'));
t('৫৬. Dynamic context-based suggestions (long/mcq/def/default branches + চিপ-click delegation)', UI.includes('const long = t.length > 750') && UI.includes('hasMcqList') && UI.includes('chzSimilarMcq') && UI.includes('chzShorten') && UI.includes('chzRevise') && UI.includes('__aiFollowupDeleg'));
t('৫৭. chatv7 + v214 অখণ্ডতা', H.includes('./ai-agent-chat.js?v=agent-f1-ui-chatv18-fresh') && H.includes('sw.js?v=v271-lang-dashboard-memory-20260916') && SW.includes("const BUILD_ID = 'v271-lang-dashboard-memory-20260916'") && SW.includes('./ai-agent-chat.js?v=agent-f1-ui-chatv18-fresh'));

/* ── ১২. v215 (chatv8): মালিক-স্পেক — sessions v2 + drawer + final header + dynamic renderer ── */
t('৫৮. Sessions v2 (multichat: mkSession + {v:2,list,cur} + switchChat + rename/delete/pin)', UI.includes('const mkSession =') && UI.includes('{ v: 2, list: sessions, cur: cur }') && UI.includes('function switchChat(i)') && UI.includes('s2.pin = s2.pin ? 0 : 1') && UI.includes('const curTitle = () =>'));
t('৫৯. Sidebar drawer (drawerPanel: recents/pin/rename/delete + new/search/themes/home + ×)', UI.includes('function drawerPanel()') && UI.includes('ai-dr-list') && UI.includes('ai-drawerback') && UI.includes('data-rm=') && UI.includes('recentChats') && UI.includes('itemMenu'));
t('৬০. Final header ☰ + title + ＋ (no search/⋯) + floating ↓ + unread badge', UI.includes('ai-ham') && UI.includes('aiNewBtn') && UI.includes('ai-plushead') && !UI.includes("id='aiSearchBtn'") && !UI.includes('id="aiSearchBtn"') && UI.includes('aiLatestCnt') && UI.includes('__aiMarkNew') && UI.includes("'--ai-comp-h'"));
t('৬১. Dynamic AI presentation (stats/timeline/checklist/define-callout/table-wrap/orb-states/count-up)', UI.includes('ai-stats') && UI.includes('aiBarGrow') && UI.includes('ai-timeline') && UI.includes('ai-checklist') && UI.includes('ai-callout.define') && UI.includes('ai-twrap') && UI.includes('tq-search') && UI.includes('tq-analyze') && UI.includes('tq-create') && UI.includes('ai-stat .v'));
t('৬২. chatv8 + v215 অখণ্ডতা', H.includes('./ai-agent-chat.js?v=agent-f1-ui-chatv18-fresh') && H.includes('sw.js?v=v271-lang-dashboard-memory-20260916') && SW.includes("const BUILD_ID = 'v271-lang-dashboard-memory-20260916'") && SW.includes('./ai-agent-chat.js?v=agent-f1-ui-chatv18-fresh'));


/* ── ১৩. v216 (chatv9): CRITICAL — input root-fix + interactive quiz engine v2 ── */
t('৬৩. Input root-fix: contenteditable-toggle hack নাই + enterkeyhint/autocapitalize/autocorrect/spellcheck + one-tap focus', !UI.includes("setAttribute('contenteditable', 'false')") && !UI.includes("getAttribute('contenteditable') === 'false'") && UI.includes('enterkeyhint="send"') && UI.includes('autocapitalize="off"') && UI.includes('autocorrect="off"') && UI.includes('spellcheck="false"') && UI.includes('inp.focus({ preventScroll: true })'));
t('৬৪. Final header: icon-only home (aiHomeBtn SVG, no text) right-পাশে ＋', UI.includes('ai-homehead') && UI.includes('id="aiHomeBtn"') && UI.includes('backHome()') && UI.includes('.ai-homehead svg'));
t('৬৫. Quiz engine v2: subject-bank + intent extraction + adaptive config + bank-first + __Qz2 state-machine', UI.includes('const QZ_SUBJECTS') && UI.includes('const QZ_BANK') && UI.includes('function qzParseIntent') && UI.includes('function qzBankQuestions') && UI.includes('window.__Qz2') && UI.includes('async function qzGenerate') && UI.includes("mode: 'quiz_gen'") && UI.includes('function qzFinalize'));
t('৬৬. Interactive quiz UI: config/steps/play/confirm/result/review + analytics + AI insight + retry/weak/similar', UI.includes('.qz-cfg') && UI.includes('.qz-steps') && UI.includes('function qzPlayHtml') && UI.includes('function qzConfirmHtml') && UI.includes('function qzResultHtml') && UI.includes('function qzReviewHtml') && UI.includes('function qzInsightText') && UI.includes(".qz-ring") && UI.includes("act === 'weak'") && UI.includes("act === 'retry'") && UI.includes("act === 'similar'"));
t('৬৭. chatv9 + v216 অখণ্ডতা', H.includes('./ai-agent-chat.js?v=agent-f1-ui-chatv18-fresh') && H.includes('sw.js?v=v271-lang-dashboard-memory-20260916') && SW.includes("const BUILD_ID = 'v271-lang-dashboard-memory-20260916'") && SW.includes('./ai-agent-chat.js?v=agent-f1-ui-chatv18-fresh'));

/* ── 14. v217 (chatv10): INPUT BOX / CHAT SCROLL — FINAL FIX (viewport-lock architecture) ── */
t('৬৮. App viewport lock: html/body/#app scroll নিষিদ্ধ (ai-chat-open) + 100vh/dvh fallback + root flex-column', UI.includes("document.documentElement.classList.add('ai-chat-open')") && UI.includes("root.classList.add('ai-chat-open')") && UI.includes('html.ai-chat-open,html.ai-chat-open body{height:100% !important;overflow:hidden !important') && UI.includes('html.ai-chat-open body{position:fixed !important') && UI.includes('#app.ai-chat-open{height:100vh !important;height:100dvh !important;min-height:100vh !important;min-height:100dvh !important;padding-bottom:0 !important;overflow:hidden !important}') && UI.includes('height:100vh;height:100dvh;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column'));
t('৬৯. Single-scroll + stable-frame: head flex-shrink (sticky-নাই), body একমাত্র scroll-container, foot relative z-50', !UI.includes('.ai-agent-head{position:sticky') && UI.includes('.ai-agent-head{position:relative;z-index:20;flex:0 0 auto') && UI.includes('.ai-agent-body{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior-y:contain') && UI.includes('.ai-agent-foot{position:relative;flex:0 0 auto;flex-shrink:0;width:100%;z-index:50') && UI.includes('html.ai-chat-open .page{transform:none !important'));
t('৭০. Keyboard zero-gap: ai-kb class toggle + hashchange unlock + backHome unlock + scroll-lock মুক্তি', UI.includes("r.classList.toggle('ai-kb', kb > 0)") && UI.includes('.ai-agent-root.ai-kb .ai-agent-foot{padding-bottom:8px}') && UI.includes("document.documentElement.classList.remove('ai-chat-open')") && UI.includes("p !== 'ai' && p !== 'ai-chat'") && UI.includes("window.addEventListener('hashchange'"));

/* ── 15. v218 (chatv11): MASTER UPGRADE — Universal Dynamic Response Engine ── */
t('৭১. Engine core: RB_TYPES whitelist + respParse + RB_RENDER registry + respRender fallback + no-raw-HTML', UI.includes('const RB_TYPES') && UI.includes('function respParse') && UI.includes('const RB_RENDER = {}') && UI.includes('function respRender') && UI.includes("if (!fn) return '<p>' + rbEsc(b.txt") && UI.includes('RB_TYPES') && UI.includes('RB_RENDER.code') && UI.includes('RB_RENDER.compare'));
t('৭২. Data-driven blocks: stats/kpi/timeline/checklist/steps/flow/compare/code parse + render', UI.includes("t: 'stats'") && UI.includes("t: 'kpi'") && UI.includes("t: 'timeline'") && UI.includes("t: 'checklist'") && UI.includes("t: 'steps'") && UI.includes("t: 'flow'") && UI.includes("t: 'compare'") && UI.includes("t: 'code'"));
t('৭৩. Context-aware actions (গেমারিক নয়): rbIntent + ctxActions lang-aware + copy/q types + fake-data নিষেধ', UI.includes('function rbIntent') && UI.includes('const RB_INTENT') && UI.includes('function ctxActions') && UI.includes("const EN = typeof lang !== 'undefined'") && UI.includes("data-act=\"ra\"") && UI.includes('copy:') && UI.includes('q:') && UI.includes('rbCompare') && UI.includes('hasRate'));
t('৭৪. chatv14 guest + current shell অখণ্ডতা', H.includes('./ai-agent-chat.js?v=agent-f1-ui-chatv18-fresh') && H.includes('sw.js?v=v271-lang-dashboard-memory-20260916') && SW.includes("const BUILD_ID = 'v271-lang-dashboard-memory-20260916'") && SW.includes('./ai-agent-chat.js?v=agent-f1-ui-chatv18-fresh'));

t('৭৫. Quiz v3: strict topic lock + validation pipeline (mismatch → reject → regenerate)', UI.includes('function qzEnforceLock') && UI.includes('function qzRfMatch') && UI.includes('function qzStartTick') && UI.includes('const okT = !locks.length || locks.includes(tn)') && UI.includes('qzLocalGen(c, bad)'));
t('৭৬. Subtopic + multi-subject auto-detect + 10-pattern local-gen + round-robin bank distribution', UI.includes("al: ['ইংরেজি'") && UI.includes('subT: subHit.slice()') && UI.includes('const subHit = []') && UI.includes('const TPLS = [') && UI.includes('groups[gi % groups.length]'));
t('৭৭. Live timer tick (frontend-driven, rerender-safe) + result time-used/avg', UI.includes('qzStartTick(m, idx)') && UI.includes('data-qz-t') && UI.includes('qz-tstats') && UI.includes('qzTimeUsed') && UI.includes('Math.floor(r.secs / 60)'));
t('৭৮. Review filters All/Correct/Incorrect/Skipped + filter-aware nav', UI.includes('qz-rfrow') && UI.includes("act === 'rf'") && UI.includes('qzRfMatch(qz, qz.data[ni], ni)') && UI.includes('qzFGood') && UI.includes('qzFSkip'));
t('৭৯. Friendly error + Edit action + user preview; AI response/code সবসময় full', UI.includes('T.errHttp') && UI.includes('window.__AiAgentEdit = function') && UI.includes('ai-u-fold') && !UI.includes('ai-rb-fold') && !UI.includes('ai-code-fold') && !UI.includes('respFold(') && !UI.includes('m.text.length > 1000'));
t('৮০. Theme: System mode + resolvable vars + segmented drawer (.on sync) + focus-visible', UI.includes('function effTheme()') && UI.includes("theme === 'system'") && UI.includes("b.classList.toggle('on'") && UI.includes(':focus-visible') && UI.includes("prefers-color-scheme: dark)') : null") && UI.includes("prefers-color-scheme: dark)').addEventListener('change'"));

/* ── ১৬. Scope boundary: Signup has no Assistant; ordinary app keeps AI ── */
t('৮১. Signup/Onboarding bundle-এ Assistant component বা AI request নেই', !/ASSISTANT_ENABLED|data-role=\"guide|ah-guide|AI Assistant|\/api\/ai\/chat/.test(ACCOUNT));
t('৮২. Signup/Onboarding CSS-এ Assistant surface নেই', !/\.ah-guide|\.ah-assistant-hint/.test(ACCOUNT_CSS));
t('৮৩. Main app AI client Signup password/OTP field selector পড়ে না', !/ah-signup-password|ah-signup-confirm|ah-telegram-code|ah-backup-code/.test(UI));

console.log(`\nP21-CHATBOT-V1: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
