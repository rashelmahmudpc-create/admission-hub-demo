/* T7c/T7b — the saved preference and the live engines must agree.

   `loadPrefs()` in profile-ui.js and the global `AhAppearance` engine in
   index.html both persist the same choice under different keys
   (`ah-profile-prefs-v1` vs `ah-appearance`, and the language likewise:
   `ahLang` is shared but the preference copy is separate). Only the picker
   writes both, so a synced account or a fresh device could hold a preference
   the engines never saw — the user picks Premium Green, and the next device
   renders light.

   Boot now reconciles them. The direction matters: with no preference saved the
   engine key carries the real choice and must seed the preference, otherwise
   first run would overwrite the user with defaults. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const UI = readFileSync(new URL('./profile-ui.js', import.meta.url), 'utf8');
const PREFS_KEY = 'ah-profile-prefs-v1';

async function boot({ prefs = null, appearance = null, lang = null } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://admissionhub.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  if (prefs !== null) window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  if (appearance !== null) window.localStorage.setItem('ah-appearance', appearance);
  if (lang !== null) window.localStorage.setItem('ahLang', lang);

  const applied = [];
  window.AhAppearance = {
    get: () => { try { return window.localStorage.getItem('ah-appearance') || 'light'; } catch (_) { return 'light'; } },
    set: (m) => { try { window.localStorage.setItem('ah-appearance', m); } catch (_) {} },
    apply: () => applied.push('appearance'),
    resolved: () => 'light'
  };
  window.AhI18n = {
    get: () => { try { return window.localStorage.getItem('ahLang') === 'en' ? 'en' : 'bn'; } catch (_) { return 'bn'; } },
    set: (l) => { try { window.localStorage.setItem('ahLang', l); } catch (_) {} },
    apply: () => applied.push('i18n')
  };
  window.eval(UI);
  await new Promise((r) => setTimeout(r, 10));
  return { dom, window, applied };
}

const read = (window) => {
  const p = JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}');
  return {
    prefs: p,
    appearance: window.localStorage.getItem('ah-appearance'),
    // What the engine would actually render: an absent key means the default,
    // so "nothing written" is a correct outcome when the value already agrees.
    effective: window.localStorage.getItem('ah-appearance') || 'light',
    lang: window.localStorage.getItem('ahLang') || 'bn'
  };
};

test('a synced preference reaches the engines on a device that never set it', async () => {
  const { window } = await boot({ prefs: { appearance: 'green', language: 'en', notifications: 'on', aiAssistant: 'on', avatarStyle: 0, avatarGender: 'boy', v: 1 } });
  const s = read(window);
  assert.equal(s.appearance, 'green', 'Premium Green must survive a sync to a new device');
  assert.equal(s.lang, 'en', 'English must survive a sync to a new device');
});

test('every stored appearance mode is applied, not just the default', async () => {
  for (const mode of ['light', 'dark', 'system', 'green']) {
    const { window } = await boot({ prefs: { appearance: mode, language: 'bn', v: 1 } });
    assert.equal(read(window).effective, mode, `${mode} must be applied`);
  }
});

test('with no preference saved, the engine key seeds the preference', async () => {
  // The global picker writes ah-appearance without ever touching the profile
  // preference. Boot must not clobber that choice back to light.
  const { window } = await boot({ appearance: 'green', lang: 'en' });
  const s = read(window);
  assert.equal(s.prefs.appearance, 'green');
  assert.equal(s.prefs.language, 'en');
});

test('a fresh install with nothing saved stays on the defaults', async () => {
  const { window } = await boot();
  const s = read(window);
  assert.equal(s.appearance ?? 'light', 'light');
  assert.equal(s.lang ?? 'bn', 'bn');
  assert.equal(s.prefs.appearance, 'light');
  assert.equal(s.prefs.language, 'bn');
});

test('an agreeing preference still re-applies the engines after load', async () => {
  const { applied } = await boot({ prefs: { appearance: 'dark', language: 'bn', v: 1 }, appearance: 'dark', lang: 'bn' });
  assert.ok(applied.includes('appearance'), 'appearance must be re-applied for late-rendered chrome');
});

test('an invalid stored mode cannot be pushed into the engine', async () => {
  const { window } = await boot({ prefs: { appearance: 'neon', language: 'bn', v: 1 } });
  assert.ok(['light', 'dark', 'system', 'green'].includes(read(window).effective));
});