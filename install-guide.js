/*
 * Install Guide — Admission Hub
 *
 * A warm, one-time pop-up that gently invites a student to keep the app on
 * their phone ("আপনার পড়ার সঙ্গী, সবসময় সাথে"). It is platform-aware:
 *  · Android — offers the real install prompt when the browser provides one.
 *  · iPhone/iPad (iOS/iPadOS) — shows the Share → Add to Home Screen steps.
 *  · Desktop — points at the address-bar install icon.
 * It never nags: it shows once, remembers a dismissal for two weeks, and
 * stays silent when the app is already installed (standalone).
 */
(() => {
  'use strict';

  const KEY = 'ah-install-guide-v1';
  const DAY = 24 * 60 * 60 * 1000;
  const SNOOZE_DAYS = 14;
  const AUTO_DELAY_MS = 7000;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function isStandalone() {
    try {
      return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        window.navigator.standalone === true;
    } catch (_) { return false; }
  }

  function platform() {
    const ua = String((navigator && navigator.userAgent) || '');
    const touchMac = navigator && navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints) > 1;
    if (/iPad|iPhone|iPod/.test(ua) || touchMac) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'desktop';
  }

  function readState() {
    try {
      const raw = localStorage.getItem(KEY);
      const v = raw ? JSON.parse(raw) : null;
      return v && typeof v === 'object' ? v : {};
    } catch (_) { return {}; }
  }

  function writeState(next) {
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (_) { /* private mode */ }
  }

  function snooze(reason) {
    writeState(Object.assign(readState(), { dismissedAt: Date.now(), reason: reason || 'dismiss' }));
  }

  function recentlyDismissed() {
    const s = readState();
    return Number(s.dismissedAt) > 0 && (Date.now() - Number(s.dismissedAt)) < SNOOZE_DAYS * DAY;
  }

  /* The browser's real install prompt, when it offers one (Android/Chrome). */
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    try { e.preventDefault(); } catch (_) {}
    deferredPrompt = e;
  });

  const STEPS = {
    android: 'Chrome-এ ডান-উপরের ⋮ মেনু চেপে “Install app” (বা “Add to Home screen”) চাপুন।',
    ios: 'Safari-তে নিচের Share বাটন (চৌকো তীর) চেপে “Add to Home Screen” → “Add” চাপুন।',
    desktop: 'ব্রাউজারের ঠিকানা-বারের ডানদিকের ছোট ইনস্টল-আইকনে চাপ দিন।'
  };

  let root = null;
  let shown = false;

  function build() {
    const p = platform();
    const el = document.createElement('div');
    el.className = 'ahig-backdrop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'ahig-title');
    el.innerHTML = `
      <div class="ahig-card" tabindex="-1">
        <button class="ahig-close" type="button" aria-label="বন্ধ করুন">✕</button>
        <div class="ahig-badge" aria-hidden="true">📲</div>
        <h2 class="ahig-title" id="ahig-title">আপনার পড়ার সঙ্গী, সবসময় সাথে</h2>
        <p class="ahig-lead">Admission Hub ফোনে বসিয়ে নিন — এক ট্যাপেই খুলবে, আর নেট না থাকলেও পড়া যাবে।</p>
        <ol class="ahig-steps">
          <li>${esc(STEPS[p])}</li>
          <li>তারপর হোম-স্ক্রিনের আইকনে চাপ দিলেই সোজা অ্যাপের মতো খুলবে।</li>
        </ol>
        <div class="ahig-actions">
          <button class="ahig-primary" type="button" data-action="install">${p === 'android' ? 'ফোনে বসিয়ে দিন' : 'বুঝেছি, ধন্যবাদ'}</button>
          <button class="ahig-secondary" type="button" data-action="later">পরে মনে করাব</button>
        </div>
      </div>`;
    return el;
  }

  function hide(why) {
    if (!root) return;
    snooze(why);
    const node = root;
    root = null;
    node.classList.add('ahig-out');
    setTimeout(() => { try { node.remove(); } catch (_) {} }, 220);
  }

  async function show() {
    if (shown || root) return false;
    if (isStandalone()) return false;         // already installed — stay quiet
    if (recentlyDismissed()) return false;    // don't nag
    shown = true;
    root = build();
    document.body.appendChild(root);
    requestAnimationFrame(() => root && root.querySelector('.ahig-card')?.focus());

    root.addEventListener('click', async (ev) => {
      const action = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-action');
      if (ev.target === root) { hide('backdrop'); return; }
      if (ev.target && ev.target.classList.contains('ahig-close')) { hide('close'); return; }
      if (action === 'later') { hide('later'); return; }
      if (action === 'install') {
        if (deferredPrompt) {
          try {
            deferredPrompt.prompt();
            const choice = await deferredPrompt.userChoice;
            deferredPrompt = null;
            hide(choice && choice.outcome === 'accepted' ? 'accepted' : 'declined');
          } catch (_) { hide('dismiss'); }
          return;
        }
        /* No native prompt (iOS/desktop): the steps above are the answer. */
        hide('acknowledged');
      }
    });

    const onKey = (e) => { if (e.key === 'Escape') { hide('escape'); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
    return true;
  }

  function maybeAutoShow() {
    if (isStandalone() || recentlyDismissed()) return;
    setTimeout(() => { void show(); }, AUTO_DELAY_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeAutoShow, { once: true });
  } else {
    maybeAutoShow();
  }

  window.AhInstallGuide = { show, hide, isStandalone, platform, _reset: () => { try { localStorage.removeItem(KEY); } catch (_) {} } };
})();
