/* P17 — the "prepare me" entry point must be reachable from the dashboard.
 *
 * The engine and panel shipped in cd52d43 but were never loaded or wired, so the
 * whole feature was dead code: the scripts were absent from index.html and the
 * service-worker shell, and no dashboard card called openStudyPlanPanel(). This
 * suite pins the wiring so it cannot silently come unwired again. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const H = readFileSync('index.html', 'utf8');
const SW = readFileSync('sw.js', 'utf8');
const V2 = readFileSync('dashboard-v2.js', 'utf8');

test('p17-01: engine and panel are loaded by the shell', () => {
  assert.ok(H.includes('./study-plan-engine.js?v=p17-v1'), 'index.html must load study-plan-engine.js');
  assert.ok(H.includes('./study-plan-panel.js?v=p17-v2'), 'index.html must load study-plan-panel.js');
});

test('p17-02: both P17 assets are in the service-worker precache', () => {
  assert.ok(SW.includes("'./study-plan-engine.js?v=p17-v1'"), 'sw.js APP_SHELL must precache the engine');
  assert.ok(SW.includes("'./study-plan-panel.js?v=p17-v2'"), 'sw.js APP_SHELL must precache the panel');
});

test('p17-03: the engine loads before the panel that reads it', () => {
  const e = H.indexOf('study-plan-engine.js?v=p17-v1');
  const p = H.indexOf('study-plan-panel.js?v=p17-v2');
  assert.ok(e > -1 && p > -1 && e < p, 'engine script tag must precede the panel script tag');
});

test('p17-04: the dashboard exposes a guarded prepare-me entry point', () => {
  assert.match(V2, /'ai\.plan': \(\) => \(window\.openStudyPlanPanel \? window\.openStudyPlanPanel\(\)/,
    'the plan card must call openStudyPlanPanel() through the guarded pattern');
  assert.match(V2, /'ai\.plan'/, 'the prepare card must have an action id in the frame bridge');
  assert.match(V2, /data-action="ai\.plan"/, 'the prepare card must be placed in the rendered frame');
});

test('p17-05: the button label names the action in Bangla', () => {
  assert.ok(V2.includes('আমাকে প্রস্তুত করো'), 'the card must show the Bangla action label');
});

test('p17-06: the panel defines the globals the dashboard calls', () => {
  const P = readFileSync('study-plan-panel.js', 'utf8');
  assert.ok(P.includes('window.openStudyPlanPanel = open'), 'panel must export openStudyPlanPanel');
  assert.ok(P.includes('window.closeStudyPlanPanel'), 'panel must export closeStudyPlanPanel');
});

test('p17-07: the engine is a deterministic planner, not an LLM call', () => {
  const E = readFileSync('study-plan-engine.js', 'utf8');
  assert.ok(!/\bfetch\s*\(/.test(E), 'engine must not call fetch');
  assert.ok(!/XMLHttpRequest/.test(E), 'engine must not use XHR');
  assert.ok(!/openai|gemini|anthropic|api\./i.test(E), 'engine must not call a model provider');
});
