/* T7b regression — the owner's actual complaint.

   Choosing English left the account and profile flows in Bengali. A table
   check alone does not catch this: the string can be in the table yet still
   render, or render through a path the table scan never reads. So this test
   boots the real modules with the real engine in English mode and fails if any
   Bengali is visible on screen.

   Both sw.js BUILD_ID markers and the shell are exercised by the other suites;
   this one owns "what the user sees in English". */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const ENGINE = read('language-engine.js');
const UI = read('profile-ui.js');
const AUTH = read('account-access.js');
const INSTITUTIONS = read('institutions-bd.js');

const BENGALI = /[\u0980-\u09FF]/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


const untranslated = (window) => {
  const found = new Map();
  for (const el of window.document.querySelectorAll('*')) {
    if (el.children.length) continue;
    if (['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA'].includes(el.tagName)) continue;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text && BENGALI.test(text)) found.set(text, true);
    for (const attr of ['placeholder', 'aria-label', 'title']) {
      const value = el.getAttribute(attr);
      if (value && BENGALI.test(value)) found.set(value, true);
    }
  }
  return [...found.keys()];
};

function bootProfile() {
  const dom = new JSDOM('<!doctype html><html lang="bn"><body><div id="app"></div></body></html>', {
    url: 'https://admissionhub.pages.dev/#my-profile',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.localStorage.setItem('ahLang', 'en');
  window.NotificationHub = { openCenter() {} };
  window.AdmissionAccount = { isVerified: () => true, getSessionState: () => 'AUTHENTICATED', open() {} };
  window.AhAppearance = { set() {} };
  window.AH_AcademicCatalog = {
    listSessions: () => [{ id: '2025-26' }],
    getUniversity: () => null,
    unitsFor: () => [{ id: 'A' }],
    subjectsFor: () => ['Physics', 'Math'],
    searchUniversities: () => []
  };
  window.CACHE = { examResults: [], mistakes: [] };
  window.localStorage.setItem('ah-public-profile-id', 'AH-TEST-0001');
  window.fetch = async () => ({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({
      publicId: 'AH-TEST-0001', completion: 62, joinedYear: '2026',
      profile: {
        fullName: 'Rashel Test', dob: '2007-04-11', mobile: '01712345678',
        bio: 'test bio', visibility: 'private', admissionSession: '2025-26',
        targets: [{ name: 'University of Dhaka', unit: 'A' }],
        subjects: ['Physics', 'Math']
      },
      context: { greeting: 'আবার দেখা হলো' }
    })
  });
  window.eval(ENGINE);
  window.eval(UI);
  window.renderProfilePage();
  return window;
}

function bootAuth() {
  const dom = new JSDOM('<!doctype html><html lang="bn"><body><main id="app"></main></body></html>', {
    url: 'https://admissionhub.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.localStorage.setItem('ahLang', 'en');
  window.open = () => ({ closed: false });
  window.PublicKeyCredential = undefined;
  window.fetch = async (url) => {
    const path = String(url);
    const reply = (status, body) => ({
      ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body
    });
    if (path.includes('/config')) return reply(200, {
      auth: { available: true, uiContract: 'auth-premium-v6', methods: {
        google: { available: true, clientId: 'test-client' },
        passkey: { available: false, enrollmentAvailable: false },
        telegramVerification: { available: true },
        backup: { available: false } } }
    });
    if (path.includes('/session') && !path.includes('/session/')) return reply(401, { error: { code: 'SESSION_INVALID' } });
    if (path.endsWith('/profile')) return reply(200, { profile: null });
    return reply(404, { error: { code: 'NOT_FOUND' } });
  };
  window.eval(ENGINE);
  window.eval(INSTITUTIONS);
  window.eval(AUTH);
  return window;
}

test('the profile flow shows no Bengali once English is chosen', async () => {
  const window = bootProfile();
  await sleep(300);
  assert.deepEqual(untranslated(window), [], 'these strings stayed Bengali in the profile flow');
});

test('the every sheet in the profile flow is translated too', async () => {
  const window = bootProfile();
  await sleep(250);
  const roles = ['open-prefs-sheet', 'open-privacy-page', 'open-edit-page', 'open-avatar-page', 'open-academic'];
  const missed = new Map();
  for (const role of roles) {
    const el = window.document.querySelector(`[data-role="${role}"]`);
    if (!el) continue;
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(120);
    for (const text of untranslated(window)) missed.set(`${role}: ${text}`, true);
    // Return to the profile page so the next trigger is reachable.
    const back = window.document.querySelector('[data-role="prefs-back"], [data-role="privacy-back"], [data-role="back-profile"]');
    if (back) back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(80);
  }
  assert.deepEqual([...missed.keys()], [], 'these strings stayed Bengali inside profile sheets');
});

test('the account shell shows no Bengali once English is chosen', async () => {
  const window = bootAuth();
  await sleep(400);
  const missed = untranslated(window);
  assert.deepEqual(missed, [], 'these strings stayed Bengali in the account flow');
});
