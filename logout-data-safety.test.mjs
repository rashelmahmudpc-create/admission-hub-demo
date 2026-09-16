/* Lifetime data safety — logout must not discard signup details.

   Owner requirement (top priority): "লগআউট করার পর প্রোফাইল সব চেইন্জ হয়ে নতুন হয়ে যায়
   ... আজীবন নিরাপদে সব ডাটা সবকিছু সেইভ থাকতে হবে".

   The server side is already durable: the authority persists profiles to
   SQLite (auth_profiles) keyed by user id, so a later login re-reads them.
   The hole was on the client. The signup payload (name / DOB / school /
   college) lives only in memory until a write lands. Logging out destroyed
   the session token first, so a payload that had not been written yet could
   never be written — those details were lost for good.

   This drives the real account-access.js in jsdom through the actual student
   path — signup, verification, then log out — with the pending write failing
   while the student is on the account panel. The flush must happen BEFORE the
   session is torn down. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const accountSource = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');
const institutionSource = readFileSync(new URL('./institutions-bd.js', import.meta.url), 'utf8');

const wait = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(check, label, timeout = 3000) {
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

// `allowWrites` models the authority being unreachable while the student is
// signed in — the exact window where name / DOB / school exist only in memory.
// The test flips it on immediately before Log Out, so the ONLY write that can
// land is the pre-logout flush. If the flush is missing, the details are gone.
function setup({ allowWrites = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><main id="app"></main></body></html>', {
    url: 'https://admissionhub.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const calls = [];
  let verified = false;
  window.open = () => ({ closed: false });
  window.PublicKeyCredential = undefined;
  window.fetch = async (url, options = {}) => {
    const path = String(url);
    let body = null;
    try { body = options.body ? JSON.parse(options.body) : null; } catch { /* not json */ }
    calls.push({ path, method: options.method || 'GET', body });

    if (path.includes('/config')) return jsonReply(200, {
      auth: {
        available: true,
        uiContract: 'auth-premium-v6',
        methods: {
          google: { available: false, clientId: '' },
          passkey: { available: false, enrollmentAvailable: false },
          telegramVerification: { available: false },
          backup: { available: false }
        }
      }
    });
    if (path.includes('/telegram/verification/pending')) return jsonReply(404, { error: { code: 'TELEGRAM_VERIFICATION_INVALID' } });
    if (path.includes('/signup')) return jsonReply(202, {
      verification: { selectionRequired: false, sent: true, emailMasked: 's***@example.com', resendAfter: 0 }
    });
    if (path.includes('/account-verification/email/start')) return jsonReply(202, {
      verification: { sent: true, emailMasked: 's***@example.com', resendAfter: 0 }
    });
    if (path.includes('/account-verification/email/status')) {
      // The student has just opened the verification link.
      if (verified) {
        return jsonReply(200, { authenticated: true, emailVerified: true, user: { id: 'usr-1', emailMasked: 's***@example.com' } });
      }
      return jsonReply(200, { authenticated: false, emailVerified: false });
    }
    if (path.includes('/profile/pending') || path.endsWith('/profile')) {
      if (options.method === 'POST' && !allowWrites) {
        return jsonReply(503, { error: { code: 'AUTHORITY_UNAVAILABLE' } });
      }
      if (options.method === 'POST') return jsonReply(200, { saved: true, profile: { version: 1 } });
      return jsonReply(200, { profile: null });
    }
    if (path.includes('/session/logout')) return jsonReply(200, { ok: true, authenticated: false });
    if (path.includes('/session') && !path.includes('/session/')) return jsonReply(401, { error: { code: 'SESSION_INVALID' } });
    return jsonReply(404, { error: { code: 'NOT_FOUND' } });
  };
  window.eval(institutionSource);
  window.eval(accountSource);
  return {
    dom, window, document: window.document, calls,
    markVerified() { verified = true; },
    allowWrites() { allowWrites = true; }
  };
}

const pendingCalls = app => app.calls.filter(c => c.path.includes('/profile/pending'));

test('logout flushes un-written profile details before the session is torn down', async () => {
  const app = setup();
  const { document, window } = app;
  await waitFor(() => document.querySelector('[data-view="welcome"]')?.hidden === false, 'welcome');
  document.querySelector('[data-role="welcome-signup"]').click();

  document.querySelector('#ah-signup-name').value = 'Rashel Ahmed';
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
  document.querySelector('#ah-signup-email').value = 'rashel@example.com';
  document.querySelector('#ah-signup-password').value = 'StrongPassword!9';
  document.querySelector('#ah-signup-confirm').value = 'StrongPassword!9';
  document.querySelector('[data-view="signup"]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  // While the authority is down the details stay memory-only.
  await waitFor(() => pendingCalls(app).length >= 1, 'first pending write');
  await waitFor(() => document.querySelector('[data-view="created"]')?.hidden === false, 'created view');
  assert.equal(pendingCalls(app).at(-1).body?.fullName, 'Rashel Ahmed',
    'the payload must exist in memory even though the write failed');

  // Walk to the signed-in panel, where the Log Out button lives.
  document.querySelector('[data-role="created-continue"]').click();
  await waitFor(() => document.querySelector('[data-view="verify"]')?.hidden === false, 'verify view');
  // The student opens the verification link, comes back, and taps Check.
  app.markVerified();
  document.querySelector('[data-role="verified-login"]').click();
  await waitFor(() => window.AdmissionAccount.isVerified(), 'verified session');
  window.AdmissionAccount.open();
  await waitFor(() => document.querySelector('[data-view="signed"]')?.hidden === false, 'signed view');

  // Authority is reachable again: from here the ONLY profile write that may
  // land is the one logout performs before destroying the session.
  const writesBeforeLogout = pendingCalls(app).length;
  app.allowWrites();
  document.querySelector('[data-role="logout"]').click();
  await waitFor(() => app.calls.some(c => c.path.includes('/session/logout')), 'logout request');

  const after = pendingCalls(app);
  assert.ok(after.length > writesBeforeLogout,
    'the un-written signup details must be sent on logout');
  const pendingIndex = app.calls.indexOf(after.at(-1));
  const logoutIndex = app.calls.findIndex(c => c.path.includes('/session/logout'));
  assert.ok(pendingIndex < logoutIndex,
    'the profile write must land before the session is destroyed, otherwise the details are gone');
  const flushed = after.at(-1).body;
  assert.equal(flushed.fullName, 'Rashel Ahmed');
  assert.equal(flushed.dob, '2007-05-05');
  assert.ok(flushed.school?.name, 'the school must survive the logout');
});
