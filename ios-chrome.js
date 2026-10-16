/* Owner 2026-10-16/17: native-app feel on iPhone (Home-Screen PWA, black-translucent
 * status bar, viewport-fit=cover).
 *  1. Status-bar / notch strip always matches the screen right below it.
 *  2. Pinch / double-tap zoom and sideways drag are off (iOS ignores user-scalable=no).
 *  3. The outer page never rubber-bands or pull-refreshes; real inner scrollers
 *     (lists, forms, sheets) still scroll, and nothing is blocked while the
 *     keyboard is up so a focused field can always be brought into view. */
(() => {
  'use strict';
  const css = document.createElement('style');
  css.id = 'ah-ios-chrome';
  css.textContent = 'html{touch-action:manipulation;overflow-x:hidden;overscroll-behavior:none}'
    + 'body{touch-action:manipulation;overflow-x:clip;overscroll-behavior:none;max-width:100%}'
    // android-runtime-fix.js forces `html, body{overscroll-behavior-y:auto!important}` on every
    // platform, which re-enabled the iPhone rubber-band. :root raises specificity above it.
    + ':root,:root>body{overscroll-behavior:none!important}'
    + '#ah-status-scrim{position:fixed;top:0;left:0;right:0;height:env(safe-area-inset-top,0px);z-index:1150;pointer-events:none;transition:background-color .2s}'
    + 'body.ah-account-page-active #ah-status-scrim{display:none}';
  document.head.append(css);

  const stop = event => event.preventDefault();
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(type => document.addEventListener(type, stop, { passive: false }));

  /* ---- 3. outer-shell bounce / pull-to-refresh guard ---- */
  const EDITABLE = 'input,textarea,select,[contenteditable=""],[contenteditable="true"],[data-allow-touch-move]';
  const canScrollY = el => {
    if (el.scrollHeight <= el.clientHeight + 1) return false;
    const oy = getComputedStyle(el).overflowY;
    return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
  };
  const canScrollX = el => {
    if (el.scrollWidth <= el.clientWidth + 1) return false;
    const ox = getComputedStyle(el).overflowX;
    return ox === 'auto' || ox === 'scroll' || ox === 'overlay';
  };
  let lastX = 0, lastY = 0;
  document.addEventListener('touchstart', event => {
    if (event.touches && event.touches.length === 1) { lastX = event.touches[0].clientX; lastY = event.touches[0].clientY; }
  }, { passive: true });
  document.addEventListener('touchmove', event => {
    if (event.touches && event.touches.length > 1) { event.preventDefault(); return; }
    if (!event.cancelable || !event.touches || !event.touches[0]) return;
    const touch = event.touches[0];
    const dx = touch.clientX - lastX, dy = touch.clientY - lastY;
    lastX = touch.clientX; lastY = touch.clientY;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    let el = event.target instanceof Element ? event.target : null;
    if (el && el.closest(EDITABLE)) return;
    const body = document.body, root = document.scrollingElement || document.documentElement;
    while (el && el !== body && el !== document.documentElement) {
      if (horizontal) { if (canScrollX(el)) return; }
      else if (canScrollY(el)) {
        const atTop = el.scrollTop <= 0;
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
        if (!((dy > 0 && atTop) || (dy < 0 && atBottom))) return;
      }
      el = el.parentElement;
    }
    // The document itself: scrolling is fine, only its two ends are guarded.
    if (!horizontal && body && !body.classList.contains('ah-account-page-active')
      && root.scrollHeight > root.clientHeight + 1 && getComputedStyle(body).overflowY !== 'hidden') {
      const atTop = root.scrollTop <= 0;
      const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 1;
      if (!((dy > 0 && atTop) || (dy < 0 && atBottom))) return;
    }
    // With the keyboard up iOS must stay free to pan the visual viewport.
    if (body && body.classList.contains('keyboard-open')) return;
    event.preventDefault();
  }, { passive: false });

  /* ---- 1. status-bar colour ---- */
  const opaque = colour => colour && colour !== 'transparent' && !/rgba\([^)]*,\s*0(\.0+)?\)$/.test(colour);
  const hex = colour => {
    const parts = String(colour).match(/[\d.]+/g);
    if (!parts || parts.length < 3) return '';
    return '#' + parts.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(+v))).toString(16).padStart(2, '0')).join('');
  };
  // A gradient-only element has a transparent background-color; its top colour is
  // the first stop, which is what the eye sees under the notch.
  const firstStop = image => {
    if (!image || image === 'none') return '';
    const m = String(image).match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/i);
    return m && opaque(m[0]) ? m[0] : '';
  };
  // Same-origin iframes are looked into, so a screen drawn inside one is never mistaken
  // for the page behind it.
  const colourAt = (y, doc, x, depth) => {
    doc = doc || document; depth = depth || 0;
    if (x === undefined) x = Math.round(innerWidth / 2);
    let el = doc.elementFromPoint(x, Math.max(0, Math.round(y)));
    if (el && el.tagName === 'IFRAME' && depth < 3) {
      try {
        const inner = el.contentDocument;
        if (inner && inner.documentElement) {
          const r = el.getBoundingClientRect();
          const got = colourAt(y - r.top, inner, x - r.left, depth + 1);
          if (got) return got;
        }
      } catch (_) {}
    }
    while (el && el !== doc.documentElement) {
      const style = getComputedStyle(el);
      if (opaque(style.backgroundColor)) return style.backgroundColor;
      const stop = firstStop(style.backgroundImage);
      if (stop) return stop;
      el = el.parentElement;
    }
    return doc.body ? getComputedStyle(doc.body).backgroundColor : '';
  };
  // THE RULE (owner 2026-10-17): the strip under the clock always shows exactly what is
  // directly below it. A screen that cannot be sampled (a full-screen iframe) declares its
  // top colour with data-ah-chrome="#rrggbb"; the top-most visible declarer wins. With no
  // declarer the real colour under the strip is read. Nothing else may colour the strip.
  const norm = colour => {
    const s = String(colour || '').trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return '#' + m[1].split('').map(ch => ch + ch).join('').toLowerCase();
    m = /^#([0-9a-f]{6})$/i.exec(s);
    return m ? s.toLowerCase() : hex(s);
  };
  const declared = () => {
    const list = document.querySelectorAll('[data-ah-chrome]');
    for (let i = list.length - 1; i >= 0; i--) {
      const el = list[i];
      if (!el.isConnected) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.top > 2 || r.height < innerHeight * 0.5 || r.width < innerWidth * 0.5) continue;
      const v = norm(el.getAttribute('data-ah-chrome'));
      if (v) return v;
    }
    return '';
  };
  let scrim = null;
  const ensureScrim = () => {
    if (scrim || !document.body) return scrim;
    scrim = document.createElement('div');
    scrim.id = 'ah-status-scrim';
    scrim.setAttribute('aria-hidden', 'true');
    document.body.append(scrim);
    return scrim;
  };
  let last = '';
  let restColour = '';
  let hadDeclared = false;
  const sync = () => {
    try {
      const strip = ensureScrim();
      const inset = strip ? strip.getBoundingClientRect().height : 0;
      const accountUp = document.body && document.body.classList.contains('ah-account-page-active');
      const root = document.scrollingElement || document.documentElement;
      const scrolled = !accountUp && root && root.scrollTop > 4;
      const forced = accountUp ? '' : declared();
      if (hadDeclared && !forced) { try { window.AhAppearance && window.AhAppearance.apply(); } catch (_) {} }
      hadDeclared = Boolean(forced);
      const value = forced || (scrolled && restColour ? restColour : hex(colourAt(accountUp ? 2 : inset + 2)));
      if (!value) return;
      if (!accountUp && !scrolled) restColour = value;
      if (strip && !accountUp && strip.style.getPropertyValue('background-color') !== value) {
        strip.style.setProperty('background-color', value, 'important');
      }
      // Every theme-color tag (including the media-scoped ones iOS really reads) is
      // re-checked on each pass, so nothing can leave one of them stale.
      document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
        if (meta.getAttribute('content') !== value) meta.setAttribute('content', value);
      });
      if (!document.querySelector('meta[name="theme-color"]')) {
        const meta = document.createElement('meta'); meta.name = 'theme-color'; meta.content = value; document.head.append(meta);
      }
      const key = value + (accountUp ? ':a' : ':m');
      if (key === last) return;
      last = key;
      // Only the full-screen account surfaces recolour the canvas; the main app keeps
      // its theme background (the scrim alone matches the strip there).
      const canvas = accountUp ? value : '';
      document.documentElement.style.backgroundColor = canvas;
      if (document.body) document.body.style.backgroundColor = canvas;
    } catch (_) {}
  };
  addEventListener('hashchange', () => { restColour = ''; });
  ['load', 'resize', 'hashchange', 'popstate', 'pageshow', 'orientationchange'].forEach(type => addEventListener(type, () => setTimeout(sync, 60)));
  addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  window.AhChrome = { sync };
  setInterval(sync, 400);
  if (document.body) sync(); else document.addEventListener('DOMContentLoaded', sync);
})();
