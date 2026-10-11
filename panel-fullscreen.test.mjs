/* Full-screen panels (owner report 2026-10-11).
 *
 * Both the "prepare me" plan panel and the admission-intel panel opened as
 * bottom sheets with z-index 9000, while the bottom nav is fixed at z-index
 * 10000 — so the nav painted over the panel's lower half and its bottom button
 * could not be seen or tapped. The owner asked for a full-screen panel instead.
 *
 * These tests boot the real panel scripts in jsdom, assert the CSS now fills the
 * viewport above the nav, and prove the nav-hide class is toggled on open/close. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const PLAN = readFileSync('study-plan-panel.js', 'utf8');
const INTEL = readFileSync('admission-intel-panel.js', 'utf8');
const ENGINE = readFileSync('study-plan-engine.js', 'utf8');
const CAT = readFileSync('academic-catalog.js', 'utf8');
const INTEL_ENGINE = readFileSync('admission-intel-engine.js', 'utf8');

const HISTORY = {
  topics: [{ id: 'geometry', name: 'জ্যামিতি' }, { id: 'algebra', name: 'বীজগণিত' }],
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

function bootPlan(cache) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="navRoot"><nav class="bottomnav"></nav></div><div id="app"></div></body></html>',
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
  const w = dom.window;
  const run = (code) => { const s = w.document.createElement('script'); s.textContent = code; w.document.body.appendChild(s); };
  w.toast = () => {};
  run(`const CACHE = ${JSON.stringify(cache)};`);
  run(ENGINE); run(PLAN);
  return w;
}

function bootIntel() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="navRoot"><nav class="bottomnav"></nav></div><div id="app"></div></body></html>',
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
  const w = dom.window;
  const run = (code) => { const s = w.document.createElement('script'); s.textContent = code; w.document.body.appendChild(s); };
  run(CAT); run(INTEL_ENGINE); run(INTEL);
  return w;
}

test('fs-01: the plan overlay fills the viewport and clears the nav z-index', () => {
  const css = PLAN.slice(PLAN.indexOf('const CSS'), PLAN.indexOf('function injectCss'));
  assert.match(css, /\.sp-overlay\{position:fixed;inset:0;z-index:10050/, 'overlay must be full-viewport and above the nav (10000)');
  assert.match(css, /\.sp-sheet\{[^}]*height:100%/, 'sheet must fill the height, not cap at 90vh');
  assert.ok(!/border-radius:20px 20px 0 0/.test(css), 'the bottom-sheet corner styling must be gone');
});

test('fs-02: the plan sheet body scrolls and respects the safe areas', () => {
  const css = PLAN.slice(PLAN.indexOf('const CSS'), PLAN.indexOf('function injectCss'));
  assert.match(css, /\.sp-body\{[^}]*overflow-y:auto/, 'body must scroll');
  assert.match(css, /safe-area-inset-top/, 'header must clear the notch');
  assert.match(css, /safe-area-inset-bottom/, 'body must clear the home indicator');
});

test('fs-03: opening the plan panel hides the nav, closing restores it', () => {
  const w = bootPlan(HISTORY);
  assert.ok(!w.document.body.classList.contains('ah-panel-open'), 'nav visible before opening');
  w.openStudyPlanPanel();
  assert.ok(w.document.getElementById('spPanel'), 'panel mounted');
  assert.ok(w.document.body.classList.contains('ah-panel-open'), 'nav must be hidden while the panel owns the screen');
  w.closeStudyPlanPanel();
  assert.ok(!w.document.getElementById('spPanel'), 'panel removed');
  assert.ok(!w.document.body.classList.contains('ah-panel-open'), 'nav must come back after closing');
});

test('fs-04: the nav-hide rule is present and scoped to the panel class', () => {
  for (const [name, src] of [['plan', PLAN], ['intel', INTEL]]) {
    assert.match(src, /body\.ah-panel-open #navRoot\{visibility:hidden/, `${name}: nav must be hidden behind the full-screen panel`);
  }
});

test('fs-05: the intel panel is full-screen and toggles the nav-hide class', () => {
  const css = INTEL.slice(INTEL.indexOf('const CSS'), INTEL.indexOf('function injectCss'));
  assert.match(css, /\.ip-overlay\{position:fixed;inset:0;z-index:10050/, 'intel overlay must be full-viewport above the nav');
  assert.match(css, /\.ip-sheet\{[^}]*height:100%/, 'intel sheet must fill the height');
  assert.ok(!/border-radius:20px 20px 0 0/.test(css), 'the bottom-sheet corner styling must be gone');
  // The .ai-sheet/.ai-overlay names are also used by the global AI-agent UI, whose
  // .ai-sheet{max-width:760px;max-height:88dvh} kept this panel from filling the
  // screen. Its own classes are namespaced under ip- so nothing can collide.
  assert.ok(!/\bai-[a-z-]+/.test(css), 'intel CSS must not reuse the shared ai- class names');
  assert.ok(!/\bai-[a-z-]+/.test(INTEL.slice(INTEL.indexOf('el.innerHTML'), INTEL.indexOf('window.openAdmissionIntelPanel'))), 'intel markup must not reuse the shared ai- class names');

  const w = bootIntel();
  w.openAdmissionIntelPanel();
  assert.ok(w.document.getElementById('aiPanel'), 'intel panel mounted');
  assert.ok(w.document.body.classList.contains('ah-panel-open'), 'nav hidden while intel panel is open');
  w.closeAdmissionIntelPanel();
  assert.ok(!w.document.body.classList.contains('ah-panel-open'), 'nav restored after closing');
});
