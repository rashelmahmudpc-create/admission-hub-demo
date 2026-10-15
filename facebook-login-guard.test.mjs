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
function fakeFirebase(popup) {
  const authInstance = { signInWithPopup: () => popup() };
  function FacebookAuthProvider() { this.scopes = []; }
  FacebookAuthProvider.prototype.addScope = function (s) { this.scopes.push(s); };
  const auth = () => authInstance;
  auth.FacebookAuthProvider = FacebookAuthProvider;
  return { apps: [], initializeApp: () => ({ name: 'ah-google' }), auth };
}

function setup(popup, onFacebook) {
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
  dom.window.firebase = fakeFirebase(popup);
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
