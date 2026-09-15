/* v107 — Admission Hub Smart Notification engine (client).
   Golden rule: "Notification পাঠানোর মতো কারণ না থাকলে পাঠাবে না।"
   সব claim আসল ডেটা থেকে (activityLogs/examResults/mistakes/streak) — fake praise নিষিদ্ধ।
   Delivery: Telegram + iPhone/PWA web-push (নিজের Cloudflare worker); user active থাকলে শুধু in-app toast। */
(() => {
  'use strict';

  const DEFAULT_ENDPOINT = 'https://admission-notify.admissionhub.workers.dev';
  const LS_ENDPOINT = 'ahNotifyUrl';
  const VAPID_PUBLIC = 'BJtpFY7isSDAQy7ck7zNQjNfmhAu4w-bcQ3_eFUTQbITSHBJO5f6n5ayYm_-TE7vNcnZ_1Ib45DVmxQkyLIFDsY';
  const APP_HEADER = 'admission-hub';

  const DEFAULT_PREFS = Object.freeze({
    master: true,
    cats: { study: true, streak: true, revision: true, mistake: true, achievement: true, exam: true, admission: true, update: true },
    times: { morning: '08:00', afternoon: '16:00', evening: '20:00' },
    quiet: { start: 23, end: 7 },
    dailyCap: 3,
    cooldownH: 3
  });
  const CAT_LABEL = { study: '📚 Study Reminder', streak: '🔥 Streak', revision: '🔁 Revision', mistake: '🧠 Mistake Bank', achievement: '🏆 Progress & Achievement', exam: '📝 Exam Reminder', admission: '🎓 Admission Alert', update: '📢 Important Update' };
  const CAT_SOON = { admission: true, update: true, exam: true }; // জেনারেটর আসছে — আসল ডেটা ছাড়া কিছু পাঠানো হবে না

  let endpoint = DEFAULT_ENDPOINT;
  try {
    const saved = String(localStorage.getItem(LS_ENDPOINT) || '').trim();
    endpoint = saved === 'off' ? '' : (saved || DEFAULT_ENDPOINT);
  } catch (_) {}
  const saveEndpoint = url => {
    const value = String(url || '').trim().replace(/\/+$/, '');
    endpoint = value === 'off' ? '' : (value || DEFAULT_ENDPOINT);
    try { localStorage.setItem(LS_ENDPOINT, value); } catch (_) {}
    return endpoint;
  };

  const uid = () => 'n-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const todayKey = (date) => { const d = date ? new Date(date) : new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // ── prefs + state (appMeta) + log (notifications store) ─────────────────────
  const getPrefs = async () => {
    try { const row = await dbGet('appMeta', 'ahNotifPrefs'); return { ...DEFAULT_PREFS, ...(row?.value || {}), cats: { ...DEFAULT_PREFS.cats, ...(row?.value?.cats || {}) }, times: { ...DEFAULT_PREFS.times, ...(row?.value?.times || {}) }, quiet: { ...DEFAULT_PREFS.quiet, ...(row?.value?.quiet || {}) } }; }
    catch (_) { return { ...DEFAULT_PREFS }; }
  };
  const savePrefs = async prefs => { try { await dbPut('appMeta', { id: 'ahNotifPrefs', value: prefs }); } catch (_) {} return prefs; };
  const getState = async () => { try { return (await dbGet('appMeta', 'ahNotifState'))?.value || {}; } catch (_) { return {}; } };
  const saveState = async value => { try { await dbPut('appMeta', { id: 'ahNotifState', value }); } catch (_) {} return value; };
  const logRows = async () => { try { return await dbGetAll('notifications'); } catch (_) { return []; } };
  const logRow = async row => { try { await dbPut('notifications', row); } catch (_) {} return row; };

  // ── আসল ডেটা ────────────────────────────────────────────────────────────────
  const todayQuestions = () => {
    try {
      const key = todayKey();
      return CACHE.examResults.filter(r => todayKey(new Date(r.date)) === key)
        .reduce((sum, r) => sum + (Number(r.correct) || 0) + (Number(r.wrong) || 0) + (Number(r.skipped) || 0), 0);
    } catch (_) { return 0; }
  };
  const streakBase = () => { // গতকাল-পর্যন্ত ধারা (আজ এখনো না হলে streak-ঝুঁকির আসল সংখ্যা)
    try {
      const days = new Set(CACHE.activityLogs.map(a => a.day));
      CACHE.examResults.forEach(r => days.add(todayKey(new Date(r.date))));
      let streak = 0; const d = new Date(); d.setDate(d.getDate() - 1);
      while (days.has(todayKey(d))) { streak++; d.setDate(d.getDate() - 1); }
      return streak;
    } catch (_) { return 0; }
  };
  const streakNow = () => { try { return typeof computeStreak === 'function' ? computeStreak() : 0; } catch (_) { return 0; } };
  const streakAtRisk = () => { const s = streakNow(); return s > 0 ? s : streakBase(); };
  const mistakeCount = () => { try { return (CACHE.mistakes || []).length; } catch (_) { return 0; } };
  const dailyTarget = () => { try { return Math.max(1, Number(CACHE.settings?.dailyTarget) || 100); } catch (_) { return 100; } };
  // Smart time learning: গত ১৪ দিনে study activity-র গড় ঘণ্টা (সন্ধ্যা-রাতের দিকে ভাঁজ করা)
  const preferredHour = () => {
    try {
      const cutoff = Date.now() - 14 * 86400000;
      const hours = (CACHE.activityLogs || []).filter(a => Number(a.ts) >= cutoff).map(a => new Date(Number(a.ts)).getHours());
      if (hours.length < 3) return null;
      const eveningish = hours.map(h => (h < 6 ? h + 24 : h));
      const mean = eveningish.reduce((a, b) => a + b, 0) / eveningish.length;
      return Math.floor(Math.min(23, Math.max(12, mean)));
    } catch (_) { return null; }
  };
  const inQuietHours = (hour, quiet) => quiet.start > quiet.end ? (hour >= quiet.start || hour < quiet.end) : (hour >= quiet.start && hour < quiet.end);

  // ── Candidate builders (spec §3–§8) — সবই আসল সংখ্যা দিয়ে ────────────────────
  const buildCandidates = (snapshot, prefs, state) => {
    const list = [];
    const { now, streak, todayQ, target, mistakes, prefHour } = snapshot;
    const hour = now.getHours();
    const today = todayKey(now);
    if (prefs.cats.streak && streak >= 2 && todayQ === 0 && hour >= 17 && hour < 23) {
      list.push({ category: 'streak', priority: 4, dedup: `streak-risk-${today}`, title: '🔥 Streak ভাঙার ঝুঁকি', body: `তোর ${streak} দিনের streak আজ ভেঙে যেতে পারে 😶 চল অন্তত 10টা MCQ দিয়ে বাঁচিয়ে রাখি।` });
    }
    if (prefs.cats.study && todayQ === 0 && prefHour !== null && hour >= Math.max(12, prefHour - 1) && hour < Math.min(23, prefHour + 2)) {
      list.push({ category: 'study', priority: 3, dedup: `study-${today}`, title: '📚 পড়ার সময় হয়ে গেছে', body: 'এই সময়টায় তুই সাধারণত পড়া শুরু করিস 🔥 চল আজকের practice দিয়ে শুরু করি।' });
    }
    if (prefs.cats.study && todayQ === 0 && hour >= 10 && hour < 12 && state.morningPrompt !== today) {
      list.push({ category: 'study', priority: 2, dedup: `study-am-${today}`, title: '📚 দিনটা শুরু করবি?', body: 'সকালের একটা ছোট practice সারাদিনের মুড ঠিক করে দেয় — 10টা MCQ দিয়ে শুরু করি!' });
    }
    if (prefs.cats.study && todayQ > 0 && todayQ < target && hour >= 21 && hour < 23) {
      list.push({ category: 'study', priority: 2, dedup: `study-eve-${today}`, title: '🎯 একটু বাকি রয়ে গেছে', body: `আজ ${todayQ}টা হয়েছে, target ${target}। আর ${target - todayQ}টা দিলেই আজকেরটা complete!` });
    }
    if (prefs.cats.mistake && mistakes >= 25 && (state.lastMistakeSent || 0) <= mistakes - 5) {
      list.push({ category: 'mistake', priority: 3, dedup: `mistake-${mistakes}`, title: '🧠 Mistake Bank ভর্তি', body: `${mistakes}টা ভুল জমেছে। আজ 10 মিনিট এগুলো ঘেঁটে দেখলে অনেক লাভ হবে 💪` });
    }
    for (const m of [50, 100, 200, 300, 500]) {
      if (prefs.cats.achievement && todayQ >= m && (state.lastMilestone || 0) < m && todayQ - 5 < m) {
        list.push({ category: 'achievement', priority: 2, dedup: `milestone-${today}-${m}`, title: `🔥 আজ ${m} MCQ complete!`, body: 'দুর্দান্ত গতি! এভাবেই চালিয়ে যা 🚀', milestone: m });
      }
    }
    if (prefs.cats.achievement && todayQ >= target && (state.lastTargetDone || '') !== today && todayQ - 5 < target) {
      list.push({ category: 'achievement', priority: 3, dedup: `target-${today}`, title: '🎯 আজকের target complete!', body: `${todayQ}/${target} — আজকের প্রস্তুতি নিশ্চিত। শুভকামনা! 🚀` });
    }
    return list;
  };

  // ── Decision engine (spec §30 ধাপ ১–১০) ─────────────────────────────────────
  const evaluate = async (opts = {}) => {
    const result = { sent: null, suppressed: [], reason: '', inApp: false };
    try {
      const prefs = await getPrefs();
      if (!prefs.master) { result.reason = 'master-off'; return result; }
      const now = opts.now && typeof opts.now.getHours === 'function' ? opts.now : new Date();
      const hour = now.getHours();
      if (inQuietHours(hour, prefs.quiet)) { result.reason = 'quiet-hours'; return result; }
      const state = await getState();
      const today = todayKey(now);
      const snapshot = { now, streak: streakAtRisk(), todayQ: todayQuestions(), target: dailyTarget(), mistakes: mistakeCount(), prefHour: preferredHour() };
      const candidates = buildCandidates(snapshot, prefs, state)
        .filter(candidate => !!prefs.cats[candidate.category])
        .sort((a, b) => b.priority - a.priority);
      if (!candidates.length) { result.reason = 'no-relevant'; return result; }
      const seen = new Set();
      for (const candidate of candidates) {
        if (seen.has(candidate.dedup)) continue;
        seen.add(candidate.dedup);
        const rows = await logRows();
        if (rows.some(row => row.dedup === candidate.dedup && row.status !== 'cancelled')) { result.suppressed.push(candidate.title + ' (আগে পাঠানো)'); continue; }
        if (state.lastSentAt && now.getTime() - state.lastSentAt < prefs.cooldownH * 3600000) { result.suppressed.push(candidate.title + ' (cooldown)'); continue; }
        const sentToday = state.sentDate === today ? (state.sentCount || 0) : 0;
        if (sentToday >= prefs.dailyCap) { result.suppressed.push(candidate.title + ' (daily cap)'); continue; }
        // Active user → push নয়, in-app toast (spec §21)
        const active = typeof document !== 'undefined' && document.visibilityState === 'visible' && !opts.force;
        const chosen = candidate;
        result.inApp = active;
        await logRow({ id: uid(), category: chosen.category, title: chosen.title, body: chosen.body, priority: chosen.priority, dedup: chosen.dedup, status: active ? 'shown-in-app' : 'sent', readAt: active ? Date.now() : null, createdAt: now.getTime() });
        const nextState = { ...state, lastSentAt: now.getTime(), sentDate: today, sentCount: sentToday + 1, lastTodayQ: snapshot.todayQ };
        if (chosen.category === 'mistake') nextState.lastMistakeSent = snapshot.mistakes;
        if (chosen.milestone) nextState.lastMilestone = chosen.milestone;
        if (chosen.dedup?.startsWith('target-')) nextState.lastTargetDone = today;
        if (chosen.dedup?.startsWith('study-am-')) nextState.morningPrompt = today;
        await saveState(nextState);
        if (active) { try { window.toast?.(chosen.title + ' — ' + chosen.body); } catch (_) {} }
        else await dispatch(chosen, snapshot);
        result.sent = chosen;
        return result;
      }
      result.reason = 'all-suppressed';
      return result;
    } catch (_) { result.reason = 'error'; return result; }
  };

  // ── Delivery: worker → Telegram + Web Push (+ state sync for cron fallback) ──
  const dispatch = async (chosen, snapshot) => {
    if (!endpoint) return 'off';
    try {
      await fetch(endpoint + '/api/notify/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AH-App': APP_HEADER },
        body: JSON.stringify({
          telegram: { text: `${chosen.title}\n\n${chosen.body}` },
          state: { streak: snapshot.streak, todayQuestions: snapshot.todayQ, lastOpen: todayKey() }
        })
      });
      return 'ok';
    } catch (_) { return 'fail'; } // spec §46: failure কখনো app break করবে না
  };
  const syncState = async () => {
    if (!endpoint) return;
    try {
      await fetch(endpoint + '/api/notify/dispatch', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AH-App': APP_HEADER },
        body: JSON.stringify({ state: { streak: streakNow(), todayQuestions: todayQuestions(), lastOpen: todayKey() } })
      });
    } catch (_) {}
  };

  // ── iOS/PWA push subscription (spec §26–§27: gesture-পরবর্তী, কখনো auto-popup নয়) ──
  const b64uToU8 = str => { const s = str.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(s + '='.repeat((4 - s.length % 4) % 4)); return Uint8Array.from(bin, c => c.charCodeAt(0)); };
  const pushReady = () => typeof Notification !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
  const standalone = () => window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
  const enablePush = async () => {
    if (!pushReady()) { window.toast?.('এই device-এ web push নেই — Telegram-এ notification আসবে ✈️'); return 'unsupported'; }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { window.toast?.('নোটিফিকেশন চালু হয়নি — পরে Settings → Notifications থেকে চালু করতে পারবে।'); return permission; }
    try {
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      subscription = subscription || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToU8(VAPID_PUBLIC) });
      const sub = subscription.toJSON();
      await fetch(endpoint + '/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AH-App': APP_HEADER }, body: JSON.stringify(sub) });
      window.toast?.('🔔 Notification চালু! আর iPhone push-এর জন্য অ্যাপটা Home Screen থেকে খেলে সবচেয়ে ভালো চলে।');
      return 'granted';
    } catch (_) {
      window.toast?.('Push subscribe হয়নি — তবু Telegram notification চলবে ✈️');
      return 'subscribe-failed';
    }
  };
  let lastResub = 0;
  const maybeResubscribe = async () => {
    const nowTs = Date.now();
    if (nowTs - lastResub < 5 * 60000 || !endpoint || !pushReady()) return;
    try {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      lastResub = nowTs;
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) await fetch(endpoint + '/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AH-App': APP_HEADER }, body: JSON.stringify(subscription.toJSON()) }).catch(() => {});
    } catch (_) {}
  };
  const disablePush = async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch(endpoint + '/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AH-App': APP_HEADER }, body: JSON.stringify(subscription.toJSON()) }).catch(() => {});
        await subscription.unsubscribe();
      }
      window.toast?.('Push বন্ধ হয়েছে');
    } catch (_) {}
  };

  // ── UI: dashboard card + notification center + settings ─────────────────────
  const unreadCount = async () => (await logRows()).filter(row => !row.readAt).length;
  // DOM-বসানো: কোন renderer জিতুক, ড্যাশবোর্ডে streak-কার্ডের ঠিক নিচে কার্ড বসাও (v108)
  const mountDashboardCard = () => {
    try {
      if (typeof document === 'undefined') return false;
      const page = document.querySelector('#app .page');
      if (!page) return false;
      if (page.querySelector('#ahNotifCard')) return true;
      const streak = page.querySelector('#dailyStreakCard');
      const holder = document.createElement('div');
      holder.innerHTML = dashboardHtml();
      const card = holder.firstElementChild;
      if (streak && streak.parentElement) streak.insertAdjacentElement('afterend', card);
      else page.insertBefore(card, page.firstChild);
      return true;
    } catch (_) { return false; }
  };
  const fmtTime = ts => { try { return new Date(ts).toLocaleString('bn-BD', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }); } catch (_) { return ''; } };
  const dashboardHtml = () => `
    <div id="ahNotifCard" class="card premium-card fade-in stagger-1" style="display:flex;align-items:center;gap:12px">
      <div id="ahNotifIcon" style="position:relative;font-size:22px;flex:0 0 auto">🔔
        <span id="ahNotifBadge" style="display:none;position:absolute;top:-6px;right:-10px;background:var(--red);color:#fff;border-radius:99px;font-size:10px;font-weight:800;padding:1px 5px"></span>
      </div>
      <div id="ahNotifCopy" style="flex:1;min-width:0;font-size:13px;line-height:1.45"></div>
      <button class="iconbtn" style="flex:0 0 auto" title="Notification settings" onclick="NotificationHub.openSettings()">⚙️</button>
    </div>`;
  const hydrateDashboard = async () => {
    try {
      const copy = document.getElementById('ahNotifCopy');
      if (!copy) return;
      const permission = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
      if (permission === 'default') {
        copy.innerHTML = `<b>🔔 Study reminder চালু করবি?</b><br><span style="opacity:.75;font-size:11.5px">গুরুত্বপূর্ণ update + ঠিক সময়ে ছোট রিমাইন্ডার — বিরক্তিটা আমরাই লজ্জা পাই 😄</span>
          <div style="display:flex;gap:8px;margin-top:8px"><button class="btn sm" onclick="NotificationHub.promptEnable()">চালু করি</button><button class="btn ghost sm" onclick="NotificationHub.dismissPrompt()">এখন না</button></div>`;
      } else {
        const unread = await unreadCount();
        const badge = document.getElementById('ahNotifBadge');
        if (badge) { badge.style.display = unread ? 'inline-block' : 'none'; badge.textContent = unread > 9 ? '9+' : unread; }
        copy.innerHTML = `<b>Notifications</b> <span style="opacity:.7;font-size:11.5px">${unread ? `${unread}টি নতুন` : 'সব পড়া হয়ে গেছে ✓'}</span><br><button class="btn ghost sm" style="margin-top:6px" onclick="NotificationHub.openCenter()">🔔 Notification Center খোলো</button>`;
      }
    } catch (_) {}
  };
  const dismissPrompt = async () => { await saveState({ ...(await getState()), promptDismissed: todayKey() }); window.toast?.('ঠিক আছে — Settings → Notifications থেকে যখন চাও চালু করতে পারবে 😊'); const copy = document.getElementById('ahNotifCopy'); if (copy) copy.innerHTML = '<b>Notifications</b><br><button class="btn ghost sm" style="margin-top:6px" onclick="NotificationHub.openCenter()">🔔 Notification Center খোলো</button>'; };
  const promptEnable = async () => { const status = await enablePush(); if (status === 'granted') hydrateDashboard(); };

  const openCenter = async () => {
    const rows = (await logRows()).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
    openModal(`<h3>🔔 Notification Center</h3><p class="muted" style="margin-top:4px;font-size:12px">শুধু আসল কারণ থাকলেই কিছু আসে — নীরবতাও একটা ফিচার 😄</p>${rows.length ? `<div style="display:grid;gap:9px;margin-top:12px">${rows.map(row => `<div style="padding:11px;border:1px solid var(--line);border-radius:12px;background:${row.readAt ? 'transparent' : 'var(--mint)'}"><div style="display:flex;gap:8px;align-items:center"><b style="font-size:13px;flex:1">${escapeHtml(row.title)}</b>${row.readAt ? '' : '<span style="width:8px;height:8px;border-radius:99px;background:var(--emerald)"></span>'}</div><div style="font-size:12.5px;margin-top:3px;line-height:1.5">${escapeHtml(row.body)}</div><small style="color:var(--sub);font-size:10.5px">${fmtTime(row.createdAt)} · ${CAT_LABEL[row.category] || row.category}</small></div>`).join('')}</div>` : '<p class="muted" style="margin-top:12px">এখনো কোনো notification পাঠানো হয়নি।</p>'}<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn ghost sm" onclick="NotificationHub.markAllRead();closeModal()">Mark all as read</button><button class="btn ghost sm" onclick="NotificationHub.openSettings()">⚙️ Settings</button><button class="btn sm" onclick="closeModal()">Close</button></div>`);
    await markAllRead();
  };
  const markAllRead = async () => {
    const rows = await logRows();
    for (const row of rows) if (!row.readAt) await logRow({ ...row, readAt: Date.now(), status: row.status === 'sent' ? 'opened' : row.status });
    hydrateDashboard();
  };
  const escapeHtml = value => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const toggleRow = (label, key, prefs) => `<div style="display:flex;align-items:center;gap:10px;padding:7px 0"><span style="flex:1;font-size:13px">${label}</span><button class="chip ${prefs.cats[key] ? 'active' : ''}" onclick="NotificationHub.toggleCat('${key}')">${prefs.cats[key] ? 'ON' : 'OFF'}</button></div>`;
  const openSettings = async () => {
    const prefs = await getPrefs();
    const soon = Object.entries(CAT_SOON).filter(([, v]) => v).map(([k]) => CAT_LABEL[k]).join(' · ');
    const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
    const pushRow = !pushReady() ? '<div style="padding:9px 0;border-bottom:1px solid var(--line);font-size:12px;color:var(--sub)">📱 এই device-এ web push নেই — Telegram-এ notification যাবে ✈️</div>'
      : perm === 'granted' ? `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)"><span style="flex:1;font-size:13px">📱 iPhone push</span><span class="chip active" style="pointer-events:none">চালু ✓</span></div>`
      : perm === 'denied' ? '<div style="padding:9px 0;border-bottom:1px solid var(--line);font-size:12px;color:var(--red)">⚠️ Push অনুমতি ব্লকড — iOS Settings → Safari/Home-অ্যাপ → Notifications থেকে চালু করো</div>'
      : `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)"><span style="flex:1;font-size:13px">📱 iPhone push</span><button class="btn sm" onclick="NotificationHub.enablePush().then(() => NotificationHub.openSettings())">চালু করি</button></div>`;
    openModal(`<h3>⚙️ Notifications</h3>${pushRow}
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)"><span style="flex:1;font-weight:700">Master Notification</span><button class="chip ${prefs.master ? 'active' : ''}" onclick="NotificationHub.toggleMaster()">${prefs.master ? 'ON' : 'OFF'}</button></div>
      ${Object.keys(DEFAULT_PREFS.cats).map(key => toggleRow(CAT_LABEL[key] + (CAT_SOON[key] ? ' <span style="color:var(--sub);font-size:10px">(শীঘ্রই)</span>' : ''), key, prefs)).join('')}
      <label class="flabel" style="margin-top:10px">Quiet hours (এই সময়ে কিছু আসবে না)</label>
      <div style="display:flex;gap:8px;align-items:center"><select onchange="NotificationHub.setQuiet('start',this.value)">${[...Array(24)].map((_, h) => `<option value="${h}" ${prefs.quiet.start === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select><span>→</span><select onchange="NotificationHub.setQuiet('end',this.value)">${[...Array(24)].map((_, h) => `<option value="${h}" ${prefs.quiet.end === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></div>
      <label class="flabel" style="margin-top:10px">দিনে সর্বোচ্চ notification</label>
      <select onchange="NotificationHub.setCap(this.value)">${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${prefs.dailyCap === n ? 'selected' : ''}>${n}টি</option>`).join('')}</select>
      ${soon ? `<p class="muted" style="font-size:11px;margin-top:10px">${soon} — verified আসল তথ্য পেলেই চালু হবে; অনুমান-নির্ভর কিছু পাঠানো হবে না।</p>` : ''}
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button class="btn sm" onclick="NotificationHub.testNow()">🔔 টেস্ট পাঠাও</button>
        ${pushReady() && Notification.permission === 'granted' ? '<button class="btn ghost sm" onclick="NotificationHub.disablePush();closeModal()">Push বন্ধ করো</button>' : ''}
        <button class="btn ghost sm" onclick="closeModal()">Close</button>
      </div>
      <small style="display:block;margin-top:10px;color:var(--sub);font-size:11px;line-height:1.5">Telegram (✈️ @myadmihubbot) + iPhone push দুটোতেই যায়। Active থাকলে অ্যাপের ভেতরেই দেখায় — push বিরক্ত করে না।</small>`);
  };
  const toggleMaster = async () => { const prefs = await getPrefs(); prefs.master = !prefs.master; await savePrefs(prefs); openSettings(); toastShort(prefs.master ? 'Notification চালু' : 'Notification বন্ধ'); };
  const toggleCat = async key => { const prefs = await getPrefs(); prefs.cats[key] = !prefs.cats[key]; await savePrefs(prefs); openSettings(); };
  const setQuiet = async (part, value) => { const prefs = await getPrefs(); prefs.quiet[part] = Number(value); await savePrefs(prefs); toastShort('Quiet hours সেভ হয়েছে'); };
  const setCap = async value => { const prefs = await getPrefs(); prefs.dailyCap = Number(value); await savePrefs(prefs); toastShort('Cap সেভ হয়েছে'); };
  const testNow = async () => {
    closeModal();
    window.toast?.('টেস্ট পাঠানো হচ্ছে…');
    const okSend = await dispatch({ title: '🔔 Admission Hub টেস্ট', body: 'বাহ! Notification চ্যানেল কাজ করছে — এখন থেকে ঠিক সময়ে আমি মনে করিয়ে দেব 😄', category: 'update' }, { streak: streakNow(), todayQ: todayQuestions() });
    if (okSend !== 'off') await logRow({ id: uid(), category: 'update', title: '🔔 টেস্ট notification', body: 'চ্যানেল যাচাই সম্পন্ন ✓', priority: 1, dedup: 'test-' + Date.now(), status: 'sent', readAt: null, createdAt: Date.now() });
    window.toast?.(okSend === 'off' ? 'Endpoint বন্ধ আছে' : 'টেস্ট পাঠানো হয়েছে — Telegram/push দেখো!');
  };
  const toastShort = text => { try { window.toast?.(text); } catch (_) {} };

  // ── boot: dashboard hydration + periodic engine ─────────────────────────────
  const boot = () => {
    const lazy = fn => () => { if (!window.__ahNotifyNoAuto) fn(); };
    setTimeout(lazy(() => { evaluate(); syncState(); maybeResubscribe(); }), 8000);
    setInterval(lazy(() => { evaluate(); syncState(); }), 15 * 60000);
    document.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'visible') maybeResubscribe(); });

  };
  if (typeof document !== 'undefined') boot();

  window.NotificationHub = {
    dashboardHtml, hydrateDashboard, mountDashboardCard, openCenter, openSettings, markAllRead, maybeResubscribe,
    promptEnable, dismissPrompt, enablePush, disablePush, testNow,
    toggleMaster, toggleCat, setQuiet, setCap, saveEndpoint,
    evaluate, syncState,
    _prefs: getPrefs, _state: getState, _log: logRows, _build: buildCandidates,
    _dbg: { streakAtRisk, streakBase, preferredHour, todayQuestions, mistakeCount, inQuietHours }
  };
})();
