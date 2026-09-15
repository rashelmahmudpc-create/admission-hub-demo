import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The crash watcher is the IIFE that owns window.__ahCrashWatch. Extract just
// that block so the test drives the real handler, not a re-implementation.
function crashWatcherSource() {
  const start = HTML.indexOf('<script>', HTML.indexOf('id="ah-boot-min"'));
  const marker = 'window.__ahCrashWatch';
  const i = HTML.indexOf(marker);
  assert.ok(i > 0, 'crash watcher must exist in index.html');
  const open = HTML.lastIndexOf('<script>', i);
  const close = HTML.indexOf('</script>', i);
  assert.ok(open > 0 && close > open, 'crash watcher script block must be parseable');
  return HTML.slice(open + '<script>'.length, close);
}

function boot() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://admissionhub.pages.dev/#dashboard', runScripts: 'outside-only'
  });
  const { window } = dom;
  window.eval(crashWatcherSource());
  return window;
}

const pill = window => window.document.getElementById('ahCrashPill');

test('a real script defect is reported as a defect, never as a network fault', async () => {
  const window = boot();
  // The server copy is genuinely broken, so there is nothing a refresh can fix.
  window.fetch = async () => ({ text: async () => 'function broken( {' });
  window.dispatchEvent(new window.ErrorEvent('error', {
    message: 'Uncaught SyntaxError: Unexpected end of input',
    filename: 'https://admissionhub.pages.dev/broken.js',
    lineno: 1, colno: 20
  }));
  await sleep(30);
  const el = pill(window);
  assert.ok(el, 'a genuine defect must still surface to the owner');
  assert.match(el.textContent, /স্ক্রিপ্টে সমস্যা/, 'must name it as a code defect');
  assert.doesNotMatch(el.textContent, /নেটওয়ার্ক/, 'must not blame the network');
  window.close();
});

test('a truncated download self-heals silently, then asks for a refresh if it repeats', async () => {
  const window = boot();
  window.fetch = async () => ({ text: async () => '' });
  const fail = () => window.dispatchEvent(new window.ErrorEvent('error', {
    message: 'Uncaught SyntaxError: Unexpected end of input',
    filename: 'https://admissionhub.pages.dev/truncated.js',
    lineno: 1, colno: 20
  }));

  // First truncation: the SW precache can serve the complete file, so the
  // handler reloads once instead of alarming the owner.
  fail();
  await sleep(30);
  assert.equal(pill(window), null, 'the first truncation must self-heal, not alarm');
  assert.ok(Number(window.sessionStorage.getItem('ah-script-reload')) > 0, 'must record the reload attempt');

  // A repeat inside the guard window is the only case that surfaces a pill.
  fail();
  await sleep(30);
  const el = pill(window);
  assert.ok(el, 'a repeating truncation must surface to the owner');
  assert.match(el.textContent, /নেটওয়ার্ক|রিফ্রেশ/, 'must offer the refresh remedy');
  window.close();
});

test('aborted fetches and cancelled work never raise the red pill', async () => {
  const window = boot();
  const abort = new Error('The user aborted a request.');
  abort.name = 'AbortError';
  window.dispatchEvent(new window.PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: abort }));
  window.dispatchEvent(new window.ErrorEvent('error', { message: 'Script error.' }));
  await sleep(30);
  assert.equal(pill(window), null, 'benign cancellations must stay silent');
  window.close();
});

test('the same failure surfaced twice shows one pill, not two', async () => {
  const window = boot();
  const showTwice = () => window.dispatchEvent(new window.ErrorEvent('error', {
    message: 'Widget exploded', filename: 'https://admissionhub.pages.dev/app.js', lineno: 3, colno: 9
  }));
  showTwice();
  showTwice();
  await sleep(30);
  assert.equal(window.document.querySelectorAll('#ahCrashPill').length, 1, 'one failure, one pill');
  assert.match(pill(window).textContent, /Widget exploded/);
  window.close();
});
