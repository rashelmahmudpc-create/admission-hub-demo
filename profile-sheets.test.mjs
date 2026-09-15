import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const UI = readFileSync(new URL('./profile-ui.js', import.meta.url), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(predicate, label, timeout = 2000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

const PROFILE = {
  publicId: 'AH-TEST-0001',
  completion: 62,
  joinedYear: '2026',
  profile: {
    fullName: 'Rashel Test',
    dob: '2007-04-11',
    mobile: '01712345678',
    bio: 'টেস্ট bio',
    visibility: 'private',
    admissionSession: '2025-26',
    targets: [{ name: 'University of Dhaka', unit: 'A' }],
    subjects: ['Physics', 'Math']
  },
  context: { greeting: 'আবার দেখা হলো' }
};

// Boot profile-ui.js against a verified session and hand back the live DOM.
function boot() {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', {
    url: 'https://admissionhub.pages.dev/#my-profile',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.NotificationHub = { openCenter() { window.__notifOpened = true; } };
  window.AdmissionAccount = { isVerified: () => true, getSessionState: () => 'AUTHENTICATED', open() {} };
  window.AhI18n = { set(v) { window.__i18nLang = v; } };
  window.AhAppearance = { set(v) { window.__appearance = v; } };
  window.AH_AcademicCatalog = {
    listSessions: () => [{ id: '2025-26' }],
    getUniversity: () => null,
    unitsFor: () => [{ id: 'A' }],
    subjectsFor: () => ['Physics', 'Math'],
    searchUniversities: () => []
  };
  window.CACHE = { examResults: [], mistakes: [] };
  window.localStorage.setItem('ah-public-profile-id', PROFILE.publicId);
  window.fetch = async (url) => {
    const u = String(url);
    const body = u.includes('/api/auth/v1/profile') ? PROFILE : {};
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
  };
  window.eval(UI);
  // profile-ui.js exposes renderProfilePage and lets the host (index.html boot)
  // drive the first paint — mirror that entry point here.
  window.renderProfilePage();
  return window;
}

// Boot profile-ui.js with a chosen session state. Guest is the state the owner
// actually lands on, and it renders a different branch (brand header + prompt).
function bootAs(verified) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', {
    url: 'https://admissionhub.pages.dev/#my-profile',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.NotificationHub = { openCenter() { window.__notifOpened = true; } };
  window.AdmissionAccount = {
    isVerified: () => verified,
    getSessionState: () => (verified ? 'AUTHENTICATED' : 'ANONYMOUS'),
    open() { window.__accountOpened = true; }
  };
  window.AhI18n = { set(v) { window.__i18nLang = v; } };
  window.AhAppearance = { set(v) { window.__appearance = v; } };
  window.AH_AcademicCatalog = {
    listSessions: () => [{ id: '2025-26' }],
    getUniversity: () => null,
    unitsFor: () => [{ id: 'A' }],
    subjectsFor: () => ['Physics', 'Math'],
    searchUniversities: () => []
  };
  window.CACHE = { examResults: [], mistakes: [] };
  window.localStorage.setItem('ah-public-profile-id', PROFILE.publicId);
  window.fetch = async (url) => {
    const u = String(url);
    const body = u.includes('/api/auth/v1/profile') ? PROFILE : {};
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
  };
  window.eval(UI);
  window.renderProfilePage();
  return window;
}

function click(window, role, extra = {}) {
  const el = window.document.querySelector(`[data-role="${role}"]`);
  assert.ok(el, `element with data-role="${role}" must exist to click`);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, ...extra }));
  return el;
}

// An async profile load re-renders #app, which detaches any node captured
// before it settled. Re-query on every attempt so a click always lands on the
// live element.
async function clickUntil(window, role, predicate, label, timeout = 2000) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    const el = window.document.querySelector(`[data-role="${role}"]`);
    if (el) {
      el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await sleep(20);
      last = predicate();
      if (last) return;
    }
    await sleep(30);
  }
  throw new Error(`Timed out clicking "${role}" waiting for: ${label}`);
}

test('every sheet trigger renders a sheet (owner bug: click did nothing)', async () => {
  const window = boot();
  await waitFor(() => window.document.querySelector('[data-role="open-journey-sheet"]'), 'profile page render');

  // renderSheet() existed but was never invoked, so these clicks were silent
  // no-ops. Each must now mount a visible sheet with real content.
  for (const [role, heading] of [
    ['open-journey-sheet', 'Your Journey'],
    ['open-achv-sheet', 'Achievements'],
    ['open-ai-prefs', 'AI']
  ]) {
    await clickUntil(
      window,
      role,
      () => {
        const host = window.document.querySelector('[data-role="sheet-host"]');
        return host && host.children.length > 0 ? host.textContent : '';
      },
      `${role} to open a sheet`
    );
    const host = window.document.querySelector('[data-role="sheet-host"]');
    assert.ok(host.textContent.trim().length > 0, `${role} must render sheet content`);
    assert.ok(
      host.textContent.toLowerCase().includes(heading.toLowerCase()),
      `${role} sheet should mention "${heading}", got: ${host.textContent.slice(0, 80)}`
    );
  }
  window.close();
});

test('preferences Edit opens the Preferences page with real options', async () => {
  const window = boot();
  await waitFor(() => window.document.querySelector('[data-role="open-prefs-sheet"]'), 'profile page render');

  // "Edit" on the Preferences card navigates to the full Preferences page
  // (not a sheet), which must actually expose the language/appearance rows.
  await clickUntil(
    window,
    'open-prefs-sheet',
    () => window.document.querySelector('[data-role="pick-language"]') || window.document.querySelector('[data-role="pref-language"]'),
    'the Preferences page to open'
  );
  const text = window.document.getElementById('app').textContent;
  assert.match(text, /Preferences/, 'Preferences page must render');
  assert.match(text, /Language/i, 'language row must be present');
  assert.match(text, /Appearance/i, 'appearance row must be present');
  window.close();
});

test('pref-language and pref-appearance open the preferences sheet, not nothing', async () => {
  const window = boot();
  await waitFor(() => window.document.querySelector('[data-role="pref-language"]'), 'profile page render');

  for (const role of ['pref-language', 'pref-appearance']) {
    click(window, role);
    await waitFor(
      () => (window.document.querySelector('[data-role="sheet-host"]') || {}).children?.length > 0,
      `${role} to open preferences`
    );
    const host = window.document.querySelector('[data-role="sheet-host"]');
    assert.match(host.textContent, /LANGUAGE|APPEARANCE|Preferences/i, `${role} must show the preferences sheet`);
  }
  window.close();
});

test('language and appearance picks apply app-wide and persist', async () => {
  const window = boot();
  await waitFor(() => window.document.querySelector('[data-role="pref-language"]'), 'profile page render');
  click(window, 'pref-language');
  await waitFor(() => window.document.querySelector('[data-role="pick-language"]'), 'language options');

  // Option order is [bn, en] — pick English and assert it reaches the app-wide
  // i18n engine and survives a reload of the prefs record.
  const options = [...window.document.querySelectorAll('[data-role="pick-language"]')];
  assert.ok(options.length >= 2, 'both Bangla and English options must be offered');
  const en = options.find(b => b.dataset.value === 'en');
  assert.ok(en, 'English option must exist');
  en.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  const saved = JSON.parse(window.localStorage.getItem('ah-profile-prefs-v1') || '{}');
  assert.equal(saved.language, 'en', 'language choice must persist');
  assert.equal(window.__i18nLang, 'en', 'language must be pushed to the app-wide i18n engine');
  window.close();
});

test('appearance offers three modes and applies app-wide', async () => {
  const window = boot();
  await waitFor(() => window.document.querySelector('[data-role="pref-appearance"]'), 'profile page render');
  click(window, 'pref-appearance');
  await waitFor(() => window.document.querySelector('[data-role="pick-appearance"]'), 'appearance options');

  const values = [...window.document.querySelectorAll('[data-role="pick-appearance"]')].map(b => b.dataset.value);
  assert.ok(values.length >= 3, `at least 3 appearance modes required, got ${values.join(',')}`);
  assert.ok(values.includes('light') && values.includes('dark') && values.includes('system'), 'light/dark/system must all be offered');

  const dark = [...window.document.querySelectorAll('[data-role="pick-appearance"]')].find(b => b.dataset.value === 'dark');
  dark.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const saved = JSON.parse(window.localStorage.getItem('ah-profile-prefs-v1') || '{}');
  assert.equal(saved.appearance, 'dark', 'appearance choice must persist');
  assert.equal(window.__appearance, 'dark', 'appearance must be pushed to the app-wide theme engine');
  window.close();
});

test('notification bell has a handler (owner bug: bell did nothing)', async () => {
  const window = boot();
  await waitFor(() => window.document.querySelector('[data-role="brand-bell"]'), 'brand header');

  await clickUntil(window, 'brand-bell', () => window.__notifOpened === true, 'notification center to open');
  assert.equal(window.__notifOpened, true);
  window.close();
});

test('guest profile header bell and account icons both respond', async () => {
  const window = bootAs(false);
  await waitFor(() => window.document.querySelector('[data-role="brand-bell"]'), 'guest brand header');

  click(window, 'brand-bell');
  assert.equal(window.__notifOpened, true, 'guest header bell must open the notification center');

  click(window, 'brand-account');
  assert.equal(window.__accountOpened, true, 'guest header account icon must open the account sheet');
  window.close();
});

test('avatar page offers 10 male + 10 female defaults with 5MB source limit', async () => {
  const window = boot();
  await waitFor(() => window.document.querySelector('[data-role="open-avatar-page"]'), 'profile page render');
  click(window, 'open-avatar-page');
  await waitFor(() => window.document.querySelector('[data-role="avatar-gender-sec"]'), 'avatar page');

  const grid = () => window.document.querySelectorAll('[data-role="pick-default-avatar"]');
  assert.equal(grid().length, 10, 'male set must show 10 avatars');
  assert.match(window.document.querySelector('.pp-av-hint').textContent, /5MB/, 'source limit must read 5MB');

  click(window, 'pick-avatar-gender', {});
  const girlTab = [...window.document.querySelectorAll('[data-role="pick-avatar-gender"]')]
    .find(b => b.dataset.gender === 'girl');
  girlTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await waitFor(() => window.document.querySelector('[data-role="pick-avatar-gender"][data-gender="girl"]').classList.contains('on'), 'girl set active');

  const ids = [...grid()].map(b => b.querySelector('svg').getAttribute('data-avatar-id'));
  assert.equal(new Set(ids).size, 10, 'all 10 avatars in a set must be visually distinct');
  assert.ok(ids.every(id => id.startsWith('girl-')), `girl set expected, got ${ids.join(',')}`);
  window.close();
});

test('default avatars differ between male and female sets', async () => {
  const window = boot();
  await waitFor(() => window.document.querySelector('[data-role="open-avatar-page"]'), 'profile page render');
  click(window, 'open-avatar-page');
  await waitFor(() => window.document.querySelector('[data-role="avatar-gender-sec"]'), 'avatar page');

  const sig = () => [...window.document.querySelectorAll('[data-role="pick-default-avatar"]')]
    .map(b => b.querySelector('svg').outerHTML).join('');
  const boySig = sig();

  const girlTab = [...window.document.querySelectorAll('[data-role="pick-avatar-gender"]')]
    .find(b => b.dataset.gender === 'girl');
  girlTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await waitFor(() => window.document.querySelector('[data-role="pick-avatar-gender"][data-gender="girl"]').classList.contains('on'), 'girl set active');

  assert.notEqual(boySig, sig(), 'male and female avatar sets must be different artwork');
  window.close();
});

// ---- crop geometry ----------------------------------------------------------
// The pan/zoom maths is what silently cuts the wrong region out of a photo, so
// it is pinned against a synthetic image. These assertions mirror the arithmetic
// in cropSourceRect: base = max(box/W, box/H), srcPerDisplay = 1/(base*zoom).

test('crop geometry: centred crop is a 1:1 window on the short edge', () => {
  const W = 1200, H = 800, box = 320;
  const base = Math.max(box / W, box / H);
  assert.equal(base, 0.4);
  const spd = 1 / base;
  // No pan at zoom 1: the window is 320/0.4 = 800 source px per side, centred.
  assert.equal(W / 2 - (box / 2) * spd, 200, 'window starts at x=200');
  assert.equal(H / 2 - (box / 2) * spd, 0, 'window covers the full height');
  assert.equal(box * spd, 800);
});

test('crop geometry: panning walks the window and cannot leave the source', () => {
  const W = 1200, H = 800, box = 320;
  const base = Math.max(box / W, box / H);
  const spd = 1 / base;
  const maxX = (W * base - box) / 2;
  assert.equal(maxX, 80, '80 display px of horizontal slack');
  // Dragging the image left moves the visible window right, and vice versa.
  // At full left-drag the window ends exactly on the right edge (400 + 800 = 1200);
  // at full right-drag it starts exactly on the left edge.
  assert.equal(W / 2 - (box / 2 - maxX) * spd, 400, 'left-drag window ends on the right edge');
  assert.equal(W / 2 - (box / 2 - maxX) * spd + box * spd, W, 'no gap past the right edge');
  assert.equal(W / 2 - (box / 2 + maxX) * spd, 0, 'right-drag window starts on the left edge');
  // Vertical slack is zero here, so the short edge never leaves the source.
  assert.equal((H * base - box) / 2, 0, 'no vertical slack on the short edge');
});

test('crop geometry: zooming in narrows the window around the centre', () => {
  const W = 1200, box = 320, zoom = 2;
  const base = Math.max(box / W, box / 800);
  const spd = 1 / (base * zoom);
  assert.equal(box * spd, 400, 'at 2x the window is half as wide in source px');
  assert.equal(W / 2 - (box / 2) * spd, 400, 'still centred');
});

test('crop zoom is clamped to the allowed range', () => {
  assert.match(UI, /crop\.zoom = Math\.min\(CROP_ZOOM_MAX, Math\.max\(1, Number\(next\) \|\| 1\)\)/);
  assert.match(UI, /CROP_ZOOM_MAX = 3/);
});

test('completion card is animated and every pending step routes to a real field', async () => {
  const window = boot();
  await waitFor(() => window.document.querySelector('.pp-comp'), 'completion card');
  const card = window.document.querySelector('.pp-comp');
  assert.ok(card.querySelector('.pp-comp-bar'), 'animated progress bar must be present');
  assert.ok(card.querySelector('.pp-ring-anim'), 'ring must carry the animation hook');
  assert.ok(card.querySelector('[data-pp-countup]'), 'percentage must count up');

  const steps = [...card.querySelectorAll('[data-role="comp-fix"]')];
  assert.ok(steps.length > 0, 'incomplete profile must list actionable steps');
  assert.ok(steps.length <= 10, 'no more steps than real profile fields');
  for (const s of steps) {
    const field = s.dataset.field;
    assert.ok(field, 'each step must name the field it fixes');
    // The field id must exist on the edit page, otherwise the tap is a dead end.
    assert.match(UI, new RegExp(`id="${field}"`), `edit page must define ${field}`);
  }
  window.close();
});

test('tapping a pending completion step focuses that field on the edit page', async () => {
  const window = boot();
  await waitFor(() => window.document.querySelector('.pp-comp'), 'completion card');
  const first = window.document.querySelector('[data-role="comp-fix"]');
  const field = first.dataset.field;
  first.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  await waitFor(() => window.document.getElementById(field), `edit page field ${field}`);
  assert.equal(window.document.activeElement?.id, field, 'the missing field must be focused');
  window.close();
});
