/* v2 — Admission Hub admin Notification Center (Phase 2, owner-approved 2026-09-17).
 * v2 (2026-09-18, owner bug): verify flow now distinguishes the failure
 * modes — the Bearer ADMIN_TOKEN is the credential (session optional), so
 * 403 = wrong token; 503 = storage/FCM not ready; network = try again.
 *
 * Hidden route #notif-admin (not in the bottom nav). Admin auth = the existing
 * ADMIN_TOKEN sent as Bearer; it is kept in sessionStorage for this browser
 * session ONLY (never localStorage, never the URL). Every admin API call is
 * re-verified server-side (session + Bearer token).
 *
 * Spec: global send (topic-first), schedule (Asia/Dhaka), cancel, audience
 * selection (topic architecture), composer with templates + live preview,
 * deep links, history + reliable metrics only (sent / reach / clicks).
 *
 * Dual language: bn + en written, only the active language is rendered
 * (AhI18n) — both languages never shown at the same time.
 */
(() => {
  'use strict';

  const I18N = {
    title: { bn: 'Notification Center', en: 'Notification Center' },
    back: { bn: 'ফিরে যান', en: 'Back' },
    create: { bn: '+ Create Notification', en: '+ Create Notification' },
    backToCenter: { bn: '← Center', en: '← Center' },
    recent: { bn: 'Recent Notifications', en: 'Recent Notifications' },
    empty: { bn: 'এখনো কোনো global notification পাঠানো হয়নি', en: 'No global notifications sent yet' },
    tokenTitle: { bn: 'Admin Verification', en: 'Admin Verification' },
    tokenBody: { bn: 'এই section-এ ঢוקতে ADMIN token দিন — শুধু এই browser session-এ থাকবে, কোথাও store হবে না।', en: 'Enter the ADMIN token to open this section — it is kept in this browser session only, never stored.' },
    tokenPh: { bn: 'ADMIN_TOKEN', en: 'ADMIN_TOKEN' },
    verify: { bn: 'Verify', en: 'Verify' },
    badToken: { bn: 'Token সঠিক নয় — আবার চেষ্টা করুন', en: 'Incorrect token — please try again' },
    notReady: { bn: 'এখনো ready নয় — কিছুক্ষণ পর আবার চেষ্টা করুন', en: 'Not ready yet — please try again in a moment' },
    networkErr: { bn: 'Connection সমস্যা — internet check করে আবার চেষ্টা করুন', en: 'Connection problem — check your internet and try again' },
    typeLabel: { bn: 'Type', en: 'Type' },
    types: {
      'new-content': { bn: '📚 নতুন Content', en: '📚 New Content' },
      'announcement': { bn: '📢 Announcement', en: '📢 Announcement' },
      'new-feature': { bn: '🚀 নতুন Feature', en: '🚀 New Feature' },
      'challenge': { bn: '🏆 Challenge', en: '🏆 Challenge' },
      'course': { bn: '🎓 Course', en: '🎓 Course' },
      'important': { bn: '⚠️ Important', en: '⚠️ Important' }
    },
    audienceLabel: { bn: 'Audience', en: 'Audience' },
    audiences: {
      all_students: { bn: 'সব Student', en: 'All Students' },
      beginner: { bn: 'Beginner Student', en: 'Beginner Students' },
      intermediate: { bn: 'Intermediate Student', en: 'Intermediate Students' },
      pro: { bn: 'Pro Student', en: 'Pro Students' },
      course_subscribers: { bn: 'Course Subscribers', en: 'Course Subscribers' }
    },
    templateLabel: { bn: 'Template (variables: {{title}} {{lesson}} {{course}} {{feature}} {{date}})', en: 'Template (variables: {{title}} {{lesson}} {{course}} {{feature}} {{date}})' },
    templateNone: { bn: '(খালি — manually লিখুন)', en: '(blank — write manually)' },
    titleLabel: { bn: 'Title', en: 'Title' },
    titlePh: { bn: '🚀 New Lesson Available', en: '🚀 New Lesson Available' },
    bodyLabel: { bn: 'Message', en: 'Message' },
    bodyPh: { bn: 'নতুন lesson এখন available।', en: 'A new lesson is now available.' },
    imageLabel: { bn: 'Image URL (optional)', en: 'Image URL (optional)' },
    targetLabel: { bn: 'Deep link — notification click-এ কোন page খুলবে', en: 'Deep link — which page opens on notification click' },
    targetPh: { bn: '/dashboard', en: '/dashboard' },
    sendModeLabel: { bn: 'Send', en: 'Send' },
    now: { bn: 'এখন (Now)', en: 'Now' },
    schedule: { bn: 'Schedule', en: 'Schedule' },
    scheduleHint: { bn: 'Timezone: Asia/Dhaka (আপনার local time-ই পাঠানো হবে)', en: 'Timezone: Asia/Dhaka (sent at your local time)' },
    previewLabel: { bn: 'Live Preview', en: 'Live Preview' },
    appHeader: { bn: 'Admission Hub', en: 'Admission Hub' },
    sendBtn: { bn: 'Send Notification', en: 'Send Notification' },
    confirmTitle: { bn: 'নিশ্চিত?', en: 'Are you sure?' },
    confirmAudience: { bn: 'Audience', en: 'Audience' },
    confirmReach: { bn: 'Estimated reach', en: 'Estimated reach' },
    confirmTime: { bn: 'Send time', en: 'Send time' },
    cancelBtn: { bn: 'Cancel', en: 'Cancel' },
    confirmSend: { bn: 'Send', en: 'Send' },
    statusChip: {
      sent: { bn: 'Sent', en: 'Sent' },
      scheduled: { bn: 'Scheduled', en: 'Scheduled' },
      cancelled: { bn: 'Cancelled', en: 'Cancelled' },
      failed: { bn: 'Failed', en: 'Failed' },
      sending: { bn: 'Sending…', en: 'Sending…' }
    },
    reachWord: { bn: 'device', en: 'devices' },
    clicksWord: { bn: 'clicks', en: 'clicks' },
    cancelAction: { bn: 'Cancel', en: 'Cancel' },
    errDuplicate: { bn: 'এই notification আগেই sent/schedule আছে (১০ দিনের duplicate protection)', en: 'This notification was already sent/scheduled (10-day duplicate protection)' },
    errRate: { bn: 'আজকের daily cap শেষ — কাল আবার চেষ্টা করুন', en: 'Today’s daily cap reached — try again tomorrow' },
    errGeneric: { bn: 'Send ব্যর্থ হয়েছে — আবার চেষ্টা করুন', en: 'Send failed — please try again' },
    sentOk: { bn: 'Global notification sent ✓', en: 'Global notification sent ✓' },
    scheduledOk: { bn: 'Schedule হয়ে গেছে ✓', en: 'Scheduled ✓' },
    cancelledOk: { bn: 'Cancelled ✓', en: 'Cancelled ✓' },
    logout: { bn: 'Admin session বন্ধ করুন', en: 'End admin session' },
    storage: { bn: 'Storage (৯ GB hard limit-এর নিচে)', en: 'Storage (under the 9 GB hard lock)' },
    metricsNote: { bn: 'শুধু reliable metrics: sent / estimated reach / clicks। Open rate web push-এ reliably measure করা যায় না।', en: 'Only reliable metrics: sent / estimated reach / clicks. Open rate is not reliably measurable on web push.' }
  };

  const lang = () => { try { return window.AhI18n ? window.AhI18n.get() : 'bn'; } catch (_) { return 'bn'; } };
  const t = (key, extra) => {
    const e = extra || I18N[key];
    return (e && e[lang()]) || (e && e.bn) || key;
  };
  const esc = (v) => String(v ?? '').replace(/[&<>\"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /* ── admin session (sessionStorage only) + bounded API client ───────────── */
  const LS_KEY = 'ahAdminTok';
  const tok = () => { try { return sessionStorage.getItem(LS_KEY) || ''; } catch (_) { return ''; } };
  const setTok = (v) => { try { v ? sessionStorage.setItem(LS_KEY, v) : sessionStorage.removeItem(LS_KEY); } catch (_) {} };

  const api = async (path, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(path, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        signal: controller.signal,
        ...init
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    } catch (_) { return { ok: false, status: 0, data: {} }; }
  };

  const fmtWhen = (ts) => {
    if (!ts) return '—';
    try {
      const d = new Date(ts);
      const L = lang() === 'bn' ? 'bn-BD' : 'en-GB';
      const sameDay = d.toDateString() === new Date().toString();
      return d.toLocaleString(L, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (_) { return String(ts); };
  };

  /* ── composer state ─────────────────────────────────────────────────────── */
  const state = {
    view: 'center',        // center | create
    history: [],
    reachEstimate: 0,
    templates: [],
    type: 'announcement',
    audience: 'all_students',
    templateKey: '',
    title: '',
    body: '',
    imageUrl: '',
    targetUrl: '',
    mode: 'now',           // now | schedule
    when: '',              // datetime-local value (Asia/Dhaka local)
    busy: false,
    error: '',
    usage: null /* { usedBytes, limitBytes, percent, exact } */
  };

  const applyTemplate = (key) => {
    state.templateKey = key;
    const tpl = state.templates.find(x => x.key === key);
    if (!tpl) return;
    const L = lang() === 'bn' ? 'bn' : 'en';
    state.title = tpl[L].title;
    state.body = tpl[L].body;
  };

  const fmtBytes = (n) => {
    if (!n && n !== 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = Number(n || 0), i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
  };
  const previewHtml = () => {
    const now = new Date();
    const L = lang() === 'bn' ? 'bn-BD' : 'en-GB';
    return `<div class="gn-preview">
      <div class="gn-preview-card">
        <div class="gn-preview-top"><span class="gn-preview-app">🔔 ${esc(t('appHeader'))}</span><span class="gn-preview-time">${esc(now.toLocaleTimeString(L, { hour: '2-digit', minute: '2-digit' }))}</span></div>
        <b class="gn-preview-title">${esc(state.title || '…')}</b>
        <p class="gn-preview-body">${esc(state.body || '…')}</p>
        ${state.targetUrl ? `<div class="gn-preview-link">↗ ${esc(state.targetUrl)}</div>` : ''}
      </div>
    </div>`;
  };

  /* ── views ──────────────────────────────────────────────────────────────── */
  const styles = () => `<style>
  .gn-root{max-width:640px;margin:0 auto;padding:8px 16px calc(24px + var(--safe-b,0px));}
  .gn-head{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:10px;padding:10px 0 12px;background:var(--bg,#f6f8f7);backdrop-filter:blur(8px);}
  .gn-back{width:40px;height:40px;border-radius:14px;border:1px solid var(--line,#e3e8e5);background:var(--card,#fff);font-size:18px;font-weight:700;color:#0c3b2a;display:grid;place-items:center;cursor:pointer;}
  .gn-back:active{transform:scale(.96);}
  .gn-title{font-size:18px;font-weight:800;color:#0c3b2a;flex:1;}
  .gn-logout{border:1px solid var(--line,#e3e8e5);background:var(--card,#fff);color:#7a5b12;font-size:11.5px;font-weight:700;border-radius:10px;padding:8px 10px;cursor:pointer;}
  .gn-btn{border:none;background:var(--emerald,#0f6b4f);color:#fff;font-weight:800;font-size:14px;border-radius:13px;padding:13px 18px;cursor:pointer;width:100%;}
  .gn-btn:active{transform:scale(.985);}
  .gn-btn:disabled{opacity:.6;}
  .gn-btn-ghost{background:none;border:1px solid var(--line,#e3e8e5);color:#54655d;}
  .gn-card{background:var(--card,#fff);border:1px solid var(--line,#e3e8e5);border-radius:16px;padding:14px;margin-bottom:10px;}
  .gn-label{font-size:12px;font-weight:800;color:#54655d;text-transform:uppercase;letter-spacing:.4px;margin:12px 0 7px;display:block;}
  .gn-input{width:100%;box-sizing:border-box;border:1px solid var(--line,#e3e8e5);border-radius:12px;background:var(--bg,#f6f8f7);padding:11px 12px;font-size:14px;font-family:inherit;color:#10352a;}
  .gn-input:focus{outline:2px solid var(--emerald,#0f6b4f);outline-offset:-1px;}
  .gn-textarea{resize:vertical;min-height:74px;}
  .gn-chips{display:flex;flex-wrap:wrap;gap:7px;}
  .gn-chip{border:1px solid var(--line,#e3e8e5);background:var(--card,#fff);border-radius:12px;padding:9px 12px;font-size:13px;font-weight:700;color:#54655d;cursor:pointer;}
  .gn-chip.active{background:var(--emerald,#0f6b4f);border-color:var(--emerald,#0f6b4f);color:#fff;}
  .gn-item{display:flex;align-items:flex-start;gap:11px;}
  .gn-item-ic{flex:0 0 auto;width:40px;height:40px;border-radius:12px;background:#eef5f1;display:grid;place-items:center;font-size:18px;}
  .gn-item-main{flex:1;min-width:0;}
  .gn-item-top{display:flex;align-items:baseline;gap:8px;}
  .gn-item-title{font-size:14px;font-weight:800;color:#10352a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .gn-item-sub{font-size:12px;color:#8a988f;margin-top:2px;}
  .gn-item-meta{font-size:11.5px;color:#8a988f;margin-top:5px;display:flex;gap:10px;flex-wrap:wrap;}
  .gn-status{display:inline-block;font-size:10.5px;font-weight:800;border-radius:999px;padding:3px 9px;}
  .gn-status.sent{background:#dcfce7;color:#166534;}
  .gn-status.scheduled{background:#fef9c3;color:#854d0e;}
  .gn-status.cancelled{background:#f3f4f6;color:#6b7280;}
  .gn-status.failed{background:#fee2e2;color:#991b1b;}
  .gn-status.sending{background:#e0f2fe;color:#075985;}
  .gn-item-actions{flex:0 0 auto;}
  .gn-mini{border:1px solid var(--line,#e3e8e5);background:var(--card,#fff);color:#b42318;font-size:11.5px;font-weight:700;border-radius:9px;padding:6px 9px;cursor:pointer;}
  .gn-error{background:#fee2e2;border:1px solid #fecaca;color:#991b1b;font-size:12.5px;border-radius:12px;padding:10px 12px;margin-top:10px;line-height:1.5;}
  .gn-preview{margin-top:6px;}
  .gn-preview-card{background:#fff;border:1px solid var(--line,#e3e8e5);border-radius:16px;padding:13px 14px;box-shadow:0 2px 12px rgba(12,59,42,.06);}
  .gn-preview-top{display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:#8a988f;margin-bottom:7px;}
  .gn-preview-app{font-weight:800;color:#54655d;}
  .gn-preview-title{display:block;font-size:14.5px;color:#10352a;margin-bottom:3px;}
  .gn-preview-body{margin:0;font-size:13px;color:#54655d;line-height:1.5;}
  .gn-preview-link{margin-top:8px;font-size:11.5px;color:var(--emerald,#0f6b4f);font-weight:700;}
  .gn-note{font-size:11px;color:#8a988f;line-height:1.6;margin-top:10px;}
  .gn-center-confirm{position:fixed;inset:0;z-index:2000;background:rgba(12,59,42,.45);display:grid;place-items:center;padding:20px;}
  .gn-center-confirm-card{background:#fff;border-radius:18px;padding:20px;width:100%;max-width:360px;}
  .gn-center-confirm h3{margin:0 0 10px;font-size:16px;color:#10352a;}
  .gn-confirm-row{display:flex;justify-content:space-between;font-size:13px;padding:6px 0;border-bottom:1px solid #eef1ef;}
  .gn-confirm-row b{color:#10352a;}
  .gn-confirm-actions{display:flex;gap:9px;margin-top:16px;}
  .gn-center-confirm .gn-btn{width:auto;flex:1;}
  </style>`;

  const historyItem = (row) => {
    const typeKey = I18N.types[row.type] ? row.type : 'announcement';
    const icon = String(t(typeKey, I18N.types[row.type] || {})).split(' ')[0];
    const statusChip = `<span class="gn-status ${esc(row.status)}">${esc(t(row.status, I18N.statusChip[row.status] || {}))}</span>`;
    const time = row.status === 'scheduled' && row.scheduledAt ? t('confirmTime') + ' ' + fmtWhen(row.scheduledAt) : (row.sentAt ? 'sent ' + fmtWhen(row.sentAt) : fmtWhen(row.createdAt));
    const cancelBtn = row.status === 'scheduled'
      ? `<button class="gn-mini" onclick="window.__gnCancel('${esc(row.id)}')">${esc(t('cancelAction'))}</button>` : '';
    return `<div class="gn-card gn-item">
      <span class="gn-item-ic" aria-hidden="true">${esc(icon)}</span>
      <div class="gn-item-main">
        <div class="gn-item-top"><span class="gn-item-title">${esc(row.title)}</span>${statusChip}</div>
        <div class="gn-item-sub">${esc(t(row.audience, I18N.audiences[row.audience] || {}))}</div>
        <div class="gn-item-meta"><span>${esc(time)}</span>${row.reachEstimate != null ? `<span>≈ ${row.reachEstimate} ${esc(t('reachWord'))}</span>` : ''}<span>${row.clicks} ${esc(t('clicksWord'))}</span></div>
      </div>
      <div class="gn-item-actions">${cancelBtn}</div>
    </div>`;
  };

  const centerView = () => `
    <button class="gn-btn" onclick="window.__gnGoCreate()">🔔 ${esc(t('create'))}</button>
    ${state.usage ? `<div class="gn-card gn-item" style="margin-top:10px">
      <span class="gn-item-ic" aria-hidden="true">📦</span>
      <div class="gn-item-main">
        <div class="gn-item-title">${esc(t('storage'))}</div>
        <div class="gn-item-sub">${fmtBytes(state.usage.usedBytes)} / 9 GB (${state.usage.percent}%)${state.usage.exact ? '' : ' · ~'}</div>
      </div>
    </div>` : ''}
    <div style="height:14px"></div>
    <span class="gn-label">${esc(t('recent'))}</span>
    ${state.history.length ? state.history.map(historyItem).join('') : `<div class="gn-card" style="text-align:center;color:#8a988f;padding:26px 14px;font-size:13px">${esc(t('empty'))}</div>`}
    <p class="gn-note">${esc(t('metricsNote'))}</p>`;

  const createView = () => `
    <button class="gn-back" style="width:auto;height:auto;padding:8px 12px;border-radius:10px;font-size:13px" onclick="window.__gnGoCenter()">${esc(t('backToCenter'))}</button>
    <div style="height:12px"></div>
    <span class="gn-label">${esc(t('typeLabel'))}</span>
    <div class="gn-chips">${Object.keys(I18N.types).map(k => `<button class="gn-chip ${state.type === k ? 'active' : ''}" onclick="window.__gnSetType('${k}')">${esc(t(k, I18N.types[k]))}</button>`).join('')}</div>
    <span class="gn-label">${esc(t('audienceLabel'))}</span>
    <div class="gn-chips">${Object.keys(I18N.audiences).map(k => `<button class="gn-chip ${state.audience === k ? 'active' : ''}" onclick="window.__gnSetAudience('${k}')">${esc(t(k, I18N.audiences[k]))}</button>`).join('')}</div>
    <span class="gn-label">${esc(t('templateLabel'))}</span>
    <select class="gn-input" onchange="window.__gnSetTemplate(this.value)">
      <option value="">${esc(t('templateNone'))}</option>
      ${state.templates.map(x => `<option value="${esc(x.key)}" ${state.templateKey === x.key ? 'selected' : ''}>${esc(t(x.type, I18N.types[x.type] || {}))}</option>`).join('')}
    </select>
    <span class="gn-label">${esc(t('titleLabel'))}</span>
    <input class="gn-input" maxlength="120" placeholder="${esc(t('titlePh'))}" value="${esc(state.title)}" oninput="window.__gnField('title', this.value)">
    <span class="gn-label">${esc(t('bodyLabel'))}</span>
    <textarea class="gn-input gn-textarea" maxlength="400" placeholder="${esc(t('bodyPh'))}" oninput="window.__gnField('body', this.value)">${esc(state.body)}</textarea>
    <span class="gn-label">${esc(t('imageLabel'))}</span>
    <input class="gn-input" maxlength="500" value="${esc(state.imageUrl)}" oninput="window.__gnField('imageUrl', this.value)" inputmode="url">
    <span class="gn-label">${esc(t('targetLabel'))}</span>
    <input class="gn-input" maxlength="200" placeholder="${esc(t('targetPh'))}" value="${esc(state.targetUrl)}" oninput="window.__gnField('targetUrl', this.value)">
    <span class="gn-label">${esc(t('sendModeLabel'))}</span>
    <div class="gn-chips">
      <button class="gn-chip ${state.mode === 'now' ? 'active' : ''}" onclick="window.__gnSetMode('now')">${esc(t('now'))}</button>
      <button class="gn-chip ${state.mode === 'schedule' ? 'active' : ''}" onclick="window.__gnSetMode('schedule')">${esc(t('schedule'))}</button>
    </div>
    ${state.mode === 'schedule' ? `<div style="height:8px"></div>
    <input type="datetime-local" class="gn-input" value="${esc(state.when)}" onchange="window.__gnField('when', this.value)">
    <div class="gn-note">${esc(t('scheduleHint'))}</div>` : ''}
    <span class="gn-label">${esc(t('previewLabel'))}</span>
    ${previewHtml()}
    ${state.error ? `<div class="gn-error">${esc(state.error)}</div>` : ''}
    <div style="height:16px"></div>
    <button class="gn-btn" id="gnSendBtn" ${state.busy ? 'disabled' : ''} onclick="window.__gnConfirmSend()">${state.busy ? '…' : esc(t('sendBtn'))}</button>`;

  const tokenGateView = () => `
    <div class="gn-card" style="text-align:center;padding:34px 20px">
      <div style="font-size:40px">🔐</div>
      <h3 style="margin:12px 0 6px;font-size:16px;color:#10352a">${esc(t('tokenTitle'))}</h3>
      <p style="font-size:12.5px;color:#8a988f;margin:0 0 16px;line-height:1.6">${esc(t('tokenBody'))}</p>
      <input id="gnTokInput" class="gn-input" type="password" placeholder="${esc(t('tokenPh'))}" style="margin-bottom:12px">
      <button class="gn-btn" onclick="window.__gnVerify()">${esc(t('verify'))}</button>
      <div id="gnTokError" style="font-size:12px;color:#b42318;min-height:16px;margin-top:10px"></div>
    </div>`;

  const render = async () => {
    const app = document.getElementById('app');
    if (!app) return;
    app.classList.add('no-nav');
    const navRoot = document.getElementById('navRoot');
    if (navRoot) navRoot.innerHTML = '';
    let body;
    if (!tok()) body = tokenGateView();
    else if (state.view === 'create') body = createView();
    else body = centerView();
    app.innerHTML = styles() + `<div class="page" data-admission-component="route-notif-admin">
      <div class="gn-root">
        <div class="gn-head">
          <button class="gn-back" onclick="window.__gnBack()" aria-label="${esc(t('back'))}">←</button>
          <div class="gn-title">🔔 ${esc(t('title'))}</div>
          ${tok() ? `<button class="gn-logout" onclick="window.__gnLogout()">${esc(t('logout'))}</button>` : ''}
        </div>
        ${body}
      </div>
    </div>`;
    window.scrollTo(0, 0);
  };

  const reRender = () => render().catch(() => {});

  /* ── center data ────────────────────────────────────────────────────────── */
  const loadUsage = async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch('/api/files/usage', { credentials: 'include', signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) state.usage = await res.json();
    } catch (_) { /* meter is optional */ }
  };
  const loadCenter = async () => {
    const out = await api('/api/notifications/history');
    if (!out.ok) { state.error = t('errGeneric'); reRender(); return; }
    state.history = out.data.items || [];
    state.reachEstimate = Number(out.data.reachEstimate || 0);
    await loadUsage();
    reRender();
  };

  /* ── actions ────────────────────────────────────────────────────────────── */
  window.__gnVerify = async () => {
    const input = document.getElementById('gnTokInput');
    const errEl = document.getElementById('gnTokError');
    const value = (input && input.value ? input.value : '').trim();
    if (!value) return;
    setTok(value);
    const out = await api('/api/notifications/history');
    if (out.ok) {
      state.history = out.data.items || [];
      state.reachEstimate = Number(out.data.reachEstimate || 0);
      reRender();
    } else {
      setTok('');
      const msg = out.status === 403 ? t('badToken') : (out.status === 503 ? t('notReady') : t('networkErr'));
      if (errEl) errEl.textContent = msg;
      input && input.focus();
    }
  };
  window.__gnLogout = () => { setTok(''); state.view = 'center'; reRender(); };
  window.__gnBack = () => { try { if (typeof window.navigate === 'function') window.navigate('dashboard'); else location.hash = 'dashboard'; } catch (_) { location.hash = 'dashboard'; } };
  window.__gnGoCreate = async () => {
    state.view = 'create';
    state.error = '';
    if (!state.templates.length) {
      const out = await api('/api/notifications/templates');
      if (out.ok) state.templates = out.data.templates || [];
    }
    reRender();
  };
  window.__gnGoCenter = () => { state.view = 'center'; loadCenter(); };
  window.__gnSetType = (k) => { state.type = k; state.templateKey = ''; reRender(); };
  window.__gnSetAudience = (k) => { state.audience = k; reRender(); };
  window.__gnSetTemplate = (key) => { applyTemplate(key); reRender(); };
  window.__gnSetMode = (m) => { state.mode = m; reRender(); };
  window.__gnField = (field, value) => { state[field] = value; reRender(); };

  window.__gnCancel = async (id) => {
    const out = await api('/api/notifications/global/cancel', { method: 'POST', body: JSON.stringify({ id }) });
    if (out.ok) {
      try { window.toast?.(t('cancelledOk')); } catch (_) {}
      loadCenter();
    } else {
      try { window.toast?.(t('errGeneric')); } catch (_) {}
    }
  };

  /* Send confirmation (spec §10): audience + estimated reach before firing. */
  window.__gnConfirmSend = () => {
    const title = state.title.trim();
    const body = state.body.trim();
    if (!title || !body) { state.error = t('errGeneric'); reRender(); return; }
    let whenMs = null;
    if (state.mode === 'schedule') {
      whenMs = state.when ? new Date(state.when).getTime() : NaN;
      if (!Number.isFinite(whenMs) || whenMs <= Date.now() + 60_000) { state.error = t('errGeneric'); reRender(); return; }
    }
    const confirm = document.createElement('div');
    confirm.className = 'gn-center-confirm';
    confirm.id = 'gnConfirm';
    confirm.innerHTML = `<div class="gn-center-confirm-card">
      <h3>${esc(t('confirmTitle'))}</h3>
      <div class="gn-confirm-row"><span>${esc(t('confirmAudience'))}</span><b>${esc(t(state.audience, I18N.audiences[state.audience] || {}))}</b></div>
      <div class="gn-confirm-row"><span>${esc(t('confirmReach'))}</span><b>≈ ${state.reachEstimate} ${esc(t('reachWord'))}</b></div>
      <div class="gn-confirm-row"><span>${esc(t('confirmTime'))}</span><b>${state.mode === 'now' ? esc(t('now')) : esc(fmtWhen(whenMs))}</b></div>
      <div class="gn-confirm-actions">
        <button class="gn-btn gn-btn-ghost" onclick="document.getElementById('gnConfirm')?.remove()">${esc(t('cancelBtn'))}</button>
        <button class="gn-btn" id="gnConfirmGo">${esc(t('confirmSend'))}</button>
      </div>
    </div>`;
    document.body.appendChild(confirm);
    document.getElementById('gnConfirmGo').addEventListener('click', async () => {
      const btn = document.getElementById('gnConfirmGo');
      if (btn) btn.disabled = true;
      state.busy = true;
      reRender();
      const payload = {
        type: state.type,
        title,
        body,
        imageUrl: state.imageUrl.trim(),
        targetUrl: state.targetUrl.trim(),
        audience: state.audience
      };
      if (state.mode === 'schedule') payload.scheduledAt = whenMs;
      const path = state.mode === 'schedule' ? '/api/notifications/global/schedule' : '/api/notifications/global/send';
      const out = await api(path, { method: 'POST', body: JSON.stringify(payload) });
      document.getElementById('gnConfirm')?.remove();
      state.busy = false;
      if (out.ok) {
        try { window.toast?.(state.mode === 'schedule' ? t('scheduledOk') : t('sentOk')); } catch (_) {}
        state.title = ''; state.body = ''; state.imageUrl = ''; state.targetUrl = ''; state.when = ''; state.templateKey = '';
        state.view = 'center';
        loadCenter();
      } else {
        state.error = out.status === 409 ? t('errDuplicate') : (out.status === 429 ? t('errRate') : t('errGeneric'));
        reRender();
      }
    });
  };

  window.renderNotificationAdmin = function renderNotificationAdmin() {
    (async () => {
      if (tok() && state.view === 'center' && !state.history.length) await loadCenter();
      render();
    })().catch(() => {});
  };
})();
