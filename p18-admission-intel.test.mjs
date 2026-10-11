/* P18 — wiring + runtime proof for the admission-intelligence panel.
 *
 * Static checks pin the shell wiring; the jsdom tests boot the real
 * dashboard-v2.js, academic-catalog.js and admission-intel-panel.js together
 * and open the panel, so a card that renders but cannot open is caught here. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const H = readFileSync('index.html', 'utf8');
const SW = readFileSync('sw.js', 'utf8');
const V2 = readFileSync('dashboard-v2.js', 'utf8');
const CAT = readFileSync('academic-catalog.js', 'utf8');
const ENGINE = readFileSync('admission-intel-engine.js', 'utf8');
const PANEL = readFileSync('admission-intel-panel.js', 'utf8');

test('p18-01: engine and panel are loaded by the shell', () => {
  assert.ok(H.includes('./admission-intel-engine.js?v=p18-v1'), 'index.html must load the engine');
  assert.ok(H.includes('./admission-intel-panel.js?v=p18-v2'), 'index.html must load the panel');
});

test('p18-02: both P18 assets are in the service-worker precache', () => {
  assert.ok(SW.includes("'./admission-intel-engine.js?v=p18-v1'"), 'sw.js must precache the engine');
  assert.ok(SW.includes("'./admission-intel-panel.js?v=p18-v2'"), 'sw.js must precache the panel');
});

test('p18-03: the catalog loads before the engine that reads it', () => {
  const c = H.indexOf('academic-catalog.js');
  const e = H.indexOf('admission-intel-engine.js?v=p18-v1');
  const p = H.indexOf('admission-intel-panel.js?v=p18-v2');
  assert.ok(c > -1 && e > -1 && p > -1 && c < e && e < p, 'catalog → engine → panel order');
});

test('p18-04: the dashboard exposes a guarded admission-intel entry point', () => {
  assert.match(V2, /onclick="window\.openAdmissionIntelPanel&&window\.openAdmissionIntelPanel\(\)"/,
    'dashboard must call openAdmissionIntelPanel() through the guarded pattern');
  assert.match(V2, /header \+ prepare \+ intel \+/, 'the intel card must be rendered in the dashboard');
});

test('p18-05: the panel exports the globals the dashboard calls', () => {
  assert.ok(PANEL.includes('window.openAdmissionIntelPanel = open'), 'panel must export openAdmissionIntelPanel');
  assert.ok(PANEL.includes('window.closeAdmissionIntelPanel'), 'panel must export closeAdmissionIntelPanel');
});

test('p18-06: the engine never hard-codes a unit map of its own', () => {
  assert.ok(!/UNITS\s*=/.test(ENGINE), 'engine must not declare its own UNITS table');
  assert.ok(ENGINE.includes('AH_AcademicCatalog'), 'engine must read the shared catalog');
  assert.ok(!/'sciencePhysics'|'commerce'|'humanities'/.test(ENGINE), 'engine must not duplicate the group sets');
});

test('p18-07: the panel states the no-guarantee policy to the student', () => {
  assert.ok(PANEL.includes('নিশ্চয়তা নয়'), 'the panel must show the no-guarantee note');
});

test('p18-08: the panel is read-only and calls no model', () => {
  assert.ok(!/\bfetch\s*\(/.test(PANEL) && !/XMLHttpRequest/.test(PANEL), 'panel must not fetch');
  assert.ok(!/dbPut|objectStore\(|localStorage/.test(PANEL), 'panel must not write');
});

/* ── runtime: the whole chain, in jsdom ── */
function boot(cache) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>',
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
  const w = dom.window;
  const run = (code) => { const s = w.document.createElement('script'); s.textContent = code; w.document.body.appendChild(s); };
  w.renderShell = (html) => { w.__shell = html; };
  w.renderDashboard = function () { return 'OLD'; };
  w.navigate = () => {}; w.toast = () => {}; w.openModal = () => {};
  if (cache) run(`const CACHE = ${JSON.stringify(cache)};`);
  run(CAT); run(ENGINE); run(PANEL); run(V2);
  w.renderDashboard();
  return w;
}

const WITH_GOAL = {
  subjects: [], topics: [{ id: 'phy1', name: 'Physics — Motion' }],
  questions: [{ id: 'q1', topicId: 'phy1', difficulty: 'easy' }],
  examResults: [{ completedAt: 1000, snapshot: [{ questionId: 'q1', topicId: 'phy1', status: 'correct' }] }],
  mistakes: [],
  settings: { dv2Goal: { university: 'Rajshahi University', unit: 'A Unit', examDate: '2099-01-01' } }
};

test('p18r-01: the dashboard renders a working admission-intel card', () => {
  const w = boot(WITH_GOAL);
  assert.match(w.__shell, /ভর্তি-বুদ্ধি/, 'intel card must be on the dashboard');
  assert.match(w.document.body.innerHTML, /openAdmissionIntelPanel/, 'handler must be present');
});

test('p18r-02: opening it shows the official subject coverage for the goal', () => {
  const w = boot(WITH_GOAL);
  w.openAdmissionIntelPanel();
  const panel = w.document.getElementById('aiPanel');
  assert.ok(panel, 'panel must be created');
  assert.match(panel.innerHTML, /ভর্তি-বুদ্ধি/, 'header present');
  assert.match(panel.innerHTML, /Physics/, 'the official subject list must render');
  assert.match(panel.innerHTML, /রিভিশন-প্ল্যান/, 'revision plan section must render');
  assert.match(panel.innerHTML, /নিশ্চয়তা নয়/, 'the no-guarantee note must be visible');
});

test('p18r-03: with empty settings the dashboard default goal still resolves cleanly', () => {
  const w = boot({ subjects: [], topics: [], questions: [], examResults: [], mistakes: [], settings: {} });
  w.openAdmissionIntelPanel();
  const panel = w.document.getElementById('aiPanel');
  assert.ok(panel, 'panel must still open');
  // dashboard-v2 supplies a default goal, so the panel must resolve it rather
  // than showing an error — and still never invent a unit map.
  assert.match(panel.innerHTML, /রাজশাহী|Rajshahi/, 'the default goal university must be shown');
  assert.match(panel.innerHTML, /নিশ্চয়তা নয়/, 'policy note still present');
});

test('p18r-03b: without the catalog the panel asks for a goal, never invents a unit map', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>',
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
  const w = dom.window;
  const run = (code) => { const s = w.document.createElement('script'); s.textContent = code; w.document.body.appendChild(s); };
  w.toast = () => {};
  run(ENGINE); run(PANEL);
  w.openAdmissionIntelPanel();
  const panel = w.document.getElementById('aiPanel');
  assert.ok(panel, 'panel must still open');
  assert.match(panel.innerHTML, /ইউনিট সেট করলে/, 'must ask the student to set a goal');
});

test('p18r-04: closing removes the sheet', () => {
  const w = boot(WITH_GOAL);
  w.openAdmissionIntelPanel();
  assert.ok(w.document.getElementById('aiPanel'), 'open first');
  w.closeAdmissionIntelPanel();
  assert.equal(w.document.getElementById('aiPanel'), null, 'close must remove it');
});

test('p18r-05: the rendered panel never contains a rank/pass promise', () => {
  const w = boot(WITH_GOAL);
  w.openAdmissionIntelPanel();
  const html = w.document.getElementById('aiPanel').innerHTML;
  assert.doesNotMatch(html, /নিশ্চিত ভর্তি|গ্যারান্টি|guarantee/i, 'no promise may reach the student');
});
