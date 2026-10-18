import test from 'node:test';
import assert from 'node:assert/strict';
import { DescopeMagicLinkVerificationProvider, DescopeOtpVerificationProvider, createConfiguredVerificationProviders, DESCOPE_MAGIC_LINK_URI } from './auth-native/verification/providers.mjs';
import { assertVerificationProvider } from './auth-native/verification/provider-contract.mjs';
import { VerificationOrchestrator } from './auth-native/verification/orchestrator.mjs';
import { MemoryVerificationRepository } from './auth-native/verification/memory-verification-repository.mjs';

const PROJECT = 'P0123456789012345678901234567';
const EMAIL = 'student@gmail.com';
const NOW = 1800000000000;
const TOKEN = 'mockMagicToken_0123456789abcdef';
const slotM = { id: 'otp-m', enabled: true, priority: 38, dailyQuota: 1000, timeoutMs: 12000, projectId: PROJECT };
const slotL = { ...slotM, id: 'otp-l' };
const verified = (email = EMAIL, ok = true) => ({ sessionJwt: 'mock-session-do-not-expose', refreshJwt: 'mock-refresh-do-not-expose', user: { userId: 'mock-user', email, verifiedEmail: ok } });
const mk = (Cls, handler, calls) => new Cls({ projectId: PROJECT, declaredDailyQuota: 1000, now: () => NOW, fetchImpl: async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return handler(url, init); } });

test('magic link provider honours the provider contract and is opt-in', async () => {
  const calls = [];
  const p = mk(DescopeMagicLinkVerificationProvider, () => Response.json({}), calls);
  assert.equal(assertVerificationProvider(p), p);
  assert.equal(p.id, 'otp-m');
  const off = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: '' }).find(x => x.id === 'otp-m');
  assert.equal((await off.checkAvailability()).available, false);
  const on = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JSON.stringify({ enabled: true, providers: [slotM] }) }).find(x => x.id === 'otp-m');
  assert.equal(on.projectId, PROJECT);
  assert.equal(calls.length, 0);
});

test('send posts signup-in/email with loginId and fixed URI, Bearer = projectId only', async () => {
  const calls = [];
  const p = mk(DescopeMagicLinkVerificationProvider, () => Response.json({ maskedEmail: 's***@gmail.com' }), calls);
  assert.deepEqual(await p.sendVerification({ destination: EMAIL, code: '123456', linkToken: 'local' }), { accepted: true });
  assert.equal(calls[0].url, 'https://api.descope.com/v1/auth/magiclink/signup-in/email');
  assert.deepEqual(calls[0].body, { loginId: EMAIL, URI: DESCOPE_MAGIC_LINK_URI });
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${PROJECT}`);
  assert.equal(DESCOPE_MAGIC_LINK_URI, 'https://admissionsky.pages.dev/?magic=1');
});

test('verify requires verifiedEmail===true and the exact bound email; tokens never returned', async () => {
  for (const [body, expected] of [[verified(), true], [verified('other@gmail.com'), 'throw'], [verified(EMAIL, false), 'throw']]) {
    const calls = [];
    const p = mk(DescopeMagicLinkVerificationProvider, () => Response.json(body), calls);
    if (expected === 'throw') await assert.rejects(() => p.verifyCode({ destination: EMAIL, evidence: TOKEN }));
    else {
      const r = await p.verifyCode({ destination: EMAIL, evidence: TOKEN });
      assert.deepEqual(r, { verified: true });
      assert.ok(!JSON.stringify(r).includes('mock-session'));
    }
    assert.equal(calls[0].url, 'https://api.descope.com/v1/auth/magiclink/verify');
    assert.deepEqual(calls[0].body, { token: TOKEN });
  }
  const calls = [];
  const p = mk(DescopeMagicLinkVerificationProvider, () => new Response('', { status: 401 }), calls);
  assert.deepEqual(await p.verifyCode({ destination: EMAIL, evidence: TOKEN }), { verified: false });
  assert.deepEqual(await p.verifyCode({ destination: EMAIL, evidence: 'bad token!' }), { verified: false });
  assert.equal(calls.length, 1);
});

const identity = { sessionToken: 's'.repeat(48), subject: 'firebase-uid', userId: 'usr_original_canonical_user', email: EMAIL, purpose: 'email-ownership' };
const context = { ip: '203.0.113.5', deviceId: 'original-device-123456789', origin: 'https://admissionsky.pages.dev' };
const setup = () => {
  const calls = [];
  const handler = url => Response.json(url.endsWith('/verify') || url.includes('/verify/') ? verified() : {});
  const m = mk(DescopeMagicLinkVerificationProvider, handler, calls);
  const l = mk(DescopeOtpVerificationProvider, handler, calls);
  const orchestrator = new VerificationOrchestrator({ repository: new MemoryVerificationRepository(), hmacSecret: 'offline-test-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ', config: { enabled: true, providers: [slotL, slotM] }, providers: [l, m], activated: true, now: () => NOW });
  return { orchestrator, calls };
};

test('code requests never use otp-m; magic-link requests only use otp-m', async () => {
  const a = setup();
  await a.orchestrator.requestVerification(identity, context);
  assert.ok(a.calls[0].url.includes('/otp/'));
  const b = setup();
  const sent = await b.orchestrator.requestVerification({ ...identity, deliveryMethod: 'magic-link' }, context);
  assert.ok(b.calls[0].url.endsWith('/magiclink/signup-in/email'));
  const result = await b.orchestrator.verify({ ...identity, attemptId: sent.attemptId, code: TOKEN }, context);
  assert.equal(result.verified, true);
  assert.equal(result.emailOwnershipProven, true);
  assert.equal(b.calls[1].body.token, TOKEN);
  assert.ok(!JSON.stringify(result).includes('mock-session'));
  await assert.rejects(() => b.orchestrator.verify({ ...identity, attemptId: sent.attemptId, code: TOKEN }, context));
});
