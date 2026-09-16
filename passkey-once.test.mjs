/* T7 — the passkey setup prompt must appear at most once per account.

   Owner report: "সাইন আপ পেইজ কিংবা লগইন পেইজ থেকে নতুন / পুরাতন সবাইকে বারবার
   নতুন লগইন করার সময় পাস key যুক্ত করতে বলে কেনো ১ বার বলবে ১ টা একাউন্ট এ".

   Root cause: establishSession() decided the security-setup screen from the
   global "enrollment available" capability alone. It never consulted the
   signed-in account's own credential list, and its refreshPasskeyStatus()
   call was async — so the view was chosen before the account's passkeys were
   known. Every returning student was asked to add a passkey again.

   These tests drive the real account-access.js in jsdom. A browser-shaped
   environment (navigator.credentials + PublicKeyCredential) is required,
   because the prompt is gated on passkeyBrowserReady(). */
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

const SESSION = {
  authenticated: true,
  emailVerified: true,
  user: { emailMasked: 's***@example.com' },
  session: { expiresAt: Date.now() + 86400000 }
};

function setup({ existingPasskeys = 0 } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><main id="app"></main></body></html>', {
    url: 'https://admissionhub.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const calls = [];
  window.open = () => ({ closed: false });
  window.PublicKeyCredential = function () {};
  window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
  Object.defineProperty(window.navigator, 'credentials', {
    value: { get: async () => ({}), create: async () => ({}) },
    configurable: true
  });
  window.fetch = async (url, options = {}) => {
    const path = String(url);
    calls.push({ path, method: options.method || 'GET' });
    if (path.includes('/config')) return jsonReply(200, {
      auth: {
        available: true,
        uiContract: 'auth-premium-v6',
        methods: {
          google: { available: false, clientId: '' },
          passkey: { available: true, enrollmentAvailable: true },
          telegramVerification: { available: false },
          backup: { available: false }
        }
      }
    });
    if (path.includes('/passkey/status')) return jsonReply(200, {
      credentials: Array.from({ length: existingPasskeys }, (_, i) => ({ credentialId: `cred-${i}` }))
    });
    if (path.includes('/login')) return jsonReply(200, SESSION);
    if (path.includes('/session') && !path.includes('/session/')) return jsonReply(401, { error: { code: 'SESSION_INVALID' } });
    if (path.includes('/telegram/verification/pending')) return jsonReply(404, { error: { code: 'TELEGRAM_VERIFICATION_INVALID' } });
    if (path.endsWith('/profile')) return jsonReply(200, { profile: { fullName: 'Test Student' } });
    return jsonReply(404, { error: { code: 'NOT_FOUND' } });
  };
  window.eval(institutionSource);
  window.eval(accountSource);
  return { dom, window, document: window.document, calls };
}

const viewVisible = (app, name) => app.document.querySelector(`[data-view="${name}"]`)?.hidden === false;

async function logIn(app) {
  await waitFor(() => app.calls.some(c => c.path.includes('/config')), 'config');
  app.document.querySelector('[data-role="welcome-login"]').click();
  await waitFor(() => viewVisible(app, 'login'), 'login view');
  app.document.querySelector('#ah-login-email').value = 'student@example.com';
  app.document.querySelector('#ah-login-password').value = 'StrongPassword!9';
  app.document.querySelector('[data-view="login"]')
    .dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => app.calls.some(c => c.path.includes('/login')), 'login request');
}

test('T7: a returning account that already owns a passkey is never asked again', async () => {
  const app = setup({ existingPasskeys: 1 });
  await logIn(app);
  await waitFor(() => app.calls.some(c => c.path.includes('/passkey/status')), 'passkey status probe');
  await wait(120);

  assert.equal(viewVisible(app, 'security-setup'), false,
    'a returning account with a passkey must never see the passkey setup screen');
});

test('T7: a returning account without a passkey is not nagged on every login either', async () => {
  const app = setup({ existingPasskeys: 0 });
  await logIn(app);
  await waitFor(() => app.calls.some(c => c.path.includes('/passkey/status')), 'passkey status probe');
  await wait(120);

  // The offer belongs to signup onboarding. A returning student who skipped it
  // keeps the on-demand button in the account panel instead.
  assert.equal(viewVisible(app, 'security-setup'), false,
    'the passkey offer must not reappear on every login');
  assert.equal(viewVisible(app, 'signed'), true, 'a returning login lands on the account panel');
});