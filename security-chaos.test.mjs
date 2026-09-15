import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SqliteAuthRepository } from './auth-native/storage/sqlite-auth-repository.mjs';
import {
  CloudflareNativeAuthEngine,
  ACCOUNT_VERIFICATION_TICKET_TTL_MS
} from './auth-native/core/auth-engine.mjs';
import { AUTH_ERROR_CODES, NativeAuthError } from './auth-native/core/errors.mjs';
import { MemoryAuthRepository } from './auth-native/testing/memory-auth-repository.mjs';
import { SECURITY_CONFIG } from './auth-native/core/security-config.mjs';

const SECRET = 'security-chaos-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUV';
const START = 1_800_000_000_000;

function makeSqlite() {
  let now = START;
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
  const engine = new CloudflareNativeAuthEngine({ repository, hmacSecret: SECRET, now: () => now });
  const context = { ip: '198.51.100.7', deviceId: 'device-chaos-a-0123456789ab', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140' };
  return { database, repository, engine, context, now: () => now, advance: ms => { now += ms; } };
}

function makeMemory() {
  let now = START;
  const repository = new MemoryAuthRepository();
  const engine = new CloudflareNativeAuthEngine({ repository, hmacSecret: SECRET, now: () => now });
  const context = { ip: '198.51.100.9', deviceId: 'device-chaos-b-0123456789ab', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140' };
  const orchestrator = {
    attempts: new Map(),
    requestVerification: async input => {
      const attemptId = `att-${orchestrator.attempts.size + 1}-${'q'.repeat(16)}`;
      const code = String(100000 + ((orchestrator.attempts.size * 7919) % 900000)).padStart(6, '0');
      orchestrator.attempts.set(attemptId, { code, userId: input.userId });
      return { accepted: true, attemptId, expiresAt: now + SECURITY_CONFIG.challengeTtlMs, resendAfter: 60000, attemptsAllowed: 3 };
    },
    verify: async ({ attemptId, code, userId }) => {
      const entry = orchestrator.attempts.get(attemptId);
      if (!entry || entry.userId !== userId || entry.code !== code) throw new NativeAuthError(AUTH_ERROR_CODES.OTP_INVALID);
      return Object.freeze({ verified: true, purpose: 'sensitive-action' });
    }
  };
  engine.bindVerification(orchestrator);
  return { repository, engine, context, orchestrator, now: () => now, advance: ms => { now += ms; } };
}

const challengeLogin = (engine, email, subject, context) => engine.establishFirebaseSession(
  { email, subject, remember: true, verified: true, newDevice: true, securityChallenge: true }, context
);
const plainLogin = (engine, email, subject, context) => engine.establishFirebaseSession(
  { email, subject, remember: true, verified: true, newDevice: true, securityChallenge: false }, context
);

test('chaos: stolen credentials + new device -> challenge; the trusted device fast path stays intact', async () => {
  const state = makeMemory();
  const { email, subject } = { email: 'victim@example.com', subject: 'sub-victim-1' };
  // Legitimate user already established trust on their device.
  const legit = await plainLogin(state.engine, email, subject, state.context);
  await state.engine.trustCurrentDevice({ sessionToken: legit.sessionToken, email, subject }, state.context);

  // Attacker reuses the credentials on a fresh device: challenged, no session.
  const attacker = { ...state.context, deviceId: 'device-attacker-0123456789ab' };
  const attacked = await challengeLogin(state.engine, email, subject, attacker);
  assert.equal(attacked.challenge?.type, 'new-device');
  assert.equal(attacked.sessionToken, undefined);
  const openSessions = [...state.repository.sessions.values()].filter(row => !row.revokedAt);
  assert.equal(openSessions.length, 1, 'the attacker gets no session');

  // The victim's trusted device still logs in without a challenge.
  const again = await challengeLogin(state.engine, email, subject, state.context);
  assert.equal(again.challenge, undefined);
  assert.equal(again.security.trusted, true);
});

test('chaos: repeated failures escalate the cooldown but never lock the account out permanently', async () => {
  const state = makeMemory();
  const { email, subject } = { email: 'cooldown@example.com', subject: 'sub-cooldown-1' };
  const config = SECURITY_CONFIG;
  // Below the threshold: no cooldown yet.
  for (let i = 0; i < config.cooldownThresholdFailures - 1; i += 1) {
    assert.equal((await state.engine.recordLoginFailure({ email }, state.context)).retryAfter, undefined);
  }
  // 5th failure arms the first step (5 min).
  const fifth = await state.engine.recordLoginFailure({ email }, state.context);
  assert.equal(fifth.retryAfter > 0, true);
  assert.ok(fifth.retryAfter <= 300);
  // 6th escalates to 15 min, 8th hits the 60 min ceiling.
  const sixth = await state.engine.recordLoginFailure({ email }, state.context);
  assert.ok(sixth.retryAfter <= 900 && sixth.retryAfter > 300);
  await state.engine.recordLoginFailure({ email }, state.context);
  const eighth = await state.engine.recordLoginFailure({ email }, state.context);
  assert.ok(eighth.retryAfter <= 3600);

  // Window roll-over: after the failure window elapses, login works again
  // (delay, never a permanent lockout).
  state.advance(config.failedLoginWindowMs + 1000);
  const relogin = await plainLogin(state.engine, email, subject, state.context);
  assert.equal(typeof relogin.sessionToken, 'string', 'after the window rolls over, login works again');
  assert.ok(relogin.sessionToken.length >= 40);
});

test('chaos: recovery ticket abuse — expired, invalid and double-completed tickets all fail closed', async () => {
  const state = makeMemory();
  const { email, subject } = { email: 'recovery@example.com', subject: 'sub-recovery-1' };
  const refreshToken = `refresh-${'r'.repeat(40)}`;
  const begin = () => state.engine.beginFirebaseAccountVerification({ email, subject, refreshToken }, state.context);

  const { verificationTicket } = await begin();
  // Expired ticket.
  state.advance(ACCOUNT_VERIFICATION_TICKET_TTL_MS + 1000);
  await assert.rejects(
    () => state.engine.completeFirebaseAccountVerification({ verificationTicket, email, subject }, state.context),
    error => error.code === AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID
  );
  // Garbage ticket.
  state.advance(1000);
  const fresh = await begin();
  await assert.rejects(
    () => state.engine.completeFirebaseAccountVerification({ verificationTicket: 'x'.repeat(48), email, subject }, state.context),
    error => error.code === AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID
  );
  // Double completion: the first succeeds, the second is dead.
  const first = await state.engine.completeFirebaseAccountVerification({ verificationTicket: fresh.verificationTicket, email, subject }, state.context);
  assert.equal(typeof first.sessionToken, 'string', 'the first completion succeeds');
  await assert.rejects(
    () => state.engine.completeFirebaseAccountVerification({ verificationTicket: fresh.verificationTicket, email, subject }, state.context),
    error => error.code === AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID
  );
});

test('chaos: identity-linking abuse — one email cannot be re-linked to a foreign Firebase subject', async () => {
  const state = makeSqlite();
  const email = 'linkabuse@example.com';
  await state.repository.establishExternalSession({
    provider: 'firebase', subjectRef: 'subject-ref-legit', userIdCandidate: 'usr-link-1',
    emailRef: 'email-ref-link-1', emailMask: 'l***@example.com', sessionRef: 'sess-link-1',
    sessionExpiresAt: state.now() + 86400000, ipRef: 'ip-ref', deviceRef: 'device-link-1',
    userAgent: 'Chrome', now: state.now()
  });
  // A different subject presenting the same email must collide, not merge.
  const hijack = await state.repository.establishExternalSession({
    provider: 'firebase', subjectRef: 'subject-ref-attacker', userIdCandidate: 'usr-attacker-1',
    emailRef: 'email-ref-link-1', emailMask: 'l***@example.com', sessionRef: 'sess-attacker-1',
    sessionExpiresAt: state.now() + 86400000, ipRef: 'ip-ref', deviceRef: 'device-attacker-1',
    userAgent: 'Chrome', now: state.now() + 1000
  });
  assert.equal(hijack.error, AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
  const users = state.database.prepare('SELECT count(*) AS n FROM auth_users').get();
  assert.equal(users.n, 1, 'no second account was minted');
  const conflict = state.database.prepare("SELECT count(*) AS n FROM auth_security_events WHERE event_type='firebase-identity-conflict'").get();
  assert.equal(conflict.n, 1, 'the collision is audited');
});

test('chaos: session/security mismatch — a suspended account loses its sessions immediately', async () => {
  const state = makeSqlite();
  const { engine, repository, context, database } = state;
  const { email, subject } = { email: 'suspend@example.com', subject: 'sub-suspend-1' };
  const session = await plainLogin(engine, email, subject, context);
  await assert.doesNotReject(() => engine.getFirebaseSession(session.sessionToken, { email, subject }));

  const { AuthHmac } = await import('./auth-native/core/crypto.mjs');
  const hmac = new AuthHmac(SECRET);
  const [subjectRef, emailRef] = await Promise.all([
    hmac.hex('firebase-subject-v1', subject),
    hmac.hex('email-ref-v1', email.toLowerCase())
  ]);
  const identity = await repository.getFirebaseIdentity({ subjectRef, emailRef });
  assert.equal(identity.error, undefined, 'sanity: identity resolves');
  await repository.setAccountState({ userId: identity.user.id, toStatus: 'suspended', now: state.now() });
  // Suspension revokes the live sessions (defence in depth at the store).
  await assert.rejects(
    () => engine.getFirebaseSession(session.sessionToken, { email, subject }),
    error => [AUTH_ERROR_CODES.SESSION_INVALID, AUTH_ERROR_CODES.ACCOUNT_DISABLED].includes(error.code)
  );
  // And the risk decision blocks any re-login: suspended is an authoritative
  // CRITICAL fact, not a behavioural signal.
  await assert.rejects(
    () => plainLogin(engine, email, subject, context),
    error => error.code === AUTH_ERROR_CODES.ACCOUNT_DISABLED
  );
  const sessionsLeft = database.prepare('SELECT count(*) AS n FROM auth_sessions WHERE revoked_at IS NULL').get();
  assert.equal(sessionsLeft.n, 0, 'no live session survives a suspension');
});

test('chaos: risk service unavailable -> fail-safe challenge, never a silent proceed', async () => {
  const state = makeMemory();
  const { email, subject } = { email: 'failsafe@example.com', subject: 'sub-failsafe-1' };
  const real = state.repository.getLoginRiskSignals;
  state.repository.getLoginRiskSignals = async () => { throw new Error('risk service timeout'); };
  try {
    const decision = await challengeLogin(state.engine, email, subject, state.context);
    assert.equal(decision.challenge?.type, 'new-device', 'fail-safe demands a challenge');
    assert.equal(decision.challenge?.level, 'ELEVATED');
    assert.equal(decision.sessionToken, undefined, 'no session without the challenge');
    assert.equal(state.repository.snapshot().sessions.length, 0, 'fail-safe: nothing was provisioned');
  } finally {
    state.repository.getLoginRiskSignals = real;
  }
});

test('chaos: duplicate challenges — two challenges stay independent, one code unlocks only its own', async () => {
  const state = makeMemory();
  const { email, subject } = { email: 'dupe@example.com', subject: 'sub-dupe-1' };
  const session = await plainLogin(state.engine, email, subject, state.context);
  const [first, second] = await Promise.all([
    state.engine.requestChallenge({ sessionToken: session.sessionToken, email, subject, purpose: 'step-up' }, state.context),
    state.engine.requestChallenge({ sessionToken: session.sessionToken, email, subject, purpose: 'step-up' }, state.context)
  ]);
  assert.notEqual(first.challengeRef, second.challengeRef);
  const firstCode = state.orchestrator.attempts.get(first.attemptId).code;
  // The first code does NOT open the second challenge.
  await assert.rejects(
    () => state.engine.verifyChallenge({ sessionToken: session.sessionToken, email, subject, challengeRef: second.challengeRef, purpose: 'step-up', code: firstCode }, state.context),
    error => error.code === AUTH_ERROR_CODES.OTP_INVALID
  );
  // Its own code still works on its own challenge.
  const verified = await state.engine.verifyChallenge({ sessionToken: session.sessionToken, email, subject, challengeRef: first.challengeRef, purpose: 'step-up', code: firstCode }, state.context);
  assert.equal(verified.verified, true);
});

test('chaos: concurrent verification of one challenge — exactly one winner, no double spend', async () => {
  const state = makeSqlite();
  const { engine, repository, context } = state;
  const { email, subject } = { email: 'concurrent@example.com', subject: 'sub-concurrent-1' };
  const session = await plainLogin(engine, email, subject, context);
  // Bind a delivery double through the sqlite engine.
  const attempts = new Map();
  const orchestrator = {
    requestVerification: async input => {
      const attemptId = `att-${'c'.repeat(24)}`;
      attempts.set(attemptId, { code: '424242', userId: input.userId });
      return { accepted: true, attemptId, expiresAt: state.now() + 900000, resendAfter: 60000, attemptsAllowed: 3 };
    },
    verify: async ({ attemptId, code, userId }) => {
      const entry = attempts.get(attemptId);
      if (!entry || entry.userId !== userId || entry.code !== code) throw new NativeAuthError(AUTH_ERROR_CODES.OTP_INVALID);
      return Object.freeze({ verified: true, purpose: 'sensitive-action' });
    }
  };
  engine.bindVerification(orchestrator);
  const challenge = await engine.requestChallenge({ sessionToken: session.sessionToken, email, subject, purpose: 'step-up' }, context);
  const results = await Promise.allSettled([
    engine.verifyChallenge({ sessionToken: session.sessionToken, email, subject, challengeRef: challenge.challengeRef, purpose: 'step-up', code: '424242' }, context),
    engine.verifyChallenge({ sessionToken: session.sessionToken, email, subject, challengeRef: challenge.challengeRef, purpose: 'step-up', code: '424242' }, context)
  ]);
  const wins = results.filter(result => result.status === 'fulfilled');
  const losses = results.filter(result => result.status === 'rejected');
  assert.equal(wins.length, 1, 'exactly one concurrent verify wins');
  assert.equal(losses.length, 1);
  assert.equal(losses[0].reason.code, AUTH_ERROR_CODES.CHALLENGE_INVALID);
  const row = repository.getSecurityChallenge({ challengeRef: challenge.challengeRef, userId: session.user.id, now: state.now() });
  assert.equal(row.status, 'verified');
});

test('chaos: concurrent logins on the same device — identity stays consistent, both sessions are usable', async () => {
  const state = makeSqlite();
  const { engine, repository, database, context } = state;
  const { email, subject } = { email: 'races@example.com', subject: 'sub-races-1' };
  const [a, b] = await Promise.all([
    plainLogin(engine, email, subject, context),
    plainLogin(engine, email, subject, context)
  ]);
  const users = database.prepare('SELECT count(*) AS n FROM auth_users').get();
  const identities = database.prepare('SELECT count(*) AS n FROM auth_external_identities').get();
  assert.equal(users.n, 1, 'one account, not two');
  assert.equal(identities.n, 1, 'one firebase link, not two');
  assert.equal(a.user.id, b.user.id);
  assert.notEqual(a.sessionToken, b.sessionToken);
  for (const token of [a.sessionToken, b.sessionToken]) {
    await assert.doesNotReject(() => engine.getFirebaseSession(token, { email, subject }));
  }
});

test('chaos: storage timeout mid-login — no session, no partial identity, clean error', async () => {
  const state = makeSqlite();
  const { engine, database } = state;
  const { email, subject } = { email: 'timeout@example.com', subject: 'sub-timeout-1' };
  // Simulate a busy DB: the login write fails midway.
  const originalEstablish = state.repository.establishExternalSession.bind(state.repository);
  state.repository.establishExternalSession = async () => {
    throw new Error('SQLITE_BUSY: database is locked');
  };
  try {
    await assert.rejects(() => plainLogin(engine, email, subject, state.context), error => error.message.includes('SQLITE_BUSY'));
    const users = database.prepare('SELECT count(*) AS n FROM auth_users').get();
    const sessions = database.prepare('SELECT count(*) AS n FROM auth_sessions').get();
    assert.equal(users.n, 0, 'no partial user row');
    assert.equal(sessions.n, 0, 'no partial session row');
  } finally {
    state.repository.establishExternalSession = originalEstablish;
  }
});

test('chaos: step-up token is user-scoped — user A\'s token cannot unlock user B', async () => {
  const state = makeMemory();
  const ctxA = state.context;
  const ctxB = { ...state.context, ip: '203.0.113.66', deviceId: 'device-chaos-c-0123456789ab' };
  const A = { email: 'user-a@example.com', subject: 'sub-user-a' };
  const B = { email: 'user-b@example.com', subject: 'sub-user-b' };
  const sessionA = await plainLogin(state.engine, A.email, A.subject, ctxA);
  const sessionB = await plainLogin(state.engine, B.email, B.subject, ctxB);
  // Both sessions age out.
  state.advance(SECURITY_CONFIG.stepUpRecentSessionMs + 60 * 1000);
  // A completes a step-up challenge and receives a token.
  const challenge = await state.engine.requestChallenge({ sessionToken: sessionA.sessionToken, email: A.email, subject: A.subject, purpose: 'step-up' }, ctxA);
  const verified = await state.engine.verifyChallenge({
    sessionToken: sessionA.sessionToken, email: A.email, subject: A.subject,
    challengeRef: challenge.challengeRef, purpose: 'step-up',
    code: state.orchestrator.attempts.get(challenge.attemptId).code
  }, ctxA);
  // B tries to reuse A's token: rejected, and B's sessions survive.
  await assert.rejects(
    () => state.engine.revokeAllSessions({ sessionToken: sessionB.sessionToken, email: B.email, subject: B.subject, stepUpToken: verified.stepUpToken }, ctxB),
    error => error.code === AUTH_ERROR_CODES.CHALLENGE_INVALID
  );
  const bSessions = [...state.repository.sessions.values()].filter(row => row.userId === sessionB.user.id && !row.revokedAt);
  assert.equal(bSessions.length, 1, 'B was not touched by A\'s token');
});

test('chaos: trust LRU eviction — the evicted device keeps its live session but is challenged on the next login', async () => {
  const state = makeMemory();
  const { email, subject } = { email: 'lru@example.com', subject: 'sub-lru-1' };
  const base = state.context;
  const { AuthHmac } = await import('./auth-native/core/crypto.mjs');
  const hmac = new AuthHmac(SECRET);
  const sessions = [];
  for (let i = 0; i < SECURITY_CONFIG.trustMaxDevicesPerUser + 1; i += 1) {
    const ctx = { ...base, deviceId: `device-lru-${String(i).padStart(2, '0')}-0123456` };
    const session = await plainLogin(state.engine, email, subject, ctx);
    await state.engine.trustCurrentDevice({ sessionToken: session.sessionToken, email, subject }, ctx);
    sessions.push({ ctx, session });
  }
  const userId = sessions.at(-1).session.user.id;
  const stateView = await state.engine.getSecurityState({ sessionToken: sessions.at(-1).session.sessionToken, email, subject }, sessions.at(-1).ctx);
  assert.equal(stateView.devices.length, SECURITY_CONFIG.trustMaxDevicesPerUser, 'one device was evicted');
  // Identify the single evicted device.
  const refs = await Promise.all(sessions.map(async entry => hmac.hex('device-ref-v1', entry.ctx.deviceId)));
  const evicted = sessions[refs.findIndex(ref => !stateView.devices.some(row => row.deviceRef === ref))];
  assert.ok(evicted, 'exactly the evicted device is missing from the trust list');
  const untrustedCount = (await Promise.all(refs.map(async ref => {
    const check = await state.repository.isDeviceTrusted({ userId, deviceRef: ref, now: state.now() });
    return check.trusted === false;
  }))).filter(Boolean).length;
  assert.equal(untrustedCount, 1, 'exactly one device lost its trust');
  // The evicted device's existing session still works (session != trust).
  await assert.doesNotReject(() => state.engine.getFirebaseSession(evicted.session.sessionToken, { email, subject }));
  // But its next login is challenged again.
  const evictedAgain = await challengeLogin(state.engine, email, subject, evicted.ctx);
  assert.equal(evictedAgain.challenge?.type, 'new-device');
});

test('chaos: ledger retention — old events are purged by cleanup, recent ones survive', async () => {
  const state = makeSqlite();
  const { repository, database, advance } = state;
  const now = state.now();
  const insert = (type, userId, at) => database.prepare(
    "INSERT INTO auth_security_events(event_type,subject_ref,user_id,occurred_at,device_ref,purpose,policy_version) VALUES(?,?,?,?,NULL,NULL,NULL)"
  ).run(type, 'subject-ref-x', userId, at);
  insert('login-failed', null, now - 91 * 24 * 60 * 60 * 1000);
  insert('security-challenge-created', 'user-1', now - 91 * 24 * 60 * 60 * 1000 + 1000);
  insert('security-challenge-verified', 'user-1', now - 1000);

  repository.cleanup(now);
  const oldRows = database.prepare('SELECT count(*) AS n FROM auth_security_events WHERE occurred_at < ?').get(now - 90 * 24 * 60 * 60 * 1000);
  assert.equal(oldRows.n, 0, '91-day-old events are gone after cleanup');
  const recent = database.prepare('SELECT count(*) AS n FROM auth_security_events').get();
  assert.equal(recent.n, 1, 'the recent event survives');
});

test('chaos: a step-up token dies with its challenge — expiry closes the window', async () => {
  const state = makeMemory();
  const { email, subject } = { email: 'expiry@example.com', subject: 'sub-expiry-1' };
  const session = await plainLogin(state.engine, email, subject, state.context);
  const challenge = await state.engine.requestChallenge({ sessionToken: session.sessionToken, email, subject, purpose: 'step-up' }, state.context);
  const verified = await state.engine.verifyChallenge({
    sessionToken: session.sessionToken, email, subject,
    challengeRef: challenge.challengeRef, purpose: 'step-up',
    code: state.orchestrator.attempts.get(challenge.attemptId).code
  }, state.context);
  // The challenge (and with it the token) expires.
  state.advance(SECURITY_CONFIG.challengeTtlMs + 1000);
  state.advance(SECURITY_CONFIG.stepUpRecentSessionMs + 1000);
  await assert.rejects(
    () => state.engine.revokeAllSessions({
      sessionToken: session.sessionToken, email, subject, stepUpToken: verified.stepUpToken
    }, state.context),
    error => error.code === AUTH_ERROR_CODES.CHALLENGE_INVALID
  );
  // The account is intact: a fresh challenge still works.
  const next = await state.engine.requestChallenge({ sessionToken: session.sessionToken, email, subject, purpose: 'step-up' }, state.context);
  const reverified = await state.engine.verifyChallenge({
    sessionToken: session.sessionToken, email, subject,
    challengeRef: next.challengeRef, purpose: 'step-up',
    code: state.orchestrator.attempts.get(next.attemptId).code
  }, state.context);
  assert.equal(reverified.verified, true);
});
