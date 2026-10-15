// P13-রিগ্রেশন — dv2 CACHE-রেজলভার (window.CACHE-ক্র্যাশ-ফিক্স)
// মালিক-স্ক্রিনশট (২০২৬-০৯-০৭): "Something went wrong ... C().settings.dailyTarget"
// মূল-কারণ: index.html-এ `const CACHE` (ক্লাসিক-স্ক্রিপ্ট টপ-লেভেল const) window-এ যায় না →
//   পুরনো C()=()=>(window.CACHE||{}) চিরকাল {} ফেরাত → C().settings undefined → TypeError।
// ফিক্স: C() ৩-স্তর (window → typeof-CACHE-লেক্সিকাল → {}) + সব settings-অ্যাক্সেস null-safe +
//   goal() ফাঁকা-অবজেক্টে dbPut('settings',…) নিষেধ + renderV2-এ try/catch → পুরনো-ড্যাশবোর্ড-ফলব্যাক।
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };
const V2 = readFileSync('dashboard-v2.js', 'utf8');
const H = readFileSync('index.html', 'utf8');
const SW = readFileSync('sw.js', 'utf8');

/* ── ১. স্ট্যাটিক: রেজলভার + নিরাপত্তা ── */
t('১. C() ৩-স্তর-রেজলভার (window.CACHE → typeof CACHE → {})', V2.includes("if (window.CACHE) return window.CACHE;") && V2.includes("typeof CACHE !== 'undefined' && CACHE) return CACHE;") && V2.includes('return {};'));
t('২. কোনো আনগার্ডেড C().settings.X অ্যাক্সেস নেই (সব নাল-সেফ বা &&-গার্ডেড)', !/(?<!\&\& )C\(\)\.settings\.[A-Za-z]/.test(V2) && !V2.includes('C().settings.dailyTarget') && V2.includes('(C().settings || {}).dailyTarget'));
t('৩. goal(): DB-লেখা সর্বদা window.dbPut-গার্ডেড (আনগার্ডেড-লেখা নেই)', V2.includes("if (window.dbPut) window.dbPut('settings', s)") && !/(?<!if \(window\.dbPut\) )window\.dbPut\('settings'/.test(V2.replace("if (window.dbPut) window.dbPut('settings', s)", '')));
t('৪. renderV3 try/catch → বন্ধুত্বপূর্ণ-ব্যর্থতা (কখনো ক্র্যাশ নয়)', V2.includes("console.warn('[dv3] render failed") && V2.includes('ড্যাশবোর্ড লোড হয়নি'));

t('৫. ভার্সন-অখণ্ডতা: dashboard-v2.js ?v=dash2f10-main-ai (index+sw) + current BUILD_ID', H.includes('<script defer src="./dashboard-v2.js?v=dash2f16-avatar-cache"></script>') && SW.includes("'./dashboard-v2.js?v=dash2f16-avatar-cache'") && SW.includes("const BUILD_ID = 'v340-sky-rich-live'") && H.includes("const expectedSwVersion = 'v340-sky-rich-live'") && H.includes("const expectedSwVersion = 'v340-sky-rich-live'") && !H.includes('v196-gfix'));

/* ── ২. রানটাইম (jsdom): আসল সিনারিওতে আর কোনো ক্র্যাশ নেই ── */
function runtimeCase(name, setup) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
  const w = dom.window;
  w.__prevCalls = 0;
  w.renderShell = (html) => { w.__shell = html; w.document.getElementById('app').innerHTML = html; };
  w.renderDashboard = function () { w.__prevCalls++; return 'OLD'; };
  w.navigate = () => {};
  w.toast = () => {};
  w.openModal = () => {};
  setup(w);
  const run = (code) => { const s = w.document.createElement('script'); s.textContent = code; w.document.body.appendChild(s); };
  let threw = null;
  try { run(V2); const out = w.renderDashboard(); if (out === 'OLD') w.__fellBack = true; } catch (e) { threw = String(e && e.message || e); }
  return { w, threw };
}
/* The frame is an iframe whose srcdoc carries the whole design; the outer shell
 * only ever holds the frame element. Data is asserted through __dv3Data(), which
 * is the same function the frame reads, so these stay honest without a browser. */
function frame(w) {
  const el = w.document.querySelector('iframe.dv3-frame');
  return { el, src: String((el && el.getAttribute('srcdoc')) || '') };
}
t('৬. CACHE-অনুপস্থিত (সবচেয়ে খারাপ): renderDashboard নিক্ষেপ করে না + dv3-ফ্রেম বসে', (() => {
  const r = runtimeCase('no-cache', () => {});
  const f = frame(r.w);
  return r.threw === null && !!f.el && f.src.includes('id="greet"') && typeof r.w.__dv3Data === 'function';
})());
t('৭. const-CACHE + ফাঁকা settings (মালিক-সিনারিও): নিক্ষেপ নয়, ডিফল্ট-টার্গেট ১০০', (() => {
  const r = runtimeCase('empty-settings', (w) => { run_test_script(w, 'const CACHE = { subjects: [], settings: {} };'); });
  return r.threw === null && !!frame(r.w).el && r.w.__dv3Data().mission.total === 100;
})());
t('৮. const-CACHE + settings.dailyTarget=50: dv3-ডেটায় ৫০-টার্গেট যায়', (() => {
  const r = runtimeCase('target-50', (w) => { run_test_script(w, 'const CACHE = { subjects: [], settings: { dailyTarget: 50 } };'); });
  return r.threw === null && r.w.__dv3Data().mission.total === 50;
})());
function run_test_script(w, code) { const s = w.document.createElement('script'); s.textContent = code; w.document.body.appendChild(s); }

console.log(`\nP13-DV2-CACHE-GUARD: ${pass} pass / ${fail} fail`);
if (fail) process.exit(1);
