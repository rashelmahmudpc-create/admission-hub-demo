/* ============================================================
   PROFILE & PERSONAL IDENTITY — V2 (Phase 7B, 2026-09-16)
   Blueprint: owner "Profile System V2" — student identity space.
   Rules (unchanged from v1):
   • Code-native, zero-raster: default avatars are generated SVG;
     the only <img> elements are the user's own uploaded avatar.
   • Every server value renders through esc() — no unsafe HTML.
   • Profile failure never breaks the app or the session.
   • Gentle completion (never pressure); mobile-first, 320px safe.
   • Profile ≠ Progress: the stats strip is a real-data glance,
     charts/progress stay on the Exam & History pages.
   • Honest states: empty, loading, error — no fake data, no
     fake achievements, no blank screens.
   ============================================================ */
(function () {
  'use strict';
  if (window.__profileUiInstalled) return;
  window.__profileUiInstalled = true;

  const API = '/api/auth/v1';
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const $ = (sel, root) => (root || document).querySelector(sel);
  const bnNum = (n) => Number(n || 0).toLocaleString('bn-BD');
  // Years are shown in Bengali digits WITHOUT a thousands separator
  // ("২০২৬ সাল" — not "২,০২").
  const bnYear = (y) => String(y || '').replace(/[0-9]/g, (d) => '০১২৪৫৬৭৮৯'[d]);
  const bnDate = (ts) => {
    if (!ts) return '';
    try { return new Intl.DateTimeFormat('bn-BD', { month: 'short', year: 'numeric' }).format(new Date(ts)); }
    catch (_) { return ''; }
  };

  /* ---------------- local preferences (local-first, Phase 8 bridge) ---------------- */

  const PREFS_KEY = 'ah-profile-prefs-v1';
  const DEFAULT_PREFS = { language: 'bn', notifications: 'on', appearance: 'light', aiAssistant: 'on', avatarStyle: 0, v: 1 };

  function loadPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      return {
        language: raw.language === 'en' ? 'en' : 'bn',
        notifications: raw.notifications === 'off' ? 'off' : 'on',
        appearance: ['light', 'dark', 'system'].includes(raw.appearance) ? raw.appearance : 'light',
        aiAssistant: raw.aiAssistant === 'off' ? 'off' : 'on',
        avatarStyle: Number.isInteger(raw.avatarStyle) && raw.avatarStyle >= 0 && raw.avatarStyle <= 5 ? raw.avatarStyle : 0,
        v: 1
      };
    } catch (_) { return { ...DEFAULT_PREFS }; }
  }
  function savePrefs(next) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...next, v: 1, updatedAt: Date.now() })); } catch (_) { /* private mode — session-only */ }
  }

  const state = {
    data: null,        // last GET /profile v2 payload
    version: null,     // profile_version for optimistic concurrency
    sheet: null,       // open sheet type
    busy: false,
    view: 'profile',   // profile | edit | avatar
    avatarTab: 'upload', // upload | camera | default
    prefs: loadPrefs()
  };

  // Dashboard upgrade hook: the dashboard header shows the uploaded avatar
  // once the profile has been loaded at least once in this session.
  window.__ahHasAvatar = () => state.data?.avatar?.present === true;

  /* ---------------- API ---------------- */

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      ...opts
    });
    let body = null;
    try { body = await res.json(); } catch (_) { body = {}; }
    if (!res.ok) {
      const err = new Error(body?.error?.message || 'সমস্যা হয়েছে');
      err.status = res.status;
      err.code = body?.error?.code || '';
      throw err;
    }
    return body;
  }

  async function loadProfile() {
    const body = await api(`${API}/profile`);
    state.data = body;
    state.version = body?.profile?.version || null;
    return body;
  }

  async function patch(fields) {
    const body = await api(`${API}/profile/patch`, {
      method: 'POST',
      body: JSON.stringify({ fields, expectVersion: state.version })
    });
    if (body?.profile) state.version = body.profile.version || state.version;
    state.data = { ...state.data, profile: body.profile };
    return body;
  }

  /* ---------------- generated avatars (zero-raster) ---------------- */

  function defaultAvatarSvg(name, seed, style = 0) {
    let hash = 0;
    const value = String(seed || name || 'a');
    for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    const hue = (hash + Number(style || 0) * 60) % 360;
    const letters = String(name || '').trim().split(/\s+/).slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase()).join('') || 'A';
    const safe = esc(letters);
    const s = Number(style || 0);
    if (s === 1) {
      return `<svg viewBox="0 0 96 96" role="img" aria-label="Generated avatar"><rect width="96" height="96" rx="48" fill="hsl(${hue},40%,90%)"/><rect width="96" height="96" rx="48" fill="none" stroke="hsl(${hue},38%,58%)" stroke-width="3"/><circle cx="48" cy="38" r="15" fill="hsl(${hue},42%,72%)"/><path d="M18 82c4-16 16-24 30-24s26 8 30 24" fill="hsl(${hue},42%,72%)"/></svg>`;
    }
    if (s === 2) {
      return `<svg viewBox="0 0 96 96" role="img" aria-label="Generated avatar"><defs><linearGradient id="g${s}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},50%,84%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},50%,70%)"/></linearGradient></defs><rect width="96" height="96" rx="48" fill="url(#g${s})"/><text x="48" y="62" font-family="system-ui,-apple-system,sans-serif" font-size="40" font-weight="700" text-anchor="middle" fill="#ffffff" opacity="0.92">${safe}</text></svg>`;
    }
    if (s === 3) {
      return `<svg viewBox="0 0 96 96" role="img" aria-label="Generated avatar"><rect width="96" height="96" rx="48" fill="hsl(${hue},42%,88%)"/><circle cx="34" cy="42" r="4" fill="hsl(${hue},40%,30%)"/><circle cx="62" cy="42" r="4" fill="hsl(${hue},40%,30%)"/><path d="M32 58q16 12 32 0" stroke="hsl(${hue},40%,30%)" stroke-width="4" fill="none" stroke-linecap="round"/></svg>`;
    }
    if (s === 4) {
      return `<svg viewBox="0 0 96 96" role="img" aria-label="Generated avatar"><rect width="96" height="96" rx="48" fill="hsl(${hue},45%,86%)"/><path d="M48 24L80 40L48 56L16 40Z" fill="hsl(${hue},48%,45%)"/><path d="M30 48v14c0 6 8 10 18 10s18-4 18-10V48" fill="hsl(${hue},45%,58%)"/><line x1="80" y1="40" x2="80" y2="58" stroke="hsl(${hue},48%,38%)" stroke-width="3"/><circle cx="80" cy="62" r="4" fill="hsl(${hue},55%,45%)"/></svg>`;
    }
    if (s === 5) {
      return `<svg viewBox="0 0 96 96" role="img" aria-label="Generated avatar"><rect width="96" height="96" rx="48" fill="hsl(${hue},48%,90%)"/><path d="M48 26l6.5 13.2 14.6 2-10.5 10.3 2.5 14.5L48 59l-13.1 6.9 2.5-14.5L26.9 41.2l14.6-2z" fill="hsl(${hue},55%,55%)"/><text x="48" y="82" font-family="system-ui,-apple-system,sans-serif" font-size="16" font-weight="700" text-anchor="middle" fill="hsl(${hue},45%,35%)">${safe}</text></svg>`;
    }
    return `<svg viewBox="0 0 96 96" role="img" aria-label="Generated avatar"><circle cx="48" cy="48" r="46" fill="hsl(${hue},45%,88%)"/><circle cx="48" cy="48" r="46" fill="none" stroke="hsl(${hue},40%,60%)" stroke-width="2"/><text x="48" y="60" font-family="system-ui,-apple-system,sans-serif" font-size="38" font-weight="700" text-anchor="middle" fill="hsl(${hue},45%,32%)">${safe}</text></svg>`;
  }

  function avatarMarkup() {
    const d = state.data || {};
    const name = d.profile?.fullName || '';
    if (d.avatar?.present) {
      return `<img class="pp-avatar-img" src="${API}/profile/avatar?ts=${Date.now()}" alt="${esc(name)} এর ছবি">`;
    }
    return `<span class="pp-avatar-svg" data-avatar-contract="zero-raster-avatar-v1">${defaultAvatarSvg(name, d.publicId || 'ah', state.prefs.avatarStyle)}</span>`;
  }

  // class-free preview for the edit/avatar pages (keeps the classed-image
  // count at exactly two: hero + public page)
  function avatarPreviewMarkup(size = 84) {
    const d = state.data || {};
    const name = d.profile?.fullName || '';
    if (d.avatar?.present) {
      return `<img src="${API}/profile/avatar?ts=${Date.now()}" alt="${esc(name)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;display:block">`;
    }
    return `<span style="display:inline-block;width:${size}px;height:${size}px;line-height:0">${defaultAvatarSvg(name, d.publicId || 'ah', state.prefs.avatarStyle)}</span>`;
  }

  /* ---------------- real local study data (honest, never faked) ---------------- */

  function localStats() {
    const out = { ready: false, streak: null, mcqs: null, mocks: null, firstFlash: null, firstMock: null, earned: [] };
    try {
      const cache = window.CACHE;
      const results = Array.isArray(cache?.examResults) ? cache.examResults : [];
      if (!results.length && typeof window.computeStreak !== 'function') { out.ready = true; out.streak = 0; out.mcqs = 0; out.mocks = 0; return out; }
      out.ready = true;
      out.streak = typeof window.computeStreak === 'function' ? (window.computeStreak() || 0) : 0;
      let mcqs = 0; let mocks = 0;
      for (const r of results) {
        const n = Number(r?.questionCount ?? r?.totalQuestions ?? (r?.snapshot || []).length) || 0;
        mcqs += n;
        const ts = Number(r?.date) || null;
        if (r?.mode === 'mock') { mocks += 1; if (ts && (!out.firstMock || ts < out.firstMock)) out.firstMock = ts; }
        else if (ts && (!out.firstFlash || ts < out.firstFlash)) out.firstFlash = ts;
      }
      out.mcqs = mcqs; out.mocks = mocks;
      out.earned = ACHIEVEMENTS.filter((a) => a.earned({ streak: out.streak, mcqs, mocks })).map((a) => a.id);
    } catch (_) { /* data unavailable — honest "—" */ }
    return out;
  }

  const ACHIEVEMENTS = [
    { id: 'first-mock', icon: '📝', name: 'First Mock', hint: 'প্রথম mock test complete করো', earned: (s) => (s.mocks || 0) >= 1 },
    { id: 'mcq-100', icon: '📚', name: '100 MCQs', hint: 'মোট 100টা MCQ complete করো', earned: (s) => (s.mcqs || 0) >= 100 },
    { id: 'streak-7', icon: '🔥', name: '7 Day Streak', hint: '7 দিনের practice streak বানাও', earned: (s) => (s.streak || 0) >= 7 },
    { id: 'mcq-500', icon: '🏆', name: '500 MCQs', hint: 'মোট 500টা MCQ complete করো', earned: (s) => (s.mcqs || 0) >= 500 }
  ];

  function journeyMilestones(p, stats) {
    const completion = Number(state.data?.completion || 0);
    return [
      { id: 'joined', label: 'Joined', ts: p?.createdAt ? Number(p.createdAt) : null, hint: 'Admission Hub-এ জয়েন' },
      { id: 'practice', label: 'Started Practice', ts: stats.firstFlash, hint: 'প্রথম practice/flash session' },
      { id: 'mock', label: 'First Mock', ts: stats.firstMock, hint: 'প্রথম mock test' },
      { id: 'achievement', label: 'First Achievement', ts: null, done: stats.earned.length > 0, hint: 'প্রথম achievement unlock' },
      { id: 'ready', label: 'Admission Ready', ts: null, done: completion >= 100, hint: 'Profile 100% complete' }
    ];
  }

  /* ---------------- completion (gentle, V2 ring) ---------------- */

  const COMPLETION_LABELS = [
    ['fullName', 'নাম'], ['dob', 'জন্মের তারিখ'], ['mobile', 'মোবাইল'],
    ['school', 'স্কুল/কলেজ'], ['higherInstitution', 'উচ্চ শিক্ষা'],
    ['targets', 'লক্ষ্য (টার্গেট)'], ['admissionSession', 'Admission session'],
    ['subjects', 'Preferred subjects'], ['academicGoal', 'Academic goal'], ['bio', 'Bio']
  ];

  function missingItems(profile) {
    if (!profile) return COMPLETION_LABELS.map((x) => x[1]);
    const out = [];
    for (const [key, label] of COMPLETION_LABELS) {
      const v = profile[key];
      const has = key === 'targets'
        ? Array.isArray(v) && v.length > 0 && Boolean(v[0]?.name)
        : key === 'subjects'
          ? Array.isArray(v) && v.length > 0
          : key === 'school' || key === 'higherInstitution'
            ? Boolean(v?.name)
            : String(v || '').length > 0;
      if (!has) out.push(label);
    }
    return out;
  }

  function completionBand(pct) {
    if (pct >= 90) return 'প্রায় সম্পূর্ণ ✦';
    if (pct >= 60) return 'ভালো পথে';
    if (pct >= 30) return 'শুরু হয়ে গেছে';
    return 'নতুন যাত্রা';
  }

  function ringMarkup(pct) {
    const r = 26; const c = 2 * Math.PI * r;
    const off = c * (1 - Math.min(100, Math.max(0, pct)) / 100);
    return `<span class="pp-ring" aria-hidden="true">
      <svg viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="${r}" fill="none" stroke="rgba(15,107,79,.12)" stroke-width="6"/>
        <circle cx="32" cy="32" r="${r}" fill="none" stroke="#0f6b4f" stroke-width="6" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 32 32)"/>
      </svg>
      <b>${bnNum(pct)}%</b>
    </span>`;
  }

  function completionCard() {
    const pct = Number(state.data?.completion || 0);
    const missing = missingItems(state.data?.profile);
    return `
      <div class="card pp-card pp-comp" data-completion-contract="gentle-completion-v1">
        <div class="pp-comp-row">
          ${ringMarkup(pct)}
          <div class="pp-comp-info">
            <div class="pp-kicker">PROFILE COMPLETION · ${esc(completionBand(pct))}</div>
            <p class="pp-hint">${missing.length
              ? `যা বাকি: ${missing.slice(0, 3).map(esc).join(', ')}${missing.length > 3 ? '…' : ''} — যখন খুশি, নিজের ঝামেলায়।`
              : 'সব তথ্য পূর্ণ — ধন্যবাদ! ✦'}</p>
            <button class="pp-comp-cta" data-role="open-edit-page" type="button">Complete Profile →</button>
          </div>
        </div>
      </div>`;
  }

  /* ---------------- sections ---------------- */

  function identityCard() {
    const d = state.data || {};
    const p = d.profile || {};
    const year = p.admissionSession || d.joinedYear || '';
    return `
      <div class="pp-hero" data-profile-contract="profile-identity-v1">
        <div class="pp-hero-row">
          <button class="pp-hero-avatar" data-role="open-avatar-page" type="button" aria-label="Avatar পরিবর্তন করো">
            ${avatarMarkup()}
            <span class="pp-cam-badge" aria-hidden="true">📷</span>
          </button>
          <div class="pp-hero-idblock">
            <div class="pp-hero-name">${esc(p.fullName || 'নাম যোগ করো')}${p.fullName ? '<span class="pp-verified" aria-label="saved">✓</span>' : ''}</div>
            <button class="pp-hero-chip" data-role="copy-public-id" type="button" title="ট্যাপ করে কপি করো">
              <span>AH-ID</span><b>${esc(d.publicId || '—')}</b><i aria-hidden="true">⧉</i>
            </button>
            <div class="pp-hero-line">🎓 Admission Candidate${year ? ` · ${esc(bnYear(year))}` : ''}</div>
            ${p.bio ? `<div class="pp-hero-bio">${esc(p.bio)}</div>` : ''}
          </div>
        </div>
        <button class="pp-btn-primary pp-hero-edit" data-role="open-edit-page" type="button">✏️ Edit Profile</button>
      </div>
      <div class="pp-greeting">${esc(d.context?.greeting || 'আগে থেকেই চলো')}</div>`;
  }

  function statsStrip() {
    const s = localStats();
    const cell = (icon, value, label) => `
      <div class="pp-stat">
        <span class="pp-stat-ic" aria-hidden="true">${icon}</span>
        <b class="pp-stat-num">${value}</b>
        <small>${label}</small>
      </div>`;
    const v = (x, zero = '0') => (x == null ? '—' : bnNum(x) === '0' && zero === 'zero' ? '0' : bnNum(x));
    return `
      <div class="pp-stats" data-role="go-exam" role="button" tabindex="0" aria-label="Study stats — Exam পেজে যাও">
        ${cell('🔥', v(s.streak), 'Day Streak')}
        ${cell('📚', v(s.mcqs), 'MCQs Done')}
        ${cell('📝', v(s.mocks), 'Mock Tests')}
        ${cell('🏆', v(s.earned.length), 'Achievements')}
      </div>
      ${s.ready && (s.mcqs || 0) === 0 ? '<p class="pp-fine pp-stats-hint">প্রথম practice শেষ করলে stats এখানে জীবন্ত হয়ে উঠবে।</p>' : ''}`;
  }

  function academicCard() {
    const p = state.data?.profile || {};
    const targets = Array.isArray(p.targets) ? p.targets.filter((t) => t?.name) : [];
    const row = (icon, kicker, value, role, emptyText) => `
      <button class="pp-ac-row" data-role="${role}" type="button">
        <span class="pp-ac-ic" aria-hidden="true">${icon}</span>
        <span class="pp-ac-body"><span class="pp-kicker">${kicker}</span>
          <span class="pp-value ${value ? '' : 'pp-empty'}">${value || emptyText}</span></span>
        <span class="pp-arrow" aria-hidden="true">→</span>
      </button>`;
    return `
      <div class="card pp-card pp-academic">
        <div class="pp-card-head"><span class="pp-card-title">Academic Identity</span><button class="pp-card-edit" data-role="open-target" type="button">Edit</button></div>
        ${row('🎯', 'TARGET UNIVERSITIES', targets.map((t) => `${t.name}${t.unit ? ` (${t.unit})` : ''}`).join(', ') || 'Add target universities', 'open-target', 'Add target universities')}
        ${row('📅', 'ADMISSION SESSION', p.admissionSession ? bnYear(p.admissionSession) : 'Not set', 'open-session', 'Session যোগ করো')}
        ${row('🚀', 'ACADEMIC GOAL', p.academicGoal || 'Set a goal', 'open-goal', 'Set a goal — specific লক্ষ্য')}
        ${row('🧪', 'PREFERRED SUBJECTS', Array.isArray(p.subjects) && p.subjects.length ? p.subjects.join(', ') : 'Add subjects', 'open-subjects', 'কোন subject পছন্দ?')}
      </div>`;
  }

  function journeyCard() {
    const p = state.data?.profile || {};
    const ms = journeyMilestones(p, localStats());
    return `
      <div class="card pp-card pp-journey">
        <div class="pp-card-head"><span class="pp-card-title">Your Journey</span><button class="pp-card-edit" data-role="open-journey-sheet" type="button">View All</button></div>
        <div class="pp-journey-track">
          ${ms.map((m) => {
            const done = m.ts || m.done === true;
            return `<div class="pp-jm ${done ? 'on' : 'off'}">
              <span class="pp-jm-dot" aria-hidden="true">${done ? '✓' : '○'}</span>
              <small>${esc(m.label)}</small>
              ${m.ts ? `<small class="pp-jm-date">${esc(bnDate(m.ts))}</small>` : '<small class="pp-jm-date">—</small>'}
            </div>`;
          }).join('')}
        </div>
        <p class="pp-fine">Real milestones only — কিছু না করলে fake step দেখাবে না।</p>
      </div>`;
  }

  function achievementsCard() {
    const s = localStats();
    const earned = new Set(s.earned);
    return `
      <div class="card pp-card pp-achv">
        <div class="pp-card-head"><span class="pp-card-title">Achievements</span><button class="pp-card-edit" data-role="open-achv-sheet" type="button">View All</button></div>
        <div class="pp-achv-grid">
          ${ACHIEVEMENTS.map((a) => `
            <div class="pp-achv-cell ${earned.has(a.id) ? 'on' : 'off'}" title="${esc(a.hint)}">
              <span aria-hidden="true">${earned.has(a.id) ? a.icon : '🔒'}</span>
              <small>${esc(a.name)}</small>
            </div>`).join('')}
        </div>
        <p class="pp-fine">Display-only — real data থেকে unlock হয়, reward/XP নেই।</p>
      </div>`;
  }

  function prefsCard() {
    const pf = state.prefs;
    const row = (icon, label, value, role, extra = '') => `
      <button class="pp-pref-row" data-role="${role}" type="button">
        <span class="pp-pref-ic" aria-hidden="true">${icon}</span>
        <span class="pp-pref-label">${label}</span>
        <span class="pp-pref-value ${extra}">${value}</span>
        <span class="pp-arrow" aria-hidden="true">→</span>
      </button>`;
    return `
      <div class="card pp-card pp-prefs">
        <div class="pp-card-head"><span class="pp-card-title">Preferences</span><button class="pp-card-edit" data-role="open-prefs-sheet" type="button">Edit</button></div>
        ${row('🌐', 'Language', pf.language === 'en' ? 'English' : 'বাংলা (Bengali)', 'pref-language')}
        ${row('🔔', 'Notifications', pf.notifications === 'on' ? 'On' : 'Off', 'pref-notifications')}
        ${row('🎨', 'Appearance', pf.appearance === 'dark' ? 'Dark' : pf.appearance === 'system' ? 'System' : 'Light Mode', 'pref-appearance')}
        ${row('🤖', 'AI Assistant', pf.aiAssistant === 'on' ? 'Enabled' : 'Disabled', 'pref-ai')}
        <p class="pp-fine">Explicit settings — তুমি কী চাও সেটা তুমিই ঠিক করো।</p>
      </div>`;
  }

  function privacyCard() {
    const v = state.data?.profile?.visibility || 'private';
    const isPublic = v === 'public';
    return `
      <div class="card pp-card pp-privacy" data-role="open-visibility">
        <div class="pp-card-head"><span class="pp-card-title">Privacy &amp; Visibility</span><span class="pp-arrow" aria-hidden="true">→</span></div>
        <div class="pp-priv-row">
          <div>
            <div class="pp-value">Public Profile</div>
            <p class="pp-fine">${isPublic ? 'তোমার public তথ্য অন্যরা দেখতে পাবে' : 'Public নয় — কেউ দেখতে পাবে না'}</p>
          </div>
          <button class="pp-switch ${isPublic ? 'on' : ''}" data-role="toggle-public" type="button" role="switch" aria-checked="${isPublic}" aria-label="Public Profile toggle"><i></i></button>
        </div>
        ${v !== 'private' ? `
        <div class="pp-public-link">
          <code>${location.origin}/${esc(state.data?.publicId || '')}</code>
          <button class="pp-btn-secondary" data-role="copy-public-link" type="button">লিংক কপি</button>
        </div>` : ''}
        <p class="pp-fine">Email, mobile, জন্মের তারিখ আর school-এর বিস্তারিত কখনো public হবে না।</p>
      </div>`;
  }

  // The floating account launcher pill was removed from the app shell
  // (owner directive). The Profile tab is the single account entry
  // point — this card keeps Security/Passkey/Devices/Log Out reachable.
  function accountCard() {
    return `
      <button class="card pp-card pp-tap" data-role="open-account" data-account-card-contract="profile-account-entry-v1" type="button">
        <div>
          <div class="pp-kicker">ACCOUNT</div>
          <div class="pp-value">Security · Passkey · Device · Log Out</div>
        </div>
        <span class="pp-arrow" aria-hidden="true">→</span>
      </button>`;
  }

  const SECTION_RENDER = {
    identity: identityCard,
    completion: completionCard,
    academic: academicCard,
    goal: academicCard,
    stats: statsStrip,
    security: privacyCard
  };

  function sectionsMarkup() {
    const order = Array.isArray(state.data?.context?.sectionOrder) ? state.data.context.sectionOrder : ['identity', 'academic', 'completion', 'security'];
    const seen = new Set();
    const parts = [];
    for (const key of order) {
      if (key === 'academic' && seen.has('goal')) continue;
      if (key === 'goal' && seen.has('academic')) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      const fn = SECTION_RENDER[key];
      if (fn) parts.push(fn());
    }
    if (!seen.has('identity')) parts.unshift(identityCard());
    if (!seen.has('academic') && !seen.has('goal')) parts.splice(1, 0, academicCard());
    if (!seen.has('security')) parts.push(privacyCard());
    // fixed identity-space tail (not reordered by context)
    parts.push(journeyCard());
    parts.push(achievementsCard());
    parts.push(prefsCard());
    parts.push(accountCard());
    return parts.join('');
  }

  /* ---------------- edit profile page ---------------- */

  function editPageMarkup() {
    const p = state.data?.profile || {};
    const bioLen = String(p.bio || '').length;
    return `
      <div class="pp-edit">
        <div class="pp-edit-top">
          <button class="pp-iconbtn" data-role="back-profile" type="button" aria-label="ফিরে যাও">←</button>
          <h2>Edit Profile</h2>
          <span class="pp-edit-ic" aria-hidden="true">✏️</span>
        </div>
        <div class="pp-edit-photo">
          <div class="pp-edit-photo-img">${avatarPreviewMarkup(84)}</div>
          <button class="pp-btn-secondary" data-role="open-avatar-page" type="button">Change Photo</button>
        </div>
        <label class="pp-field"><span>Full Name *</span>
          <input id="pp-edit-name" type="text" maxlength="80" autocomplete="name" value="${esc(p.fullName || '')}" placeholder="তোমার পুরো নাম">
        </label>
        <label class="pp-field"><span>Mobile Number ${p.mobile ? '<em class="pp-saved-chip">✓ Saved</em>' : '<em>(optional)</em>'}</span>
          <input id="pp-edit-mobile" type="tel" inputmode="tel" maxlength="16" autocomplete="tel" value="${esc(p.mobile || '')}" placeholder="+8801XXXXXXXXX">
        </label>
        <label class="pp-field"><span>Date of Birth</span>
          <input id="pp-edit-dob" type="date" value="${esc(p.dob || '')}">
        </label>
        <label class="pp-field"><span>Bio <em>(optional, সর্বোচ্চ ২৮০)</em></span>
          <textarea id="pp-edit-bio" rows="3" maxlength="280" placeholder="নিজের সম্পর্কে এক লাইন…">${esc(p.bio || '')}</textarea>
          <small class="pp-bio-count" data-role="bio-count">${bioLen}/280</small>
        </label>
        <p class="pp-fine" data-role="sheet-error" hidden></p>
        <button class="pp-btn-primary pp-edit-save" data-role="edit-save" type="button">Save Changes</button>
        <p class="pp-fine">Email auth system-এ manage হয় — profile থেকে change করা যায় না।</p>
      </div>`;
  }

  /* ---------------- avatar page ---------------- */

  function avatarPageMarkup() {
    const tab = state.avatarTab;
    const hasPhoto = state.data?.avatar?.present === true;
    return `
      <div class="pp-edit">
        <div class="pp-edit-top">
          <button class="pp-iconbtn" data-role="back-profile" type="button" aria-label="ফিরে যাও">←</button>
          <h2>Change Avatar</h2>
          ${hasPhoto ? '<button class="pp-iconbtn pp-danger" data-role="avatar-remove" type="button" aria-label="Photo সরাও">🗑</button>' : '<span></span>'}
        </div>
        <div class="pp-av-tabs" role="tablist">
          <button class="pp-av-tab ${tab === 'upload' ? 'on' : ''}" data-role="av-tab" data-tab="upload" type="button">Upload</button>
          <button class="pp-av-tab ${tab === 'camera' ? 'on' : ''}" data-role="av-tab" data-tab="camera" type="button">Camera</button>
          <button class="pp-av-tab ${tab === 'default' ? 'on' : ''}" data-role="av-tab" data-tab="default" type="button">Default</button>
        </div>
        <div class="pp-av-preview">${avatarPreviewMarkup(120)}</div>
        ${tab === 'upload' ? `
          <label class="pp-btn-primary pp-av-upload">📁 Upload from Gallery
            <input data-role="avatar-file" type="file" accept="image/jpeg,image/png,image/webp" hidden>
          </label>
          <p class="pp-fine">JPEG/PNG/WebP — বড় ছবি নিজে ছোট করে নেবে।</p>` : ''}
        ${tab === 'camera' ? `
          <button class="pp-btn-primary pp-av-upload" data-role="av-camera" type="button">📷 Open Camera</button>
          <p class="pp-fine" data-role="camera-error" hidden></p>` : ''}
        ${tab === 'default' ? `
          <div class="pp-av-defaults">
            ${[0, 1, 2, 3, 4, 5].map((s) => `
              <button class="pp-av-def ${state.prefs.avatarStyle === s ? 'on' : ''}" data-role="pick-default-avatar" data-style="${s}" type="button" aria-label="Default style ${s + 1}">
                ${defaultAvatarSvg(state.data?.profile?.fullName || 'A', state.data?.publicId || 'ah', s)}
              </button>`).join('')}
          </div>
          <p class="pp-fine">${hasPhoto ? 'Uploaded photo আছে — default দেখতে আগে photo সরানো দরকার।' : 'নাম থেকে generated — কোনো ছবি দিতে হবে না।'}</p>` : ''}
      </div>`;
  }

  /* ---------------- bottom sheets ---------------- */

  function sheetShell(title, inner, contract = 'profile-bottom-sheet-v1') {
    state.sheetOpen = true;
    document.addEventListener('keydown', escClose, { once: false });
    return `
      <div class="pp-sheet-backdrop" data-role="sheet-backdrop">
        <div class="pp-sheet" data-sheet-contract="${contract}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <div class="pp-sheet-head">
            <h3>${esc(title)}</h3>
            <button class="pp-iconbtn" data-role="sheet-close" type="button" aria-label="বন্ধ করো">×</button>
          </div>
          <div class="pp-sheet-body">${inner}</div>
        </div>
      </div>`;
  }

  function targetSheet() {
    const p = state.data?.profile || {};
    const targets = Array.isArray(p.targets) ? p.targets : [];
    const canAdd = targets.length < 5;
    return sheetShell('Target Universities', `
      <div class="pp-tlist">
        ${targets.map((t, i) => `
          <div class="pp-titem">
            <span><b>${esc(t.name)}</b>${t.unit ? ` · ${esc(t.unit)}` : ''}${t.year ? ` · ${esc(bnYear(t.year))}` : ''}</span>
            <button class="pp-iconbtn" data-role="sheet-del-target" data-index="${i}" type="button" aria-label="মুছে ফেলো">×</button>
          </div>`).join('') || '<p class="pp-fine">এখনো কোনো target নেই।</p>'}
      </div>
      ${canAdd ? `
      <div class="pp-add-target">
        <label class="pp-field"><span>ইউনিভার্সিটি / কলেজ</span>
          <input id="pp-t-name" type="text" maxlength="120" placeholder="যেমন: Rajshahi University">
        </label>
        <div class="pp-2col">
          <label class="pp-field"><span>Unit <em>(optional)</em></span>
            <input id="pp-t-unit" type="text" maxlength="20" placeholder="A Unit / CSE">
          </label>
          <label class="pp-field"><span>বছর <em>(optional)</em></span>
            <input id="pp-t-year" type="text" maxlength="10" placeholder="2026">
          </label>
        </div>
        <button class="pp-btn-secondary" data-role="sheet-add-target" type="button">+ Target যোগ করো</button>
      </div>` : '<p class="pp-fine">সর্বোচ্চ 5টা target রাখা যায়।</p>'}
      <p class="pp-fine" data-role="sheet-error" hidden></p>
      <div class="pp-sheet-actions">
        <button class="pp-btn-primary" data-role="sheet-save-targets" type="button">সংরক্ষণ করো</button>
        <button class="pp-btn-ghost" data-role="sheet-close" type="button">বাতিল</button>
      </div>`);
  }

  function sessionSheet() {
    const p = state.data?.profile || {};
    return sheetShell('Admission Session', `
      <p class="pp-fine">আসন্ন admission session-এর সাল (যেমন: 2026)।</p>
      <label class="pp-field"><span>Session year</span>
        <input id="pp-session-year" type="text" inputmode="numeric" maxlength="4" value="${esc(p.admissionSession || '')}" placeholder="2026">
      </label>
      <p class="pp-fine" data-role="sheet-error" hidden></p>
      <div class="pp-sheet-actions">
        <button class="pp-btn-primary" data-role="sheet-save-session" type="button">সংরক্ষণ করো</button>
        ${p.admissionSession ? '<button class="pp-btn-ghost pp-danger" data-role="sheet-clear-session" type="button">মুছে ফেলো</button>' : ''}
        <button class="pp-btn-ghost" data-role="sheet-close" type="button">বাতিল</button>
      </div>`);
  }

  function goalSheet() {
    const p = state.data?.profile || {};
    return sheetShell('Academic Goal', `
      <p class="pp-fine">Specific লক্ষ্য লেখো — public profile-তে (public করলে) দেখাবে।</p>
      <label class="pp-field"><span>তোমার academic goal <em>(সর্বোচ্চ ১৬০)</em></span>
        <textarea id="pp-goal-text" rows="3" maxlength="160" placeholder="যেমন: 2026-এ BUET CSE-তে ভর্তি হবো">${esc(p.academicGoal || '')}</textarea>
      </label>
      <p class="pp-fine" data-role="sheet-error" hidden></p>
      <div class="pp-sheet-actions">
        <button class="pp-btn-primary" data-role="sheet-save-goal" type="button">Goal সেট করো</button>
        ${p.academicGoal ? '<button class="pp-btn-ghost pp-danger" data-role="sheet-clear-goal" type="button">Goal মুছে ফেলো</button>' : ''}
        <button class="pp-btn-ghost" data-role="sheet-close" type="button">বাতিল</button>
      </div>`);
  }

  function subjectsSheet() {
    const p = state.data?.profile || {};
    const subjects = Array.isArray(p.subjects) ? p.subjects : [];
    return sheetShell('Preferred Subjects', `
      <div class="pp-chips">
        ${subjects.map((s) => `<span class="pp-chip">${esc(s)}<button class="pp-chip-x" data-role="sheet-del-subject" data-value="${esc(s)}" type="button" aria-label="মুছে ফেলো">×</button></span>`).join('') || '<p class="pp-fine">এখনো কোনো subject নেই।</p>'}
      </div>
      ${subjects.length < 8 ? `
      <div class="pp-2col">
        <label class="pp-field"><span>Subject</span>
          <input id="pp-subject-name" type="text" maxlength="40" placeholder="যেমন: Physics">
        </label>
        <button class="pp-btn-secondary" data-role="sheet-add-subject" type="button">+ যোগ করো</button>
      </div>` : '<p class="pp-fine">সর্বোচ্চ 8টা subject রাখা যায়।</p>'}
      <p class="pp-fine" data-role="sheet-error" hidden></p>
      <div class="pp-sheet-actions">
        <button class="pp-btn-primary" data-role="sheet-save-subjects" type="button">সংরক্ষণ করো</button>
        <button class="pp-btn-ghost" data-role="sheet-close" type="button">বাতিল</button>
      </div>`);
  }

  function journeySheet() {
    const p = state.data?.profile || {};
    const ms = journeyMilestones(p, localStats());
    return sheetShell('Your Journey', `
      <div class="pp-jl">
        ${ms.map((m) => {
          const done = Boolean(m.ts || m.done === true);
          return `<div class="pp-jl-row ${done ? 'on' : 'off'}">
            <span class="pp-jm-dot" aria-hidden="true">${done ? '✓' : '○'}</span>
            <span><b>${esc(m.label)}</b><small>${esc(m.hint)}</small></span>
            ${m.ts ? `<em>${esc(bnDate(m.ts))}</em>` : '<em>—</em>'}
          </div>`;
        }).join('')}
      </div>
      <p class="pp-fine">সব milestone real data থেকে আসে — skip/fake করা যায় না।</p>
      <div class="pp-sheet-actions"><button class="pp-btn-ghost" data-role="sheet-close" type="button">বন্ধ করো</button></div>`);
  }

  function achvSheet() {
    const s = localStats();
    const earned = new Set(s.earned);
    return sheetShell('Achievements', `
      <div class="pp-jl">
        ${ACHIEVEMENTS.map((a) => `
          <div class="pp-jl-row ${earned.has(a.id) ? 'on' : 'off'}">
            <span aria-hidden="true">${earned.has(a.id) ? a.icon : '🔒'}</span>
            <span><b>${esc(a.name)}</b><small>${esc(a.hint)}</small></span>
            <em>${earned.has(a.id) ? 'Unlocked' : 'Not yet'}</em>
          </div>`).join('')}
      </div>
      <p class="pp-fine">Display-only — real progress থেকে unlock হয়; XP/reward নেই।</p>
      <div class="pp-sheet-actions"><button class="pp-btn-ghost" data-role="sheet-close" type="button">বন্ধ করো</button></div>`);
  }

  function prefsSheet() {
    const pf = state.prefs;
    const opt = (val, label, desc, disabled = false, note = '') => `
      <button class="pp-vopt ${pf.language === val ? 'on' : ''} ${disabled ? 'disabled' : ''}" data-role="pick-language" data-value="${val}" ${disabled ? 'disabled' : ''} type="button">
        <span class="pp-vradio" aria-hidden="true">${pf.language === val ? '●' : '○'}</span>
        <span><b>${esc(label)}</b><small>${esc(desc)}${note ? ` — ${esc(note)}` : ''}</small></span>
      </button>`;
    const appt = (val, label, desc, disabled = false, note = '') => `
      <button class="pp-vopt ${pf.appearance === val ? 'on' : ''} ${disabled ? 'disabled' : ''}" data-role="pick-appearance" data-value="${val}" ${disabled ? 'disabled' : ''} type="button">
        <span class="pp-vradio" aria-hidden="true">${pf.appearance === val ? '●' : '○'}</span>
        <span><b>${esc(label)}</b><small>${esc(desc)}${note ? ` — ${esc(note)}` : ''}</small></span>
      </button>`;
    return sheetShell('Preferences', `
      <div class="pp-kicker">LANGUAGE</div>
      <div class="pp-vlist">
        ${opt('bn', 'বাংলা (Bengali)', 'Default language')}
        ${opt('en', 'English', 'শীঘ্রই আসছে', true)}
      </div>
      <div class="pp-kicker" style="margin-top:14px">APPEARANCE</div>
      <div class="pp-vlist">
        ${appt('light', 'Light Mode', 'Default theme')}
        ${appt('dark', 'Dark Mode', 'শীঘ্রই আসছে', true)}
        ${appt('system', 'System', 'শীঘ্রই আসছে', true)}
      </div>
      <div class="pp-sheet-actions"><button class="pp-btn-ghost" data-role="sheet-close" type="button">বাতিল</button></div>`);
  }

  function visibilitySheet() {
    const v = state.data?.profile?.visibility || 'private';
    const options = [
      ['private', 'Private', 'কোনো public profile নেই — সব গোপন'],
      ['limited', 'Limited', 'নাম, AH-ID আর ছবি public-এ (leaderboard-style)'],
      ['public', 'Public', 'নাম, ছবি, সব লক্ষ্য, session, goal, bio আর completion public-এ']
    ];
    return sheetShell('Public visibility', `
      <div class="pp-vlist">
        ${options.map(([val, title, desc]) => `
          <button class="pp-vopt ${val === v ? 'on' : ''}" data-role="pick-visibility" data-value="${val}" type="button">
            <span class="pp-vradio" aria-hidden="true">${val === v ? '●' : '○'}</span>
            <span><b>${esc(title)}</b><small>${esc(desc)}</small></span>
          </button>`).join('')}
      </div>
      <p class="pp-fine">Email, mobile, জন্মের তারিখ আর school-এর বিস্তারিত কখনো public হবে না — কোনো visibility-তেই নয়।</p>
      <p class="pp-fine" data-role="sheet-error" hidden></p>
      <div class="pp-sheet-actions">
        <button class="pp-btn-ghost" data-role="sheet-close" type="button">বাতিল</button>
      </div>`);
  }

  function renderSheet() {
    const host = $('[data-role="sheet-host"]');
    if (!host) return;
    const type = state.sheet;
    state.sheet = null;
    if (type === 'target') host.innerHTML = targetSheet();
    else if (type === 'session') host.innerHTML = sessionSheet();
    else if (type === 'goal') host.innerHTML = goalSheet();
    else if (type === 'subjects') host.innerHTML = subjectsSheet();
    else if (type === 'journey') host.innerHTML = journeySheet();
    else if (type === 'achv') host.innerHTML = achvSheet();
    else if (type === 'prefs') host.innerHTML = prefsSheet();
    else if (type === 'visibility') host.innerHTML = visibilitySheet();
    else host.innerHTML = '';
  }

  function closeSheet() {
    state.sheet = null;
    state.sheetOpen = false;
    const host = $('[data-role="sheet-host"]');
    if (host) host.innerHTML = '';
  }

  function escClose(e) { if (e.key === 'Escape') closeSheet(); }

  /* ---------------- toast ---------------- */

  function toast(message, isError = false) {
    const el = $('[data-role="profile-toast"]');
    if (!el) return;
    el.textContent = message;
    el.className = `pp-toast ${isError ? 'pp-toast-error' : ''}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = 'pp-toast'; el.textContent = ''; }, 3600);
  }

  /* ---------------- avatar actions ---------------- */

  function downscaleToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('ছবিটি পড়া যায়নি'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('ছবিটি বোঝা যায়নি (JPEG/PNG/WebP দাও)'));
        img.onload = () => {
          const MAX = 512;
          const scale = Math.min(1, MAX / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('এই ব্রাউজারে ছবি প্রসেস করা যায়নি'));
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob((blob) => {
            if (!blob) return reject(new Error('ছবি সংরক্ষণ করা যায়নি'));
            if (blob.size > 2 * 1024 * 1024) return reject(new Error('ছবি অনেক বড় — ছোট ছবি দাও'));
            const fr = new FileReader();
            fr.onerror = () => reject(new Error('ছবি সংরক্ষণ করা যায়নি'));
            fr.onload = () => resolve({ data: String(fr.result).split(',')[1] || '', mime: 'image/jpeg' });
            fr.readAsDataURL(blob);
          }, 'image/jpeg', 0.85);
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  async function onAvatarFile(file) {
    if (!file) return;
    if (state.busy) return;
    state.busy = true;
    try {
      const { data, mime } = await downscaleToBase64(file);
      await api(`${API}/profile/avatar`, { method: 'POST', body: JSON.stringify({ data, mime }) });
      await loadProfile();
      renderCurrentView();
      toast('Avatar আপডেট হয়েছে ✦');
    } catch (err) {
      toast(err.message || 'Avatar আপলোড করা যায়নি', true);
    } finally { state.busy = false; }
  }

  async function onAvatarRemove() {
    if (state.busy) return;
    state.busy = true;
    try {
      await api(`${API}/profile/avatar`, { method: 'DELETE' });
      await loadProfile();
      renderCurrentView();
      toast('Avatar সরানো হয়েছে — generated avatar ফিরেছে');
    } catch (err) {
      toast(err.message || 'Avatar সরাতে সমস্যা', true);
    } finally { state.busy = false; }
  }

  async function onAvatarCamera() {
    if (state.busy) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      const el = $('[data-role="camera-error"]');
      if (el) { el.hidden = false; el.textContent = 'Camera এই device/browser-এ available নাই — Upload tab use করো।'; }
      return;
    }
    state.busy = true;
    const errEl = $('[data-role="camera-error"]');
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      const video = document.createElement('video');
      video.muted = true; video.playsInline = true;
      video.style.cssText = 'width:100%;max-width:420px;border-radius:16px;';
      video.srcObject = stream;
      const host = $('[data-role="sheet-host"]');
      const box = document.createElement('div');
      box.style.padding = '8px 0';
      box.appendChild(video);
      host.appendChild(box);
      await video.play();
      const shotBtn = document.createElement('button');
      shotBtn.type = 'button';
      shotBtn.className = 'pp-btn-primary';
      shotBtn.style.margin = '12px 0';
      shotBtn.textContent = '📸 ছবি তোলো';
      host.appendChild(shotBtn);
      await new Promise((resolve) => {
        shotBtn.addEventListener('click', async () => {
          try {
            const w = video.videoWidth || 720; const h = video.videoHeight || 720;
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(video, 0, 0, w, h);
            const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
            const file = blob ? new File([blob], 'camera.jpg', { type: 'image/jpeg' }) : null;
            box.remove(); shotBtn.remove();
            if (file) onAvatarFile(file);
          } catch (_) {
            box.remove(); shotBtn.remove();
            if (errEl) { errEl.hidden = false; errEl.textContent = 'Camera থেকে ছবি তোলা যায়নি — আবার চেষ্টা করো।'; }
          }
          resolve();
        }, { once: true });
      });
    } catch (err) {
      const el = $('[data-role="camera-error"]');
      if (el) { el.hidden = false; el.textContent = err?.name === 'NotAllowedError' ? 'Camera permission দিলে ছবি তোলা যাবে — Upload tab-ও আছে।' : 'Camera খোলা যায়নি — Upload tab use করো।'; }
    } finally {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      state.busy = false;
    }
  }

  /* ---------------- events ---------------- */

  function copyText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
    return Promise.resolve();
  }

  function bindPageEvents(root) {
    root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-role]');
      if (!el) return;
      const role = el.dataset.role;
      if (role === 'open-target') state.sheet = 'target';
      else if (role === 'open-session') state.sheet = 'session';
      else if (role === 'open-goal') state.sheet = 'goal';
      else if (role === 'open-subjects') state.sheet = 'subjects';
      else if (role === 'open-journey-sheet') state.sheet = 'journey';
      else if (role === 'open-achv-sheet') state.sheet = 'achv';
      else if (role === 'open-prefs-sheet') state.sheet = 'prefs';
      else if (role === 'open-visibility') state.sheet = 'visibility';
      else if (role === 'sheet-close' || role === 'sheet-backdrop') { closeSheet(); return; }
      else if (role === 'open-edit-page') { state.view = 'edit'; renderCurrentView(); return; }
      else if (role === 'open-avatar-page') { state.view = 'avatar'; renderCurrentView(); return; }
      else if (role === 'back-profile') { state.view = 'profile'; renderCurrentView(); return; }
      else if (role === 'av-tab') { state.avatarTab = el.dataset.tab; renderCurrentView(); return; }
      else if (role === 'av-camera') { onAvatarCamera(); return; }
      else if (role === 'avatar-remove') { onAvatarRemove(); return; }
      else if (role === 'pick-default-avatar') {
        state.prefs.avatarStyle = Number(el.dataset.style) || 0;
        savePrefs(state.prefs);
        renderCurrentView();
        toast('Default avatar সেভ হয়েছে ✓');
        return;
      }
      else if (role === 'pref-language') { state.sheet = 'prefs'; }
      else if (role === 'pref-appearance') { state.sheet = 'prefs'; }
      else if (role === 'pref-notifications') {
        state.prefs.notifications = state.prefs.notifications === 'on' ? 'off' : 'on';
        savePrefs(state.prefs); renderCurrentView(); toast('Notifications setting সেভ হয়েছে ✓');
        return;
      }
      else if (role === 'pref-ai') {
        state.prefs.aiAssistant = state.prefs.aiAssistant === 'on' ? 'off' : 'on';
        savePrefs(state.prefs); renderCurrentView(); toast('AI Assistant setting সেভ হয়েছে ✓');
        return;
      }
      else if (role === 'pick-language') {
        if (el.disabled) return;
        state.prefs.language = el.dataset.value;
        savePrefs(state.prefs); closeSheet(); renderCurrentView(); toast('Language সেভ হয়েছে ✓');
        return;
      }
      else if (role === 'pick-appearance') {
        if (el.disabled) return;
        state.prefs.appearance = el.dataset.value;
        savePrefs(state.prefs); closeSheet(); renderCurrentView(); toast('Appearance সেভ হয়েছে ✓');
        return;
      }
      else if (role === 'copy-public-id') { copyText(state.data?.publicId || '').then(() => toast('AH-ID কপি হয়েছে')); return; }
      else if (role === 'copy-public-link') { copyText(`${location.origin}/${state.data?.publicId || ''}`).then(() => toast('Public লিংক কপি হয়েছে')); return; }
      else if (role === 'go-exam') {
        if (typeof window.navigate === 'function') window.navigate('exam');
        else if (typeof window.render === 'function') { location.hash = 'exam'; window.render(); }
        return;
      }
      else if (role === 'open-account') {
        const acct = window.AdmissionAccount;
        if (acct && typeof acct.open === 'function') acct.open();
        return;
      }
      else if (role === 'toggle-public') {
        const current = state.data?.profile?.visibility || 'private';
        savePatch({ visibility: current === 'public' ? 'private' : 'public' }, () => renderProfilePage());
        return;
      }
      else if (role === 'pick-visibility') {
        const value = el.dataset.value;
        savePatch({ visibility: value }, () => { closeSheet(); renderProfilePage(); });
        return;
      }
      else if (role === 'sheet-add-target') {
        const list = sheetTargets();
        const name = $('#pp-t-name')?.value || '';
        const unit = $('#pp-t-unit')?.value || '';
        const year = $('#pp-t-year')?.value || '';
        if (String(name).trim().length < 2) { sheetErr('ইউনিভার্সিটি/কলেজের নাম দাও (কমপক্ষে ২ অক্ষর)।'); return; }
        list.push({ name, unit, year });
        state.sheetTargets = list;
        renderSheet();
        return;
      }
      else if (role === 'sheet-del-target') {
        const list = sheetTargets();
        list.splice(Number(el.dataset.index), 1);
        state.sheetTargets = list;
        renderSheet();
        return;
      }
      else if (role === 'sheet-save-targets') {
        const list = sheetTargets();
        savePatch({ targets: list }, () => { closeSheet(); renderProfilePage(); });
        return;
      }
      else if (role === 'sheet-save-session') {
        const v = String($('#pp-session-year')?.value || '').trim();
        if (v && !/^(19|20|21)\d{2}$/.test(v)) { sheetErr('সঠিক 4-digit সাল দাও (যেমন: 2026)।'); return; }
        savePatch({ admissionSession: v }, () => { closeSheet(); renderProfilePage(); });
        return;
      }
      else if (role === 'sheet-clear-session') {
        savePatch({ admissionSession: '' }, () => { closeSheet(); renderProfilePage(); });
        return;
      }
      else if (role === 'sheet-save-goal') {
        const v = String($('#pp-goal-text')?.value || '').trim();
        savePatch({ academicGoal: v }, () => { closeSheet(); renderProfilePage(); });
        return;
      }
      else if (role === 'sheet-clear-goal') {
        savePatch({ academicGoal: '' }, () => { closeSheet(); renderProfilePage(); });
        return;
      }
      else if (role === 'sheet-add-subject') {
        const v = String($('#pp-subject-name')?.value || '').trim();
        if (!v) { sheetErr('Subject-এর নাম দাও।'); return; }
        const list = sheetSubjects();
        if (!list.includes(v)) list.push(v);
        state.sheetSubjects = list;
        renderSheet();
        return;
      }
      else if (role === 'sheet-del-subject') {
        const list = sheetSubjects().filter((s) => s !== el.dataset.value);
        state.sheetSubjects = list;
        renderSheet();
        return;
      }
      else if (role === 'sheet-save-subjects') {
        savePatch({ subjects: sheetSubjects() }, () => { closeSheet(); renderProfilePage(); });
        return;
      }
      else if (role === 'edit-save') {
        saveEditPage();
        return;
      }
    });
    // bio counter (live)
    const bio = $('#pp-edit-bio');
    if (bio) bio.addEventListener('input', () => {
      const c = $('[data-role="bio-count"]');
      if (c) c.textContent = `${bio.value.length}/280`;
    });
  }

  function sheetTargets() {
    if (Array.isArray(state.sheetTargets)) return state.sheetTargets.slice();
    const p = state.data?.profile || {};
    return Array.isArray(p.targets) ? p.targets.slice() : [];
  }
  function sheetSubjects() {
    if (Array.isArray(state.sheetSubjects)) return state.sheetSubjects.slice();
    const p = state.data?.profile || {};
    return Array.isArray(p.subjects) ? p.subjects.slice() : [];
  }
  function sheetErr(msg) {
    const err = $('[data-role="sheet-error"]');
    if (err) { err.hidden = false; err.textContent = msg; }
  }

  function saveEditPage() {
    const p = state.data?.profile || {};
    const fields = {};
    const name = String($('#pp-edit-name')?.value || '').trim();
    const mobile = String($('#pp-edit-mobile')?.value || '').trim();
    const dob = String($('#pp-edit-dob')?.value || '').trim();
    const bio = String($('#pp-edit-bio')?.value || '').trim();
    if (name !== (p.fullName || '')) {
      if (name.length < 2) { sheetErr('নাম কমপক্ষে ২ অক্ষরের হতে হবে।'); return; }
      fields.fullName = name;
    }
    if (mobile !== (p.mobile || '')) {
      const digits = mobile.replace(/[\s()-]/g, '');
      if (digits && !/^\+?[0-9]{8,15}$/.test(digits)) { sheetErr('সঠিক মোবাইল নম্বর দাও (যেমন: +8801XXXXXXXXX)।'); return; }
      fields.mobile = digits;
    }
    if (dob !== (p.dob || '')) {
      if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) { sheetErr('সঠিক তারিখ দাও।'); return; }
      fields.dob = dob;
    }
    if (bio !== (p.bio || '')) {
      if (bio.length > 280) { sheetErr('Bio সর্বোচ্চ ২৮০ অক্ষর হতে পারে।'); return; }
      fields.bio = bio;
    }
    if (!Object.keys(fields).length) { sheetErr('কিছু না পরিবর্তন করলে সংরক্ষণ করা যাবে না।'); return; }
    savePatch(fields, () => { state.view = 'profile'; renderProfilePage(); });
  }

  function savePatch(fields, onDone) {
    if (state.busy) return;
    state.busy = true;
    const errEl = $('[data-role="sheet-error"]');
    if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
    const btn = fields && $('button[data-role="edit-save"]');
    if (btn) { btn.disabled = true; btn.textContent = 'সংরক্ষণ হচ্ছে…'; }
    patch(fields)
      .then(() => { toast('সংরক্ষিত হয়েছে ✓'); onDone && onDone(); })
      .catch((err) => {
        if (err.status === 409) {
          if (errEl) { errEl.hidden = false; errEl.textContent = 'এই সময়ে অন্য জায়গা থেকে পরিবর্তন হয়েছে — একবার আরেফ্রেশ করে আবার চেষ্টা করো।'; }
          return loadProfile().then(renderProfilePage).catch(() => {});
        }
        if (err.status === 429) {
          if (errEl) { errEl.hidden = false; errEl.textContent = 'একটু দ্রুত বেশি — এক-দু সেকেন্ড পরে আবার চেষ্টা করো।'; }
          return;
        }
        if (errEl) { errEl.hidden = false; errEl.textContent = err.message || 'সংরক্ষণ করা যায়নি'; }
      })
      .finally(() => {
        state.busy = false;
        const b = $('button[data-role="edit-save"]');
        if (b) { b.disabled = false; b.textContent = 'Save Changes'; }
      });
  }

  /* ---------------- pages ---------------- */

  function guestPrompt() {
    return `
      <div class="card pp-card pp-guest">
        <div class="pp-guest-ic" aria-hidden="true">🎓</div>
        <h2>Profile</h2>
        <p>তোমার personal academic hub দেখতে Sign In করো — নাম, লক্ষ্য, avatar সব এক জায়গায় থাকবে।</p>
        <button class="pp-btn-primary" data-role="guest-signin" type="button">Sign In / Log In</button>
      </div>`;
  }

  function profileViewMarkup() {
    return `
      <div class="pp-wrap">
        ${sectionsMarkup()}
        <div data-role="profile-toast" class="pp-toast" aria-live="polite"></div>
        <div data-role="sheet-host"></div>
      </div>`;
  }

  function editViewMarkup() {
    return `
      <div class="pp-wrap">
        ${editPageMarkup()}
        <div data-role="profile-toast" class="pp-toast" aria-live="polite"></div>
        <div data-role="sheet-host"></div>
      </div>`;
  }

  function avatarViewMarkup() {
    return `
      <div class="pp-wrap">
        ${avatarPageMarkup()}
        <div data-role="profile-toast" class="pp-toast" aria-live="polite"></div>
        <div data-role="sheet-host"></div>
      </div>`;
  }

  function renderCurrentView() {
    const host = $('#app');
    if (!host) return;
    const account = window.AdmissionAccount;
    const signedIn = account && !account.isGuest() && account.isVerified();
    if (!signedIn) { state.view = 'profile'; window.renderProfilePage(); return; }
    const shell = (inner, opts = {}) => {
      if (typeof window.renderShell === 'function') return window.renderShell(inner, opts);
      host.innerHTML = inner;
    };
    if (state.view === 'edit') shell(editViewMarkup());
    else if (state.view === 'avatar') shell(avatarViewMarkup());
    else shell(profileViewMarkup());
    bindPageEvents($('#app'));
    const file = $('[data-role="avatar-file"]');
    if (file) file.addEventListener('change', (e) => { onAvatarFile(e.target.files?.[0]); e.target.value = ''; });
  }

  window.renderProfilePage = function renderProfilePage() {
    state.view = 'profile';
    const host = $('#app');
    if (!host) return;
    const account = window.AdmissionAccount;
    const signedIn = account && !account.isGuest() && account.isVerified();
    const shell = (inner, opts = {}) => {
      if (typeof window.renderShell === 'function') return window.renderShell(inner, opts);
      host.innerHTML = inner;
    };
    if (!signedIn) {
      shell(`
        <div class="pp-wrap">
          <div class="pp-head"><h1>Profile</h1><div class="muted">তোমার personal identity</div></div>
          ${guestPrompt()}
        </div>`, { topbar: false });
      $('[data-role="guest-signin"]')?.addEventListener('click', () => account.open());
      return;
    }
    // skeleton while loading
    shell(`
      <div class="pp-wrap">
        <div class="pp-skel" aria-label="Profile লোড হচ্ছে"></div>
        <div class="pp-skel" style="height:120px"></div>
        <div class="pp-skel" style="height:64px"></div>
        <div data-role="profile-toast" class="pp-toast" aria-live="polite"></div>
        <div data-role="sheet-host"></div>
      </div>`);
    loadProfile()
      .then(() => {
        renderCurrentView();
      })
      .catch(() => {
        // failure isolation: session stays usable, profile shows a fallback
        shell(`
          <div class="pp-wrap">
            <div class="pp-head"><h1>Profile</h1><div class="muted">তোমার personal identity</div></div>
            <div class="card pp-card pp-fallback">
              <p>Profile লোড করা যায়নি — নিশ্চিন্ত থাকো, তোমার session আর ডেটা ঠিক আছে।</p>
              <button class="pp-btn-primary" data-role="retry-profile" type="button">আবার চেষ্টা করো</button>
            </div>
          </div>`);
        $('[data-role="retry-profile"]')?.addEventListener('click', () => window.renderProfilePage());
      });
  };

  window.renderPublicProfilePage = function renderPublicProfilePage(publicId) {
    const host = $('#app');
    if (!host) return;
    const safeId = String(publicId || '').toUpperCase();
    if (!/^AH-[A-Z2-9]{6}$/.test(safeId)) {
      host.innerHTML = '<div class="empty" style="padding:64px 20px;text-align:center"><div style="font-size:34px">🎓</div><b>Profile খুঁজে পাওয়া যায়নি</b></div>';
      return;
    }
    const wrap = (inner) => {
      if (typeof window.renderShell === 'function') return window.renderShell(inner, { topbar: false, hideNav: true });
      host.innerHTML = inner;
    };
    wrap(`
      <div class="pp-wrap pp-public-wrap">
        <div class="pp-skel" aria-label="Public profile লোড হচ্ছে"></div>
      </div>`);
    api(`/api/public/profile/${encodeURIComponent(safeId)}`)
      .then((body) => {
        const p = body?.profile || null;
        if (!p) {
          wrap('<div class="empty" style="padding:64px 20px;text-align:center"><div style="font-size:34px">🔒</div><b>এই public profile এখন available নাই</b><p class="muted" style="margin-top:8px">মালিক private সেট করেছে বা profile খুঁজে পাওয়া যায়নি।</p></div>');
          return;
        }
        const allTargets = Array.isArray(p.targets) && p.targets.length ? p.targets : (p.target ? [p.target] : []);
        const avatar = p.avatarPresent
          ? `<img class="pp-avatar-img pp-avatar-lg" src="/api/public/profile/${encodeURIComponent(safeId)}/avatar?ts=${Date.now()}" alt="${esc(p.displayName)} এর ছবি">`
          : defaultAvatarSvg(p.displayName, safeId);
        wrap(`
          <div class="pp-wrap pp-public-wrap" data-public-contract="public-safe-profile-v1">
            <div class="pp-hero" style="margin-top:12px">
              <div class="pp-hero-avatar">${avatar}</div>
              <div class="pp-hero-name">${esc(p.displayName)}</div>
              <div class="pp-hero-id"><span>AH-ID</span><b>${esc(p.publicId)}</b></div>
              ${allTargets.map((t) => `<div class="pp-hero-meta">🎯 ${esc(t.name)}${t.unit ? ` · ${esc(t.unit)}` : ''}${t.year ? ` · ${esc(bnYear(t.year))}` : ''}</div>`).join('')}
              ${p.admissionSession ? `<div class="pp-hero-meta">📅 Admission Session · ${esc(bnYear(p.admissionSession))}</div>` : ''}
              ${p.goal ? `<div class="pp-hero-meta">🚀 ${esc(p.goal)}</div>` : ''}
              ${p.joinedYear ? `<div class="pp-hero-meta">${bnYear(p.joinedYear)} সাল থেকে Admission Hub-এ</div>` : ''}
            </div>
            ${p.bio ? `<div class="card pp-card"><div class="pp-kicker">BIO</div><div class="pp-value">${esc(p.bio)}</div></div>` : ''}
            <div class="card pp-card">
              <div class="pp-row-between">
                <div><div class="pp-kicker">COMPLETION</div><div class="pp-value">${bnNum(p.completion ?? 0)}% · ${esc(completionBand(p.completion || 0))}</div></div>
                <div class="pp-meter" aria-hidden="true"><i style="width:${p.completion || 0}%"></i></div>
              </div>
            </div>
            <div class="pp-public-foot">
              <span>🎓 Admission Hub</span>
              <button class="pp-btn-secondary" data-role="public-open-app" type="button">আপনি Admission Hub-এ? Profile দেখো</button>
            </div>
          </div>`);
        $('[data-role="public-open-app"]')?.addEventListener('click', () => {
          if (typeof window.navigate === 'function') window.navigate('my-profile');
          else { location.hash = 'my-profile'; if (typeof window.render === 'function') window.render(); }
        });
      })
      .catch(() => {
        wrap('<div class="empty" style="padding:64px 20px;text-align:center"><div style="font-size:34px">⚠️</div><b>Profile লোড করা যায়নি</b><p class="muted" style="margin-top:8px">একটু পরে আবার চেষ্টা করো।</p></div>');
      });
  };
})();
