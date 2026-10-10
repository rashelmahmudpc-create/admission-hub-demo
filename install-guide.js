/*
 * Install Guide — Admission Hub
 *
 * A warm, one-time pop-up that shows a student how to keep the app on their
 * phone. Beside the written steps it plays a small, looping animation of the
 * actual gesture (Share button → Add to Home Screen → the new icon), so a
 * student who has never done it can copy it by eye.
 * It is platform-aware and never nags: it shows once, remembers a dismissal
 * for two weeks, and stays silent when the app is already installed.
 */
(() => {
  'use strict';

  const KEY = 'ah-install-guide-v1';
  const DAY = 24 * 60 * 60 * 1000;
  const SNOOZE_DAYS = 14;
  const AUTO_DELAY_MS = 7000;
  const DEMO_STEP_MS = 2400;

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

  /* Written steps, worded for the device in hand. */
  const STEPS = {
    ios: [
      'Safari-এর নিচের Share বাটনে ট্যাপ করুন।',
      '“Add to Home Screen” → “Add” চাপুন।'
    ],
    android: [
      'ব্রাউজারের উপরে-ডানে ⋮ মেনুতে ট্যাপ করুন।',
      '“Add to Home screen” → “Add” চাপুন।'
    ],
    desktop: [
      'ঠিকানা-বারের ডানদিকের ইনস্টল-আইকনে ক্লিক করুন।',
      '“Install” → “Install” চাপুন।'
    ]
  };

  /* The little motion demo: gesture → menu → result. */
  function demoMarkup(p) {
    if (p === 'ios') {
      return `
        <div class="ahig-stage" data-demo="ios" aria-hidden="true">
          <div class="ahig-bar"><span class="ahig-bar-title">admissionhub.pages.dev</span>
            <span class="ahig-share" data-anim="tap">↑</span>
          </div>
          <div class="ahig-menu" data-anim="menu">
            <div class="ahig-menu-row">অনুলিপি করুন</div>
            <div class="ahig-menu-row ahig-menu-hit" data-anim="hit">➕ Add to Home Screen</div>
            <div class="ahig-menu-row">বুকমার্ক</div>
          </div>
          <div class="ahig-result" data-anim="land"><span class="ahig-appicon">🎓</span>
            <span class="ahig-result-label">Admission Hub</span></div>
        </div>`;
    }
    if (p === 'android') {
      return `
        <div class="ahig-stage" data-demo="android" aria-hidden="true">
          <div class="ahig-bar"><span class="ahig-bar-title">admissionhub.pages.dev</span>
            <span class="ahig-dots" data-anim="tap">⋮</span>
          </div>
          <div class="ahig-menu" data-anim="menu">
            <div class="ahig-menu-row">Share</div>
            <div class="ahig-menu-row ahig-menu-hit" data-anim="hit">Install app</div>
            <div class="ahig-menu-row">Bookmark</div>
          </div>
          <div class="ahig-result" data-anim="land"><span class="ahig-appicon">🎓</span>
            <span class="ahig-result-label">Admission Hub</span></div>
        </div>`;
    }
    return `
      <div class="ahig-stage" data-demo="desktop" aria-hidden="true">
        <div class="ahig-bar"><span class="ahig-bar-title">admissionhub.pages.dev</span>
          <span class="ahig-dots" data-anim="tap">⤓</span>
        </div>
        <div class="ahig-result" data-anim="land"><span class="ahig-appicon">🎓</span>
          <span class="ahig-result-label">Admission Hub</span></div>
      </div>`;
  }

  let root = null;
  let shown = false;
  let demoTimer = 0;

  function build() {
    const p = platform();
    const steps = STEPS[p] || STEPS.desktop;
    const el = document.createElement('div');
    el.className = 'ahig-backdrop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'ahig-title');
    el.innerHTML = `
      <div class="ahig-card" tabindex="-1">
        <button class="ahig-close" type="button" aria-label="বন্ধ করুন">✕</button>
        <h2 class="ahig-title" id="ahig-title">পড়াশোনা থাকুক হাতের কাছেই 📚</h2>
        <p class="ahig-lead">Admission Hub হোম স্ক্রিনে যোগ করুন, যাতে এক ক্লিকে খুলতে পারেন এবং অফলাইনেও পড়তে পারেন।</p>
        ${demoMarkup(p)}
        <div class="ahig-howtitle">যেভাবে যোগ করবেন</div>
        <ol class="ahig-steps">
          ${steps.map(s => `<li>${esc(s)}</li>`).join('')}
        </ol>
        <p class="ahig-foot">এরপর হোম স্ক্রিন থেকেই Admission Hub খুলতে পারবেন।</p>
        <div class="ahig-actions">
          <button class="ahig-primary" type="button" data-action="install">${p === 'android' ? 'এখনই যোগ করুন' : 'বুঝেছি, ধন্যবাদ'}</button>
          <button class="ahig-secondary" type="button" data-action="later">পরে মনে করাব</button>
        </div>
      </div>`;
    return el;
  }

  function stopDemo() { if (demoTimer) { clearInterval(demoTimer); demoTimer = 0; } }

  function startDemo() {
    if (!root) return;
    const stage = root.querySelector('.ahig-stage');
    if (!stage) return;
    const seq = ['tap', 'menu', 'hit', 'land'];
    let i = 0;
    const total = seq.length * 2; // play the gesture twice, then rest on the result
    const paint = () => {
      const stepIndex = Math.min(i, seq.length - 1);
      const active = i >= total ? 'land' : seq[stepIndex];
      stage.querySelectorAll('[data-anim]').forEach(n => {
        n.classList.toggle('is-on', n.getAttribute('data-anim') === active);
        n.classList.toggle('is-done', seq.indexOf(n.getAttribute('data-anim')) < seq.indexOf(active));
      });
      i += 1;
      if (i > total) { clearInterval(demoTimer); demoTimer = 0; }
    };
    paint();
    demoTimer = setInterval(paint, DEMO_STEP_MS);
  }

  function hide(why) {
    if (!root) return;
    snooze(why);
    stopDemo();
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
    startDemo();

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
