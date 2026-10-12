/* Admission Sky signup bridge — the owner's signup-flow-preview-v2 wired to
   the real account engine.

   The design is a self-contained wizard; these tests prove its steps now reach
   the live endpoints through AdmissionAccount.SkyFlow, and that the preview's
   hardcoded OTP is gone. Real code paths in jsdom against a stubbed network —
   no mocks of the modules under test. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const accountSource = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');
const institutionSource = readFileSync(new URL('./institutions-bd.js', import.meta.url), 'utf8');
const skySource = readFileSync(new URL('./sky.js', import.meta.url), 'utf8');

const wait = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(check, label, timeout = 2500) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (check()) return;
    await wait(10);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const jsonReply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => body
});

function setup() {
  const dom = new JSDOM('<!doctype html><html><body><main id="app"></main></body></html>', {
    url: 'https://admissionhub.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const calls = [];
  window.open = () => ({ closed: false });
  window.PublicKeyCredential = undefined;
  window.fetch = async (url, options = {}) => {
    const path = String(url);
    let body = null;
    try { body = options.body ? JSON.parse(options.body) : null; } catch {}
    calls.push({ path, method: options.method || 'GET', body });

    if (path.includes('/config')) return jsonReply(200, {
      auth: {
        available: true,
        uiContract: 'auth-premium-v6',
        methods: {
          google: { available: false, clientId: '' },
          passkey: { available: false, enrollmentAvailable: false },
          telegramVerification: { available: true },
          backup: { available: false }
        }
      }
    });
    if (path.includes('/session') && !path.includes('/session/')) return jsonReply(401, { error: { code: 'SESSION_INVALID' } });
    if (path.includes('/signup')) return jsonReply(202, {
      verification: { selectionRequired: true, sent: false, emailMasked: 's***@example.com', resendAfter: 0 }
    });
    if (path.includes('/profile/pending')) return jsonReply(200, { saved: true, profile: { version: 1 } });
    if (path.endsWith('/profile')) return jsonReply(200, { profile: null });
    if (path.includes('/account-verification/email/start')) return jsonReply(202, {
      verification: { sent: true, emailMasked: 's***@example.com', resendAfter: 60 }
    });
    if (path.includes('/account-verification/email/status')) return jsonReply(200, { authenticated: false, emailVerified: false });
    if (path.includes('/telegram/verification/start')) return jsonReply(200, {
      attemptId: 'att-1', codeSent: true, expiresAt: Date.now() + 60000, resendAfter: 60,
      interaction: { type: 'telegram-link', url: 'https://t.me/AdmissionHubVerifyBot?start=tok' }
    });
    if (path.includes('/telegram/verification/verify')) {
      if (body?.code === '654321') return jsonReply(200, {
        authenticated: true, created: true, emailVerified: false, telegramVerified: true,
        user: { id: 'usr-1', emailMasked: 's***@example.com' }
      });
      return jsonReply(400, { error: { code: 'OTP_INVALID' } });
    }
    return jsonReply(404, { error: { code: 'NOT_FOUND' } });
  };
  window.eval(institutionSource);
  window.eval(accountSource);
  window.eval(skySource);
  return { dom, window, document: window.document, calls };
}

const profile = {
  fullName: 'Sky Student', mobile: '', dob: '2007-05-05',
  school: { id: 'sky-school-x', name: 'Dhaka Collegiate School', district: '' },
  higherInstitution: { id: 'sky-college-y', name: 'Dhaka College', district: '' },
  email: 'student@example.com', password: 'StrongPassword!9'
};

test('the Sky engine mounts and the preview hardcoded OTP is gone', async t => {
  assert.doesNotMatch(skySource, /123456/, 'the fake preview code must not ship');
  const app = setup();
  t.after(() => app.dom.window.close());
  await waitFor(() => app.document.querySelector('#ah-signup-sky')?.dataset.skyMounted === '1', 'sky mount');
  assert.equal(app.document.querySelector('#ah-signup-sky').dataset.skyMounted, '1');
});

test('SkyFlow.createAccount posts the collected profile to the real signup endpoints', async t => {
  const app = setup();
  t.after(() => app.dom.window.close());
  await waitFor(() => app.window.AdmissionAccount?.SkyFlow, 'SkyFlow bridge');
  const res = await app.window.AdmissionAccount.SkyFlow.createAccount(profile);
  assert.equal(res.ok, true);
  assert.equal(res.selectionRequired, true);

  const signup = app.calls.find(c => c.path.includes('/signup'));
  assert.ok(signup, 'POST /signup was called');
  assert.equal(signup.body.email, 'student@example.com');
  assert.equal(signup.body.password, 'StrongPassword!9');

  const pending = app.calls.find(c => c.path.includes('/profile/pending'));
  assert.ok(pending, 'profile pending write was attempted');
  assert.equal(pending.body.fullName, 'Sky Student');
  assert.equal(pending.body.dob, '2007-05-05');
  assert.equal(pending.body.school.name, 'Dhaka Collegiate School');
  assert.equal(pending.body.higherInstitution.name, 'Dhaka College');
});

test('SkyFlow.sendCode reaches the real email and Telegram start endpoints', async t => {
  const app = setup();
  t.after(() => app.dom.window.close());
  await waitFor(() => app.window.AdmissionAccount?.SkyFlow, 'SkyFlow bridge');
  await app.window.AdmissionAccount.SkyFlow.createAccount(profile);

  const email = await app.window.AdmissionAccount.SkyFlow.sendCode('email');
  assert.equal(email.ok, true);
  assert.ok(app.calls.some(c => c.path.includes('/account-verification/email/start')));

  const tg = await app.window.AdmissionAccount.SkyFlow.sendCode('telegram');
  assert.equal(tg.ok, true);
  assert.match(tg.url, /t\.me\/AdmissionHubVerifyBot/);
  assert.ok(app.calls.some(c => c.path.includes('/telegram/verification/start')));
});

test('SkyFlow.verifyCode verifies the real Telegram OTP and establishes a session', async t => {
  const app = setup();
  t.after(() => app.dom.window.close());
  await waitFor(() => app.window.AdmissionAccount?.SkyFlow, 'SkyFlow bridge');
  await app.window.AdmissionAccount.SkyFlow.createAccount(profile);
  await app.window.AdmissionAccount.SkyFlow.sendCode('telegram');

  const wrong = await app.window.AdmissionAccount.SkyFlow.verifyCode('telegram', '000000');
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, 'OTP_INVALID');

  const good = await app.window.AdmissionAccount.SkyFlow.verifyCode('telegram', '654321');
  assert.equal(good.ok, true);
  const verifies = app.calls.filter(c => c.path.includes('/telegram/verification/verify'));
  const last = verifies[verifies.length - 1];
  assert.equal(last.body.attemptId, 'att-1');
  assert.equal(last.body.code, '654321');
  assert.ok(app.window.AdmissionAccount.getSession(), 'session established after verification');
});
