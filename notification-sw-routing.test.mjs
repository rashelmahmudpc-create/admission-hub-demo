/* Executes the real notificationclick handler from firebase-messaging-sw.js and
 * checks where each engine's payload actually navigates.
 *
 * The old contract test only grepped the SW source for expected substrings, so
 * a wrong branch condition could not fail it. This runs the handler in a
 * vm sandbox with the exact `data` payloads the senders emit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SW_SRC = readFileSync('firebase-messaging-sw.js', 'utf8')
  .replace(/^\s*importScripts\([^)]*\);\s*$/gm, '');

function loadSw() {
  let click = null;
  const stored = [];
  const opened = [];
  const sandbox = {
    console, Promise, JSON, String, Date, Object, Number, Math, Array, RegExp, Error,
    importScripts: () => {},
    firebase: { initializeApp() {}, messaging() { return {}; } },
    caches: {
      open: async (name) => ({
        put: async (_req, res) => { stored.push({ name, body: await res.text() }); }
      })
    },
    Request: class { constructor(url) { this.url = url; } },
    Response: class { constructor(body) { this._b = body; } async text() { return this._b; } },
    self: null
  };
  sandbox.self = {
    addEventListener: (type, handler) => { if (type === 'notificationclick') click = handler; },
    clients: {
      matchAll: async () => [],
      openWindow: async (url) => { opened.push(url); }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(SW_SRC, sandbox);
  assert.ok(click, 'notificationclick handler must be registered');

  return async (data) => {
    let done;
    click({
      notification: { close() {}, data },
      waitUntil: (p) => { done = p; }
    });
    await done;
    return { opened: opened.at(-1), stored: stored.at(-1) };
  };
}

/* Every payload a sender actually emits, and the screen it must open.
 * Link values are the real ones in the engines: personalized/digest/event only
 * ever use 'dashboard' or 'smart-revision', global uses the admin's targetUrl. */
const CASES = [
  ['global', { gid: 'row-1', link: 'dashboard', type: 'announcement', src: 'fcm-global' }, './#dashboard'],
  ['personal', { link: 'smart-revision', src: 'fcm-personal', kind: 'revision-due' }, './#smart-revision'],
  ['event', { link: 'smart-revision', src: 'fcm-event', kind: 'exam' }, './#smart-revision'],
  ['digest', { link: 'dashboard', src: 'fcm-digest', kind: 'daily' }, './#dashboard'],
  ['test', { link: 'notifications', src: 'fcm-test' }, './#notifications'],
  ['self-test', { link: 'notifications', src: 'fcm-self-test' }, './#notifications']
];

for (const [name, data, expected] of CASES) {
  test(`notificationclick: ${name} push opens ${expected}`, async () => {
    const tap = loadSw();
    const { opened } = await tap(data);
    assert.equal(opened, expected,
      `a tap on the ${name} push must deep-link to ${expected}, got ${opened}`);
  });
}

/* The shape that actually reaches a real device.
 *
 * The SDK shows the notification itself whenever the payload carries a
 * `notification` block (our senders always set one), and it does NOT hand our
 * data over at the top level - it wraps the entire FCM payload under
 * data.FCM_MSG. Verified in sdk/firebase-messaging-compat.js:
 *   t.data = { [ut]: e }   with   ut = "FCM_MSG"
 * so our fields sit at notification.data.FCM_MSG.data.* and the link is also
 * available as FCM_MSG.fcmOptions.link. */
const wrap = (data, fcmOptions) => ({
  FCM_MSG: {
    data,
    notification: { title: 't', body: 'b' },
    ...(fcmOptions ? { fcmOptions } : {})
  }
});

for (const [name, data, expected] of CASES) {
  test(`notificationclick: SDK-wrapped ${name} push opens ${expected}`, async () => {
    const tap = loadSw();
    const { opened } = await tap(wrap(data));
    assert.equal(opened, expected,
      `on a real device the ${name} payload arrives wrapped in data.FCM_MSG; ` +
      `the tap must still deep-link to ${expected}, got ${opened}`);
  });
}

test('notificationclick: SDK-wrapped global push still logs the click', async () => {
  const tap = loadSw();
  const { stored } = await tap(wrap({ gid: 'row-7', link: 'dashboard', src: 'fcm-global' }));
  assert.ok(stored, 'a wrapped global click must be stored, or click analytics stays at 0');
  assert.equal(JSON.parse(stored.body).id, 'row-7');
});

test('notificationclick: falls back to fcmOptions.link when data carries no link', async () => {
  const tap = loadSw();
  const { opened } = await tap(wrap({ gid: 'row-8', src: 'fcm-global' }, { link: 'https://admissionhub.pages.dev/#progress' }));
  assert.ok(/progress/.test(opened), `expected the fcmOptions link to be used, got ${opened}`);
});

test('notificationclick: a leading #/ in link is stripped, not doubled', async () => {
  const tap = loadSw();
  const { opened } = await tap({ link: '#/dashboard', src: 'fcm-personal' });
  assert.equal(opened, './#dashboard');
});

test('notificationclick: a foreign push still honours its own url', async () => {
  const tap = loadSw();
  const { opened } = await tap({ url: 'https://example.com/x' });
  assert.equal(opened, 'https://example.com/x');
});

test('notificationclick: a global push logs the click for the app', async () => {
  const tap = loadSw();
  const { stored } = await tap({ gid: 'row-9', link: 'dashboard', src: 'fcm-global' });
  assert.ok(stored, 'a global click must be stored for the app to log');
  assert.equal(stored.name, 'ah-fcm-click');
  const parsed = JSON.parse(stored.body);
  assert.equal(parsed.id, 'row-9');
  assert.equal(parsed.link, 'dashboard');
});

/* Phase 3: an intelligence push carries no `gid`. Its engine key is what an
 * open/click/learning outcome joins on, so it must survive the tap the same way
 * a global id does — in both the flat and the SDK-wrapped shape. */
test('notificationclick: an intel push opens its link and stores the engine key', async () => {
  const tap = loadSw();
  const { opened, stored } = await tap({ link: 'smart-revision', src: 'fcm-intel', kind: 'weak-topic', variant: 'B', key: 'weak-topic:u1:2026-09-25' });
  assert.equal(opened, './#smart-revision');
  assert.ok(stored, 'an intel click must be stored, or conversion attribution has nothing to join on');
  const parsed = JSON.parse(stored.body);
  assert.equal(parsed.intelKey, 'weak-topic:u1:2026-09-25');
  assert.equal(parsed.id, undefined, 'an intel record must not masquerade as a global id');
});

test('notificationclick: SDK-wrapped intel push still stores the engine key', async () => {
  /* This is the shape a real device delivers, so this is the assertion that
   * actually protects conversion measurement. */
  const tap = loadSw();
  const { opened, stored } = await tap(wrap({ link: 'smart-revision', src: 'fcm-intel', kind: 'progress', variant: 'A', key: 'progress:u1:2026-09-25' }));
  assert.equal(opened, './#smart-revision');
  assert.ok(stored, 'the wrapped intel click must be stored too');
  assert.equal(JSON.parse(stored.body).intelKey, 'progress:u1:2026-09-25');
});

test('notificationclick: a push with neither gid nor key stores nothing', async () => {
  const tap = loadSw();
  const { stored } = await tap({ link: 'dashboard', src: 'fcm-personal', kind: 'revision-due' });
  assert.equal(stored, undefined, 'an unidentifiable push must not write an empty click record');
});

test('notificationclick: a global push keeps using its gid when a key is also present', async () => {
  const tap = loadSw();
  const { stored } = await tap({ gid: 'row-11', key: 'progress:u1:2026-09-25', link: 'dashboard', src: 'fcm-global' });
  const parsed = JSON.parse(stored.body);
  assert.equal(parsed.id, 'row-11', 'the global id wins, so the global click route keeps working');
  assert.equal(parsed.intelKey, undefined);
});
