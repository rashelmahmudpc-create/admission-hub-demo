import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createNativeAuthHandler } from './auth-native/worker/public-auth-handler.mjs';

const source = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');
function clientApi(response) {
  const timers = [];
  const start = source.indexOf('  const api = async (path, options = {}) => {');
  const end = source.indexOf('\n  const updateLauncher =', start);
  assert.ok(start > 0 && end > start);
  const context = { API: '/api/auth/v1', URL, AbortController, location: { href: 'https://admissionsky.pages.dev/' },
    fetch: async () => response, setTimeout: (fn, ms) => { timers.push(ms); return 1; }, clearTimeout() {} };
  return { api: vm.runInNewContext(source.slice(start, end) + '\napi;', context), timers };
}

test('HTML gateway failure retains ENDPOINT_UNAVAILABLE instead of an undefined parsed exception', async () => {
  const { api } = clientApi({ ok: false, status: 502, headers: new Headers(), json: async () => { throw new SyntaxError('HTML'); } });
  await assert.rejects(api('/google', { method: 'POST', body: { accessToken: 'test-token' } }), e => e.status === 502 && e.code === 'ENDPOINT_UNAVAILABLE');
});
test('social credential exchange is not aborted at the old 18 second ceiling', async () => {
  const { api, timers } = clientApi({ ok: true, status: 200, json: async () => ({ ok: true }) });
  await api('/google', { method: 'POST', body: { accessToken: 'test-token' } });
  assert.equal(timers[0], 45000);
});
test('ordinary config reads retain their bounded 18 second ceiling', async () => {
  const { api, timers } = clientApi({ ok: true, status: 200, json: async () => ({ ok: true }) });
  await api('/config'); assert.equal(timers[0], 18000);
});

const token = name => `${name}-${'x'.repeat(45)}`;
const firebaseFetch = async (url) => {
  const path = new URL(url).pathname;
  if (path.endsWith('accounts:createAuthUri')) return Response.json({ providerId: 'google.com', sessionId: token('s'), authUri: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=916950643726-6ul6djp3ve11ek37bbht715afb6pc0ka.apps.googleusercontent.com' });
  if (path.endsWith('accounts:signInWithIdp')) return Response.json({ idToken: token('id'), refreshToken: token('refresh'), localId: 'canonical-firebase-uid', email: 'student@example.com', emailVerified: true, isNewUser: true });
  if (path.endsWith('accounts:lookup')) return Response.json({ users: [{ localId: 'canonical-firebase-uid', email: 'student@example.com', emailVerified: true, providerUserInfo: [{ providerId: 'google.com' }] }] });
  throw new Error('Unexpected provider path');
};
function authority({ hangProfile = false, failSession = false } = {}) {
  const calls = [];
  return { calls, idFromName: n => n, get: () => ({ fetch: async (url, init) => {
    const path = new URL(url).pathname; calls.push(path);
    if (path.endsWith('/rate')) return Response.json({ ok: true, result: { accepted: true } });
    if (path.endsWith('/session/create')) return failSession
      ? Response.json({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } }, { status: 503 })
      : Response.json({ ok: true, result: { created: true, sessionToken: token('app-session'), sessionExpiresAt: Date.now() + 3600000, user: { id: 'usr_test', status: 'active' } } });
    if (path.endsWith('/profile/get-v2')) return hangProfile ? new Promise(() => {}) : Response.json({ ok: true, result: { profile: {}, avatar: {} } });
    throw new Error('Unexpected authority path');
  } }) };
}
function request() { return new Request('https://admission-gk.admissionhub.workers.dev/api/auth/v1/google', { method: 'POST', headers: { Origin: 'https://admissionsky.pages.dev', 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: token('google-access') }) }); }
function env(store) { return { GOOGLE_AUTH_ACTIVATION: 'enabled', FIREBASE_WEB_API_KEY: 'test-api-key-123456789012345', AUTH_AUTHORITY: store }; }

test('created account cookies return even when optional profile enrichment never settles', async () => {
  const store = authority({ hangProfile: true }); const pending = [];
  const handler = createNativeAuthHandler({ fetchImpl: firebaseFetch });
  let timer;
  try {
    const result = await Promise.race([handler(request(), env(store), { waitUntil: p => pending.push(p) }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Optional profile blocked the session response')), 150); })]);
    assert.equal(result.status, 200); const body = await result.json();
    assert.equal(body.created, true); assert.equal(body.authenticated, true);
    assert.match(result.headers.get('Set-Cookie'), /__Host-ah_session=/);
    assert.match(result.headers.get('Set-Cookie'), /__Host-ah_firebase=/);
    assert.equal(result.headers.get('X-AH-Auth-Stage'), 'SESSION_CREATED');
    assert.equal(pending.length, 1);
    assert.ok(!JSON.stringify(body).includes(token('refresh')));
  } finally { clearTimeout(timer); }
});
test('session-storage failure remains closed and returns only safe stage diagnostics', async () => {
  const handler = createNativeAuthHandler({ fetchImpl: firebaseFetch });
  const result = await handler(request(), env(authority({ failSession: true })), { waitUntil() {} });
  assert.equal(result.status, 503);
  assert.equal(result.headers.get('X-AH-Auth-Stage'), 'ACCOUNT_SESSION');
  assert.equal(result.headers.get('Set-Cookie'), null);
  const body = await result.json(); assert.equal(body.ok, false);
  assert.ok(!JSON.stringify(body).includes('student@example.com'));
});
