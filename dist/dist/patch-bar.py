# -*- coding: utf-8 -*-
s = open('ai-agent-chat.js', encoding='utf-8').read()

def rep(old, new, tag):
    global s
    assert old in s, 'MISS: ' + tag
    s = s.replace(old, new, 1)
    print('ok:', tag)

# 1. ICONS: consistent stroke-SVG system
rep("  const style = document.createElement('style');",
"""  const IC = (p) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
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
  const style = document.createElement('style');""", 'icons')

# 2. CSS: msg-bar icon row + compact chips
rep(".ai-msg-bar{display:flex;align-items:center;gap:14px;margin-top:11px;padding-top:9px;border-top:1px solid var(--ai-line,rgba(15,107,79,.08))}\n    .ai-msg-bar button{border:0;background:none;color:var(--ai-sub,#5F7A72);font:600 12px inherit;cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:2px}\n    .ai-msg-bar button:active{transform:scale(.94)}\n    .ai-msg-bar .sp{margin-left:auto}",
".ai-msg-bar{display:flex;align-items:center;gap:3px;margin-top:10px;padding-top:8px;border-top:1px solid var(--ai-line,rgba(15,107,79,.08))}\n    .ai-msg-bar .ab{width:31px;height:31px;border:0;background:none;color:var(--ai-sub,#7A948B);cursor:pointer;display:grid;place-items:center;border-radius:9px;transition:background .15s,color .15s,transform .12s}\n    .ai-msg-bar .ab:hover{background:var(--ai-mint,#EFF7F2);color:#0E6B4F}\n    .ai-msg-bar .ab:active{transform:scale(.88)}\n    .ai-msg-bar .ab svg{display:block}\n    .ai-msg-bar .ab[data-fb=up].on{color:#0E6B4F;background:rgba(14,107,79,.1)}\n    .ai-msg-bar .ab[data-fb=down].on{color:#B45309;background:rgba(180,83,9,.1)}\n    .ai-agent-root[data-theme=dark] .ai-msg-bar .ab:hover{background:rgba(47,191,143,.12);color:#5FE6BD}\n    .ai-msg-bar .sp{margin-left:auto}\n    .ai-msg-bar .abtxt{display:inline-flex;align-items:center;gap:5px;border:0;background:none;color:#0E6B4F;font:700 12px inherit;cursor:pointer;padding:5px 10px;border-radius:999px}",
'bar-css')

rep(".ai-followup{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}\n    .ai-followup button{border:1px dashed rgba(15,107,79,.3);background:none;color:#0E6B4F;border-radius:var(--r-pill);padding:7px 12px;font:700 11.5px inherit;cursor:pointer}\n    .ai-agent-root[data-theme=dark] .ai-followup button{color:#5FE6BD;border-color:rgba(47,191,143,.35)}",
".ai-followup{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}\n    .ai-followup button{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--ai-line,rgba(15,107,79,.15));background:var(--ai-mint,#F1F8F4);color:#0E6B4F;border-radius:999px;padding:5.5px 11px 5.5px 9px;font:600 12px inherit;cursor:pointer;transition:background .15s,transform .12s;box-shadow:none}\n    .ai-followup button:hover{background:#E4F3EC}\n    .ai-followup button:active{transform:scale(.96)}\n    .ai-followup button svg{flex:0 0 auto;opacity:.8}\n    .ai-agent-root[data-theme=dark] .ai-followup button{color:#5FE6BD;background:rgba(47,191,143,.1);border-color:rgba(47,191,143,.22)}\n    .ai-agent-root[data-theme=dark] .ai-followup button:hover{background:rgba(47,191,143,.16)}",
'chips-css')

# 3. i18n labels
rep("ph: 'Ask anything…', latest: '↓ Latest', stThink: 'Thinking...',",
"ph: 'Ask anything…', latest: '↓ Latest', chzSimple: 'সহজ করে বলো', chzExample: 'আরও উদাহরণ', chzQuiz: 'Quiz নাও', chzMcq: 'MCQ বানাও', chzSimilarMcq: 'Similar MCQ', chzShorten: 'সংক্ষেপে বলো', chzPoints: 'মূল পয়েন্ট', chzRevise: 'Revision Note', chzExplain: 'টপিক বুঝাও', stThink: 'Thinking...',",
'i18n-label-bn')
rep("ph: 'Ask anything…', latest: '↓ নতুন', stThink: 'ভাবছি...',",
"ph: 'Ask anything…', latest: '↓ নতুন', chzSimple: 'Simplify', chzExample: 'Examples', chzQuiz: 'Quiz me', chzMcq: 'Make MCQ', chzSimilarMcq: 'Similar MCQ', chzShorten: 'Summarize', chzPoints: 'Key points', chzRevise: 'Revision note', chzExplain: 'Explain topic', stThink: 'ভাবছি...',",
'i18n-label-en')

# 4. msg HTML
rep("      <div class=\"ai-msg-bar\">\n        <button onclick=\"window.__AiAgentCopy(this)\" data-t=\"${esc(m.text)}\">⧉ ${esc(T.copy)}</button>\n        ${m.regen ? `<button onclick=\"window.__AiAgentRegen&&__AiAgentRegen()\">↻ ${esc(T.regen)}</button>` : ''}\n        <button class=\"${m.fb === 'up' ? 'on' : ''}\" data-fb=\"up\" data-i=\"${idx}\" onclick=\"window.__AiAgentFb(this)\">👍</button>\n        <button class=\"${m.fb === 'down' ? 'on' : ''}\" data-fb=\"down\" data-i=\"${idx}\" onclick=\"window.__AiAgentFb(this)\">👎</button>\n        <span class=\"sp\"></span>\n        <button data-more=\"${idx}\" onclick=\"window.__AiAgentMore(this)\">⋯</button>\n      </div>${follow}</div>`;",
"      <div class=\"ai-msg-bar\">\n        <button class=\"ab\" data-t=\"${esc(m.text)}\" onclick=\"window.__AiAgentCopy(this)\" title=\"${esc(T.copy)}\" aria-label=\"${esc(T.copy)}\">${ICONS.copy}</button>\n        <button class=\"ab ${m.fb === 'up' ? 'on' : ''}\" data-fb=\"up\" data-i=\"${idx}\" onclick=\"window.__AiAgentFb(this)\" title=\"${esc(T.liked)}\" aria-label=\"${esc(T.liked)}\">${ICONS.like}</button>\n        <button class=\"ab ${m.fb === 'down' ? 'on' : ''}\" data-fb=\"down\" data-i=\"${idx}\" onclick=\"window.__AiAgentFb(this)\" title=\"${esc(T.feedbackQ)}\" aria-label=\"${esc(T.feedbackQ)}\">${ICONS.dislike}</button>\n        <button class=\"ab\" data-i=\"${idx}\" onclick=\"window.__AiAgentShare(this)\" title=\"${esc(T.shareBtn)}\" aria-label=\"${esc(T.shareBtn)}\">${ICONS.share}</button>\n        ${m.regen ? `<button class=\"ab\" onclick=\"window.__AiAgentRegen&&__AiAgentRegen()\" title=\"${esc(T.regen)}\" aria-label=\"${esc(T.regen)}\">${ICONS.regen}</button>` : ''}\n        <span class=\"sp\"></span>\n        <button class=\"ab\" data-more=\"${idx}\" onclick=\"window.__AiAgentMore(this)\" title=\"${esc(T.more)}\" aria-label=\"${esc(T.more)}\">${ICONS.more}</button>\n      </div>${follow}</div>`;",
'msg-html')

rep("    const follow = m.quiz ? '' : `<div class=\"ai-followup\">${followups(m).map((f) => `<button data-q=\"${esc(f[1])}\">${f[0]}</button>`).join('')}</div>`;",
"    const follow = m.quiz ? '' : `<div class=\"ai-followup\">${followups(m).map((f) => `<button data-q=\"${esc(f[2])}\">${ICONS[f[0]] || ''}${esc(f[1])}</button>`).join('')}</div>`;",
'chips-html')

rep("    const metaLine = m.liked ? '' : '';\n", "", 'ded-meta')

# 5. dynamic followups
rep("""  function followups(m) {
    return [
      ['🪄 আরও সহজ করুন', 'আরও সহজভাবে ব্যাখ্যা করো: ' + lastTopic(m)],
      ['🎯 এটা থেকে Quiz', 'এই বিষয়ে আমাকে ৫টা প্রশ্ন দিয়ে quiz নাও: ' + lastTopic(m)],
      ['📝 MCQ বানাও', 'এই topic থেকে আমাকে ৫টা MCQ বানাও: ' + lastTopic(m)]
    ];
  }""",
"""  function followups(m) {
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
    const long = t.length > 750 || (t.match(/\\n{1,}/g) || []).length > 10 || (t.match(/[.!?।]/g) || []).length > 16;
    const hasMcqList = /(mcq|প্রশ্ন দিয়ে|কুইজ|quiz)/i.test(t) && (/[0-9]+[.)]/.test(t) || /[কখগঘঙ]/i.test(t.slice(0, 400)));
    const isTest = /quiz|কুইজ|পরীক্ষা|test/i.test(t);
    const def = /(কী |কাকে |বলে |মানে |সংজ্ঞা|definition|means|explain)/i.test(t);
    if (long) return [['zap', T.chzShorten, P.shorten(topic)], ['sparkle', T.chzSimple, P.simple(topic)], ['list', T.chzPoints, P.points(topic)]];
    if (hasMcqList || isTest) return [['pencil', T.chzSimilarMcq, P.similar(topic)], ['target', T.chzQuiz, P.quiz(topic)], ['sparkle', T.chzExplain, P.explain(topic)]];
    if (def) return [['sparkle', T.chzSimple, P.simple(topic)], ['book', T.chzExample, P.example(topic)], ['target', T.chzQuiz, P.quiz(topic)]];
    return [['pencil', T.chzMcq, P.mcq(topic)], ['target', T.chzQuiz, P.quiz(topic)], ['book', T.chzRevise, P.revise(topic)]];
  }""", 'followups-dynamic')

# 6. error bar icon
rep("        <div class=\"ai-msg-bar\"><button onclick=\"window.__AiAgentRetry&&__AiAgentRetry()\">⟳ ${esc(T.retry)}</button>${m.login ? `<button class=\"sp\" onclick=\"window.__AiAgentLogin&&__AiAgentLogin()\">→ ${esc(T.loginBtn)}</button>` : ''}</div></div>`;",
"        <div class=\"ai-msg-bar\"><button class=\"ab\" onclick=\"window.__AiAgentRetry&&__AiAgentRetry()\" title=\"${esc(T.retry)}\" aria-label=\"${esc(T.retry)}\">${ICONS.regen}</button>${m.login ? `<button class=\"abtxt\" onclick=\"window.__AiAgentLogin&&__AiAgentLogin()\">→ ${esc(T.loginBtn)}</button>` : ''}</div></div>`;",
'error-bar')

# 7. copy check + share
rep("(navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { const o = el.innerHTML; el.innerHTML = '✓ ' + T.copied; setTimeout(() => { el.innerHTML = o; }, 1400); }).catch(() => toast('Copy unavailable'));",
"(navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { const o = el.innerHTML; el.innerHTML = ICONS.check; setTimeout(() => { el.innerHTML = o; }, 1300); }).catch(() => toast(T.copyFail));",
'copy-check')

rep("  function fbBtn(el) {",
"""  function shareBtn(el) {
    const i = +el.getAttribute('data-i'); const m = msgs[i]; if (!m || !m.text) return;
    const url = location.href.split('#')[0];
    if (navigator.share) { navigator.share({ title: T.title, text: String(m.text).slice(0, 900), url }).catch(() => {}); }
    else if (navigator.clipboard) { navigator.clipboard.writeText(String(m.text)).then(() => toast(T.copied)).catch(() => {}); }
  }
  function fbBtn(el) {""", 'share-fn')

rep("  window.__AiAgentCopy = copyBtn;",
"  window.__AiAgentCopy = copyBtn;\n  window.__AiAgentShare = shareBtn;", 'share-export')

# 8. followup delegation (was dead)
rep("    document.querySelectorAll('.ai-chip').forEach((c) => c.addEventListener('click', () => send(c.getAttribute('data-q'))));",
"    document.querySelectorAll('.ai-chip').forEach((c) => c.addEventListener('click', () => send(c.getAttribute('data-q'))));\n    if (!window.__aiFollowupDeleg) { window.__aiFollowupDeleg = true; document.addEventListener('click', (e) => { const b = e.target.closest('.ai-followup button'); if (b) send(b.getAttribute('data-q') || ''); }); }",
'followup-deleg')

# 9. i18n misc
rep("voiceNope: 'Voice input not supported on this device', msgTooLong: 'Message is too long — please keep it under 4,000 characters',",
"voiceNope: 'Voice input not supported on this device', msgTooLong: 'Message is too long — please keep it under 4,000 characters', shareBtn: 'Share', copyFail: 'Copy unavailable', more: 'More',",
'i18n-en-misc')
rep("voiceNope: 'এই ডিভাইসে ভয়েস-ইনপুট নেই', msgTooLong: 'মেসেজ খুব বড় — সর্বোচ্চ ৪,০০০ অক্ষর। ছোট করে আবার পাঠান।',",
"voiceNope: 'এই ডিভাইসে ভয়েস-ইনপুট নেই', msgTooLong: 'মেসেজ খুব বড় — সর্বোচ্চ ৪,০০০ অক্ষর। ছোট করে আবার পাঠান।', shareBtn: 'শেয়ার', copyFail: 'কপি করা যায়নি', more: 'আরও',",
'i18n-bn-misc')

open('ai-agent-chat.js', 'w', encoding='utf-8').write(s)
print('\nALL-DONE')
