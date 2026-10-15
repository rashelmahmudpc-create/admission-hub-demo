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
const PATTERNS = readFileSync('question-pattern.js', 'utf8');
const ENGINE = readFileSync('admission-intel-engine.js', 'utf8');
const PANEL = readFileSync('admission-intel-panel.js', 'utf8');

test('p18-01: engine, pattern dataset and panel are loaded by the shell', () => {
  assert.ok(H.includes('./question-pattern.js?v=p18-v1'), 'index.html must load the pattern dataset');
  assert.ok(H.includes('./admission-intel-engine.js?v=p18-v3'), 'index.html must load the engine');
  assert.ok(H.includes('./admission-intel-panel.js?v=p18-v3'), 'index.html must load the panel');
});

test('p18-02: every P18 asset is in the service-worker precache', () => {
  assert.ok(SW.includes("'./question-pattern.js?v=p18-v1'"), 'sw.js must precache the pattern dataset');
  assert.ok(SW.includes("'./admission-intel-engine.js?v=p18-v3'"), 'sw.js must precache the engine');
  assert.ok(SW.includes("'./admission-intel-panel.js?v=p18-v3'"), 'sw.js must precache the panel');
});

test('p18-03: the catalog and pattern dataset load before the engine that reads them', () => {
  const c = H.indexOf('academic-catalog.js');
  const q = H.indexOf('question-pattern.js?v=p18-v1');
  const e = H.indexOf('admission-intel-engine.js?v=p18-v3');
  const p = H.indexOf('admission-intel-panel.js?v=p18-v3');
  assert.ok(c > -1 && q > -1 && e > -1 && p > -1 && c < e && q < e && e < p, 'catalog+patterns → engine → panel order');
});

test('p18-04: the dashboard exposes a guarded admission-intel entry point', () => {
  assert.match(V2, /window\.openAdmissionIntelPanel\) return window\.openAdmissionIntelPanel\(\)/,
    'the goal card must open the intel panel through the guarded pattern');
  assert.match(V2, /'goal\.open'/, 'the goal card must have an action id in the frame bridge');
  assert.match(V2, /data-action="goal\.open"/, 'the goal card must be rendered in the dashboard frame');
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
  w.renderShell = (html) => { w.__shell = html; w.document.getElementById('app').innerHTML = html; };
  w.renderDashboard = function () { return 'OLD'; };
  w.navigate = () => {}; w.toast = () => {}; w.openModal = () => {};
  if (cache) run(`const CACHE = ${JSON.stringify(cache)};`);
  run(CAT); run(PATTERNS); run(ENGINE); run(PANEL); run(V2);
  w.renderDashboard();
  return w;
}
const frameSrc = (w) => String(w.document.querySelector('iframe.dv3-frame')?.getAttribute('srcdoc') || '');

const WITH_GOAL = {
  subjects: [], topics: [{ id: 'phy1', name: 'Physics — Motion' }],
  questions: [{ id: 'q1', topicId: 'phy1', difficulty: 'easy' }],
  examResults: [{ completedAt: 1000, snapshot: [{ questionId: 'q1', topicId: 'phy1', status: 'correct' }] }],
  mistakes: [],
  settings: { dv2Goal: { university: 'Rajshahi University', unit: 'A Unit', examDate: '2099-01-01' } }
};

test('p18r-01: the dashboard renders a working admission-intel card', () => {
  const w = boot(WITH_GOAL);
  assert.match(frameSrc(w), /লক্ষ্য দেখো/, 'the goal card must be in the dashboard frame');
  assert.match(frameSrc(w), /data-action="goal\.open"/, 'the frame must carry the intel action');
  assert.ok(w.__dv3Action('goal.open'), 'the outer bridge must accept the goal action');
});

test('p18r-02: opening it shows the official subject coverage for the goal', () => {
  const w = boot(WITH_GOAL);
  w.__dv3Action('goal.open');
  const panel = w.document.getElementById('aiPanel');
  assert.ok(panel, 'panel must be created');
  assert.match(panel.innerHTML, /ভর্তি-বুদ্ধি/, 'header present');
  assert.match(panel.innerHTML, /Physics/, 'the official subject list must render');
  assert.match(panel.innerHTML, /রিভিশন-প্ল্যান/, 'revision plan section must render');
  assert.match(panel.innerHTML, /নিশ্চয়তা নয়/, 'the no-guarantee note must be visible');
});

test('p18r-03: with empty settings the dashboard falls back to the goal editor, never a fabricated map', () => {
  const w = boot({ subjects: [], topics: [], questions: [], examResults: [], mistakes: [], settings: {} });
  assert.ok(w.__dv3Action('goal.open'), 'the goal action must still be handled');
  assert.equal(w.document.getElementById('aiPanel'), null,
    'with no goal there is nothing to analyse, so the intel sheet must not open');
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

test('p18r-06: the official question pattern for the goal unit is shown with its source', () => {
  const w = boot(WITH_GOAL);
  w.openAdmissionIntelPanel();
  const html = w.document.getElementById('aiPanel').innerHTML;
  assert.match(html, /অফিসিয়াল প্রশ্ন-প্যাটার্ন/, 'the official pattern section must render');
  // RU A unit: 100 marks, 80 questions, one hour, 0.25 per wrong.
  assert.match(html, />80</, 'the official question count must be shown');
  assert.match(html, /0\.25/, 'the negative-marking rule must be shown');
  assert.match(html, /সূত্র:/, 'the source must be attributed');
});

test('p18r-07: an unknown unit shows no official pattern rather than inventing one', () => {
  const w = boot({
    subjects: [], topics: [], questions: [], examResults: [], mistakes: [],
    settings: { dv2Goal: { university: 'Rajshahi University', unit: 'Z Unit', examDate: '2099-01-01' } }
  });
  w.openAdmissionIntelPanel();
  const html = w.document.getElementById('aiPanel').innerHTML;
  assert.doesNotMatch(html, /মোট নম্বর/, 'no invented pattern for an unknown unit');
});

test('p18r-08: the weakness report can be shared and carries the no-guarantee line', () => {
  const w = boot(WITH_GOAL);
  let shared = null;
  w.navigator.share = (data) => { shared = data; return Promise.resolve(); };
  w.openAdmissionIntelPanel();
  const btn = w.document.querySelector('#aiPanel .ip-actions button');
  assert.ok(btn, 'the share button must be present');
  w.shareAdmissionIntelReport();
  assert.ok(shared && /ভর্তি-বুদ্ধি রিপোর্ট/.test(shared.text), 'the report must be handed to share()');
  assert.match(shared.text, /কোনো নিশ্চয়তা নয়/, 'the report must keep the no-guarantee line');
  assert.doesNotMatch(shared.text, /নিশ্চিত ভর্তি|গ্যারান্টি/i, 'the report must carry no promise');
});
