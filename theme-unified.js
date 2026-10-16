/* ============================================================
   ADMISSION SKY — UNIFIED THEME GUARD (2026-10-16)
   Pairs with theme-unified.css. Many screens paint colours inline
   or in late-injected <style> tags that no token can reach. This
   guard reads each element's computed colours and re-points the
   ones that belong to an old palette onto the dashboard theme:
     dark  -> no white/light surface, no green-tinted surface, no
              dark-on-dark text, light borders become hairlines;
     light -> no black/near-black surface;
     both  -> old emerald brand fills become the dashboard blue.
   SVG/img/video/canvas/iframe keep their own colours. Every write
   is remembered and undone when the theme changes, then re-run.
   Opt-out for an element: data-theme-keep.
   ============================================================ */
(function () {
  'use strict';
  if (window.__ahThemeGuard) return;
  window.__ahThemeGuard = true;
  var doc = document, root = doc.documentElement;
  var SKIP = { SVG: 1, IMG: 1, VIDEO: 1, CANVAS: 1, IFRAME: 1, PICTURE: 1, SOURCE: 1, SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, HEAD: 1, TITLE: 1, NOSCRIPT: 1, BR: 1, OBJECT: 1, EMBED: 1, PATH: 1 };
  var SEMANTIC = /(correct|right|success|\bok\b|-ok|ok-|good|pass|done|win|positive|wrong|error|bad|danger|fail|incorrect|warn|streak|fire|gold|coin|xp|badge-|medal)/i;
  var touched = new Set();
  var saved = new WeakMap();
  var mode = '';
  var stats = { fixes: 0, ms: 0, flushes: 0 };

  function parse(c) {
    var m = c && c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?/);
    if (!m) return null;
    var a = m[4] == null ? 1 : (m[4].slice(-1) === '%' ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    return { r: +m[1], g: +m[2], b: +m[3], a: a };
  }
  function lum(c) {
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function hsl(c) {
    var r = c.r / 255, g = c.g / 255, b = c.b / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
      h *= 60;
    }
    return { h: h, s: s, l: l, c: d };
  }
  var isGreen = function (x) { return x.h >= 95 && x.h <= 175 && x.s > 0.18 && x.c > 0.06; };
  var isWarmPastel = function (x) { return x.h >= 20 && x.h <= 60 && x.c > 0.04 && x.c < 0.3; };

  function set(el, prop, val) {
    var st = el.style, rec = saved.get(el);
    if (!rec) { rec = {}; saved.set(el, rec); }
    if (!(prop in rec)) rec[prop] = [st.getPropertyValue(prop), st.getPropertyPriority(prop)];
    st.setProperty(prop, val, 'important');
    touched.add(el);
  }
  function revertAll() {
    touched.forEach(function (el) {
      var rec = saved.get(el); if (!rec) return;
      Object.keys(rec).forEach(function (p) { if (rec[p][0]) el.style.setProperty(p, rec[p][0], rec[p][1]); else el.style.removeProperty(p); });
      saved.delete(el);
    });
    touched.clear();
  }
  function gradientStops(img) {
    var out = [], re = /rgba?\([^)]+\)/g, m;
    while ((m = re.exec(img))) { var c = parse(m[0]); if (c && c.a > 0.35) out.push(c); }
    return out;
  }
  var bgCache = new Map();
  function effBg(el) {
    if (bgCache.has(el)) return bgCache.get(el);
    var v = effBgRaw(el); bgCache.set(el, v); return v;
  }
  function effBgRaw(el) {
    for (var e = el, i = 0; e && e.nodeType === 1 && i < 12; e = e.parentElement, i++) {
      if (e !== el && bgCache.has(e)) return bgCache.get(e);
      var cs = getComputedStyle(e), c = parse(cs.backgroundColor);
      if (c && c.a >= 0.5) return lum(c);
      var im = cs.backgroundImage;
      if (im && im !== 'none') {
        if (im.indexOf('url(') >= 0) return 0.3;
        var st = gradientStops(im);
        if (st.length) return st.reduce(function (a, k) { return a + lum(k); }, 0) / st.length;
      }
    }
    return mode === 'dark' ? 0.01 : 0.9;
  }

  function fix(el) {
    stats.fixes++;
    if (el.nodeType !== 1 || SKIP[el.tagName.toUpperCase()] || el.closest('svg,[data-theme-keep]')) return;
    var cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    var dark = mode === 'dark';
    var cls = el.className && el.className.baseVal != null ? el.className.baseVal : el.className;
    var sem = SEMANTIC.test(String(cls || '') + ' ' + (el.id || ''));
    var bg = parse(cs.backgroundColor), surfaceChanged = false;

    if (bg && bg.a >= 0.35) {
      var L = lum(bg), H = hsl(bg);
      if (dark) {
        if (L > 0.55 && bg.a < 0.85 && H.c < 0.15) { set(el, 'background-color', 'var(--u-glass)'); surfaceChanged = true; }
        else if (L > 0.55 && H.c < 0.3) { set(el, 'background-color', H.c > 0.05 ? 'var(--u-tint)' : 'var(--u-card)'); surfaceChanged = true; }
        else if (L > 0.55 && isWarmPastel(H)) { set(el, 'background-color', 'var(--u-soft)'); surfaceChanged = true; }
        else if (L > 0.55 && isGreen(H)) { set(el, 'background-color', 'var(--u-tint)'); surfaceChanged = true; }
        else if (bg.a >= 0.85 && L < 0.06 && isGreen(H) && !sem) { set(el, 'background-color', L < 0.02 ? 'var(--u-bg)' : 'var(--u-card)'); surfaceChanged = true; }
        else if (bg.a >= 0.85 && L < 0.035 && (H.c < 0.06 || H.h < 200 || H.h > 260)) { set(el, 'background-color', L < 0.012 ? 'var(--u-bg)' : 'var(--u-card)'); surfaceChanged = true; }
        else if (bg.a >= 0.85 && L < 0.06 && H.c < 0.05) { set(el, 'background-color', 'var(--u-card)'); surfaceChanged = true; }
      } else {
        if (bg.a >= 0.85 && L < 0.06 && !(H.h >= 215 && H.h <= 245 && H.s > 0.35)) { set(el, 'background-color', 'var(--u-card)'); surfaceChanged = true; }
        else if (L > 0.6 && isGreen(H) && !sem) { set(el, 'background-color', 'var(--u-tint)'); surfaceChanged = true; }
      }
      if (!surfaceChanged && !sem && isGreen(H) && H.s > 0.35 && L >= 0.05 && L <= 0.45 && H.h >= 140 && H.h <= 172) {
        set(el, 'background-color', 'var(--u-pri)');
      }
    }
    var img = cs.backgroundImage;
    if (img && img !== 'none' && img.indexOf('gradient') >= 0 && img.indexOf('url(') < 0) {
      var stops = gradientStops(img);
      if (stops.length) {
        var avg = stops.reduce(function (s, c) { return s + lum(c); }, 0) / stops.length;
        var green = stops.filter(function (c) { return isGreen(hsl(c)); }).length >= Math.ceil(stops.length / 2);
        if (dark && avg > 0.55) { set(el, 'background-image', 'none'); set(el, 'background-color', green ? 'var(--u-tint)' : 'var(--u-card)'); surfaceChanged = true; }
        else if (!dark && avg < 0.05) { set(el, 'background-image', 'none'); set(el, 'background-color', 'var(--u-card)'); surfaceChanged = true; }
        else if (green && !sem) {
          if (avg > 0.55) { set(el, 'background-image', 'none'); set(el, 'background-color', 'var(--u-tint)'); }
          else if (avg < 0.06) { set(el, 'background-image', 'none'); set(el, 'background-color', 'var(--u-card)'); surfaceChanged = true; }
          else set(el, 'background-image', 'linear-gradient(135deg,var(--u-pri),var(--u-pri-d))');
        }
      }
    }

    var bc = parse(cs.borderTopColor);
    if (bc && bc.a > 0.3 && parseFloat(cs.borderTopWidth) > 0) {
      var BL = lum(bc), BH = hsl(bc);
      if ((dark && (BL > 0.45 || (isGreen(BH) && !sem))) || (!dark && (BL < 0.04 || (isGreen(BH) && BL > 0.4 && !sem)))) set(el, 'border-color', 'var(--u-line)');
    }

    var hasText = false;
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.nodeValue.trim()) { hasText = true; break; }
    if (hasText || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName)) {
      var fg = parse(cs.color);
      if (fg && fg.a > 0.3) {
        var FL = lum(fg), FH = hsl(fg);
        var EB = effBg(el);
        if (dark) {
          if (surfaceChanged && FL > 0.6) { }
          else if (FL < 0.18 && EB < 0.2) set(el, 'color', (isGreen(FH) && FH.s > 0.3) ? 'var(--u-ok)' : FH.s > 0.4 && FH.h > 200 && FH.h < 260 ? 'var(--u-pri-ink)' : FL < 0.06 ? 'var(--u-ink)' : 'var(--u-sub)');
          else if (isGreen(FH) && FH.h >= 140 && FH.h <= 172 && FH.s > 0.35 && !sem) set(el, 'color', 'var(--u-pri-ink)');
        } else {
          if (FL > 0.55 && EB > 0.45) set(el, 'color', 'var(--u-ink)');
          else if (isGreen(FH) && FH.h >= 140 && FH.h <= 172 && FH.s > 0.35 && FL < 0.3 && !sem) set(el, 'color', 'var(--u-pri-ink)');
        }
      }
    }
  }

  var queue = new Set(), selfQ = new Set(), scheduled = false, full = false, lastFull = 0;
  function walk(rootEl) {
    if (!rootEl || rootEl.nodeType !== 1) return;
    fix(rootEl);
    var it = doc.createTreeWalker(rootEl, 1, { acceptNode: function (n) { return SKIP[n.tagName.toUpperCase()] ? 2 : 1; } });
    var n; while ((n = it.nextNode())) fix(n);
  }
  function flush() {
    scheduled = false;
    if (!mode) return;
    var t0 = Date.now(); stats.flushes++;
    try { flushInner(t0); } finally { stats.ms += Date.now() - t0; bgCache.clear(); }
  }
  function flushInner(t0) {
    if (full && Date.now() - lastFull > 1500) { full = false; lastFull = Date.now(); queue.clear(); selfQ.clear(); if (doc.body) walk(doc.body); return; }
    if (full) setTimeout(schedule, 1600);
    selfQ.forEach(function (el) { if (el.isConnected) fix(el); }); selfQ.clear();
    var items = Array.from(queue).filter(function (n) { for (var p = n.parentElement; p; p = p.parentElement) if (queue.has(p)) return false; return true; });
    queue.clear();
    for (var i = 0; i < items.length; i++) {
      if (items[i].isConnected) walk(items[i]);
      if (Date.now() - t0 > 12) { for (var j = i + 1; j < items.length; j++) queue.add(items[j]); setTimeout(schedule, 60); break; }
    }
  }
  function schedule() {
    if (scheduled) return; scheduled = true;
    var go = function () { setTimeout(flush, 0); };
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 300 }); else setTimeout(go, 50);
  }
  function refresh() {
    var r = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    if (r !== mode) { revertAll(); mode = r; lastFull = 0; }
    full = true; schedule();
  }
  window.AhThemeGuard = { refresh: refresh, stats: stats };

  function start() {
    refresh();
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === 'childList') { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) queue.add(n); else if (n.parentElement) queue.add(n.parentElement); }); if (m.target.tagName === 'HEAD') full = true; }
        else if (m.type === 'attributes' && m.target.nodeType === 1 && m.attributeName === 'class') selfQ.add(m.target);
      }
      schedule();
    }).observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    new MutationObserver(refresh).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('ah:appearance', refresh);
    window.addEventListener('hashchange', function () { full = true; schedule(); });
    window.addEventListener('load', function () { full = true; schedule(); });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})();
