import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const script = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const SECURITY = 'security-challenge-ui-' + 'x'.repeat(10);
const CHALLENGE_REF = 'ch' + 'a'.repeat(30);
const STEP_UP_TOKEN = 'tok' + 'b'.repeat(40);

const reply = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: name => headers[String(name).toLowerCase()] || null },
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

function setup({ trusted = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://admissionhub.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  // Pre-select the account entry mode so the launcher opens the login form.
  dom.window.document.cookie = 'ah_entry_v1=account; Path=/; SameSite=Lax';
  const calls = [];
  let stepUpArmed = true;
  let verifyFails = 0;
  dom.window.fetch = async (url, options = {}) => {
    const path = String(url).replace(/^https:\/\/admissionhub\.pages\.dev/, '');
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method || 'GET', body });
    if (path.endsWith('/config')) return reply(200, { auth: { available: true } });
    if (path.endsWith('/session') && (options.method || 'GET') === 'GET') {
      return reply(401, { error: { code: 'SESSION_INVALID', message: 'x' } });
    }
    if (path.endsWith('/login')) {
      return reply(200, {
        authenticated: true,
        accountVerified: true,
        emailVerified: true,
        created: false,
        user: { id: 'usr_sec', emailMasked: 's***@example.com', status: 'active' },
        session: {
          expiresAt: Date.now() + 86400000,
          security: {
            level: trusted ? 'NORMAL' : 'ELEVATED',
            trusted,
            trustOffer: !trusted,
            policyVersion: SECURITY
          }
        }
      });
    }
    if (path.endsWith('/security/device/trust')) {
      return reply(200, { ok: true, trusted: true, expiresAt: Date.now() + 30 * 86400000 });
    }
    if (path.endsWith('/security/challenge/request')) {
      return reply(200, {
        ok: true,
        challengeRef: CHALLENGE_REF,
        attemptId: 'att' + 'c'.repeat(20),
        purpose: 'step-up',
        method: 'email',
        expiresAt: Date.now() + 15 * 60 * 1000,
        resendAfter: 60,
        policyVersion: SECURITY
      });
    }
    if (path.endsWith('/security/challenge/verify')) {
      if (verifyFails > 0) {
        verifyFails -= 1;
        return reply(401, { error: { code: 'OTP_INVALID', message: 'কোডটি সঠিক নয়।' } });
      }
      return reply(200, { ok: true, verified: true, purpose: 'step-up', stepUpToken: STEP_UP_TOKEN });
    }
    if (path.endsWith('/security/challenge/cancel')) {
      return reply(200, { ok: true, cancelled: true });
    }
    if (path.endsWith('/session/logout-all')) {
      if (stepUpArmed && !body?.stepUpToken) {
        return reply(409, { error: { code: 'STEP_UP_REQUIRED', message: 'fresh verification দরকার।' } });
      }
      stepUpArmed = false;
      return reply(200, { ok: true, authenticated: false, revoked: 2 });
    }
    return reply(404, { error: { message: 'not found' } });
  };
  dom.window.eval(script);
  return {
    dom,
    window: dom.window,
    document: dom.window.document,
    calls,
    setStepUpArmed: value => { stepUpArmed = value; },
    failVerify: times => { verifyFails = times; }
  };
}

const login = async app => {
  await waitFor(() => app.document.querySelector('.ah-account-launcher'));
  await sleep(0);
  app.document.querySelector('.ah-account-launcher').click();
  await waitFor(() => app.document.querySelector('[data-view="login"]') && !app.document.querySelector('[data-view="login"]').hidden);
  app.document.querySelector('#ah-login-email').value = 'student@example.com';
  app.document.querySelector('#ah-login-password').value = 'Secure-password-44';
  app.document.querySelector('[data-view="login"]').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => app.document.querySelector('[data-view="signed"]') && !app.document.querySelector('[data-view="signed"]').hidden);
};

const armLogoutAll = async app => {
  const button = app.document.querySelector('[data-role="logout-all"]');
  button.click();
  await waitFor(() => button.dataset.armed === '1');
};

test('trust prompt: offered after a trustOffer login, hidden after accept', async t => {
  const app = setup({ trusted: false });
  t.after(() => { try { app.dom.window.close(); } catch (_) {} });
  await login(app);
  const prompt = app.document.querySelector('[data-role="trust-prompt"]');
  assert.equal(prompt.hidden, false, 'trust prompt is offered when the policy says trustOffer');

  app.document.querySelector('[data-role="trust-accept"]').click();
  await waitFor(() => app.calls.some(call => call.path.endsWith('/security/device/trust')));
  await waitFor(() => prompt.hidden === true, 2000);
  assert.equal(prompt.hidden, true, 'accepting hides the prompt');
  assert.equal(app.calls.filter(call => call.path.endsWith('/security/device/trust')).length, 1);
  app.dom.window.close();
});

test('trust prompt: declined and never shown for an already-trusted device', async t => {
  const app = setup({ trusted: false });
  const trustedApp = { app: null };
  t.after(() => {
    try { app.dom.window.close(); } catch (_) {}
    if (trustedApp.app) { try { trustedApp.app.dom.window.close(); } catch (_) {} }
  });
  await login(app);
  const prompt = app.document.querySelector('[data-role="trust-prompt"]');
  assert.equal(prompt.hidden, false);
  app.document.querySelector('[data-role="trust-decline"]').click();
  await sleep(20);
  assert.equal(prompt.hidden, true, 'declining hides the prompt without any request');
  assert.equal(app.calls.some(call => call.path.endsWith('/security/device/trust')), false);
  app.dom.window.close();

  trustedApp.app = setup({ trusted: true });
  await login(trustedApp.app);
  assert.equal(trustedApp.app.document.querySelector('[data-role="trust-prompt"]').hidden, true, 'a trusted device gets no prompt');
});

test('step-up: logout-all asks for a challenge, the token retries the action once', async t => {
  const app = setup({ trusted: true });
  t.after(() => { try { app.dom.window.close(); } catch (_) {} });
  await login(app);
  await armLogoutAll(app);
  app.document.querySelector('[data-role="logout-all"]').click();

  // 409 STEP_UP_REQUIRED -> challenge view opens and requests a challenge.
  await waitFor(() => {
    const view = app.document.querySelector('[data-view="step-up"]');
    return view && !view.hidden;
  });
  await waitFor(() => app.calls.some(call => call.path.endsWith('/security/challenge/request')));
  const request = app.calls.find(call => call.path.endsWith('/security/challenge/request'));
  assert.deepEqual(request.body, { purpose: 'step-up', method: 'email' });

  // Wrong code first: stays on the challenge view, nothing is revoked yet.
  app.failVerify(1);
  app.document.querySelector('#ah-stepup-code').value = '000009';
  app.document.querySelector('[data-view="step-up"]').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => app.calls.filter(call => call.path.endsWith('/security/challenge/verify')).length === 1);
  // Wait until the failed attempt has fully settled (busy flag released).
  await waitFor(() => /সঠিক নয়/.test(app.document.querySelector('[data-role="message"]').textContent));
  assert.equal(app.calls.some(call => call.path.endsWith('/session/logout-all') && call.body?.stepUpToken), false, 'no retry without a verified token');

  // Correct code: verify -> one-time token -> logout-all retried exactly once.
  app.document.querySelector('#ah-stepup-code').value = '123456';
  app.document.querySelector('[data-view="step-up"]').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => app.document.querySelector('[data-view="login"]') && !app.document.querySelector('[data-view="login"]').hidden);
  const verifies = app.calls.filter(call => call.path.endsWith('/security/challenge/verify'));
  const retried = app.calls.filter(call => call.path.endsWith('/session/logout-all') && call.body?.stepUpToken);
  assert.equal(verifies.length, 2);
  assert.deepEqual(verifies.at(-1).body, { challengeRef: CHALLENGE_REF, purpose: 'step-up', code: '123456' });
  assert.equal(retried.length, 1, 'the action is retried exactly once with the token');
  assert.equal(retried.at(0).body.stepUpToken, STEP_UP_TOKEN);
  assert.equal(app.window.AdmissionAccount.isVerified(), false, 'every session is gone after logout-all');
  app.dom.window.close();
});

test('step-up: cancel aborts the pending action without revoking anything', async t => {
  const app = setup({ trusted: true });
  t.after(() => { try { app.dom.window.close(); } catch (_) {} });
  await login(app);
  await armLogoutAll(app);
  app.document.querySelector('[data-role="logout-all"]').click();
  await waitFor(() => {
    const view = app.document.querySelector('[data-view="step-up"]');
    return view && !view.hidden;
  });
  app.document.querySelector('[data-role="step-up-cancel"]').click();
  await waitFor(() => app.calls.some(call => call.path.endsWith('/security/challenge/cancel')));
  await waitFor(() => app.document.querySelector('[data-view="signed"]') && !app.document.querySelector('[data-view="signed"]').hidden);
  await sleep(30);
  assert.equal(app.calls.some(call => call.path.endsWith('/security/challenge/verify')), false);
  assert.equal(app.calls.some(call => call.path.endsWith('/session/logout-all') && call.body?.stepUpToken), false, 'cancelled: the action never retried');
  assert.equal(app.window.AdmissionAccount.isVerified(), true, 'the session is still alive after a cancel');
  app.dom.window.close();
});
