import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// Owner 2026-10-17 (return recovery): sessionStorage can be empty when the
// redirect comes back (installed app, tab handover). The ?ahAuthReturn marker
// on the return URL must still finish the sign-in.
// Original note -- "Continue with Google" is a full-page redirect straight to
// accounts.google.com on admissionsky.pages.dev. No popup, no direct GSI, no
// Firebase page in between; in-app browsers are sent to Chrome instead.
const script = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, async json() { return body; } });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, timeout = 1500) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (predicate()) return; await sleep(5); }
  throw new Error('Timed out waiting for UI state.');
}
const SKY = 'https://admissionsky.pages.dev/';
const ANDROID_FB = 'Mozilla/5.0 (Linux; Android 13; SM-A135F Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]';
const IOS_MESSENGER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/470.0;FBBV/1;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.6;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/5]';

function setup({ url = SKY, ua = '', redirectFlag = false, redirectResult = null, redirectError = null, googleReply = null, cookie = '' } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url, runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  if (cookie) w.document.cookie = cookie;
  if (ua) Object.defineProperty(w.navigator, 'userAgent', { value: ua, configurable: true });
  if (redirectFlag) w.sessionStorage.setItem('ah-google-redirect', '1');
  const record = { apps: [], popup: 0, redirect: 0, providers: [], calls: [] };
  w.firebase = {
    apps: [],
    initializeApp(options, name) { const app = { name, options }; this.apps.push(app); record.apps.push(app); return app; },
    auth(app) {
      return {
        app,
        async signInWithPopup() { record.popup += 1; throw new Error('popup must not be used'); },
        async signInWithRedirect(provider) { record.redirect += 1; record.providers.push({ app: app?.name, provider }); },
        async getRedirectResult() {
          record.pendingKey = w.sessionStorage.getItem(`firebase:pendingRedirect:AIzaSyCMYPy-qANPN1pPPI1B957wwKezmotK_NI:${app?.name}`);
          if (redirectError) throw redirectError;
          return app?.name === 'ah-google-sky' ? redirectResult : null;
        }
      };
    }
  };
  w.firebase.auth.GoogleAuthProvider = function GoogleAuthProvider() {
    this.scopes = [];
    this.addScope = scope => { this.scopes.push(scope); return this; };
    this.setCustomParameters = params => { this.params = params; return this; };
  };
  w.fetch = async (input, options = {}) => {
    const path = String(input);
    const body = options.body ? JSON.parse(options.body) : null;
    record.calls.push({ path, method: options.method || 'GET', body });
    if (path.includes('/config')) return reply(200, { auth: { available: true, methods: {
      google: { available: true, clientId: '123456789012-exampleclientidentifier.apps.googleusercontent.com' },
      passkey: { available: false }, telegramVerification: { available: false }, backup: { available: false }, emailPassword: { available: true }
    }, verificationEmail: { resendCooldownSeconds: 60 } } });
    if (path.includes('/session') && !path.includes('/session/') && (options.method || 'GET') === 'GET') return reply(401, { error: { code: 'SESSION_INVALID', message: 'সেশন নেই।' } });
    const signedBody = { authenticated: true, created: false, emailVerified: true, user: { id: 'usr-g', emailMasked: 'u***@example.com' } };
    if (path.endsWith('/google')) return googleReply ? googleReply() : reply(200, signedBody);
    if (path.endsWith('/google/link')) return reply(200, signedBody);
    if (path.endsWith('/passkey/status')) return reply(200, { count: 0, credentials: [] });
    return reply(404, { error: { message: 'not found' } });
  };
  w.eval(script);
  const button = () => w.document.querySelector('[data-role="google-button"] button') || w.document.querySelector('[data-role="welcome-google-button"] button');
  const messageText = () => w.document.querySelector('[data-role="message"]')?.textContent || '';
  return { dom, w, document: w.document, record, button, messageText };
}

const TOKEN = `google-access-${'z'.repeat(32)}`;

const RESULT = { user: { uid: 'g' }, credential: { providerId: 'google.com', accessToken: TOKEN } };

test('starting Google puts the ?ahAuthReturn=g marker on the URL Firebase returns to', async () => {
  const app = setup();
  await waitFor(() => app.button());
  app.button().click();
  await waitFor(() => app.record.redirect === 1);
  assert.equal(new URL(app.w.location.href).searchParams.get('ahAuthReturn'), 'g');
  assert.equal(app.w.localStorage.length, 0, 'no localStorage use');
  app.dom.window.close();
});

test('sessionStorage lost: the URL marker finishes the Google sign-in and lands on the Dashboard', async () => {
  const app = setup({ url: `${SKY}?ahAuthReturn=g`, redirectResult: RESULT });
  await waitFor(() => app.record.calls.some(call => call.path.endsWith('/google')), 2500);
  assert.deepEqual(app.record.calls.find(item => item.path.endsWith('/google')).body, { accessToken: TOKEN });
  assert.equal(app.record.pendingKey, '"true"', 'Firebase pendingRedirect mark must be restored before getRedirectResult');
  await waitFor(() => app.w.AdmissionAccount.isVerified() === true);
  await waitFor(() => !app.document.body.classList.contains('ah-account-page-active'), 2500);
  assert.equal(new URL(app.w.location.href).searchParams.get('ahAuthReturn'), null, 'marker removed from the address bar');
  await sleep(100);
  app.dom.window.close();
});

test('the marker keeps other query/hash parts intact', async () => {
  const app = setup({ url: `${SKY}?source=pwa&ahAuthReturn=g#dashboard`, redirectResult: RESULT });
  await waitFor(() => app.w.AdmissionAccount.isVerified() === true, 2500);
  const here = new URL(app.w.location.href);
  assert.equal(here.searchParams.get('source'), 'pwa');
  assert.equal(here.searchParams.get('ahAuthReturn'), null);
  await sleep(100);
  app.dom.window.close();
});

test('recovered return with no Google result shows [storage-lost] instead of a silent Welcome screen', async () => {
  const app = setup({ url: `${SKY}?ahAuthReturn=g`, redirectResult: null });
  await waitFor(() => /\[storage-lost\]/.test(app.messageText()), 2500);
  assert.equal(app.record.calls.some(call => call.path.endsWith('/google')), false);
  await sleep(100);
  app.dom.window.close();
});

test('an ordinary load without flag or marker never asks Firebase for a redirect result', async () => {
  const app = setup({ redirectResult: RESULT });
  await sleep(600);
  assert.equal(app.record.calls.some(call => call.path.endsWith('/google')), false);
  assert.equal(app.record.pendingKey, undefined);
  assert.doesNotMatch(app.messageText(), /storage-lost/);
  app.dom.window.close();
});
