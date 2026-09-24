/* Notification Studio — premium admin console (owner redesign 2026-09-24).
 *
 * Redesign goals (owner report: "noisy", "buttons don't work"):
 *   • Structure — one job per tab (Compose / Queue / Sent) instead of one long
 *     scroll where every field shouts at once.
 *   • Calm — line-bordered cards, an 8px spacing grid, two type weights, and
 *     SVG line icons. Zero emoji in the chrome (the old panel was emoji-led).
 *   • Obvious state — every action shows a spinner in place, a toast on
 *     success, and an inline reason on failure. Buttons read honestly: queue
 *     counts, disabled-while-busy, explicit errors.
 *   • Advanced fields (image, deep link) stay collapsed until asked.
 *
 * Hidden route #notif-admin. Auth = ADMIN_TOKEN as Bearer, kept in
 * sessionStorage for this browser session only (never localStorage, never the
 * URL); every call is re-verified server-side.
 *
 * Dual language: bn + en written, only the active one is rendered (AhI18n).
 */
(() => {
  'use strict';

  /* ── copy ──────────────────────────────────────────────────────────────── */
  const I18N = {
    title: { bn: 'নোটিফিকেশন স্টুডিও', en: 'Notification Studio' },
    tabCompose: { bn: 'লিখুন', en: 'Compose' },
    tabQueue: { bn: 'কিউ', en: 'Queue' },
    tabSent: { bn: 'পাঠানো', en: 'Sent' },
    audience: { bn: 'কাদের কাছে', en: 'Audience' },
    typeLabel: { bn: 'ধরন', en: 'Type' },
    templateLabel: { bn: 'টেমপ্লেট', en: 'Template' },
    templateNone: { bn: 'নিজে লিখুন', en: 'Write my own' },
    titleLabel: { bn: 'শিরোনাম', en: 'Title' },
    titlePh: { bn: 'যেমন: নতুন লেসন এসেছে', en: 'e.g. A new lesson is available' },
    bodyLabel: { bn: 'বার্তা', en: 'Message' },
    bodyPh: { bn: 'সংক্ষেপে দুই-তিন লাইনে লিখুন…', en: 'Two or three short lines…' },
    advanced: { bn: 'অতিরিক্ত অপশন', en: 'Advanced options' },
    advancedHint: { bn: 'ছবি ও লিংক', en: 'Image and link' },
    imageUpload: { bn: 'ছবি বাছুন', en: 'Choose photo' },
    imageOr: { bn: 'অথবা ছবির লিংক দিন', en: 'or paste an image link' },
    imageUploading: { bn: 'আপলোড হচ্ছে…', en: 'Uploading…' },
    imageTooLarge: { bn: 'ছবি অনেক বড় — ৪ MB-এর নিচে দিন', en: 'Image too large — keep it under 4 MB' },
    imageBadType: { bn: 'শুধু JPG / PNG / WebP ছবি চলবে', en: 'Only JPG / PNG / WebP images' },
    imageUploadFailed: { bn: 'ছবি আপলোড হয়নি — আবার চেষ্টা করুন', en: 'Image upload failed — please try again' },
    imageRemove: { bn: 'সরান', en: 'Remove' },
    imageLogoTip: { bn: 'পুশে দেখানো app logo বদলাতে শুধু icons/icon-192.png ফাইলটি বদলান — নতুন পুশে নিজে থেকেই আসবে।', en: 'To change the app logo in notifications, replace icons/icon-192.png — every new push picks it up automatically.' },
    linkLabel: { bn: 'ক্লিকে কোন পেজ খুলবে', en: 'Page to open on tap' },
    linkPh: { bn: '/dashboard', en: '/dashboard' },
    previewLabel: { bn: 'যেভাবে দেখাবে', en: 'Preview' },
    appName: { bn: 'Admission Hub', en: 'Admission Hub' },
    sendNow: { bn: 'এখনই পাঠান', en: 'Send now' },
    scheduleBtn: { bn: 'সময় দিয়ে পাঠান', en: 'Schedule' },
    schedulePick: { bn: 'কখন পাঠাবেন (Asia/Dhaka — বাংলাদেশ সময়)', en: 'When to send (Asia/Dhaka — Bangladesh time)' },
    scheduleConfirm: { bn: 'সেট করুন', en: 'Set' },
    sendConfirmTitle: { bn: 'পাঠানো নিশ্চিত করুন', en: 'Confirm send' },
    confirmAudience: { bn: 'কাদের কাছে', en: 'Audience' },
    confirmReach: { bn: 'পৌঁছাবে', en: 'Reaches' },
    confirmTime: { bn: 'সময়', en: 'Time' },
    devices: { bn: 'ডিভাইস', en: 'devices' },
    cancel: { bn: 'বাতিল', en: 'Cancel' },
    confirmSend: { bn: 'হ্যাঁ, পাঠান', en: 'Yes, send' },
    queueEmpty: { bn: 'কিউতে কিছু নেই', en: 'Nothing in the queue' },
    queueEmptyHint: { bn: 'সময় দিয়ে পাঠানো নোটিফিকেশন এখানে দেখা যাবে।', en: 'Scheduled notifications show up here.' },
    sentEmpty: { bn: 'এখনো কিছু পাঠানো হয়নি', en: 'Nothing sent yet' },
    sentEmptyHint: { bn: 'একবার পাঠালে এখানে ইতিহাস থাকবে।', en: 'Your history appears here after the first send.' },
    sendsIn: { bn: 'পাঠাবে', en: 'sends in' },
    sent: { bn: 'পাঠানো হয়েছে', en: 'Sent' },
    scheduled: { bn: 'সময় বাকি', en: 'Scheduled' },
    cancelled: { bn: 'বাতিল', en: 'Cancelled' },
    failed: { bn: 'ব্যর্থ', en: 'Failed' },
    sending: { bn: 'পাঠানো হচ্ছে…', en: 'Sending…' },
    cancelSchedule: { bn: 'বাতিল করুন', en: 'Cancel' },
    clicks: { bn: 'ক্লিক', en: 'clicks' },
    perfTitle: { bn: 'পারফরম্যান্স', en: 'Performance' },
    perfSent: { bn: 'পাঠানো', en: 'Sent' },
    perfDelivered: { bn: 'পৌঁছেছে', en: 'Delivered' },
    perfOpened: { bn: 'খোলা', en: 'Opened' },
    perfClicked: { bn: 'ক্লিক', en: 'Clicked' },
    perfFailed: { bn: 'ব্যর্থ', en: 'Failed' },
    perfInvalid: { bn: 'মৃত টোকেন', en: 'Invalid tokens' },
    perfCtr: { bn: 'CTR', en: 'CTR' },
    perfEngagement: { bn: 'এনগেজমেন্ট', en: 'Engagement' },
    errDuplicate: { bn: 'একই নোটিফিকেশন আগেই পাঠানো/শিডিউল করা আছে (১০ দিনের সুরক্ষা)।', en: 'This notification was already sent or scheduled (10-day protection).' },
    errRate: { bn: 'আজকের সীমা শেষ — কাল আবার চেষ্টা করুন।', en: 'Daily limit reached — try again tomorrow.' },
    errGeneric: { bn: 'পাঠানো যায়নি — আবার চেষ্টা করুন।', en: 'Could not send — please try again.' },
    sentOk: { bn: 'নোটিফিকেশন পাঠানো হয়েছে', en: 'Notification sent' },
    scheduledOk: { bn: 'সময় ঠিক করা হয়েছে', en: 'Scheduled' },
    cancelledOk: { bn: 'বাতিল করা হয়েছে', en: 'Cancelled' },
    needTitle: { bn: 'একটি শিরোনাম দিন', en: 'Add a title' },
    needBody: { bn: 'একটি বার্তা লিখুন', en: 'Write a message' },
    needTime: { bn: 'অন্তত ২ মিনিট পরে একটি সময় দিন', en: 'Pick a time at least 2 minutes ahead' },
    logout: { bn: 'লগ আউট', en: 'Log out' },
    back: { bn: 'ফিরে যান', en: 'Go back' },
    tokenTitle: { bn: 'অ্যাডমিন যাচাই', en: 'Admin verification' },
    tokenBody: { bn: 'এই অংশে ঢুকতে ADMIN token দিন। এটি শুধু এই ব্রাউজার সেশনে থাকে — কোথাও সেভ হয় না।', en: 'Enter the ADMIN token to open this section. It stays in this browser session only — never saved.' },
    tokenPh: { bn: 'ADMIN_TOKEN', en: 'ADMIN_TOKEN' },
    verify: { bn: 'যাচাই করুন', en: 'Verify' },
    badToken: { bn: 'টোকেন ঠিক নয় — আবার চেষ্টা করুন', en: 'Incorrect token — please try again' },
    notReady: { bn: 'এখনো তৈরি নয় — একটু পরে চেষ্টা করুন', en: 'Not ready yet — please try again in a moment' },
    networkErr: { bn: 'সংযোগ সমস্যা — ইন্টারনেট দেখে আবার চেষ্টা করুন', en: 'Connection problem — check your internet and try again' },
    reach: { bn: 'পৌঁছাবে প্রায়', en: 'Reaches about' },
    todayLeft: { bn: 'আজ আর পাঠাতে পারবেন', en: 'Left today' },
    ofCap: { bn: 'টি', en: '' }
  };

  const lang = () => { try { return window.AhI18n ? window.AhI18n.get() : 'bn'; } catch (_) { return 'bn'; } };
  const t = (key, extra) => {
    const e = extra || I18N[key];
    return (e && e[lang()]) || (e && e.bn) || key;
  };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /* ── inline SVG line icons (no emoji — the old chrome was emoji-led) ────── */
  const ICON = {
    compose: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    queue: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    sent: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>'
  };
  const icon = (name, size = 18) =>
    `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ''}</svg>`;

  /* ── admin session (sessionStorage only) + bounded API client ──────────── */
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
      return d.toLocaleString(L, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (_) { return String(ts); }
  };
  /* "sends in 2h 14m" — a queue item is far more legible with a countdown. */
  const fmtCountdown = (ts) => {
    const ms = Number(ts) - Date.now();
    if (!Number.isFinite(ms)) return '—';
    if (ms <= 0) return t('sent');
    const mins = Math.round(ms / 60000);
    const h = Math.floor(mins / 60), m = mins % 60;
    const hUnit = lang() === 'bn' ? 'ঘ' : 'h';
    const mUnit = lang() === 'bn' ? 'মি' : 'm';
    return `${t('sendsIn')} ${h ? `${h}${hUnit} ` : ''}${m}${mUnit}`;
  };

  /* ── composer state ────────────────────────────────────────────────────── */
  const state = {
    history: [],
    analytics: null,
    reachEstimate: 0,
    dailyCap: 10,
    templates: [],
    tab: 'compose',        // compose | queue | sent
    type: 'announcement',
    audience: 'all_students',
    templateKey: '',
    title: '',
    body: '',
    imageUrl: '',
    imageUploading: false,
    targetUrl: '',
    advancedOpen: false,
    scheduleOpen: false,
    when: '',
    busy: false,
    error: '',
    errorReason: ''
  };

  const TYPES = {
    'new-content': { bn: 'নতুন কনটেন্ট', en: 'New content' },
    'announcement': { bn: 'ঘোষণা', en: 'Announcement' },
    'new-feature': { bn: 'নতুন ফিচার', en: 'New feature' },
    'challenge': { bn: 'চ্যালেঞ্জ', en: 'Challenge' },
    'course': { bn: 'কোর্স', en: 'Course' },
    'important': { bn: 'জরুরি', en: 'Important' }
  };
  const AUDIENCES = {
    all_students: { bn: 'সব শিক্ষার্থী', en: 'All students' },
    beginner: { bn: 'বিগিনার', en: 'Beginner' },
    intermediate: { bn: 'ইন্টারমিডিয়েট', en: 'Intermediate' },
    pro: { bn: 'প্রো', en: 'Pro' },
    course_subscribers: { bn: 'কোর্স শিক্ষার্থী', en: 'Course subscribers' }
  };
  const typeName = (k) => { const e = TYPES[k] || { bn: k, en: k }; return (e && e[lang()]) || e.bn; };
  const audienceName = (k) => { const e = AUDIENCES[k] || { bn: k, en: k }; return (e && e[lang()]) || e.bn; };

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

  /* ── styles: one calm system. 8px grid, 2 radii, line borders, no emoji ── */
  const styles = () => `<style>
  .ns-root{max-width:620px;margin:0 auto;padding:0 16px calc(96px + var(--safe-b,0px));color:var(--text);}
  .ns-head{position:sticky;top:0;z-index:6;padding:12px 0 10px;background:linear-gradient(to bottom,var(--bg) 78%,transparent);}
  .ns-head-row{display:flex;align-items:center;gap:10px;}
  .ns-iconbtn{width:38px;height:38px;flex:0 0 auto;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--text);display:grid;place-items:center;cursor:pointer;}
  .ns-iconbtn:active{transform:scale(.96);}
  .ns-title{flex:1;min-width:0;font-size:17px;font-weight:600;letter-spacing:-.2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .ns-tabs{display:flex;gap:4px;margin-top:12px;padding:4px;background:var(--mint,#e7f4ee);border-radius:14px;}
  .ns-tab{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;border:none;background:none;color:var(--sub);font:inherit;font-size:13px;font-weight:600;padding:9px 6px;border-radius:11px;cursor:pointer;}
  .ns-tab.active{background:var(--card);color:var(--emerald);box-shadow:0 1px 3px rgba(0,0,0,.06);}
  .ns-badge{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--emerald);color:#fff;font-size:11px;font-weight:700;display:inline-grid;place-items:center;}
  .ns-sec{margin-top:18px;}
  .ns-label{display:block;font-size:12px;font-weight:600;color:var(--sub);margin:0 0 8px;}
  .ns-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;}
  .ns-card+.ns-card{margin-top:10px;}
  .ns-perf-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:13px;}
  .ns-stat{background:var(--bg,#f6f8f7);border:1px solid var(--line);border-radius:12px;padding:10px 8px;text-align:center;display:flex;flex-direction:column;gap:1px;}
  .ns-stat b{font-size:19px;font-weight:800;color:#0c3b2a;line-height:1.1;}
  .ns-stat span{font-size:10.5px;font-weight:700;color:#7b8a83;text-transform:uppercase;letter-spacing:.02em;}
  .ns-stat small{font-size:10px;color:#9aa8a1;}
  .ns-row{display:flex;align-items:center;gap:12px;}
  .ns-row-main{flex:1;min-width:0;}
  .ns-row-top{display:flex;align-items:center;gap:8px;margin-bottom:4px;}
  .ns-row-title{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .ns-row-sub{font-size:12.5px;color:var(--sub);line-height:1.5;}
  .ns-avatar{width:38px;height:38px;flex:0 0 auto;border-radius:12px;background:var(--mint,#e7f4ee);color:var(--emerald);display:grid;place-items:center;}
  .ns-input{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:12px;background:var(--bg);padding:12px 13px;font-size:15px;font-family:inherit;color:var(--text);}
  .ns-input::placeholder{color:var(--sub);opacity:.75;}
  .ns-input:focus{outline:none;border-color:var(--emerald);box-shadow:0 0 0 3px rgba(15,107,79,.13);}
  .ns-textarea{resize:vertical;min-height:96px;line-height:1.55;}
  .ns-chips{display:flex;flex-wrap:wrap;gap:8px;}
  .ns-chip{border:1px solid var(--line);background:var(--card);border-radius:11px;padding:9px 13px;font:inherit;font-size:13.5px;font-weight:600;color:var(--text);cursor:pointer;}
  .ns-chip.active{border-color:var(--emerald);background:var(--mint,#e7f4ee);color:var(--emerald);}
  .ns-select{width:100%;box-sizing:border-box;appearance:none;border:1px solid var(--line);border-radius:12px;background:var(--bg);padding:12px 38px 12px 13px;font:inherit;font-size:14px;color:var(--text);cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7370' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 13px center;}
  .ns-adv-btn{width:100%;display:flex;align-items:center;gap:10px;border:1px solid var(--line);background:var(--card);border-radius:14px;padding:14px 15px;font:inherit;font-size:14px;font-weight:600;color:var(--text);cursor:pointer;text-align:left;}
  .ns-adv-btn .chev{margin-left:auto;color:var(--sub);display:grid;place-items:center;transition:transform .18s;}
  .ns-adv-btn.open .chev{transform:rotate(180deg);}
  .ns-adv-btn small{font-size:12px;font-weight:400;color:var(--sub);}
  .ns-adv-body{padding-top:12px;animation:ns-in .18s ease;}
  @keyframes ns-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
  .ns-imgrow{display:flex;}
  .ns-imgbtn{position:relative;flex:1;display:flex;align-items:center;justify-content:center;gap:8px;border:1.5px dashed var(--emerald);background:var(--mint,#e7f4ee);color:var(--emerald);font-size:13.5px;font-weight:600;border-radius:12px;padding:13px;cursor:pointer;}
  .ns-imgbtn input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;}
  .ns-imgbtn.busy{opacity:.6;border-style:solid;}
  .ns-imgprev{position:relative;margin-bottom:10px;}
  .ns-imgprev img{width:100%;border-radius:12px;display:block;max-height:200px;object-fit:cover;border:1px solid var(--line);}
  .ns-imgdel{position:absolute;top:8px;right:8px;display:flex;align-items:center;gap:5px;border:none;background:rgba(12,59,42,.82);color:#fff;font:inherit;font-size:12px;font-weight:600;border-radius:9px;padding:7px 10px;cursor:pointer;}
  .ns-tip{font-size:11.5px;color:var(--sub);line-height:1.6;margin-top:10px;}
  .ns-preview{margin-top:6px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;}
  .ns-preview-top{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--sub);margin-bottom:9px;}
  .ns-preview-top img{width:18px;height:18px;border-radius:5px;}
  .ns-preview-top b{color:var(--sub);font-weight:600;}
  .ns-preview-top .time{margin-left:auto;}
  .ns-preview-img{width:100%;border-radius:11px;margin-bottom:9px;display:block;max-height:180px;object-fit:cover;}
  .ns-preview-title{display:block;font-size:14.5px;font-weight:600;color:var(--text);margin-bottom:3px;word-break:break-word;}
  .ns-preview-body{margin:0;font-size:13px;color:var(--sub);line-height:1.55;word-break:break-word;}
  .ns-preview-link{margin-top:8px;display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--emerald);font-weight:600;}
  .ns-actions{position:fixed;left:0;right:0;bottom:0;z-index:7;padding:12px 16px calc(14px + var(--safe-b,0px));background:linear-gradient(to top,var(--bg) 72%,transparent);}
  .ns-actions-inner{max-width:620px;margin:0 auto;display:flex;gap:10px;}
  .ns-btn{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;border:none;background:var(--emerald);color:#fff;font:inherit;font-size:14.5px;font-weight:600;border-radius:14px;padding:14px 16px;cursor:pointer;min-height:50px;}
  .ns-btn:active{transform:scale(.985);}
  .ns-btn:disabled{opacity:.55;cursor:default;}
  .ns-btn.secondary{background:var(--card);color:var(--emerald);border:1.5px solid var(--emerald);}
  .ns-btn.ghost{background:var(--card);color:var(--text);border:1px solid var(--line);}
  .ns-spin{width:16px;height:16px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:ns-rot .7s linear infinite;}
  @keyframes ns-rot{to{transform:rotate(360deg)}}
  .ns-status{display:inline-flex;align-items:center;font-size:11px;font-weight:600;border-radius:999px;padding:3px 9px;white-space:nowrap;}
  .ns-status.sent{background:rgba(30,142,90,.14);color:var(--green,#1e8e5a);}
  .ns-status.scheduled{background:rgba(201,138,44,.16);color:var(--orange,#c98a2c);}
  .ns-status.cancelled{background:var(--line);color:var(--sub);}
  .ns-status.failed{background:rgba(192,57,43,.14);color:var(--red,#c0392b);}
  .ns-status.sending{background:rgba(15,107,79,.14);color:var(--emerald);}
  .ns-empty{text-align:center;padding:44px 18px;color:var(--sub);}
  .ns-empty .ico{color:var(--line);}
  .ns-empty b{display:block;margin-top:12px;font-size:14px;font-weight:600;color:var(--text);}
  .ns-empty p{margin:6px 0 0;font-size:12.5px;line-height:1.6;}
  .ns-err{display:flex;align-items:flex-start;gap:9px;background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.26);color:var(--red,#c0392b);font-size:13px;border-radius:13px;padding:12px 13px;margin-top:12px;line-height:1.55;}
  .ns-err .ico{flex:0 0 auto;margin-top:1px;}
  .ns-meta{display:flex;flex-wrap:wrap;gap:12px;font-size:11.5px;color:var(--sub);margin-top:6px;align-items:center;}
  .ns-meta span{display:inline-flex;align-items:center;gap:4px;}
  .ns-mini{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--card);color:var(--red,#c0392b);font:inherit;font-size:12px;font-weight:600;border-radius:10px;padding:8px 11px;cursor:pointer;}
  /* keyboard-inset keeps the card above the on-screen keyboard: a fixed sheet
   * is laid out against the full viewport, so without this the card centres
   * behind the keyboard and its focused field is unreachable. */
  .ns-sheet{position:fixed;inset:0;z-index:2000;background:rgba(12,59,42,.42);display:grid;place-items:center;padding:20px 20px calc(20px + var(--keyboard-inset,0px));overflow-y:auto;animation:ns-in .15s ease;}
  .ns-sheet-card{max-height:calc(100% - 4px);overflow-y:auto;-webkit-overflow-scrolling:touch;}
  .ns-sheet-card{background:var(--card);border-radius:18px;padding:20px;width:100%;max-width:360px;color:var(--text);}
  .ns-sheet-card h3{margin:0 0 4px;font-size:16.5px;font-weight:600;}
  .ns-sheet-card .sub{margin:0 0 14px;font-size:12.5px;color:var(--sub);word-break:break-word;}
  .ns-kv{display:flex;justify-content:space-between;gap:12px;font-size:13.5px;padding:9px 0;border-bottom:1px solid var(--line);}
  .ns-kv:last-of-type{border-bottom:none;}
  .ns-kv span{color:var(--sub);}
  .ns-kv b{font-weight:600;text-align:right;}
  .ns-sheet-actions{display:flex;gap:10px;margin-top:16px;}
  .ns-sheet-actions .ns-btn{min-height:46px;font-size:14px;}
  .ns-gate{text-align:center;padding:30px 22px;}
  .ns-gate .ns-avatar{width:52px;height:52px;margin:0 auto;border-radius:16px;}
  .ns-gate h3{margin:14px 0 6px;font-size:16px;font-weight:600;}
  .ns-gate p{font-size:12.5px;color:var(--sub);line-height:1.6;margin:0 0 16px;}
  </style>`;

  /* ── shared builders ───────────────────────────────────────────────────── */
  const statusChip = (status) => {
    const label = { sent: t('sent'), scheduled: t('scheduled'), cancelled: t('cancelled'), failed: t('failed'), sending: t('sending') }[status] || status;
    return `<span class="ns-status ${esc(status)}">${esc(label)}</span>`;
  };

  const queueItem = (row) => `<div class="ns-card">
    <div class="ns-row">
      <div class="ns-avatar">${icon('queue', 19)}</div>
      <div class="ns-row-main">
        <div class="ns-row-top"><span class="ns-row-title">${esc(row.title)}</span>${statusChip(row.status)}</div>
        <div class="ns-row-sub">${esc(audienceName(row.audience))} · ${esc(fmtCountdown(row.scheduledAt))}</div>
        <div class="ns-meta"><span>${icon('clock', 13)} ${esc(fmtWhen(row.scheduledAt))}</span></div>
      </div>
    </div>
    <div style="margin-top:12px"><button class="ns-mini" onclick="window.__nsCancel('${esc(row.id)}')">${icon('trash', 14)} ${esc(t('cancelSchedule'))}</button></div>
  </div>`;

  const sentItem = (row) => {
    const when = row.sentAt || row.createdAt;
    return `<div class="ns-card">
    <div class="ns-row">
      <div class="ns-avatar">${icon('sent', 18)}</div>
      <div class="ns-row-main">
        <div class="ns-row-top"><span class="ns-row-title">${esc(row.title)}</span>${statusChip(row.status)}</div>
        <div class="ns-row-sub">${esc(audienceName(row.audience))} · ${esc(fmtWhen(when))}</div>
        <div class="ns-meta">
          ${row.reachEstimate != null ? `<span>${icon('users', 13)} ≈ ${row.reachEstimate} ${esc(t('devices'))}</span>` : ''}
          <span>${icon('check', 13)} ${row.clicks} ${esc(t('clicks'))}</span>
        </div>
      </div>
    </div>
  </div>`;
  };

  const previewHtml = () => {
    const now = new Date();
    const L = lang() === 'bn' ? 'bn-BD' : 'en-GB';
    return `<div class="ns-preview">
      <div class="ns-preview-top"><img src="./icons/icon-192.png" alt=""><b>${esc(t('appName'))}</b><span class="time">${esc(now.toLocaleTimeString(L, { hour: '2-digit', minute: '2-digit' }))}</span></div>
      ${state.imageUrl ? `<img class="ns-preview-img" src="${esc(state.imageUrl)}" alt="" loading="lazy">` : ''}
      <b class="ns-preview-title" id="nsPrevTitle">${esc(state.title || '…')}</b>
      <p class="ns-preview-body" id="nsPrevBody">${esc(state.body || '…')}</p>
      <div class="ns-preview-link" id="nsPrevLink" style="${state.targetUrl ? '' : 'display:none'}">${icon('link', 13)} <span id="nsPrevLinkText">${esc(state.targetUrl)}</span></div>
    </div>`;
  };

  /* ── views ─────────────────────────────────────────────────────────────── */
  const composeView = () => {
    const reach = Number(state.reachEstimate || 0);
    const sentToday = state.history.filter(r => r.status === 'sent' && r.sentAt && new Date(r.sentAt).toDateString() === new Date().toDateString()).length;
    const left = Math.max(0, Number(state.dailyCap || 0) - sentToday);
    return `
    <div class="ns-sec">
      <span class="ns-label">${esc(t('audience'))}</span>
      <div class="ns-card">
        <div class="ns-row">
          <div class="ns-avatar">${icon('users', 19)}</div>
          <div class="ns-row-main">
            <div class="ns-row-title">${esc(audienceName(state.audience))}</div>
            <div class="ns-row-sub">${esc(t('reach'))} ≈ ${reach} ${esc(t('devices'))} · ${esc(t('todayLeft'))} ${left}</div>
          </div>
        </div>
        <div class="ns-chips" style="margin-top:13px">${Object.keys(AUDIENCES).map(k => `<button class="ns-chip ${state.audience === k ? 'active' : ''}" onclick="window.__nsSetAudience('${k}')">${esc(audienceName(k))}</button>`).join('')}</div>
      </div>
    </div>

    <div class="ns-sec">
      <span class="ns-label">${esc(t('typeLabel'))}</span>
      <div class="ns-chips">${Object.keys(TYPES).map(k => `<button class="ns-chip ${state.type === k ? 'active' : ''}" onclick="window.__nsSetType('${k}')">${esc(typeName(k))}</button>`).join('')}</div>
    </div>

    <div class="ns-sec">
      <span class="ns-label">${esc(t('templateLabel'))}</span>
      <select class="ns-select" onchange="window.__nsSetTemplate(this.value)">
        <option value="">${esc(t('templateNone'))}</option>
        ${state.templates.map(x => `<option value="${esc(x.key)}" ${state.templateKey === x.key ? 'selected' : ''}>${esc(typeName(x.type))}</option>`).join('')}
      </select>
    </div>

    <div class="ns-sec">
      <span class="ns-label">${esc(t('titleLabel'))}</span>
      <input id="nsTitle" class="ns-input" maxlength="120" placeholder="${esc(t('titlePh'))}" value="${esc(state.title)}" oninput="window.__nsLive('title', this.value)">
    </div>

    <div class="ns-sec">
      <span class="ns-label">${esc(t('bodyLabel'))}</span>
      <textarea id="nsBody" class="ns-input ns-textarea" maxlength="400" placeholder="${esc(t('bodyPh'))}" oninput="window.__nsLive('body', this.value)">${esc(state.body)}</textarea>
    </div>

    <div class="ns-sec">
      <button class="ns-adv-btn ${state.advancedOpen ? 'open' : ''}" onclick="window.__nsToggleAdvanced()">
        ${icon('image', 18)} ${esc(t('advanced'))} <small>${esc(t('advancedHint'))}</small> <span class="chev">${icon('chevron', 16)}</span>
      </button>
      ${state.advancedOpen ? `<div class="ns-adv-body">
        <div class="ns-card">
          ${state.imageUrl ? `<div class="ns-imgprev"><img src="${esc(state.imageUrl)}" alt=""><button class="ns-imgdel" onclick="window.__nsClearImage()">${icon('close', 13)} ${esc(t('imageRemove'))}</button></div>` : ''}
          <div class="ns-imgrow">
            <label class="ns-imgbtn ${state.imageUploading ? 'busy' : ''}">${icon('image', 17)} ${esc(state.imageUploading ? t('imageUploading') : t('imageUpload'))}
              <input type="file" accept="image/jpeg,image/png,image/webp" onchange="window.__nsPickImage(this)">
            </label>
          </div>
          <div style="height:11px"></div>
          <input class="ns-input" maxlength="500" placeholder="${esc(t('imageOr'))}" value="${esc(state.imageUrl)}" oninput="window.__nsLive('imageUrl', this.value)" inputmode="url">
          <div class="ns-tip">${esc(t('imageLogoTip'))}</div>
        </div>
        <div class="ns-card">
          <span class="ns-label">${esc(t('linkLabel'))}</span>
          <input class="ns-input" maxlength="200" placeholder="${esc(t('linkPh'))}" value="${esc(state.targetUrl)}" oninput="window.__nsLive('targetUrl', this.value)" inputmode="url">
        </div>
      </div>` : ''}
    </div>

    <div class="ns-sec">
      <span class="ns-label">${esc(t('previewLabel'))}</span>
      ${previewHtml()}
    </div>

    ${state.error ? `<div class="ns-err">${icon('close', 16)}<span>${esc(state.error)}${state.errorReason ? ` <b>[${esc(state.errorReason)}]</b>` : ''}</span></div>` : ''}

    ${state.scheduleOpen ? `<div class="ns-sheet" onclick="if(event.target===this)window.__nsCloseSchedule()">
      <div class="ns-sheet-card">
        <h3>${esc(t('scheduleBtn'))}</h3>
        <p class="sub">${esc(t('schedulePick'))}</p>
        <input id="nsWhen" type="datetime-local" class="ns-input" value="${esc(state.when)}" onchange="window.__nsField('when', this.value)">
        <div class="ns-sheet-actions">
          <button class="ns-btn ghost" onclick="window.__nsCloseSchedule()">${esc(t('cancel'))}</button>
          <button class="ns-btn" onclick="window.__nsConfirmSchedule()">${esc(t('scheduleConfirm'))}</button>
        </div>
      </div>
    </div>` : ''}`;
  };

  const centerView = () => {
    const queued = state.history.filter(r => r.status === 'scheduled');
    const sent = state.history.filter(r => r.status !== 'scheduled');
    if (state.tab === 'compose') return composeView();
    if (state.tab === 'queue') return queued.length
      ? queued.map(queueItem).join('')
      : `<div class="ns-empty">${icon('queue', 34)}<b>${esc(t('queueEmpty'))}</b><p>${esc(t('queueEmptyHint'))}</p></div>`;
    return (perfPanel() + (sent.length
      ? sent.map(sentItem).join('')
      : `<div class="ns-empty">${icon('sent', 34)}<b>${esc(t('sentEmpty'))}</b><p>${esc(t('sentEmptyHint'))}</p></div>`));
  };

  /* Phase 4 analytics: the funnel the blueprint asks to see, computed server-side
   * from the real rows. Hidden until there is at least one sent notification, so
   * an unused Admin Center is not cluttered with zeros. */
  const perfPanel = () => {
    const a = state.analytics;
    if (!a || !a.totals || !a.totals.sent) return '';
    const tt = a.totals;
    const stat = (label, value, sub) => `<div class="ns-stat">
      <b>${esc(String(value))}</b>
      <span>${esc(label)}</span>
      ${sub ? `<small>${esc(sub)}</small>` : ''}
    </div>`;
    return `<div class="ns-card ns-perf">
      <div class="ns-row">
        <div class="ns-avatar">${icon('check', 18)}</div>
        <div class="ns-row-main">
          <div class="ns-row-title">${esc(t('perfTitle'))}</div>
          <div class="ns-row-sub">${esc(t('perfCtr'))} ${tt.ctr}% · ${esc(t('perfEngagement'))} ${tt.engagement}%</div>
        </div>
      </div>
      <div class="ns-perf-grid">
        ${stat(t('perfSent'), tt.sent)}
        ${stat(t('perfDelivered'), tt.delivered)}
        ${stat(t('perfOpened'), tt.opened)}
        ${stat(t('perfClicked'), tt.clicked)}
        ${stat(t('perfFailed'), tt.failed)}
        ${stat(t('perfInvalid'), tt.invalidTokens)}
      </div>
    </div>`;
  };

  const tabsBar = () => {
    const queued = state.history.filter(r => r.status === 'scheduled').length;
    const items = [
      { key: 'compose', label: t('tabCompose'), ic: 'compose' },
      { key: 'queue', label: t('tabQueue'), ic: 'queue', badge: queued },
      { key: 'sent', label: t('tabSent'), ic: 'sent' }
    ];
    return `<div class="ns-tabs">${items.map(x => `<button class="ns-tab ${state.tab === x.key ? 'active' : ''}" onclick="window.__nsSetTab('${x.key}')">${icon(x.ic, 16)} ${esc(x.label)}${x.badge ? ` <span class="ns-badge">${x.badge}</span>` : ''}</button>`).join('')}</div>`;
  };

  const actionsBar = () => state.tab === 'compose' ? `<div class="ns-actions"><div class="ns-actions-inner">
    <button class="ns-btn secondary" onclick="window.__nsOpenSchedule()" ${state.busy ? 'disabled' : ''}>${icon('clock', 17)} ${esc(t('scheduleBtn'))}</button>
    <button class="ns-btn" id="nsSendNow" onclick="window.__nsConfirmSend()" ${state.busy ? 'disabled' : ''}>${state.busy ? '<span class="ns-spin"></span>' : icon('send', 17)} ${esc(t('sendNow'))}</button>
  </div></div>` : '';

  const tokenGateView = () => `<div class="ns-card ns-gate">
    <div class="ns-avatar">${icon('lock', 22)}</div>
    <h3>${esc(t('tokenTitle'))}</h3>
    <p>${esc(t('tokenBody'))}</p>
    <input id="nsTokInput" class="ns-input" type="password" placeholder="${esc(t('tokenPh'))}" style="margin-bottom:12px">
    <button class="ns-btn" id="nsVerifyBtn" onclick="window.__nsVerify()">${esc(t('verify'))}</button>
    <div id="nsTokError" style="font-size:12.5px;color:var(--red);min-height:16px;margin-top:10px"></div>
  </div>`;

  const render = async () => {
    const app = document.getElementById('app');
    if (!app) return;
    app.classList.add('no-nav');
    const navRoot = document.getElementById('navRoot');
    if (navRoot) navRoot.innerHTML = '';
    let body, actions = '';
    if (!tok()) body = tokenGateView();
    else { body = centerView(); actions = actionsBar(); }
    app.innerHTML = styles() + `<div class="page" data-admission-component="route-notif-admin">
      <div class="ns-root">
        <div class="ns-head">
          <div class="ns-head-row">
            <button class="ns-iconbtn" onclick="window.__nsBack()" aria-label="${esc(t('back'))}">${icon('back', 18)}</button>
            <div class="ns-title">${esc(t('title'))}</div>
            ${tok() ? `<button class="ns-iconbtn" onclick="window.__nsLogout()" aria-label="${esc(t('logout'))}">${icon('logout', 17)}</button>` : ''}
          </div>
          ${tok() ? tabsBar() : ''}
        </div>
        ${body}
      </div>
    </div>${actions}`;
    window.scrollTo(0, 0);
  };
  const reRender = () => render().catch(() => {});
  const toast = (msg) => { try { window.toast?.(msg); } catch (_) {} };

  /* ── data ──────────────────────────────────────────────────────────────── */
  const loadTemplates = async () => {
    if (state.templates.length) return;
    const out = await api('/api/notifications/templates');
    if (out.ok) state.templates = out.data.templates || [];
  };
  const loadCenter = async () => {
    const [hist, _tpl] = await Promise.all([api('/api/notifications/history'), loadTemplates()]);
    const out = hist;
    if (!out.ok) {
      state.error = t('errGeneric');
      state.errorReason = out.data && out.data.error ? String(out.data.error) : `HTTP ${out.status}`;
      reRender();
      return;
    }
    state.history = out.data.items || [];
    if (out.data.analytics) state.analytics = out.data.analytics;
    state.reachEstimate = Number(out.data.reachEstimate || 0);
    state.dailyCap = Number(out.data.dailyCap || 10);
    reRender();
  };

  /* ── image upload (phone → R2) ─────────────────────────────────────────── */
  const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const shrinkImage = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const max = 1200;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => { URL.revokeObjectURL(url); blob ? resolve(blob) : reject(new Error('encode-failed')); }, 'image/jpeg', 0.85);
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode-failed')); };
    img.src = url;
  });
  const uploadImage = async (file) => {
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) { state.error = t('imageBadType'); state.errorReason = ''; reRender(); return; }
    state.imageUploading = true; state.error = ''; state.errorReason = ''; reRender();
    try {
      let blob = file;
      try { blob = await shrinkImage(file); } catch (_) { blob = file; }
      if (blob.size > 4 * 1024 * 1024) { state.imageUploading = false; state.error = t('imageTooLarge'); reRender(); return; }
      const res = await fetch('/api/notifications/global/image', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${tok()}`, 'X-File-Ext': 'jpg' },
        body: blob
      });
      const data = await res.json().catch(() => ({}));
      state.imageUploading = false;
      if (res.ok && data.url) { state.imageUrl = data.url; state.error = ''; }
      else { state.error = t('imageUploadFailed'); state.errorReason = data && data.error ? String(data.error) : `HTTP ${res.status}`; }
    } catch (_) {
      state.imageUploading = false;
      state.error = t('imageUploadFailed');
    }
    reRender();
  };

  /* ── handlers ──────────────────────────────────────────────────────────── */
  window.__nsVerify = async () => {
    const input = document.getElementById('nsTokInput');
    const errEl = document.getElementById('nsTokError');
    const btn = document.getElementById('nsVerifyBtn');
    const value = (input && input.value ? input.value : '').trim();
    if (!value) return;
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="ns-spin"></span>'; }
    setTok(value);
    const out = await api('/api/notifications/history');
    if (out.ok) {
      state.history = out.data.items || [];
      state.reachEstimate = Number(out.data.reachEstimate || 0);
      state.dailyCap = Number(out.data.dailyCap || 10);
      reRender();
    } else {
      setTok('');
      if (btn) { btn.disabled = false; btn.textContent = t('verify'); }
      const msg = out.status === 403 ? t('badToken') : (out.status === 503 ? t('notReady') : t('networkErr'));
      if (errEl) errEl.textContent = msg;
      input && input.focus();
    }
  };
  window.__nsLogout = () => { setTok(''); state.tab = 'compose'; reRender(); };
  window.__nsBack = () => { try { if (typeof window.navigate === 'function') window.navigate('dashboard'); else location.hash = 'dashboard'; } catch (_) { location.hash = 'dashboard'; } };
  window.__nsSetTab = (key) => { state.tab = key; state.error = ''; reRender(); };
  window.__nsSetType = (k) => { state.type = k; state.templateKey = ''; reRender(); };
  window.__nsSetAudience = (k) => { state.audience = k; reRender(); };
  window.__nsSetTemplate = (key) => { applyTemplate(key); reRender(); };
  window.__nsToggleAdvanced = () => { state.advancedOpen = !state.advancedOpen; reRender(); };
  /* Typing must never rebuild the form: on mobile a re-render replaced the
   * focused input and the keyboard dropped after every keystroke. Text fields
   * only patch the preview in place. */
  window.__nsLive = (field, value) => {
    state[field] = value;
    const titleEl = document.getElementById('nsPrevTitle');
    const bodyEl = document.getElementById('nsPrevBody');
    const linkEl = document.getElementById('nsPrevLink');
    if (field === 'title' && titleEl) titleEl.textContent = value || '…';
    if (field === 'body' && bodyEl) bodyEl.textContent = value || '…';
    if (field === 'targetUrl' && linkEl) {
      const textEl = document.getElementById('nsPrevLinkText');
      if (textEl) textEl.textContent = value;
      linkEl.style.display = value ? '' : 'none';
    }
  };
  window.__nsField = (field, value) => { state[field] = value; reRender(); };
  window.__nsPickImage = (inputEl) => { const f = inputEl && inputEl.files && inputEl.files[0]; if (inputEl) inputEl.value = ''; uploadImage(f); };
  window.__nsClearImage = () => { state.imageUrl = ''; state.error = ''; reRender(); };

  window.__nsCancel = async (id) => {
    const out = await api('/api/notifications/global/cancel', { method: 'POST', body: JSON.stringify({ id }) });
    if (out.ok) { toast(t('cancelledOk')); loadCenter(); }
    else { toast(t('errGeneric') + (out.data && out.data.error ? ` [${out.data.error}]` : '')); }
  };

  window.__nsOpenSchedule = () => { state.scheduleOpen = true; state.error = ''; reRender(); };
  window.__nsCloseSchedule = () => { state.scheduleOpen = false; reRender(); };
  window.__nsConfirmSchedule = () => {
    const when = state.when ? new Date(state.when).getTime() : NaN;
    if (!Number.isFinite(when) || when <= Date.now() + 60_000) { state.scheduleOpen = false; state.error = t('needTime'); reRender(); return; }
    state.scheduleOpen = false;
    openConfirm(true, when);
  };

  /* Send confirmation — audience + reach + time before firing. */
  const openConfirm = (isSchedule, whenMs) => {
    const confirm = document.createElement('div');
    confirm.className = 'ns-sheet';
    confirm.id = 'nsConfirm';
    const reach = Number(state.reachEstimate || 0);
    confirm.innerHTML = `<div class="ns-sheet-card">
      <h3>${esc(t('sendConfirmTitle'))}</h3>
      <p class="sub">${esc(state.title.trim())}</p>
      <div class="ns-kv"><span>${esc(t('confirmAudience'))}</span><b>${esc(audienceName(state.audience))}</b></div>
      <div class="ns-kv"><span>${esc(t('confirmReach'))}</span><b>≈ ${reach} ${esc(t('devices'))}</b></div>
      <div class="ns-kv"><span>${esc(t('confirmTime'))}</span><b>${isSchedule ? esc(fmtWhen(whenMs)) : esc(t('sendNow'))}</b></div>
      <div class="ns-sheet-actions">
        <button class="ns-btn ghost" onclick="document.getElementById('nsConfirm')?.remove()">${esc(t('cancel'))}</button>
        <button class="ns-btn" id="nsConfirmGo">${esc(t('confirmSend'))}</button>
      </div>
    </div>`;
    document.body.appendChild(confirm);
    document.getElementById('nsConfirmGo').addEventListener('click', async () => {
      const btn = document.getElementById('nsConfirmGo');
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="ns-spin"></span>'; }
      state.busy = true;
      const payload = {
        type: state.type,
        title: state.title.trim(),
        body: state.body.trim(),
        imageUrl: state.imageUrl.trim(),
        targetUrl: state.targetUrl.trim(),
        audience: state.audience
      };
      if (isSchedule) payload.scheduledAt = whenMs;
      try { const own = await window.AhFcm?.getToken?.(); if (own) payload.deviceToken = own; } catch (_) {}
      const path = isSchedule ? '/api/notifications/global/schedule' : '/api/notifications/global/send';
      const out = await api(path, { method: 'POST', body: JSON.stringify(payload) });
      document.getElementById('nsConfirm')?.remove();
      state.busy = false;
      if (out.ok) {
        toast(isSchedule ? t('scheduledOk') : t('sentOk'));
        state.title = ''; state.body = ''; state.imageUrl = ''; state.targetUrl = ''; state.when = ''; state.templateKey = '';
        state.error = ''; state.errorReason = '';
        state.tab = isSchedule ? 'queue' : 'sent';
        loadCenter();
      } else {
        const reason = out.data && out.data.error ? String(out.data.error) : `HTTP ${out.status}`;
        state.error = out.status === 409 ? t('errDuplicate') : (out.status === 429 ? t('errRate') : t('errGeneric'));
        state.errorReason = reason;
        reRender();
      }
    });
  };

  window.__nsConfirmSend = () => {
    const title = state.title.trim();
    const body = state.body.trim();
    if (!title) { state.error = t('needTitle'); state.errorReason = ''; reRender(); return; }
    if (!body) { state.error = t('needBody'); state.errorReason = ''; reRender(); return; }
    state.error = ''; state.errorReason = '';
    openConfirm(false, null);
  };

  window.renderNotificationAdmin = function renderNotificationAdmin() {
    (async () => {
      if (tok() && !state.history.length) await loadCenter();
      else render();
    })().catch(() => {});
  };
})();
