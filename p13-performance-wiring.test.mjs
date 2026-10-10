/* P13 — index.html and service-worker wiring for the performance layer. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');

test('p13w-01: index.html ships the performance core and runtime', () => {
  assert.ok(/p13-performance-core\.js/.test(html), 'core script tag missing');
  assert.ok(/p13-performance-runtime\.js/.test(html), 'runtime script tag missing');
});

test('p13w-02: the core loads before the runtime', () => {
  const core = html.indexOf('p13-performance-core.js');
  const runtime = html.indexOf('p13-performance-runtime.js');
  assert.ok(core > -1 && runtime > -1 && core < runtime, 'core must load before runtime');
});

test('p13w-03: the service worker precaches the performance layer', () => {
  assert.ok(/p13-performance-core\.js/.test(sw), 'core not in APP_SHELL');
  assert.ok(/p13-performance-runtime\.js/.test(sw), 'runtime not in APP_SHELL');
});
