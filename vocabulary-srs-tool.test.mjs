/* P12 — Smart Vocabulary tool wiring.
 * Loads the SHIPPED engine and tool, runs them against a minimal fake DOM, and
 * pins: the tool exposes its API, the route renders the dashboard, a review
 * session grades answers, and the dashboard entry is injected. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const engineSrc = readFileSync(new URL('./vocabulary-srs-engine.js', import.meta.url), 'utf8');
const toolSrc = readFileSync(new URL('./vocabulary-srs-tool.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

function makeEnv(seedRows = []) {
  const styleNodes = [];
  const fakeDocument = {
    querySelector: sel => (sel === '#vocab-srs-styles' ? styleNodes.find(s => s.id === 'vocab-srs-styles') || null : null),
    createElement: () => ({ id: '', textContent: '', dataset: {}, setAttribute() {}, appendChild() {}, innerHTML: '', onclick: null }),
    head: { appendChild: el => { if (el && el.id) styleNodes.push(el); } },
    addEventListener() {},
  };
  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  const listeners = {};
  const window = {
    Router: { path: 'dashboard' },
    renderShell: inner => { window.__lastHtml = inner; },
    renderDashboard: function () { return '<div class="page"><div data-unified-study-tools-list></div></div>'; },
    render: function () { return 'base'; },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    AH_VOCAB_A_SEED: [],
    navigate: () => {},
  };
  const appended = [];
  const toolsNode = { appendChild: el => appended.push(el) };
  fakeDocument.querySelector = sel => {
    if (sel === '#vocab-srs-styles') return styleNodes.find(s => s.id === 'vocab-srs-styles') || null;
    if (sel === '#app .page') return { querySelector: s => (s === '[data-unified-study-tools-list]' ? toolsNode : null), dataset: {} };
    if (sel === '[data-unified-study-tools-list]') return toolsNode;
    return null;
  };
  const location = { hash: '#dashboard' };
  const navigate = path => { location.hash = '#' + path; };
  const dbGetAll = async () => seedRows;
  const noopTimer = () => 0;

  window.AhVocabSrs = new Function('self', `${engineSrc}\nreturn self.AhVocabSrs;`)({});
  new Function('window', 'document', 'location', 'localStorage', 'navigate', 'dbGetAll', 'setTimeout', toolSrc)(
    window, fakeDocument, location, localStorage, navigate, dbGetAll, noopTimer
  );
  return { window, location, navigate, appended, listeners, store };
}

const rows = [
  { id: '1', tool: 'vocabulary-master', word: 'Abandon', meaning: 'বর্জন করা', category: 'A', synonyms: [{ word: 'Forsake', meaning: 'ত্যাগ' }], antonyms: [{ word: 'Keep', meaning: 'রাখা' }] },
  { id: '2', tool: 'vocabulary-master', word: 'Abundant', meaning: 'প্রচুর', category: 'A', synonyms: [{ word: 'Ample', meaning: 'যথেষ্ট' }], antonyms: [{ word: 'Scarce', meaning: 'দুষ্প্রাপ্য' }] },
  { id: '3', tool: 'vocabulary-master', word: 'Ban', meaning: 'নিষেধাজ্ঞা', category: 'B', synonyms: [{ word: 'Forbid', meaning: 'নিষেধ করা' }], antonyms: [{ word: 'Allow', meaning: 'অনুমতি দেওয়া' }] },
];

test('p12w-01: the tool registers its API and the engine', () => {
  const { window } = makeEnv(rows);
  assert.ok(window.VocabSrsTool, 'VocabSrsTool must be exposed');
  assert.equal(typeof window.VocabSrsTool.start, 'function');
  assert.equal(typeof window.VocabSrsTool.answer, 'function');
  assert.ok(window.AhVocabSrs, 'engine must be present');
});

test('p12w-02: index.html ships the engine and tool scripts', () => {
  assert.ok(/vocabulary-srs-engine\.js/.test(html), 'engine script tag missing');
  assert.ok(/vocabulary-srs-tool\.js/.test(html), 'tool script tag missing');
});

test('p12w-03: rendering the route shows the Smart Vocabulary dashboard', async () => {
  const { window, location } = makeEnv(rows);
  location.hash = '#vocabulary-srs';
  window.render();                       // our override refreshes then renders
  await new Promise(r => setImmediate(r));  // let the async word load resolve
  assert.match(window.__lastHtml || '', /Smart Vocabulary|SMART VOCABULARY/);
});

test('p12w-04: a review session grades answers and advances', async () => {
  const { window, location } = makeEnv(rows);
  location.hash = '#vocabulary-srs';
  await window.VocabSrsTool.start();
  const engine = window.AhVocabSrs;
  const plan = window.VocabSrsEngine.buildDailyPlan(20);
  assert.ok(plan.length >= 1);
  const s = window.VocabSrsTool._session(plan);
  // answer every question with option 0 (may be right or wrong) and step through
  for (let i = 0; i < plan.length; i++) {
    window.VocabSrsTool.answer(0);
    window.VocabSrsTool.next();
  }
  assert.match(window.__lastHtml || '', /Review complete/i);
});

test('p12w-05: a graded word gains schedule state in localStorage', async () => {
  const { window, location, store } = makeEnv(rows);
  location.hash = '#vocabulary-srs';
  await window.VocabSrsTool.start();
  const plan = window.VocabSrsEngine.buildDailyPlan(20);
  window.VocabSrsTool._session(plan);
  window.VocabSrsTool.answer(0);
  const saved = JSON.parse(store.get('admission-hub-vocab-srs-state-v1') || '{}');
  const keys = Object.keys(saved.cards || {});
  assert.ok(keys.length >= 1, 'a word must be scheduled');
  assert.ok(saved.cards[keys[0]].reviews >= 1);
});

test('p12w-06: the dashboard entry is injected into the study tools list', () => {
  const { window, appended } = makeEnv(rows);
  window.renderDashboard();
  assert.equal(appended.length, 1);
  assert.equal(appended[0].dataset.vocabSrsEntry, 'true');
});
