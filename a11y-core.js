/*
 * Accessibility core — Admission Hub
 *
 * Small, app-wide accessibility foundations that must exist everywhere:
 *  · a skip link so a keyboard user can jump straight to the content,
 *  · a focusable main-content target for that link,
 *  · a polite live region so dynamic status changes are announced,
 *  · a marker on <html> when the visitor prefers reduced motion, so CSS can
 *    calm looping animation down.
 * It is defensive: every step is wrapped so a failure here can never stop the
 * app from booting.
 */
(() => {
  'use strict';

  const MAIN_SELECTORS = ['#app main', 'main.page', 'main', '#app'];
  const MAIN_ID = 'ah-main-content';

  function addSkipLink() {
    if (!document.body || document.querySelector('.ah-skip-link')) return;
    const link = document.createElement('a');
    link.className = 'ah-skip-link';
    link.href = '#' + MAIN_ID;
    link.textContent = 'মূল কনটেন্টে যান';
    link.addEventListener('click', (e) => {
      const target = document.getElementById(MAIN_ID);
      if (!target) return;
      e.preventDefault();
      target.focus({ preventScroll: false });
      if (typeof window.ahAnnounce === 'function') window.ahAnnounce('মূল কনটেন্ট');
    });
    document.body.insertBefore(link, document.body.firstChild);
  }

  /* Give the current main content a stable, focusable id. No-op once set. */
  function tagMain() {
    const existing = document.getElementById(MAIN_ID);
    if (existing) {
      if (!existing.hasAttribute('tabindex')) existing.setAttribute('tabindex', '-1');
      return;
    }
    for (const sel of MAIN_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) {
        el.id = MAIN_ID;
        el.setAttribute('tabindex', '-1');
        return;
      }
    }
  }

  /* One polite live region the app can announce through window.ahAnnounce(). */
  function addLiveRegion() {
    if (document.getElementById('ah-live-status')) return;
    const region = document.createElement('div');
    region.id = 'ah-live-status';
    region.className = 'ah-sr-only';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    document.body.appendChild(region);
    window.ahAnnounce = (message) => {
      try {
        region.textContent = '';
        requestAnimationFrame(() => { region.textContent = String(message == null ? '' : message); });
      } catch (_) {}
    };
  }

  function markReducedMotion() {
    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      const apply = () => document.documentElement.classList.toggle('ah-reduce-motion', !!mq.matches);
      apply();
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', apply);
      else if (typeof mq.addListener === 'function') mq.addListener(apply);
    } catch (_) {}
  }

  let scheduled = false;
  function scheduleTag() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; tagMain(); });
  }

  function boot() {
    try { markReducedMotion(); } catch (_) {}
    try { addSkipLink(); } catch (_) {}
    try { tagMain(); } catch (_) {}
    try { addLiveRegion(); } catch (_) {}
    try {
      /* The SPA swaps its content; keep the skip-link target alive. */
      const mo = new MutationObserver(scheduleTag);
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
