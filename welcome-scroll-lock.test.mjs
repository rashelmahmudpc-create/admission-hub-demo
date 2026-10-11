/* Welcome scroll-lock regression (owner report 2026-10-11).
 *
 * The upgraded welcome screen pins html/body with position:fixed +
 * overflow:hidden so nothing moves on that screen. The bug: the lock keyed on
 * .ah-welcome-upgraded, a class that is added once and never removed when the
 * student leaves welcome — so the whole app stopped scrolling.
 *
 * These tests boot the REAL welcome-onboarding.js in jsdom and assert the lock
 * is released on both exit paths, plus pin the CSS selector that guards it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const CSS = readFileSync('welcome-onboarding.css', 'utf8');
const JS = readFileSync('welcome-onboarding.js', 'utf8');
const TEMPLATE = readFileSync('welcome-onboarding.html', 'utf8');

test('ws-01: no scroll-lock rule is guarded by the bare class alone', () => {
  // Every rule that actually locks scrolling (overflow:hidden!important on a
  // :has() ancestor selector) must also require the visible welcome view. The
  // old rule matched the moment .ah-welcome-upgraded was added, and the class is
  // never removed on leaving welcome — that is what froze the whole app.
  const locking = CSS.split('}')
    .filter((rule) => rule.includes('overflow:hidden!important') && rule.includes(':has('));
  assert.ok(locking.length > 0, 'the welcome lock must still exist');
  for (const rule of locking) {
    assert.ok(rule.includes('[data-view="welcome"]:not([hidden])'),
      `a scroll lock still keys on the bare class: ${rule.slice(0, 80)}`);
  }
});

test('ws-02: the lock now requires the welcome view to be visible', () => {
  assert.match(CSS, /\[data-view="welcome"\]:not\(\[hidden\]\)/, 'lock must be guarded by the visible welcome view');
  assert.match(CSS, /overflow:hidden!important/, 'the welcome lock itself must still exist');
});

test('ws-03: the script releases the lock when the view is left or the page is hidden', () => {
  assert.match(JS, /const releaseLock=/, 'a releaseLock helper must exist');
  assert.match(JS, /page\.dataset\.currentView!=='welcome'/, 'releaseLock must drop the class off the welcome view');
  assert.match(JS, /page\.hidden\|\|/, 'releaseLock must drop the class when the page is hidden');
});

/* ── runtime: boot the real script ── */
async function boot() {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>
    <div id="ah-account-page" class="ah-account-page" hidden>
      <main class="ah-account-shell">
        <div class="ah-account-body">
          <div class="ah-account-view" data-view="welcome">
            <button data-role="welcome-signup"></button>
            <button data-role="welcome-language"></button>
          </div>
        </div>
      </main>
    </div></body></html>`, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  w.fetch = async () => ({ ok: true, text: async () => TEMPLATE });
  Object.defineProperty(w.document, 'currentScript', {
    configurable: true,
    value: { src: 'https://example.com/welcome-onboarding.js' }
  });
  w.eval(JS);
  // mount() awaits fetch; let the microtasks and the mount observer settle.
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 5));
  return { w, dom };
}

const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 5)); };

/* Park the page, which makes the script stop its carousel interval, then let
   its short blend timers drain. Nothing is re-armed afterwards, so the process
   has no pending handles and exits on its own — calling window.close() here
   races jsdom's teardown and throws from a late callback instead. */
async function shutdown(w) {
  try {
    const page = w.document.getElementById('ah-account-page');
    const view = w.document.querySelector('[data-view="welcome"]');
    if (view) view.hidden = true;
    if (page) page.hidden = true;
    await new Promise((r) => setTimeout(r, 520));
  } catch (_) {}
}

test('ws-04: while welcome is active the lock class is present', async () => {
  const { w, dom } = await boot();
  try {
    const page = w.document.getElementById('ah-account-page');
    page.hidden = false;
    page.dataset.currentView = 'welcome';
    w.document.querySelector('[data-view="welcome"]').hidden = false;
    page.classList.add('ah-welcome-upgraded');
    await settle();
    assert.ok(page.classList.contains('ah-welcome-upgraded'), 'lock class must persist on the active welcome view');
  } finally { await shutdown(w); }
});

test('ws-05: leaving the welcome view releases the lock (the reported bug)', async () => {
  const { w, dom } = await boot();
  try {
    const page = w.document.getElementById('ah-account-page');
    const view = w.document.querySelector('[data-view="welcome"]');
    page.hidden = false;
    page.dataset.currentView = 'welcome';
    view.hidden = false;
    page.classList.add('ah-welcome-upgraded');
    await settle();
    assert.ok(page.classList.contains('ah-welcome-upgraded'), 'precondition: locked on welcome');

    // The student leaves the welcome screen — showView() hides the welcome view
    // and moves data-current-view on.
    view.hidden = true;
    page.dataset.currentView = 'dashboard';
    await settle();
    assert.ok(!page.classList.contains('ah-welcome-upgraded'), 'lock class must be gone after leaving welcome');
  } finally { await shutdown(w); }
});

test('ws-06: closing the account page also releases the lock', async () => {
  const { w, dom } = await boot();
  try {
    const page = w.document.getElementById('ah-account-page');
    page.hidden = false;
    page.dataset.currentView = 'welcome';
    w.document.querySelector('[data-view="welcome"]').hidden = false;
    page.classList.add('ah-welcome-upgraded');
    await settle();

    page.hidden = true;
    await settle();
    assert.ok(!page.classList.contains('ah-welcome-upgraded'), 'lock class must be gone when the page is hidden');
  } finally { await shutdown(w); }
});
