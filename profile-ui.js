/* ============================================================
   PROFILE & PERSONAL IDENTITY — v1 (Phase 7, 2026-09-15)
   Rules:
   • Code-native, zero-raster: default avatar is generated SVG;
     the only <img> is the user's own uploaded avatar (user data).
   • Every server value renders through esc() — no unsafe HTML.
   • Profile failure never breaks the app or the session: inline
     fallback + retry only.
   • Premium + personal + academic; gentle completion (never
     pressure); mobile-first, 320px safe.
   ============================================================ */
(function () {
  'use strict';
  if (window.__profileUiInstalled) return;
  window.__profileUiInstalled = true;

  const API = '/api/auth/v1';
  const DAY = 86400000;
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const $ = (sel, root) => (root || document).querySelector(sel);
  const bnNum = (n) => Number(n || 0).toLocaleString('bn-BD');

  const state = {
    data: null,        // last GET /profile v2 payload
    version: null,     // profile_version for optimistic concurrency
    sheet: null,       // open sheet type: details|target|visibility
    busy: false
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

  /* ---------------- default avatar (generated SVG) ---------------- */

  function defaultAvatarSvg(name, seed) {
    let hash = 0;
    const value = String(seed || name || 'a');
    for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    const hue = hash % 360;
    const letters = String(name || '').trim().split(/\s+/).slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase()).join('') || 'A';
    const safe = esc(letters);
    return `<svg viewBox="0 0 96 96" role="img" aria-label="Generated avatar"><circle cx="48" cy="48" r="46" fill="hsl(${hue},45%,88%)"/><circle cx="48" cy="48" r="46" fill="none" stroke="hsl(${hue},40%,60%)" stroke-width="2"/><text x="48" y="60" font-family="system-ui,-apple-system,sans-serif" font-size="38" font-weight="700" text-anchor="middle" fill="hsl(${hue},45%,32%)">${safe}</text></svg>`;
  }

  function avatarMarkup() {
    const d = state.data || {};
    const name = d.profile?.fullName || '';
    if (d.avatar?.present) {
      return `<img class="pp-avatar-img" src="${API}/profile/avatar?ts=${Date.now()}" alt="${esc(name)} এর ছবি">`;
    }
    return `<span class="pp-avatar-svg" data-avatar-contract="zero-raster-avatar-v1">${defaultAvatarSvg(name, d.publicId || 'ah')}</span>`;
  }

  /* ---------------- completion (gentle) ---------------- */

  const COMPLETION_LABELS = [
    ['fullName', 'তোমার নাম'],
    ['dob', 'জন্মের তারিখ'],
    ['mobile', 'মোবাইল নম্বর'],
    ['school', 'স্কুল/কলেজ'],
    ['higherInstitution', 'উচ্চ শিক্ষা'],
    ['targets', 'লক্ষ্য (টার্গেট)']
  ];

  function missingItems(profile) {
    if (!profile) return COMPLETION_LABELS.map((x) => x[1]);
    const out = [];
    for (const [key, label] of COMPLETION_LABELS) {
      const v = profile[key];
      const has = key === 'targets'
        ? Array.isArray(v) && v.length > 0 && Boolean(v[0]?.name)
        : key === 'school'
          ? Boolean(v?.name)
          : key === 'higherInstitution'
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

  function completionMarkup() {
    const pct = Number(state.data?.completion || 0);
    const missing = missingItems(state.data?.profile);
    return `
      <div class="card pp-card" data-completion-contract="gentle-completion-v1">
        <div class="pp-row-between">
          <div>
            <div class="pp-kicker">PROFILE COMPLETION</div>
            <div class="pp-big">${bnNum(pct)}% <span class="pp-band">${esc(completionBand(pct))}</span></div>
          </div>
          <div class="pp-meter" aria-hidden="true"><i style="width:${pct}%"></i></div>
        </div>
        ${missing.length
          ? `<p class="pp-hint">পূরণ করার মতো: ${missing.slice(0, 3).map(esc).join(', ')}${missing.length > 3 ? '…' : ''} — যখন খুশি, নিজের ঝামেলায়।</p>`
          : `<p class="pp-hint">সব তথ্য পূর্ণ — ধন্যবাদ! ✦</p>`}
      </div>`;
  }

  /* ---------------- sections ---------------- */

  function identityCard() {
    const d = state.data || {};
    const p = d.profile || {};
    const joined = d.joinedYear ? `${bnNum(d.joinedYear)} সাল থেকে` : '';
    return `
      <div class="pp-hero" data-profile-contract="profile-identity-v1">
        <div class="pp-hero-avatar">${avatarMarkup()}</div>
        <div class="pp-hero-name">${esc(p.fullName || 'নাম যোগ করো')}</div>
        <div class="pp-hero-id" data-role="copy-public-id" title="ট্যাপ করে কপি করো">
          <span>AH-ID</span><b>${esc(d.publicId || '—')}</b>
        </div>
        ${joined ? `<div class="pp-hero-meta">${esc(joined)} Admission Hub-এ</div>` : ''}
      </div>
      <div class="pp-greeting">${esc(d.context?.greeting || 'আগে থেকেই চলো')}</div>`;
  }

  function targetCard() {
    const p = state.data?.profile || {};
    const t = Array.isArray(p.targets) && p.targets[0] ? p.targets[0] : null;
    return `
      <button class="card pp-card pp-tap" data-role="open-target" type="button">
        <div>
          <div class="pp-kicker">আকাডেমিক লক্ষ্য</div>
          ${t
            ? `<div class="pp-value">${esc(t.name)}${t.unit ? ` · ${esc(t.unit)}` : ''}${t.year ? ` · ${esc(t.year)}` : ''}</div>`
            : `<div class="pp-value pp-empty">লক্ষ্য যোগ করো — তোমার experience ব্যক্তিগত হবে</div>`}
        </div>
        <span class="pp-arrow" aria-hidden="true">→</span>
      </button>`;
  }

  function detailsCard() {
    const p = state.data?.profile || {};
    const rows = [
      ['Mobile', p.mobile || ''],
      ['Bio', p.bio || '']
    ].filter(([, v]) => String(v).length > 0);
    return `
      <button class="card pp-card pp-tap" data-role="open-details" type="button">
        <div>
          <div class="pp-kicker">ব্যক্তিগত তথ্য</div>
          <div class="pp-value ${rows.length ? '' : 'pp-empty'}">${rows.length
            ? rows.map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(' · ')
            : 'নাম, মোবাইল, bio এখানে থাকবে'}</div>
        </div>
        <span class="pp-arrow" aria-hidden="true">→</span>
      </button>`;
  }

  function statsCard() {
    return `
      <div class="card pp-card">
        <div class="pp-kicker">STATS</div>
        <div class="pp-value">তোমার প্রথম exam শেষ করলে accuracy, streak আর progress এখানে দেখা যাবে।</div>
        <button class="pp-btn-secondary" data-role="go-exam" type="button">Exam কেন্দ্রে যাও →</button>
      </div>`;
  }

  function visibilityCard() {
    const v = state.data?.profile?.visibility || 'private';
    const options = [
      ['private', 'Private', 'শুধু তুমি — public profile বন্ধ'],
      ['limited', 'Limited', 'নাম + ছবি public-এ দেখাবে'],
      ['public', 'Public', 'নাম, ছবি, লক্ষ্য, bio public-এ']
    ];
    return `
      <div class="card pp-card" data-role="open-visibility">
        <div class="pp-row-between">
          <div>
            <div class="pp-kicker">PUBLIC PROFILE</div>
            <div class="pp-value">${esc(options.find((o) => o[0] === v)?.[1] || 'Private')}: ${esc(options.find((o) => o[0] === v)?.[2] || '')}</div>
          </div>
          <span class="pp-arrow" aria-hidden="true">→</span>
        </div>
        ${v !== 'private' ? `
        <div class="pp-public-link">
          <code>${location.origin}/${esc(state.data?.publicId || '')}</code>
          <button class="pp-btn-secondary" data-role="copy-public-link" type="button">লিংক কপি</button>
        </div>` : ''}
      </div>`;
  }

  const SECTION_RENDER = {
    identity: identityCard,
    completion: completionMarkup,
    academic: targetCard,
    goal: targetCard,
    stats: statsCard,
    security: visibilityCard
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
    if (!seen.has('academic') && !seen.has('goal')) parts.splice(1, 0, targetCard());
    parts.push(detailsCard());
    return parts.join('');
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

  function detailsSheet() {
    const p = state.data?.profile || {};
    return sheetShell('ব্যক্তিগত তথ্য', `
      <label class="pp-field"><span>নাম</span>
        <input id="pp-name" type="text" maxlength="80" autocomplete="name" value="${esc(p.fullName || '')}" placeholder="তোমার পুরো নাম">
      </label>
      <label class="pp-field"><span>মোবাইল <em>(optional)</em></span>
        <input id="pp-mobile" type="tel" inputmode="tel" maxlength="16" autocomplete="tel" value="${esc(p.mobile || '')}" placeholder="+8801XXXXXXXXX">
      </label>
      <label class="pp-field"><span>Bio <em>(optional, সর্বোচ্চ ২৮০)</em></span>
        <textarea id="pp-bio" rows="3" maxlength="280" placeholder="নিজের সম্পর্কে এক লাইন…">${esc(p.bio || '')}</textarea>
      </label>
      <p class="pp-fine" data-role="sheet-error" hidden></p>
      <div class="pp-sheet-actions">
        <button class="pp-btn-primary" data-role="sheet-save-details" type="button">সংরক্ষণ করো</button>
        <button class="pp-btn-ghost" data-role="sheet-close" type="button">বাতিল</button>
      </div>`);
  }

  function targetSheet() {
    const p = state.data?.profile || {};
    const t = Array.isArray(p.targets) && p.targets[0] ? p.targets[0] : {};
    return sheetShell('আকাডেমিক লক্ষ্য', `
      <label class="pp-field"><span>ইউনিভার্সিটি / কলেজ</span>
        <input id="pp-t-name" type="text" maxlength="120" value="${esc(t.name || '')}" placeholder="যেমন: Rajshahi University">
      </label>
      <label class="pp-field"><span>Unit <em>(optional)</em></span>
        <input id="pp-t-unit" type="text" maxlength="20" value="${esc(t.unit || '')}" placeholder="যেমন: A Unit / CSE">
      </label>
      <label class="pp-field"><span>বছর <em>(optional)</em></span>
        <input id="pp-t-year" type="text" maxlength="10" value="${esc(t.year || '')}" placeholder="যেমন: 2026">
      </label>
      <p class="pp-fine" data-role="sheet-error" hidden></p>
      <div class="pp-sheet-actions">
        <button class="pp-btn-primary" data-role="sheet-save-target" type="button">লক্ষ্য সেট করো</button>
        ${t.name ? '<button class="pp-btn-ghost pp-danger" data-role="sheet-clear-target" type="button">লক্ষ্য মুছে ফেলো</button>' : ''}
        <button class="pp-btn-ghost" data-role="sheet-close" type="button">বাতিল</button>
      </div>`);
  }

  function visibilitySheet() {
    const v = state.data?.profile?.visibility || 'private';
    const options = [
      ['private', 'Private', 'কোনো public profile নেই — সব গোপন'],
      ['limited', 'Limited', 'নাম, AH-ID আর ছবি public-এ (leaderboard-style)'],
      ['public', 'Public', 'নাম, ছবি, লক্ষ্য, bio আর completion band public-এ']
    ];
    return sheetShell('Public visibility', `
      <div class="pp-vlist">
        ${options.map(([val, title, desc]) => `
          <button class="pp-vopt ${val === v ? 'on' : ''}" data-role="pick-visibility" data-value="${val}" type="button">
            <span class="pp-vradio" aria-hidden="true">${val === v ? '●' : '○'}</span>
            <span><b>${esc(title)}</b><small>${esc(desc)}</small></span>
          </button>`).join('')}
      </div>
      <p class="pp-fine">Email, mobile, DOB আর স্কুলের বিস্তারিত কখনো public হবে না — কোনো visibility-তেই নয়।</p>
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
    if (type === 'details') host.innerHTML = detailsSheet();
    else if (type === 'target') host.innerHTML = targetSheet();
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
      renderProfilePage();
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
      renderProfilePage();
      toast('Avatar সরানো হয়েছে — generated avatar ফিরেছে');
    } catch (err) {
      toast(err.message || 'Avatar সরাতে সমস্যা', true);
    } finally { state.busy = false; }
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
      if (role === 'open-details') state.sheet = 'details';
      else if (role === 'open-target') state.sheet = 'target';
      else if (role === 'open-visibility') state.sheet = 'visibility';
      else if (role === 'sheet-close' || role === 'sheet-backdrop') { closeSheet(); return; }
      else if (role === 'copy-public-id') { copyText(state.data?.publicId || '').then(() => toast('AH-ID কপি হয়েছে')); return; }
      else if (role === 'copy-public-link') { copyText(`${location.origin}/${state.data?.publicId || ''}`).then(() => toast('Public লিংক কপি হয়েছে')); return; }
      else if (role === 'go-exam') {
        if (typeof window.navigate === 'function') window.navigate('exam');
        else if (typeof window.render === 'function') { location.hash = 'exam'; window.render(); }
        return;
      }
      else if (role === 'pick-visibility') {
        const value = el.dataset.value;
        savePatch({ visibility: value }, () => { closeSheet(); renderProfilePage(); });
        return;
      }
      else if (role === 'sheet-save-details') {
        const fields = {};
        const name = $('#pp-name')?.value || '';
        const mobile = $('#pp-mobile')?.value || '';
        const bio = $('#pp-bio')?.value || '';
        if (String(name).trim().length >= 2) fields.fullName = name;
        if (String(mobile).trim()) fields.mobile = mobile;
        if (String(bio).trim()) fields.bio = bio;
        if (!Object.keys(fields).length) {
          const err = $('[data-role="sheet-error"]');
          if (err) { err.hidden = false; err.textContent = 'কিছু না পরিবর্তন করলে সংরক্ষণ করা যাবে না।'; }
          return;
        }
        savePatch(fields, () => { closeSheet(); renderProfilePage(); });
        return;
      }
      else if (role === 'sheet-save-target') {
        const name = $('#pp-t-name')?.value || '';
        const unit = $('#pp-t-unit')?.value || '';
        const year = $('#pp-t-year')?.value || '';
        if (String(name).trim().length < 2) {
          const err = $('[data-role="sheet-error"]');
          if (err) { err.hidden = false; err.textContent = 'ইউনিভার্সিটি/কলেজের নাম দাও (কমপক্ষে ২ অক্ষর)।'; }
          return;
        }
        savePatch({ target: { name, unit, year } }, () => { closeSheet(); renderProfilePage(); });
        return;
      }
      else if (role === 'sheet-clear-target') {
        savePatch({ target: null }, () => { closeSheet(); renderProfilePage(); });
        return;
      }
    });
  }

  function savePatch(fields, onDone) {
    if (state.busy) return;
    state.busy = true;
    const errEl = $('[data-role="sheet-error"]');
    if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
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
      .finally(() => { state.busy = false; });
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

  window.renderProfilePage = function renderProfilePage() {
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
        <div class="pp-head"><h1>Profile</h1><div class="muted">তোমার personal identity</div></div>
        <div class="pp-skel" aria-label="Profile লোড হচ্ছে"></div>
        <div class="pp-skel" style="height:64px"></div>
        <div class="pp-skel" style="height:64px"></div>
        <div data-role="profile-toast" class="pp-toast" aria-live="polite"></div>
        <div data-role="sheet-host"></div>
      </div>`);
    loadProfile()
      .then(() => {
        shell(`
          <div class="pp-wrap">
            <div class="pp-head">
              <div><h1>Profile</h1><div class="muted">তোমার personal identity</div></div>
              <button class="pp-iconbtn" data-role="avatar-change" type="button" aria-label="Avatar পরিবর্তন করো">📷</button>
            </div>
            ${sectionsMarkup()}
            <div class="pp-avatar-actions">
              <button class="pp-btn-secondary" data-role="avatar-change" type="button">Avatar পরিবর্তন করো</button>
              ${state.data?.avatar?.present ? '<button class="pp-btn-ghost pp-danger" data-role="avatar-remove" type="button">Avatar সরাও</button>' : ''}
              <input data-role="avatar-file" type="file" accept="image/jpeg,image/png,image/webp" hidden>
            </div>
            <div data-role="profile-toast" class="pp-toast" aria-live="polite"></div>
            <div data-role="sheet-host"></div>
          </div>`);
        bindPageEvents($('#app'));
        $('[data-role="avatar-file"]').addEventListener('change', (e) => { onAvatarFile(e.target.files?.[0]); e.target.value = ''; });
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
        const avatar = p.avatarPresent
          ? `<img class="pp-avatar-img pp-avatar-lg" src="/api/public/profile/${encodeURIComponent(safeId)}/avatar?ts=${Date.now()}" alt="${esc(p.displayName)} এর ছবি">`
          : defaultAvatarSvg(p.displayName, safeId);
        wrap(`
          <div class="pp-wrap pp-public-wrap" data-public-contract="public-safe-profile-v1">
            <div class="pp-hero" style="margin-top:12px">
              <div class="pp-hero-avatar">${avatar}</div>
              <div class="pp-hero-name">${esc(p.displayName)}</div>
              <div class="pp-hero-id"><span>AH-ID</span><b>${esc(p.publicId)}</b></div>
              ${p.target?.name ? `<div class="pp-hero-meta">🎯 ${esc(p.target.name)}${p.target.unit ? ` · ${esc(p.target.unit)}` : ''}</div>` : ''}
              ${p.joinedYear ? `<div class="pp-hero-meta">${bnNum(p.joinedYear)} সাল থেকে Admission Hub-এ</div>` : ''}
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
          else { location.hash = 'profile'; if (typeof window.render === 'function') window.render(); }
        });
      })
      .catch(() => {
        wrap('<div class="empty" style="padding:64px 20px;text-align:center"><div style="font-size:34px">⚠️</div><b>Profile লোড করা যায়নি</b><p class="muted" style="margin-top:8px">একটু পরে আবার চেষ্টা করো।</p></div>');
      });
  };
})();
