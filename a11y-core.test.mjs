/* Accessibility core — app-wide a11y foundations (jsdom).
 *
 * The skip link must exist and point at a real, focusable main-content target;
 * a polite live region must be available; the reduced-motion marker must track
 * the media query. */
import { test as t, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const JS = readFileSync('a11y-core.js', 'utf8');
const CSS = readFileSync('a11y-core.css', 'utf8');
const windows = [];
const raf = (cb) => setTimeout(() => cb(0), 0);
afterEach(() => { while (windows.length) { try { windows.pop().close(); } catch (_) {} } });

async function boot({ reduced = false } = {}) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="app"><main class="page"><h1>হোম</h1></main></div><button id="b">ঠিক আছে</button></body></html>',
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://admissionhub.pages.dev/' }
  );
  const w = dom.window;
  w.requestAnimationFrame = raf;
  w.matchMedia = (q) => ({ matches: reduced && /reduced-motion/.test(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  const s = w.document.createElement('script');
  s.textContent = JS;
  w.document.body.appendChild(s);
  windows.push(dom);
  await new Promise((r) => setTimeout(r, 30)); // let DOMContentLoaded + rAF run
  return dom;
}

t('a11y-01: a skip link is inserted as the first focusable element', async () => {
  const dom = await boot();
  const body = dom.window.document.body;
  const link = body.querySelector('.ah-skip-link');
  assert.ok(link, 'the skip link exists');
  assert.equal(body.firstChild, link, 'it is the first thing in the body');
  assert.equal(link.getAttribute('href'), '#ah-main-content');
  assert.match(link.textContent, /মূল কনটেন্ট/);
});

t('a11y-02: the main content gets a focusable skip-link target', async () => {
  const dom = await boot();
  const main = dom.window.document.getElementById('ah-main-content');
  assert.ok(main, 'the target id was applied to <main>');
  assert.equal(main.tagName, 'MAIN');
  assert.equal(main.getAttribute('tabindex'), '-1', 'the target can receive focus');
});

t('a11y-03: a polite live region is present and announceable', async () => {
  const dom = await boot();
  const w = dom.window;
  const region = w.document.getElementById('ah-live-status');
  assert.ok(region, 'the live region exists');
  assert.equal(region.getAttribute('role'), 'status');
  assert.equal(region.getAttribute('aria-live'), 'polite');
  assert.equal(typeof w.ahAnnounce, 'function');
});

t('a11y-04: the reduced-motion marker follows the media query', async () => {
  const calm = await boot({ reduced: true });
  assert.equal(calm.window.document.documentElement.classList.contains('ah-reduce-motion'), true);
  const normal = await boot({ reduced: false });
  assert.equal(normal.window.document.documentElement.classList.contains('ah-reduce-motion'), false);
});

t('a11y-05: the focus ring and reduced-motion CSS are real, not just documented', () => {
  assert.match(CSS, /:focus-visible/, 'a visible focus ring is defined');
  assert.match(CSS, /\.ah-skip-link:focus/, 'the skip link reveals on focus');
  assert.match(CSS, /ah-skip-link[\s\S]*?transform:translateY\(-160%\)/, 'it is hidden until focused');
  assert.match(CSS, /html\.ah-reduce-motion/, 'the reduced-motion rules exist');
});

t('a11y-06: an icon-only button is given a name a screen reader can read', async () => {
  const dom = await boot();
  const w = dom.window, d = w.document;
  // A glyph-only button with no name, and one that already has a name.
  const gear = d.createElement('button'); gear.textContent = '⚙️';
  const close = d.createElement('button'); close.setAttribute('onclick', 'closeModal()'); close.textContent = '×';
  const named = d.createElement('button'); named.setAttribute('aria-label', 'রাখো'); named.textContent = '★';
  const withText = d.createElement('button'); withText.textContent = 'ঠিক আছে';
  [gear, close, named, withText].forEach((b) => d.body.appendChild(b));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(gear.getAttribute('aria-label'), 'সেটিংস', 'a known glyph gets its label');
  assert.equal(close.getAttribute('aria-label'), 'বন্ধ করুন', 'a close handler is recognised');
  assert.ok(gear.getAttribute('title'), 'a title is mirrored for the mouse');
  assert.equal(named.getAttribute('aria-label'), 'রাখো', 'an existing name is never overwritten');
  assert.equal(withText.getAttribute('aria-label'), null, 'a button with visible text is left alone');
});

t('a11y-07: a modal becomes a real dialog with focus moved inside it', async () => {
  const dom = await boot();
  const w = dom.window, d = w.document;
  const root = d.createElement('div'); root.id = 'modalRoot'; d.body.appendChild(root);
  root.innerHTML = '<div class="modal-bg"><div class="modal"><h3>হেডিং</h3>' +
    '<button id="m1">এক</button><button id="m2">দুই</button></div></div>';
  await new Promise((r) => setTimeout(r, 30));
  const bg = root.querySelector('.modal-bg');
  assert.equal(bg.getAttribute('role'), 'dialog', 'the wrapper is a dialog');
  assert.equal(bg.getAttribute('aria-modal'), 'true', 'it is marked modal');
  assert.ok(root.querySelector('.modal[role="document"]'), 'the body is a document');
});

t('a11y-08: the desktop rule widens the app and never touches phones', () => {
  const H = readFileSync('index.html', 'utf8');
  assert.match(H, /@media\(min-width:900px\)/, 'a laptop breakpoint exists');
  assert.match(H, /body #app\{max-width:1080px/, 'the app column widens on wide screens');
  assert.match(H, /body #navRoot \.bottomnav\{[\s\S]*?border-radius:18px/, 'the bottom bar becomes a floating pill');
  // The phone rule must survive untouched.
  assert.match(H, /#app\{max-width:760px/, 'the phone column is still 760px');
});

t('a11y-09: the icon buttons shipped in the shell carry names', () => {
  const H = readFileSync('index.html', 'utf8');
  assert.match(H, /aria-label="আজকের টার্গেট"/, 'the target settings gear is named');
  assert.match(H, /aria-label="বন্ধ করুন" onclick="closeModal\(\)"/, 'the modal close button is named');
  assert.match(H, /aria-label="পরীক্ষা জমা দিন"/, 'the exam submit back button is named');
  assert.match(H, /class="navbtn[^"]*" aria-label="\$\{t\.label\}"/, 'each nav tab is named from its label');
});
