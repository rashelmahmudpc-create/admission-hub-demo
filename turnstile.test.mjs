import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_ERROR_CODES } from './auth-native/core/errors.mjs';
import { verifyTurnstile } from './auth-native/verification/turnstile.mjs';

const secretEnv = { TURNSTILE_SECRET_KEY: 'turnstile-secret-key' };
const asJson = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('Turnstile stays inert until a secret key exists, so enabling it cannot lock signup out', async () => {
  let called = false;
  const result = await verifyTurnstile({ env: {}, token: '', fetchImpl: async () => { called = true; return asJson({ success: true }); } });
  assert.equal(result.enforced, false);
  assert.equal(called, false);
});

test('a valid token is confirmed against Cloudflare with the secret and the client IP', async () => {
  let seen;
  const result = await verifyTurnstile({
    env: secretEnv,
    token: 'good-token',
    ip: '203.0.113.7',
    fetchImpl: async (url, options) => {
      seen = { url, body: options.body };
      return asJson({ success: true });
    }
  });
  assert.equal(result.enforced, true);
  assert.equal(seen.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(seen.body.get('secret'), 'turnstile-secret-key');
  assert.equal(seen.body.get('response'), 'good-token');
  assert.equal(seen.body.get('remoteip'), '203.0.113.7');
});

test('a token Cloudflare rejects is refused', async () => {
  await assert.rejects(
    () => verifyTurnstile({ env: secretEnv, token: 'bad-token', fetchImpl: async () => asJson({ success: false, 'error-codes': ['invalid-input-response'] }) }),
    error => error?.code === AUTH_ERROR_CODES.INVALID_INPUT
  );
});

test('a missing token is refused once the secret is configured', async () => {
  let called = false;
  await assert.rejects(
    () => verifyTurnstile({ env: secretEnv, token: '', fetchImpl: async () => { called = true; return asJson({ success: true }); } }),
    error => error?.code === AUTH_ERROR_CODES.INVALID_INPUT
  );
  assert.equal(called, false, 'no siteverify call for an empty token');
});

test('a Cloudflare outage refuses the send rather than waving it through', async () => {
  await assert.rejects(
    () => verifyTurnstile({ env: secretEnv, token: 'good-token', fetchImpl: async () => { throw new Error('network down'); } }),
    error => error?.code === AUTH_ERROR_CODES.INVALID_INPUT
  );
});
