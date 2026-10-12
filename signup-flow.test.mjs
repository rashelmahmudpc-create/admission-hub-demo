import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const account = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');
const flow = readFileSync(new URL('./signup-flow.js', import.meta.url), 'utf8');
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, async json() { return body; } });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, label, timeout = 6000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (predicate()) return; await sleep(10); }
  throw new Error('Timed out waiting for: ' + label);
}
function boot({ emailOtp = true, telegram = true, otpPlan = [], firebaseLink = false, search = '' } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://admissionhub.pages.dev/' + search, runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window, calls = [];
  const plan = [...otpPlan];
  let attempt = 0;
  w.fetch = async (url, options = {}) => {
    const path = String(url), body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method || 'GET', body });
    if (path.includes('/config')) return reply(200, { auth: { available: true, methods: { google: { available: false }, passkey: { available: false }, emailPassword: { available: true }, emailOwnership: { available: emailOtp, codeLength: 6 }, telegramVerification: { available: telegram, availabilityCode: 'READY', optional: true, codeLength: 6, expiresInSeconds: 300, maxAttempts: 5 }, backup: { available: false, contactInput: 'none' } }, verificationEmail: { resendCooldownSeconds: 60 } } });
    if (path.includes('/session') && !path.includes('/session/') && (options.method || 'GET') === 'GET') return reply(401, { error: { code: 'SESSION_INVALID', message: 'সেশন নেই।' } });
    if (path.includes('/telegram/verification/pending')) return reply(200, { pending: false });
    if (path.endsWith('/signup')) return reply(202, { accountCreated: true, authenticated: false, verification: { sent: false, selectionRequired: true, emailMasked: 's***@example.com', options: { email: { available: true }, telegram: { available: telegram } } } });
    if (path.includes('/email-ownership/start')) {
      attempt += 1;
      if (firebaseLink) return reply(202, { delivery: { method: 'firebase-link', resendAfter: 60 } });
      return reply(202, { delivery: { method: 'otp' }, ownership: { attemptId: 'own-' + attempt, expiresAt: Date.now() + 300000, resendAfter: 0 } });
    }
    if (path.includes('/email-ownership/verify')) {
      const next = plan.shift() || { status: 200, body: { authenticated: true, accountVerified: true, emailVerified: true, user: { id: 'usr-1', emailMasked: 's***@example.com' } } };
      return reply(next.status, next.body);
    }
    if (path.includes('/telegram/verification/start')) return reply(202, { accepted: true, attemptId: 'tg-attempt-123456789', expiresAt: Date.now() + 300000, resendAfter: 0, attemptsAllowed: 5, interaction: { type: 'telegram-link', url: 'https://t.me/AdmissionHubVerifyBot?start=' + 'S'.repeat(43), proof: 'local-code-required', identityKind: 'telegram-account', phoneOwnership: false } });
    if (path.includes('/telegram/verification/verify')) return reply(200, { authenticated: true, accountVerified: true, emailVerified: false, telegramVerified: true, user: { id: 'usr-tg', emailMasked: 's***@example.com' } });
    if (path.includes('/profile')) return reply(200, { profile: {} });
    return reply(404, { error: { code: 'NOT_FOUND', message: 'পাওয়া যায়নি।' } });
  };
  w.eval(account);
  w.eval(flow);
  return { dom, w, d: w.document, calls };
}
const $ = (app, s) => app.d.querySelector(s);
const type = (app, el, value) => { el.value = value; el.dispatchEvent(new app.w.Event('input', { bubbles: true })); };
const cta = app => $(app, '#ahs-cta');
const next = async app => { await waitFor(() => !cta(app).disabled, 'next button enabled'); cta(app).click(); };
async function startSignup(app) {
  await waitFor(() => app.calls.some(c => c.path.includes('/config')), 'config');
  app.w.AdmissionAccount.open();
  $(app, '[data-role="show-signup"]').click();
  await waitFor(() => $(app, '#ahs-root') && !$(app, '#ahs-root').hidden, 'sign-up overlay');
}
async function fillProfile(app, email = 'student@example.com') {
  type(app, $(app, '#ahs-in-name'), 'Test Student');
  await next(app);                                   // -> birthday
  await waitFor(() => $(app, '#ahs-age').textContent.includes('বয়স'), 'age line');
  await next(app);                                   // -> school
  $(app, '#ahs-lv [data-v="HSC"]').click();
  type(app, $(app, '#ahs-in-sch'), 'Test School');
  await waitFor(() => $(app, '#ahs-sg-sch').classList.contains('ahs-show'), 'school suggestions');
  [...$(app, '#ahs-sg-sch').querySelectorAll('button')].at(-1).click();
  type(app, $(app, '#ahs-in-col'), 'Test College');
  await waitFor(() => $(app, '#ahs-sg-col').classList.contains('ahs-show'), 'college suggestions');
  [...$(app, '#ahs-sg-col').querySelectorAll('button')].at(-1).click();
  await next(app);                                   // -> email
  type(app, $(app, '#ahs-in-em'), email);
  await next(app);                                   // -> password
  type(app, $(app, '#ahs-in-pw'), 'StrongPass9');
  type(app, $(app, '#ahs-in-pw2'), 'StrongPass9');
  await next(app);                                   // -> create account
}
const typeCode = (app, code) => { const cells = [...app.d.querySelectorAll('#ahs-otp input')]; cells[0].value = code; cells[0].dispatchEvent(new app.w.Event('input', { bubbles: true })); };

test('email OTP path: fills the real form, creates the account, verifies with Bengali digits, celebrates and enters the app', async () => {
  const app = boot();
  await startSignup(app);
  await fillProfile(app);
  await waitFor(() => app.calls.some(c => c.path.endsWith('/signup')), 'signup request');
  const signup = app.calls.find(c => c.path.endsWith('/signup'));
  assert.deepEqual(signup.body, { email: 'student@example.com', password: 'StrongPass9' });
  assert.equal($(app, '#ah-signup-name').value, 'Test Student');
  assert.equal($(app, '#ah-signup-school').value, 'Test School');
  await waitFor(() => $(app, '[data-view="created"]').hidden === false, 'created view');
  assert.equal($(app, '#ahs-s5').classList.contains('ahs-on'), true, 'method screen shows after account creation');
  assert.equal(app.calls.some(c => c.path.includes('/email-ownership/start')), false, 'no code is sent before a method is chosen');
  cta(app).click();
  await waitFor(() => app.calls.some(c => c.path.includes('/email-ownership/start')), 'email code requested');
  await waitFor(() => $(app, '[data-view="email-ownership"]').hidden === false, 'ownership view');
  assert.equal($(app, '#ahs-s6').classList.contains('ahs-on'), true);
  typeCode(app, '১২৩৪৫৬');
  await waitFor(() => app.calls.some(c => c.path.includes('/email-ownership/verify')), 'verify request');
  const verify = app.calls.find(c => c.path.includes('/email-ownership/verify'));
  assert.deepEqual(verify.body, { attemptId: 'own-1', code: '123456' });
  await waitFor(() => $(app, '[data-view="verified"]').hidden === false || $(app, '[data-view="security-setup"]').hidden === false || $(app, '[data-view="success"]').hidden === false, 'verified');
  assert.equal($(app, '#ahs-s7').classList.contains('ahs-on'), true, 'celebration screen');
  assert.match($(app, '#ahs-dn-h').textContent, /Test/);
  await waitFor(() => $(app, '#ah-account-page').hidden === true, 'dashboard (page closed) after the celebration', 14000);
  assert.equal($(app, '#ahs-root').hidden, true);
});

test('wrong email code: the bird reacts, boxes clear, the real error shows, and a correct code then works', async () => {
  const app = boot({ otpPlan: [{ status: 400, body: { error: { code: 'OWNERSHIP_CODE_INVALID', message: 'কোড মেলেনি, আবার চেষ্টা করো।' } } }] });
  await startSignup(app); await fillProfile(app);
  await waitFor(() => $(app, '[data-view="created"]').hidden === false, 'created');
  cta(app).click();
  await waitFor(() => $(app, '[data-view="email-ownership"]').hidden === false, 'ownership');
  typeCode(app, '000000');
  await waitFor(() => $(app, '#ahs-bird').dataset.m === 'sad', 'sad bird');
  assert.match($(app, '#ahs-say').textContent.length ? $(app, '#ahs-say').textContent : 'x', /./);
  await waitFor(() => [...app.d.querySelectorAll('#ahs-otp input')].every(x => !x.value), 'cells cleared');
  assert.equal($(app, '[data-view="email-ownership"]').hidden, false, 'still on the code screen');
  typeCode(app, '123456');
  await waitFor(() => $(app, '[data-view="verified"]').hidden === false || $(app, '[data-view="security-setup"]').hidden === false || $(app, '[data-view="success"]').hidden === false, 'verified after retry');
});

test('Telegram path: opens the real Telegram flow and verifies with the 6-digit code', async () => {
  const app = boot();
  await startSignup(app); await fillProfile(app);
  await waitFor(() => $(app, '[data-view="created"]').hidden === false, 'created');
  app.d.querySelector('.ahs-mc[data-m="telegram"]').click();
  cta(app).click();
  await waitFor(() => app.calls.some(c => c.path.includes('/telegram/verification/start')), 'telegram start');
  await waitFor(() => $(app, '[data-view="telegram"]').hidden === false, 'telegram view');
  assert.equal($(app, '#ahs-s6').classList.contains('ahs-on'), true);
  assert.equal($(app, '#ahs-tgb').hidden, false, 'Telegram button block shows');
  assert.match($(app, '[data-role="telegram-link"]').href, /^https:\/\/t\.me\//);
  typeCode(app, '654321');
  await waitFor(() => app.calls.some(c => c.path.includes('/telegram/verification/verify')), 'telegram verify');
  assert.equal(app.calls.find(c => c.path.includes('/telegram/verification/verify')).body.code, '654321');
});

test('when the server falls back to the email LINK, the new screens step aside and the original verify screen shows', async () => {
  const app = boot({ firebaseLink: true });
  await startSignup(app); await fillProfile(app);
  await waitFor(() => $(app, '[data-view="created"]').hidden === false, 'created');
  cta(app).click();
  await waitFor(() => $(app, '[data-view="verify"]').hidden === false, 'verify (link) view');
  await waitFor(() => $(app, '#ahs-root').hidden === true, 'overlay steps aside');
  assert.equal($(app, '#ah-account-page').classList.contains('ahs-on'), false);
});

test('back from the first screen returns to the welcome screen, and ?classic=1 turns the new flow off', async () => {
  const app = boot();
  await startSignup(app);
  $(app, '#ahs-back').click();
  await waitFor(() => $(app, '[data-view="welcome"]').hidden === false, 'welcome again');
  await waitFor(() => $(app, '#ahs-root').hidden === true, 'overlay hidden');
  const classic = boot({ search: '?classic=1' });
  await waitFor(() => classic.calls.some(c => c.path.includes('/config')), 'config');
  classic.w.AdmissionAccount.open();
  $(classic, '[data-role="show-signup"]').click();
  assert.equal($(classic, '#ahs-root'), null, 'no overlay in classic mode');
});
