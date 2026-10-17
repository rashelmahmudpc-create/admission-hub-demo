import test from 'node:test';
import assert from 'node:assert/strict';
import { DescopeOtpVerificationProvider, createConfiguredVerificationProviders } from './auth-native/verification/providers.mjs';
import { assertVerificationProvider, VERIFICATION_FAILURE_CLASS } from './auth-native/verification/provider-contract.mjs';
import { verificationConfig } from './auth-native/verification/config.mjs';
import { VerificationOrchestrator } from './auth-native/verification/orchestrator.mjs';
import { MemoryVerificationRepository } from './auth-native/verification/memory-verification-repository.mjs';
import { AUTH_ERROR_CODES } from './auth-native/core/errors.mjs';

const PROJECT = 'P0123456789012345678901234567';
const EMAIL = 'student@gmail.com';
const NOW = 1800000000000;
const slot = { id: 'otp-l', enabled: true, priority: 38, dailyQuota: 1000, timeoutMs: 12000, projectId: PROJECT };
const config = { enabled: true, providers: [slot] };
const verified = () => ({ sessionJwt: 'mock-session-do-not-expose', refreshJwt: 'mock-refresh-do-not-expose', user: { userId: 'mock-descope-user', email: EMAIL, verifiedEmail: true } });
const mock = (handler = () => Response.json({})) => {
  const calls = [];
  const provider = new DescopeOtpVerificationProvider({ projectId: PROJECT, declaredDailyQuota: 1000, now: () => NOW, fetchImpl: async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return handler(url, init); } });
  return { provider, calls };
};
const verifyInput = { destination: EMAIL, evidence: '123456', attemptId: 'a'.repeat(32) };

test('Descope implements the shared provider-evidence contract', () => {
  const { provider } = mock();
  assert.equal(assertVerificationProvider(provider), provider);
  assert.equal(provider.id, 'otp-l');
  assert.equal(provider.verificationMode, 'provider-evidence');
});

test('Descope is opt-in; malformed, absent or disabled config never becomes ready', async () => {
  for (const raw of ['', '{', JSON.stringify({ ...config, enabled: false }), JSON.stringify({ enabled: true, providers: [{ ...slot, enabled: false }] })]) {
    const providers = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: raw });
    const p = providers.find(p => p.id === 'otp-l');
    assert.equal((await p.checkAvailability()).available, false);
    await assert.rejects(() => p.sendVerification({ destination: EMAIL }), { code: 'NOT_CONFIGURED' });
  }
  assert.equal(verificationConfig({}).providers.find(p => p.id === 'otp-l').enabled, false);
});

test('Descope rejects unsafe Project IDs and zero or above-free-tier quota', async () => {
  for (const projectId of ['', 'bad', PROJECT + '\r\nInjected: true', 'https://evil.example']) {
    const p = new DescopeOtpVerificationProvider({ projectId, declaredDailyQuota: 1000 });
    assert.equal((await p.checkAvailability()).available, false);
  }
  for (const declaredDailyQuota of [0, 1001, -1, 1.5]) {
    const p = new DescopeOtpVerificationProvider({ projectId: PROJECT, declaredDailyQuota });
    assert.equal((await p.checkAvailability()).available, false);
  }
});

test('readiness and declared quota do not make any outbound request', async () => {
  const { provider, calls } = mock();
  assert.equal((await provider.checkAvailability()).code, 'READY');
  assert.equal((await provider.getProviderStatus()).liveDeliveryVerified, false);
  const q = await provider.getRemainingQuota();
  assert.equal(q.limit, 1000); assert.equal(q.source, 'declared'); assert.ok(q.resetAt > NOW);
  assert.equal(calls.length, 0);
});

test('send uses official signup-in API and only transmits loginId, never local OTP', async () => {
  const { provider, calls } = mock();
  assert.deepEqual(await provider.sendVerification({ destination: ' Student@Gmail.com ', code: '654321', recipientName: 'Private Student' }), { accepted: true });
  assert.equal(calls[0].url, 'https://api.descope.com/v1/auth/otp/signup-in/email');
  assert.deepEqual(calls[0].body, { loginId: EMAIL });
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${PROJECT}`);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('invalid destination and malformed code cause no network traffic', async () => {
  const { provider, calls } = mock();
  await assert.rejects(() => provider.sendVerification({ destination: 'invalid' }), { code: 'INVALID_DESTINATION' });
  for (const evidence of ['', 'abc123', '12345', '1234567']) assert.deepEqual(await provider.verifyCode({ ...verifyInput, evidence }), { verified: false });
  assert.deepEqual(await provider.verifyCode({ evidence: '123456' }), { verified: false });
  assert.equal(calls.length, 0);
});

test('verify checks code at Descope and never exposes its tokens or user identity', async () => {
  const { provider, calls } = mock(() => Response.json(verified()));
  const result = await provider.verifyCode(verifyInput);
  assert.deepEqual(result, { verified: true });
  assert.equal(calls[0].url, 'https://api.descope.com/v1/auth/otp/verify/email');
  assert.deepEqual(calls[0].body, { loginId: EMAIL, code: '123456' });
});

for (const [name, change] of [
  ['different email', p => { p.user.email = 'other@gmail.com'; }],
  ['unverified email', p => { p.user.verifiedEmail = false; }],
  ['missing user', p => { delete p.user; }],
  ['missing user ID', p => { delete p.user.userId; }],
  ['missing session', p => { delete p.sessionJwt; }]
]) test(`Descope fails closed on ${name}`, async () => {
  const p = verified(); change(p);
  const { provider } = mock(() => Response.json(p));
  await assert.rejects(() => provider.verifyCode(verifyInput), { code: 'INVALID_PROVIDER_RESPONSE' });
});

for (const status of [400, 404, 422]) test(`wrong/expired code ${status} is rejected without leaking provider errors`, async () => {
  const { provider } = mock(() => Response.json({ secret: EMAIL }, { status }));
  assert.deepEqual(await provider.verifyCode(verifyInput), { verified: false });
});

for (const [status, failureClass] of [[401, VERIFICATION_FAILURE_CLASS.HARD], [403, VERIFICATION_FAILURE_CLASS.HARD], [429, VERIFICATION_FAILURE_CLASS.TEMPORARY], [500, VERIFICATION_FAILURE_CLASS.TEMPORARY], [302, VERIFICATION_FAILURE_CLASS.HARD]]) {
  test(`Descope classifies HTTP ${status} safely`, async () => {
    const { provider, calls } = mock(() => Response.json({ errorDescription: `${EMAIL} sensitive` }, { status }));
    await assert.rejects(() => provider.sendVerification({ destination: EMAIL }), e => e.failureClass === failureClass && !e.message.includes(EMAIL));
    assert.equal(calls.length, 1);
  });
}

test('network failure is sanitized and requests circuit cooldown instead of blind same-slot retry', async () => {
  const { provider } = mock(() => { throw new Error(`secret ${EMAIL}`); });
  await assert.rejects(() => provider.sendVerification({ destination: EMAIL }), e => e.code === 'NETWORK_ERROR' && e.retryAfter === 60 && !e.message.includes(EMAIL));
});

test('malformed, oversized, scalar and array JSON responses fail closed', async () => {
  for (const body of ['invalid json', JSON.stringify({ oversized: 'x'.repeat(33000) }), 'null', '[]', 'true']) {
    const { provider } = mock(() => new Response(body, { headers: { 'Content-Type': 'application/json' } }));
    await assert.rejects(() => provider.sendVerification({ destination: EMAIL }), { code: 'INVALID_PROVIDER_RESPONSE' });
  }
});

test('factory reads public Project ID from existing config, not a new Worker variable', async () => {
  const calls = [];
  const providers = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JSON.stringify(config) }, { fetchImpl: async (...args) => { calls.push(args); return Response.json({}); } });
  const p = providers.find(p => p.id === 'otp-l');
  assert.equal(p.projectId, PROJECT); assert.equal((await p.checkAvailability()).available, true);
  assert.equal(calls.length, 0);
  assert.equal(verificationConfig(config).providers.find(p => p.id === 'otp-l').verificationMode, 'provider-evidence');
});

const identity = { sessionToken: 's'.repeat(48), subject: 'firebase-original-uid', userId: 'usr_original_canonical_user', email: EMAIL, purpose: 'email-ownership' };
const context = { ip: '203.0.113.5', deviceId: 'original-device-123456789', origin: 'https://admissionsky.pages.dev' };
const setup = () => {
  let now = NOW;
  const { provider, calls } = mock(url => Response.json(url.includes('/verify/') ? verified() : {}));
  const repository = new MemoryVerificationRepository();
  const orchestrator = new VerificationOrchestrator({ repository, hmacSecret: 'offline-test-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ', config, providers: [provider], activated: true, now: () => now });
  return { orchestrator, repository, calls, advance: t => { now += t; } };
};

test('end-to-end mocked Descope OTP preserves canonical Firebase user and single-use local challenge', async () => {
  const { orchestrator, calls } = setup();
  const sent = await orchestrator.requestVerification(identity, context);
  const result = await orchestrator.verify({ ...identity, attemptId: sent.attemptId, code: '123456', destination: 'attacker@gmail.com' }, context);
  assert.equal(result.verified, true);
  assert.equal(result.userId, identity.userId);
  assert.equal(result.emailOwnershipProven, true);
  assert.equal(calls[1].body.loginId, EMAIL);
  assert.ok(!JSON.stringify(result).includes('mock-session'));
  await assert.rejects(() => orchestrator.verify({ ...identity, attemptId: sent.attemptId, code: '123456' }, context));
  assert.equal(calls.length, 2);
});

test('cross-email, user and device attempts never reach Descope verify API', async () => {
  const { orchestrator, calls } = setup();
  const sent = await orchestrator.requestVerification(identity, context);
  for (const other of [{ ...identity, email: 'other@gmail.com' }, { ...identity, userId: 'usr_other_canonical_user' }]) {
    await assert.rejects(() => orchestrator.verify({ ...other, attemptId: sent.attemptId, code: '123456' }, context));
  }
  await assert.rejects(() => orchestrator.verify({ ...identity, attemptId: sent.attemptId, code: '123456' }, { ...context, deviceId: 'different-device-123456' }));
  assert.equal(calls.length, 1);
});

test('expired challenge is rejected before contacting Descope', async () => {
  const { orchestrator, calls, advance } = setup();
  const sent = await orchestrator.requestVerification(identity, context);
  advance(600001);
  await assert.rejects(() => orchestrator.verify({ ...identity, attemptId: sent.attemptId, code: '123456' }, context));
  assert.equal(calls.length, 1);
});

test('five wrong OTPs lock the local challenge; verification never triggers resend', async () => {
  const calls = [];
  const provider = new DescopeOtpVerificationProvider({ projectId: PROJECT, declaredDailyQuota: 1000, fetchImpl: async (url, init) => { calls.push(url); return url.includes('/verify/') ? Response.json({}, { status: 400 }) : Response.json({}); } });
  const orchestrator = new VerificationOrchestrator({ repository: new MemoryVerificationRepository(), hmacSecret: 'offline-test-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ', config, providers: [provider], activated: true, now: () => NOW });
  const sent = await orchestrator.requestVerification(identity, context);
  for (let i = 0; i < 5; i++) await assert.rejects(() => orchestrator.verify({ ...identity, attemptId: sent.attemptId, code: '111111' }, context));
  const before = calls.length;
  await assert.rejects(() => orchestrator.verify({ ...identity, attemptId: sent.attemptId, code: '123456' }, context));
  assert.equal(calls.length, before);
  assert.equal(calls.filter(u => u.includes('/signup-in/')).length, 1);
});
