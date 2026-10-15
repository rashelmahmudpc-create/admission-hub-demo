/* Owner 2026-10-16: keep the phone's status-bar / notch area the same colour as
 * whatever screen is on top, and stop pinch / double-tap zoom and sideways drag
 * (iOS ignores user-scalable=no). */
(() => {
  'use strict';
  const css = document.createElement('style');
  css.id = 'ah-ios-chrome';
  css.textContent = 'html{touch-action:manipulation;overflow-x:hidden}body{touch-action:manipulation;overflow-x:clip;overscroll-behavior:none;max-width:100%}';
  document.head.append(css);
  const stop = event => event.preventDefault();
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(type => document.addEventListener(type, stop, { passive: false }));
  document.addEventListener('touchmove', event => { if (event.touches && event.touches.length > 1) event.preventDefault(); }, { passive: false });
  const opaque = colour => colour && colour !== 'transparent' && !/rgba\([^)]*,\s*0(\.0+)?\)$/.test(colour);
  const hex = colour => {
    const parts = String(colour).match(/[\d.]+/g);
    if (!parts || parts.length < 3) return '';
    return '#' + parts.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(+v))).toString(16).padStart(2, '0')).join('');
  };
  const topColour = () => {
    let el = document.elementFromPoint(Math.round(innerWidth / 2), 2);
    while (el && el !== document.documentElement) {
      const bg = getComputedStyle(el).backgroundColor;
      if (opaque(bg)) return bg;
      el = el.parentElement;
    }
    return document.body ? getComputedStyle(document.body).backgroundColor : '';
  };
  let last = '';
  const sync = () => {
    try {
      const value = hex(topColour());
      if (!value || value === last) return;
      last = value;
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.append(meta); }
      meta.setAttribute('content', value);
      document.documentElement.style.backgroundColor = value;
      if (document.body) document.body.style.backgroundColor = value;
    } catch (_) {}
  };
  ['load', 'resize', 'hashchange', 'popstate', 'pageshow', 'orientationchange'].forEach(type => addEventListener(type, () => setTimeout(sync, 60)));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  setInterval(sync, 700);
  sync();
})();
