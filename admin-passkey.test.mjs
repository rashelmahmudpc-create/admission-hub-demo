/* Admin passkey login — real WebAuthn verification, no mocks.
 *
 * The authenticator fixture builds genuine attestation/assertion objects and
 * signs with a real P-256 key, so these tests exercise the same
 * `auth-native/core/webauthn.mjs` path production uses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { handleAdminPasskeyRequest } from './admin-passkey.mjs';
import { handleFcmNotificationRequest } from './fcm-notification.mjs';

const ORIGIN = 'https://admissionhub.pages.dev';
const RP_ID = 'admissionhub.pages.dev';
const ADMIN_TOKEN = 'admin-passkey-test-token-0123456789';
const enc = new TextEncoder();

const concat = (...values) => {
  const out = new Uint8Array(values.reduce((sum, v) => sum + v.length, 0));
  let offset = 0;
  for (const v of values) { out.set(v, offset); offset += v.length; }
  return out;
};
const uint = (major, value) => {
  if (value < 24) return Uint8Array.of((major << 5) | value);
  if (value < 256) return Uint8Array.of((major << 5) | 24, value);
  if (value < 65536) return Uint8Array.of((major << 5) | 25, value >> 8, value & 255);
  return Uint8Array.of((major << 5) | 26, value >>> 24, value >>> 16, value >>> 8, value);
};
function cbor(value) {
  if (value instanceof Uint8Array) return concat(uint(2, value.length), value);
  if (typeof value === 'string') { const b = enc.encode(value); return concat(uint(3, b.length), b); }
  if (typeof value === 'number' && Number.isInteger(value)) return value >= 0 ? uint(0, value) : uint(1, -1 - value);
  if (value instanceof Map) {
    const rows = [...value.entries()].flatMap(([k, v]) => [cbor(k), cbor(v)]);
    return concat(uint(5, value.size), ...rows);
  }
  throw new TypeError('unsupported fixture value');
}
const sha256 = async v => new Uint8Array(await webcrypto.subtle.digest('SHA-256', v));
const b64u = v => Buffer.from(v).toString('base64url');
const clientData = (type, challenge) => b64u(enc.encode(JSON.stringify({ type, challenge, origin: ORIGIN, crossOrigin: false })));

function makeFakeKV() {
  const map = new Map();
  return {
    _map: map,
    async get(k) { return map.has(k) ? map.get(k).v : null; },
    async put(k, v) { map.set(k, { v, t: Date.now() }); },
    async delete(k) { map.delete(k); },
    async list({ prefix = '' } = {}) {
      return { keys: [...map.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) };
    }
  };
}
function makeFakeD1() {
  const devices = new Map();
  const statement = sql => ({
    bind(...args) {
      return {
        first: async () => {
          if (sql.includes('SELECT COUNT(DISTINCT fcm_token)')) return { n: 0 };
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ success: true, meta: { changes: 0 } })
      };
    },
    first: async () => (sql.includes('SELECT COUNT(DISTINCT fcm_token)') ? { n: 0 } : null),
    all: async () => ({ results: [] }),
    run: async () => ({ success: true, meta: { changes: 0 } })
  });
  return { _devices: devices, prepare: statement, exec: async () => ({ success: true }), batch: async () => [] };
}
const makeEnv = (overrides = {}) => ({ GK_KV: makeFakeKV(), PROFILE_DB: makeFakeD1(), ADMIN_TOKEN, ...overrides });

const req = (path, { method = 'POST', body, headers = {} } = {}) => new Request(`https://admission-gk.admissionhub.workers.dev${path}`, {
  method,
  headers: { 'Content-Type': 'application/json', ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
const adminHeaders = { Authorization: `Bearer ${ADMIN_TOKEN}` };

/* A software authenticator: generates a key, produces attestation once, then
 * signs assertions with a monotonically advancing counter. */
async function makeAuthenticator() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const credentialId = webcrypto.getRandomValues(new Uint8Array(32));
  const rpHash = await sha256(enc.encode(RP_ID));
  const cose = cbor(new Map([
    [1, 2], [3, -7], [-1, 1],
    [-2, Uint8Array.from(Buffer.from(jwk.x, 'base64url'))],
    [-3, Uint8Array.from(Buffer.from(jwk.y, 'base64url'))]
  ]));
  /* Registration authData carries the credential public key; assertions do not
   * (37-byte prefix only). Mirrors what a real authenticator emits. */
  const registrationAuthData = concat(
    rpHash,
    Uint8Array.of(0x45),
    Uint8Array.of(0, 0, 0, 0),
    new Uint8Array(16),
    Uint8Array.of(credentialId.length >> 8, credentialId.length & 255),
    credentialId,
    cose
  );

  return {
    credentialId: b64u(credentialId),
    async register(challenge) {
      return {
        rawId: b64u(credentialId),
        clientDataJSON: clientData('webauthn.create', challenge),
        attestationObject: b64u(cbor(new Map([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', registrationAuthData]
        ]))),
        transports: ['internal']
      };
    },
    async assert(challenge, counter = 1) {
      const authData = concat(rpHash, Uint8Array.of(0x05), Uint8Array.of(0, 0, 0, counter));
      const client = clientData('webauthn.get', challenge);
      const clientHash = await sha256(new Uint8Array(Buffer.from(client, 'base64url')));
      const signature = new Uint8Array(await webcrypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, concat(authData, clientHash)
      ));
      return { rawId: b64u(credentialId), clientDataJSON: client, authenticatorData: b64u(authData), signature: b64u(signature) };
    }
  };
}

const call = (path, opts, env) => handleAdminPasskeyRequest(req(path, opts), env);

test('enrollment requires the admin token', async () => {
  const env = makeEnv();
  const res = await call('/api/admin/webauthn/challenge', { body: { purpose: 'register' } }, env);
  assert.equal(res.status, 403);
});

test('assert cannot start before any credential is enrolled', async () => {
  const env = makeEnv();
  const res = await call('/api/admin/webauthn/challenge', { body: { purpose: 'assert' } }, env);
  assert.equal(res.status, 404);
});

test('register -> assert mints a session, and the session authorizes an admin route', async () => {
  const env = makeEnv();
  const authenticator = await makeAuthenticator();

  const begin = await call('/api/admin/webauthn/challenge', { body: { purpose: 'register' }, headers: adminHeaders }, env);
  const beginBody = await begin.json();
  const registered = await call('/api/admin/webauthn/register', {
    body: { challengeId: beginBody.challengeId, response: await authenticator.register(beginBody.options.challenge), label: 'Owner phone' },
    headers: adminHeaders
  }, env);
  assert.equal(registered.status, 200, JSON.stringify(await registered.clone().json()));
  assert.equal((await registered.json()).registered, true);

  const status = await call('/api/admin/webauthn/status', { method: 'GET' }, env);
  const statusBody = await status.json();
  assert.equal(statusBody.enrolled, true);
  assert.equal(statusBody.credentialCount, 1);

  const assertBegin = await call('/api/admin/webauthn/challenge', { body: { purpose: 'assert' } }, env);
  const assertBody = await assertBegin.json();
  assert.equal(assertBegin.status, 200);
  assert.equal(assertBody.options.allowCredentials.length, 1);

  const asserted = await call('/api/admin/webauthn/assert', {
    body: { challengeId: assertBody.challengeId, response: await authenticator.assert(assertBody.options.challenge) }
  }, env);
  assert.equal(asserted.status, 200, JSON.stringify(await asserted.clone().json()));
  const { session, authenticated } = await asserted.json();
  assert.equal(authenticated, true);
  assert.ok(session && session.length > 20);

  /* The minted session must open a real admin route without ADMIN_TOKEN. */
  const history = await handleFcmNotificationRequest(req('/api/notifications/history', { method: 'GET', headers: { 'X-Admin-Session': session } }), env, {});
  assert.notEqual(history.status, 403, 'passkey session must not be forbidden');
});

/* navigator.credentials.create() needs `rp:{id,name}`; only assertions accept a
 * bare `rpId`. Shipping the flat form made the browser throw before the
 * authenticator ran, so no device could ever enrol. */
test('register challenge returns an rp object, and assert challenge returns rpId', async () => {
  const env = makeEnv();
  const authenticator = await makeAuthenticator();
  const begin = await call('/api/admin/webauthn/challenge', { body: { purpose: 'register' }, headers: adminHeaders }, env);
  const { challengeId, options } = await begin.json();
  assert.deepEqual(options.rp, { id: RP_ID, name: 'AdmissionHub Admin' });
  assert.equal('rpId' in options, false, 'register options must not carry a bare rpId');
  assert.ok(options.user && options.user.id, 'register options must carry a user handle');

  const registered = await call('/api/admin/webauthn/register', {
    body: { challengeId, response: await authenticator.register(options.challenge) },
    headers: adminHeaders
  }, env);
  assert.equal(registered.status, 200, JSON.stringify(await registered.clone().json()));

  const assertBegin = await call('/api/admin/webauthn/challenge', { body: { purpose: 'assert' } }, env);
  const assertOptions = (await assertBegin.json()).options;
  assert.equal(assertOptions.rpId, RP_ID);
  assert.equal('rp' in assertOptions, false, 'assert options use rpId, not rp');
});

/* Authenticators echo the registration user handle back on every assertion.
 * It has to be persisted with the credential or the comparison always fails. */
test('registered credential persists the user handle that assertions echo back', async () => {
  const env = makeEnv();
  const authenticator = await makeAuthenticator();
  const begin = await call('/api/admin/webauthn/challenge', { body: { purpose: 'register' }, headers: adminHeaders }, env);
  const beginBody = await begin.json();
  await call('/api/admin/webauthn/register', {
    body: { challengeId: beginBody.challengeId, response: await authenticator.register(beginBody.options.challenge) },
    headers: adminHeaders
  }, env);

  const stored = JSON.parse(await env.GK_KV.get(`admin:pk:cred:${authenticator.credentialId}`));
  assert.equal(stored.userHandle, beginBody.options.user.id, 'stored handle must match the handle offered at registration');

  /* An assertion that echoes that same handle must verify. */
  const assertBegin = await call('/api/admin/webauthn/challenge', { body: { purpose: 'assert' } }, env);
  const assertBody = await assertBegin.json();
  const asserted = await call('/api/admin/webauthn/assert', {
    body: { challengeId: assertBody.challengeId, response: { ...(await authenticator.assert(assertBody.options.challenge)), userHandle: stored.userHandle } }
  }, env);
  assert.equal(asserted.status, 200, JSON.stringify(await asserted.clone().json()));
});

test('a wrong challenge is rejected, and a challenge is single-use', async () => {
  const env = makeEnv();
  const authenticator = await makeAuthenticator();
  const begin = await call('/api/admin/webauthn/challenge', { body: { purpose: 'register' }, headers: adminHeaders }, env);
  const { challengeId, options } = await begin.json();

  const forged = await call('/api/admin/webauthn/register', {
    body: { challengeId, response: await authenticator.register(b64u(webcrypto.getRandomValues(new Uint8Array(32)))) },
    headers: adminHeaders
  }, env);
  assert.equal(forged.status, 400);

  /* The challenge was consumed by the failed attempt, so replay must fail. */
  const replay = await call('/api/admin/webauthn/register', {
    body: { challengeId, response: await authenticator.register(options.challenge) },
    headers: adminHeaders
  }, env);
  assert.equal(replay.status, 400, 'a used challenge must not be reusable');
});

test('a replayed assertion (stale counter) is rejected', async () => {
  const env = makeEnv();
  const authenticator = await makeAuthenticator();
  const begin = await call('/api/admin/webauthn/challenge', { body: { purpose: 'register' }, headers: adminHeaders }, env);
  const beginBody = await begin.json();
  await call('/api/admin/webauthn/register', {
    body: { challengeId: beginBody.challengeId, response: await authenticator.register(beginBody.options.challenge) },
    headers: adminHeaders
  }, env);

  const first = await call('/api/admin/webauthn/challenge', { body: { purpose: 'assert' } }, env);
  const firstBody = await first.json();
  const goodResponse = await authenticator.assert(firstBody.options.challenge, 5);
  const ok = await call('/api/admin/webauthn/assert', { body: { challengeId: firstBody.challengeId, response: goodResponse } }, env);
  assert.equal(ok.status, 200);

  /* Replaying the same signed assertion against a fresh challenge must fail on
   * the counter, since the stored counter has advanced past it. */
  const second = await call('/api/admin/webauthn/challenge', { body: { purpose: 'assert' } }, env);
  const secondBody = await second.json();
  const replay = await call('/api/admin/webauthn/assert', { body: { challengeId: secondBody.challengeId, response: goodResponse } }, env);
  assert.equal(replay.status, 401);
});

test('an unknown credential id cannot authenticate', async () => {
  const env = makeEnv();
  const authenticator = await makeAuthenticator();
  const begin = await call('/api/admin/webauthn/challenge', { body: { purpose: 'register' }, headers: adminHeaders }, env);
  const beginBody = await begin.json();
  await call('/api/admin/webauthn/register', {
    body: { challengeId: beginBody.challengeId, response: await authenticator.register(beginBody.options.challenge) },
    headers: adminHeaders
  }, env);

  const other = await makeAuthenticator();
  const assertBegin = await call('/api/admin/webauthn/challenge', { body: { purpose: 'assert' } }, env);
  const assertBody = await assertBegin.json();
  const res = await call('/api/admin/webauthn/assert', {
    body: { challengeId: assertBody.challengeId, response: await other.assert(assertBody.options.challenge) }
  }, env);
  assert.equal(res.status, 404);
});

test('the admin routes still reject a request with neither token nor session', async () => {
  const env = makeEnv();
  const res = await handleFcmNotificationRequest(req('/api/notifications/history', { method: 'GET' }), env, {});
  assert.equal(res.status, 403);
});

test('the admin token remains a working break-glass path', async () => {
  const env = makeEnv();
  const res = await handleFcmNotificationRequest(req('/api/notifications/history', { method: 'GET', headers: adminHeaders }), env, {});
  assert.notEqual(res.status, 403);
});
