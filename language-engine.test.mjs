/* T7b — Live app-wide language switching.

   Owner report: choosing English in Preferences left the account and profile
   flows in Bengali. Only `ai-agent-chat.js` listened for `ah:lang`; every other
   module writes Bengali inline, and there is no `data-bn` markup to switch in
   the dynamically rendered views.

   The fix is a central engine (`language-engine.js`) that owns the Bengali →
   English table and rewrites rendered text nodes plus the placeholder /
   aria-label / title attributes, re-running on `ah:lang` and on DOM insertion.

   These tests cover the behaviour that matters: text actually switches, late
   markup is covered, unknown copy degrades to Bengali rather than showing
   something wrong, and switching back restores the exact original. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const ENGINE = readFileSync(new URL('./language-engine.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const AUTH = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');
const PROFILE = readFileSync(new URL('./profile-ui.js', import.meta.url), 'utf8');

async function setup({ lang = 'en', body = '' } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, {
    url: 'https://admissionhub.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  if (lang) window.localStorage.setItem('ahLang', lang);
  await new Promise((resolve) => {
    if (window.document.readyState === 'complete') return resolve();
    window.addEventListener('load', resolve, { once: true });
  });
  window.eval(ENGINE);
  return dom;
}

const text = (dom) => dom.window.document.body.textContent.replace(/\s+/g, ' ').trim();

test('English switches rendered text that no module translates itself', async () => {
  const dom = await setup({ body: '<p>আগের account-এ Google যুক্ত করো</p> <button>পরে করব</button>' });
  assert.equal(text(dom), 'Link Google to your existing account Later');
});

test('placeholder, aria-label and title are translated too', async () => {
  const dom = await setup({
    body: '<input placeholder="তোমার Email" aria-label="Password দেখুন" title="বন্ধ করুন">'
  });
  const el = dom.window.document.querySelector('input');
  assert.equal(el.getAttribute('placeholder'), 'Your email');
  assert.equal(el.getAttribute('aria-label'), 'Show password');
  assert.equal(el.getAttribute('title'), 'Close');
});

test('the original Bengali is preserved on the node for attributes', async () => {
  const dom = await setup({ body: '<input placeholder="তোমার Email">' });
  const el = dom.window.document.querySelector('input');
  assert.equal(el.getAttribute('ah-orig-placeholder'), 'তোমার Email');
});

test('switching back to Bengali restores the exact original text', async () => {
  const dom = await setup({ body: '<p>পরে করব</p>' });
  assert.equal(text(dom), 'Later');
  dom.window.AhLanguage.get; // engine is installed
  dom.window.localStorage.setItem('ahLang', 'bn');
  dom.window.dispatchEvent(new dom.window.CustomEvent('ah:lang', { detail: { lang: 'bn' } }));
  assert.equal(text(dom), 'পরে করব');
});

test('late-rendered markup is translated as it is inserted', async () => {
  const dom = await setup();
  const p = dom.window.document.createElement('p');
  p.textContent = 'সব ঠিক আছে! 🎉';
  dom.window.document.body.append(p);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(text(dom), 'All set! 🎉');
});

test('unknown copy degrades to Bengali instead of inventing English', async () => {
  const dom = await setup({ body: '<p>এই বাক্যটি অভিধানে নেই</p>' });
  assert.equal(text(dom), 'এই বাক্যটি অভিধানে নেই');
});

test('script and style content is never rewritten', async () => {
  const dom = await setup({ body: '<script>var a = "পরে করব";</script><style>/* পরে করব */</style>' });
  assert.match(dom.window.document.querySelector('script').textContent, /পরে করব/);
});

test('the engine only touches text and the three display attributes', async () => {
  const dom = await setup({ body: '<input value="পরে করব" data-x="পরে করব" name="পরে করব">' });
  const el = dom.window.document.querySelector('input');
  assert.equal(el.value, 'পরে করব', 'an input value is user data, not copy');
  assert.equal(el.getAttribute('data-x'), 'পরে করব');
  assert.equal(el.getAttribute('name'), 'পরে করব');
});

test('the engine is loaded before account-access.js so first paint is translated', () => {
  const engineAt = HTML.indexOf('language-engine.js');
  const authAt = HTML.indexOf('account-access.js');
  assert.ok(engineAt > 0 && authAt > 0);
  assert.ok(engineAt < authAt, 'a later load would leave the auth shell untranslated on open');
});

test('the table covers every string the account and profile UI render today', () => {
  // Every Bengali string these modules render must have an English entry,
  // otherwise the reported bug is only partly fixed.
  const nfc = (v) => v.normalize('NFC');
  const table = nfc(ENGINE);
  const collect = (source) => {
    const seen = new Set();
    // The scan runs over raw source, so a ternary whose two branches are both
    // Bengali literals can appear as one pseudo-string. Those contain the
    // operator itself; real copy never does.
    const add = (v) => {
      const t = v.replace(/\s+/g, ' ').trim();
      if (t && !t.includes("' : ") && !t.includes('" : ')) seen.add(nfc(t));
    };
    for (const m of source.matchAll(/>([^<>{}]*[\u0980-\u09FF][^<>{}]*)</g)) add(m[1]);
    for (const m of source.matchAll(/(?:placeholder|aria-label)="([^"]*[\u0980-\u09FF][^"]*)"/g)) add(m[1]);
    return [...seen].filter((s) => s && !table.includes(`'${s}'`));
  };
  assert.deepEqual(collect(AUTH), [], 'account-flow strings would stay Bengali in English mode');
  assert.deepEqual(collect(PROFILE), [], 'profile strings would stay Bengali in English mode');
});