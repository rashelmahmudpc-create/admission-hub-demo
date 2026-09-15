/* ============================================================
   DASHBOARD v2 — ২০২৬-০৯-০৬ (P11)
   additive override of renderDashboard (ছবি-অনুযায়ী ১৪ মডিউল)
   নিয়ম:
   • ডেটা-ইঞ্জিন/DB/অন্য-পৃষ্ঠা স্পর্শ করে না — শুধু dashboard-দৃশ্য।
   • সব সংখ্যা CACHE (সত্যিকারের ব্যবহারকারী-ডেটা) থেকে; কোনো ফেক সংখ্যা নয়;
     ডেটা নেই → সৎ শূন্য-অবস্থা + কর্ম-বাটন।
   ============================================================ */
(function () {
  'use strict';
  if (window.__dashboardV2Installed) return;
  window.__dashboardV2Installed = true;

  const DAY = 86400000;
  const keyOf = (ts) => { const d = new Date(ts || Date.now()); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  const d2 = (n) => Math.round(n * 100) / 100;
  const num = (v) => { const n = Number(v) || 0; return n; };
  const escv = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* CACHE রেজলভার: index.html-এ `const CACHE` (ক্লাসিক-স্ক্রিপ্ট টপ-লেভেল const) window-এ যায় না —
     তাই প্রথমে window, পরে গ্লোবাল-লেক্সিকাল (typeof-গার্ড), শেষ-ফলব্যাক {} — কোনো অবস্থায় ক্র্যাশ নয়। */
  const C = () => {
    try {
      if (window.CACHE) return window.CACHE;
      if (typeof CACHE !== 'undefined' && CACHE) return CACHE;
    } catch (_) {}
    return {};
  };
  const DSTATS = () => { const m = {}; (C().dailyStats || []).forEach((s) => { m[keyOf(new Date(Number(s.date) || Number(s.id) || Date.now()))] = s; }); return m; };

  /* ── আজকের + সপ্তাহ-পরিসংখ্যান ── */
  function weekSeries() {
    const map = DSTATS();
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const ts = Date.now() - i * DAY;
      const k = keyOf(ts);
      const s = map[k] || { questions: 0, correct: 0, wrong: 0 };
      const q = num(s.questions), c = num(s.correct), w = num(s.wrong);
      const ans = c + w;
      out.push({ k, label: new Intl.DateTimeFormat('bn', { weekday: 'short' }).format(ts), q, acc: ans ? d2(c / ans * 100) : null });
    }
    return out;
  }
  function todayStats() {
    const map = DSTATS();
    const s = map[keyOf(Date.now())] || { questions: 0, correct: 0, wrong: 0, exams: 0, timeMs: 0 };
    return { q: num(s.questions), c: num(s.correct), w: num(s.wrong), exams: num(s.exams), time: num(s.timeMs || 0) };
  }
  function streakDays() {
    const map = DSTATS();
    let run = 0;
    for (let i = 0; i < 400; i++) {
      const s = map[keyOf(Date.now() - i * DAY)];
      if (s && num(s.questions) > 0) run++; else break;
    }
    return run;
  }

  /* ── টপিক-দুর্বলতা (examResults-স্ন্যাপশট) ── */
  function topicWeak() {
    const agg = {};
    (C().examResults || []).forEach((r) => (r.snapshot || []).forEach((q) => {
      if (!q || !q.topicId || (q.status !== 'correct' && q.status !== 'wrong')) return;
      const a = agg[q.topicId] || (agg[q.topicId] = { n: 0, c: 0 });
      a.n++; if (q.status === 'correct') a.c++;
    }));
    const rows = Object.keys(agg).map((tid) => {
      const a = agg[tid];
      const name = (typeof window.topicName === 'function' ? window.topicName(tid) : '') || 'টপিক';
      return { tid, name, n: a.n, acc: d2(a.c / a.n * 100) };
    }).filter((x) => x.n >= 1).sort((x, y) => x.acc - y.acc);
    return rows.slice(0, 3);
  }

  /* ── Continuous Learning: বিষয়ভিত্তিক দক্ষতা (প্রশ্ন-স্ট্যাট) ── */
  function subjectProgress() {
    const by = {};
    (C().questions || []).forEach((q) => {
      const st = q.stats || {};
      const a = by[q.subjectId] || (by[q.subjectId] = { n: 0, c: 0 });
      a.n += num(st.attempts); a.c += num(st.correct);
    });
    let best = null;
    Object.keys(by).forEach((sid) => { if (!best || by[sid].n > best.n) best = { sid, ...by[sid] }; });
    if (!best || best.n === 0) return null;
    const name = (typeof window.subjectName === 'function' ? window.subjectName(best.sid) : '') || 'বিষয়';
    return { name, n: best.n, c: best.c, pct: d2(best.c / best.n * 100) };
  }

  /* ── Admission Goal (ডিফল্ট-স্যাম্পল; settings-এ পরিবর্তনযোগ্য) ── */
  function goal() {
    const S = C().settings;
    const s = (S && typeof S === 'object') ? S : {};
    if (!s.dv2Goal) {
      s.dv2Goal = { university: 'Rajshahi University', unit: 'A Unit', examDate: keyOf(Date.now() + 90 * DAY) };
      try { if (S && window.dbPut) window.dbPut('settings', s).catch(() => {}); } catch (_) {} /* আসল settings-অবজেক্ট থাকলেই কেবল লেখা (ফাঁকা-ফলব্যাকে DB-মোছা নিষিদ্ধ) */
    }
    const g = s.dv2Goal;
    const diff = Math.max(0, Math.ceil((new Date(g.examDate + 'T23:59:59') - Date.now()) / DAY));
    const target = Math.max(20, num((C().settings || {}).dailyTarget || 100));
    const wq = weekSeries().reduce((a, x) => a + x.q, 0);
    const prep = Math.min(100, Math.round(wq / (target * 7) * 100));
    return { university: g.university, unit: g.unit, daysLeft: diff, prep };
  }

  /* ── রোডম্যাপ-মিনি ── */
  function roadmapMini() {
    const plans = C().ADMISSION_PLANS || [];
    const p = plans[plans.length - 1];
    if (!p) return null;
    const days = (C().planDays || []).filter((d) => d.planId === p.id).sort((a, b) => (a.index || 0) - (b.index || 0));
    const done = days.filter((d) => d.completed || d.done || d.status === 'done' || (d.actualDate && d.actualDate <= keyOf())).length;
    const total = Math.max(90, days.length || 90);
    const dayNo = Math.min(total, Math.max(1, (Number(p.activeDayIndex) || 0) + 1));
    return { p, planName: p.name || p.title || '90-Day Master Plan', dayNo, total, pct: Math.min(100, Math.round(done / total * 100)), days };
  }

  /* ── স্মার্ট-ইনসাইট (অফলাইন নিয়ম-ভিত্তিক; কোনো নেটওয়ার্ক নেই) ── */
  function insightText() {
    const t = todayStats();
    const weak = topicWeak()[0];
    const run = streakDays();
    if (t.q === 0) return 'এখনো আজকের কোনো ডেটা নেই — একটি মক-টেস্ট দিয়ে শুরু করো, তারপর এখানে তোমার দুর্বলতা ও অগ্রগতির বাস্তব-বিশ্লেষণ দেখাবে।';
    let txt = 'আজ ' + t.q + 'টি প্রশ্ন করেছ — ' + (t.c + t.w ? 'সঠিকতা ' + Math.round(t.c / (t.c + t.w) * 100) + '%' : 'কোনো উত্তরের স্কোর-রেকর্ড নেই');
    if (weak) txt += '। তোমার দুর্বলতম টপিক: "' + weak.name + '" (' + weak.acc + '% সঠিক) — আজ এটা রিভিশন করো।';
    else txt += '। এখনো যথেষ্ট টপিক-ডেটা নেই — আরো পরীক্ষা দিলে দুর্বলতা-রাডার ভরাট হবে।';
    if (run >= 3) txt += ' 🔥 ' + run + ' দিনের ধারাবাহিকতা চমৎকার!';
    return txt;
  }

  /* ── SVG লাইন-চার্ট ── */
  function graphSvg(week) {
    const W = 320, H = 86, P = 8;
    const X = (i) => P + (W - 2 * P) * (i / 6);
    const Y = (v) => H - P - (H - 2 * P) * (Math.min(100, v) / 100);
    let d = '', prev = null, last = null;
    week.forEach((x, i) => {
      if (x.acc == null) { prev = null; return; }
      const xp = X(i), yp = Y(x.acc);
      d += (prev == null ? 'M' : 'L') + xp.toFixed(1) + ' ' + yp.toFixed(1);
      prev = i; last = { xp, yp };
    });
    if (!d) d = 'M' + X(0) + ' ' + Y(0) + ' L' + X(6) + ' ' + Y(0);
    const area = d + ' L' + X(6) + ' ' + (H - P) + ' L' + X(0) + ' ' + (H - P) + ' Z';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="সাপ্তাহিক অগ্রগতি">' +
      '<defs><linearGradient id="dv2grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14a06f" stop-opacity=".28"/><stop offset="1" stop-color="#14a06f" stop-opacity="0"/></linearGradient></defs>' +
      '<line x1="' + P + '" y1="' + (H - P) + '" x2="' + (W - P) + '" y2="' + (H - P) + '" stroke="#e7efeb" stroke-width="1.2"/>' +
      '<path d="' + area + '" fill="url(#dv2grad)"/>' +
      '<path d="' + d + '" fill="none" stroke="#0f6b4f" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      (last ? '<circle cx="' + last.xp.toFixed(1) + '" cy="' + last.yp.toFixed(1) + '" r="3.4" fill="#0f6b4f" stroke="#fff" stroke-width="1.6"/>' : '') +
      '</svg>';
  }

  /* ── মডিউল-বিল্ডার ── */
  function build() {
    const t = todayStats();
    const week = weekSeries();
    const run = streakDays();
    const target = Math.max(1, num((C().settings || {}).dailyTarget || 100));
    const pct = Math.min(100, Math.round(t.q / target * 100));
    const ans = t.c + t.w;
    const mastery = ans ? Math.round(t.c / ans * 100) : 0;
    const weak = topicWeak();
    const cont = subjectProgress();
    const g = goal();
    const rm = roadmapMini();
    const focusNm = 'Focus Mode';
    const starN = pct >= 80 ? 5 : pct >= 60 ? 4 : pct >= 40 ? 3 : pct >= 20 ? 2 : 1;
    const star = '★'.repeat(starN) + '☆'.repeat(5 - starN);
    const unfinished = (C().exams || []).find((e) => e.status === 'running');
    const firstS = (C().subjects || []).slice(0, 3);

    const header = '<div class="dv2-header">' +
      '<div class="dv2-avatar">' + escv((C().user && C().user.name ? C().user.name : 'S').trim().slice(0, 1).toUpperCase()) + '</div>' +
      '<div class="dv2-hello"><b>' + escv((C().user && C().user.name) || 'শুভ শুভ - Scholar') + '</b>' +
      '<div class="dv2-muted">' + new Intl.DateTimeFormat('bn-BD', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()) + '</div></div>' +
      '<button class="dv2-bell dv2-bell-c" onclick="navigate(\'history\')" aria-label="নোটিফিকেশন">🔔</button></div>';

    const mission = '<section class="dv2-card dv2-mission">' +
      '<div class="dv2-star">' + star + '</div>' +
      '<div class="dv2-mission-kicker">Today\u2019s Mission</div>' +
      '<div class="dv2-mission-title">আজকের Admission Mission</div>' +
      '<div class="dv2-mission-num">' + t.q + ' <span>/ ' + target + ' MCQ</span></div>' +
      '<div class="dv2-mission-bar"><div style="width:' + pct + '%"></div></div>' +
      '<div class="dv2-mission-sub">' + (firstS.length ? firstS.map((s) => '<span class="dv2-chip">' + escv(s.icon || '📘') + ' ' + escv(s.name) + '</span>').join('') : '<span class="dv2-chip">📘 বাংলা</span><span class="dv2-chip">English</span><span class="dv2-chip">GK</span>') + '</div>' +
      '<div class="dv2-mission-cta"><button class="dv2-btn" onclick="' + (unfinished ? "navigate('exam/running')" : "navigate('exam/setup')") + '">Continue →</button>' +
      '<button class="dv2-btn ghost" onclick="if(window.setTheme)setTheme(\'focus\')">' + focusNm + '</button></div>' +
      '<div class="dv2-mission-foot">' + (t.q >= target ? '🎉 আজকের লক্ষ্য পূরণ হয়েছে! আরো এগিয়ে যাও।' : '🎯 আজ আর ' + Math.max(0, target - t.q) + 'টি প্রশ্ন বাকি — চালিয়ে যাও!') + '</div></section>';

    const weekDots = week.map((x, i) => {
      const cls = (x.q > 0 ? 'on' : '') + (i === 6 ? ' today' : '');
      return '<div class="dv2-day ' + cls + '"><i>' + (x.q > 0 ? '✓' : '·') + '</i>' + x.label + '</div>';
    }).join('');

    const streak = '<section class="dv2-card"><div class="dv2-streak-head"><div class="dv2-streak-ic">🔥</div><div><div class="dv2-title">' + run + ' Day Streak</div><div class="dv2-muted">Keep going!</div></div></div>' +
      '<div class="dv2-days">' + weekDots + '</div>' +
      '<div class="dv2-streak-badge">🔥 মাত্র ' + Math.max(0, 10 - run) + ' দিন = 10 Day Badge</div></section>';

    const perfStats = '<div class="dv2-ps"><b>' + t.q + '</b><span>Solved</span></div><div class="dv2-ps"><b>' + t.c + '</b><span>Correct</span></div><div class="dv2-ps"><b>' + t.w + '</b><span>Wrong</span></div>';
    const perf = '<section class="dv2-card"><div class="dv2-perf"><div class="dv2-ring" style="--p:' + mastery + '"><div><b>' + (ans ? mastery + '%' : '–') + '</b><small>Mastery</small></div></div>' +
      '<div class="dv2-perf-stats">' + perfStats + '<div class="dv2-ps"><b>' + Math.round(t.time / 60000) + 'm</b><span>Total Time</span></div></div></div>' +
      '<div class="dv2-perf-foot">' + (t.q ? '📈 আজকের সঠিকতা ' + (ans ? Math.round(t.c / ans * 100) + '%' : '—') + ' · পরীক্ষা-সংখ্যা ' + t.exams : '📭 আজ কোনো ডেটা নেই — প্রথম পরীক্ষা দিলে এখানে ফলাফল দেখাবে।') + '</div></section>';

    const insight = '<section class="dv2-card dv2-insight"><div class="dv2-insight-head"><div class="dv2-insight-ic">💡</div><b class="dv2-title" style="font-size:13.5px">Study Insight</b><span class="dv2-ai-tag">Progress</span></div>' +
      '<p>' + escv(insightText()) + '</p>' +
      (weak.length ? '<button class="dv2-btn" style="margin-top:12px" onclick="if(window.startWeakTopicPractice)startWeakTopicPractice(\'' + weak[0].tid + '\')">Practice Weak Topic →</button>' : '<button class="dv2-btn" style="margin-top:12px" onclick="navigate(\'exam/setup\')">📝 প্রথম পরীক্ষা দাও</button>') + '</section>';

    const contCard = cont
      ? '<section class="dv2-card"><div class="dv2-between"><div class="dv2-row"><div class="dv2-streak-ic">📖</div><div><div class="dv2-title">' + escv(cont.name) + ' → দক্ষতা</div><div class="dv2-muted">' + cont.c + ' / ' + cont.n + ' সঠিক</div></div></div><button class="dv2-btn ghost" style="padding:8px 12px;font-size:12px;color:#0f6b4f" onclick="navigate(\'question-bank\')">Abhyas →</button></div>' +
        '<div class="dv2-bar" style="margin-top:12px"><div style="width:' + cont.pct + '%"></div></div><div class="dv2-muted" style="margin-top:6px">' + cont.pct + '% বিষয়-দক্ষতা</div></section>'
      : '<section class="dv2-card"><div class="dv2-between"><div class="dv2-row"><div class="dv2-streak-ic">📖</div><div><div class="dv2-title">Continuous Learning</div><div class="dv2-muted">কোর্স চালু করো — এখানে অগ্রগতি দেখাবে</div></div></div><button class="dv2-btn ghost" style="padding:8px 12px;font-size:12px;color:#0f6b4f" onclick="navigate(\'courses\')">কোর্স →</button></div></section>';

    const tools = '<section class="dv2-card"><div class="dv2-between"><div><div class="dv2-title">Command Center</div><div class="dv2-muted">এক জায়গায় সব টুল</div></div><button class="dv2-btn ghost" style="padding:7px 11px;font-size:11px;color:#0f6b4f" onclick="window.dv2AllTools&&dv2AllTools()">See more →</button></div>' +
      '<div class="dv2-tools">' +
      '<div class="dv2-tool" onclick="window.openSmartPracticeModal?openSmartPracticeModal():navigate(\'smart-practice\')"><span class="ic">⚡</span><span>Quick Practice</span></div>' +
      '<div class="dv2-tool" onclick="navigate(\'ai\')"><span class="ic">🤖</span><span>AI</span></div>' +
      '<div class="dv2-tool" onclick="navigate(\'mistakes\')"><span class="ic">❌</span><span>Mistakes</span></div>' +
      '<div class="dv2-tool" onclick="navigate(\'courses\')"><span class="ic">🎓</span><span>Courses</span></div>' +
      '</div></section>';

    const graph = '<section class="dv2-card"><div class="dv2-between"><div><div class="dv2-title">Performance</div><div class="dv2-muted">সাপ্তাহিক সঠিকতা-গ্রাফ</div></div><b style="color:#0f6b4f;font-size:12px">' + (week[6] && week[6].acc != null ? week[6].acc + '%' : '–') + '</b></div>' +
      '<div class="dv2-graph">' + graphSvg(week) + '</div><div class="dv2-graph-x">' + week.map((x) => '<span>' + x.label + '</span>').join('') + '</div>' +
      '<div class="dv2-muted" style="margin-top:8px">গত ৭ দিনে মোট ' + week.reduce((a, x) => a + x.q, 0) + 'টি প্রশ্ন সমাধান হয়েছে (সত্যিকারের সংরক্ষিত ডেটা)।</div></section>';

    const radar = '<section class="dv2-card"><div class="dv2-between"><div><div class="dv2-title">Your Weakness Radar</div><div class="dv2-muted">Topic-wise Accuracy</div></div><span class="dv2-ai-tag">বিশ্লেষণ</span></div>' +
      (weak.length ? weak.map((x) => {
        const cls = x.acc < 50 ? 'red' : x.acc < 75 ? 'orange' : '';
        return '<div class="dv2-bar-row"><div class="dv2-between"><span>' + escv(x.name) + '</span><b>' + x.acc + '%</b></div><div class="dv2-bar"><div class="' + cls + '" style="width:' + x.acc + '%"></div></div></div>';
      }).join('') : '<div class="dv2-muted" style="margin-top:10px">এখনো পর্যাপ্ত টপিক-ডেটা নেই — পরীক্ষা দিলে এখানে দুর্বলতা-তালিকা তৈরি হবে।</div>') +
      (weak.length ? '<button class="dv2-btn" style="margin-top:12px" onclick="if(window.startWeakTopicPractice)startWeakTopicPractice(\'' + weak[0].tid + '\')">Fix Weakest →</button>' : '') + '</section>';

    const goalCard = '<section class="dv2-card"><div class="dv2-between"><div><div class="dv2-title">Admission Goal</div><div class="dv2-muted">' + escv(g.university) + ' — ' + escv(g.unit) + '</div></div>' +
      '<button class="dv2-btn ghost" style="padding:6px 9px;font-size:11px;color:#0f6b4f" onclick="window.dv2EditGoal&&dv2EditGoal()">⚙</button></div>' +
      '<div class="dv2-between" style="margin-top:10px;align-items:flex-end"><div><div style="font-size:26px;font-weight:900;color:#16241c">' + g.daysLeft + ' <span style="font-size:12px;color:#5f7168;font-weight:700">Days Left</span></div><div class="dv2-muted">পরীক্ষা-দিন পর্যন্ত (সেট করা তারিখ অনুযায়ী)</div></div><b style="color:#0f6b4f">' + g.prep + '%</b></div>' +
      '<div class="dv2-bar"><div style="width:' + g.prep + '%"></div></div>' +
      '<div class="dv2-muted" style="margin-top:8px">সাপ্তাহিক-লক্ষ্য-অনুযায়ী প্রস্তুতি (গত ৭ দিন) — লক্ষ্য: প্রতি-সপ্তাহে ' + (target * 7) + ' প্রশ্ন</div></section>';

    const rmDays = rm ? rm.days : [];
    const today3 = rm && rmDays.length ? rmDays.filter((d) => d.actualDate === keyOf() || d.index === (rm.dayNo - 1))[0] : null;
    const checklist = rm ? (today3 && today3.tasks ? (Array.isArray(today3.tasks) ? today3.tasks : String(today3.tasks).split(',')) : ['মক-টেস্ট (১০ প্রশ্ন)', 'ভুল-খাতা রিভিশন', 'নোট-পুনরালোচনা']).slice(0, 3).map((x, i) =>
      '<div class="dv2-check"><input type="checkbox" ' + (today3 && today3.completed && i === 0 ? 'checked' : '') + ' onchange="window.dv2Task&&dv2Task(this,' + i + ')"><span>' + escv(String(x).trim()) + '</span></div>').join('')
      : '';
    const roadmap = '<section class="dv2-card">' + (rm
      ? '<div class="dv2-between"><div><div class="dv2-kicker">90-Day Roadmap</div><div class="dv2-title" style="margin-top:2px">Day ' + rm.dayNo + ' / ' + rm.total + '</div></div><b style="color:#0f6b4f">' + rm.pct + '%</b></div>' +
        '<div class="dv2-bar" style="margin-top:9px"><div style="width:' + rm.pct + '%"></div></div>' +
        '<div class="dv2-muted" style="margin-top:8px;font-weight:800;font-size:11px">আজকের Study Checklist</div>' + checklist +
        '<button class="dv2-btn" style="margin-top:11px" onclick="navigate(\'progress/plan\')">Full Plan →</button>'
      : '<div class="dv2-kicker">90-Day Roadmap</div><div class="dv2-title" style="margin-top:2px">প্ল্যান এখনো নেই</div><div class="dv2-muted" style="margin-top:5px">৯০-দিনের ক্যালেন্ডার-ভিত্তিক স্টাডি-প্ল্যান বানালে এখানে দিন-ভিত্তিক চেকলিস্ট দেখাবে।</div><button class="dv2-btn" style="margin-top:11px" onclick="navigate(\'progress/plan\')">Create 90-Day Plan →</button>') + '</section>';

    const studyTools = '<section class="dv2-card"><div class="dv2-title">Study Tools</div><div class="dv2-tools">' +
      '<div class="dv2-tool" onclick="navigate(\'notes\')"><span class="ic">📒</span><span>Notes</span></div>' +
      '<div class="dv2-tool" onclick="navigate(\'vocabulary-master\')"><span class="ic">📖</span><span>Vocabulary</span></div>' +
      '<div class="dv2-tool" onclick="navigate(\'dictionary\')"><span class="ic">📖</span><span>Dictionary</span></div>' +
      '<div class="dv2-tool" onclick="window.dv2AllTools&&dv2AllTools()"><span class="ic">🗂️</span><span>More Tools</span></div>' +
      '</div></section>';

    return '<div class="dv2-root">' + header + mission + streak + perf + insight + contCard + tools + graph + radar + goalCard + roadmap + studyTools + '</div>';
  }

  /* ── See-more: পুরনো ১১-টুল (গোপন করা হয় না) ── */
  window.dv2AllTools = function () {
    const tools = [
      ['🤖', 'AI', "navigate('ai')"], ['📚', 'Bank', "navigate('question-bank')"], ['📝', 'Mock', "navigate('exam/setup')"], ['⚡', 'Quick', "window.openSmartPracticeModal?openSmartPracticeModal():navigate('smart-practice')"],
      ['❌', 'Mistakes', "navigate('mistakes')"], ['📊', 'Progress', "navigate('progress')"], ['🎯', 'Goals', "navigate('progress/plan')"],
      ['🔁', 'Revision', "navigate('vocabulary-master')"], ['📖', 'Vocab', "navigate('vocabulary-master')"], ['🕘', 'History', "navigate('history')"], ['🔍', 'Search', "navigate('question-bank')"],
      ['⚙️', 'Settings', "navigate('settings')"]
    ];
    window.openModal('<h3>সব টুল</h3><div class="dv2-tools" style="margin-top:8px">' + tools.map((x) => '<div class="dv2-tool" onclick="closeModal();' + x[2] + '"><span class="ic">' + x[0] + '</span><span>' + x[1] + '</span></div>').join('') + '</div><div style="text-align:right;margin-top:10px"><button class="btn ghost sm" onclick="closeModal()">বন্ধ</button></div>');
  };
  window.dv2EditGoal = function () {
    const g = (C().settings && C().settings.dv2Goal) || { university: 'Rajshahi University', unit: 'A Unit', examDate: keyOf(Date.now() + 90 * DAY) };
    window.openModal('<h3>Admission Goal</h3><label class="flabel">বিশ্ববিদ্যালয়</label><input id="dv2G1" class="ah-inp" value="' + escv(g.university) + '"><label class="flabel">ইউনিট</label><input id="dv2G2" class="ah-inp" value="' + escv(g.unit) + '"><label class="flabel">পরীক্ষা-তারিখ</label><input id="dv2G3" type="date" class="ah-inp" value="' + escv(g.examDate) + '"><div class="row" style="margin-top:12px"><button class="btn" style="flex:1" onclick="window.dv2SaveGoal&&dv2SaveGoal()">Save</button><button class="btn ghost" style="flex:1" onclick="closeModal()">বাতিল</button></div>');
  };
  window.dv2SaveGoal = function () {
    try {
      const s = C().settings || {};
      s.dv2Goal = {
        university: (document.getElementById('dv2G1') && document.getElementById('dv2G1').value.trim()) || 'Rajshahi University',
        unit: (document.getElementById('dv2G2') && document.getElementById('dv2G2').value.trim()) || 'A Unit',
        examDate: (document.getElementById('dv2G3') && document.getElementById('dv2G3').value) || keyOf(Date.now() + 90 * DAY)
      };
      window.dbPut && window.dbPut('settings', s).then(function () { window.closeModal(); window.render(); }).catch(function () { window.closeModal(); window.render(); });
    } catch (_) { try { window.closeModal(); } catch (e) {} }
  };
  window.dv2Task = function (el) { try { window.toast(el.checked ? 'আজকের কাজ-টিক ✅' : 'আনটিক'); } catch (_) {} };

  /* ── renderDashboard override (সব আগের ইঞ্জিন অক্ষত) ── */
  const previous = window.renderDashboard;
  window.renderDashboard = function () {
    const path = (window.Router && Router.path) || 'dashboard';
    if (path !== 'dashboard') { if (typeof previous === 'function') return previous.apply(this, arguments); return undefined; }
    return renderV2();
  };
  function renderV2() {
    /* 😡 মালিক-নির্দেশ 2026-09-07: "পুরোনো ড্যাশবোর্ড সম্পূর্ণ ডিলিট করো" —
       আগের-কোড এখানে previous() চালিয়ে phase5-intel-নিত, আর পুরনো renderDashboard-চেইন
       (study-hub/vocab/greeting/phase345-র্যাপর-সহ) সেই-রেন্ডারে পুরনো-ড্যাশবোর্ড DOM-এ ফেলে দিত
       → দুটো ড্যাশবোর্ড। এখন: পুরনো-চেইন কখনোই চালানো হয় না। */
    let html;
    try { html = build(); }
    catch (e) {
      /* চূড়ান্ত-নিরাপত্তা: dv2-র যেকোনো ভুলে পুরনো ড্যাশবোর্ড — অ্যাপ কখনো "Something went wrong"-এ পড়ে না */
      console.warn('[dv2] build পতন — পুরনো ড্যাশবোর্ডে ফলব্যাক', e);
      try { if (typeof previous === 'function') previous(); } catch (_) {}
      dv2Cleanup();
      return undefined;
    }
    if (typeof window.renderShell === 'function') window.renderShell(html, { title: 'Dashboard', topbar: false });
    else { const app = document.getElementById('app'); if (app) app.innerHTML = '<main class="page">' + html + '</main>'; }
    dv2Cleanup();
    return undefined;
  }

  /* পুরনো-চেইনের সম্ভব্য-অবশিষ্ট-পরিচ্ছন্নতা: একাধিক .page / পুরনো-ড্যাশ-মার্কর → কেবল dv2-পেজ */
  function dv2Cleanup() {
    try {
      const app = document.getElementById('app');
      if (!app) return;
      const pages = Array.from(app.querySelectorAll('.page'));
      if (pages.length > 1) {
        const keep = pages.filter((p) => p.querySelector('.dv2-root')).pop() || pages[pages.length - 1];
        pages.forEach((p) => { if (p !== keep) p.remove(); });
      }
      app.querySelectorAll('[data-phase5-dashboard],[data-phase34-dashboard],[data-dashboard-comparison],[data-phase5-quicklinks],.daily-gk-teaser,.p3-dashboard-v3,.dashboard-v2,.p3-dashboard').forEach((n) => n.remove());
    } catch (_) {}
  }

  // This is the first-interaction module. Signal the coordinator immediately;
  // do not wait for every optional deferred tool or an external Google script.
  window.__admissionDashboardModuleReady = true;
  if (typeof window.__admissionRequestFinalRender === 'function') window.__admissionRequestFinalRender();
})();
