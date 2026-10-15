/* P17 — runtime proof that the "prepare me" flow actually works end to end.
 *
 * Static wiring checks live in p17-prepare-me.test.mjs. This suite runs the real
 * dashboard-v2.js in jsdom, confirms the entry point is rendered, then executes
 * the real study-plan-panel.js open() and asserts a plan sheet appears — with
 * both the honest empty state and a populated plan from synthetic history. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const V2 = readFileSync('dashboard-v2.js', 'utf8');
const ENGINE = readFileSync('study-plan-engine.js', 'utf8');
const PANEL = readFileSync('study-plan-panel.js', 'utf8');

function boot(cache) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>',
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
  const w = dom.window;
  const run = (code) => { const s = w.document.createElement('script'); s.textContent = code; w.document.body.appendChild(s); };
  w.renderShell = (html) => { w.__shell = html; w.document.getElementById('app').innerHTML = html; };
  w.renderDashboard = function () { return 'OLD'; };
  w.navigate = () => {}; w.toast = () => {}; w.openModal = () => {};
  if (cache) run(`const CACHE = ${JSON.stringify(cache)};`);
  run(ENGINE); run(PANEL); run(V2);
  w.renderDashboard();
  return w;
}

/* The dashboard mounts the design in an iframe; the card that carries the
 * prepare-me action lives in the frame source, and the outer bridge is what the
 * frame calls. Assert both, then drive the real panel through the bridge. */
const frameSrc = (w) => String(w.document.querySelector('iframe.dv3-frame')?.getAttribute('srcdoc') || '');

const EMPTY = { subjects: [], topics: [], questions: [], examResults: [], mistakes: [], settings: {} };
const HISTORY = {
  subjects: [], topics: [{ id: 'geometry', name: 'জ্যামিতি' }, { id: 'algebra', name: 'বীজগণিত' }],
  questions: [
    { id: 'a1', topicId: 'algebra', difficulty: 'easy' },
    { id: 'b1', topicId: 'geometry', difficulty: 'easy' }
  ],
  examResults: [{ completedAt: 1000, snapshot: [
    { questionId: 'a1', topicId: 'algebra', status: 'correct' },
    { questionId: 'b1', topicId: 'geometry', status: 'wrong' }
  ] }],
  mistakes: [], settings: {}
};

test('p17r-01: the dashboard renders a working prepare-me button', () => {
  const w = boot(HISTORY);
  assert.match(frameSrc(w), /আমাকে প্রস্তুত করো/, 'prepare card must be in the dashboard frame');
  assert.match(frameSrc(w), /data-action="ai\.plan"/, 'the frame must carry the action the bridge handles');
  assert.ok(w.__dv3Action('ai.plan'), 'the outer bridge must accept the prepare-me action');
});

test('p17r-02: tapping it opens the plan sheet (populated history)', () => {
  const w = boot(HISTORY);
  w.openStudyPlanPanel();
  const panel = w.document.getElementById('spPanel');
  assert.ok(panel, 'the panel element must be created');
  assert.match(panel.innerHTML, /আমাকে প্রস্তুত করো/, 'sheet header present');
  assert.match(panel.innerHTML, /জ্যামিতি/, 'the weak topic must appear in the plan');
  assert.match(panel.innerHTML, /sp-block/, 'at least one study block must render');
});

test('p17r-03: empty history shows the honest empty state, never a fake plan', () => {
  const w = boot(EMPTY);
  w.openStudyPlanPanel();
  const panel = w.document.getElementById('spPanel');
  assert.ok(panel, 'the panel must still open with no data');
  assert.match(panel.innerHTML, /sp-hero/, 'hero message present');
  assert.doesNotMatch(panel.innerHTML, /sp-block/, 'no fabricated study blocks');
});

test('p17r-04: closing removes the sheet', () => {
  const w = boot(HISTORY);
  w.openStudyPlanPanel();
  assert.ok(w.document.getElementById('spPanel'), 'open first');
  w.closeStudyPlanPanel();
  assert.equal(w.document.getElementById('spPanel'), null, 'close must remove it');
});

test('p17r-05: the panel calls no model and writes no data', () => {
  assert.ok(!/\bfetch\s*\(/.test(PANEL) && !/XMLHttpRequest/.test(PANEL), 'panel must not fetch');
  assert.ok(!/dbPut|objectStore\(/.test(PANEL), 'panel is read-only');
});
