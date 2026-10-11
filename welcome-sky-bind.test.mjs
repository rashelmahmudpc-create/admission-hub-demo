/* The v5 story design must reach the real account flow, not a look-alike.
 *
 * This boots the REAL welcome-onboarding.js in jsdom with a stub fetch, then
 * clicks the design's entry buttons and asserts the account controls
 * (account-access.js's roles) actually fired. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const JS = readFileSync('welcome-onboarding.js', 'utf8');
const TEMPLATE = readFileSync('welcome-onboarding.html', 'utf8');

async function boot() {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>
    <div id="ah-account-page" class="ah-account-page" hidden>
      <main class="ah-account-shell" data-current-view="welcome">
        <div class="ah-account-head"><span class="ah-welcome-mount"></span></div>
        <div class="ah-account-body">
          <div class="ah-account-view" data-view="welcome">
            <div class="ah-entry-actions">
              <button data-role="welcome-signup"></button>
              <button data-role="welcome-login"></button>
              <div data-role="welcome-google-button"><button disabled>Continue with Google</button></div>
              <button data-role="continue-guest"></button>
            </div>
            <select data-role="welcome-language"><option value="bn">bn</option><option value="en">en</option></select>
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
  // Show the page, then boot the script (it mounts and starts the story).
  const page = w.document.getElementById('ah-account-page');
  page.hidden = false;
  page.dataset.currentView = 'welcome';
  w.eval(JS);
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
  return { w, dom, page };
}

async function shutdown(w) {
  try {
    const page = w.document.getElementById('ah-account-page');
    const view = w.document.querySelector('[data-view="welcome"]');
    if (view) view.hidden = true;
    if (page) { page.hidden = true; page.dataset.currentView = 'dashboard'; }
    await new Promise((r) => setTimeout(r, 400));
  } catch (_) {}
}

test('v5 mounts over the welcome view and marks it upgraded', async () => {
  const { w, page } = await boot();
  try {
    const root = w.document.querySelector('.ahw-sky-board');
    assert.ok(root, 'the design must be mounted');
    assert.ok(page.classList.contains('ah-welcome-upgraded'), 'the lock class must be set');
    assert.ok(w.document.getElementById('sky-app'), 'the design root must exist');
  } finally { await shutdown(w); }
});

test('সাইন আপ / সাইন ইন / গেস্ট on the design fire the real account controls', async () => {
  const { w, page } = await boot();
  try {
    const view = w.document.querySelector('[data-view="welcome"]');
    const fired = [];
    for (const role of ['welcome-signup', 'welcome-login', 'continue-guest']) {
      view.querySelector(`[data-role="${role}"]`).addEventListener('click', () => fired.push(role));
    }
    for (const slot of ['signup', 'login', 'guest']) {
      const host = w.document.querySelector(`[data-sky-slot="${slot}"]`);
      assert.ok(host, `${slot} slot must exist`);
      host.click();
    }
    assert.deepEqual(fired, ['welcome-signup', 'welcome-login', 'continue-guest']);
  } finally { await shutdown(w); }
});

test('the Google host moves into the design and Facebook stays inert', async () => {
  const { w } = await boot();
  try {
    const slot = w.document.querySelector('[data-sky-slot="google"]');
    assert.ok(slot.querySelector('[data-role="welcome-google-button"]'), 'the real Google host must be inside the design slot');
    const fb = w.document.querySelector('[data-sky-slot="facebook"]');
    assert.equal(fb.getAttribute('aria-disabled'), 'true');
    assert.ok(fb.title.includes('শীঘ্রই'));
  } finally { await shutdown(w); }
});

test('leaving the welcome view stops the story and releases the lock', async () => {
  const { w, page } = await boot();
  try {
    const view = w.document.querySelector('[data-view="welcome"]');
    assert.ok(w.document.querySelector('.ahw-sky-board'));
    view.hidden = true;
    page.dataset.currentView = 'dashboard';
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(!page.classList.contains('ah-welcome-upgraded'), 'the lock must be released');
  } finally { await shutdown(w); }
});
