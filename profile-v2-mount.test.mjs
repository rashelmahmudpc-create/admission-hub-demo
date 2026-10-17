import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const MOUNT = readFileSync(new URL('./profile-v2-mount.js', import.meta.url), 'utf8');
const PAGE = readFileSync(new URL('./profile-v2.html', import.meta.url), 'utf8');
const INDEX = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

test('the mount replaces the profile route without touching other routes', () => {
  assert.match(MOUNT, /window\.renderProfilePage = function/);
  // It must not hijack the dashboard or any other renderer.
  assert.doesNotMatch(MOUNT, /renderDashboard\s*=/);
  assert.doesNotMatch(MOUNT, /window\.render\s*=/);
});

test('the app theme reaches the frame as a global the design boot cannot erase', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: 'https://admissionhub.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  win.AdmissionAccount = { isVerified: () => true, getSessionState: () => 'AUTHENTICATED' };
  win.AhAppearance = { get: () => 'dark', resolved: () => 'dark', set() {} };
  win.renderShell = (inner) => { win.document.getElementById('app').innerHTML = inner; };
  win.fetch = () => Promise.resolve({ ok: true, text: () => Promise.resolve(PAGE) });

  win.eval(MOUNT);
  win.renderProfilePage();
  await new Promise((r) => setTimeout(r, 40));

  const srcdoc = win.document.querySelector('iframe.pv2-frame').getAttribute('srcdoc');
  // The design's own boot calls applyTheme(), which strips data-theme from
  // <html> when its theme is 'auto', so the theme must travel as a global.
  assert.match(srcdoc, /window\.__AH_THEME__="dark"/);
  assert.doesNotMatch(srcdoc, /<html[^>]*data-theme="dark"/);

  // And the design must honour it once its boot runs.
  const frame = new JSDOM(srcdoc, {
    url: 'https://admissionhub.pages.dev/profile-v2.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(fw) { fw.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) }); },
  });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(frame.window.document.documentElement.getAttribute('data-theme'), 'dark');
  frame.window.close();
  dom.window.close();
});

test('a signed-out visitor never sees the profile design', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: 'https://admissionhub.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  win.AdmissionAccount = { isVerified: () => false, getSessionState: () => 'UNAUTHENTICATED' };
  let fallbacks = 0;
  win.renderProfilePage = () => { fallbacks += 1; win.document.getElementById('app').innerHTML = '<div id="login-card">লগইন</div>'; };
  win.renderShell = (inner) => { win.document.getElementById('app').innerHTML = inner; };
  win.fetch = () => Promise.resolve({ ok: true, text: () => Promise.resolve(PAGE) });

  win.eval(MOUNT);
  win.renderProfilePage();
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(fallbacks, 1, 'the original gated renderer must run');
  assert.equal(win.document.querySelector('iframe.pv2-frame'), null, 'no profile frame for a guest');
  assert.ok(win.document.querySelector('#login-card'), 'the login card is shown instead');
  dom.window.close();
});

test('the app shell loads the mount and its page', () => {
  assert.match(INDEX, /profile-v2-mount\.js/);
  // The page itself is fetched at runtime, so it must exist as a real asset.
  assert.ok(PAGE.includes('id="shell"'));
});

test('the frame clears the app bottom nav and carries the app theme', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: 'https://admissionhub.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  win.AdmissionAccount = { isVerified: () => true, getSessionState: () => 'AUTHENTICATED' };
  win.AhAppearance = { resolved: () => 'dark', get: () => 'dark', set() {} };
  const shells = [];
  win.renderShell = (inner) => { shells.push(inner); win.document.getElementById('app').innerHTML = inner; };
  win.fetch = () => Promise.resolve({ ok: true, text: () => Promise.resolve(PAGE) });

  win.eval(MOUNT);
  assert.equal(typeof win.renderProfilePage, 'function');
  win.renderProfilePage();
  await new Promise((r) => setTimeout(r, 40));

  const frame = win.document.querySelector('iframe.pv2-frame');
  assert.ok(frame, 'the design is mounted in its own frame');
  const doc = frame.getAttribute('srcdoc');
  assert.ok(doc, 'the frame received the page source');
  // The design's own stylesheet must survive intact.
  assert.match(doc, /\.shell\{/);
  assert.match(doc, /id="shell"/);
  // The app's theme reaches the frame.
  assert.match(doc, /window\.__AH_THEME__="dark"/);
  // The bottom nav space is reserved for the design's scroll area.
  assert.match(doc, /data-profile-v2-bridge="1"/);
  assert.match(doc, /\.scroll\{padding-bottom:calc\(96px/);
  dom.window.close();
});

test('a failed page fetch shows a visible recoverable message, never a blank screen', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: 'https://admissionhub.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  win.AdmissionAccount = { isVerified: () => true, getSessionState: () => 'AUTHENTICATED' };
  win.renderShell = (inner) => { win.document.getElementById('app').innerHTML = inner; };
  win.fetch = () => Promise.reject(new Error('offline'));

  win.eval(MOUNT);
  win.renderProfilePage();
  await new Promise((r) => setTimeout(r, 40));

  const text = win.document.getElementById('app').textContent;
  assert.match(text, /প্রোফাইল লোড হয়নি/, 'a visible failure state');
  dom.window.close();
});

test('a theme tap inside the frame reaches the app own appearance store', async () => {
  const frame = new JSDOM(PAGE.replace('</head>',
    '<script data-profile-v2-bridge="1">window.__AH_THEME__="light";</scr' + 'ipt></head>'), {
    url: 'https://admissionhub.pages.dev/profile-v2.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(fw) { fw.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) }); },
  });
  await new Promise((r) => setTimeout(r, 80));
  // The frame cannot see the parent's AhAppearance global, so the app's own
  // storage key is the contract the rest of the app reads.
  frame.window.document.dispatchEvent(new frame.window.CustomEvent('app:action', { detail: { action: 'profile.theme', theme: 'dark' } }));
  assert.equal(frame.window.localStorage.getItem('ah-appearance'), 'dark');
  frame.window.close();
});

test('the page source is fetched once and reused across route renders', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: 'https://admissionhub.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  let calls = 0;
  win.AdmissionAccount = { isVerified: () => true, getSessionState: () => 'AUTHENTICATED' };
  win.AhAppearance = { resolved: () => 'light' };
  win.renderShell = (inner) => { win.document.getElementById('app').innerHTML = inner; };
  win.fetch = () => { calls += 1; return Promise.resolve({ ok: true, text: () => Promise.resolve(PAGE) }); };

  win.eval(MOUNT);
  for (let i = 0; i < 4; i++) {
    win.renderProfilePage();
    await new Promise((r) => setTimeout(r, 15));
  }
  assert.equal(calls, 1, 'the page is fetched once, not per navigation');
  dom.window.close();
});
