import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SqliteAuthRepository } from './auth-native/storage/sqlite-auth-repository.mjs';
import { SqliteVerificationRepository } from './auth-native/verification/sqlite-verification-repository.mjs';
import { CloudflareNativeAuthEngine } from './auth-native/core/auth-engine.mjs';
import { VerificationOrchestrator } from './auth-native/verification/orchestrator.mjs';
import { VERIFICATION_CHANNELS, VERIFICATION_MODES } from './auth-native/verification/provider-contract.mjs';
import { AUTH_ERROR_CODES } from './auth-native/core/errors.mjs';

const SECRET = 'sqlite-runtime-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const START = 1_800_000_000_000;
const CONTEXT = Object.freeze({
  ip: '203.0.113.91',
  deviceId: 'device-sqlite-runtime-123456',
  userAgent: 'Chrome',
  origin: 'https://admissionhub.pages.dev'
});

function storageFixture() {
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
  return {
    database,
    storage: { sql, transactionSync(work) { return database.transaction(work)(); } }
  };
}

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
  async getRemainingQuota() { return { remaining: 10, limit: 10, resetAt: this.now() + 86_400_000 }; }
  async getProviderStatus() { return { status: 'healthy', configured: true }; }
  async sendVerification(input) { this.code = input.code; this.sends += 1; return { accepted: true }; }
  async verifyCode() { return { verified: false }; }
}

class TelegramProvider {
  constructor(now) {
    this.id = 'telegram';
    this.channel = VERIFICATION_CHANNELS.TELEGRAM;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.now = now;
    this.linkToken = '';
    this.preparedCode = '';
    this.code = '';
    this.codeSends = 0;
  }
  async checkAvailability() { return { available: true, code: 'READY' }; }
  async getRemainingQuota() { return { remaining: 10, limit: 10, resetAt: this.now() + 86_400_000 }; }
  async getProviderStatus() { return { status: 'healthy', configured: true }; }
  async sendVerification(input) {
    this.linkToken = input.linkToken;
    this.preparedCode = input.code;
    return { accepted: true, interaction: { type: 'telegram-link', url: `https://t.me/AdmissionHubVerifyBot?start=${input.linkToken}` } };
  }
  async sendTelegramCode(input) {
    this.code = input.code;
    this.codeSends += 1;
    return { accepted: true };
  }
  async verifyCode() { throw new Error('Telegram OTP must be verified locally.'); }
}

test('SQLite persists one guided profile per canonical Firebase user and enforces session ownership', async t => {
  const fixture = storageFixture();
  t.after(() => fixture.database.close());
  const repository = new SqliteAuthRepository(fixture.storage);
  repository.migrate();
  const now = START;
  const identity = {
    provider: 'firebase', subjectRef: 'profile-subject-ref', emailRef: 'profile-email-ref', emailMask: 'p***@example.com',
    userIdCandidate: 'usr_profile_sqlite', sessionRef: 'profile-session-one', sessionExpiresAt: now + 600_000,
    ipRef: 'ip-ref', deviceRef: 'device-ref', userAgent: 'Safari', now
  };
  assert.equal((await repository.establishExternalSession(identity)).established, true);
  const profile = {
    version: 1,
    fullName: 'Profile Student',
    dob: '2007-05-12',
    school: { id: 's-cox-govt-high', name: 'Cox’s Bazar Government High School', district: 'Cox’s Bazar' },
    higherInstitution: { id: 'h-du', name: 'University of Dhaka', district: 'Dhaka' }
  };
  const saved = await repository.saveProfile({
    sessionRef: identity.sessionRef, subjectRef: identity.subjectRef, emailRef: identity.emailRef,
    profile, now: now + 1
  });
  assert.equal(saved.saved, true);
  assert.equal(saved.profile.fullName, profile.fullName);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM auth_profiles').get().count, 1);

  const second = { ...identity, userIdCandidate: 'must-not-create-a-second-user', sessionRef: 'profile-session-two', now: now + 2 };
  assert.equal((await repository.establishExternalSession(second)).created, false);
  const loaded = await repository.getProfile({
    sessionRef: second.sessionRef, subjectRef: identity.subjectRef, emailRef: identity.emailRef, now: now + 3
  });
  assert.equal(loaded.profile.school.id, profile.school.id);
  assert.equal(loaded.profile.higherInstitution.id, profile.higherInstitution.id);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM auth_users').get().count, 1);

  const denied = await repository.getProfile({
    sessionRef: second.sessionRef, subjectRef: 'other-subject-ref', emailRef: identity.emailRef, now: now + 4
  });
  assert.equal(denied.error, AUTH_ERROR_CODES.SESSION_INVALID);
});

test('SQLite schema 5 executes complete Passkey repository lifecycle with valid placeholders', async t => {
  const fixture = storageFixture();
  t.after(() => fixture.database.close());
  fixture.database.exec('CREATE TABLE auth_challenges(challenge_id TEXT PRIMARY KEY)');
  const repository = new SqliteAuthRepository(fixture.storage);
  repository.migrate();
  assert.equal(fixture.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_challenges'").get(), undefined);
  const now = START;
  const base = {
    provider: 'firebase', subjectRef: 'subject-ref', emailRef: 'email-ref', emailMask: 's***@example.com',
    userIdCandidate: 'usr_sqlite', sessionRef: 'session-one', sessionExpiresAt: now + 600_000,
    ipRef: 'ip-ref', deviceRef: 'device-ref', userAgent: 'Chrome', now
  };
  assert.equal((await repository.establishExternalSession(base)).established, true);
  assert.equal((await repository.beginPasskeyRegistration({
    sessionRef: 'session-one', subjectRef: 'subject-ref', emailRef: 'email-ref',
    challengeId: 'register-challenge', challengeMac: 'register-mac', userHandleCandidate: 'user-handle',
    refreshCipher: 'encrypted-refresh-one', ipRef: 'ip-ref', deviceRef: 'device-ref', limits: [],
    now, expiresAt: now + 300_000
  })).userHandle, 'user-handle');
  assert.equal((await repository.getPasskeyRegistrationChallenge({
    sessionRef: 'session-one', subjectRef: 'subject-ref', emailRef: 'email-ref',
    challengeId: 'register-challenge', candidateChallengeMac: 'register-mac', deviceRef: 'device-ref', now
  })).refreshCipher, 'encrypted-refresh-one');
  assert.equal((await repository.finishPasskeyRegistration({
    challengeId: 'register-challenge', candidateChallengeMac: 'register-mac', deviceRef: 'device-ref',
    credential: {
      credentialId: 'credential-one', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      counter: 0, transports: ['internal'], backupEligible: true, backupState: false,
      refreshCipher: 'encrypted-refresh-two'
    }, now
  })).credentialCount, 1);
  await repository.beginPasskeyAuthentication({
    challengeId: 'auth-challenge', challengeMac: 'auth-mac', deviceRef: 'device-ref', ipRef: 'ip-ref',
    limits: [], now, expiresAt: now + 300_000
  });
  assert.equal((await repository.getPasskeyAuthenticationMaterial({
    challengeId: 'auth-challenge', candidateChallengeMac: 'auth-mac', deviceRef: 'device-ref',
    credentialId: 'credential-one', now
  })).credential.credentialId, 'credential-one');
  assert.equal((await repository.issuePasskeyTicket({
    challengeId: 'auth-challenge', candidateChallengeMac: 'auth-mac', deviceRef: 'device-ref',
    credentialId: 'credential-one', previousCounter: 0, nextCounter: 1, backupState: true,
    ticketRef: 'ticket-one', now, expiresAt: now + 60_000
  })).issued, true);
  assert.equal((await repository.completePasskeySession({
    ticketRef: 'ticket-one', subjectRef: 'subject-ref', emailRef: 'email-ref', deviceRef: 'device-ref',
    sessionRef: 'session-two', sessionExpiresAt: now + 600_000, refreshCipher: 'encrypted-refresh-three',
    ipRef: 'ip-ref', userAgent: 'Chrome', now
  })).established, true);
  assert.equal((await repository.getPasskeyStatus({
    sessionRef: 'session-two', subjectRef: 'subject-ref', emailRef: 'email-ref', now
  })).count, 1);
});

test('SQLite pre-verification tickets are device-bound, encrypted, expiring, and single-use', async t => {
  const fixture = storageFixture();
  t.after(() => fixture.database.close());
  const repository = new SqliteAuthRepository(fixture.storage);
  repository.migrate();
  let now = START;
  const engine = new CloudflareNativeAuthEngine({ repository, hmacSecret: SECRET, now: () => now });
  const refreshToken = `firebase-refresh-${'r'.repeat(40)}`;
  const prepared = await engine.beginFirebaseAccountVerification({
    email: 'preverify@example.com',
    subject: 'firebase-preverify-uid',
    refreshToken
  }, CONTEXT);
  assert.match(prepared.verificationTicket, /^[A-Za-z0-9_-]{40,96}$/);
  const stored = fixture.database.prepare(
    'SELECT ticket_ref AS ticketRef,subject_ref AS subjectRef,email_ref AS emailRef,refresh_cipher AS refreshCipher,state FROM auth_account_verification_tickets'
  ).get();
  const serialized = JSON.stringify(stored);
  assert.equal(serialized.includes(prepared.verificationTicket), false);
  assert.equal(serialized.includes('preverify@example.com'), false);
  assert.equal(serialized.includes('firebase-preverify-uid'), false);
  assert.equal(serialized.includes(refreshToken), false);
  assert.match(stored.refreshCipher, /^v1\./);
  assert.equal(stored.state, 'active');

  const recovered = await engine.getFirebaseAccountVerification(prepared.verificationTicket, {}, CONTEXT);
  assert.equal(recovered.refreshToken, refreshToken);
  await assert.rejects(() => engine.getFirebaseAccountVerification(prepared.verificationTicket, {}, {
    ...CONTEXT, deviceId: 'device-other-sqlite-123456789'
  }), error => error?.code === 'TELEGRAM_VERIFICATION_INVALID');

  const completed = await engine.completeFirebaseAccountVerification({
    verificationTicket: prepared.verificationTicket,
    email: 'preverify@example.com',
    subject: 'firebase-preverify-uid'
  }, CONTEXT);
  assert.equal(completed.user.id, prepared.user.id);
  assert.match(completed.sessionToken, /^[A-Za-z0-9_-]{40,96}$/);
  assert.equal(fixture.database.prepare('SELECT state,refresh_cipher AS refreshCipher FROM auth_account_verification_tickets').get().state, 'consumed');
  assert.equal(fixture.database.prepare('SELECT state,refresh_cipher AS refreshCipher FROM auth_account_verification_tickets').get().refreshCipher, '');
  await assert.rejects(() => engine.completeFirebaseAccountVerification({
    verificationTicket: prepared.verificationTicket,
    email: 'preverify@example.com',
    subject: 'firebase-preverify-uid'
  }, CONTEXT), error => error?.code === 'TELEGRAM_VERIFICATION_INVALID');

  const expiring = await engine.beginFirebaseAccountVerification({
    email: 'expires@example.com',
    subject: 'firebase-expiring-preverify-uid',
    refreshToken: `firebase-refresh-${'e'.repeat(40)}`
  }, { ...CONTEXT, deviceId: 'device-expiring-sqlite-12345' });
  now += 15 * 60 * 1000 + 1;
  await assert.rejects(() => engine.getFirebaseAccountVerification(expiring.verificationTicket, {}, {
    ...CONTEXT, deviceId: 'device-expiring-sqlite-12345'
  }), error => error?.code === 'TELEGRAM_VERIFICATION_INVALID');
  const expired = fixture.database.prepare("SELECT state,refresh_cipher AS refreshCipher FROM auth_account_verification_tickets WHERE state='expired'").get();
  assert.deepEqual(expired, { state: 'expired', refreshCipher: '' });
});

test('SQLite schema 5 executes canonical OTP and Telegram verification lifecycles and persistent policy', async t => {
  const fixture = storageFixture();
  t.after(() => fixture.database.close());
  const authRepository = new SqliteAuthRepository(fixture.storage);
  authRepository.migrate();
  const verificationRepository = new SqliteVerificationRepository(fixture.storage);
  verificationRepository.migrate();
  assert.deepEqual(await authRepository.ping(), { ok: true, storage: 'sqlite-durable-object', schema: 6 });

  let now = START;
  const engine = new CloudflareNativeAuthEngine({ repository: authRepository, hmacSecret: SECRET, now: () => now });
  const session = await engine.establishFirebaseSession({ email: 'sqlite@example.com', subject: 'firebase-sqlite-uid' }, CONTEXT);
  const identity = {
    sessionToken: session.sessionToken,
    subject: 'firebase-sqlite-uid',
    userId: session.user.id,
    email: 'sqlite@example.com'
  };
  const otp = new OtpProvider(() => now);
  const otpOrchestrator = new VerificationOrchestrator({
    repository: verificationRepository, hmacSecret: SECRET, providers: [otp], activated: true, now: () => now,
    config: { enabled: true, providers: [{ id: 'otp-a', enabled: true, priority: 1, dailyQuota: 10 }] }
  });
  const sent = await otpOrchestrator.requestVerification(identity, CONTEXT);
  assert.equal((await otpOrchestrator.verify({ ...identity, attemptId: sent.attemptId, code: otp.code }, CONTEXT)).verified, true);

  now += 61_000;
  const telegram = new TelegramProvider(() => now);
  const telegramOrchestrator = new VerificationOrchestrator({
    repository: verificationRepository, hmacSecret: SECRET, providers: [telegram], activated: true, now: () => now,
    config: { enabled: true, providers: [{ id: 'telegram', enabled: true, priority: 1, dailyQuota: 10 }] }
  });
  const telegramSent = await telegramOrchestrator.requestVerification({ ...identity, allowTelegramLink: true }, CONTEXT);
  assert.equal(telegramSent.interaction.proof, 'local-code-required');
  const beforeStart = fixture.database.prepare(
    'SELECT code_mac AS codeMac,code_cipher AS codeCipher,link_token_mac AS linkTokenMac,external_identity_ref AS externalIdentityRef FROM auth_verification_challenges WHERE attempt_id=?'
  ).get(telegramSent.attemptId);
  assert.equal(beforeStart.codeMac.length, 64);
  assert.ok(beforeStart.codeCipher.length > 40);
  assert.match(telegram.preparedCode, /^\d{6}$/);
  assert.equal(beforeStart.codeCipher.includes(telegram.preparedCode), false);
  assert.equal(beforeStart.linkTokenMac.length, 64);
  assert.equal(beforeStart.externalIdentityRef, null);
  await telegramOrchestrator.confirmTelegramWebhook({ linkToken: telegram.linkToken, telegramUserId: '1234567', chatId: '1234567' });
  assert.match(telegram.code, /^\d{6}$/);
  assert.equal(telegram.codeSends, 1);
  assert.equal((await telegramOrchestrator.verify({
    ...identity, attemptId: telegramSent.attemptId, code: telegram.code
  }, CONTEXT)).telegramLinked, true);
  await assert.rejects(() => telegramOrchestrator.verify({
    ...identity, attemptId: telegramSent.attemptId, code: telegram.code
  }, CONTEXT), error => error?.code === 'OTP_USED');
  const telegramRows = fixture.database.prepare('SELECT external_identity_ref AS externalIdentityRef FROM auth_telegram_identity_links').all();
  assert.equal(telegramRows.length, 1);
  assert.equal(telegramRows[0].externalIdentityRef.length, 64);
  assert.equal(telegramRows[0].externalIdentityRef.includes('1234567'), false);

  await verificationRepository.setRuntimeConfig({ config: { enabled: false, policy: { maxAttempts: 4 } }, now });
  assert.equal((await verificationRepository.getRuntimeConfig()).policy.maxAttempts, 4);
  const cooldown = await verificationRepository.recordProviderResult({
    providerId: 'otp-a', attemptId: 'sqlite-provider-cooldown', userId: session.user.id,
    subjectRef: 'subject-ref-only', channel: 'otp', success: false,
    failureClass: 'temporary-provider-failure', reason: 'RATE_LIMITED', latencyMs: 12,
    failureThreshold: 3, forceCooldown: true, cooldownMs: 300_000, now
  });
  assert.equal(cooldown.circuit, 'open');
  assert.equal(cooldown.cooldownUntil, now + 300_000);
  const persisted = JSON.stringify(await verificationRepository.status({ providerIds: ['otp-a', 'telegram'], now }));
  assert.equal(persisted.includes(otp.code), false);
  assert.equal(persisted.includes(telegram.linkToken), false);
  assert.equal(persisted.includes('firebase-sqlite-uid'), false);
});


test('SQLite proves email ownership from a pre-verification OTP and survives a resend', async t => {
  const fixture = storageFixture();
  t.after(() => fixture.database.close());
  const authRepository = new SqliteAuthRepository(fixture.storage);
  authRepository.migrate();
  const verificationRepository = new SqliteVerificationRepository(fixture.storage);
  verificationRepository.migrate();

  let now = START;
  const engine = new CloudflareNativeAuthEngine({ repository: authRepository, hmacSecret: SECRET, now: () => now });
  const session = await engine.establishFirebaseSession({ email: 'owner@example.com', subject: 'firebase-owner-uid' }, CONTEXT);
  const otp = new OtpProvider(() => now);
  const orchestrator = new VerificationOrchestrator({
    repository: verificationRepository, hmacSecret: SECRET, providers: [otp], activated: true, now: () => now,
    config: { enabled: true, providers: [{ id: 'otp-a', enabled: true, priority: 1, dailyQuota: 10 }] }
  });
  // The pre-verification path supplies the address the worker read from Firebase,
  // exactly as auth-authority-do does, because Firebase's emailVerified is still false.
  const trusted = {
    purpose: 'email-ownership',
    trustedIdentity: {
      userId: session.user.id,
      sessionRef: 'a'.repeat(64),
      subjectRef: 'b'.repeat(64),
      emailRef: 'c'.repeat(64),
      email: 'owner@example.com',
      recipientName: 'Owner'
    }
  };
  assert.equal((await orchestrator.isEmailOwnershipProven({ purpose: 'email-ownership', trustedIdentity: trusted.trustedIdentity }, CONTEXT)).proven, false);

  const sent = await orchestrator.requestVerification(trusted, CONTEXT);
  assert.equal(sent.accepted, true);
  const row = fixture.database.prepare(
    'SELECT purpose,destination_ref AS destinationRef,provider_id AS providerId FROM auth_verification_challenges WHERE attempt_id=?'
  ).get(sent.attemptId);
  assert.equal(row.purpose, 'email-ownership');
  assert.equal(row.providerId, 'otp-a');
  // The destination is hashed, and the plaintext address never lands in the table.
  const stored = JSON.stringify(fixture.database.prepare('SELECT * FROM auth_verification_challenges').all());
  assert.equal(stored.includes('owner@example.com'), false);

  const verified = await orchestrator.verify({ ...trusted, attemptId: sent.attemptId, code: otp.code }, CONTEXT);
  assert.equal(verified.verified, true);
  assert.equal(verified.emailOwnershipProven, true);
  // Ownership is recorded locally; Firebase's own flag is deliberately untouched.
  assert.equal(verified.emailVerified, false);
  assert.equal((await orchestrator.isEmailOwnershipProven({ purpose: 'email-ownership', trustedIdentity: trusted.trustedIdentity }, CONTEXT)).proven, true);

  const link = fixture.database.prepare(
    'SELECT method,status,provider_id AS providerId,email_ref AS emailRef FROM auth_email_ownership_links WHERE user_id=?'
  ).get(session.user.id);
  assert.equal(link.method, 'email-otp');
  assert.equal(link.status, 'active');
  assert.equal(link.providerId, 'otp-a');
  assert.equal(link.emailRef.includes('owner@example.com'), false);

  await verificationRepository.revokeEmailOwnership({ userId: session.user.id, now });
  assert.equal((await orchestrator.isEmailOwnershipProven({ purpose: 'email-ownership', trustedIdentity: trusted.trustedIdentity }, CONTEXT)).proven, false);
});

test('SQLite ownership status reads the proven flag over a session without a delivery address', async t => {
  const fixture = storageFixture();
  t.after(() => fixture.database.close());
  const authRepository = new SqliteAuthRepository(fixture.storage);
  authRepository.migrate();
  const verificationRepository = new SqliteVerificationRepository(fixture.storage);
  verificationRepository.migrate();

  const engine = new CloudflareNativeAuthEngine({ repository: authRepository, hmacSecret: SECRET, now: () => START });
  const session = await engine.establishFirebaseSession({ email: 'status@example.com', subject: 'firebase-status-uid' }, CONTEXT);
  const orchestrator = new VerificationOrchestrator({
    repository: verificationRepository, hmacSecret: SECRET, providers: [], activated: true, now: () => START,
    config: { enabled: true, providers: [] }
  });

  // Mirrors /internal/verification/ownership/status: a plain session check that
  // carries no delivery address must still answer instead of demanding one.
  const query = async () => {
    const identity = await engine.getFirebaseIdentity({ sessionToken: session.sessionToken, email: 'status@example.com', subject: 'firebase-status-uid' }, CONTEXT);
    return orchestrator.isEmailOwnershipProven({
      purpose: 'account-backup',
      trustedIdentity: {
        userId: identity.userId, sessionRef: identity.subjectRef, subjectRef: identity.subjectRef, emailRef: identity.emailRef
      }
    }, CONTEXT);
  };
  assert.deepEqual(await query(), { proven: false, method: null });

  // With the ownership purpose this identity shape is rejected outright, which
  // is exactly why the status route must not use it.
  await assert.rejects(
    () => orchestrator.isEmailOwnershipProven({
      purpose: 'email-ownership',
      trustedIdentity: { userId: session.user.id, sessionRef: 'a'.repeat(64), subjectRef: 'b'.repeat(64), emailRef: 'c'.repeat(64) }
    }, CONTEXT),
    error => error?.code === AUTH_ERROR_CODES.INVALID_INPUT
  );
});

test('SQLite resolves the OTP greeting name from the ticket-bound profile, not client input', async t => {
  const fixture = storageFixture();
  t.after(() => fixture.database.close());
  const authRepository = new SqliteAuthRepository(fixture.storage);
  authRepository.migrate();

  const now = START;
  const engine = new CloudflareNativeAuthEngine({ repository: authRepository, hmacSecret: SECRET, now: () => now });
  const prepared = await engine.beginFirebaseAccountVerification({
    email: 'greeting@example.com', subject: 'firebase-greeting-uid', refreshToken: `refresh-${'x'.repeat(32)}`
  }, CONTEXT);
  await engine.savePendingProfile(prepared.verificationTicket, {
    fullName: 'মাহমুদ রাসেল', dob: '2007-05-12',
    school: { id: 's-cox-govt-high', name: 'Cox’s Bazar Government High School', district: 'Cox’s Bazar' },
    higherInstitution: null
  }, CONTEXT);

  const resolved = await engine.getFirebaseVerificationRecipientName(prepared.verificationTicket, CONTEXT);
  assert.equal(resolved.fullName, 'মাহমুদ রাসেল');
  // A different device, a stale ticket, or a malformed token yields no name at
  // all: the greeting degrades to the generic form instead of leaking.
  for (const [label, ticket, context] of [
    ['other device', prepared.verificationTicket, { ...CONTEXT, deviceId: 'device-other-0123456789abcdef' }],
    ['malformed token', 'not-a-ticket', CONTEXT]
  ]) {
    try {
      assert.equal((await engine.getFirebaseVerificationRecipientName(ticket, context)).fullName, '', label);
    } catch (error) {
      assert.equal(error?.code, AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID, label);
    }
  }
});

test('SQLite enforces a Firebase-user lockout across replacement backup challenges', async t => {
  const fixture = storageFixture();
  t.after(() => fixture.database.close());
  const authRepository = new SqliteAuthRepository(fixture.storage);
  authRepository.migrate();
  const verificationRepository = new SqliteVerificationRepository(fixture.storage);
  verificationRepository.migrate();
  let now = START;
  const engine = new CloudflareNativeAuthEngine({ repository: authRepository, hmacSecret: SECRET, now: () => now });
  const session = await engine.establishFirebaseSession({ email: 'locked@example.com', subject: 'firebase-locked-uid' }, CONTEXT);
  const identity = {
    sessionToken: session.sessionToken,
    subject: 'firebase-locked-uid',
    userId: session.user.id,
    email: 'locked@example.com'
  };
  const otp = new OtpProvider(() => now);
  const orchestrator = new VerificationOrchestrator({
    repository: verificationRepository, hmacSecret: SECRET, providers: [otp], activated: true, now: () => now,
    config: { enabled: true, providers: [{ id: 'otp-a', enabled: true, priority: 1, dailyQuota: 10 }] }
  });
  const sent = await orchestrator.requestVerification(identity, CONTEXT);
  const wrong = otp.code === '999999' ? '000000' : '999999';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(() => orchestrator.verify({ ...identity, attemptId: sent.attemptId, code: wrong }, CONTEXT), error => error?.code === 'OTP_INVALID');
  }
  await assert.rejects(() => orchestrator.verify({ ...identity, attemptId: sent.attemptId, code: wrong }, CONTEXT), error => error?.code === 'OTP_LOCKED');
  await assert.rejects(() => orchestrator.requestVerification(identity, CONTEXT), error => error?.code === 'OTP_LOCKED');
  assert.equal(otp.sends, 1);
  now += 900_001;
  await orchestrator.requestVerification(identity, CONTEXT);
  assert.equal(otp.sends, 2);
});


test('SQLite schema 5 upgrades a populated pre-Telegram verification table idempotently', t => {
  const fixture = storageFixture();
  t.after(() => fixture.database.close());
  const authRepository = new SqliteAuthRepository(fixture.storage);
  authRepository.migrate();
  fixture.storage.sql.exec(`CREATE TABLE auth_verification_challenges (
    attempt_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_ref TEXT NOT NULL,
    subject_ref TEXT NOT NULL,
    email_ref TEXT NOT NULL,
    destination_ref TEXT NOT NULL,
    device_ref TEXT NOT NULL,
    ip_ref TEXT NOT NULL,
    purpose TEXT NOT NULL,
    code_mac TEXT NOT NULL,
    provider_id TEXT,
    channel TEXT,
    verification_mode TEXT,
    state TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    resend_at INTEGER NOT NULL,
    sent_at INTEGER,
    verified_at INTEGER,
    lockout_until INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES auth_users(user_id)
  )`);
  fixture.storage.sql.exec(
    "INSERT INTO auth_users(user_id,email_ref,email_mask,status,created_at,last_login_at) VALUES(?,?,?,?,?,?)",
    'usr_old_schema', 'old-email-ref', 'o***@example.com', 'active', START, START
  );
  fixture.storage.sql.exec(
    `INSERT INTO auth_verification_challenges(
      attempt_id,user_id,session_ref,subject_ref,email_ref,destination_ref,device_ref,ip_ref,purpose,
      code_mac,provider_id,channel,verification_mode,state,attempts,max_attempts,created_at,expires_at,
      resend_at,sent_at,verified_at,lockout_until
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    'old-attempt', 'usr_old_schema', 'old-session-ref', 'old-subject-ref', 'old-email-ref',
    'old-destination-ref', 'old-device-ref', 'old-ip-ref', 'account-backup', 'old-code-mac',
    'otp-a', 'otp', 'local-code', 'sent', 0, 5, START, START + 300_000, START + 60_000,
    START, null, 0
  );
  const verificationRepository = new SqliteVerificationRepository(fixture.storage);
  verificationRepository.migrate();
  verificationRepository.migrate();
  const columns = new Set(fixture.database.prepare('PRAGMA table_info(auth_verification_challenges)').all().map(row => row.name));
  assert.equal(columns.has('code_cipher'), true);
  assert.equal(columns.has('link_token_mac'), true);
  assert.equal(columns.has('link_cipher'), true);
  assert.equal(columns.has('provider_confirmed'), true);
  assert.equal(columns.has('external_identity_ref'), true);
  const preserved = fixture.database.prepare(
    'SELECT attempt_id AS attemptId,code_cipher AS codeCipher,link_token_mac AS linkTokenMac,link_cipher AS linkCipher,provider_confirmed AS providerConfirmed,external_identity_ref AS externalIdentityRef FROM auth_verification_challenges WHERE attempt_id=?'
  ).get('old-attempt');
  assert.deepEqual(preserved, {
    attemptId: 'old-attempt', codeCipher: '', linkTokenMac: '', linkCipher: '',
    providerConfirmed: 0, externalIdentityRef: null
  });
  assert.equal(fixture.database.prepare("SELECT value FROM auth_meta WHERE key='schema_version'").get().value, '6');
  // The pre-email-ownership constraint must be rebuilt, not merely version-stamped,
  // or inserting an `email-ownership` challenge would still fail the CHECK.
  assert.match(
    fixture.database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='auth_verification_challenges'").get().sql,
    /email-ownership/
  );
});

test('SQLite schema v7 upgrades an existing v5 database and stays idempotent', async t => {
  const fixture = storageFixture();
  t.after(() => fixture.database.close());
  // Pre-existing v5 deployment: events table without the Phase 6 columns.
  fixture.database.exec('CREATE TABLE auth_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  fixture.database.exec("INSERT INTO auth_meta(key,value) VALUES('schema_version','5')");
  fixture.database.exec('CREATE TABLE auth_security_events(event_id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, subject_ref TEXT, user_id TEXT, occurred_at INTEGER NOT NULL)');
  fixture.database.exec("INSERT INTO auth_security_events(event_type,subject_ref,user_id,occurred_at) VALUES('firebase-login','old-subject','usr_old',1800000000000)");
  // Pre-existing v5 profile row must survive the Phase 7 additive migration.
  fixture.database.exec('CREATE TABLE auth_users(user_id TEXT PRIMARY KEY, email_ref TEXT NOT NULL UNIQUE, email_mask TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, last_login_at INTEGER NOT NULL)');
  fixture.database.exec("INSERT INTO auth_users VALUES('usr_old','ref_old','u***@example.com','active',1800000000000,1800000000000)");
  fixture.database.exec('CREATE TABLE auth_profiles(user_id TEXT PRIMARY KEY, profile_version INTEGER NOT NULL, full_name TEXT NOT NULL, date_of_birth TEXT NOT NULL, school_id TEXT NOT NULL, school_name TEXT NOT NULL, school_district TEXT NOT NULL, higher_id TEXT, higher_name TEXT, higher_district TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)');
  fixture.database.exec("INSERT INTO auth_profiles VALUES('usr_old',3,'Old Student','2008-01-01','s1','Old School','Dhaka',NULL,NULL,NULL,1800000000000,1800000000000)");

  const repository = new SqliteAuthRepository(fixture.storage);
  repository.migrate();
  const columns = new Set(fixture.database.prepare('PRAGMA table_info(auth_security_events)').all().map(row => row.name));
  assert.ok(columns.has('device_ref'));
  assert.ok(columns.has('purpose'));
  assert.ok(columns.has('policy_version'));
  const preserved = fixture.database.prepare(
    'SELECT event_type AS eventType, device_ref AS deviceRef, purpose AS purpose, policy_version AS policyVersion FROM auth_security_events WHERE subject_ref=?'
  ).get('old-subject');
  assert.deepEqual(preserved, { eventType: 'firebase-login', deviceRef: null, purpose: null, policyVersion: null });
  // Phase 7 additive columns + public identity table, old row preserved.
  const profileColumns = new Set(fixture.database.prepare('PRAGMA table_info(auth_profiles)').all().map(row => row.name));
  for (const column of ['mobile', 'bio', 'targets', 'visibility']) assert.ok(profileColumns.has(column), column);
  assert.ok(fixture.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_public_identities'").get());
  const preservedProfile = fixture.database.prepare(
    'SELECT full_name AS fullName, profile_version AS version, visibility FROM auth_profiles WHERE user_id=?'
  ).get('usr_old');
  assert.deepEqual(preservedProfile, { fullName: 'Old Student', version: 3, visibility: 'private' });

  // Second migrate (next DO activation) must not re-apply the ALTERs.
  repository.migrate();
  const ping = await repository.ping();
  assert.equal(ping.ok, true);
  assert.equal(ping.schema, 7);

  const accepted = await repository.consumeLimits({
    limits: [{ scope: 'login', key: 'ip-ref', windowMs: 900_000, limit: 12 }],
    now: START + 10, eventType: 'login-attempt', subjectRef: 'new-subject'
  });
  assert.equal(accepted.accepted, true);
  const fresh = fixture.database.prepare(
    'SELECT device_ref, purpose, policy_version FROM auth_security_events WHERE event_type=?'
  ).get('login-attempt');
  assert.deepEqual(fresh, { device_ref: null, purpose: null, policy_version: null });
});
