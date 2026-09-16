/* T5 — signup data auto-save on the email verification path.

   Owner report: a student fills name / DOB / school / college during signup,
   the first profile sync to /profile/pending fails (flaky network, cold
   authority, 5xx), and their details are then silently lost on retry because
   the client had already burned its single "pending attempt" flag. The
   account exists, the profile does not.

   These tests drive the real account-access.js in jsdom against a stubbed
   network that fails the FIRST pending write and succeeds afterwards. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const accountSource = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');
const institutionSource = readFileSync(new URL('./institutions-bd.js', import.meta.url), 'utf8');

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

// pendingWrites: how many of the FIRST /profile/pending calls fail before
// the endpoint starts behaving (simulates a transient authority failure).
function setup({ pendingFailures = 0 } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><main id="app"></main></body></html>', {
    url: 'https://admissionhub.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const calls = [];
  let pendingSeen = 0;
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
    if (path.includes('/telegram/verification/pending')) return jsonReply(404, { error: { code: 'TELEGRAM_VERIFICATION_INVALID' } });
    if (path.includes('/signup')) return jsonReply(202, {
      verification: { selectionRequired: true, sent: false, emailMasked: 's***@example.com', resendAfter: 0 }
    });
    if (path.includes('/profile/pending')) {
      pendingSeen += 1;
      if (pendingSeen <= pendingFailures) return jsonReply(503, { error: { code: 'AUTHORITY_UNAVAILABLE' } });
      return jsonReply(200, { saved: true, profile: { version: 1 } });
    }
    if (path.includes('/account-verification/email/start')) return jsonReply(202, {
      verification: { sent: true, emailMasked: 's***@example.com', resendAfter: 0 }
    });
    if (path.includes('/account-verification/email/status')) return jsonReply(200, { authenticated: false, emailVerified: false });
    if (path.endsWith('/profile')) return jsonReply(200, { profile: null });
    return jsonReply(404, { error: { code: 'NOT_FOUND' } });
  };
  window.eval(institutionSource);
  window.eval(accountSource);
  return { dom, window, document: window.document, calls };
}

async function openSignup(app) {
  await waitFor(() => app.calls.some(c => c.path.includes('/config')), 'config');
  await waitFor(() => app.document.querySelector('[data-view="welcome"]')?.hidden === false, 'welcome');
  app.document.querySelector('[data-role="welcome-signup"]').click();
}

async function fillSignup(app, name = 'Test Student', email = 'student@example.com') {
  const { document, window } = app;
  document.querySelector('#ah-signup-name').value = name;
  document.querySelector('#ah-signup-name').dispatchEvent(new window.Event('input', { bubbles: true }));
  document.querySelector('#ah-dob-day').value = '5';
  document.querySelector('#ah-dob-month').value = '5';
  document.querySelector('#ah-dob-year').value = '2007';
  for (const id of ['ah-dob-day', 'ah-dob-month', 'ah-dob-year']) {
    document.getElementById(id).dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  document.querySelector('[data-role="signup-next-education"]').click();
  await waitFor(() => document.querySelector('[data-signup-panel="school"]').hidden === false, 'school panel');
  const school = document.querySelector('#ah-signup-school');
  school.value = 'Dhaka Collegiate School';
  school.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => document.querySelectorAll('#ah-school-results [role="option"]').length > 0, 'school suggestions');
  document.querySelector('#ah-school-results [role="option"]').click();
  document.querySelector('[data-role="signup-next-college"]').click();
  await waitFor(() => document.querySelector('[data-signup-panel="college"]').hidden === false, 'college panel');
  document.querySelector('[data-role="signup-next-security"]').click();
  await waitFor(() => document.querySelector('[data-signup-panel="security"]').hidden === false, 'security panel');
  document.querySelector('#ah-signup-email').value = email;
  const password = document.querySelector('#ah-signup-password');
  const confirm = document.querySelector('#ah-signup-confirm');
  password.value = 'StrongPassword!9';
  confirm.value = 'StrongPassword!9';
  password.dispatchEvent(new window.Event('input', { bubbles: true }));
  confirm.dispatchEvent(new window.Event('input', { bubbles: true }));
}

const submitSignup = app => app.document.querySelector('[data-view="signup"]')
  .dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));

const pendingCalls = app => app.calls.filter(c => c.path.includes('/profile/pending'));

test('T5: a transient failure of the first pending write is retried, not abandoned', async () => {
  const app = setup({ pendingFailures: 1 });
  const { document } = app;
  await openSignup(app);
  await fillSignup(app);
  submitSignup(app);

  // 1st pending write happens during signup submit and fails (transient 503).
  await waitFor(() => pendingCalls(app).length >= 1, 'first pending write');
  await waitFor(() => document.querySelector('[data-view="created"]')?.hidden === false, 'created view');

  // Walk the real verification path a student takes: created → verify →
  // email-intro → continue. That last step re-syncs the profile.
  document.querySelector('[data-role="created-continue"]').click();
  await waitFor(() => document.querySelector('[data-view="verify"]')?.hidden === false, 'verify view');
  document.querySelector('[data-role="email-verification-start"]').click();
  await waitFor(() => document.querySelector('[data-view="email-intro"]')?.hidden === false, 'email intro view');
  document.querySelector('[data-role="email-intro-continue"]').click();

  await waitFor(() => pendingCalls(app).length >= 2, 'second pending write (the retry)', 3000);
  const last = pendingCalls(app).at(-1);
  assert.equal(last.body?.fullName, 'Test Student');
  assert.ok(last.body?.school?.name, 'school must be in the retried payload');
  assert.ok(last.body?.dob, 'dob must be in the retried payload');
});

test('T5: the signup payload carries every field the student typed', async () => {
  const app = setup({ pendingFailures: 0 });
  await openSignup(app);
  await fillSignup(app, 'Rashel Ahmed', 'rashel@example.com');
  submitSignup(app);

  await waitFor(() => pendingCalls(app).length >= 1, 'pending write');
  const payload = pendingCalls(app)[0].body;
  assert.equal(payload.fullName, 'Rashel Ahmed');
  assert.equal(payload.dob, '2007-05-05');
  assert.equal(payload.school?.name, 'Dhaka Collegiate School');
  assert.ok('higherInstitution' in payload, 'college field must be present even when skipped');
});