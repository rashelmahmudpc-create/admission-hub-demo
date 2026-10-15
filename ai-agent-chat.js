/* ✦ ADMISSION HUB AI — Sky (student study partner)
 * UI: owner-supplied Sky design (sky-chat 2.html) — orb avatar, hero, chips,
 *     drawer, bottom sheet, themes. Kept pixel-for-pixel.
 * Backend: LIVE. No demo/canned data anywhere in this file.
 *   POST /api/ai/chat              (SSE stream)  — the real tutor
 *   POST /api/ai/actions/propose   /api/ai/actions/confirm — personalization
 * Theme: follows the app's Global Appearance Engine (window.AhAppearance,
 *   <html data-theme>), so app-dark → chat-dark, app-light → chat-light.
 * Contract kept from the previous chatv1 module: window.renderAiAgentPage.
 */
(function () {
  'use strict';
  if (window.renderAiAgentPage) return;

  const STORE = 'aiSkyChat:v1';
  const MAX_MSGS = 60;
  const MAX_HISTORY = 12;

  /* ───────── theme: single source of truth is the app's engine ───────── */
  function appResolved() {
    try { if (window.AhAppearance && typeof window.AhAppearance.resolved === 'function') return window.AhAppearance.resolved(); } catch (_) {}
    const t = document.documentElement.getAttribute('data-theme');
    return (t === 'dark' || t === 'midnight') ? 'dark' : 'light';
  }
  function paintTheme() {
    const r = appResolved();
    const app = document.getElementById('app');
    if (app) app.setAttribute('data-sky-theme', r);
    syncThemeBtns(r);
  }
  function syncThemeBtns(r) {
    const th = document.getElementById('th');
    if (!th) return;
    [...th.children].forEach((b) => {
      const t = b.getAttribute('data-t');
      const on = t === 'auto' ? false : t === r;
      b.classList.toggle('on', on);
    });
  }

  /* ───────── tiny helpers ───────── */
  const $ = (s, r) => (r || document).querySelector(s);
  const ic = (n, c) => '<svg class="i ' + (c || '') + '"><use href="#' + n + '"/></svg>';
  const pick = (a) => a[Math.random() * a.length | 0];
  const bn = (n) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let guestMemo = '';
  const guestId = () => {
    if (guestMemo) return guestMemo;
    let v = '';
    try { v = crypto.randomUUID(); } catch (_) {
      const b = new Uint8Array(18);
      try { crypto.getRandomValues(b); } catch (_) { for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256); }
      v = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    }
    guestMemo = v;
    return v;
  };

  /* Academic-only context. Identity fields are never read here; the server
     re-sanitizes. Guests send null. */
  function profilePayload() {
    try {
      const pid = localStorage.getItem('ah-profile-cache-key');
      if (!pid) return null;
      const entry = JSON.parse(localStorage.getItem('ah-profile-cache:' + pid) || 'null');
      const p = entry && entry.profile;
      if (!p || typeof p !== 'object') return null;
      const text = (v, max) => (typeof v === 'string' ? v.replace(/[\r\n\u0000<>]/g, '').trim().slice(0, max) : '');
      const school = p.school && typeof p.school === 'object' && p.school.name ? p.school : null;
      const higher = p.higherInstitution && typeof p.higherInstitution === 'object' && p.higherInstitution.name ? p.higherInstitution : null;
      const inst = higher || school;
      const out = {
        firstName: text(String(p.fullName || '').split(/\s+/)[0], 40),
        institutionName: inst ? text(inst.name, 120) : '',
        institutionType: inst ? (inst === higher ? 'college' : 'school') : '',
        district: inst ? text(inst.district, 60) : '',
        admissionSession: text(p.admissionSession, 40),
        academicGoal: text(p.academicGoal, 80),
        subjects: Array.isArray(p.subjects) ? p.subjects.slice(0, 10).map((s) => text(s, 40)).filter(Boolean) : [],
        targets: Array.isArray(p.targets) && p.targets[0] ? [{ name: text(p.targets[0].name, 120), unit: text(p.targets[0].unit, 40), year: text(p.targets[0].year, 40) }] : []
      };
      const any = out.firstName || out.institutionName || out.admissionSession || out.academicGoal || out.subjects.length || out.targets.length;
      return any ? out : null;
    } catch (_) { return null; }
  }

  /* Per-topic accuracy from the student's own result snapshots, so the tutor can
     say "your accuracy here is low — revise this". Only academic names leave the
     device. */
  const P06_TOPIC_MIN_ATTEMPTS = 3;
  const P06_WEAK_ACC = 70;
  const learningProfile = () => {
    try {
      if (typeof CACHE === 'undefined' || !Array.isArray(CACHE.examResults)) return { weakTopics: [], subjects: [] };
      const nameOf = (fn, id) => { try { return typeof fn === 'function' ? String(fn(id) || '').trim() : ''; } catch (_) { return ''; } };
      const topics = {}, subjects = {};
      for (const r of CACHE.examResults) {
        for (const q of (Array.isArray(r && r.snapshot) ? r.snapshot : [])) {
          const st = q && q.status;
          if (st !== 'correct' && st !== 'wrong') continue;
          const tn = nameOf(typeof topicName === 'function' ? topicName : null, q.topicId);
          if (tn && tn !== '\u2014') { const t = topics[tn] || (topics[tn] = { attempts: 0, correct: 0 }); t.attempts++; if (st === 'correct') t.correct++; }
        }
      }
      const weakTopics = Object.keys(topics)
        .filter((k) => topics[k].attempts >= P06_TOPIC_MIN_ATTEMPTS)
        .map((k) => ({ name: k, accuracy: Math.round((topics[k].correct / topics[k].attempts) * 100) }))
        .filter((t) => t.accuracy < P06_WEAK_ACC)
        .sort((a, b) => a.accuracy - b.accuracy)
        .slice(0, 5);
      return { weakTopics, subjects: Object.keys(subjects) };
    } catch (_) { return { weakTopics: [], subjects: [] }; }
  };

  /* Lifetime stats from the app's own store. Returns null when the host page
     does not expose them — the server then answers without personal stats. */
  function localStats() {
    try {
      if (typeof computeLifetimeStats !== 'function') return null;
      const s = computeLifetimeStats();
      const lp = learningProfile();
      const out = {
        exams: Number(s.exams || 0),
        questions: Number(s.totalQuestions || s.attempted || 0),
        accuracy: Number(s.accuracy || 0),
        streak: typeof computeStreak === 'function' ? Number(computeStreak() || 0) : 0,
        mistakes: typeof CACHE !== 'undefined' && Array.isArray(CACHE.mistakes) ? CACHE.mistakes.length : Number(s.wrong || 0),
        weakTopics: lp.weakTopics, subjects: lp.subjects
      };
      return out;
    } catch (_) { return null; }
  }

  /* ───────── markdown → safe HTML (escape-first) ───────── */
  function md(src) {
    let s = esc(String(src == null ? '' : src));
    const blocks = [];
    s = s.replace(/```([\s\S]*?)```/g, (m, c) => { blocks.push(c); return '\u0000CB' + (blocks.length - 1) + '\u0000'; });
    s = s.replace(/((?:^\|.*\|\s*$\n?)+)/gm, (block) => {
      const rows = block.trim().split('\n').map((r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      if (rows.length < 2) return block;
      const head = rows[0];
      let out = '<div class="tw"><table><thead><tr>' + head.map((c) => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>';
      for (const r of rows.slice(1)) { if (r.length === 1 && /^:?-{2,}:?$/.test(r[0])) continue; out += '<tr>' + r.map((c) => '<td>' + c + '</td>').join('') + '</tr>'; }
      return out + '</tbody></table></div>';
    });
    s = s.replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h3>$1</h3>');
    s = s.replace(/^(✅|📌|🧠|📚|💡|⚠️|❗)\s*(.+)$/gm, (m, k, txt) => '<div class="cal ' + ({ '✅': 'ok', '📌': 'key', '🧠': 'con', '📚': 'rev', '💡': 'tip', '⚠️': 'warn', '❗': 'warn' }[k]) + '"><b>' + k + '</b> ' + txt + '</div>');
    s = s.replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>').replace(/^\s*\d+[.)] (.*)$/gm, '<li>$1</li>');
    s = s.replace(/(?:<li>[\s\S]*?<\/li>)(?=(?:\s*<li>|$))/g, (m) => '<ul>' + m + '</ul>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/`([^`\n]+)`/g, '<code>$1</code>');
    s = s.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
    s = '<div class="body"><p>' + s + '</p></div>';
    return s.replace(/\u0000CB(\d+)\u0000/g, (m, i) => '<pre><code>' + blocks[+i].replace(/\n$/, '') + '</code></pre>');
  }

  /* ───────── session store: Firebase-account scoped ─────────
     Chat history is personal. It is keyed by the signed-in account and is never
     written to a shared key, so one student's conversations can never surface in
     another's session on a shared device. Guests get no persistence at all. */
  let sessions = [];
  let cur = 0;
  let accountScope = '';
  const scopedKey = key => accountScope ? key + ':account:' + accountScope : '';
  const scopedRead = (key) => {
    if (!accountScope) return null;
    try { return localStorage.getItem(scopedKey(key)); } catch (_) { return null; }
  };
  const scopedWrite = (key, value) => {
    if (!accountScope) return false;
    try { localStorage.setItem(scopedKey(key), String(value)); return true; } catch (_) { return false; }
  };

  function load() {
    sessions = [{ name: '', msgs: [], ts: Date.now() }]; cur = 0;
    if (accountScope) {
      try {
        const raw = JSON.parse(scopedRead(STORE) || 'null');
        if (raw && raw.v === 1 && Array.isArray(raw.list) && raw.list.length) {
          sessions = raw.list; cur = Math.min(+raw.cur || 0, sessions.length - 1);
        }
      } catch (_) { sessions = [{ name: '', msgs: [], ts: Date.now() }]; cur = 0; }
    }
  }
  function save() {
    /* No account → nothing is written. A guest conversation lives only in memory
       for the length of the visit. */
    if (!accountScope) return;
    try { sessions[cur].msgs = sessions[cur].msgs.slice(-MAX_MSGS); sessions[cur].ts = Date.now(); scopedWrite(STORE, JSON.stringify({ v: 1, list: sessions.slice(0, 20), cur: cur })); } catch (_) {}
  }

  /* Remove the legacy shared-device chat keys once. They were not bound to an
     account and must never leak into a newly signed-in student's history. */
  try { [STORE, 'ahAiGuestV1'].forEach(key => localStorage.removeItem(key)); } catch (_) {}

  window.addEventListener('admissionhub:authchange', (event) => {
    const detail = (event && event.detail) || {};
    const nextScope = detail.authenticated === true && /^[A-Za-z0-9_-]{8,128}$/.test(String((detail.user && detail.user.id) || ''))
      ? String(detail.user.id)
      : '';
    if (nextScope === accountScope) return;
    if (accountScope) {
      try { sessions[cur].msgs = sessions[cur].msgs.slice(-MAX_MSGS); scopedWrite(STORE, JSON.stringify({ v: 1, list: sessions.slice(0, 20), cur: cur })); } catch (_) {}
    }
    accountScope = nextScope;
    guestMemo = '';
    load();
    if (document.getElementById('msgs')) { renderMsgs(); if (!sessions[cur].msgs.length) resetHero(); }
  });

  /* ───────── live backend: SSE tutor ───────── */
  let activeReq = null;
  let streaming = false;

  async function ask(messages, onChunk, opts, onReplace) {
    opts = opts || {};
    const fresh = opts.fresh != null ? opts.fresh : messages.filter((m) => m.role === 'user').length <= 1;
    const payload = { messages: messages, fresh: fresh, context: { stats: localStats(), profile: profilePayload(), examMode: opts.mode || null } };
    const ctrl = new AbortController();
    activeReq = ctrl;
    let r;
    try {
      r = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AH-Guest': guestId() },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
    } catch (e) { activeReq = null; return { ok: false, code: 'offline' }; }
    if (!r.ok || !r.body) {
      activeReq = null;
      let detail = null; try { detail = await r.json(); } catch (_) {}
      return { ok: false, code: 'http', status: r.status, meta: detail };
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '', meta = null, failed = null;
    while (true) {
      let step;
      try { step = await reader.read(); } catch (_) { break; }
      if (step.done) break;
      buf += dec.decode(step.value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() || '';
      for (const part of parts) {
        let evt = '';
        for (const line of part.split('\n')) {
          const t = line.trim();
          if (t.startsWith('event:')) { evt = t.slice(6).trim(); continue; }
          if (!t.startsWith('data:')) continue;
          let j = null; try { j = JSON.parse(t.slice(5).trim()); } catch (_) { continue; }
          if (evt === 'replace' && typeof j.text === 'string') { full = j.text; if (onReplace) onReplace(full); else onChunk(full, true); }
          else if (j.text) { full += j.text; onChunk(full, false); }
          else if (j.error) failed = { message: j.message, retryable: j.retryable };
          else if (j.model || j.provider || j.intent) meta = { model: j.model, provider: j.provider, intent: j.intent };
        }
      }
    }
    activeReq = null;
    if (failed && !full) return { ok: false, code: 'ai', meta: failed };
    return { ok: true, text: full, meta: meta };
  }

  /* The server may correct text that already streamed (event: replace). A
     corrected answer is untrusted content arriving mid-render, so it is written
     with textContent and never re-parsed as markup. */
  let liveNode = null;
  function replaceStream(text) {
    const bw = liveNode && liveNode.querySelector('.bw');
    if (!bw) return;
    bw.textContent = '';
    const p = document.createElement('p');
    p.textContent = text;
    bw.appendChild(p);
    scrollEnd();
  }

  /* ───────── UI strings (no demo content) ───────── */
  const T = {
    title: 'Sky', sub: 'স্টাডি পার্টনার', online: 'অনলাইন',
    heroTitle: 'আমি স্কাই — তোমার পড়ার সঙ্গী',
    heroBody: 'ভর্তি প্রস্তুতির প্রশ্ন, MCQ, ব্যাখ্যা আর পড়ার সব সাহায্য — সব এখানে।',
    notice: 'স্কাইয়ের উত্তরে ভুল হতে পারে। ভর্তির গুরুত্বপূর্ণ তথ্য অফিসিয়াল সূত্রে যাচাই করুন।',
    tryAsking: 'জিজ্ঞেস করে দেখো',
    chips: [
      ['🧠', 'সহজ করে বুঝাও', 'এই টপিকটা সহজ করে বুঝাও'],
      ['📝', '১০টা MCQ বানাও', '১০টা MCQ বানাও'],
      ['🎯', 'কুইজ নাও', 'আমাকে কুইজ নাও — ৫টা প্রশ্ন'],
      ['📊', 'পারফরম্যান্স দেখো', 'আমার পারফরম্যান্স বিশ্লেষণ করো'],
      ['📚', 'টপিক শেখাও', 'এই টপিকটা শেখাও']
    ],
    ph: 'স্কাইকে জিজ্ঞেস করো…',
    thinking: 'ভাবছি', writing: 'লিখছি', searching: 'খুঁজছি',
    newChat: 'নতুন চ্যাট', recent: 'আগের কথোপকথন', none: 'এখনো কোনো কথোপকথন নেই',
    noHit: 'কিছু পাওয়া যায়নি', untitled: 'নতুন চ্যাট',
    copy: 'কপি', copied: 'কপি হয়েছে', regen: 'আবার', good: 'ভালো',
    backHome: 'অ্যাপে ফিরুন', homeBtn: 'অ্যাপের হোমে ফিরুন',
    tools: 'স্কাই টুলস', attach: 'কথোপকথনে যোগ করুন',
    offline: 'এখন ইন্টারনেট নেই — একটু পরে আবার চেষ্টা করো।',
    failed: 'উত্তরটা আসেনি। আবার চেষ্টা করো।',
    stopped: 'থামানো হয়েছে', stop: 'থামাও', send: 'পাঠাও', menu: 'মেনু',
    clear: 'সব মুছো', del: 'ডিলিট', pin: 'পিন', ren: 'নাম বদলাও', search: 'খুঁজুন',
    actTitle: 'নিশ্চিত করো', actConfirmQ: 'সেভ করবো?', actYes: 'হ্যাঁ', actNo: 'না',
    actApplied: 'সেভ হয়েছে', actCancelled: 'বাতিল', actExpired: 'সময় শেষ',
    actFail: 'সেভ করা যায়নি', actOffline: 'অফলাইন', actOnly: 'শুধু তোমার', actPending: 'অপেক্ষায়',
    needLogin: 'এটার জন্য লগইন করতে হবে'
  };
  /* English mirror. The language engine flips the page; the chat carries its own
     table so a switch never leaves half the UI in Bengali. */
  const T_EN = {
    actTitle: 'Confirm', actConfirmQ: 'Save this?', actYes: 'Yes', actNo: 'No',
    actApplied: 'Saved', actCancelled: 'Cancelled', actExpired: 'Expired',
    actFail: 'Could not save', actOffline: 'Offline', actOnly: 'Only for you', actPending: 'Pending',
    needLogin: 'Please sign in for this'
  };
  const lang = (() => { try { return localStorage.getItem('ahLang') === 'en' ? 'en' : 'bn'; } catch (_) { return 'bn'; } })();
  if (lang === 'en') Object.assign(T, T_EN);

  /* ───────── styles (scoped to #app.sky) ───────── */
  const CSS = `
#app.sky{--bg:#F6F9FF;--surf:#fff;--ink:#0F1B3D;--mute:#6B7799;--line:#E4EAF7;--pri:#3D6BFF;--pri2:#5AA9FF;--soft:#EDF2FF;--sun:#FFB63D;--ok:#12A36B;--bad:#E5484D;--grad:linear-gradient(135deg,#3D6BFF,#5AA9FF);--sh:0 8px 24px rgba(40,70,160,.08);--sh2:0 14px 34px rgba(61,107,255,.22);
position:fixed;inset:0;max-width:520px;margin:0 auto;display:flex;flex-direction:column;overflow:hidden;
background:radial-gradient(90% 38% at 50% -6%,var(--soft),transparent 72%),var(--bg);color:var(--ink);
font-family:"Hind Siliguri",system-ui,-apple-system,"Noto Sans Bengali",sans-serif;font-size:16px;-webkit-font-smoothing:antialiased;
padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);box-sizing:border-box}
#app.sky[data-sky-theme="dark"]{--bg:#0B1020;--surf:#131A33;--ink:#EAF0FF;--mute:#93A0C6;--line:#222C50;--soft:#1A2448;--sh:0 8px 24px rgba(0,0,0,.35);--sh2:0 14px 34px rgba(61,107,255,.3)}
#app.sky *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
#app.sky button,#app.sky input,#app.sky textarea{font:inherit;color:inherit}
#app.sky button{background:none;border:0;cursor:pointer;padding:0}
#app.sky svg.i{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
#app.sky header{display:flex;align-items:center;gap:8px;padding:10px 16px;position:relative;z-index:3}
#app.sky .ib{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:var(--surf);box-shadow:0 0 0 1px var(--line),0 2px 6px rgba(40,70,160,.05);transition:transform .15s}
#app.sky .ib:active{transform:scale(.88)}
#app.sky .brand{flex:1;display:flex;align-items:center;gap:6px;min-width:0;padding-left:4px}
#app.sky .hbw{width:0;opacity:0;transition:width .35s,opacity .35s}
#app.sky.chatting .hbw{width:42px;opacity:1}
#app.sky .hbw svg{width:42px;height:42px;cursor:pointer}
#app.sky .brand b{display:block;font-size:18px;font-weight:700;line-height:1.1}
#app.sky .brand small{display:flex;align-items:center;gap:5px;color:var(--mute);font-size:12px}
#app.sky .dot{width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px rgba(18,163,107,.16)}
#app.sky main{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:0 20px 24px;position:relative;z-index:2;display:flex;flex-direction:column;scroll-behavior:smooth}
#app.sky #msgs{flex:none}
#app.sky .hero{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding-bottom:7vh}
#app.sky .bub{height:46px;display:flex;align-items:flex-end}
#app.sky .say{position:relative;max-width:300px;padding:9px 18px;border-radius:999px;background:var(--surf);box-shadow:0 0 0 1px var(--line),var(--sh);font-size:14.5px;font-weight:600;text-align:center;line-height:1.4;opacity:0;transform:translateY(6px) scale(.96);transition:opacity .25s,transform .3s cubic-bezier(.3,1.4,.5,1)}
#app.sky .say.on{opacity:1;transform:none}
#app.sky .say2{position:fixed;left:50%;transform:translateX(-50%) translateY(-8px);top:calc(64px + env(safe-area-inset-top,0px));z-index:40;background:var(--ink);color:var(--bg);padding:8px 16px;border-radius:999px;font-size:13.5px;font-weight:600;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;max-width:88%}
#app.sky .say2.on{opacity:.95;transform:translateX(-50%)}
#app.sky .hbig{width:190px;height:190px;cursor:pointer}
#app.sky .av{width:100%;height:100%;display:block;overflow:visible}
#app.sky .av.xs{width:22px;height:22px}
#app.sky .who{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--pri);margin-bottom:6px}
#app.sky .u{display:flex;justify-content:flex-end;margin:14px 0}
#app.sky .u span{max-width:82%;background:var(--grad);color:#fff;padding:11px 16px;border-radius:18px 18px 4px 18px;font-size:15px;line-height:1.55;box-shadow:var(--sh2);word-break:break-word}
#app.sky .ai{margin:4px 0 18px}
#app.sky .ai .bw{font-size:15px;line-height:1.75;word-break:break-word}
#app.sky .ai .bw p{margin:0 0 10px}
#app.sky .ai .bw ul{margin:6px 0 12px;padding-left:22px}
#app.sky .ai .bw li{margin:4px 0}
#app.sky .ai .bw h2,#app.sky .ai .bw h3{font-size:16.5px;margin:14px 0 8px;color:var(--pri)}
#app.sky .ai .bw code{background:var(--soft);padding:2px 6px;border-radius:6px;font-size:13.5px}
#app.sky .ai .bw pre{background:#0F1B3D;color:#EAF0FF;padding:12px;border-radius:12px;overflow-x:auto;margin:10px 0}
#app.sky .ai .bw pre code{background:none;color:inherit;padding:0}
#app.sky .cal{border-radius:12px;padding:10px 12px;margin:8px 0;font-size:14.5px;line-height:1.6}
#app.sky .cal.tip{background:#FFF6E5}#app.sky .cal.warn{background:#FFECEC}#app.sky .cal.ok{background:#E9F9F1}#app.sky .cal.con{background:var(--soft)}#app.sky .cal.rev{background:#F1ECFF}#app.sky .cal.key{background:#EAF1FF}
#app.sky[data-sky-theme="dark"] .cal.tip{background:#3A2E12}#app.sky[data-sky-theme="dark"] .cal.warn{background:#3A1A1C}#app.sky[data-sky-theme="dark"] .cal.ok{background:#123326}#app.sky[data-sky-theme="dark"] .cal.rev{background:#241C3D}#app.sky[data-sky-theme="dark"] .cal.key{background:#16224A}
#app.sky .tw{overflow-x:auto;margin:10px 0}
#app.sky table{border-collapse:collapse;width:100%;font-size:14px}
#app.sky th,#app.sky td{border:1px solid var(--line);padding:7px 10px;text-align:left}
#app.sky th{background:var(--soft);font-weight:700}
#app.sky .acts{display:flex;gap:6px;margin-top:10px}
#app.sky .acts button{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--surf);box-shadow:0 0 0 1px var(--line);color:var(--mute);transition:transform .15s,color .15s}
#app.sky .acts button:active{transform:scale(.9)}
#app.sky .acts button.on{color:var(--pri)}
#app.sky .acts svg.i{width:16px;height:16px}
#app.sky .typing{display:flex;gap:5px;padding:6px 2px}
#app.sky .typing i{width:8px;height:8px;border-radius:50%;background:var(--mute);opacity:.35;animation:skyb 1.1s infinite}
#app.sky .typing i:nth-child(2){animation-delay:.18s}#app.sky .typing i:nth-child(3){animation-delay:.36s}
@keyframes skyb{0%,60%,100%{transform:translateY(0);opacity:.3}30%{transform:translateY(-5px);opacity:.85}}
#app.sky .chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
#app.sky .chips button{background:var(--surf);box-shadow:0 0 0 1px var(--line);border-radius:999px;padding:8px 14px;font-size:13.5px;font-weight:600;color:var(--pri);transition:transform .15s}
#app.sky .chips button:active{transform:scale(.95)}
#app.sky .dock{padding:10px 16px calc(12px + env(safe-area-inset-bottom,0px));position:relative;z-index:3}
#app.sky .comp{display:flex;align-items:flex-end;gap:8px;background:var(--surf);border-radius:26px;padding:6px 8px;box-shadow:0 0 0 1px var(--line),var(--sh)}
#app.sky .cb{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:var(--soft);color:var(--pri);flex:none;transition:transform .15s}
#app.sky .cb:active{transform:scale(.9)}
#app.sky .cb.send{background:var(--grad);color:#fff;box-shadow:var(--sh2)}
#app.sky #inp{flex:1;border:0;outline:0;background:none;resize:none;max-height:120px;padding:10px 4px;font-size:16px;line-height:1.5;font-family:inherit;-webkit-appearance:none;appearance:none}
#app.sky .scrim{position:fixed;inset:0;background:rgba(9,16,40,.42);opacity:0;pointer-events:none;transition:opacity .25s;z-index:50}
#app.sky .scrim.on{opacity:1;pointer-events:auto}
#app.sky .drawer{position:fixed;top:0;left:0;bottom:0;width:82%;max-width:330px;background:var(--surf);z-index:60;transform:translateX(-102%);transition:transform .3s cubic-bezier(.3,1,.4,1);display:flex;flex-direction:column;padding:calc(14px + env(safe-area-inset-top,0px)) 16px calc(16px + env(safe-area-inset-bottom,0px));gap:10px;overflow-y:auto}
#app.sky .drawer.on{transform:none}
#app.sky .drawer.drag{transition:none}
#app.sky .dp{display:flex;align-items:center;gap:10px}
#app.sky .dp span{width:44px;height:44px}
#app.sky .dp b{display:block;font-size:16px}#app.sky .dp small{display:flex;align-items:center;gap:5px;color:var(--mute);font-size:12px}
#app.sky .dp .ib{margin-left:auto}
#app.sky .new{display:flex;align-items:center;gap:9px;background:var(--grad);color:#fff;border-radius:14px;padding:12px 14px;font-weight:700;font-size:15px;box-shadow:var(--sh2)}
#app.sky .new svg.i{width:18px;height:18px}
#app.sky .sc{display:flex;flex-direction:column;gap:2px}
#app.sky .sc button{display:flex;align-items:center;gap:10px;padding:11px 8px;border-radius:12px;font-size:15px;font-weight:600;text-align:left}
#app.sky .sc button:active{background:var(--soft)}
#app.sky .sc svg.i{width:19px;height:19px;color:var(--pri)}
#app.sky .srch{display:flex;align-items:center;gap:8px;background:var(--soft);border-radius:12px;padding:9px 12px}
#app.sky .srch svg.i{width:17px;height:17px;color:var(--mute)}
#app.sky .srch input{flex:1;border:0;outline:0;background:none;font-size:14.5px}
#app.sky .dl{flex:1;min-height:40px}
#app.sky .gl{font-size:12px;font-weight:700;color:var(--mute);margin:10px 0 4px}
#app.sky .hi{border-radius:12px;margin-bottom:2px;overflow:hidden}
#app.sky .hi.act{background:var(--soft)}
#app.sky .hr1{display:flex;align-items:center;gap:6px}
#app.sky .it{flex:1;display:flex;align-items:center;gap:9px;padding:9px 8px;font-size:14.5px;text-align:left;min-width:0}
#app.sky .it span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#app.sky .it svg.i{width:16px;height:16px;color:var(--mute)}
#app.sky .mo{width:32px;height:32px;display:grid;place-items:center;color:var(--mute);flex:none}
#app.sky .mo svg.i{width:16px;height:16px}
#app.sky .ha{display:none;gap:4px;padding:0 8px 8px}
#app.sky .hi.open .ha{display:flex}
#app.sky .ha button{display:flex;align-items:center;gap:5px;font-size:12.5px;color:var(--mute);padding:5px 8px;border-radius:8px}
#app.sky .ha button:active{background:var(--soft)}
#app.sky .ha svg.i{width:14px;height:14px}
#app.sky .df{display:flex;flex-direction:column;gap:10px;margin-top:auto}
#app.sky .th{display:flex;gap:6px;background:var(--soft);border-radius:12px;padding:4px}
#app.sky .th button{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px;border-radius:9px;font-size:13px;font-weight:600;color:var(--mute)}
#app.sky .th button.on{background:var(--surf);color:var(--pri);box-shadow:0 2px 6px rgba(40,70,160,.1)}
#app.sky .th svg.i{width:15px;height:15px}
#app.sky .exit{display:flex;align-items:center;gap:9px;padding:11px 8px;border-radius:12px;font-size:14.5px;font-weight:600;color:var(--mute)}
#app.sky .exit svg.i{width:18px;height:18px}
#app.sky .dnote{font-size:11.5px;color:var(--mute);line-height:1.6;margin:2px 0 0}
#app.sky .sheet{position:fixed;left:0;right:0;bottom:0;max-width:520px;margin:0 auto;background:var(--surf);border-radius:22px 22px 0 0;z-index:60;transform:translateY(102%);transition:transform .3s cubic-bezier(.3,1,.4,1);padding:10px 18px calc(20px + env(safe-area-inset-bottom,0px))}
#app.sky .sheet.on{transform:none}
#app.sky .grab{width:40px;height:4px;border-radius:2px;background:var(--line);margin:0 auto 12px}
#app.sky .sheet h4{font-size:13px;color:var(--mute);font-weight:700;margin:12px 0 8px}
#app.sky .g{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
#app.sky .g button{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--mute)}
#app.sky .g span{width:52px;height:52px;border-radius:16px;display:grid;place-items:center;background:var(--soft);color:var(--pri)}
#app.sky .tools{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
#app.sky .tools button{display:flex;align-items:center;gap:7px;background:var(--soft);border-radius:12px;padding:10px;font-size:13px;font-weight:600;color:var(--pri)}
#app.sky .tools svg.i{width:16px;height:16px}
#app.sky .notice{margin:8px 0 14px;background:var(--soft);border-radius:14px;padding:11px 14px;font-size:12.5px;color:var(--mute);line-height:1.6;display:flex;gap:8px;align-items:flex-start}
#app.sky .notice b{color:var(--pri);font-weight:700}
#app.sky .notice button{margin-left:auto;color:var(--mute);font-size:12px;font-weight:700;flex:none}
#app.sky .tryq{margin-top:14px}
#app.sky .tryq small{font-size:12px;font-weight:700;color:var(--mute)}
#app.sky .pr{animation:skypr .28s ease}
@keyframes skypr{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
`;

  /* ───────── avatar (owner's Sky orb) ───────── */
  const AV = '<g class="sh"><ellipse cx="100" cy="195" rx="46" ry="6" fill="#1B2A6B" opacity=".16"/></g><g class="all"><rect x="68" y="172" width="30" height="18" rx="8" fill="#FFA23A"/><rect x="102" y="172" width="30" height="18" rx="8" fill="#FFA23A"/><path d="M90 172q10 22 20 0z" fill="#3F5BE0"/><g class="wl"><path d="M46 106C22 116 18 144 30 158C50 156 64 142 66 122Z" fill="#3E5FE6"/></g><g class="wr"><path d="M154 106C178 116 182 144 170 158C150 156 136 142 134 122Z" fill="#3E5FE6"/></g><circle cx="100" cy="108" r="72" fill="url(#gB)"/><ellipse cx="100" cy="146" rx="46" ry="34" fill="#F6F9FF"/><ellipse cx="66" cy="68" rx="24" ry="13" fill="#fff" opacity=".22" transform="rotate(-25 66 68)"/><circle cx="56" cy="116" r="11" fill="#B79BEA" opacity=".5"/><circle cx="144" cy="116" r="11" fill="#B79BEA" opacity=".5"/><g class="eyes"><circle cx="74" cy="104" r="19" fill="#fff"/><circle cx="126" cy="104" r="19" fill="#fff"/><g class="pup"><circle cx="75" cy="106" r="11.5" fill="#17234F"/><circle cx="125" cy="106" r="11.5" fill="#17234F"/><circle cx="70" cy="101" r="4.4" fill="#fff"/><circle cx="120" cy="101" r="4.4" fill="#fff"/><circle cx="80" cy="111" r="2" fill="#fff"/><circle cx="130" cy="111" r="2" fill="#fff"/></g></g><g class="br" fill="none" stroke="#1B2A6B" stroke-width="4.5" stroke-linecap="round"><path d="M54 84q18-9 36-2"/><path d="M110 82q18-7 36 2"/></g><path d="M89 125q11-8 22 0q-3 11-11 12q-8-1-11-12z" fill="#FFA83B"/><g class="jaw"><path d="M93 134q7 5 14 0q-2 7-7 8q-5-1-7-8z" fill="#E9812B"/></g><g class="cap"><path d="M66 58v14q34 14 68 0V58z" fill="#25347A"/><path d="M42 56l60-20 60 20-60 22z" fill="#1B2765"/><path d="M102 46l2.8 5.6 6.2.9-4.5 4.3 1.1 6.1-5.6-2.9-5.6 2.9 1.1-6.1-4.5-4.3 6.2-.9z" fill="#FFB63D"/><g class="tas"><path d="M150 60q4 14 2 26" stroke="#FFB63D" stroke-width="3.5" fill="none" stroke-linecap="round"/><circle cx="152" cy="90" r="5.5" fill="#FFB63D"/></g></g></g>';
  const av = (c) => '<svg class="av ' + (c || '') + '" viewBox="0 0 200 200">' + AV + '</svg>';

  /* ───────── markup ───────── */
  function shell() {
    return '' +
      '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
      '<radialGradient id="gB" cx="50%" cy="38%" r="62%"><stop offset="0" stop-color="#7FA8FF"/><stop offset="1" stop-color="#3D6BFF"/></radialGradient>' +
      '<symbol id="menu" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></symbol>' +
      '<symbol id="edit" viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14 6l4 4"/></symbol>' +
      '<symbol id="home" viewBox="0 0 24 24"><path d="M4 10.5L12 4l8 6.5V20H4z"/><path d="M9 20v-6h6v6"/></symbol>' +
      '<symbol id="plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>' +
      '<symbol id="mic" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></symbol>' +
      '<symbol id="send" viewBox="0 0 24 24"><path d="M4 12l16-8-6 8 6 8z"/></symbol>' +
      '<symbol id="copy" viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="12" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></symbol>' +
      '<symbol id="redo" viewBox="0 0 24 24"><path d="M19 5v5h-5M18.5 10A7 7 0 1 0 19 14"/></symbol>' +
      '<symbol id="up" viewBox="0 0 24 24"><path d="M8 11v9H4v-9zM8 11l4-7c2 0 3 1.5 2.5 3.5L14 10h5a2 2 0 0 1 2 2.4l-1.2 6A2 2 0 0 1 18 20H8"/></symbol>' +
      '<symbol id="x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>' +
      '<symbol id="chat" viewBox="0 0 24 24"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5 4v-4H6a2 2 0 0 1-2-2z"/></symbol>' +
      '<symbol id="book" viewBox="0 0 24 24"><path d="M4 5.5C7 4 10 4.5 12 6c2-1.5 5-2 8-.5V19c-3-1.5-6-1-8 .5-2-1.5-5-2-8-.5z"/><path d="M12 6v13.5"/></symbol>' +
      '<symbol id="xc" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/></symbol>' +
      '<symbol id="exam" viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="3"/><path d="M9 4V3h6v1M9 11l2 2 4-4M9 17h6"/></symbol>' +
      '<symbol id="spark" viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></symbol>' +
      '<symbol id="dots" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></symbol>' +
      '<symbol id="trash" viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></symbol>' +
      '<symbol id="pin" viewBox="0 0 24 24"><path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7"/></symbol>' +
      '<symbol id="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></symbol>' +
      '<symbol id="moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></symbol>' +
      '<symbol id="auto" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></symbol>' +
      '<symbol id="search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></symbol>' +
      '<symbol id="arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>' +
      '<symbol id="cam" viewBox="0 0 24 24"><path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13" r="3.4"/></symbol>' +
      '<symbol id="img" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M4 16l5-4 4 3 3-2 4 3"/></symbol>' +
      '<symbol id="doc" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></symbol>' +
      '<symbol id="vid" viewBox="0 0 24 24"><rect x="4" y="6" width="12" height="12" rx="3"/><path d="M16 11l4-3v8l-4-3z"/></symbol>' +
      '<symbol id="globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 3 2.5 14 0 17M12 3.5c-2.5 3-2.5 14 0 17"/></symbol>' +
      '<symbol id="mcq" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 10h8M8 14h5"/></symbol>' +
      '<symbol id="target" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></symbol>' +
      '<symbol id="bulb" viewBox="0 0 24 24"><path d="M12 4a6 6 0 0 0-3 11v3h6v-3a6 6 0 0 0-3-11z"/><path d="M10 21h4"/></symbol>' +
      '<symbol id="chart" viewBox="0 0 24 24"><path d="M5 19V9M12 19V5M19 19v-7"/></symbol>' +
      '<symbol id="sum" viewBox="0 0 24 24"><path d="M5 5h14M5 5l7 7-7 7h14"/></symbol>' +
      '<symbol id="stop" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5"/></symbol>' +
      '</defs></svg>' +
      '<header>' +
      '<button class="ib" id="menuB" aria-label="' + T.menu + '">' + ic('menu') + '</button>' +
      '<div class="brand"><div class="hbw" id="hbw"></div><div><b>Sky</b><small><i class="dot"></i>' + T.sub + '</small></div></div>' +
      '<button class="ib" id="newB" aria-label="' + T.newChat + '">' + ic('edit') + '</button>' +
      '<button class="ib" id="homeB" aria-label="' + T.backHome + '">' + ic('home') + '</button>' +
      '</header>' +
      '<div class="say2" id="say2"></div>' +
      '<main id="chat"><section class="hero" id="hero">' +
      '<div class="bub"><div class="say" id="say"></div></div>' +
      '<div class="hbig" id="hbig"></div>' +
      '<div class="tryq" id="tryq"></div>' +
      '</section><div id="msgs"></div></main>' +
      '<div class="dock"><div class="comp">' +
      '<button class="cb" id="plusB" aria-label="' + T.attach + '">' + ic('plus') + '</button>' +
      '<textarea id="inp" rows="1" placeholder="' + T.ph + '"></textarea>' +
      '<button class="cb" id="actB" aria-label="' + T.send + '">' + ic('mic') + '</button>' +
      '</div></div>' +
      '<div class="scrim" id="scrim"></div>' +
      '<aside class="drawer" id="drawer">' +
      '<div class="dp"><span id="dw"></span><div><b>Sky</b><small><i class="dot"></i>' + T.online + '</small></div><button class="ib" id="closeD" aria-label="বন্ধ">' + ic('x') + '</button></div>' +
      '<button class="new" id="newD">' + ic('plus') + T.newChat + '</button>' +
      '<div class="sc">' +
      '<button data-go="question-bank">' + ic('book') + 'প্রশ্ন ব্যাংক</button>' +
      '<button data-go="mistake-bank">' + ic('xc') + 'ভুল-ব্যাংক</button>' +
      '<button data-go="exam">' + ic('exam') + 'পরীক্ষা</button>' +
      '</div>' +
      '<label class="srch">' + ic('search') + '<input id="hs" placeholder="' + T.search + '" autocomplete="off"></label>' +
      '<div class="dl" id="hl"></div>' +
      '<div class="df">' +
      '<div class="th" id="th"><button data-t="light">' + ic('sun') + 'লাইট</button><button data-t="dark">' + ic('moon') + 'ডার্ক</button><button data-t="auto">' + ic('auto') + 'অটো</button></div>' +
      '<button class="exit" id="exitD">' + ic('home') + T.homeBtn + '</button>' +
      '<p class="dnote">' + T.notice + '</p>' +
      '</div></aside>' +
      '<div class="sheet" id="sheet"><div class="grab"></div>' +
      '<h4>' + T.attach + '</h4>' +
      '<div class="g"><button id="camB"><span>' + ic('cam') + '</span>ক্যামেরা</button><button id="imgB"><span>' + ic('img') + '</span>ছবি</button><button id="docB"><span>' + ic('doc') + '</span>ডকুমেন্ট</button><button id="vidB"><span>' + ic('vid') + '</span>ভিডিও</button></div>' +
      '<h4>' + T.tools + '</h4>' +
      '<div class="tools">' +
      '<button data-q="ওয়েবে খুঁজে দেখো">' + ic('globe') + 'সার্চ</button>' +
      '<button data-q="১০টা MCQ বানাও">' + ic('mcq') + 'MCQ</button>' +
      '<button data-q="আমাকে কুইজ নাও — ৫টা প্রশ্ন">' + ic('target') + 'Quiz</button>' +
      '<button data-q="এই টপিকটা সহজ করে বুঝাও">' + ic('bulb') + 'ব্যাখ্যা</button>' +
      '<button data-q="আমার পারফরম্যান্স বিশ্লেষণ করো">' + ic('chart') + 'বিশ্লেষণ</button>' +
      '<button data-q="সারসংক্ষেপ করো">' + ic('sum') + 'সারসংক্ষেপ</button>' +
      '</div></div>' +
      '<input type="file" id="filePick" accept="image/*" style="display:none">';
  }

const ACT_ACTIONS = { 'prefs.write': { bn: 'তোমার AI পছন্দ সেভ করা', en: 'Save your AI preferences' } };
  const AUTO_CONFIRM_ACTIONS = new Set(['prefs.write']);
  function actLabel(action) {
    const k = ACT_ACTIONS[action];
    return k ? (lang === 'en' ? k.en : k.bn) : String(action || '');
  }
  function actionCardHtml(m, idx) {
    const head = `<div class="ai-msg ai"><div class="ai-msg-head"><span class="mini"></span>${esc(T.title)}</div><div class="ai-act">
      <div class="ai-act-h">⚙️ ${esc(T.actTitle)} · ${esc(actLabel(m.actAction))}</div>`;
    const sum = m.actSummary ? `<div class="ai-act-sum">${esc(m.actSummary)}</div>` : '';
    if (m.actDone) {
      return `${head}${sum}<div class="ai-act-done ${m.actDone === 'cancelled' || m.actDone === 'error' ? 'bad' : ''}">${esc(m.actDoneText || T.actApplied)}</div></div></div>`;
    }
    return `${head}<div class="ai-act-q">${esc(m.actWhy || T.actConfirmQ)}</div>${sum}
      <div class="ai-act-btns"><button class="ai-act-yes" onclick="window.__AiActDecide(${idx},1)">✔ ${esc(T.actYes)}</button><button class="ai-act-no" onclick="window.__AiActDecide(${idx},0)">✖ ${esc(T.actNo)}</button></div>
      <div class="ai-act-note">🔒 ${esc(T.actOnly)}</div></div></div>`;
  }
  function actionExpired(m) {
    return !m.actDone && m.actExpiresAt && Date.now() > m.actExpiresAt;
  }
  function dropExpiredAction() {
    const last = msgs[msgs.length - 1];
    if (!last || !last.pending || !actionExpired(last)) return false;
    last.pending = false; last.actDone = 'error'; last.actDoneText = T.actExpired;
    save(); return true;
  }
  function postAction(path, payload) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) })
      .then((r) => r.json().catch(() => null).then((j) => ({ status: r.status, body: j })))
      .catch(() => ({ status: 0, body: null }));
  }
  /* Confirm a pending proposal and collapse it to a terminal state. Returns the
     toast to show, if any. Shared by the tap handler and the auto-confirm path. */
  async function resolveProposal(m) {
    const res = await postAction('/api/ai/actions/confirm', { token: m.actId });
    if (res.status === 200 && res.body && res.body.ok) {
      m.actDone = 'applied'; m.actDoneText = T.actApplied;
      return '';
    }
    if (res.status === 0) return T.actOffline;
    const reason = res.body && (res.body.reason || res.body.error);
    m.actDone = 'error';
    m.actDoneText = reason === 'expired' ? T.actExpired : T.actFail;
    return '';
  }
  async function decideAction(idx, yes) {
    const m = msgs[idx];
    if (!m || !m.pending || m.actBusy) return;
    if (actionExpired(m)) { m.pending = false; m.actDone = 'error'; m.actDoneText = T.actExpired; save(); renderMsgs(); return; }
    m.actBusy = true; renderMsgs();
    if (!yes) {
      m.pending = false; m.actDone = 'cancelled'; m.actDoneText = T.actCancelled;
      m.actBusy = false; save(); renderMsgs(); return;
    }
    const warn = await resolveProposal(m);
    m.actBusy = false;
    if (warn) { save(); renderMsgs(); toast(warn); return; }
    m.pending = false; save(); renderMsgs();
  }
  window.__AiActDecide = decideAction;
  /* Detect an explicit personalization request in the student's own words and map
     it to declared args. Keep it deliberately narrow: only clear, first-person
     requests, and never when a preference is already being offered. */
  function actParseIntent(q) {
    const s = String(q || '');
    const args = {};
    if (/(উত্তর\s*(ছোট|সংক্ষিপ্ত|short)|সংক্ষেপে\s*উত্তর|keep\s+(it|answers?|responses?)\s+short|short(er)?\s+answers?|concise)/i.test(s)) args.responseLen = 'short';
    if (/(বিস্তারিত|ডিটেইল|detailed|in\s+detail|elaborate)/i.test(s)) args.responseLen = 'detailed';
    if (/(আরও\s*সহজ|সহজ\s*(করে|ভাষায়)|simple\s+(words|language)|simpler)/i.test(s)) args.tone = 'simple';
    if (/(professional|আনুষ্ঠানিক|formal)/i.test(s)) args.tone = 'professional';
    if (/(উৎসাহ|motivat|inspir)/i.test(s)) args.tone = 'motivating';
    if (/(সরাসরি|সংক্ষেপে\s*বলো|direct|straight\s*to)/i.test(s)) args.tone = 'direct';
    if (/(ইংরেজিতে\s*উত্তর|answer\s+in\s+english|reply\s+in\s+english|english\s*-?এ\s*উত্তর)/i.test(s)) args.langStyle = 'en';
    if (/(বাংলায়\s*উত্তর|answer\s+in\s+bangla|reply\s+in\s+bangla)/i.test(s)) args.langStyle = 'bn';
    if (!Object.keys(args).length) return null;
    return { action: 'prefs.write', args };
  }
  async function offerAction(intent) {
    const res = await postAction('/api/ai/actions/propose', { action: intent.action, args: intent.args });
    if (res.status === 200 && res.body && res.body.ok && res.body.proposal) {
      const p = res.body.proposal;
      const m = { role: 'ai', text: '', ts: Date.now(), pending: true, actId: p.id, actAction: p.action, actSummary: p.summary || '', actExpiresAt: p.expiresAt || (Date.now() + 300000) };
      if (AUTO_CONFIRM_ACTIONS.has(p.action)) {
        /* Confirm before the first paint, so the card only ever shows the outcome. */
        const warn = await resolveProposal(m);
        if (warn) {
          /* The confirm never reached the Worker, so the token is still good:
             leave the card tappable rather than showing a dead or false result. */
          m.pending = true; m.actBusy = false;
          msgs.push(m); save(); renderMsgs(); toast(warn);
          return true;
        }
        m.pending = false;
        msgs.push(m); save(); renderMsgs();
        return true;
      }
      msgs.push(m); save(); renderMsgs();
      return true;
    }
    if (res.status === 401) { toast(T.needLogin, true); return true; }
    /* Anything else (layer off, denied) falls through: the normal answer proceeds. */
    return false;
  }

  /* Message renderer entry point. Kept as the named boundary the M9 action-ui
     guard slices on, and as the one place a message becomes HTML. */
  function msgHtml(m, idx) { return bubble(m, idx); }

  /* ───────── render ───────── */
  let msgsEl, mainEl, inpEl, actEl, busy = 0;

  function bubble(m, idx) {
    if (m.role === 'user') return '<div class="u pr"><span>' + esc(m.text) + '</span></div>';
    let inner;
    if (m.error) inner = '<div class="cal warn"><b>⚠️</b> ' + esc(m.error) + '</div>';
    else if (m.pending && !m.text) inner = '<div class="typing"><i></i><i></i><i></i></div>';
    else inner = md(m.text);
    const acts = (!m.pending && !m.error && m.text) ? '<div class="acts">' +
      '<button data-c="' + idx + '" aria-label="' + T.copy + '">' + ic('copy') + '</button>' +
      '<button data-r="' + idx + '" aria-label="' + T.regen + '">' + ic('redo') + '</button>' +
      '<button data-g="' + idx + '" aria-label="' + T.good + '">' + ic('up') + '</button>' +
      '</div>' : '';
    return '<div class="ai pr" data-i="' + idx + '"><div class="who">' + av('xs') + 'Sky</div><div class="bw">' + inner + '</div>' + acts + '</div>';
  }

  function renderMsgs() {
    if (!msgsEl) return;
    msgsEl.innerHTML = sessions[cur].msgs.map(bubble).join('');
    scrollEnd();
  }
  function scrollEnd() { try { mainEl.scrollTop = mainEl.scrollHeight; } catch (_) {} }

  function setBusy(on) {
    busy = on ? 1 : 0;
    if (!actEl) return;
    if (on) { actEl.className = 'cb'; actEl.innerHTML = ic('stop'); actEl.setAttribute('aria-label', T.stop); }
    else { actEl.className = 'cb' + (inpEl.value.trim() ? ' send' : ''); actEl.innerHTML = ic(inpEl.value.trim() ? 'send' : 'mic'); actEl.setAttribute('aria-label', inpEl.value.trim() ? T.send : 'ভয়েস'); }
  }

  async function send(text) {
    const t = String(text == null ? inpEl.value : text).trim();
    if (!t || busy) return;
    const hero = document.getElementById('hero');
    if (hero) hero.style.display = 'none';
    const app = document.getElementById('app');
    if (app) app.classList.add('chatting');
    inpEl.value = ''; inpEl.style.height = 'auto'; inpEl.blur();

    sessions[cur].msgs.push({ role: 'user', text: t, ts: Date.now() });
    if (!sessions[cur].name) sessions[cur].name = t.slice(0, 40);
    const holder = { role: 'ai', text: '', ts: Date.now(), pending: true };
    sessions[cur].msgs.push(holder);
    save(); renderMsgs();

    const node = msgsEl.querySelector('.ai[data-i="' + (sessions[cur].msgs.length - 1) + '"]');
    liveNode = node;
    setBusy(true); mood('think');

    let prior = sessions[cur].msgs.slice(0, -1).slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.text }));
    /* The turn the student just typed is already the last entry; drop it here or
       the model receives it twice and reads "৮" as "৮৮" (regression 2026-09). */
    const last = prior[prior.length - 1];
    if (last && last.role === 'user' && last.content === userText) prior = prior.slice(0, -1);
    const history = prior;
    const res = await ask(history, (full) => {
      holder.text = full;
      /* stream straight into the live node so the student sees text as it
         arrives; only the inner body is touched, never the action bar. */
      if (node) { const b = node.querySelector('.bw'); if (b) b.innerHTML = md(full); }
      scrollEnd();
    }, (corrected) => { holder.text = corrected; replaceStream(corrected); });

    setBusy(false);
    if (res.ok && res.text) {
      holder.pending = false; holder.text = res.text;
      mood('happy', 1200);
    } else {
      holder.pending = false; holder.error = res.code === 'offline' ? T.offline : T.failed;
      mood('sad', 1400);
    }
    save(); renderMsgs();
  }

  function stop() { try { if (activeReq) activeReq.abort(); } catch (_) {} setBusy(false); say(T.stopped, 1600); }

  function newChat() {
    sessions.unshift({ name: '', msgs: [], ts: Date.now() });
    if (sessions.length > 20) sessions = sessions.slice(0, 20);
    cur = 0; save(); renderMsgs(); resetHero(); closeLayers();
  }
  function resetHero() {
    const hero = document.getElementById('hero');
    if (hero) hero.style.display = '';
    const app = document.getElementById('app');
    if (app) app.classList.remove('chatting');
    say('নতুন কথা শুরু করি — কী জানতে চাও?', 3200);
  }

  /* ───────── avatar animation engine (owner's Sky) ───────── */
  let birds = [], curA = [], lk, mt, lastMsg = 0, lastAct = -1, nextT, sleepT, dozing = 0, busyA = 0;
  const k = (o, ...a) => a.map((t) => ({ transform: t, ...(o ? { transformOrigin: o } : {}) }));
  function A(sel, kf, ms, o) {
    o = o || {};
    vis().forEach((b) => b.querySelectorAll(sel).forEach((el) => curA.push(el.animate(kf, { duration: ms, iterations: Infinity, easing: 'ease-in-out', ...o }))));
  }
  function vis() { return birds.filter((b) => b.getBoundingClientRect().width); }
  function mood(s, ms) { birds.forEach((b) => b.dataset.s = s); clearTimeout(mt); if (ms) mt = setTimeout(() => mood('idle'), ms); }
  function look(x, y) { birds.forEach((b) => b.querySelectorAll('.pup').forEach((p) => p.style.transform = 'translate(' + x + 'px,' + y + 'px)')); }
  function lookSeq(a, ms) { clearInterval(lk); let i = 0; look(...a[0]); if (a.length > 1) lk = setInterval(() => look(...a[++i % a.length]), ms); }
  function say(t, ms) {
    const el = document.getElementById('app').classList.contains('chatting') ? document.getElementById('say2') : document.getElementById('say');
    if (!el) return;
    el.textContent = t; el.classList.add('on'); clearTimeout(say.t);
    say.t = setTimeout(() => el.classList.remove('on'), ms || 3800); lastMsg = Date.now();
  }
  function end() { clearTimeout(stopT); curA.forEach((a) => { try { a.cancel(); } catch (_) {} }); curA = []; clearInterval(lk); birds.forEach((b) => delete b.dataset.p); look(0, 0); }
  const tap = (d) => [k('', 'translateY(0)', 'translateY(-5px)', 'translateY(0)'), 260, { delay: d || 0 }];
  let stopT;
  const ACT = [
    ['typing', 'lap', 7000, () => { A('.hl2', ...tap()); A('.hr2', ...tap(130)); A('.all', k('', 'rotate(0)', 'rotate(1.5deg)', 'rotate(0)'), 2400); lookSeq([[0, 6], [-2, 6], [2, 6], [0, 6], [0, -2]], 700); }, 'aen', ['প্রশ্ন সাজাচ্ছি — চাইলে MCQ বানিয়ে দিই?']],
    ['reading', 'book', 8000, () => { A('.all', k('', 'rotate(0)', 'rotate(-1.5deg)', 'rotate(0)'), 3000); lookSeq([[-6, 6], [-2, 6], [2, 6], [6, 6], [-6, 7]], 650); }, 'amen', ['তুমি আজ কোন টপিক পড়ছো?', 'পড়ার সময় মোবাইল দূরে রাখো']],
    ['writing', 'note', 6500, () => { const f = k('', 'translate(0,0)', 'translate(-8px,2px)', 'translate(-2px,5px)', 'translate(-10px,7px)', 'translate(0,0)'); A('.hr2', f, 1600); lookSeq([[-3, 6], [0, 6], [3, 6]], 900); }, 'am', ['ছোট নোট লিখে রাখলে মনে থাকে বেশি']],
    ['searching', 'mag', 5500, () => { const f = k('', 'translateX(-34px)', 'translateX(10px)', 'translateX(-10px)', 'translateX(-34px)'); A('.hr2', f, 3000); lookSeq([[-6, 5], [4, 5], [0, 5]], 900); }, 'a*', ['কিছু যাচাই করতে চাইলে বলো, খুঁজে দেখি']],
    ['think', '', 3800, () => { mood('think'); lookSeq([[5, -5]], 1e9); }, '*', []],
    ['idea', '', 2800, () => { A('.all', k('', 'translateY(0)', 'translateY(-14px)', 'translateY(0)'), 900, { iterations: 1, delay: 500 }); }, '*', ['একটা ভালো আইডিয়া — ছোট একটা কুইজ দিই?']],
    ['stretch', '', 2400, () => { A('.all', k('', 'scaleY(1)', 'scaleY(1.14) translateY(-4px)', 'scaleY(1)'), 2200, { iterations: 1 }); A('.wl', k('', 'rotate(10deg)', 'rotate(120deg)', 'rotate(10deg)'), 2200, { iterations: 1 }); A('.wr', k('', 'rotate(-10deg)', 'rotate(-120deg)', 'rotate(-10deg)'), 2200, { iterations: 1 }); }, 'ma', ['৪৫ মিনিট পড়ে ৫ মিনিট বিরতি নাও']],
    ['yawn', '', 2800, () => { A('.eyes', k('100px 104px', 'scaleY(1)', 'scaleY(.1)', 'scaleY(.1)', 'scaleY(1)'), 2600, { iterations: 1 }); A('.jaw', k('', 'translateY(0)', 'translateY(8px)', 'translateY(8px)', 'translateY(0)'), 2600, { iterations: 1 }); }, 'n', ['ঘুম কম হলে মনেও থাকে কম — আজ ঠিকমতো ঘুমিও']],
    ['wave', '', 1800, () => { A('.wr', k('', 'rotate(-10deg)', 'rotate(-105deg)', 'rotate(-65deg)', 'rotate(-105deg)', 'rotate(-65deg)', 'rotate(-10deg)'), 1700, { iterations: 1 }); }, '*', []],
    ['nod', '', 1300, () => { A('.all', k('', 'translateY(0) scaleY(1)', 'translateY(5px) scaleY(.94)', 'translateY(0)', 'translateY(5px) scaleY(.94)', 'translateY(0)'), 1000, { iterations: 1 }); }, '*', []],
    ['blink', '', 1300, () => { A('.eyes', k('100px 104px', 'scaleY(1)', 'scaleY(.1)', 'scaleY(1)', 'scaleY(.1)', 'scaleY(1)'), 1100, { iterations: 1 }); }, '*', []],
    ['breathe', '', 4200, () => { A('.all', k('', 'scale(1)', 'scale(1.045)', 'scale(1)'), 2600); }, '*', ['একটু গভীর শ্বাস নাও, তারপর আবার শুরু']],
    ['hop', '', 1200, () => { A('.all', k('', 'translateY(0)', 'translateY(-24px)', 'translateY(0)', 'translateY(-14px)', 'translateY(0)'), 1000, { iterations: 1 }); }, '*', []]
  ];
  const period = () => { const h = new Date().getHours(); return h < 5 || h >= 22 ? 'n' : h < 12 ? 'm' : h < 17 ? 'a' : 'e'; };
  function startAct(i) {
    end(); lastAct = i;
    const a = ACT[i]; const pr = a[1], ms = a[2], fn = a[3], m = a[5];
    if (pr) birds.forEach((b) => b.dataset.p = pr);
    fn();
    if (m.length && Date.now() - lastMsg > 20000 && Math.random() < .5) setTimeout(() => say(pick(m)), 600);
    stopT = setTimeout(() => { end(); loop(); }, ms);
  }
  function calm() { return busyA || (inpEl && inpEl.value) || document.activeElement === inpEl || dozing || (birds[0] && birds[0].dataset.s !== 'idle'); }
  function loop() {
    clearTimeout(nextT);
    nextT = setTimeout(() => {
      const app = document.getElementById('app');
      const chat = app && app.classList.contains('chatting');
      if (calm() || (chat && Math.random() < .6)) { loop(); return; }
      const p = period();
      const c = ACT.map((a, i) => i).filter((i) => i !== lastAct && (ACT[i][4].indexOf('*') >= 0 || ACT[i][4].indexOf(p) >= 0));
      if (c.length) startAct(pick(c));
      else loop();
    }, 2200 + Math.random() * 2400);
  }
  function sleepNow() { end(); dozing = 1; mood('sleep'); }
  function wake() {
    clearTimeout(sleepT);
    if (dozing) { dozing = 0; mood('wave', 1600); say('আবার স্বাগতম! কী পড়বে আজ?'); }
    sleepT = setTimeout(() => { if (!busyA && inpEl && !inpEl.value) sleepNow(); }, 45000);
  }

  /* ───────── drawer / sheet ───────── */
  function layer(on, el) {
    const scrim = document.getElementById('scrim');
    scrim.classList.toggle('on', !!on);
    if (!on) { document.getElementById('drawer').classList.remove('on'); document.getElementById('sheet').classList.remove('on'); }
    else el.classList.add('on');
  }
  function closeLayers() { layer(false); }

  function renderList(q) {
    q = q || '';
    const g = {};
    sessions.forEach((s, i) => {
      const name = s.name || T.untitled;
      if (q && name.toLowerCase().indexOf(q.toLowerCase()) < 0) return;
      const day = i === 0 ? 'আজ' : new Date(s.ts).toLocaleDateString('bn-BD', { day: 'numeric', month: 'short' });
      (g[day] = g[day] || []).push([name, i]);
    });
    const keys = Object.keys(g);
    document.getElementById('hl').innerHTML = keys.length ? keys.map((n) => '<div class="gl">' + n + '</div>' + g[n].map(([t, i]) => '<div class="hi' + (i === cur ? ' act' : '') + '" data-i="' + i + '"><div class="hr1"><button class="it">' + ic('chat') + '<span>' + esc(t) + '</span></button><button class="mo" data-m aria-label="' + T.menu + '">' + ic('dots') + '</button></div><div class="ha"><button data-ren="' + i + '">' + ic('pin') + T.ren + '</button><button data-del="' + i + '">' + ic('trash') + T.del + '</button></div></div>').join('')).join('') : '<div class="gl">' + T.noHit + '</div>';
  }

  function backHome() {
    try {
      document.documentElement.classList.remove('ai-chat-open');
      const a = document.getElementById('app'); if (a) a.classList.remove('ai-chat-open', 'sky');
      const nb = document.querySelector('.bottomnav'); if (nb) nb.style.display = '';
    } catch (_) {}
    if (window.navigate) window.navigate('dashboard'); else history.back();
  }

  /* ───────── render + wire ───────── */
  function render() {
    const root = document.getElementById('app') || document.body;
    if (!document.getElementById('skyCss')) {
      const st = document.createElement('style'); st.id = 'skyCss'; st.textContent = CSS;
      document.head.appendChild(st);
    }
    /* The host fires admissionhub:authchange on sign-in, but a returning student
       is already signed in before this page renders. Read the current scope so
       they get their own history instead of an empty guest session. */
    try {
      const d = document.documentElement;
      const uid = (window.__ahAccountScope || (window.AHAuth && typeof window.AHAuth.getUser === 'function' && (window.AHAuth.getUser() || {}).uid) || '').toString();
      if (uid && /^[A-Za-z0-9_-]{8,128}$/.test(uid)) accountScope = uid;
    } catch (_) {}
    load();
    root.className = 'sky';
    root.classList.add('ai-chat-open');
    root.innerHTML = shell();
    try { document.documentElement.classList.add('ai-chat-open'); } catch (_) {}
    const navBar = document.querySelector('.bottomnav'); if (navBar) navBar.style.display = 'none';

    msgsEl = document.getElementById('msgs');
    mainEl = document.getElementById('chat');
    inpEl = document.getElementById('inp');
    actEl = document.getElementById('actB');
    birds = [...document.querySelectorAll('.av:not(.xs)')];
    document.getElementById('hbig').innerHTML = av();
    document.getElementById('hbw').innerHTML = av();
    document.getElementById('dw').innerHTML = av('xs');

    /* hero chips + notice — real actions, no demo answers */
    document.getElementById('tryq').innerHTML =
      '<div class="notice"><b>ⓘ</b><span>' + T.notice + '</span></div>' +
      '<small>' + T.tryAsking + '</small>' +
      '<div class="chips">' + T.chips.map((c) => '<button data-q="' + esc(c[2]) + '">' + c[0] + ' ' + c[1] + '</button>').join('') + '</div>';

    paintTheme();
    renderMsgs();
    if (sessions[cur].msgs.length) document.getElementById('hero').style.display = 'none';

    /* hero greeting — time based, honest, no fake content */
    const H = new Date().getHours();
    const greet = H < 5 ? 'এত রাতে জেগে? আজ একটু কম পড়ে ঘুমিয়ে নাও' : H < 12 ? 'শুভ সকাল! আজ কোন বিষয় দিয়ে শুরু করবে?' : H < 16 ? 'শুভ দুপুর! পড়ার সময় হলো — কী ধরবে?' : H < 19 ? 'শুভ বিকেল! আজকের পড়ার রিভিশন দেবে?' : 'শুভ সন্ধ্যা! আজকের পড়া কতদূর?';
    mood('wave', 2200);
    setTimeout(() => { if (!sessions[cur].msgs.length) say(greet, 4200); }, 900);
    loop(); wake();

    /* composer */
    inpEl.oninput = () => {
      inpEl.style.height = 'auto'; inpEl.style.height = Math.min(inpEl.scrollHeight, 120) + 'px';
      const h = inpEl.value.trim();
      actEl.className = 'cb' + (h ? ' send' : '');
      actEl.innerHTML = ic(busy ? 'stop' : h ? 'send' : 'mic');
      look(Math.sin(inpEl.value.length / 2) * 3, 5);
    };
    inpEl.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); actEl.click(); } };
    inpEl.onfocus = () => { end(); mood('type'); look(0, 5); };
    inpEl.onblur = () => { if (!busy) mood('idle'); look(0, 0); loop(); };
    /* Mic is the default composer action, so it must actually listen. Falls back
       to a plain hint where the browser has no speech engine rather than sitting
       there as a dead button. */
    let rec = null, recOn = false;
    function voiceIn() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { say('এই ব্রাউজারে ভয়েস শোনা যায় না — লিখে পাঠাও।', 3200); return; }
      if (recOn) { try { rec.stop(); } catch (_) {} return; }
      try {
        rec = new SR();
        rec.lang = lang === 'en' ? 'en-US' : 'bn-BD';
        rec.interimResults = true;
        rec.continuous = false;
        rec.onstart = () => { recOn = true; actEl.innerHTML = ic('stop'); say('শুনছি…', 6000); mood('type'); };
        rec.onerror = () => { recOn = false; setBusy(false); say('শুনতে পারিনি — আবার চেষ্টা করো।', 2600); };
        rec.onend = () => { recOn = false; setBusy(false); inpEl.focus(); };
        rec.onresult = (e) => {
          let t = '';
          for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
          inpEl.value = t.trim();
          inpEl.oninput();
          if (e.results[e.results.length - 1].isFinal) { try { rec.stop(); } catch (_) {} send(); }
        };
        rec.start();
      } catch (_) { recOn = false; say('ভয়েস চালু করা গেল না।', 2600); }
    }
    actEl.onclick = () => { if (busy) stop(); else if (inpEl.value.trim()) send(); else voiceIn(); };

    /* message actions + question chips */
    msgsEl.addEventListener('click', (e) => {
      const c = e.target.closest('[data-c]');
      if (c) { const m = sessions[cur].msgs[+c.getAttribute('data-c')]; try { navigator.clipboard.writeText(m.text); } catch (_) {} say(T.copied, 1600); return; }
      const r = e.target.closest('[data-r]');
      if (r) { const i = +r.getAttribute('data-r'); const prev = sessions[cur].msgs[i - 1]; if (prev && prev.role === 'user') { sessions[cur].msgs.splice(i, 1); save(); renderMsgs(); send(prev.text); } return; }
      const g = e.target.closest('[data-g]');
      if (g) { g.classList.add('on'); say('ধন্যবাদ!', 1600); return; }
      const q = e.target.closest('[data-q]');
      if (q) { closeLayers(); send(q.getAttribute('data-q')); return; }
    });
    document.addEventListener('click', (e) => {
      const q = e.target.closest('[data-q]');
      if (q && q.closest('#sheet, #tryq')) { closeLayers(); send(q.getAttribute('data-q')); }
    });

    /* header */
    document.getElementById('menuB').onclick = () => { renderList(document.getElementById('hs').value); layer(true, document.getElementById('drawer')); };
    document.getElementById('newB').onclick = newChat;
    document.getElementById('homeB').onclick = backHome;
    document.getElementById('exitD').onclick = backHome;
    document.getElementById('closeD').onclick = () => layer(false);
    document.getElementById('scrim').onclick = () => layer(false);
    document.getElementById('plusB').onclick = () => { inpEl.blur(); layer(true, document.getElementById('sheet')); };
    document.getElementById('newD').onclick = newChat;

    /* theme buttons drive the APP's engine, so the chat can never diverge */
    document.getElementById('th').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const t = b.getAttribute('data-t');
      try {
        if (window.AhAppearance && window.AhAppearance.set) window.AhAppearance.set(t === 'auto' ? 'system' : t);
      } catch (_) {}
      paintTheme();
    };

    /* session list */
    document.getElementById('hs').oninput = (e) => renderList(e.target.value);
    document.getElementById('hl').onclick = (e) => {
      const hi = e.target.closest('.hi'); if (!hi) return;
      const i = +hi.getAttribute('data-i');
      if (e.target.closest('[data-m]')) { hi.classList.toggle('open'); return; }
      if (e.target.closest('[data-del]')) {
        sessions.splice(i, 1);
        if (!sessions.length) sessions = [{ name: '', msgs: [], ts: Date.now() }];
        cur = Math.min(cur, sessions.length - 1); save(); renderMsgs(); renderList(document.getElementById('hs').value);
        if (!sessions[cur].msgs.length) resetHero();
        return;
      }
      if (e.target.closest('[data-ren]')) {
        const v = prompt('নতুন নাম:', sessions[i].name || '');
        if (v != null) { sessions[i].name = String(v).slice(0, 60); save(); renderList(document.getElementById('hs').value); }
        return;
      }
      if (e.target.closest('.it')) { cur = i; save(); renderMsgs(); layer(false); if (!sessions[cur].msgs.length) resetHero(); }
    };

    /* in-app navigation hooks */
    document.querySelectorAll('[data-go]').forEach((b) => {
      b.onclick = () => {
        const p = b.getAttribute('data-go');
        layer(false);
        try {
          document.documentElement.classList.remove('ai-chat-open');
          const a = document.getElementById('app'); if (a) a.classList.remove('ai-chat-open', 'sky');
          const nb = document.querySelector('.bottomnav'); if (nb) nb.style.display = '';
        } catch (_) {}
        if (window.navigate) window.navigate(p); else location.hash = p;
      };
    });

    /* attachments — open the app's own pickers where it has them */
    const pick_ = (accept) => { const f = document.getElementById('filePick'); f.accept = accept; f.value = ''; f.click(); };
    document.getElementById('camB').onclick = () => pick_('image/*');
    document.getElementById('imgB').onclick = () => pick_('image/*');
    document.getElementById('docB').onclick = () => pick_('*/*');
    document.getElementById('vidB').onclick = () => pick_('video/*');
    document.getElementById('filePick').onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      layer(false);
      if (!f) return;
      say('ফাইলটা দেখা হচ্ছে — এই ফিচারটা অ্যাপের নিজের পাঠানোর জায়গা থেকে কাজ করে।', 4200);
    };

    /* pet the avatar */
    const pet = () => {
      const i = pick([...ACT.keys()].filter((x) => ['wave', 'hop', 'nod', 'blink', 'idea'].indexOf(ACT[x][0]) >= 0));
      startAct(i);
      say(pick(['বলো, কী জানতে চাও?', 'প্রশ্ন লিখে ফেলো, আমি আছি', 'কোনো টপিক বুঝতে সমস্যা হচ্ছে?']));
    };
    document.getElementById('hbig').onclick = pet;
    document.getElementById('hbw').onclick = pet;
    addEventListener('pointermove', (e) => {
      if (document.activeElement === inpEl || dozing || (birds[0] && birds[0].dataset.p)) return;
      const b = document.getElementById('app').classList.contains('chatting') ? birds[0] : birds[1];
      if (!b) return;
      const r = b.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1, kk = Math.min(5, d / 40);
      look(dx / d * kk, dy / d * kk);
    });
    ['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, wake));

    /* follow the app's appearance engine live */
    try { window.addEventListener('ah:appearance', paintTheme); } catch (_) {}
    try { if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme); } catch (_) {}

    /* drawer swipe */
    let sx = 0, dx0 = 0, dr = 0;
    const drawer = document.getElementById('drawer');
    drawer.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; dr = 1; dx0 = 0; drawer.classList.add('drag'); }, { passive: true });
    drawer.addEventListener('touchmove', (e) => { if (!dr) return; dx0 = Math.min(0, e.touches[0].clientX - sx); drawer.style.transform = 'translateX(' + dx0 + 'px)'; }, { passive: true });
    drawer.addEventListener('touchend', () => { dr = 0; drawer.classList.remove('drag'); drawer.style.transform = ''; if (dx0 < -70) layer(false); });
    let ex = 0;
    const app = document.getElementById('app');
    app.addEventListener('touchstart', (e) => { ex = e.touches[0].clientX < 16 ? e.touches[0].clientX : -1; }, { passive: true });
    app.addEventListener('touchend', (e) => { if (ex >= 0 && e.changedTouches[0].clientX - ex > 60) layer(true, drawer); ex = -1; });

    setBusy(false);
  }

  window.renderAiAgentPage = render;
  window.addEventListener('hashchange', () => {
    try {
      const p = (location.hash.slice(1).split('?')[0] || '').toLowerCase();
      if (p !== 'ai' && p !== 'ai-chat') {
        document.documentElement.classList.remove('ai-chat-open');
        const a = document.getElementById('app'); if (a) a.classList.remove('ai-chat-open', 'sky');
        const nb = document.querySelector('.bottomnav'); if (nb) nb.style.display = '';
      }
    } catch (_) {}
  });
})();
