import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const UI = readFileSync(new URL('./profile-ui.js', import.meta.url), 'utf8');
const CATALOG = readFileSync(new URL('./academic-catalog.js', import.meta.url), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(predicate, label, timeout = 3000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = predicate();
    if (value) return value;
    await sleep(5);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

const PROFILE = {
  publicId: 'AH-UNI00001',
  completion: 40,
  joinedYear: '2026',
  profile: {
    fullName: 'Uni Student',
    dob: '2007-04-11',
    mobile: '01712345678',
    school: { id: 'manual', name: 'Model High School', district: 'Dhaka' },
    higherInstitution: null,
    bio: '',
    visibility: 'private',
    admissionSession: '',
    targets: [],
    subjects: []
  },
  context: { greeting: 'হ্যালো' }
};

// Boot against the REAL academic catalog (academic-catalog.js) so the
// suggestion list is the one students actually see, not a stub.
function boot() {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', {
    url: 'https://admissionhub.pages.dev/#my-profile',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.calls = [];
  window.NotificationHub = { openCenter() {} };
  window.AdmissionAccount = { isVerified: () => true, getSessionState: () => 'AUTHENTICATED', open() {} };
  window.AhI18n = { set() {} };
  window.AhAppearance = { set() {} };
  window.CACHE = { examResults: [], mistakes: [] };
  window.fetch = async (url, init = {}) => {
    const u = String(url);
    window.calls.push({ url: u, method: init.method || 'GET', body: init.body });
    const body = (u.includes('/api/auth/v1/profile/patch') || /profile\/avatar/.test(u))
      ? { saved: true, profile: { ...PROFILE.profile, version: 2 } }
      : (u.includes('/api/auth/v1/profile') ? PROFILE : {});
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
  };
  window.eval(CATALOG);
  window.eval(UI);
  assert.ok(window.AH_AcademicCatalog, 'catalog must install');
  window.renderProfilePage();
  return window;
}

const clickOn = (window, el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

async function openAcademicPage(window) {
  await waitFor(() => window.document.querySelector('[data-role="open-academic"]'), 'profile page');
  await waitFor(() => {
    clickOn(window, window.document.querySelector('[data-role="open-academic"]'));
    return window.document.querySelector('#pp-acad-u');
  }, 'academic page');
  return window.document.querySelector('#pp-acad-u');
}

const typeInto = (window, input, value) => {
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
};

// The owner-visible flow: type a university, the list opens, tap a suggestion.
// The picked catalog entry must land in the input box and actually persist.
async function pickUniversity(window, query) {
  const input = window.document.querySelector('#pp-acad-u') || await openAcademicPage(window);
  typeInto(window, input, query);
  const box = await waitFor(() => {
    const b = window.document.querySelector('#pp-acad-ulist');
    return b && !b.hidden && b.querySelector('[data-role="acad-pick-uni"]') ? b : null;
  }, `suggestions for "${query}"`);
  const first = box.querySelector('[data-role="acad-pick-uni"]');
  const label = first.querySelector('b').textContent;
  clickOn(window, first);
  return label;
}

test('typing a university opens suggestions and tapping one keeps the picked name', async () => {
  const window = boot();
  await openAcademicPage(window);

  const label = await pickUniversity(window, 'BUET');
  // The label must be the catalog's own official name for that entry.
  const official = window.AH_AcademicCatalog.getUniversity('buet');
  assert.equal(label, official.name);

  // After the re-render the input must still show the official catalog name —
  // not the raw typed text and not an empty box.
  await waitFor(() => {
    const input = window.document.querySelector('#pp-acad-u');
    return input && input.value === label;
  }, 'picked university reflected in the input');
});

test('picking a suggestion then adding the target persists the official name and unit', async () => {
  const window = boot();
  await openAcademicPage(window);

  // A target needs a session before units resolve from the catalog.
  const session = window.document.querySelector('#pp-acad-session');
  session.value = '2026';
  session.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitFor(() => window.document.querySelector('#pp-acad-session')?.value === '2026', 'session applied');

  const label = await pickUniversity(window, 'Dhaka');

  // Choose a unit, then add the target.
  const unit = await waitFor(() => {
    const u = window.document.querySelector('#pp-acad-unit');
    return u && !u.disabled && u.options.length > 1 ? u : null;
  }, 'units populated from catalog');
  unit.selectedIndex = 1;
  unit.dispatchEvent(new window.Event('change', { bubbles: true }));

  await waitFor(() => {
    clickOn(window, window.document.querySelector('[data-role="acad-add-target"]'));
    return window.document.querySelector('#pp-acad-u')
      && !window.document.querySelector('#pp-acad-u').value
      && window.document.querySelector('.pp-acad-target');
  }, 'target chip added');

  await waitFor(() => window.document.querySelector('[data-role="acad-save"]'), 'save button');
  clickOn(window, window.document.querySelector('[data-role="acad-save"]'));

  const patch = await waitFor(() => window.calls.find(c => c.url.includes('/profile/patch')), 'patch call');
  const fields = JSON.parse(patch.body).fields;
  assert.ok(Array.isArray(fields.targets) && fields.targets.length === 1, 'one target saved');
  assert.equal(fields.targets[0].name, label, 'the catalog name is what gets saved');
  assert.ok(fields.targets[0].unit, 'the chosen unit is saved');
  assert.equal(fields.admissionSession, '2026');
});

test('a typed university that matches nothing still saves as a manual entry', async () => {
  const window = boot();
  await openAcademicPage(window);
  const input = window.document.querySelector('#pp-acad-u');
  typeInto(window, input, 'Zzz Nonexistent Academy 99');
  await sleep(80);

  clickOn(window, window.document.querySelector('[data-role="acad-add-target"]'));
  await waitFor(() => window.document.querySelector('.pp-acad-target'), 'manual target chip');
  clickOn(window, window.document.querySelector('[data-role="acad-save"]'));

  const patch = await waitFor(() => window.calls.find(c => c.url.includes('/profile/patch')), 'patch call');
  const fields = JSON.parse(patch.body).fields;
  assert.equal(fields.targets[0].name, 'Zzz Nonexistent Academy 99',
    'an unmatched manual name must survive, not be dropped');
});

test('suggestions never offer the same university twice and stay bounded', async () => {
  const window = boot();
  await openAcademicPage(window);
  typeInto(window, window.document.querySelector('#pp-acad-u'), 'university');

  const box = await waitFor(() => {
    const b = window.document.querySelector('#pp-acad-ulist');
    return b && !b.hidden ? b : null;
  }, 'suggestions');
  const names = [...box.querySelectorAll('[data-role="acad-pick-uni"] b')].map(n => n.textContent);
  assert.ok(names.length > 0 && names.length <= 5, `expected 1-5 suggestions, got ${names.length}`);
  assert.equal(new Set(names).size, names.length, 'no duplicate rows');
});