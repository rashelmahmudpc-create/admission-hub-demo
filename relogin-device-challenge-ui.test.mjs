import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const script = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  async json() { return body; }
});

async function waitFor(predicate, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error('Timed out waiting for UI state.');
}

// A verified account on a device the server does not recognise answers the
// login with reason:new-device. The client must send the student to a one-time
// device confirmation, never tell them the account itself is unverified.
function setup() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://admissionhub.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  dom.window.document.cookie = 'ah_entry_v1=account; Path=/; SameSite=Lax';
  const calls = [];
  dom.window.fetch = async (url, options = {}) => {
    const path = String(url).replace(/^https:\/\/admissionhub\.pages\.dev/, '');
    calls.push({ path, method: options.method || 'GET' });
    if (path.endsWith('/config')) return reply(200, { auth: { available: true } });
    if (path.endsWith('/session')) return reply(401, { error: { code: 'SESSION_INVALID', message: 'x' } });
    if (path.endsWith('/login')) {
      return reply(202, {
        ok: true,
        authenticated: false,
        accountVerified: true,
        verification: {
          sent: false,
          selectionRequired: true,
          emailMasked: 's•••••@e••••.com',
          reason: 'new-device',
          options: {
            email: { available: true, verifiesEmailOwnership: true },
            telegram: { available: true, verifiesEmailOwnership: false }
          }
        }
      });
    }
    return reply(404, { error: { message: 'not found' } });
  };
  dom.window.eval(script);
  return { dom, window: dom.window, document: dom.window.document, calls };
}

test('a new-device login asks for device confirmation, not another account verification', async () => {
  const app = setup();
  await waitFor(() => app.document.querySelector('#ah-account-page'));
  await sleep(0);
  app.window.AdmissionAccount.open();
  await waitFor(() => {
    const view = app.document.querySelector('[data-view="login"]');
    return view && !view.hidden;
  });
  app.document.querySelector('#ah-login-email').value = 'student@example.com';
  app.document.querySelector('#ah-login-password').value = 'Secure-password-44';
  app.document.querySelector('[data-view="login"]').dispatchEvent(
    new app.window.Event('submit', { bubbles: true, cancelable: true })
  );

  await waitFor(() => {
    const view = app.document.querySelector('[data-view="verify"]');
    return view && !view.hidden;
  });

  const banner = app.document.querySelector('[data-role="account-message"], .ah-account-message, [aria-live]');
  const text = (banner?.textContent || app.document.body.textContent || '');
  assert.match(text, /ডিভাইস/, 'the copy must name the device, not the account');
  assert.doesNotMatch(text, /এখনো যাচাইকৃত নয়/, 'must not claim the account is unverified');
  assert.ok(app.calls.some(call => call.path === '/api/auth/v1/login'));
});
