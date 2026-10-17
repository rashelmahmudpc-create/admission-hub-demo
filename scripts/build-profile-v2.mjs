#!/usr/bin/env node
/* Build the backend-wired Profile V2 page from the owner's static UI.

   Source (never edited): /workspace/backups/profile-ui-2026-10-17/new-profile-ui.html
   Output: profile-v2.html

   The owner's markup, CSS and UI script are copied verbatim EXCEPT for the
   demo defaults he explicitly asked to remove. A small adapter is appended
   that feeds the real per-student profile and wires every action back to the
   existing backend. Run:  node scripts/build-profile-v2.mjs
*/
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SRC = '/workspace/backups/profile-ui-2026-10-17/new-profile-ui.html';

const raw = readFileSync(SRC, 'utf8');
const pick = (re) => {
  const m = raw.match(re);
  if (!m) throw new Error(`build-profile-v2: pattern not found: ${re}`);
  return m[1];
};

let markup = pick(/<body[^>]*>([\s\S]*?)<\/body>/);
markup = markup.slice(0, markup.indexOf('<script'));
// The author left head-only tags inside <body>; strip them.
markup = markup
  .replace(/<title>[\s\S]*?<\/title>/g, '')
  .replace(/<meta\b[^>]*>/g, '')
  .replace(/<link\b[^>]*>/g, '');
// The author's stylesheet also sits at the top of <body>; it is hoisted into
// <head> below, so drop the copy here rather than shipping it twice.
markup = markup.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
markup = markup.trim();

const styles = [...raw.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
const css = styles[1];
const uiScript = pick(/<script[^>]*>([\s\S]*?)<\/script>/);

/* ---- strip the demo data the owner asked to be gone ------------------- */
let script = uiScript;

// 1. Blank the hardcoded person. Every field the backend owns starts empty so
//    nothing fake can ever paint, and completion honestly reads 0/10.
const demoStart = script.indexOf('var P=Object.assign({');
const demoEnd = script.indexOf('window.PROFILE_DATA||{})', demoStart);
if (demoStart < 0 || demoEnd < 0) throw new Error('demo P block not found');
script =
  script.slice(0, demoStart) +
  "var P=Object.assign({name:'',ahid:'',email:'',mobile:'',dob:'',school:'',college:'',bio:''," +
  "session:'',targets:[],goal:'',subjects:[],avatarSet:false,lang:'বাংলা'," +
  "ai:{lang:'বাংলা',tone:'Friendly',depth:'Balanced'},pub:false,avatar:0,photo:'',theme:'auto'}," +
  script.slice(demoEnd);

// 2. Real study numbers instead of the 266 sample. The adapter sets
//    window.PROFILE_STATS from the same CACHE the rest of the app reads;
//    with no data the counters honestly stay at zero.
script = script.replace(
  'var SAMPLE={solved:266,mockDone:true};',
  'var SAMPLE=window.PROFILE_STATS||{solved:0,mockDone:false};'
);
if (script.includes("solved:266")) throw new Error('SAMPLE demo value still present');

/* ---- adapter: real data in, real actions out ------------------------- */
/* Split in two: the SEED must run before the owner's UI script, because that
   script reads window.PROFILE_DATA / window.PROFILE_STATS at parse time. The
   WIRING runs after, once the UI's own functions exist. */
const shared = `
  var API = '/api/auth/v1';
  var PREF_KEY = 'as.profile.v4';

  function readCache() {
    try {
      var pid = localStorage.getItem('ah-profile-cache-key');
      if (!pid) return null;
      var raw = localStorage.getItem('ah-profile-cache:' + pid);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  /* The app speaks light/dark/system/green; this UI speaks auto/light/dark.
     Inside the frame there is no AhAppearance global (index.html is not loaded
     there), so read the app's own storage key directly — the frame is
     same-origin, so localStorage is shared. The mount also hands its resolved
     theme in as __AH_THEME__ before any script runs, which covers the first
     paint and the case where the store is unreadable. */
  function themeForUi() {
    var mode = '';
    try {
      mode = (window.AhAppearance && window.AhAppearance.get && window.AhAppearance.get()) ||
        localStorage.getItem('ah-appearance') || window.__AH_THEME__ || '';
    } catch (_) {}
    if (!mode) {
      try { mode = document.documentElement.getAttribute('data-theme') || 'light'; } catch (_) {}
    }
    if (mode === 'dark') return 'dark';
    if (mode === 'light' || mode === 'green') return 'light';
    return 'auto';
  }
  function themeForApp(mode) {
    if (mode === 'dark') return 'dark';
    if (mode === 'light') return 'light';
    return 'system';
  }

  /* Backend field names -> this UI's field names. */
  function mapProfile(entry) {
    var p = (entry && entry.profile) || {};
    var school = p.school || null;
    var higher = p.higherInstitution || null;
    var av = entry && entry.avatar;
    return {
      name: p.fullName || '',
      ahid: entry.publicId || '',
      email: entry.email || '',
      mobile: p.mobile || '',
      dob: p.dob || '',
      school: (school && school.name) || '',
      college: (higher && higher.name) || '',
      bio: p.bio || '',
      session: p.admissionSession || '',
      goal: p.academicGoal || '',
      targets: Array.isArray(p.targets) ? p.targets.map(function (t) {
        return typeof t === 'string' ? t : (t && (t.name || t.unit)) || '';
      }).filter(Boolean) : [],
      subjects: Array.isArray(p.subjects) ? p.subjects.map(function (s) {
        return typeof s === 'string' ? s : (s && s.name) || '';
      }).filter(Boolean) : [],
      pub: p.visibility === 'public',
      avatarSet: !!(av && av.present),
      photo: (av && av.present) ? (API + '/profile/avatar?v=' + (av.updatedAt || 0)) : '',
      theme: themeForUi()
    };
  }

  /* Real study numbers, from the same CACHE the dashboard trusts. */
  function readStats() {
    var out = { solved: 0, mockDone: false };
    try {
      var c = window.CACHE;
      var results = (c && Array.isArray(c.examResults)) ? c.examResults : [];
      var mcqs = 0;
      for (var i = 0; i < results.length; i++) {
        var r = results[i] || {};
        mcqs += Number(r.questionCount || r.totalQuestions || (r.snapshot || []).length) || 0;
        if (r.mode === 'mock') out.mockDone = true;
      }
      out.solved = mcqs;
    } catch (_) {}
    return out;
  }

  function writePrefs(mapped) {
    try {
      var saved = {};
      try { saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (_) {}
      // A different student on this device must never inherit the last one's
      // values: start clean when the AH-ID changes.
      if (saved.ahid && mapped.ahid && saved.ahid !== mapped.ahid) saved = {};
      localStorage.setItem(PREF_KEY, JSON.stringify(Object.assign(saved, mapped)));
    } catch (_) {}
  }

  /* The owner's UI applies its theme only at boot and on a theme tap, so a
     theme that arrives with the backend response would never reach the screen.
     Mirror it onto the document root, which is what the design's own selectors
     (:root[data-theme="dark"]) key off. */
  function applyDocTheme(theme) {
    try {
      var r = document.documentElement;
      if (theme === 'dark' || theme === 'light') r.setAttribute('data-theme', theme);
      else r.removeAttribute('data-theme');
    } catch (_) {}
  }
`;

const seed = `
/* ===== ADMISSION HUB — PROFILE DATA SEED (runs before the UI) ===== */
(function () {
  'use strict';
${shared}
  window.PROFILE_STATS = readStats();

  /* The design boots with theme 'auto' and only consults the app on a tap, so
     without this the frame paints light while the app is dark. The attribute
     covers the instant before the UI parses; the value inside PROFILE_DATA is
     what survives the UI's own applyTheme() boot, which rewrites the attribute
     from P.theme. */
  var startTheme = themeForUi();
  applyDocTheme(startTheme);
  window.PROFILE_DATA = { theme: startTheme };

  var cached = readCache();
  if (cached && cached.profile) {
    var mapped = mapProfile(cached);
    // The UI merges window.PROFILE_DATA over its defaults at parse time, so
    // seeding here means the student's own data paints on the first frame.
    window.PROFILE_DATA = Object.assign({ theme: startTheme }, mapped);
    writePrefs(mapped);
  }
})();
`;

const wiring = `
/* ===== ADMISSION HUB — PROFILE BACKEND WIRING =====
   Routes every action this UI raises back to the existing backend, and
   refreshes from the server. The UI above is the owner's design, verbatim. */
(function () {
  'use strict';
${shared}
  function push(entry) {
    if (!entry || !entry.profile) return;
    var mapped = mapProfile(entry);
    writePrefs(mapped);
    applyDocTheme(mapped.theme);
    if (typeof window.setProfile === 'function') window.setProfile(mapped);
  }

  function api(path, opts) {
    // Reject rather than throw: a synchronous throw here would escape the
    // .catch() callers and abort the whole wiring block on a WebView with no
    // fetch, leaving the page with no actions at all.
    if (typeof fetch !== 'function') return Promise.reject(new Error('fetch unavailable'));
    opts = opts || {};
    return fetch(path, Object.assign({
      credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined
    }, opts)).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var e = new Error((body && body.error && body.error.message) || 'সমস্যা হয়েছে');
          e.status = res.status; e.code = body && body.error && body.error.code;
          throw e;
        }
        return body;
      });
    });
  }

  var version = null;

  function loadProfile() {
    return api(API + '/profile').then(function (entry) {
      push(entry);
      if (entry && entry.profile) version = entry.profile.version;
      return entry;
    });
  }

  /* Send only what changed, under the backend's own field names. */
  var FIELD_MAP = {
    name: 'fullName', mobile: 'mobile', bio: 'bio', dob: 'dob',
    goal: 'academicGoal', session: 'admissionSession'
  };
  function toBackend(field, value) {
    var f = FIELD_MAP[field];
    if (f) return { key: f, value: value };
    if (field === 'school') return { key: 'school', value: value ? { name: value } : null };
    if (field === 'college') return { key: 'higherInstitution', value: value ? { name: value } : null };
    if (field === 'targets' || field === 'subjects') return { key: field, value: value };
    return null;
  }

  function patchFields(fields) {
    return api(API + '/profile/patch', {
      method: 'POST',
      body: JSON.stringify({ fields: fields, expectVersion: version })
    }).then(function (res) {
      if (res && res.profile) {
        var cached = readCache() || {};
        version = res.profile.version;
        push({
          profile: res.profile,
          publicId: cached.publicId,
          email: cached.email,
          avatar: cached.avatar
        });
      }
      return res;
    });
  }

  /* Every action the UI raises lands here. */
  document.addEventListener('app:action', function (ev) {
    var d = (ev && ev.detail) || {};
    var a = d.action;
    try {
      if (a === 'profile.update') {
        var one = toBackend(d.field, d.value);
        if (one) {
          var f = {}; f[one.key] = one.value;
          patchFields(f).catch(function () {});
        }
      } else if (a === 'profile.save') {
        var p = d.profile || {};
        var all = {};
        Object.keys(FIELD_MAP).forEach(function (k) {
          if (k in p) all[FIELD_MAP[k]] = p[k];
        });
        ['school', 'college', 'targets', 'subjects'].forEach(function (k) {
          if (k in p) { var o = toBackend(k, p[k]); if (o) all[o.key] = o.value; }
        });
        if (Object.keys(all).length) patchFields(all).catch(function () {});
      } else if (a === 'profile.theme') {
        /* A theme tap inside the frame must reach the app's own store, or the
           rest of the app keeps the previous theme. AhAppearance lives on the
           parent document (index.html is not loaded in the frame), so use it
           when reachable and fall back to its storage key — same origin, so
           localStorage is shared either way. */
        var mode = themeForApp(d.theme);
        try {
          if (window.parent && window.parent !== window && window.parent.AhAppearance) {
            window.parent.AhAppearance.set(mode);
          } else if (window.AhAppearance) {
            window.AhAppearance.set(mode);
          } else {
            localStorage.setItem('ah-appearance', mode);
          }
        } catch (_) {}
      } else if (a === 'profile.public') {
        patchFields({ visibility: d.value ? 'public' : 'private' }).catch(function () {});
      } else if (a === 'auth.logout' || a === 'auth.logoutAll') {
        try { window.AdmissionAccount && window.AdmissionAccount.open && window.AdmissionAccount.open(); } catch (_) {}
      }
    } catch (_) {}
  });

  loadProfile().catch(function () {
    // No session: the page keeps its honest empty state rather than showing
    // anyone else's data.
    if (typeof window.setProfile === 'function') window.setProfile({});
  });

  // A tab returning to the foreground re-reads the profile, so a change made
  // elsewhere is never stale on screen.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') loadProfile().catch(function () {});
  });

  window.ProfileV2 = { load: loadProfile, stats: readStats };
})();
`;

/* ---- assemble -------------------------------------------------------- */
const page = `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>প্রোফাইল — Admission Hub</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Hind+Siliguri:wght@400;500;600;700&display=swap">
<style>${css}</style>
</head>
<body>
${markup}
<script>${seed}</script>
<script>${script}</script>
<script>${wiring}</script>
</body>
</html>
`;

writeFileSync(join(root, 'profile-v2.html'), page, 'utf8');
console.log('profile-v2.html written:', page.length, 'chars');
console.log('  markup', markup.length, '| css', css.length, '| ui-script', script.length,
  '| seed', seed.length, '| wiring', wiring.length);
