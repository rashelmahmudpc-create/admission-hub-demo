import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SqliteAuthRepository } from './auth-native/storage/sqlite-auth-repository.mjs';
import { CloudflareNativeAuthEngine } from './auth-native/core/auth-engine.mjs';
import { asNativeAuthError, AUTH_ERROR_CODES, NativeAuthError } from './auth-native/core/errors.mjs';
import { MemoryAuthRepository } from './auth-native/testing/memory-auth-repository.mjs';
import { MemoryVerificationRepository } from './auth-native/verification/memory-verification-repository.mjs';
import { VerificationOrchestrator } from './auth-native/verification/orchestrator.mjs';
import { VERIFICATION_CHANNELS, VERIFICATION_MODES } from './auth-native/verification/provider-contract.mjs';
import { AUTH_API_PREFIX, createNativeAuthHandler } from './auth-native/worker/public-auth-handler.mjs';

const SECRET = 'session-recovery-api-secret-0123456789-ABCDEFGHIJKLMNOPQ';
const NOW = 1_800_000_000_000;
const EXPIRY = 1_800_864_000_000;

// ---- repository-level (sqlite) ----

function sqliteRepository() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  const sql = {
    exec(statement, ...bindings) {
      const prepared = database.prepare(statement);
      if (prepared.reader) return prepared.all(...bindings);
      prepared.run(...bindings);
      return [];
    }
  };
  const repository = new SqliteAuthRepository({ sql, transactionSync(work) { return database.transaction(work)(); } });
  repository.migrate();
  return { database, repository };
}

const establish = (repository, userId, sessionRef, overrides = {}) => repository.establishExternalSession({
  provider: 'firebase',
  subjectRef: `subject-${userId}`,
  userIdCandidate: userId,
  emailRef: `email-ref-${userId}`,
  emailMask: 'u***@example.com',
  sessionRef,
  sessionExpiresAt: EXPIRY,
  ipRef: 'ip-ref',
  deviceRef: `device-${sessionRef}`,
  userAgent: 'Chrome',
  now: NOW,
  ...overrides
});

test('revokeUserSessions revokes all of one user sessions, other users untouched', async () => {
  const { database, repository } = sqliteRepository();
  await establish(repository, 'user-1', 's-1a');
  await establish(repository, 'user-1', 's-1b', { sessionRef: 's-1b' });
  await establish(repository, 'user-2', 's-2a');

  const result = await repository.revokeUserSessions({ userId: 'user-1', now: NOW + 1000 });
  assert.equal(result.revoked, 2);

  const probe1 = await repository.getExternalSession({ sessionRef: 's-1b', provider: 'firebase', subjectRef: 'subject-user-1', emailRef: 'email-ref-user-1', now: NOW + 2000 });
  assert.equal(probe1.error, AUTH_ERROR_CODES.SESSION_INVALID);
  const probe2 = await repository.getExternalSession({ sessionRef: 's-2a', provider: 'firebase', subjectRef: 'subject-user-2', emailRef: 'email-ref-user-2', now: NOW + 2000 });
  assert.equal(probe2.error, undefined);

  const events = database.prepare("SELECT event_type FROM auth_security_events WHERE user_id='user-1' AND event_type='logout-all'").all();
  assert.equal(events.length, 1);
});

test('revokeUserSessions is idempotent and reports zero for unknown user as error', async () => {
  const { repository } = sqliteRepository();
  await establish(repository, 'user-1', 's-1a');
  await repository.revokeUserSessions({ userId: 'user-1', now: NOW + 1000 });
  const again = await repository.revokeUserSessions({ userId: 'user-1', now: NOW + 2000 });
  assert.equal(again.revoked, 0);
  const missing = await repository.revokeUserSessions({ userId: 'ghost', now: NOW + 3000 });
  assert.equal(missing.error, AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND);
});

test('trackRefresh records session-refreshed only when requested', async () => {
  const { database, repository } = sqliteRepository();
  await establish(repository, 'user-1', 's-1a');
  const plain = await repository.getExternalSession({ sessionRef: 's-1a', provider: 'firebase', subjectRef: 'subject-user-1', emailRef: 'email-ref-user-1', now: NOW + 1000 });
  assert.equal(plain.error, undefined);
  assert.equal(database.prepare("SELECT COUNT(*) AS c FROM auth_security_events WHERE event_type='session-refreshed'").get().c, 0);
  const tracked = await repository.getExternalSession({ sessionRef: 's-1a', provider: 'firebase', subjectRef: 'subject-user-1', emailRef: 'email-ref-user-1', now: NOW + 2000, trackRefresh: true });
  assert.equal(tracked.error, undefined);
  assert.equal(database.prepare("SELECT COUNT(*) AS c FROM auth_security_events WHERE event_type='session-refreshed'").get().c, 1);
});

// ---- API-level (memory repo + real handler) ----

class OtpProvider {
  constructor(now) {
    this.id = 'otp-a';
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.now = now;
  }
  async checkAvailability() { return { available: true, code: 'READY' }; }
  async getRemainingQuota() { return { remaining: 100, limit: 100, resetAt: this.now() + 86_400_000 }; }
  async getProviderStatus() { return { status: 'healthy', configured: true }; }
  async sendVerification() { return { accepted: true }; }
  async verifyCode() { return { verified: false }; }
}

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
      if (path === '/internal/session/revoke') return Response.json({ ok: true, result: await this.engine.revokeSession(body.sessionToken) });
      if (path === '/internal/session/revoke-all') {
        const session = await this.engine.getFirebaseSession(body.sessionToken, body.input);
        const result = await this.repository.revokeUserSessions({ userId: session.user.id, now: Date.now() });
        if (result.error) throw new NativeAuthError(result.error);
        return Response.json({ ok: true, result });
      }
      if (path === '/internal/account/state') {
        const session = await this.engine.getFirebaseSession(body.sessionToken, body.input);
        const state = await this.repository.getAccountState({ userId: session.user.id, now: Date.now() });
        if (state.error) throw new NativeAuthError(state.error);
        return Response.json({ ok: true, account: state });
      }
      return Response.json({ ok: false, error: { code: 'NOT_FOUND' } }, { status: 404 });
    } catch (cause) {
      const error = asNativeAuthError(cause);
      return Response.json({ ok: false, error: error.toPublic() }, { status: error.status });
    }
  }
}

const request = (path, { body, cookie } = {}) => new Request(`https://worker.example${path}`, {
  method: body ? 'POST' : 'GET',
  headers: {
    Origin: 'https://admissionhub.pages.dev',
    'CF-Connecting-IP': '203.0.113.94',
    'User-Agent': 'Chrome',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {})
  },
  ...(body ? { body: JSON.stringify(body) } : {})
});

async function setup({ twoDevices = false } = {}) {
  let now = NOW;
  const SUBJECT = 'firebase-session-api-uid';
  const EMAIL = 'session.api@example.com';
  const REFRESH = `firebase-refresh-${'r'.repeat(32)}`;
  const ID_TOKEN = `firebase-id-${'i'.repeat(32)}`;
  const authRepository = new MemoryAuthRepository();
  const engine = new CloudflareNativeAuthEngine({ repository: authRepository, hmacSecret: SECRET, now: () => now });
  const context = { ip: '203.0.113.94', deviceId: 'device-session-api-1', userAgent: 'Chrome', origin: 'https://admissionhub.pages.dev' };
  const session = await engine.establishFirebaseSession({ email: EMAIL, subject: SUBJECT }, context);
  if (twoDevices) {
    await engine.establishFirebaseSession({ email: EMAIL, subject: SUBJECT }, { ...context, deviceId: 'device-session-api-2' });
  }
  const verification = new VerificationOrchestrator({
    repository: new MemoryVerificationRepository(),
    hmacSecret: SECRET,
    providers: [new OtpProvider(() => now)],
    activated: true,
    now: () => now,
    config: { enabled: true, providers: [{ id: 'otp-a', enabled: true, priority: 1, dailyQuota: 100 }] }
  });
  const firebaseFetch = async url => {
    const path = new URL(url).pathname;
    if (path.endsWith('/token')) return Response.json({ user_id: SUBJECT, id_token: ID_TOKEN, refresh_token: REFRESH, expires_in: '3600' });
    if (path.endsWith('/accounts:lookup')) return Response.json({ users: [{ localId: SUBJECT, email: EMAIL, emailVerified: true, disabled: false }] });
    return Response.json({ error: { message: 'NOT_FOUND' } }, { status: 404 });
  };
  const handler = createNativeAuthHandler({ fetchImpl: firebaseFetch });
  const env = {
    AUTH_AUTHORITY: new AuthorityNamespace(engine, verification, authRepository),
    FIREBASE_WEB_API_KEY: 'firebase-session-api-key-12345',
    VERIFICATION_AUTH_ACTIVATION: 'enabled'
  };
  const cookie = `__Host-ah_session=${session.sessionToken}; __Host-ah_firebase=${REFRESH}`;
  return { handler, env, cookie, session, engine, repository: authRepository };
}

test('POST /session/logout-all revokes every device session and clears cookies', async () => {
  const app = await setup({ twoDevices: true });
  const res = await app.handler(request(`${AUTH_API_PREFIX}/session/logout-all`, { body: {}, cookie: app.cookie }), app.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.authenticated, false);
  assert.equal(body.revoked, 2);
  const setCookie = res.headers.get('Set-Cookie') || '';
  assert.match(setCookie, /__Host-ah_session=;/);

  // second device session is dead too (probe through the engine directly)
  const sessions = [...app.repository.sessions.values()].filter(row => !row.revokedAt);
  assert.equal(sessions.length, 0);

  const audit = app.repository.events.filter(event => event.type === 'logout-all').length;
  assert.equal(audit, 1);
});

test('POST /session/logout-all requires a valid session', async () => {
  const app = await setup();
  const res = await app.handler(request(`${AUTH_API_PREFIX}/session/logout-all`, { body: {} }), app.env);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, AUTH_ERROR_CODES.SESSION_INVALID);
  // nothing revoked, no logout-all event
  assert.equal(app.repository.events.some(event => event.type === 'logout-all'), false);
});

test('GET /session tracks session-refreshed; other protected routes do not', async () => {
  const app = await setup();
  const refreshesBefore = () => app.repository.events.filter(event => event.type === 'session-refreshed').length;
  assert.equal(refreshesBefore(), 0);

  const sessionCheck = await app.handler(request(`${AUTH_API_PREFIX}/session`, { cookie: app.cookie }), app.env);
  assert.equal(sessionCheck.status, 200);
  assert.equal((await sessionCheck.json()).authenticated, true);
  assert.equal(refreshesBefore(), 1);

  const accountCheck = await app.handler(request(`${AUTH_API_PREFIX}/account`, { cookie: app.cookie }), app.env);
  assert.equal(accountCheck.status, 200);
  assert.equal(refreshesBefore(), 1);
});
