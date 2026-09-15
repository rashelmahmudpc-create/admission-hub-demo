import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SqliteAuthRepository } from './auth-native/storage/sqlite-auth-repository.mjs';
import { CloudflareNativeAuthEngine } from './auth-native/core/auth-engine.mjs';
import { asNativeAuthError, AUTH_ERROR_CODES, NativeAuthError } from './auth-native/core/errors.mjs';
import { MemoryAuthRepository } from './auth-native/testing/memory-auth-repository.mjs';
import {
  SECURITY_NOTIFICATION_EVENTS,
  dispatchSecurityNotifications,
  renderSecurityNotification
} from './auth-native/core/security-notifications.mjs';
import { AUTH_API_PREFIX, createNativeAuthHandler } from './auth-native/worker/public-auth-handler.mjs';

const SECRET = 'security-history-admin-secret-0123456789-ABCDEFGHIJKL';
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

const establish = (repository, userId, sessionRef, at = NOW, overrides = {}) => repository.establishExternalSession({
  provider: 'firebase',
  subjectRef: `subject-${userId}`,
  userIdCandidate: userId,
  emailRef: `email-ref-${userId}`,
  emailMask: 'u***@example.com',
  sessionRef,
  sessionExpiresAt: EXPIRY,
  ipRef: 'ip-ref',
  deviceRef: `device-${sessionRef}`,
  userAgent: 'chrome-140',
  now: at,
  ...overrides
});

test('history privacy: rows carry method/browser class/time only — no IP, location, email or raw device', async () => {
  const { repository } = sqliteRepository();
  await establish(repository, 'user-1', 's-1a');
  await establish(repository, 'user-1', 's-1b', NOW + 5000);
  const rows = repository.recentSecurityHistory({ userId: 'user-1', now: NOW + 10000, limit: 10 });
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ['active', 'at', 'browserClass', 'method', 'trusted'].sort());
    assert.equal(['passkey', 'credentials'].includes(row.method), true);
  }
  assert.equal(rows[0].at, NOW + 5000, 'newest first');
  const serialized = JSON.stringify(rows);
  assert.ok(!serialized.includes('ip-ref'), 'no IP ref leaks into the history row');
  assert.ok(!serialized.includes('device-s-'), 'no raw device ref leaks into the history row');
  assert.ok(!serialized.includes('@'), 'no email material in the history row');
});

test('history method mapping: passkey login and trusted-device fast path are distinguishable', async () => {
  const { database, repository } = sqliteRepository();
  const deviceOf = sessionRef => database.prepare('SELECT created_at AS createdAt, device_ref AS deviceRef FROM auth_sessions WHERE session_ref=?').get(sessionRef);
  const event = (type, userId, at, deviceRef) => database.prepare(
    "INSERT INTO auth_security_events(event_type,subject_ref,user_id,occurred_at,device_ref,purpose,policy_version) VALUES(?,?,?,?,?,NULL,NULL)"
  ).run(type, `subject-${userId}`, userId, at, deviceRef);

  await establish(repository, 'user-1', 's-pk');
  event('firebase-passkey-login', 'user-1', deviceOf('s-pk').createdAt, deviceOf('s-pk').deviceRef);
  await establish(repository, 'user-1', 's-trusted', NOW + 5000);
  event('login-trusted-device', 'user-1', deviceOf('s-trusted').createdAt, deviceOf('s-trusted').deviceRef);

  const rows = repository.recentSecurityHistory({ userId: 'user-1', now: NOW + 10000, limit: 10 });
  assert.deepEqual(rows.map(row => row.method), ['credentials', 'passkey']);
  assert.equal(rows.find(row => row.method === 'credentials').trusted, true);
  assert.equal(rows.find(row => row.method === 'passkey').trusted, false);
});

test('admin health: event counts inside the window (failed logins, challenges, revocations)', async () => {
  const { database, repository } = sqliteRepository();
  const count = (type, userId, at) => database.prepare(
    "INSERT INTO auth_security_events(event_type,subject_ref,user_id,occurred_at,device_ref,purpose,policy_version) VALUES(?,?,?,?,NULL,NULL,NULL)"
  ).run(type, 'subject-x', userId, at);
  count('login-failed', null, NOW - 1000);
  count('login-failed', null, NOW - 2000);
  count('security-challenge-created', 'user-1', NOW - 1500);
  count('security-challenge-verified', 'user-1', NOW - 1400);
  count('security-challenge-failed', 'user-1', NOW - 1300);
  count('new-device-challenge-completed', 'user-1', NOW - 1200);
  count('device-revoked', 'user-1', NOW - 1100);
  count('account-sessions-revoked', 'user-1', NOW - 1000);
  count('login-failed', null, NOW - 60 * 60 * 1000);

  const counts = repository.securityEventCounts({ now: NOW, windowMs: 15 * 60 * 1000 });
  assert.deepEqual(counts, {
    failedLogins: 2,
    challengesCreated: 1,
    challengesVerified: 1,
    challengesFailed: 1,
    newDeviceLogins: 1,
    devicesRevoked: 1,
    sessionsRevoked: 1
  });
});

test('admin events page: paged, newest first, refs only (no PII column can appear)', async () => {
  const { database, repository } = sqliteRepository();
  const insert = (type, userId, at) => database.prepare(
    "INSERT INTO auth_security_events(event_type,subject_ref,user_id,occurred_at,device_ref,purpose,policy_version) VALUES(?,?,?,?,?,?,'v6')"
  ).run(type, `subject-ref-${type}`, userId, at, `device-ref-${type}`, null);
  for (let i = 0; i < 5; i += 1) insert('login-failed', null, NOW - i * 1000);

  const page1 = repository.listSecurityEvents({ limit: 2, before: null });
  assert.equal(page1.entries.length, 2);
  assert.ok(page1.entries[0].occurredAt > page1.entries[1].occurredAt);
  const page2 = repository.listSecurityEvents({ limit: 2, before: page1.entries[1].occurredAt });
  assert.equal(page2.entries.length, 2);
  assert.notEqual(page2.entries[0].occurredAt, page1.entries[0].occurredAt, 'cursor does not repeat rows');
  for (const entry of [...page1.entries, ...page2.entries]) {
    assert.deepEqual(Object.keys(entry).sort(), ['deviceRef', 'eventType', 'occurredAt', 'policyVersion', 'purpose', 'subjectRef', 'userId'].sort());
    assert.ok(!String(entry.subjectRef).includes('@'), 'subject is a ref, never an email');
  }
});

// ---- notification boundary ----

test('notification catalog: all seven events render with masked email only', () => {
  assert.equal(Object.keys(SECURITY_NOTIFICATION_EVENTS).length, 7);
  for (const eventType of Object.keys(SECURITY_NOTIFICATION_EVENTS)) {
    const rendered = renderSecurityNotification({ eventType, emailMasked: 's***@example.com', at: NOW });
    assert.equal(rendered.eventType, eventType);
    assert.match(rendered.template, /^security-/);
    assert.ok(rendered.subject.length > 0);
    assert.ok(rendered.body.length > 0);
    assert.equal(rendered.emailMasked, 's***@example.com');
  }
  // Raw email fails closed; unknown events render nothing.
  assert.throws(() => renderSecurityNotification({ eventType: 'suspicious-activity', emailMasked: 'full@example.com', email: 'full@example.com' }));
  assert.equal(renderSecurityNotification({ eventType: 'not-an-event', emailMasked: 's***@example.com' }), null);
});

test('notification dispatch: dry-run never sends; live sends; missing sender is reported, not fatal', async () => {
  const events = [{ eventType: 'new-device-login', emailMasked: 's***@example.com', at: NOW }];
  const dry = await dispatchSecurityNotifications({ events, dryRun: true, sendSecurityEmail: async () => { throw new Error('must not be called'); } });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.requested, 1);
  assert.deepEqual(dry.sent, []);

  const live = await dispatchSecurityNotifications({ events, dryRun: false, sendSecurityEmail: async item => ({ ok: true, template: item.template }) });
  assert.equal(live.dryRun, false);
  assert.deepEqual(live.sent, [{ template: 'security-new-device-login', ok: true }]);

  const noSender = await dispatchSecurityNotifications({ events, dryRun: false });
  assert.deepEqual(noSender.sent, [{ template: 'security-new-device-login', ok: false, reason: 'sender-not-configured' }]);

  const pii = await dispatchSecurityNotifications({
    events: [{ eventType: 'suspicious-activity', emailMasked: 'full@example.com', email: 'full@example.com' }],
    dryRun: false
  });
  assert.equal(pii.skipped, 1, 'a PII contract break is skipped, never forwarded');
});

// ---- engine + handler (memory) ----

class AuthorityNamespace {
  constructor(engine, repository) {
    this.engine = engine;
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
      if (path === '/internal/security/state') return Response.json({ ok: true, result: await this.engine.getSecurityState(body.input, body.context) });
      if (path === '/internal/security/history') return Response.json({ ok: true, result: await this.engine.securityHistory(body.input, body.context) });
      if (path === '/internal/security/device/revoke') return Response.json({ ok: true, result: await this.engine.revokeTrustedDevice(body.input, body.context) });
      if (path === '/internal/security/challenge/request') return Response.json({ ok: true, result: await this.engine.requestChallenge(body.input, body.context) });
      if (path === '/internal/security/challenge/verify') return Response.json({ ok: true, result: await this.engine.verifyChallenge(body.input, body.context) });
      if (path === '/internal/security/device/trust') return Response.json({ ok: true, result: await this.engine.trustCurrentDevice(body.input, body.context) });
      if (path === '/internal/admin/security/health') return Response.json({ ok: true, result: await this.engine.securityHealth() });
      if (path === '/internal/admin/security/events') return Response.json({ ok: true, result: await this.engine.securityEventsPage(body.input || {}) });
      return Response.json({ ok: false, error: { code: 'NOT_FOUND' } }, { status: 404 });
    } catch (cause) {
      const error = asNativeAuthError(cause);
      return Response.json({ ok: false, error: error.toPublic() }, { status: error.status });
    }
  }
}

const handlerRequest = (path, { body, cookie, headers = {} } = {}) => new Request(`https://worker.example${path}`, {
  method: body ? 'POST' : 'GET',
  headers: {
    Origin: 'https://admissionhub.pages.dev',
    'CF-Connecting-IP': '203.0.113.94',
    'User-Agent': UA,
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
    ...headers
  },
  ...(body ? { body: JSON.stringify(body) } : {})
});

const EMAIL = 'history.admin@example.com';
const SUBJECT = 'firebase-history-admin-uid';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

async function handlerApp() {
  let now = NOW;
  const REFRESH = `firebase-refresh-${'r'.repeat(32)}`;
  const ID_TOKEN = `firebase-id-${'i'.repeat(32)}`;
  const repository = new MemoryAuthRepository();
  const engine = new CloudflareNativeAuthEngine({ repository, hmacSecret: SECRET, now: () => now });
  const context = { ip: '203.0.113.94', deviceId: 'device-history-admin-01', userAgent: UA, origin: 'https://admissionhub.pages.dev' };
  const session = await engine.establishFirebaseSession({ email: EMAIL, subject: SUBJECT }, context);
  const firebaseFetch = async url => {
    const path = new URL(url).pathname;
    if (path.endsWith('/token')) return Response.json({ user_id: SUBJECT, id_token: ID_TOKEN, refresh_token: REFRESH, expires_in: '3600' });
    if (path.endsWith('/accounts:lookup')) return Response.json({ users: [{ localId: SUBJECT, email: EMAIL, emailVerified: true, disabled: false }] });
    return Response.json({ error: { message: 'NOT_FOUND' } }, { status: 404 });
  };
  const handler = createNativeAuthHandler({ fetchImpl: firebaseFetch });
  const env = {
    AUTH_AUTHORITY: new AuthorityNamespace(engine, repository),
    FIREBASE_WEB_API_KEY: 'firebase-history-admin-key-12345',
    ADMIN_TOKEN: 'admin-token-history-' + 't'.repeat(24)
  };
  const cookie = `__Host-ah_session=${session.sessionToken}; __Host-ah_firebase=${REFRESH}; __Host-ah_device=device-history-admin-0123456789`;
  return { handler, env, cookie, engine, repository, context, sessionToken: session.sessionToken, advance: ms => { now += ms; }, adminToken: env.ADMIN_TOKEN };
}

// Minimal orchestrator double for the step-up challenge flow.
class TestOrchestrator {
  constructor(now) { this.now = now; this.code = '123456'; this.attemptId = 'att' + 'z'.repeat(24); }
  async requestVerification() {
    return { accepted: true, attemptId: this.attemptId, expiresAt: this.now() + 900000, resendAfter: 60000, attemptsAllowed: 3 };
  }
  async verify({ code }) {
    if (code !== this.code) throw new NativeAuthError(AUTH_ERROR_CODES.OTP_INVALID);
    return Object.freeze({ verified: true, purpose: 'sensitive-action' });
  }
}

test('GET /security/history: session-bound, user-scoped, privacy-shaped', async () => {
  const app = await handlerApp();
  const anon = await app.handler(handlerRequest(`${AUTH_API_PREFIX}/security/history`), app.env);
  assert.equal(anon.status, 401);

  const res = await app.handler(handlerRequest(`${AUTH_API_PREFIX}/security/history`, { cookie: app.cookie }), app.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.entries.length, 1);
  assert.deepEqual(Object.keys(body.entries[0]).sort(), ['active', 'at', 'browserClass', 'method', 'trusted'].sort());
  assert.equal(body.entries[0].browserClass, 'Windows · Chrome', 'UA is coarse-classed, never raw');
});

test('GET /security/state: session-bound device + trust overview', async () => {
  const app = await handlerApp();
  const res = await app.handler(handlerRequest(`${AUTH_API_PREFIX}/security/state`, { cookie: app.cookie }), app.env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.accountStatus, 'string');
  assert.equal(body.currentDeviceTrusted, false);
  assert.equal(body.devices.length, 0);
});

test('POST /security/devices/revoke: recent low-risk passes; aged session demands step-up, then the token revokes once', async () => {
  const app = await handlerApp();
  // Recent + low risk: the gate passes (nothing trusted yet, so revoked: 0).
  const first = await app.handler(handlerRequest(`${AUTH_API_PREFIX}/security/devices/revoke`, { body: { scope: 'current' }, cookie: app.cookie }), app.env);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).revoked, 0);

  const trustRes = await app.handler(handlerRequest(`${AUTH_API_PREFIX}/security/device/trust`, { body: {}, cookie: app.cookie }), app.env);
  assert.equal(trustRes.status, 200);
  assert.equal((await trustRes.json()).trusted, true);
  app.advance(6 * 60 * 1000);

  const aged = await app.handler(handlerRequest(`${AUTH_API_PREFIX}/security/devices/revoke`, { body: { scope: 'current' }, cookie: app.cookie }), app.env);
  assert.equal(aged.status, 409);
  assert.equal((await aged.json()).error.code, AUTH_ERROR_CODES.STEP_UP_REQUIRED);

  const garbage = await app.handler(handlerRequest(`${AUTH_API_PREFIX}/security/devices/revoke`, { body: { scope: 'current', stepUpToken: 'x'.repeat(64) }, cookie: app.cookie }), app.env);
  assert.equal(garbage.status, 409);
  assert.equal((await garbage.json()).error.code, AUTH_ERROR_CODES.CHALLENGE_INVALID);
  assert.equal(app.repository.snapshot().trustedDevices.length, 1, 'nothing revoked without a valid challenge');

  // Complete a step-up challenge (through the same handler/device path as
  // the revocation), then retry with the one-time token.
  const orchestrator = new TestOrchestrator(() => NOW + 6 * 60 * 1000);
  app.engine.bindVerification(orchestrator);
  const challengeRes = await app.handler(handlerRequest(`${AUTH_API_PREFIX}/security/challenge/request`, { body: { purpose: 'step-up', method: 'email' }, cookie: app.cookie }), app.env);
  assert.equal(challengeRes.status, 200);
  const challenge = await challengeRes.json();
  const verifyRes = await app.handler(handlerRequest(`${AUTH_API_PREFIX}/security/challenge/verify`, { body: { challengeRef: challenge.challengeRef, purpose: 'step-up', code: orchestrator.code }, cookie: app.cookie }), app.env);
  assert.equal(verifyRes.status, 200);
  const verified = await verifyRes.json();
  const done = await app.handler(handlerRequest(`${AUTH_API_PREFIX}/security/devices/revoke`, { body: { scope: 'current', stepUpToken: verified.stepUpToken }, cookie: app.cookie }), app.env);
  assert.equal(done.status, 200);
  assert.equal((await done.json()).revoked, 1);
  const stillTrusted = app.repository.snapshot().trustedDevices.filter(row => !row.revokedAt && row.expiresAt > NOW + 6 * 60 * 1000);
  assert.equal(stillTrusted.length, 0, 'the trusted device is gone after the step-up revoke');

  // The token is single-use: a second revoke with the same token fails.
  const reTrust = await app.handler(handlerRequest(`${AUTH_API_PREFIX}/security/device/trust`, { body: {}, cookie: app.cookie }), app.env);
  assert.equal(reTrust.status, 200);
  const replay = await app.handler(handlerRequest(`${AUTH_API_PREFIX}/security/devices/revoke`, { body: { scope: 'current', stepUpToken: verified.stepUpToken }, cookie: app.cookie }), app.env);
  assert.equal(replay.status, 409);
  assert.equal((await replay.json()).error.code, AUTH_ERROR_CODES.CHALLENGE_INVALID);
});

test('admin security endpoints: token-gated, refs only, no PII in the response', async () => {
  const app = await handlerApp();
  await app.engine.recordLoginFailure({ email: EMAIL }, app.context);

  const noToken = await app.handler(handlerRequest(`${AUTH_API_PREFIX}/admin/security/health`), app.env);
  assert.equal(noToken.status, 403);
  const wrongToken = await app.handler(handlerRequest(`${AUTH_API_PREFIX}/admin/security/health`, { headers: { 'X-AH-Admin-Token': 'wrong-token-' + 'w'.repeat(24) } }), app.env);
  assert.equal(wrongToken.status, 403);

  const health = await app.handler(handlerRequest(`${AUTH_API_PREFIX}/admin/security/health`, { headers: { 'X-AH-Admin-Token': app.adminToken } }), app.env);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.result.failedLogins >= 1, true);
  assert.equal(healthBody.result.windowMs, 15 * 60 * 1000);

  const events = await app.handler(handlerRequest(`${AUTH_API_PREFIX}/admin/security/events?limit=10`, { headers: { 'X-AH-Admin-Token': app.adminToken } }), app.env);
  assert.equal(events.status, 200);
  const eventsBody = await events.json();
  assert.ok(eventsBody.entries.length >= 1);
  const serialized = JSON.stringify(eventsBody);
  assert.ok(!serialized.includes(EMAIL), 'no raw email in the admin ledger response');
  assert.ok(!serialized.includes('203.0.113.94'), 'no raw IP in the admin ledger response');
});
