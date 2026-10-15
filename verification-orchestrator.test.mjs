import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_ERROR_CODES } from './auth-native/core/errors.mjs';
import { VerificationOrchestrator } from './auth-native/verification/orchestrator.mjs';
import { MemoryVerificationRepository } from './auth-native/verification/memory-verification-repository.mjs';
import {
  VERIFICATION_CHANNELS,
  VERIFICATION_FAILURE_CLASS,
  VERIFICATION_MODES,
  VerificationProviderError
} from './auth-native/verification/provider-contract.mjs';

const SECRET = 'verification-orchestrator-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DAY_MS = 86_400_000;
const identity = Object.freeze({
  sessionToken: `session-${'s'.repeat(48)}`,
  subject: 'firebase-uid-verification-user',
  userId: 'usr_canonical_verification_user',
  email: 'backup.student@example.com',
  purpose: 'account-backup'
});
const context = Object.freeze({
  ip: '203.0.113.55',
  deviceId: 'device-verification-0123456789',
  userAgent: 'Chrome',
  origin: 'https://admissionhub.pages.dev'
});

class MockProvider {
  constructor({ id, channel = VERIFICATION_CHANNELS.OTP, verificationMode = VERIFICATION_MODES.LOCAL_CODE, sendPlan = [], verifyPlan = [], remaining = 100 } = {}) {
    this.id = id;
    this.channel = channel;
    this.verificationMode = verificationMode;
    this.sendPlan = [...sendPlan];
    this.verifyPlan = [...verifyPlan];
    this.remaining = remaining;
    this.sends = [];
    this.verifies = [];
    this.telegramCodes = [];
  }

  async checkAvailability() { return { available: true, code: 'READY' }; }
  async getRemainingQuota() { return { remaining: this.remaining, limit: 100, resetAt: 1_900_000_000_000 }; }
  async getProviderStatus() { return { status: 'healthy', configured: true }; }
  async sendVerification(input) {
    this.sends.push(input);
    const next = this.sendPlan.shift() || 'success';
    if (next === 'hard') throw new VerificationProviderError('HARD_DOWN', VERIFICATION_FAILURE_CLASS.HARD);
    if (next === 'temporary') throw new VerificationProviderError('TEMPORARY_DOWN', VERIFICATION_FAILURE_CLASS.TEMPORARY);
    if (next === 'retry-after') throw new VerificationProviderError('RATE_LIMITED', VERIFICATION_FAILURE_CLASS.TEMPORARY, { retryAfter: 60 });
    if (next === 'user') throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    if (this.id === 'telegram') {
      return { accepted: true, interaction: { type: 'telegram-link', url: `https://t.me/AdmissionHubVerifyBot?start=${input.linkToken}` } };
    }
    return { accepted: true };
  }
  async sendTelegramCode(input) {
    this.telegramCodes.push(input);
    return { accepted: true };
  }
  async verifyCode(input) {
    this.verifies.push(input);
    const next = this.verifyPlan.shift();
    if (next === 'temporary') throw new VerificationProviderError('VERIFY_TIMEOUT', VERIFICATION_FAILURE_CLASS.TEMPORARY);
    if (next === 'user') throw new VerificationProviderError('EVIDENCE_REJECTED', VERIFICATION_FAILURE_CLASS.USER);
    return { verified: next !== false };
  }
}

const rawConfig = (providers, policy = {}) => ({
  enabled: true,
  policy,
  providers: providers.map((provider, index) => ({
    id: provider.id,
    enabled: true,
    priority: (index + 1) * 10,
    dailyQuota: 100,
    timeoutMs: 1000
  }))
});

const setup = ({ providers, config = rawConfig(providers), start = 1_800_000_000_000 } = {}) => {
  let now = start;
  const repository = new MemoryVerificationRepository();
  const orchestrator = new VerificationOrchestrator({ repository, hmacSecret: SECRET, config, providers, activated: true, now: () => now });
  return { repository, orchestrator, now: () => now, advance: value => { now += value; } };
};

async function expectCode(action, code) {
  await assert.rejects(action, error => error?.code === code);
}

test('backup verification stays fail-closed until the independent production activation gate is enabled', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const repository = new MemoryVerificationRepository();
  const orchestrator = new VerificationOrchestrator({
    repository,
    hmacSecret: SECRET,
    config: rawConfig([provider]),
    providers: [provider],
    activated: false,
    now: () => 1_800_000_000_000
  });
  assert.equal((await orchestrator.capabilities()).available, false);
  const status = await orchestrator.adminStatus();
  assert.equal(status.activation, 'disabled');
  assert.equal(status.runtimeEnabled, true);
  assert.equal(status.enabled, false);
  await expectCode(() => orchestrator.requestVerification(identity, context), AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
  assert.equal(provider.sends.length, 0);
});

test('capability health probes run in parallel so one slow provider cannot serialize every fallback', async () => {
  const first = new MockProvider({ id: 'otp-a' });
  const second = new MockProvider({ id: 'otp-b' });
  let release;
  let started = 0;
  const gate = new Promise(resolve => { release = resolve; });
  first.checkAvailability = async () => {
    started += 1;
    await gate;
    return { available: true, code: 'READY' };
  };
  second.checkAvailability = async () => {
    started += 1;
    release();
    return { available: true, code: 'READY' };
  };
  const app = setup({ providers: [first, second] });
  const capabilities = await Promise.race([
    app.orchestrator.capabilities(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('provider probes were serialized')), 250))
  ]);
  assert.equal(capabilities.available, true);
  assert.equal(started, 2);
});

test('public capability checks are cached for thirty seconds', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  let availabilityChecks = 0;
  let quotaChecks = 0;
  provider.checkAvailability = async () => { availabilityChecks += 1; return { available: true, code: 'READY' }; };
  provider.getRemainingQuota = async () => { quotaChecks += 1; return { remaining: 100, limit: 100, resetAt: 1_900_000_000_000 }; };
  const app = setup({ providers: [provider] });
  await app.orchestrator.capabilities();
  await app.orchestrator.capabilities();
  assert.equal(availabilityChecks, 1);
  assert.equal(quotaChecks, 1);
  app.advance(30_001);
  await app.orchestrator.capabilities();
  assert.equal(availabilityChecks, 2);
  assert.equal(quotaChecks, 2);
});

test('provider contract drives local OTP success without persisting plaintext code, destination, subject, or session', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider] });
  const requested = await app.orchestrator.requestVerification(identity, context);
  assert.equal(requested.accepted, true);
  assert.equal(requested.attemptsAllowed, 5);
  assert.equal(provider.sends.length, 1);
  assert.match(provider.sends[0].code, /^\d{6}$/);
  assert.match(provider.sends[0].linkToken, /^[A-Za-z0-9_-]{40,96}$/);
  assert.equal('providerId' in requested, false);
  assert.equal('channel' in requested, false);

  const serialized = JSON.stringify(app.repository.snapshot());
  assert.equal(serialized.includes(provider.sends[0].code), false);
  assert.equal(serialized.includes(provider.sends[0].linkToken), false);
  assert.equal(serialized.includes(identity.email), false);
  assert.equal(serialized.includes(identity.subject), false);
  assert.equal(serialized.includes(identity.sessionToken), false);

  const verified = await app.orchestrator.verify({ ...identity, attemptId: requested.attemptId, code: provider.sends[0].code }, context);
  assert.deepEqual(verified, { verified: true, purpose: 'account-backup', userId: identity.userId });
  await expectCode(
    () => app.orchestrator.verify({ ...identity, attemptId: requested.attemptId, code: provider.sends[0].code }, context),
    AUTH_ERROR_CODES.OTP_USED
  );
});

test('a verification challenge cannot be reused for another purpose', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider] });
  const requested = await app.orchestrator.requestVerification(identity, context);
  const code = provider.sends[0].code;
  await expectCode(() => app.orchestrator.verify({
    ...identity, purpose: 'sensitive-action', attemptId: requested.attemptId, code
  }, context), AUTH_ERROR_CODES.OTP_INVALID);
  const verified = await app.orchestrator.verify({ ...identity, attemptId: requested.attemptId, code }, context);
  assert.equal(verified.purpose, 'account-backup');
});

test('wrong OTP never sends again or switches provider and locks at five attempts', async () => {
  const first = new MockProvider({ id: 'otp-a' });
  const second = new MockProvider({ id: 'otp-b' });
  const app = setup({ providers: [first, second] });
  const requested = await app.orchestrator.requestVerification(identity, context);
  const correct = first.sends[0].code;
  const wrong = correct === '999999' ? '000000' : '999999';
  for (let attempt = 1; attempt < 5; attempt += 1) {
    await expectCode(() => app.orchestrator.verify({ ...identity, attemptId: requested.attemptId, code: wrong }, context), AUTH_ERROR_CODES.OTP_INVALID);
  }
  await expectCode(() => app.orchestrator.verify({ ...identity, attemptId: requested.attemptId, code: wrong }, context), AUTH_ERROR_CODES.OTP_LOCKED);
  await expectCode(() => app.orchestrator.verify({ ...identity, attemptId: requested.attemptId, code: correct }, context), AUTH_ERROR_CODES.OTP_LOCKED);
  await expectCode(() => app.orchestrator.requestVerification(identity, context), AUTH_ERROR_CODES.OTP_LOCKED);
  assert.equal(first.sends.length, 1);
  assert.equal(second.sends.length, 0);
  app.advance(900_001);
  await app.orchestrator.requestVerification(identity, context);
  assert.equal(first.sends.length, 2);
});

test('OTP expires after five minutes and resend cooldown is enforced', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider] });
  const requested = await app.orchestrator.requestVerification(identity, context);
  await expectCode(() => app.orchestrator.requestVerification(identity, context), AUTH_ERROR_CODES.RESEND_COOLDOWN);
  app.advance(300_001);
  await expectCode(
    () => app.orchestrator.verify({ ...identity, attemptId: requested.attemptId, code: provider.sends[0].code }, context),
    AUTH_ERROR_CODES.OTP_EXPIRED
  );
});

test('a failed resend keeps the previously delivered unexpired code usable', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider] });
  const first = await app.orchestrator.requestVerification(identity, context);
  const firstCode = provider.sends[0].code;
  app.advance(60_001);
  provider.sendPlan.push('hard');
  await expectCode(() => app.orchestrator.requestVerification(identity, context), AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
  const verified = await app.orchestrator.verify({ ...identity, attemptId: first.attemptId, code: firstCode }, context);
  assert.equal(verified.verified, true);
});

test('an accepted delivery is never sent twice when local delivery-state persistence fails', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider] });
  app.repository.markChallengeDelivery = async () => { throw new Error('storage unavailable'); };
  await expectCode(() => app.orchestrator.requestVerification(identity, context), AUTH_ERROR_CODES.STORAGE_UNAVAILABLE);
  assert.equal(provider.sends.length, 1);
});

test('hard and temporary provider failures retry intelligently then fail over', async t => {
  await t.test('hard failure skips retry and uses next provider', async () => {
    const first = new MockProvider({ id: 'otp-a', sendPlan: ['hard'] });
    const second = new MockProvider({ id: 'otp-b' });
    const app = setup({ providers: [first, second] });
    await app.orchestrator.requestVerification(identity, context);
    assert.equal(first.sends.length, 1);
    assert.equal(second.sends.length, 1);
  });

  await t.test('temporary failure retries once before failover', async () => {
    const first = new MockProvider({ id: 'otp-a', sendPlan: ['temporary', 'temporary'] });
    const second = new MockProvider({ id: 'otp-b' });
    const app = setup({ providers: [first, second] });
    await app.orchestrator.requestVerification(identity, context);
    assert.equal(first.sends.length, 2);
    assert.equal(second.sends.length, 1);
  });

  await t.test('provider Retry-After opens cooldown without an immediate retry before failover', async () => {
    const first = new MockProvider({ id: 'otp-a', sendPlan: ['retry-after'] });
    const second = new MockProvider({ id: 'otp-b' });
    const app = setup({ providers: [first, second] });
    await app.orchestrator.requestVerification(identity, context);
    assert.equal(first.sends.length, 1);
    assert.equal(second.sends.length, 1);
    const state = await app.repository.providerSnapshot({ providerId: 'otp-a', now: app.now() });
    assert.equal(state.circuit, 'open');
    assert.ok(state.cooldownUntil >= app.now() + 60_000);
  });

  await t.test('user error never retries or fails over', async () => {
    const first = new MockProvider({ id: 'otp-a', sendPlan: ['user'] });
    const second = new MockProvider({ id: 'otp-b' });
    const app = setup({ providers: [first, second] });
    await expectCode(() => app.orchestrator.requestVerification(identity, context), AUTH_ERROR_CODES.INVALID_INPUT);
    assert.equal(first.sends.length, 1);
    assert.equal(second.sends.length, 0);
  });
});

test('a repaired provider is probed again instead of staying circuit-open forever', async () => {
  const first = new MockProvider({ id: 'otp-a', sendPlan: ['hard'] });
  const second = new MockProvider({ id: 'otp-b' });
  const app = setup({ providers: [first, second] });

  await app.orchestrator.requestVerification(identity, context);
  assert.equal(first.sends.length, 1);
  assert.equal(second.sends.length, 1, 'the healthy fallback carries the send');
  assert.equal((await app.repository.providerSnapshot({ providerId: 'otp-a', now: app.now() })).circuit, 'open');

  app.advance(301_000);
  await app.orchestrator.requestVerification(identity, context);
  assert.equal(first.sends.length, 2, 'the expired cooldown is probed rather than skipped');

  // The credential is repaired and the probe succeeds, so the slot closes and
  // takes the next send instead of staying penalised behind the healthy fallback.
  app.advance(61_000);
  await app.orchestrator.requestVerification(identity, context);
  assert.equal(first.sends.length, 2); // Resend rotates away from the previous provider.
  assert.equal((await app.repository.providerSnapshot({ providerId: 'otp-a', now: app.now() })).circuit, 'closed');
});

test('backup sends enforce independent Firebase-user, IP, and device limits', async t => {
  const scopedIdentity = index => ({
    ...identity,
    sessionToken: `session-${String(index).padStart(48, 's')}`,
    subject: `firebase-rate-uid-${index}`,
    userId: `usr_rate_${index}`,
    email: `rate-${index}@example.com`
  });

  await t.test('Firebase user limit', async () => {
    const provider = new MockProvider({ id: 'otp-a', remaining: 100 });
    const app = setup({ providers: [provider] });
    for (let index = 0; index < 5; index += 1) {
      if (index) app.advance(61_000);
      await app.orchestrator.requestVerification(scopedIdentity(1), context);
    }
    app.advance(61_000);
    await expectCode(() => app.orchestrator.requestVerification(scopedIdentity(1), context), AUTH_ERROR_CODES.RATE_LIMITED);
    assert.equal(provider.sends.length, 5);
  });

  await t.test('device limit across Firebase users', async () => {
    const provider = new MockProvider({ id: 'otp-a', remaining: 100 });
    const app = setup({ providers: [provider] });
    for (let index = 0; index < 10; index += 1) await app.orchestrator.requestVerification(scopedIdentity(index + 10), context);
    await expectCode(() => app.orchestrator.requestVerification(scopedIdentity(20), context), AUTH_ERROR_CODES.RATE_LIMITED);
    assert.equal(provider.sends.length, 10);
  });

  await t.test('IP limit across Firebase users and devices', async () => {
    const provider = new MockProvider({ id: 'otp-a', remaining: 100 });
    const app = setup({ providers: [provider] });
    for (let index = 0; index < 20; index += 1) {
      await app.orchestrator.requestVerification(scopedIdentity(index + 30), { ...context, deviceId: `rate-device-${String(index).padStart(24, 'd')}` });
    }
    await expectCode(
      () => app.orchestrator.requestVerification(scopedIdentity(50), { ...context, deviceId: `rate-device-${'z'.repeat(24)}` }),
      AUTH_ERROR_CODES.RATE_LIMITED
    );
    assert.equal(provider.sends.length, 20);
  });
});

test('daily quota is atomic, exhausts safely, and resets at the next UTC day', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const config = rawConfig([provider]);
  config.providers[0].dailyQuota = 1;
  const app = setup({ providers: [provider], config, start: 1_800_000_000_000 });
  await app.orchestrator.requestVerification(identity, context);
  app.advance(61_000);
  await expectCode(() => app.orchestrator.requestVerification(identity, context), AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
  const resetAt = (Math.floor(app.now() / DAY_MS) + 1) * DAY_MS;
  app.advance(resetAt - app.now() + 1);
  await app.orchestrator.requestVerification(identity, context);
  assert.equal(provider.sends.length, 2);
});

test('low-quota awareness preserves depleted primary capacity when a healthy fallback exists', async () => {
  const first = new MockProvider({ id: 'otp-a' });
  const second = new MockProvider({ id: 'otp-b' });
  const config = rawConfig([first, second]);
  config.providers[0].dailyQuota = 10;
  config.providers[1].dailyQuota = 100;
  const app = setup({ providers: [first, second], config });
  for (let index = 0; index < 9; index += 1) {
    await app.repository.reserveDailyQuota({ providerId: 'otp-a', dailyQuota: 10, now: app.now() });
  }
  await app.orchestrator.requestVerification(identity, context);
  assert.equal(first.sends.length, 0);
  assert.equal(second.sends.length, 1);
});

test('official WhatsApp and Telegram slots both use locally verified single-use codes', async t => {
  await t.test('whatsapp official-code flow', async () => {
    const provider = new MockProvider({ id: 'whatsapp', channel: VERIFICATION_CHANNELS.WHATSAPP, verificationMode: VERIFICATION_MODES.LOCAL_CODE });
    const app = setup({ providers: [provider] });
    const linkedDestinations = { whatsapp: '+8801700000000' };
    const requested = await app.orchestrator.requestVerification({ ...identity, linkedDestinations }, context);
    const verified = await app.orchestrator.verify({ ...identity, linkedDestinations, attemptId: requested.attemptId, code: provider.sends[0].code }, context);
    assert.equal(verified.verified, true);
    assert.equal(provider.verifies.length, 0);
  });

  await t.test('Telegram START sends an OTP that the app verifies locally', async () => {
    const provider = new MockProvider({ id: 'telegram', channel: VERIFICATION_CHANNELS.TELEGRAM, verificationMode: VERIFICATION_MODES.LOCAL_CODE });
    const app = setup({ providers: [provider] });
    const requested = await app.orchestrator.requestVerification({ ...identity, allowTelegramLink: true }, context);
    assert.equal(requested.interaction.proof, 'local-code-required');
    assert.match(provider.sends[0].linkToken, /^[A-Za-z0-9_-]{40,96}$/);
    await expectCode(
      () => app.orchestrator.verify({ ...identity, allowTelegramLink: true, attemptId: requested.attemptId, code: provider.sends[0].code }, context),
      AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_PENDING
    );
    assert.equal(app.repository.snapshot().challenges[0].attempts, 0);
    await app.orchestrator.confirmTelegramWebhook({
      linkToken: provider.sends[0].linkToken,
      telegramUserId: '123456789',
      chatId: '123456789'
    });
    assert.equal(provider.telegramCodes.length, 1);
    assert.equal(provider.telegramCodes[0].code, provider.sends[0].code);
    const serialized = JSON.stringify(app.repository.snapshot());
    assert.equal(serialized.includes('123456789'), false);
    assert.equal(serialized.includes(provider.sends[0].linkToken), false);
    await expectCode(() => app.orchestrator.confirmTelegramWebhook({
      linkToken: provider.sends[0].linkToken,
      telegramUserId: '123456789',
      chatId: '123456789'
    }), AUTH_ERROR_CODES.OTP_INVALID);
    const verified = await app.orchestrator.verify({
      ...identity, allowTelegramLink: true, attemptId: requested.attemptId, code: provider.telegramCodes[0].code
    }, context);
    assert.equal(verified.verified, true);
    assert.equal(verified.telegramLinked, true);
    assert.equal(verified.emailVerified, false);
    assert.equal(provider.verifies.length, 0);
    await expectCode(() => app.orchestrator.verify({
      ...identity, allowTelegramLink: true, attemptId: requested.attemptId, code: provider.telegramCodes[0].code
    }, context), AUTH_ERROR_CODES.OTP_USED);
  });
});

test('wrong Telegram OTP consumes only an attempt and never switches provider or resends', async () => {
  const telegram = new MockProvider({
    id: 'telegram', channel: VERIFICATION_CHANNELS.TELEGRAM, verificationMode: VERIFICATION_MODES.LOCAL_CODE
  });
  const whatsapp = new MockProvider({
    id: 'whatsapp', channel: VERIFICATION_CHANNELS.WHATSAPP, verificationMode: VERIFICATION_MODES.LOCAL_CODE
  });
  const app = setup({ providers: [telegram, whatsapp] });
  const linkedDestinations = { whatsapp: '+8801700000000' };
  const requested = await app.orchestrator.requestVerification({ ...identity, linkedDestinations, allowTelegramLink: true }, context);
  await app.orchestrator.confirmTelegramWebhook({
    linkToken: telegram.sends[0].linkToken,
    telegramUserId: '987654321',
    chatId: '987654321'
  });
  const wrong = telegram.telegramCodes[0].code === '999999' ? '000000' : '999999';
  await expectCode(
    () => app.orchestrator.verify({ ...identity, linkedDestinations, allowTelegramLink: true, attemptId: requested.attemptId, code: wrong }, context),
    AUTH_ERROR_CODES.OTP_INVALID
  );
  assert.equal(telegram.sends.length, 1);
  assert.equal(telegram.telegramCodes.length, 1);
  assert.equal(whatsapp.sends.length, 0);
});

test('daily quota reservation stays atomic under concurrent claims', async () => {
  const repository = new MemoryVerificationRepository();
  const results = await Promise.all(Array.from({ length: 50 }, () => repository.reserveDailyQuota({
    providerId: 'otp-a', dailyQuota: 7, now: 1_800_000_000_000
  })));
  assert.equal(results.filter(row => !row.exhausted).length, 7);
  assert.equal(results.filter(row => row.exhausted).length, 43);
  assert.equal((await repository.dailyQuotaSnapshot({ providerId: 'otp-a', dailyQuota: 7, now: 1_800_000_000_000 })).used, 7);
});

test('safe admin policy updates persist only normalized non-secret fields', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider] });
  const updated = await app.orchestrator.updateConfig({
    enabled: true,
    secret: 'must-not-persist',
    policy: { codeTtlSeconds: 240, maxAttempts: 4, apiKey: 'must-not-persist' },
    providers: [{ id: 'otp-a', enabled: true, priority: 77, dailyQuota: 12, token: 'must-not-persist' }]
  });
  assert.equal(updated.policy.codeTtlSeconds, 240);
  assert.equal(updated.policy.maxAttempts, 4);
  assert.equal(updated.providers.find(row => row.id === 'otp-a').priority, 77);
  const persisted = await app.repository.getRuntimeConfig();
  const serialized = JSON.stringify(persisted);
  assert.equal(serialized.includes('must-not-persist'), false);
  assert.equal(serialized.includes('apiKey'), false);
  assert.equal(serialized.includes('token'), false);
  const disabled = await app.orchestrator.updateConfig({ ...persisted, enabled: false });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.providers.find(row => row.id === 'otp-a').enabled, true);
  assert.equal((await app.orchestrator.capabilities()).available, false);
});

test('admin status is sanitized and reports priority, quota, reset, health, rates, latency, failures, and events', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider] });
  await app.orchestrator.requestVerification(identity, context);
  const status = await app.orchestrator.adminStatus();
  const row = status.providers.find(item => item.id === 'otp-a');
  assert.equal(row.enabled, true);
  assert.equal(row.configured, true);
  assert.equal(row.priority, 10);
  assert.equal(row.quota.local.used, 1);
  assert.ok(row.quota.local.resetAt > app.now());
  assert.equal(row.health.successCount, 1);
  assert.equal(row.health.failureCount, 0);
  assert.ok(row.health.latencyMs >= 0);
  const serialized = JSON.stringify(status);
  assert.equal(serialized.includes(provider.sends[0].code), false);
  assert.equal(serialized.includes(provider.sends[0].linkToken), false);
  assert.equal(serialized.includes(identity.email), false);
  assert.equal(serialized.includes(identity.sessionToken), false);
});

test('Telegram webhook setup is available only through the enabled Telegram slot and returns bounded state', async () => {
  const provider = new MockProvider({
    id: 'telegram',
    channel: VERIFICATION_CHANNELS.TELEGRAM,
    verificationMode: VERIFICATION_MODES.LOCAL_CODE
  });
  let configured = 0;
  let removed = 0;
  provider.configureWebhook = async () => {
    configured += 1;
    return { ready: true, identityReady: true, webhookReady: true, endpointAccepted: true, webhookChanged: true, privateDetail: 'must-not-return' };
  };
  provider.removeConfiguredWebhook = async () => { removed += 1; return { removed: true }; };
  const app = setup({ providers: [provider] });
  assert.deepEqual(await app.orchestrator.configureTelegramWebhook(), {
    ready: true,
    identityReady: true,
    webhookReady: true,
    endpointAccepted: true,
    webhookChanged: true
  });
  assert.deepEqual(await app.orchestrator.removeTelegramWebhook(), { removed: true });
  assert.equal(configured, 1);
  assert.equal(removed, 1);

  const disabled = setup({ providers: [provider], config: { enabled: false, providers: [{ id: 'telegram', enabled: false }] } });
  await expectCode(() => disabled.orchestrator.configureTelegramWebhook(), AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
});
