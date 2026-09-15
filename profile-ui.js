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
  // Bengali digits generated from Unicode code points (U+09E6..U+09EF) —
  // typo-proof mapping, all ten digits guaranteed.
  const BN_DIGITS = Array.from({ length: 10 }, (_, i) => String.fromCharCode(0x09E6 + i));
  const bnYear = (y) => String(y == null ? '' : y).replace(/[0-9]/g, (d) => BN_DIGITS[d]);
  const bnDate = (ts) => {
    if (!ts) return '';
    try { return new Intl.DateTimeFormat('bn-BD', { month: 'short', year: 'numeric' }).format(new Date(ts)); }
    catch (_) { return ''; }
  };
  // DOB renders localized from the canonical ISO date (owner spec: store
  // canonical, display localized — never the reverse).
  const bnDob = (iso) => {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return '';
    try { return new Intl.DateTimeFormat('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${iso}T00:00:00`)); }
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
    prefs: loadPrefs()
  };

  // Dashboard upgrade hook: the dashboard header shows the uploaded avatar
  // once the profile has been loaded at least once in this session.
  window.__ahHasAvatar = () => state.data?.avatar?.present === true;

  /* ---------------- API ---------------- */

  // PHASE I — no request may hang forever: controlled timeout, ONE retry,
  // then a clean error the UI can turn into "Retry".
  const API_TIMEOUT_MS = 8000;
  async function api(path, opts = {}) {
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
      try {
        const res = await fetch(path, {
          credentials: 'same-origin',
          headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
          signal: controller.signal,
          ...opts
        });
        let body = null;
        try { body = await res.json(); } catch (_) { body = {}; }
        if (!res.ok) {
          const err = new Error(body?.error?.message || 'সমস্যা হয়েছে');
          err.status = res.status;
          err.code = body?.error?.code || '';
          throw err; // deterministic server answer — retrying would not help
        }
        return body;
      } catch (err) {
        lastErr = err;
        const networkLike = err.name === 'AbortError' || err.status === 0 || !err.status;
        if (networkLike && attempt === 0) { await new Promise((r) => setTimeout(r, 500)); continue; }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr || new Error('Network error');
  }

  /* ---------------- INSTANT PROFILE (owner spec): cache-first render ----
     Persistent localStorage cache per user -> render immediately on every
     navigation (no skeleton on revisit) -> silent background read-back.
     Offline edits queue to PENDING_SYNC and flush when the network returns.
     A valid cache is NEVER overwritten with null/empty data.            */
  const PROFILE_CACHE_PREFIX = 'ah-profile-cache:';
  const PROFILE_CACHE_KEY = 'ah-profile-cache-key';
  const PROFILE_QUEUE_KEY = 'ah-profile-queue-v1';

  function profileCacheWrite(data) {
    try {
      if (!data || !data.publicId || !data.profile) return; // never clobber with null
      const entry = {
        publicId: data.publicId,
        email: data.email || null,
        profile: data.profile,
        completion: data.completion ?? null,
        context: data.context || null,
        avatar: data.avatar || { present: false },
        avatarUrl: data.avatarUrl || null,
        joinedYear: data.joinedYear || null,
        ts: Date.now()
      };
      localStorage.setItem(PROFILE_CACHE_PREFIX + data.publicId, JSON.stringify(entry));
      localStorage.setItem(PROFILE_CACHE_KEY, String(data.publicId));
    } catch (_) { /* private mode — session-only, still fine */ }
  }
  function profileCacheRead() {
    try {
      const pid = localStorage.getItem(PROFILE_CACHE_KEY);
      if (!pid) return null;
      const raw = localStorage.getItem(PROFILE_CACHE_PREFIX + pid);
      const entry = raw ? JSON.parse(raw) : null;
      return (entry && entry.profile && entry.publicId === pid) ? entry : null;
    } catch (_) { return null; }
  }
  function profileCacheClear() {
    try {
      const pid = state?.data?.publicId || localStorage.getItem(PROFILE_CACHE_KEY);
      if (pid) localStorage.removeItem(PROFILE_CACHE_PREFIX + pid);
      localStorage.removeItem(PROFILE_CACHE_KEY);
      localStorage.removeItem(PROFILE_QUEUE_KEY);
    } catch (_) {}
  }
  function profileQueueRead() {
    try { const q = JSON.parse(localStorage.getItem(PROFILE_QUEUE_KEY) || '[]'); return Array.isArray(q) ? q : []; }
    catch (_) { return []; }
  }
  function profileQueueWrite(q) {
    try { localStorage.setItem(PROFILE_QUEUE_KEY, JSON.stringify(q)); } catch (_) {}
  }
  // PENDING_SYNC flush — applied in order, stops at the first failure so
  // older writes can't be reordered past a newer one.
  async function flushProfileQueue() {
    const q = profileQueueRead();
    if (!q.length || state.busy) return;
    const rest = [];
    for (const item of q) {
      try { await patch(item.fields); } catch (_) { rest.push(item); break; }
    }
    profileQueueWrite(rest);
  }
  function bindOnlineFlush() {
    try {
      window.addEventListener('online', () => {
        if (authGate() !== 'authed') return;
        loadProfile().then(() => flushProfileQueue()).then(() => {
          if (state.view === 'profile') renderCurrentView();
        }).catch(() => {});
      }, { once: true });
    } catch (_) {}
  }

  async function loadProfile() {
    const body = await api(`${API}/profile`);
    state.data = body;
    state.version = body?.profile?.version || null;
    profileCacheWrite(body);
    return body;
  }

  async function patch(fields) {
    const body = await api(`${API}/profile/patch`, {
      method: 'POST',
      body: JSON.stringify({ fields, expectVersion: state.version })
    });
    if (body?.profile) state.version = body.profile.version || state.version;
    state.data = { ...state.data, profile: body.profile };
    profileCacheWrite(state.data);
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
    const out = { ready: false, streak: null, mcqs: null, mocks: null, mastered: null, firstFlash: null, firstMock: null, earned: [] };
    try {
      const cache = window.CACHE;
      const results = Array.isArray(cache?.examResults) ? cache.examResults : [];
      const mistakes = Array.isArray(cache?.mistakes) ? cache.mistakes : [];
      const bootReady = !window.__admissionBootStatus || window.__admissionBootStatus === 'ready';
      if (bootReady && (results.length > 0 || typeof window.computeStreak === 'function')) {
        out.ready = true;
        out.streak = typeof window.computeStreak === 'function' ? (window.computeStreak() || 0) : 0;
        let mcqs = 0; let mocks = 0; let mastered = 0;
        for (const r of results) {
          const n = Number(r?.questionCount ?? r?.totalQuestions ?? (r?.snapshot || []).length) || 0;
          mcqs += n;
          const ts = Number(r?.date) || null;
          if (r?.mode === 'mock') { mocks += 1; if (ts && (!out.firstMock || ts < out.firstMock)) out.firstMock = ts; }
          else if (ts && (!out.firstFlash || ts < out.firstFlash)) out.firstFlash = ts;
        }
        for (const m of mistakes) if (m && m.mastered === true) mastered += 1;
        out.mcqs = mcqs; out.mocks = mocks; out.mastered = mastered;
        out.earned = ACHIEVEMENTS.filter((a) => achUnlocked(a, { streak: out.streak, mcqs, mocks, mastered })).map((a) => a.id);
      }
    } catch (_) { /* data unavailable — honest "—" */ }
    return out;
  }

  // Real-data achievements only (blueprint §15): icon / title / status /
  // progress / reward. Unlocks are computed from local study data — never faked.
  // `reward` is a display slot (future-reward compatible; '—' until configured).
  const ACHIEVEMENTS = [
    { id: 'first-mock', icon: '📝', name: 'First Mock', desc: 'প্রথম mock test complete করুন', target: 1, progress: (st) => Math.min(1, st.mocks || 0), reward: '—' },
    { id: 'mcq-100', icon: '📚', name: '100 MCQs', desc: 'মোট 100 MCQ complete করুন', target: 100, progress: (st) => Math.min(100, st.mcqs || 0), reward: '—' },
    { id: 'mcq-500', icon: '🏆', name: '500 MCQs', desc: 'মোট 500 MCQ complete করুন', target: 500, progress: (st) => Math.min(500, st.mcqs || 0), reward: '—' },
    { id: 'streak-7', icon: '🔥', name: '7 Day Streak', desc: '7 দিনের practice streak বানান', target: 7, progress: (st) => Math.min(7, st.streak || 0), reward: '—' },
    { id: 'mistake-crusher', icon: '🎯', name: 'Mistake Crusher', desc: '5টা mistake master করুন', target: 5, progress: (st) => Math.min(5, st.mastered || 0), reward: '—' }
  ];
  const achUnlocked = (a, st) => (a.progress(st) || 0) >= a.target;

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
      <div class="card pp-card pp-comp" data-completion-contract="official-completion-v1">
        <div class="pp-comp-row">
          ${ringMarkup(pct)}
          <div class="pp-comp-info">
            <div class="pp-kicker">PROFILE COMPLETION · ${esc(completionBand(pct))}</div>
            <p class="pp-hint">${missing.length
              ? `বাকি: ${missing.slice(0, 3).map(esc).join(', ')}${missing.length > 3 ? '…' : ''} — Profile সম্পূর্ণ করুন।`
              : 'Profile সম্পূর্ণ — ধন্যবাদ।'}</p>
            <button class="pp-comp-cta" data-role="open-edit-page" type="button">Profile সম্পূর্ণ করুন</button>
          </div>
        </div>
      </div>`;
  }

  /* ---------------- sections ---------------- */

  // Critical layout styles are also emitted inline with the page. A stale or
  // half-applied stylesheet must never be able to collapse the identity space
  // (device-cache resilience; values mirror profile-ui.css).
  const CRITICAL_CSS = `
.pp-wrap{max-width:640px;margin:0 auto;padding:0 0 8px}
.pp-hero{position:relative;overflow:hidden;text-align:left;padding:20px 18px 16px;border-radius:22px;margin-bottom:12px;background:linear-gradient(160deg,#f2fbf6 0%,#e4f6ec 48%,#d5f0e2 100%);color:#0c3b2a;border:1px solid rgba(21,128,61,.14)}
.pp-hero-wash{position:absolute;right:0;bottom:0;width:100%;height:58%;pointer-events:none}
.pp-hero-row{position:relative;display:flex;align-items:center;gap:14px}
.pp-hero-avatar{position:relative;width:72px;height:72px;flex:none;border-radius:50%;overflow:visible;display:inline-flex;align-items:center;justify-content:center;border:3px solid #16a34a;background:#eef6f1;padding:0;cursor:pointer}
.pp-avatar-img{width:100%;height:100%;object-fit:cover;display:block;border-radius:50%}
.pp-avatar-svg{display:block;width:100%;height:100%}
.pp-avatar-svg svg{width:100%;height:100%;display:block}
.pp-cam-badge{position:absolute;right:-2px;bottom:-2px;width:24px;height:24px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:12px}
.pp-hero-idblock{min-width:0;flex:1;position:relative}
.pp-hero-name{font-size:19px;font-weight:800;color:#0c3b2a;display:flex;align-items:center;gap:6px}
.pp-hero-chip{display:inline-flex;align-items:center;gap:7px;margin-top:8px;padding:4px 11px;border-radius:999px;background:rgba(255,255,255,.85);border:1px solid rgba(22,163,74,.3);color:#0b5640;font-size:12.5px;cursor:pointer;width:auto}
.pp-hero-line{font-size:12.5px;color:#166534;margin-top:8px;font-weight:650}
.pp-hero-bio{font-size:12.5px;color:#14532d;opacity:.88;margin-top:5px;line-height:1.45}
.pp-hero-edit{position:relative;margin:16px auto 0;display:block;width:100%;max-width:320px;padding:12px 20px;font-size:14px;font-weight:750;border-radius:14px;background:linear-gradient(150deg,#16a34a,#15803d);color:#fff;border:none;cursor:pointer}
.pp-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:0;margin:2px 0 12px;background:#fff;border:1px solid rgba(20,35,29,.1);border-radius:18px;padding:12px 0;cursor:pointer}
.pp-stat{display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center;min-width:0;padding:0 4px}
.pp-stat+.pp-stat{border-left:1px solid rgba(20,35,29,.08)}
.pp-stat-num{font-size:17px;font-weight:800;color:#14231d}
.pp-stat small{font-size:10px;opacity:.6}
.pp-ring{position:relative;width:64px;height:64px;flex:none;display:inline-flex;align-items:center;justify-content:center}
.pp-ring svg{width:64px;height:64px;display:block}
.pp-ring b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13.5px;font-weight:800;color:#0b5640}
.pp-ac-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:none;background:none;font:inherit;color:inherit;padding:10px 6px;cursor:pointer;border-radius:12px}`;

  // Reference hero wash — code-native SVG (soft mountains + graduation cap),
  // never a raster image.
  const HERO_WASH = `
    <svg class="pp-hero-wash" viewBox="0 0 360 190" preserveAspectRatio="xMaxYMax slice" aria-hidden="true" focusable="false">
      <path d="M0 190 L0 132 C 52 104, 96 96, 142 112 C 188 128, 236 124, 286 100 C 318 86, 342 84, 360 92 L360 190 Z" fill="#16a34a" fill-opacity="0.10"/>
      <path d="M0 190 L0 156 C 60 138, 118 132, 176 144 C 234 156, 292 150, 360 128 L360 190 Z" fill="#15803d" fill-opacity="0.12"/>
      <path d="M0 190 L0 176 C 70 164, 150 162, 224 170 C 288 176, 330 174, 360 166 L360 190 Z" fill="#166534" fill-opacity="0.10"/>
      <g transform="translate(306 58) scale(1.05)" fill="none" stroke="#15803d" stroke-opacity="0.34" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M0 8 L14 2 L28 8 L14 14 Z"/>
        <path d="M8 11 v7 c 0 2.4 11 2.4 11 0 v-7"/>
        <line x1="28" y1="8" x2="28" y2="18"/>
        <circle cx="28" cy="19.4" r="1.3" fill="#15803d" fill-opacity="0.34" stroke="none"/>
      </g>
    </svg>`;

  function identityCard() {
    const d = state.data || {};
    const p = d.profile || {};
    const year = p.admissionSession || d.joinedYear || '';
    return `
      <style>${CRITICAL_CSS}</style>
      <div class="pp-hero" data-profile-contract="profile-identity-v1">
        ${HERO_WASH}
        <div class="pp-hero-row">
          <button class="pp-hero-avatar" data-role="open-avatar-page" type="button" aria-label="Avatar পরিবর্তন করো">
            ${avatarMarkup()}
            <span class="pp-cam-badge" aria-hidden="true">📷</span>
          </button>
          <div class="pp-hero-idblock">
            <div class="pp-hero-name">${esc(p.fullName || 'নাম যোগ করো')}</div>
            <button class="pp-hero-chip" data-role="copy-public-id" type="button" title="ট্যাপ করে কপি করো">
              <span>AH-ID</span><b>${esc(d.publicId || '—')}</b><i aria-hidden="true">⧉</i>
            </button>
            <div class="pp-hero-line">🎓 Admission Candidate${year ? ` · ${esc(bnYear(year))}` : ''}</div>
            ${p.bio ? `<div class="pp-hero-bio">${esc(p.bio)}</div>` : ''}
          </div>
        </div>
        <button class="pp-btn-primary pp-hero-edit" data-role="open-edit-page" type="button">Edit Profile</button>
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
    const v = (x) => (x == null || !s.ready ? '—' : bnNum(x));
    return `
      <div class="pp-stats" data-role="go-exam" role="button" tabindex="0" aria-label="Study stats — Exam পেজে যাও">
        ${cell('🔥', v(s.streak), 'Day Streak')}
        ${cell('📚', v(s.mcqs), 'MCQs Done')}
        ${cell('📝', v(s.mocks), 'Mock Tests')}
        ${cell('🏆', v(s.earned.length), 'Achievements')}
      </div>
      ${s.ready && (s.mcqs || 0) === 0 ? '<p class="pp-fine pp-stats-hint" data-role="stats-note">প্রথম practice শেষ করলে stats এখানে জীবন্ত হয়ে উঠবে।</p>' : ''}`;
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
        <div class="pp-card-head"><span class="pp-card-title">Academic Identity</span><button class="pp-card-edit" data-role="open-academic" type="button">Edit</button></div>
        ${row('🎯', 'TARGET UNIVERSITIES', targets.map((t) => `${t.name}${t.unit ? ` (${t.unit})` : ''}`).join(', ') || 'Add target universities', 'open-academic', 'Add target universities')}
        ${row('📅', 'ADMISSION SESSION', p.admissionSession ? bnYear(p.admissionSession) : 'Not set', 'open-academic', 'Session যোগ করো')}
        ${row('🚀', 'ACADEMIC GOAL', p.academicGoal || 'Set a goal', 'open-academic', 'Set a goal — specific লক্ষ্য')}
        ${row('🧪', 'PREFERRED SUBJECTS', Array.isArray(p.subjects) && p.subjects.length ? p.subjects.join(', ') : 'Add subjects', 'open-academic', 'কোন subject পছন্দ?')}
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

  function achievementRowMarkup(a, st) {
    const prog = a.progress(st) || 0;
    const on = prog >= a.target;
    const pct = Math.min(100, Math.round((prog / a.target) * 100));
    return `
      <div class="pp-ach-row ${on ? 'on' : 'lock'}" data-ach-id="${a.id}" data-ach-progress="${pct}">
        <span class="pp-ach-ic" aria-hidden="true">${on ? a.icon : '🔒'}</span>
        <div class="pp-ach-body">
          <div class="pp-ach-line"><b>${esc(a.name)}</b><span class="pp-ach-status">${on ? 'Unlocked' : 'Locked'}</span></div>
          <div class="pp-ach-bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
          <small>${esc(a.desc)} · ${prog} / ${a.target} · Reward: ${esc(a.reward)}</small>
        </div>
      </div>`;
  }

  function achievementsCard() {
    const s = localStats();
    return `
      <div class="card pp-card pp-achv">
        <div class="pp-card-head"><span class="pp-card-title">Achievements</span><button class="pp-card-edit" data-role="open-achv-sheet" type="button">View All</button></div>
        <div class="pp-ach-list" data-achievements-contract="achv-progress-v1">
          ${ACHIEVEMENTS.slice(0, 3).map((a) => achievementRowMarkup(a, s)).join('')}
        </div>
        ${s.ready && s.earned.length === 0 ? '<p class="pp-ach-empty" data-role="achievements-empty">প্রথম achievement-এর জন্য practice শুরু করুন।</p>' : ''}
        <p class="pp-fine">Real data থেকে unlock হয় — কোনো fake progress নেই।</p>
      </div>`;
  }

  function aiPrefsSummary(pf) {
    const style = pf.langStyle === 'en' ? 'English' : pf.langStyle === 'mix' ? 'বাংলা+English' : 'বাংলা';
    const tone = String(pf.tone || 'friendly').charAt(0).toUpperCase() + String(pf.tone || 'friendly').slice(1);
    const len = String(pf.responseLen || 'balanced').charAt(0).toUpperCase() + String(pf.responseLen || 'balanced').slice(1);
    return `${style} · ${tone} · ${len}`;
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
        ${row('🎨', 'Appearance', pf.appearance === 'dark' ? 'Dark' : pf.appearance === 'system' ? 'System' : pf.appearance === 'green' ? 'Premium Green' : 'Light Mode', 'pref-appearance')}
        ${row('🤖', 'AI Personalization', state.aiPrefs ? aiPrefsSummary(state.aiPrefs) : 'Set your style', 'open-ai-prefs')}
        <p class="pp-fine">Explicit settings — তুমি কী চাও সেটা তুমিই ঠিক করো।</p>
      </div>`;
  }

  function privacyCard() {
    const v = state.data?.profile?.visibility || 'private';
    const isPublic = v === 'public';
    return `
      <div class="card pp-card pp-privacy" data-role="open-privacy-page">
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

  /* ------- dedicated pages (reference panels 5/6) ------- */
  function prefsPageMarkup() {
    const pf = state.prefs;
    const row = (icon, label, value, role, extra = '') => `
      <button class="pp-pref-row" data-role="${role}" type="button">
        <span class="pp-pref-ic" aria-hidden="true">${icon}</span>
        <span class="pp-pref-label">${label}</span>
        <span class="pp-pref-value ${extra}">${value}</span>
        <span class="pp-arrow" aria-hidden="true">→</span>
      </button>`;
    return `
      <div class="pp-topbar">
        <button class="pp-iconbtn pp-topbar-back" data-role="prefs-back" type="button" aria-label="← Profile">←</button>
        <h1 class="pp-topbar-title">Preferences</h1>
        <span class="pp-topbar-spacer" aria-hidden="true"></span>
      </div>
      <div class="card pp-card pp-prefs-page">
        ${row('🌐', 'Language', pf.language === 'en' ? 'English' : 'বাংলা (Bengali)', 'pref-language')}
        ${row('🔔', 'Notifications', pf.notifications === 'on' ? 'On' : 'Off', 'pref-notifications')}
        ${row('🎨', 'Appearance', pf.appearance === 'dark' ? 'Dark' : pf.appearance === 'system' ? 'System' : pf.appearance === 'green' ? 'Premium Green' : 'Light Mode', 'pref-appearance')}
        ${row('🤖', 'AI Personalization', state.aiPrefs ? aiPrefsSummary(state.aiPrefs) : 'Set your style', 'open-ai-prefs')}
      </div>
      <p class="pp-fine">Explicit settings — তুমি কী চাও সেটা তুমিই ঠিক করো।</p>
      <button class="pp-btn-primary pp-page-save" data-role="prefs-save" type="button">Save Changes</button>
      <div data-role="profile-toast" class="pp-toast" aria-live="polite"></div>
      <div data-role="sheet-host"></div>`;
  }

  function privacyPageMarkup() {
    const v = state.data?.profile?.visibility || 'private';
    const isPublic = v === 'public';
    const visible = isPublic
      ? ['Name', 'Bio', 'Admission Goal', 'Target Universities', 'Academic Session', 'Achievements', 'Preferred Subjects']
      : (v === 'limited' ? ['Name', 'AH-ID', 'Avatar'] : []);
    return `
      <div class="pp-topbar">
        <button class="pp-iconbtn pp-topbar-back" data-role="privacy-back" type="button" aria-label="← Profile">←</button>
        <h1 class="pp-topbar-title">Privacy &amp; Visibility</h1>
        <span class="pp-topbar-spacer" aria-hidden="true"></span>
      </div>
      <div class="card pp-card pp-priv-page">
        <div class="pp-priv-row">
          <div>
            <div class="pp-value">Public Profile</div>
            <p class="pp-fine">${isPublic ? 'Allow others to view your public information' : 'Public নয় — কেউ দেখতে পাবে না'}</p>
          </div>
          <button class="pp-switch ${isPublic ? 'on' : ''}" data-role="toggle-public" type="button" role="switch" aria-checked="${isPublic}" aria-label="Public Profile toggle"><i></i></button>
        </div>
        ${v !== 'private' ? `
        <div class="pp-public-link">
          <code>${location.origin}/${esc(state.data?.publicId || '')}</code>
          <button class="pp-btn-secondary" data-role="copy-public-link" type="button">লিংক কপি</button>
        </div>` : ''}
      </div>
      <div class="card pp-card pp-priv-visible">
        <h3>What will be visible?</h3>
        ${visible.length
          ? `<ul>${visible.map((x) => `<li><span aria-hidden="true">✓</span>${x}</li>`).join('')}</ul>`
          : '<p class="pp-fine">Private — এখনো কিছুই public নয়।</p>'}
      </div>
      ${v !== 'private' ? `
      <button class="card pp-card pp-priv-row" data-role="open-visibility" type="button">
        <span class="pp-pref-ic" aria-hidden="true">🛡</span>
        <span class="pp-pref-label">Visibility level</span>
        <span class="pp-pref-value">${v === 'public' ? 'Public' : 'Limited'}</span>
        <span class="pp-arrow" aria-hidden="true">→</span>
      </button>` : ''}
      <div class="pp-priv-safe">
        <span aria-hidden="true">🛡</span>
        <p><b>Your personal information</b>(email, mobile, DOB) will never be visible to others.</p>
      </div>
      <div data-role="profile-toast" class="pp-toast" aria-live="polite"></div>
      <div data-role="sheet-host"></div>`;
  }

  // Reference "Profile updated successfully!" modal (post-save confirmation).
  function successModal() {
    return `
      <div class="pp-modal-backdrop" data-role="modal-backdrop">
        <div class="pp-modal" role="dialog" aria-modal="true" aria-label="Profile updated successfully">
          <div class="pp-modal-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#16a34a" stroke-width="2"/><path d="M7.5 12.5l3 3 6-6.5" stroke="#16a34a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          <b>Profile updated successfully!</b>
          <small>Your changes have been saved.</small>
          <button class="pp-btn-primary" data-role="modal-ok" type="button">OK</button>
        </div>
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

  // PHASE J — error boundary: one broken section must never blank the page.
  const safeSection = (key, fn) => {
    try {
      const html = fn();
      if (typeof html === 'string' && html) return html;
      return '';
    } catch (err) {
      // Isolate the failure; the rest of the profile keeps working.
      return `<div class="card pp-card pp-section-error" data-role="section-error" data-section="${key}"><p class="pp-fine">এই অংশটা দেখা যাচ্ছে না — বাকি সব ঠিক আছে।</p></div>`;
    }
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
      if (fn) parts.push(safeSection(key, fn));
    }
    if (!seen.has('identity')) parts.unshift(safeSection('identity', identityCard));
    if (!seen.has('academic') && !seen.has('goal')) parts.splice(1, 0, safeSection('academic', academicCard));
    if (!seen.has('security')) parts.push(safeSection('security', privacyCard));
    // fixed identity-space tail (not reordered by context)
    parts.push(safeSection('journey', journeyCard));
    parts.push(safeSection('achievements', achievementsCard));
    parts.push(safeSection('prefs', prefsCard));
    parts.push(safeSection('account', accountCard));
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
          <span></span>
        </div>
        <div class="pp-edit-photo">
          <div class="pp-edit-photo-img">${avatarPreviewMarkup(84)}</div>
          <button class="pp-btn-secondary" data-role="open-avatar-page" type="button">Change Photo</button>
        </div>
        <label class="pp-field"><span>Full Name *</span>
          <input id="pp-edit-name" type="text" maxlength="80" autocomplete="name" value="${esc(p.fullName || '')}" placeholder="তোমার পুরো নাম">
        </label>
        <div class="pp-field pp-field-ro" data-email-row-contract="email-readonly-v1">
          <span>Email <em class="pp-ro-chip">Not editable</em></span>
          <div class="pp-ro-value">${esc(state.data?.email || p.email || '—')}</div>
        </div>
        <label class="pp-field"><span>Mobile Number ${p.mobile ? '<em class="pp-saved-chip">✓ Saved</em>' : '<em>(optional)</em>'}</span>
          <input id="pp-edit-mobile" type="tel" inputmode="tel" maxlength="16" autocomplete="tel" value="${esc(p.mobile || '')}" placeholder="+8801XXXXXXXXX">
        </label>
        <label class="pp-field"><span>Date of Birth</span>
          <input id="pp-edit-dob" type="date" value="${esc(p.dob || '')}">
          <small class="pp-fine" data-role="dob-preview" ${p.dob ? '' : 'hidden'}>${bnDob(p.dob)}</small>
        </label>
        <label class="pp-field"><span>Bio <em>(optional, সর্বোচ্চ ২৮০)</em></span>
          <textarea id="pp-edit-bio" rows="3" maxlength="280" placeholder="নিজের সম্পর্কে এক লাইন…">${esc(p.bio || '')}</textarea>
          <small class="pp-bio-count" data-role="bio-count">${bioLen}/280</small>
        </label>
        <p class="pp-fine" data-role="sheet-error" hidden></p>
        <p class="pp-fine pp-edit-dirty" data-role="edit-dirty" hidden>অপরিবর্তিত কিছু নেই — পরিবর্তন করলে Save হবে</p>
        <button class="pp-btn-primary pp-edit-save" data-role="edit-save" type="button" data-save-engine-contract="central-save-v1">Save Changes</button>
      </div>`;
  }

  /* ---------------- avatar page ---------------- */

  function avatarPageMarkup() {
    const hasPhoto = state.data?.avatar?.present === true;
    return `
      <div class="pp-edit">
        <div class="pp-edit-top">
          <button class="pp-iconbtn" data-role="back-profile" type="button" aria-label="ফিরে যাও">←</button>
          <h2>Change Avatar</h2>
          ${hasPhoto ? '<button class="pp-iconbtn pp-danger" data-role="avatar-remove" type="button" aria-label="Photo সরাও">🗑</button>' : '<span></span>'}
        </div>
        <div class="pp-av-current">
          ${avatarPreviewMarkup(120)}
          <div class="pp-av-current-label">${hasPhoto ? 'Current Avatar' : 'Default Avatar'}</div>
        </div>
        <button class="pp-btn-primary pp-av-pick" data-role="av-capture-open" type="button">📷 Take Photo</button>
        <label class="pp-btn-secondary pp-av-pick" type="button">🖼️ Choose from Gallery
          <input data-role="avatar-file-gallery" type="file" accept="image/jpeg,image/png,image/webp" hidden>
        </label>
        <input data-role="avatar-file-capture" type="file" accept="image/*" capture="environment" hidden>
        <div class="pp-av-hint" data-avatar-hint-contract="square-crop-v1">
          <span aria-hidden="true">✅</span>
          <div><b>Best photo size</b><small>1:1 · সর্বোচ্চ 2MB · JPG, PNG</small></div>
        </div>
        ${state.avatarError ? `<p class="pp-fine pp-av-err" role="alert">${esc(state.avatarError)}</p>` : ''}
        <div class="pp-av-sec">Default Avatars</div>
        <div class="pp-av-defaults">
          ${[0, 1, 2, 3, 4, 5].map((st) => `
            <button class="pp-av-def ${state.prefs.avatarStyle === st ? 'on' : ''}" data-role="pick-default-avatar" data-style="${st}" type="button" aria-label="Default style ${st + 1}">
              ${defaultAvatarSvg(state.data?.profile?.fullName || 'A', state.data?.publicId || 'ah', st)}
            </button>`).join('')}
        </div>
        <p class="pp-fine">নাম থেকে generated — কোনো ছবি দিতে হবে না।</p>
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

  /* ------- Academic Identity — dedicated edit page (reference panel 3) -------
     Owner spec: units/subjects come from window.AH_AcademicCatalog —
     university + session driven, never a generic A/B/C/D assumption.
     The UI selectors below contain NO unit arrays of their own. */
  const acadCat = () => (typeof window.AH_AcademicCatalog === 'object' && window.AH_AcademicCatalog) || null;

  function academicDraftInit() {
    const p = state.data?.profile || {};
    state.acad = {
      targets: Array.isArray(p.targets) ? p.targets.filter((t) => t && t.name).map((t) => ({ name: String(t.name), unit: String(t.unit || ''), year: String(t.year || '') })) : [],
      session: String(p.admissionSession || ''),
      goal: String(p.academicGoal || ''),
      subjects: Array.isArray(p.subjects) ? p.subjects.map((x) => String(x)).filter(Boolean) : [],
      manual: new Set(Array.isArray(p.subjects) ? p.subjects.map((x) => String(x)).filter(Boolean) : []),
      pendingUni: '',
      pendingUnit: '',
      suggestOpen: false
    };
  }

  // Unit change re-validates: subjects outside the new unit's official list
  // are dropped (manually added ones are kept — owner data is never lost).
  function acadInvalidateSubjects() {
    const d = state.acad;
    const cat = acadCat();
    if (!cat || !d.pendingUni || !d.pendingUnit) return;
    const official = cat.subjectsFor(d.pendingUni, d.session, d.pendingUnit);
    if (!official.length) return;
    d.subjects = d.subjects.filter((s) => official.includes(s) || d.manual.has(s));
  }

  // Active unit context: pending selection first, else the first
  // catalog-known target (for rendering its official subjects).
  function acadUnitContext() {
    const d = state.acad;
    const cat = acadCat();
    let uniId = d.pendingUni || '';
    let unitId = d.pendingUnit || '';
    if (!uniId && d.targets.length) {
      const u0 = cat ? cat.getUniversity(d.targets[0].name) : null;
      if (u0 && d.targets[0].unit) { uniId = u0.id; unitId = d.targets[0].unit; }
    }
    if (!uniId) return { uniId: '', unitId: '', units: [], subjects: [], uniName: '' };
    const u = cat ? cat.getUniversity(uniId) : null;
    const units = cat && d.session ? cat.unitsFor(uniId, d.session) : [];
    const subjects = cat && unitId ? cat.subjectsFor(uniId, d.session, unitId) : [];
    return { uniId, unitId, units, subjects, uniName: u ? u.name : uniId };
  }

  function academicPageMarkup() {
    if (!state.acad) academicDraftInit();
    const d = state.acad;
    const cat = acadCat();
    const ctx = acadUnitContext();
    const sessions = cat ? cat.listSessions() : [];
    const sessionOpts = sessions.map((s) => `<option value="${esc(s.id)}" ${d.session === s.id ? 'selected' : ''}>${esc(s.label)}${s.status === 'provisional' ? ' (provisional)' : ''}</option>`).join('');
    // extra = attributes for the CHIP SPAN itself (a leaked text arg renders
    // raw markup — contract: no-attribute-leak-v1).
    const chip = (label, xrole, extra) => `<span class="pp-chip pp-chip-lg"${extra || ''}>${label}<button class="pp-chip-x" data-role="${xrole}" type="button" aria-label="মুছে ফেলো">×</button></span>`;
    const targetsHtml = d.targets.map((t, i) => `
      <span class="pp-chip pp-chip-lg pp-acad-target" data-index="${i}">
        <b class="pp-acad-prio" aria-hidden="true">${bnYear(i + 1)}.</b>${esc(t.name)}${t.unit ? ` <em>· ${esc(t.unit)}</em>` : ''}${t.year ? ` <em>· ${esc(t.year)}</em>` : ''}
        ${i > 0 ? `<button class="pp-chip-move" data-role="acad-move-target" data-index="${i}" data-dir="-1" type="button" aria-label="উপরে">▲</button>` : ''}
        ${i < d.targets.length - 1 ? `<button class="pp-chip-move" data-role="acad-move-target" data-index="${i}" data-dir="1" type="button" aria-label="নিচে">▼</button>` : ''}
        <button class="pp-chip-x" data-role="acad-del-target" data-index="${i}" type="button" aria-label="মুছে ফেলো">×</button>
      </span>`).join('');
    const addRow = d.targets.length < 5 ? `
      <div class="pp-acad-addrow pp-acad-addrow-multi">
        <div class="pp-acad-uni">
          <input id="pp-acad-u" type="text" maxlength="120" placeholder="ইউনিভার্সিটি লিখো… (যেমন: CU, ঢাকা, BUET)" aria-label="University" autocomplete="off">
          <div id="pp-acad-ulist" class="pp-acad-ulist" hidden></div>
        </div>
        <select id="pp-acad-unit" ${ctx.units.length ? '' : 'disabled'} aria-label="Unit">
          <option value="">Unit —</option>
          ${ctx.units.map((u) => `<option value="${esc(u.id)}" ${ctx.unitId === u.id ? 'selected' : ''}>${esc(u.id)} — ${esc(cat.groupLabel(ctx.uniId, d.session, u.id))}</option>`).join('')}
        </select>
        <input id="pp-acad-year" type="text" maxlength="10" placeholder="Year (optional)" aria-label="Year">
        <button class="pp-btn-secondary" data-role="acad-add-target" type="button">+ Add</button>
      </div>
      <p class="pp-fine" data-acad-catalog-contract="catalog-driven-units-v1">Unit ও subject নির্ভর করে নির্বাচিত university + session-এর official catalog-এর ওপর।</p>` : '<p class="pp-fine">সর্বোচ্চ 5টা target রাখা যায়।</p>';
    const subjChecked = (s) => d.subjects.some((x) => x.toLowerCase() === s.toLowerCase());
    const officialBlock = ctx.subjects.length
      ? `<p class="pp-fine">Official subjects — <b>${esc(ctx.uniName)} · ${esc(ctx.unitId)} · ${esc(d.session || '—')}</b>:</p>
        <div class="pp-acad-subjgrid" data-role="acad-subjgrid">
          ${ctx.subjects.map((s) => `<label class="pp-acad-subj"><input type="checkbox" class="pp-acad-subjbox" value="${esc(s)}" ${subjChecked(s) ? 'checked' : ''}><span>${esc(s)}</span></label>`).join('')}
        </div>`
      : '<p class="pp-fine">Target-এ university + unit নির্বাচন করলে ওই unit-এর official subject-গুলো এখানে দেখাবে।</p>';
    const otherSubjs = ctx.subjects.length ? d.subjects.filter((s) => !ctx.subjects.includes(s)) : d.subjects;
    const otherChips = otherSubjs.map((x) => chip(esc(x), 'acad-del-subject', ` data-value="${esc(x)}"`)).join('');
    return `
      <div class="pp-topbar">
        <button class="pp-iconbtn pp-topbar-back" data-role="acad-back" type="button" aria-label="← Profile">←</button>
        <h1 class="pp-topbar-title">Academic Identity</h1>
        <span class="pp-topbar-spacer" aria-hidden="true"></span>
      </div>
      <section class="pp-card pp-acad-sec">
        <h2>📅 Admission Session</h2>
        <label class="pp-field"><span>Session</span>
          <div class="pp-select-wrap"><select id="pp-acad-session" aria-label="Admission session"><option value="">— Select —</option>${sessionOpts}</select><svg aria-hidden="true" viewBox="0 0 12 8"><path d="M1 1.8 6 6.6 11 1.8"/></svg></div>
        </label>
      </section>
      <section class="pp-card pp-acad-sec">
        <h2>🎯 Target Universities <em class="pp-fine">(১ম = first choice)</em></h2>
        <div class="pp-acad-chips">
          ${targetsHtml || '<p class="pp-fine">এখনো কোনো target নেই — নিচে যোগ করো।</p>'}
        </div>
        ${addRow}
      </section>
      <section class="pp-card pp-acad-sec">
        <h2>🚀 Academic Goal</h2>
        <label class="pp-field"><span>তোমার goal <em>(সর্বোচ্চ ১৬০)</em></span>
          <textarea id="pp-acad-goal" rows="3" maxlength="160" placeholder="যেমন: 2026-এ CU CSE-তে ভর্তি হবো">${esc(d.goal)}</textarea>
        </label>
        <p class="pp-fine pp-right"><span data-role="acad-goal-count">${d.goal.length}</span>/160</p>
      </section>
      <section class="pp-card pp-acad-sec">
        <h2>🧪 Preferred Subjects <em class="pp-fine">(সর্বোচ্চ ৮)</em></h2>
        ${officialBlock}
        <div class="pp-acad-chips pp-acad-otherchips">
          ${otherChips || '<p class="pp-fine">অন্য subject থাকলে নিচে add করো।</p>'}
        </div>
        ${d.subjects.length < 8 ? `
        <div class="pp-acad-addrow">
          <input id="pp-acad-subject" type="text" maxlength="40" placeholder="অন্য subject (manual)" aria-label="Subject">
          <button class="pp-btn-secondary" data-role="acad-add-subject" type="button">+ Add</button>
        </div>` : '<p class="pp-fine">সর্বোচ্চ 8টা subject রাখা যায়।</p>'}
      </section>
      <p class="pp-fine pp-acad-err" data-role="acad-error" hidden></p>
      <button class="pp-btn-primary pp-acad-save" data-role="acad-save" type="button">Save Changes</button>`;
  }

  // Catalog search suggestions — swap the list node only (keeps input focus).
  function updateUniSuggestions(input) {
    const box = $('#pp-acad-ulist');
    if (!box) return;
    const cat = acadCat();
    const q = String(input?.value || '').trim();
    if (!cat || !q) { box.hidden = true; box.innerHTML = ''; return; }
    const hits = cat.searchUniversities(q, 5);
    if (!hits.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.innerHTML = hits.map((h) => `<button type="button" class="pp-acad-uitem" data-role="acad-pick-uni" data-uni="${esc(h.university.id)}"><b>${esc(h.university.name)}</b><small>${esc((h.university.aliases || []).slice(0, 3).join(' · '))}</small></button>`).join('');
    box.hidden = false;
  }

  function acadErr(msg) {
    const el = $('[data-role="acad-error"]');
    if (el) { el.textContent = msg; el.hidden = false; }
  }

  // Multi-field save: one PATCH with only the changed fields (single source of truth).
  function saveAcademicPage() {
    if (state.busy) return; // double-tap guard
    const d = state.acad;
    const p = state.data?.profile || {};
    const fields = {};
    const targets = d.targets
      .filter((t) => t && String(t.name).trim())
      .slice(0, 5)
      .map((t) => ({ name: String(t.name).trim().replace(/\s+/g, ' ').slice(0, 120), unit: String(t.unit || '').trim().replace(/\s+/g, ' ').slice(0, 20), year: String(t.year || '').trim().slice(0, 10) }))
      .filter((t) => t.name.length >= 2);
    const session = String(d.session || '').trim();
    const goal = String(d.goal || '').trim();
    const subjects = d.subjects.map((x) => String(x).trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean).slice(0, 8);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (!same(targets, Array.isArray(p.targets) ? p.targets.filter((t) => t && t.name) : [])) fields.targets = targets;
    if (session !== String(p.admissionSession || '')) fields.admissionSession = session;
    if (goal !== String(p.academicGoal || '')) fields.academicGoal = goal;
    if (!same(subjects, Array.isArray(p.subjects) ? p.subjects : [])) fields.subjects = subjects;
    const btn = $('[data-role="acad-save"]');
    if (Object.keys(fields).length === 0) {
      if (btn) { btn.disabled = true; btn.classList.add('pp-save-ok'); btn.textContent = '✓ সব already saved'; }
      toast('কোনো পরিবর্তন নেই।');
      return;
    }
    savePatch(fields, () => {
      state.view = 'profile';
      state.showSuccessModal = true; // reference "Profile updated successfully!" modal
      renderProfilePage();
    });
  }

  function academicViewMarkup() {
    return `
      <div class="pp-wrap">
        ${academicPageMarkup()}
        <div data-role="profile-toast" class="pp-toast" aria-live="polite"></div>
        <div data-role="sheet-host"></div>
      </div>`;
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
    return sheetShell('Achievements', `
      <div class="pp-ach-list pp-ach-list-full">
        ${ACHIEVEMENTS.map((a) => achievementRowMarkup(a, s)).join('')}
      </div>
      <p class="pp-fine">Real study data থেকে unlock হয় — কোনো fake progress নেই।</p>
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
      <div class="pp-kicker">LANGUAGE — whole app</div>
      <div class="pp-vlist">
        ${opt('bn', 'বাংলা (Bengali)', 'ডিফল্ট — সব পেজে প্রয়োগ হয়')}
        ${opt('en', 'English', 'সব পেজে প্রয়োগ হয়')}
      </div>
      <div class="pp-kicker" style="margin-top:14px">APPEARANCE — all pages, nav, cards</div>
      <div class="pp-vlist">
        ${appt('light', 'Light', 'ডিফল্ট থিম')}
        ${appt('dark', 'Dark', 'রাতের মোড')}
        ${appt('system', 'System', 'Device-এর সাথে মানানসই')}
        ${appt('green', 'Premium Green', 'Admission Hub signature green')}
      </div>
      <div class="pp-sheet-actions"><button class="pp-btn-ghost" data-role="sheet-close" type="button">বাতিল</button></div>`);
  }

  const AI_PREFS_DEFAULT = { langStyle: 'bn', tone: 'friendly', responseLen: 'balanced', memory: true };
  const aiOpt = (role, val, label, current) => `
      <button class="pp-vopt ${current === val ? 'on' : ''}" data-role="${role}" data-value="${val}" type="button">
        <span class="pp-vradio" aria-hidden="true">${current === val ? '●' : '○'}</span>
        <span><b>${esc(label)}</b></span>
      </button>`;
  function aiPrefsSheet() {
    const pf = state.aiPrefs || AI_PREFS_DEFAULT;
    return sheetShell('AI Personalization', `
      <p class="pp-fine" data-ai-prefs-contract="ai-personalization-v1">এই পছন্দ শুধু তোমার AI চ্যাটে প্রয়োগ হয় — অন্য user-এর সাথে কখনো share হয় না।</p>
      <div class="pp-kicker">LANGUAGE STYLE</div>
      <div class="pp-vlist">
        ${aiOpt('pick-ai-style', 'bn', 'বাংলা', pf.langStyle)}
        ${aiOpt('pick-ai-style', 'en', 'English', pf.langStyle)}
        ${aiOpt('pick-ai-style', 'mix', 'বাংলা + English', pf.langStyle)}
      </div>
      <div class="pp-kicker" style="margin-top:14px">TONE</div>
      <div class="pp-vlist">
        ${aiOpt('pick-ai-tone', 'friendly', 'Friendly', pf.tone)}
        ${aiOpt('pick-ai-tone', 'professional', 'Professional', pf.tone)}
        ${aiOpt('pick-ai-tone', 'simple', 'Simple', pf.tone)}
        ${aiOpt('pick-ai-tone', 'motivating', 'Motivating', pf.tone)}
        ${aiOpt('pick-ai-tone', 'direct', 'Direct', pf.tone)}
      </div>
      <div class="pp-kicker" style="margin-top:14px">RESPONSE</div>
      <div class="pp-vlist">
        ${aiOpt('pick-ai-len', 'short', 'Short', pf.responseLen)}
        ${aiOpt('pick-ai-len', 'balanced', 'Balanced', pf.responseLen)}
        ${aiOpt('pick-ai-len', 'detailed', 'Detailed', pf.responseLen)}
      </div>
      <div class="pp-kicker" style="margin-top:14px">MEMORY</div>
      <div class="pp-vlist">
        <div class="pp-priv-row">
          <div>
            <div class="pp-value">Conversation Memory</div>
            <p class="pp-fine">AI তোমার আগের কথা মনে রাখবে (device+account-এ save হয়)</p>
          </div>
          <button class="pp-switch ${pf.memory ? 'on' : ''}" data-role="toggle-ai-memory" type="button" role="switch" aria-checked="${pf.memory}" aria-label="AI memory"><i></i></button>
        </div>
      </div>
      <p class="pp-fine" data-role="ai-prefs-status" hidden></p>
      <div class="pp-sheet-actions"><button class="pp-btn-ghost" data-role="sheet-close" type="button">বাতিল</button></div>`);
  }

  function refreshAiPrefsSheet(statusMsg) {
    const host = document.querySelector('[data-role="sheet-host"]');
    if (!host) return;
    host.innerHTML = aiPrefsSheet();
    if (statusMsg) {
      const el = host.querySelector('[data-role="ai-prefs-status"]');
      if (el) { el.hidden = false; el.textContent = statusMsg; }
    }
  }

  async function saveAiPrefs() {
    if (state.aiSaving) return;
    state.aiSaving = true;
    try {
      const body = await api('/api/ai/prefs', { method: 'POST', body: JSON.stringify(state.aiPrefs) });
      state.aiPrefs = body?.prefs || state.aiPrefs;
      refreshAiPrefsSheet('Save হয়েছে ✓ — পরের chat-এই প্রয়োগ হবে।');
    } catch (e) {
      refreshAiPrefsSheet('Save fail — আবার চেষ্টা করো।');
      toast('AI preferences save fail', true);
    } finally { state.aiSaving = false; }
  }

  async function loadAiPrefs() {
    if (state.aiPrefs) return;
    try {
      const body = await api('/api/ai/prefs');
      state.aiPrefs = body?.prefs || { ...AI_PREFS_DEFAULT };
    } catch (_) {
      state.aiPrefs = { ...AI_PREFS_DEFAULT };
    }
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
    if (type === 'journey') host.innerHTML = journeySheet();
    else if (type === 'achv') host.innerHTML = achvSheet();
    else if (type === 'aiprefs') { host.innerHTML = aiPrefsSheet(); }
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

  /* -------- avatar capture -> CROP MODAL (zoom + pan) -> 512x512 JPEG -> save -------- */
  const crop = { img: null, url: null, zoom: 1, px: 0, py: 0, drag: null };
  const CROP_BOX = 160; // display size of the crop circle (matches CSS)

  function openCropModal(file) {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      crop.img = im;
      crop.url = url;
      crop.zoom = 1;
      crop.px = 0;
      crop.py = 0;
      renderCrop();
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      state.avatarError = 'ছবিটা পড়া যায়নি — অন্য ছবি দিয়ে দেখুন।';
      renderCurrentView();
    };
    im.src = url;
  }

  function cropModalMarkup() {
    return `
      <div class="pp-crop-overlay" role="dialog" aria-modal="true" aria-label="Crop avatar">
        <div class="pp-crop">
          <div class="pp-edit-top">
            <button class="pp-iconbtn" data-role="crop-cancel" type="button" aria-label="বাতিল">✕</button>
            <h2>Crop Avatar</h2>
            <span></span>
          </div>
          <div class="pp-crop-stage" data-role="crop-stage">
            <div class="pp-crop-circle">
              <img data-role="crop-img" alt="" draggable="false">
            </div>
          </div>
          <div class="pp-crop-zoom">
            <button class="pp-iconbtn" data-role="crop-zoom-out" type="button" aria-label="ছোট করো">−</button>
            <div class="pp-crop-zoomtrack"><div class="pp-crop-zoomdot" data-role="crop-zoomdot"></div></div>
            <button class="pp-iconbtn" data-role="crop-zoom-in" type="button" aria-label="বড় করো">+</button>
          </div>
          <p class="pp-fine pp-crop-hint">ধরে টানুন · বড় ছোট করুন — ফেস মাঝখানে থাকবে</p>
          <div class="pp-crop-actions">
            <button class="pp-btn-ghost" data-role="crop-cancel" type="button">Cancel</button>
            <button class="pp-btn-primary" data-role="crop-save" type="button" data-crop-save-contract="crop-save-v1">✓ Save Avatar</button>
          </div>
        </div>
      </div>`;
  }

  function renderCrop() {
    let host = document.getElementById('pp-crop-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'pp-crop-host';
      document.body.appendChild(host);
    }
    host.innerHTML = cropModalMarkup();
    const imgEl = host.querySelector('[data-role="crop-img"]');
    if (imgEl) imgEl.src = crop.url;
    applyCropTransform();
    const stage = host.querySelector('[data-role="crop-stage"]');
    if (stage) {
      stage.style.touchAction = 'none';
      stage.addEventListener('pointerdown', (e) => {
        crop.drag = { x: e.clientX, y: e.clientY, px: crop.px, py: crop.py };
        try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      });
      stage.addEventListener('pointermove', (e) => {
        if (!crop.drag) return;
        crop.px = crop.drag.px + (e.clientX - crop.drag.x);
        crop.py = crop.drag.py + (e.clientY - crop.drag.y);
        clampCropPan();
        applyCropTransform();
      });
      const end = () => { crop.drag = null; };
      stage.addEventListener('pointerup', end);
      stage.addEventListener('pointercancel', end);
    }
  }

  function clampCropPan() {
    const im = crop.img;
    if (!im) return;
    const base = Math.max(CROP_BOX / im.naturalWidth, CROP_BOX / im.naturalHeight) * crop.zoom;
    const maxX = Math.max(0, (im.naturalWidth * base - CROP_BOX) / 2);
    const maxY = Math.max(0, (im.naturalHeight * base - CROP_BOX) / 2);
    crop.px = Math.min(maxX, Math.max(-maxX, crop.px));
    crop.py = Math.min(maxY, Math.max(-maxY, crop.py));
  }

  function applyCropTransform() {
    const host = document.getElementById('pp-crop-host');
    if (!host) return;
    const imgEl = host.querySelector('[data-role="crop-img"]');
    if (imgEl) imgEl.style.transform = `translate(${crop.px}px, ${crop.py}px) scale(${crop.zoom})`;
    const dot = host.querySelector('[data-role="crop-zoomdot"]');
    if (dot) dot.style.left = `${((crop.zoom - 1) / 2) * 100}%`;
  }

  function closeCrop() {
    if (crop.url) { URL.revokeObjectURL(crop.url); crop.url = null; }
    crop.img = null;
    crop.zoom = 1;
    crop.px = 0;
    crop.py = 0;
    const host = document.getElementById('pp-crop-host');
    if (host) host.innerHTML = '';
  }

  async function saveCrop() {
    const im = crop.img;
    if (!im) return;
    state.avatarBusy = true;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(512 / im.naturalWidth, 512 / im.naturalHeight) * crop.zoom;
      const dx = (512 - im.naturalWidth * scale) / 2 + crop.px * (512 / CROP_BOX);
      const dy = (512 - im.naturalHeight * scale) / 2 + crop.py * (512 / CROP_BOX);
      ctx.fillStyle = '#eef3ef';
      ctx.fillRect(0, 0, 512, 512);
      ctx.drawImage(im, dx, dy, im.naturalWidth * scale, im.naturalHeight * scale);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const b64 = dataUrl.split(',')[1];
      closeCrop();
      await uploadAvatarBase64(b64, 'image/jpeg');
    } catch (_) {
      state.avatarBusy = false;
      renderCurrentView();
    }
  }

  async function uploadAvatarBase64(b64, mime) {
    state.avatarBusy = true;
    state.avatarError = '';
    renderCurrentView();
    try {
      await api(`${API}/profile/avatar`, { method: 'POST', body: JSON.stringify({ data: b64, mime }) });
      state.data = await loadProfile();
      state.showSuccessModal = true;
      renderCurrentView();
    } catch (e) {
      const msg = String((e && e.message) || '');
      if (/timeout|aborted/i.test(msg)) state.avatarError = 'টাইম আউট — ইন্টারনেট চেক করে আবার চেষ্টা করুন।';
      else if (/2MB|size|larger/i.test(msg)) state.avatarError = 'ছবিটা 2MB-এর বেশি — ছোট ছবি ব্যবহার করুন।';
      else state.avatarError = 'Save fail — আবার চেষ্টা করুন।';
      renderCurrentView();
    } finally {
      state.avatarBusy = false;
    }
  }

  async function onAvatarRemove() {
    if (state.busy) return;
    state.busy = true;
    try {
      await api(`${API}/profile/avatar`, { method: 'DELETE' });
      state.data = await loadProfile();
      renderCurrentView();
      toast('Avatar সরানো হয়েছে — generated avatar ফিরেছে');
    } catch (err) {
      toast(err.message || 'Avatar সরাতে সমস্যা', true);
    } finally { state.busy = false; }
  }

  function onAvatarFilePick(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { state.avatarError = 'File type support করে না — JPG/PNG দিন।'; renderCurrentView(); return; }
    if (file.size > 2_000_000) { state.avatarError = 'ছবিটা 2MB-এর বেশি — ছোট ছবি ব্যবহার করুন।'; renderCurrentView(); return; }
    openCropModal(file);
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

  // Delegated handlers are bound ONCE per host element — re-renders replace
  // innerHTML (not the host), so a second binding would double-fire every
  // click (duplicate saves, double navigations).
  const boundHosts = new WeakSet();
  function bindPageEvents(root) {
    if (!root) return;
    if (!boundHosts.has(root)) {
      boundHosts.add(root);
      root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-role]');
      if (!el) return;
      const role = el.dataset.role;
      if (role === 'open-target' || role === 'open-session' || role === 'open-goal' || role === 'open-subjects' || role === 'open-academic') {
        academicDraftInit();
        state.view = 'academic';
        renderCurrentView();
        return;
      }
      else if (role === 'open-prefs-sheet') {
        state.view = 'prefs';
        renderCurrentView();
        return;
      }
      else if (role === 'prefs-back') {
        state.view = 'profile';
        renderProfilePage();
        return;
      }
      else if (role === 'prefs-save') {
        savePrefs(state.prefs);
        toast('Preferences সেভ হয়েছে ✓');
        return;
      }
      else if (role === 'privacy-back') {
        state.view = 'profile';
        renderProfilePage();
        return;
      }
      else if (role === 'modal-ok') {
        const m = document.querySelector('[data-role="modal-backdrop"]');
        if (m) m.remove();
        return;
      }
      else if (role === 'open-journey-sheet') state.sheet = 'journey';
      else if (role === 'open-achv-sheet') state.sheet = 'achv';
      else if (role === 'open-prefs-sheet') state.sheet = 'prefs';
      else if (role === 'open-visibility') state.sheet = 'visibility';
      else if (role === 'open-privacy-page') { state.view = 'privacy'; renderCurrentView(); return; }
      else if (role === 'sheet-close' || role === 'sheet-backdrop') { closeSheet(); return; }
      else if (role === 'open-edit-page') { state.view = 'edit'; renderCurrentView(); return; }
      else if (role === 'open-avatar-page') { state.view = 'avatar'; renderCurrentView(); return; }
      else if (role === 'back-profile') { state.view = 'profile'; renderCurrentView(); return; }
      else if (role === 'av-capture-open') {
        const cap = $('[data-role="avatar-file-capture"]');
        if (cap) cap.click();
        return;
      }
      else if (role === 'crop-cancel') { closeCrop(); return; }
      else if (role === 'crop-zoom-in') { crop.zoom = Math.min(3, crop.zoom + 0.25); clampCropPan(); applyCropTransform(); return; }
      else if (role === 'crop-zoom-out') { crop.zoom = Math.max(1, crop.zoom - 0.25); clampCropPan(); applyCropTransform(); return; }
      else if (role === 'crop-save') { saveCrop(); return; }
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
      else if (role === 'pick-language') {
        if (el.disabled) return;
        state.prefs.language = el.dataset.value;
        savePrefs(state.prefs);
        try { if (window.AhI18n) window.AhI18n.set(el.dataset.value); } catch (_) {}
        closeSheet(); renderCurrentView(); toast('Language সেভ হয়েছে ✓');
        return;
      }
      else if (role === 'pick-appearance') {
        if (el.disabled) return;
        state.prefs.appearance = el.dataset.value;
        savePrefs(state.prefs);
        try { if (window.AhAppearance) window.AhAppearance.set(el.dataset.value); } catch (_) {}
        closeSheet(); renderCurrentView(); toast('Appearance সেভ হয়েছে ✓');
        return;
      }
      else if (role === 'open-ai-prefs') {
        if (!state.aiPrefs) { loadAiPrefs().then(() => { state.sheet = 'aiprefs'; renderCurrentView(); }); }
        else { state.sheet = 'aiprefs'; renderCurrentView(); }
        return;
      }
      else if (role === 'pick-ai-style' || role === 'pick-ai-tone' || role === 'pick-ai-len') {
        if (!state.aiPrefs) state.aiPrefs = { ...AI_PREFS_DEFAULT };
        const key = role === 'pick-ai-style' ? 'langStyle' : role === 'pick-ai-tone' ? 'tone' : 'responseLen';
        state.aiPrefs[key] = el.dataset.value;
        refreshAiPrefsSheet();
        saveAiPrefs();
        return;
      }
      else if (role === 'toggle-ai-memory') {
        if (!state.aiPrefs) state.aiPrefs = { ...AI_PREFS_DEFAULT };
        state.aiPrefs.memory = !state.aiPrefs.memory;
        refreshAiPrefsSheet();
        saveAiPrefs();
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
      else if (role === 'acad-back') {
        state.view = 'profile';
        renderProfilePage();
        return;
      }
      else if (role === 'acad-add-target') {
        const d = state.acad;
        const cat = acadCat();
        const uText = String($('#pp-acad-u')?.value || '').trim().replace(/\s+/g, ' ');
        let name = uText;
        if (d.pendingUni && cat) {
          const u = cat.getUniversity(d.pendingUni);
          if (u) name = u.name; // official catalog name wins
        }
        const unit = String($('#pp-acad-unit')?.value || d.pendingUnit || '').trim().replace(/\s+/g, ' ');
        const year = String($('#pp-acad-year')?.value || '').trim().replace(/\s+/g, ' ').slice(0, 10);
        if (name.length < 2) { acadErr('ইউনিভার্সিটির নাম দাও (কমপক্ষে ২ অক্ষর)।'); return; }
        if (name.length > 120) { acadErr('নামটি বড় হয়ে গেছে।'); return; }
        if (unit.length > 20) { acadErr('Unit সর্বোচ্চ ২০ অক্ষর।'); return; }
        if (d.targets.some((t) => t.name.toLowerCase() === name.toLowerCase())) { acadErr('এই target আগেই আছে।'); return; }
        d.targets.push({ name, unit, year });
        d.pendingUni = '';
        d.pendingUnit = '';
        renderCurrentView();
        return;
      }
      else if (role === 'acad-pick-uni') {
        const d = state.acad;
        d.pendingUni = String(el.dataset.uni || '');
        d.pendingUnit = '';
        d.suggestOpen = false;
        renderCurrentView();
        return;
      }
      else if (role === 'acad-move-target') {
        const d = state.acad;
        const i = Number(el.dataset.index);
        const j = i + Number(el.dataset.dir || 0);
        if (j < 0 || j >= d.targets.length) return;
        const t = d.targets.splice(i, 1)[0];
        d.targets.splice(j, 0, t);
        renderCurrentView();
        return;
      }
      else if (role === 'acad-del-target') {
        state.acad.targets.splice(Number(el.dataset.index), 1);
        renderCurrentView();
        return;
      }
      else if (role === 'acad-add-subject') {
        const d = state.acad;
        const v = String($('#pp-acad-subject')?.value || '').trim().replace(/\s+/g, ' ');
        if (!v) { acadErr('Subject-এর নাম দাও।'); return; }
        if (v.length > 40) { acadErr('Subject-এর নাম 40 অক্ষরের বেশি হতে পারে না।'); return; }
        if (d.subjects.some((x) => x.toLowerCase() === v.toLowerCase())) { acadErr('Subjectটা আগেই আছে।'); return; }
        if (d.subjects.length >= 8) { acadErr('সর্বোচ্চ 8টা subject রাখা যায়।'); return; }
        d.subjects.push(v);
        if (d.manual) d.manual.add(v); // manual picks survive unit switches
        renderCurrentView();
        return;
      }
      else if (role === 'acad-del-subject') {
        state.acad.subjects = state.acad.subjects.filter((x) => x !== el.dataset.value);
        renderCurrentView();
        return;
      }
      else if (role === 'brand-bell') {
        try { window.NotificationHub?.openCenter?.(); } catch (_) { toast('Notification center এখনো ready নয়।'); }
        return;
      }
      else if (role === 'brand-account') {
        window.AdmissionAccount?.open();
        return;
      }
      else if (role === 'acad-save') {
        saveAcademicPage();
        return;
      }
      else if (role === 'edit-save') {
        saveEditPage();
        return;
      }
    });
  }
  // Per-element listeners run on EVERY render — the nodes are new each time,
  // so a once-per-root binding would orphan them (counter/UX regression).
  const bio = $('#pp-edit-bio');
  if (bio) bio.addEventListener('input', () => {
    const c = $('[data-role="bio-count"]');
    if (c) c.textContent = `${bio.value.length}/280`;
  });
  const goal = $('#pp-acad-goal');
  if (goal) goal.addEventListener('input', () => {
    const c = $('[data-role="acad-goal-count"]');
    if (c) c.textContent = String(goal.value.length);
  });
  // Academic page — the session SELECT must reach the draft on every change
  // (owner bug: stale select => false "কোনো পরিবর্তন নেই" + fake already-saved).
  const sessSel = $('#pp-acad-session');
  if (sessSel) sessSel.addEventListener('change', () => {
    const d = state.acad;
    d.session = String(sessSel.value || '').trim();
    const cat = acadCat();
    if (d.pendingUni && d.pendingUnit && cat) {
      const ok = cat.unitsFor(d.pendingUni, d.session).some((u) => u.id === d.pendingUnit);
      if (!ok) d.pendingUnit = '';
      acadInvalidateSubjects();
    }
    renderCurrentView();
  });
  const unitSel = $('#pp-acad-unit');
  if (unitSel) unitSel.addEventListener('change', () => {
    const d = state.acad;
    d.pendingUnit = String(unitSel.value || '');
    acadInvalidateSubjects(); // unit change re-validates subject selection
    renderCurrentView();
  });
  const uniInput = $('#pp-acad-u');
  if (uniInput) uniInput.addEventListener('input', () => updateUniSuggestions(uniInput));
  // Official subject checkboxes — toggle the draft, re-render chip/counter row.
  const subjBoxes = Array.from(document.querySelectorAll('.pp-acad-subjbox'));
  if (subjBoxes.length) subjBoxes.forEach((box) => box.addEventListener('change', () => {
    const d = state.acad;
    const v = String(box.value || '');
    if (!v) return;
    if (box.checked) {
      if (!d.subjects.some((x) => x.toLowerCase() === v.toLowerCase()) && d.subjects.length < 8) d.subjects.push(v);
    } else {
      d.subjects = d.subjects.filter((x) => x.toLowerCase() !== v.toLowerCase());
    }
    renderCurrentView();
  }));
  // DOB stored canonical (YYYY-MM-DD) — preview the localized Bangla value.
  const dobIn = $('#pp-edit-dob');
  if (dobIn) dobIn.addEventListener('input', () => {
    const pv = $('[data-role="dob-preview"]');
    if (pv) { const t = bnDob(dobIn.value); pv.hidden = !t; pv.textContent = t; }
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

  function editReadFields() {
    const p = state.data?.profile || {};
    return {
      name: String($('#pp-edit-name')?.value || '').trim(),
      mobile: String($('#pp-edit-mobile')?.value || '').trim(),
      dob: String($('#pp-edit-dob')?.value || '').trim(),
      bio: String($('#pp-edit-bio')?.value || '').trim(),
      p
    };
  }
  function editDirty() {
    const { name, mobile, dob, bio, p } = editReadFields();
    return name !== (p.fullName || '')
      || mobile !== (p.mobile || '')
      || dob !== (p.dob || '')
      || bio !== (p.bio || '');
  }
  function editValidate(fields) {
    const { name, mobile, bio } = fields;
    if (name !== (fields.p.fullName || '') && name.length < 2) return 'নাম কমপক্ষে ২ অক্ষরের হতে হবে।';
    if (mobile !== (fields.p.mobile || '')) {
      const digits = mobile.replace(/[\s()-]/g, '');
      if (digits && !/^\+?[0-9]{8,15}$/.test(digits)) return 'সঠিক মোবাইল নম্বর দাও (যেমন: +8801XXXXXXXXX)।';
    }
    if (bio.length > 280) return 'Bio সর্বোচ্চ ২৮০ অক্ষর হতে পারে।';
    return '';
  }
  function refreshEditDirty() {
    const btn = $('button[data-role="edit-save"]');
    const hint = $('[data-role="edit-dirty"]');
    if (!btn) return;
    const fields = editReadFields();
    const dirty = editDirty();
    const invalid = editValidate(fields);
    const usable = dirty && !invalid;
    btn.classList.toggle('pp-save-idle', !dirty);
    btn.classList.toggle('pp-save-dirty', usable);
    if (hint) hint.hidden = !dirty;
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
    savePatch(fields, () => { state.view = 'profile'; state.showSuccessModal = true; renderProfilePage(); });
  }

  // Save button state machine (master prompt §06):
  // SAVE CHANGES → SAVING… → SUCCESS ✓ (server confirmed) → re-render
  //                → FAILED → Try Again (with the real reason)
  function savePatch(fields, onDone) {
    if (state.busy) return; // double-tap guard — এক tap-এ এক request
    state.busy = true;
    const errEl = $('[data-role="sheet-error"]') || $('[data-role="acad-error"]');
    if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
    const btn = $('button[data-role="edit-save"]') || $('button[data-role="acad-save"]');
    const failBtn = (msg) => {
      if (btn) {
        btn.classList.remove('pp-save-busy', 'pp-save-ok');
        btn.classList.add('pp-save-fail');
        btn.disabled = false;
        btn.textContent = 'Try Again';
      }
      if (errEl && msg) { errEl.hidden = false; errEl.textContent = msg; }
    };
    if (btn) { btn.classList.remove('pp-save-fail'); btn.classList.add('pp-save-busy'); btn.disabled = true; btn.textContent = 'Saving…'; }
    patch(fields)
      .then(async () => {
        // Server confirmed — frontend "success" নয়, real persistence এর পর।
        if (btn) { btn.classList.remove('pp-save-busy'); btn.classList.add('pp-save-ok'); btn.textContent = 'SUCCESS ✓'; }
        toast('সংরক্ষিত হয়েছে ✓');
        window.setTimeout(async () => {
          // PHASE M — READ-BACK: save-এর পর canonical data আবার fetch করে UI
          // সেটাই দেখায় যা database-এ আছে। "looks changed, refresh-এ পুরনো"
          // সম্ভবই নয়।
          try { await loadProfile(); } catch (_) { /* read-back fail: server already confirmed the write */ }
          onDone && onDone();
        }, 400);
      })
      .catch((err) => {
        if (err.status === 409) {
          failBtn('এই সময়ে অন্য জায়গা থেকে পরিবর্তন হয়েছে — latest version load হচ্ছে…');
          return loadProfile().then(renderProfilePage).catch(() => {});
        }
        if (err.status === 429) {
          failBtn('একটু দ্রুত বেশি — এক-দু সেকেন্ড পরে আবার চেষ্টা করো।');
          return;
        }
        // Offline / network loss — never lose the edit: queue it as
        // PENDING_SYNC, flush automatically when the network returns.
        const offlineLike = !window.navigator.onLine || err.status === 0 || !err.status || err.name === 'AbortError';
        if (offlineLike) {
          const q = profileQueueRead();
          q.push({ fields, ts: Date.now() });
          profileQueueWrite(q);
          failBtn('অফলাইন — পরিবর্তনগুলো PENDING_SYNC-এ রাখা হয়েছে; নেট ফিরলে নিজেই save হবে।');
          return;
        }
        failBtn(err.message || 'সংরক্ষণ করা যায়নি — আবার চেষ্টা করো।');
      })
      .finally(() => {
        state.busy = false;
        const b = $('button[data-role="edit-save"]') || $('button[data-role="acad-save"]');
        if (b && b.classList.contains('pp-save-busy')) { b.classList.remove('pp-save-busy'); b.disabled = false; b.textContent = 'Save Changes'; }
      });
  }

  /* ---------------- pages ---------------- */

  // Guest art — code-native person + leaves (reference guest card), zero raster.
  const GUEST_ART = `
    <svg viewBox="0 0 120 96" aria-hidden="true" focusable="false">
      <g fill="none" stroke="#16a34a" stroke-opacity="0.55" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="46" cy="34" r="15"/>
        <path d="M18 82c2.5-17 13-25 28-25s25.5 8 28 25"/>
      </g>
      <g fill="none" stroke="#22c55e" stroke-opacity="0.5" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M88 22c10-8 20-8 26-4-2 10-10 16-20 15-3-4-6-8-6-11z"/>
        <path d="M90 20c6 6 10 12 12 19"/>
        <path d="M84 70c6-4 14-5 19-2-2 7-8 11-15 10-2-3-4-6-4-8z"/>
      </g>
      <circle cx="96" cy="60" r="2.4" fill="#22c55e" fill-opacity="0.4"/>
      <circle cx="70" cy="14" r="2" fill="#16a34a" fill-opacity="0.35"/>
      <circle cx="108" cy="44" r="1.8" fill="#22c55e" fill-opacity="0.4"/>
    </svg>`;

  function guestPrompt() {
    const benefits = [
      'সব progress save হবে',
      'Exam history সব device-এ',
      'Academic profile — target, session, goal',
      'Leaderboard ও rewards',
      'AI তোমার জন্য personalized'
    ];
    return `
      <div class="card pp-card pp-guest" data-guest-contract="guest-profile-v2">
        <div class="pp-guest-art" aria-hidden="true">${GUEST_ART}</div>
        <h2>Your Profile</h2>
        <p class="pp-guest-sub">Sign in to create your profile — এক identity, সব device-এ।</p>
        <div class="pp-guest-actions">
          <button class="pp-guest-google" data-role="guest-google" type="button" data-guest-google-contract="guest-google-cta-v1"><span class="pp-google-g" aria-hidden="true">G</span>Continue with Google</button>
          <div class="pp-guest-duo">
            <button class="pp-guest-duo-btn" data-role="guest-signin" type="button">Log in</button>
            <button class="pp-guest-duo-btn" data-role="guest-create" type="button">Sign up</button>
          </div>
        </div>
        <div class="pp-guest-benefits">
          <b>With your profile, you can:</b>
          <ul>${benefits.map((b) => `<li><span aria-hidden="true">✓</span>${b}</li>`).join('')}</ul>
        </div>
      </div>`;
  }

  function profileViewMarkup() {
    const modal = state.showSuccessModal ? successModal() : '';
    state.showSuccessModal = false;
    return `
      <div class="pp-wrap">
        ${brandHeader()}
        ${sectionsMarkup()}
        ${modal}
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
    const gate = authGate();
    if (gate !== 'authed') { state.view = 'profile'; window.renderProfilePage(); return; }
    const shell = (inner, opts = {}) => {
      if (typeof window.renderShell === 'function') return window.renderShell(inner, opts);
      host.innerHTML = inner;
    };
    if (state.view === 'edit') shell(editViewMarkup(), { topbar: false });
    else if (state.view === 'avatar') shell(avatarViewMarkup(), { topbar: false });
    else if (state.view === 'academic') shell(academicViewMarkup(), { topbar: false });
    else if (state.view === 'prefs') shell(prefsPageMarkup(), { topbar: false });
    else if (state.view === 'privacy') shell(privacyPageMarkup(), { topbar: false });
    else shell(profileViewMarkup(), { topbar: false });
    bindPageEvents($('#app'));
    const gal = $('[data-role="avatar-file-gallery"]');
    if (gal) gal.addEventListener('change', (e) => onAvatarFilePick(e.target));
    const cap = $('[data-role="avatar-file-capture"]');
    if (cap) cap.addEventListener('change', (e) => onAvatarFilePick(e.target));
    if (state.view === 'edit') {
      ['pp-edit-name', 'pp-edit-mobile', 'pp-edit-dob', 'pp-edit-bio'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', refreshEditDirty);
      });
      refreshEditDirty();
    }
  }

  // Reference brand row (top of the Profile home) — code-native leaf mark.
  function brandHeader() {
    return `
      <div class="pp-brand" data-brand-contract="profile-brand-row-v1">
        <span class="pp-brand-logo" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="15" fill="#e7f6ee"/><path d="M16 25c0-6.5 2.6-10.5 7-13-1 7-3.2 11.2-7 13z" fill="#16a34a"/><path d="M16 25c0-5-2-8.2-5.6-10.3.8 5.7 2.6 8.9 5.6 10.3z" fill="#22c55e"/></svg>
        </span>
        <div class="pp-brand-text"><b>Admission Hub</b><small>Your Admission. Our Mission.</small></div>
        <span class="pp-brand-actions">
          <button class="pp-brand-ic" data-role="brand-bell" type="button" aria-label="Notifications">🔔</button>
          <button class="pp-brand-ic" data-role="brand-account" type="button" aria-label="Account">👤</button>
        </span>
      </div>`;
  }

  /* ---------------- AUTH STABLE (Phase 7B3) — 3-state gate ----------------
     AUTH_LOADING  → skeleton (never guest, never stale)
     AUTHENTICATED → real profile
     GUEST         → guest card (only after the auth check COMPLETED)          */
  function authGate() {
    const acc = window.AdmissionAccount;
    if (!acc) return 'loading';
    if (acc.isVerified()) return 'authed'; // verified session — render immediately (no flash during background refresh)
    const st = typeof acc.getSessionState === 'function' ? String(acc.getSessionState() || '') : '';
    if (st === 'UNAUTHENTICATED') return 'guest'; // check finished, no session
    return 'loading'; // INITIALIZING / CHECKING_SESSION / REFRESHING / RECOVERING / EXPIRING / ERROR
  }

  function profileSkeleton() {
    return `
      <div class="pp-wrap" data-auth-gate="loading" aria-busy="true">
        ${brandHeader()}
        <div class="pp-skel-pp" aria-hidden="true">
          <div class="pp-skel-row"><div class="pp-skel pp-skel-avatar"></div>
            <div class="pp-skel-col"><div class="pp-skel pp-skel-name"></div><div class="pp-skel pp-skel-chip"></div><div class="pp-skel pp-skel-line"></div></div>
          </div>
          <div class="pp-skel pp-skel-stats"></div>
          <div class="pp-skel pp-skel-card"></div>
          <div class="pp-skel pp-skel-card"></div>
        </div>
        <p class="pp-fine pp-skel-note" data-role="skeleton-note">Login যাচাই হচ্ছে…</p>
      </div>`;
  }

  let authChangeBound = false;
  function bindAuthGate() {
    if (authChangeBound) return;
    authChangeBound = true;
    window.addEventListener('admissionhub:authchange', () => {
      // Session gone (logout/terminate) — drop the local profile cache and
      // drafts so the next user on this device never sees this user's data.
      const acc = window.AdmissionAccount;
      const stillAuthed = !!(acc && (
        acc.isVerified() ||
        (typeof acc.getSessionState === 'function' &&
          ['AUTHENTICATED', 'REFRESHING', 'RECOVERING'].includes(String(acc.getSessionState() || '')))));
      if (!stillAuthed && state.data) {
        profileCacheClear();
        state.data = null;
        state.version = null;
        state.acad = null;
      }
      // Re-render only the profile home — never the edit/avatar pages (input safety).
      if (state.view === 'profile') {
        try { window.renderProfilePage(); } catch (_) {}
      }
    });
  }

  window.renderProfilePage = function renderProfilePage() {
    state.view = 'profile';
    const host = $('#app');
    if (!host) return;
    const account = window.AdmissionAccount;
    const shell = (inner, opts = {}) => {
      if (typeof window.renderShell === 'function') return window.renderShell(inner, opts);
      host.innerHTML = inner;
    };
    bindAuthGate();
    const gate = authGate();
    if (gate === 'loading') {
      // AUTH_LOADING: skeleton only — never a guest fallback, never stale data.
      shell(profileSkeleton(), { topbar: false });
      return;
    }
    if (gate === 'guest') {
      // GUEST: auth check COMPLETE and no authenticated user.
      shell(`
        <div class="pp-wrap">
          ${brandHeader()}
          ${guestPrompt()}
        </div>`, { topbar: false });
      // Continue with Google — account sheet welcome view (Google One Tap first control).
      $('[data-role="guest-google"]')?.addEventListener('click', () => account.open());
      $('[data-role="guest-signin"]')?.addEventListener('click', () => {
        account.open();
        window.setTimeout(() => document.querySelector('[data-role="welcome-login"]')?.click(), 120);
      });
      // Sign up — same honest account flow, deep-linked to the signup step.
      $('[data-role="guest-create"]')?.addEventListener('click', () => {
        account.open();
        window.setTimeout(() => document.querySelector('[data-role="welcome-signup"]')?.click(), 120);
      });
      return;
    }
    // AUTHENTICATED. First open (no data yet): skeleton for the profile fetch.
    // Revisit (data cached): render instantly, refresh silently in background.
    // Persistent cache (ah-profile-cache): even on a fresh app start the
    // profile paints BEFORE the network round-trip — no skeleton, no blank.
    if (!state.data) {
      const cached = profileCacheRead();
      if (cached) {
        state.data = cached;
        state.version = cached.profile?.version || null;
      } else {
        shell(profileSkeleton(), { topbar: false });
      }
    }
    if (state.data) {
      shell(profileViewMarkup(), { topbar: false });
      bindPageEvents($('#app'));
    }
    bindOnlineFlush();
    Promise.all([loadProfile(), loadAiPrefs()])
      .then(() => flushProfileQueue())
      .then(() => {
        if (state.view !== 'profile') return; // user navigated away — no clobber
        renderCurrentView();
      })
      .catch(() => {
        if (state.view !== 'profile') return;
        // Failure isolation: session stays authenticated; only the profile
        // data is unavailable. NEVER downgrade to guest.
        shell(`
          <div class="pp-wrap" data-auth-gate="error">
            ${brandHeader()}
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
