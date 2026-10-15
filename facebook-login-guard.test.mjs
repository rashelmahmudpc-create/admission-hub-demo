import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// Facebook sign-in runs through Firebase's own authDomain (the same fix as
// Google), because the raw FB JS SDK opens www.facebook.com/dialog/oauth
// directly and Facebook answers with its own "Sorry, something went wrong"
// page -- the owner's screenshot of 2026-10-15. These tests pin the new
// contract: the flow calls firebase.auth().signInWithPopup with a
// FacebookAuthProvider, forwards the returned access token to POST /facebook,
// and never rejects -- a dead popup resolves false so the UI can show a hint.
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

// A Firebase Auth stand-in: initializeApp/auth/FacebookAuthProvider are the
// only pieces loadFirebaseAuth touches when window.firebase already exists.
function fakeFirebase(popup, redirect, redirectResult) {
  const authInstance = {
    signInWithPopup: () => popup(),
    // A blocked or unsupported popup falls back to a full-page redirect, so the
    // mock carries the redirect pair the flow calls next.
    signInWithRedirect: () => (redirect ? redirect() : Promise.resolve()),
    getRedirectResult: () => Promise.resolve(redirectResult ? redirectResult() : null)
  };
  function FacebookAuthProvider() { this.scopes = []; }
  FacebookAuthProvider.prototype.addScope = function (s) { this.scopes.push(s); };
  const auth = () => authInstance;
  auth.FacebookAuthProvider = FacebookAuthProvider;
  auth.GoogleAuthProvider = function GoogleAuthProvider() { this.addScope = () => this; };
  return { apps: [], initializeApp: () => ({ name: 'ah-google' }), auth };
}

function setup(popup, onFacebook, options = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://admissionsky.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const calls = [];
  dom.window.fetch = async (url, options = {}) => {
    const path = String(url);
    calls.push({ path, method: options.method || 'GET', body: options.body });
    if (path.endsWith('/config')) {
      return reply(200, {
        auth: {
          available: true,
          methods: { facebook: { available: true, clientId: '4521982924756523' } },
          verificationEmail: { resendCooldownSeconds: 60 }
        }
      });
    }
    if (path.endsWith('/facebook')) {
      if (onFacebook) onFacebook(JSON.parse(String(options.body || '{}')));
      return reply(200, { authenticated: true, created: false, sessionId: 'sess-1' });
    }
    if (path.endsWith('/session')) return reply(401, { error: { code: 'SESSION_INVALID' } });
    return reply(404, {});
  };
  dom.window.firebase = fakeFirebase(popup, options.redirect, options.redirectResult);
  dom.window.eval(script);
  return { dom, window: dom.window, calls };
}

test('Facebook sign-in returns the authDomain access token to POST /facebook', async () => {
  let seenToken = null;
  const app = setup(
    async () => ({ credential: { accessToken: 'facebook-token-abcdefghijklmnop' } }),
    body => { seenToken = body.accessToken; }
  );
  await waitFor(() => app.window.AdmissionSkyBridge);
  await waitFor(() => app.calls.some(call => call.path.endsWith('/config')));
  await sleep(20);

  const outcome = await app.window.AdmissionSkyBridge.facebook();

  assert.equal(outcome, true, 'a connected popup must resolve true');
  assert.equal(seenToken, 'facebook-token-abcdefghijklmnop', 'the token from Firebase must reach POST /facebook');
  assert.ok(app.calls.some(call => call.path.endsWith('/facebook')), 'POST /facebook must be attempted');
  app.dom.window.close();
});

test('Facebook sign-in resolves false instead of rejecting when the popup fails', async () => {
  const app = setup(async () => { const e = new Error('popup closed'); e.code = 'auth/popup-closed-by-user'; throw e; });
  await waitFor(() => app.window.AdmissionSkyBridge);
  await waitFor(() => app.calls.some(call => call.path.endsWith('/config')));
  await sleep(20);

  const outcome = await app.window.AdmissionSkyBridge.facebook();
  assert.equal(outcome, false, 'a failed popup must resolve false, not reject');
  app.dom.window.close();
});

test('a blocked Facebook popup falls back to a full-page redirect instead of hanging', async () => {
  let redirectCalled = 0;
  const app = setup(
    async () => { const e = new Error('popup blocked'); e.code = 'auth/popup-blocked'; throw e; },
    null,
    { redirect: () => { redirectCalled += 1; } }
  );
  await waitFor(() => app.window.AdmissionSkyBridge);
  await waitFor(() => app.calls.some(call => call.path.endsWith('/config')));
  await sleep(20);

  const outcome = await app.window.AdmissionSkyBridge.facebook();
  assert.equal(outcome, true, 'the hand-off to redirect must settle, not hang');
  assert.equal(redirectCalled, 1, 'a blocked popup must fall back to signInWithRedirect');
  assert.equal(app.calls.some(call => call.path.endsWith('/facebook')), false,
    'nothing is posted until the redirect returns');
  app.dom.window.close();
});

test('a returning Facebook redirect signs the account in through POST /facebook', async () => {
  let seenToken = null;
  const app = setup(
    async () => { throw new Error('popup must not be used for the return leg'); },
    body => { seenToken = body.accessToken; },
    { redirectResult: () => ({ user: { providerId: 'facebook.com' }, credential: { providerId: 'facebook.com', accessToken: 'facebook-return-token-abcdefghij' } }) }
  );
  await waitFor(() => app.window.AdmissionSkyBridge);
  await waitFor(() => app.calls.some(call => call.path.endsWith('/config')));
  // The return leg only runs when the flow itself asked for a redirect, which
  // it records in sessionStorage before leaving the page.
  app.window.sessionStorage.setItem('ah-oauth-redirect', '1');
  app.window.AdmissionAccount.open();
  await waitFor(() => app.calls.some(call => call.path.endsWith('/facebook')), 4000);

  assert.equal(seenToken, 'facebook-return-token-abcdefghij', 'the returned token must reach POST /facebook');
  assert.equal(app.window.sessionStorage.getItem('ah-oauth-redirect'), null, 'the pending flag is cleared');
  app.dom.window.close();
});
