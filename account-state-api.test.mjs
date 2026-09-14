import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudflareNativeAuthEngine } from './auth-native/core/auth-engine.mjs';
import { asNativeAuthError, AUTH_ERROR_CODES, NativeAuthError } from './auth-native/core/errors.mjs';
import { MemoryAuthRepository } from './auth-native/testing/memory-auth-repository.mjs';
import { MemoryVerificationRepository } from './auth-native/verification/memory-verification-repository.mjs';
import { VerificationOrchestrator } from './auth-native/verification/orchestrator.mjs';
import { VERIFICATION_CHANNELS, VERIFICATION_MODES } from './auth-native/verification/provider-contract.mjs';
import { reconcileIdentitySnapshot, summarizeIdentityHealth } from './auth-native/core/identity-reconciliation.mjs';
import { AUTH_API_PREFIX, createNativeAuthHandler } from './auth-native/worker/public-auth-handler.mjs';

const SECRET = 'account-state-api-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXY';
const EMAIL = 'account.state@example.com';
const SUBJECT = 'firebase-account-state-uid';
const REFRESH = `firebase-refresh-${'r'.repeat(32)}`;
const ID_TOKEN = `firebase-id-${'i'.repeat(32)}`;
const DEVICE = 'device-account-state-123456';
const ADMIN_TOKEN = 'admin-account-state-0123456789-XYZ';

class OtpProvider {
  constructor(now) {
    this.id = 'otp-a';
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.now = now;
    this.code = '';
    this.sends = 0;
  }
  async checkAvailability() { return { available: true, code: 'READY' }; }
  async getRemainingQuota() { return { remaining: 100, limit: 100, resetAt: this.now() + 86_400_000 }; }
  async getProviderStatus() { return { status: 'healthy', configured: true }; }
  async sendVerification() { return { accepted: true }; }
  async verifyCode() { return { verified: false }; }
}

// Mirrors the DO dispatch for the Phase 3 account/identity routes.
class AuthorityNamespace {
  constructor(engine, verification, repository) {
    this.engine = engine;
    this.verification = verification;
    this.repository = repository;
  }
  idFromName(name) { return name; }
  get() { return { fetch: this.fetch.bind(this) }; }
  async fetch(input, init) {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;
    try {
      const body = request.method === 'GET' ? {} : await request.json();
      if (path === '/internal/firebase/session/get') {
        return Response.json({ ok: true, result: await this.engine.getFirebaseSession(body.sessionToken, body.input) });
      }
      if (path === '/internal/account/state') {
        const session = await this.engine.getFirebaseSession(body.sessionToken, body.input);
        const state = await this.repository.getAccountState({ userId: session.user.id, now: Date.now() });
        if (state.error) throw new NativeAuthError(state.error);
        return Response.json({ ok: true, account: state });
      }
      if (path === '/internal/account/identities') {
        const session = await this.engine.getFirebaseSession(body.sessionToken, body.input);
        const identities = await this.repository.listLinkedIdentities({ userId: session.user.id });
        return Response.json({ ok: true, identities });
      }
      if (path === '/internal/account/state/set') {
        const result = await this.repository.setAccountState({
          userId: String(body?.userId || ''),
          toStatus: String(body?.status || ''),
          now: Date.now()
        });
        if (result.error) throw new NativeAuthError(result.error);
        return Response.json({ ok: true, account: result });
      }
      if (path === '/internal/identity/health') {
        const snapshot = await this.repository.identitySnapshot();
        return Response.json({ ok: true, health: summarizeIdentityHealth(reconcileIdentitySnapshot(snapshot)) });
      }
      return Response.json({ ok: false, error: { code: 'NOT_FOUND' } }, { status: 404 });
    } catch (cause) {
      const error = asNativeAuthError(cause);
      return Response.json({ ok: false, error: error.toPublic() }, { status: error.status });
    }
  }
}

const request = (path, { body, cookie, adminToken } = {}) => new Request(`https://worker.example${path}`, {
  method: body ? 'POST' : 'GET',
  headers: {
    Origin: 'https://admissionhub.pages.dev',
    'CF-Connecting-IP': '203.0.113.93',
    'User-Agent': 'Chrome',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
    ...(adminToken ? { 'X-AH-Admin-Token': adminToken } : {})
  },
  ...(body ? { body: JSON.stringify(body) } : {})
});

async function setup() {
  let now = 1_800_000_000_000;
  const authRepository = new MemoryAuthRepository();
  const engine = new CloudflareNativeAuthEngine({ repository: authRepository, hmacSecret: SECRET, now: () => now });
  const context = { ip: '203.0.113.93', deviceId: DEVICE, userAgent: 'Chrome', origin: 'https://admissionhub.pages.dev' };
  const session = await engine.establishFirebaseSession({ email: EMAIL, subject: SUBJECT }, context);
  const provider = new OtpProvider(() => now);
  const verification = new VerificationOrchestrator({
    repository: new MemoryVerificationRepository(),
    hmacSecret: SECRET,
    providers: [provider],
    activated: true,
    now: () => now,
    config: { enabled: true, providers: [{ id: 'otp-a', enabled: true, priority: 1, dailyQuota: 100 }] }
  });
  const firebaseFetch = async url => {
    const path = new URL(url).pathname;
    if (path.endsWith('/token')) return Response.json({
      user_id: SUBJECT, id_token: ID_TOKEN, refresh_token: REFRESH, expires_in: '3600'
    });
    if (path.endsWith('/accounts:lookup')) return Response.json({ users: [{
      localId: SUBJECT, email: EMAIL, emailVerified: true, disabled: false
    }] });
    return Response.json({ error: { message: 'NOT_FOUND' } }, { status: 404 });
  };
  const handler = createNativeAuthHandler({ fetchImpl: firebaseFetch });
  const env = {
    AUTH_AUTHORITY: new AuthorityNamespace(engine, verification, authRepository),
    FIREBASE_WEB_API_KEY: 'firebase-account-state-api-key-12345',
    VERIFICATION_AUTH_ACTIVATION: 'enabled',
    ADMIN_TOKEN
  };
  const cookie = `__Host-ah_session=${session.sessionToken}; __Host-ah_firebase=${REFRESH}; __Host-ah_device=${DEVICE}`;
  return { handler, env, cookie, session, engine, repository: authRepository, adminToken: ADMIN_TOKEN };
}

test('GET /account returns the lifecycle state for the current session', async () => {
  const app = await setup();
  const res = await app.handler(request(`${AUTH_API_PREFIX}/account`, { cookie: app.cookie }), app.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.account.status, 'active');
  assert.equal(body.account.userId, app.session.user.id);
});

test('GET /account fails closed without a Firebase session cookie', async () => {
  const app = await setup();
  const res = await app.handler(request(`${AUTH_API_PREFIX}/account`), app.env);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, AUTH_ERROR_CODES.SESSION_INVALID);
});

test('GET /identities lists linked providers without leaking raw subjects', async () => {
  const app = await setup();
  const res = await app.handler(request(`${AUTH_API_PREFIX}/identities`, { cookie: app.cookie }), app.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.identities.length, 1);
  assert.equal(body.identities[0].provider, 'firebase');
  assert.equal(body.identities[0].linked, true);
  assert.equal(body.identities[0].verified, true);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(SUBJECT));
  assert.doesNotMatch(JSON.stringify(body), /subjectRef/);
});

test('admin identity health requires the admin token', async () => {
  const app = await setup();
  const denied = await app.handler(request(`${AUTH_API_PREFIX}/admin/identity/health`), app.env);
  assert.equal(denied.status, 403);
  const wrong = await app.handler(request(`${AUTH_API_PREFIX}/admin/identity/health`, { adminToken: 'wrong-token-0123456789-ABC' }), app.env);
  assert.equal(wrong.status, 403);
  const allowed = await app.handler(request(`${AUTH_API_PREFIX}/admin/identity/health`, { adminToken: app.adminToken }), app.env);
  assert.equal(allowed.status, 200);
  const body = await allowed.json();
  assert.equal(body.ok, true);
  assert.equal(body.health.ok, true);
  assert.equal(body.health.users, 1);
});

test('admin identity health surfaces reconciliation findings as counts only', async () => {
  const app = await setup();
  app.repository.externalIdentities.set('firebase:orphan-subject', {
    provider: 'firebase', subjectRef: 'orphan-subject', userId: 'missing-user', createdAt: 1, lastVerifiedAt: 1
  });
  const res = await app.handler(request(`${AUTH_API_PREFIX}/admin/identity/health`, { adminToken: app.adminToken }), app.env);
  const body = await res.json();
  assert.equal(body.health.ok, false);
  assert.equal(body.health.findings['orphan-external-identity'], 1);
  assert.equal(body.health.checks['identity.mapping'].ok, false);
  assert.doesNotMatch(JSON.stringify(body), /orphan-subject/);
});

test('admin state change: valid transition suspends and revokes the session', async () => {
  const app = await setup();
  const before = await app.handler(request(`${AUTH_API_PREFIX}/account`, { cookie: app.cookie }), app.env);
  assert.equal(before.status, 200);

  const res = await app.handler(request(`${AUTH_API_PREFIX}/admin/account/state`, {
    body: { userId: app.session.user.id, status: 'suspended' }, adminToken: app.adminToken
  }), app.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.account.status, 'suspended');
  assert.equal(body.account.changed, true);
  assert.equal(body.account.revokedSessions, 1);

  const after = await app.handler(request(`${AUTH_API_PREFIX}/account`, { cookie: app.cookie }), app.env);
  assert.equal(after.status, 401);
});

test('admin state change: invalid transition is rejected with 409', async () => {
  const app = await setup();
  await app.handler(request(`${AUTH_API_PREFIX}/admin/account/state`, {
    body: { userId: app.session.user.id, status: 'suspended' }, adminToken: app.adminToken
  }), app.env);
  const res = await app.handler(request(`${AUTH_API_PREFIX}/admin/account/state`, {
    body: { userId: app.session.user.id, status: 'provisioning' }, adminToken: app.adminToken
  }), app.env);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error.code, AUTH_ERROR_CODES.ACCOUNT_STATE_INVALID);
});

test('admin state change: unknown user is rejected with 404', async () => {
  const app = await setup();
  const res = await app.handler(request(`${AUTH_API_PREFIX}/admin/account/state`, {
    body: { userId: 'ghost-user', status: 'suspended' }, adminToken: app.adminToken
  }), app.env);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND);
});

test('admin state change requires the admin token', async () => {
  const app = await setup();
  const res = await app.handler(request(`${AUTH_API_PREFIX}/admin/account/state`, {
    body: { userId: app.session.user.id, status: 'suspended' }
  }), app.env);
  assert.equal(res.status, 403);
});

test('deactivation is terminal: sessions revoked, reactivation only via recovery', async () => {
  const app = await setup();
  const off = await app.handler(request(`${AUTH_API_PREFIX}/admin/account/state`, {
    body: { userId: app.session.user.id, status: 'deactivated' }, adminToken: app.adminToken
  }), app.env);
  assert.equal(off.status, 200);
  assert.equal((await off.json()).account.status, 'deactivated');

  // deactivated account can no longer use its session
  const denied = await app.handler(request(`${AUTH_API_PREFIX}/account`, { cookie: app.cookie }), app.env);
  assert.equal(denied.status, 401);

  // direct reactivation is invalid (deactivated -> active is not a legal transition)
  const direct = await app.handler(request(`${AUTH_API_PREFIX}/admin/account/state`, {
    body: { userId: app.session.user.id, status: 'active' }, adminToken: app.adminToken
  }), app.env);
  assert.equal(direct.status, 409);
  assert.equal((await direct.json()).error.code, AUTH_ERROR_CODES.ACCOUNT_STATE_INVALID);

  // recovery path reactivates
  const recovering = await app.handler(request(`${AUTH_API_PREFIX}/admin/account/state`, {
    body: { userId: app.session.user.id, status: 'recovery' }, adminToken: app.adminToken
  }), app.env);
  assert.equal(recovering.status, 200);
  const back = await app.handler(request(`${AUTH_API_PREFIX}/admin/account/state`, {
    body: { userId: app.session.user.id, status: 'active' }, adminToken: app.adminToken
  }), app.env);
  assert.equal(back.status, 200);
  assert.equal((await back.json()).account.status, 'active');
});
