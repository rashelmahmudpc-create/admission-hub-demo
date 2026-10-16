#!/usr/bin/env python3
"""Apply the unified Scholar Dashboard theme (owner request 2026-10-16).

Dark (default) + Light only, everywhere. Idempotent: re-running is a no-op.
"""
import re, sys

fails = []

def load(p):
    return open(p, encoding='utf-8').read()

def save(p, s):
    open(p, 'w', encoding='utf-8').write(s)

def rep(s, old, new, label, required=True):
    if new in s and old not in s:
        return s
    if old not in s:
        (fails if required else []).append(label)
        print(('MISSING ' if required else 'skip ') + label)
        return s
    print('ok ' + label)
    return s.replace(old, new)

# ---------------- index.html ----------------
p = 'index.html'; s = load(p)
s = rep(s, """  var MODES = ['light', 'dark', 'system', 'green'];
  function get() {
    try { var v = localStorage.getItem(KEY); return MODES.indexOf(v) >= 0 ? v : 'light'; }
    catch (_) { return 'light'; }
  }""", """  /* Unified theme (2026-10-16): exactly two looks, both from the Scholar
     Dashboard design - dark (default) and light. Older picks migrate. */
  var MODES = ['dark', 'light', 'system'];
  var LEGACY = { green: 'light', pink: 'light', focus: 'light', 'emerald-glass': 'light', 'ivory-academic': 'light', midnight: 'dark', 'midnight-academic': 'dark' };
  function get() {
    try {
      var v = localStorage.getItem(KEY);
      if (LEGACY[v]) { v = LEGACY[v]; localStorage.setItem(KEY, v); }
      return MODES.indexOf(v) >= 0 ? v : 'dark';
    }
    catch (_) { return 'dark'; }
  }""", 'appearance modes')
s = rep(s, """      catch (_) { return 'light'; }
    }
    return m;
  }
  function apply() {
    var r = resolved();
    var root = document.documentElement;
    if (r === 'light') { root.removeAttribute('data-theme'); root.style.colorScheme = 'light'; }
    else { root.setAttribute('data-theme', r); root.style.colorScheme = (r === 'green') ? 'light' : r; }
    try {
      var dark = (r === 'dark' || r === 'midnight');
      var inSky = !!(document.getElementById('app') && document.getElementById('app').classList.contains('sky'));
      var color = inSky ? (dark ? '#0B1020' : '#F6F9FF') : (dark ? (r === 'midnight' ? '#071512' : '#121212') : (r === 'green' ? '#eef7f1' : '#edf7f1'));""", """      catch (_) { return 'dark'; }
    }
    return m === 'light' ? 'light' : 'dark';
  }
  function apply() {
    var r = resolved();
    var root = document.documentElement;
    if (root.getAttribute('data-theme') !== r) root.setAttribute('data-theme', r);
    root.style.colorScheme = r;
    if (document.body && document.body.hasAttribute('data-theme')) document.body.removeAttribute('data-theme');
    try {
      var dark = r === 'dark';
      var color = dark ? '#080D29' : '#F4F6FD';""", 'appearance apply')
s = rep(s, """  function set(mode) {
    if (MODES.indexOf(mode) < 0) mode = 'light';""", """  function set(mode) {
    if (LEGACY[mode]) mode = LEGACY[mode];
    if (MODES.indexOf(mode) < 0) mode = 'dark';""", 'appearance set')
s = rep(s, """  window.AhAppearance = { get: get, set: set, resolved: resolved, apply: apply };
  apply();""", """  window.AhAppearance = { get: get, set: set, resolved: resolved, apply: apply, modes: MODES.slice() };
  apply();
  try {
    new MutationObserver(function () {
      var want = resolved();
      if (document.documentElement.getAttribute('data-theme') !== want) apply();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  } catch (_) {}""", 'appearance lock')
s = rep(s, """applyTheme=function(){originalApplyTheme(); const s=normalizeSettings(CACHE.settings||{}); const theme=s.theme||'light'; if(theme==='light') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme',theme); applyUpgradePrefs();};
  setTheme=async function(theme){CACHE.settings=normalizeSettings(CACHE.settings); CACHE.settings.theme=theme; await dbPut('settings',CACHE.settings); applyTheme(); render(); toast('Theme updated');};""", """applyTheme=function(){originalApplyTheme(); if(window.AhAppearance) window.AhAppearance.apply(); applyUpgradePrefs();};
  setTheme=async function(theme){if(window.AhAppearance) window.AhAppearance.set(theme); CACHE.settings=normalizeSettings(CACHE.settings); CACHE.settings.theme=window.AhAppearance?window.AhAppearance.get():theme; await dbPut('settings',CACHE.settings); applyTheme(); render(); toast('Theme updated');};""", 'legacy applyTheme', required=False)
s = rep(s, "document.documentElement.dataset.accent=s.accent||'emerald';", "document.documentElement.removeAttribute('data-accent');", 'accent', required=False)
s = rep(s, '<meta name="theme-color" content="#edf7f1">', '<meta name="theme-color" content="#080D29">', 'meta1', required=False)
s = rep(s, '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0B1020">', '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#080D29">', 'meta2', required=False)
if 'theme-unified.css' not in s:
    i = s.find('<meta name="mobile-web-app-capable"')
    s = s[:i] + '<link rel="stylesheet" href="./theme-unified.css?v=unified-theme-v1">\n' + s[i:]
if 'theme-unified.js' not in s:
    k = s.rfind('</body>')
    s = s[:k] + '<script src="./theme-unified.js?v=unified-theme-v1"></script>\n' + s[k:]
save(p, s)

# ---------------- profile-ui.js ----------------
p = 'profile-ui.js'; s = load(p)
s = rep(s, "appearance: ['light', 'dark', 'system', 'green'].includes(raw.appearance) ? raw.appearance : 'light',",
        "appearance: window.AhAppearance ? window.AhAppearance.get() : (['light', 'dark', 'system'].includes(raw.appearance) ? raw.appearance : (raw.appearance === 'green' ? 'light' : 'dark')),", 'profile normalize')
s = s.replace("pf.appearance === 'green' ? 'Premium Green' : 'Light Mode'", "'Light Mode'")
s = re.sub(r"\$\{appt\('light', 'Light', '[^']*'\)\}\s*\$\{appt\('dark', 'Dark', '[^']*'\)\}\s*\$\{appt\('system', 'System', '([^']*)'\)\}\s*\$\{appt\('green', 'Premium Green', '[^']*'\)\}",
           lambda m: "${appt('dark', 'Dark', 'ডিফল্ট — ড্যাশবোর্ডের নেভি থিম')}\n        ${appt('light', 'Light', 'পরিষ্কার প্রিমিয়াম লাইট থিম')}\n        ${appt('system', 'System', '" + m.group(1) + "')}", s)
if "appt('green'" in s:
    fails.append('profile green option'); print('MISSING profile options')
save(p, s)

# ---------------- phase1-upgrade.js ----------------
p = 'phase1-upgrade.js'; s = load(p)
s = rep(s, "function applyThemeClass(theme){const t=canonical(theme);",
        "function applyThemeClass(theme){if(window.AhAppearance){try{if(theme&&theme!==readTheme())window.AhAppearance.set(/midnight|dark/.test(String(theme))?'dark':'light');else window.AhAppearance.apply()}catch(_){}return canonical(window.AhAppearance.resolved()==='dark'?'dark':'light')}const t=canonical(theme);", 'phase1 delegate')
save(p, s)

# ---------------- dashboard frame ----------------
for p in ['dashboard-v2.js']:
    s = load(p)
    s = s.replace("if(mode==='dark')document.documentElement.setAttribute('data-theme','dark');\n  else document.documentElement.removeAttribute('data-theme');", "document.documentElement.setAttribute('data-theme',mode==='light'?'light':'dark');")
    s = s.replace("parent.AhAppearance.resolved():'light'", "parent.AhAppearance.resolved():'dark'")
    save(p, s)
p = 'tools/build-dashboard-v3.py'; s = load(p)
s = s.replace("resolved():'light'}catch(_){}\\n\"\n    \"  if(mode==='dark')document.documentElement.setAttribute('data-theme','dark');\\n\"\n    \"  else document.documentElement.removeAttribute('data-theme');\\n\"", "resolved():'dark'}catch(_){}\\n\"\n    \"  document.documentElement.setAttribute('data-theme',mode==='light'?'light':'dark');\\n\"")
save(p, s)

# ---------------- device chrome colours ----------------
p = 'ai-agent-chat.js'; s = load(p)
s = s.replace("const c = r === 'dark' ? '#0B1020' : '#F6F9FF';", "const c = r === 'dark' ? '#080D29' : '#F4F6FD';"); save(p, s)
p = 'question-bank-clean.js'; s = load(p)
s = s.replace("const BG=()=>isDark()?'#090e1b':'#f4f6fb';", "const BG=()=>isDark()?'#080D29':'#F4F6FD';"); save(p, s)

# ---------------- cache versions ----------------
files = ['profile-ui.js', 'phase1-upgrade.js', 'dashboard-v2.js', 'ai-agent-chat.js', 'question-bank-clean.js']
for p in ['index.html', 'sw.js']:
    s = load(p)
    for f in files:
        s = re.sub(r'(' + re.escape(f) + r'\?v=)([^"\'&]+?)(?<!-ut1)(?=["\'&])', lambda m: m.group(1) + m.group(2) + '-ut1', s)
    if p == 'sw.js' and 'theme-unified.css' not in s:
        s = s.replace("const APP_SHELL = [\n  './index.html',", "const APP_SHELL = [\n  './index.html',\n  './theme-unified.css?v=unified-theme-v1',\n  './theme-unified.js?v=unified-theme-v1',", 1)
    save(p, s)

if fails:
    print('FAILED:', fails); sys.exit(1)
print('unified theme applied')
