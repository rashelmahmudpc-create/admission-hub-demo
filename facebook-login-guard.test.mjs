import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// The Facebook JS SDK throws "Expression is of type asyncfunction, not function"
// when FB.login is handed an async callback. skyBridge.facebook used to pass one,
// so every tap threw and the welcome story flashed the failure toast.
const script = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  async json() { return body; }
});

async function waitFor(predicate, timeout = 2000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error('Timed out waiting for state.');
}

function setup() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://admissionsky.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const calls = [];
  dom.window.fetch = async (url, options = {}) => {
    const path = String(url);
    calls.push({ path, method: options.method || 'GET' });
    if (path.endsWith('/config')) {
      return reply(200, {
        auth: {
          available: true,
          methods: { facebook: { available: true, clientId: '4521982924756523' } },
          verificationEmail: { resendCooldownSeconds: 60 }
        }
      });
    }
    if (path.endsWith('/session')) return reply(401, { error: { code: 'SESSION_INVALID' } });
    return reply(404, {});
  };
  dom.window.eval(script);
  return { dom, window: dom.window, document: dom.window.document, calls };
}

test('Facebook sign-in hands FB.login a plain callback and never rejects on a sync throw', async () => {
  const app = setup();
  await waitFor(() => app.window.AdmissionSkyBridge);
  await waitFor(() => app.calls.some(call => call.path.endsWith('/config')));
  await sleep(20);

  let capturedCallback = null;
  let loginCalled = 0;
  app.window.FB = {
    init() {},
    getLoginStatus(cb) { if (cb) cb({ status: 'unknown' }); },
    login(callback) {
      loginCalled += 1;
      if (callback && callback.constructor && callback.constructor.name === 'AsyncFunction') {
        throw new Error('Expression is of type asyncfunction, not function');
      }
      capturedCallback = callback;
      // The SDK only invokes this once the user finishes the popup; report a
      // non-connecting result so the flow settles instead of staying pending.
      if (callback) callback({ status: 'unknown' });
    }
  };

  const outcome = await app.window.AdmissionSkyBridge.facebook();

  assert.equal(loginCalled, 1, 'FB.login must be attempted');
  assert.equal(typeof capturedCallback, 'function', 'FB.login must receive a callback');
  assert.notEqual(
    capturedCallback.constructor.name,
    'AsyncFunction',
    'FB.login rejects async callbacks, so a plain function must be passed'
  );
  assert.equal(outcome, false, 'with no credential the flow resolves false, it must not reject');
  app.dom.window.close();
});

test('Facebook sign-in resolves false instead of rejecting when the SDK throws synchronously', async () => {
  const app = setup();
  await waitFor(() => app.window.AdmissionSkyBridge);
  await waitFor(() => app.calls.some(call => call.path.endsWith('/config')));
  await sleep(20);

  app.window.FB = {
    init() {},
    getLoginStatus() {},
    login() { throw new Error('Expression is of type asyncfunction, not function'); }
  };

  const outcome = await app.window.AdmissionSkyBridge.facebook();
  assert.equal(outcome, false, 'a synchronous SDK throw must resolve false, not reject');
  app.dom.window.close();
});
