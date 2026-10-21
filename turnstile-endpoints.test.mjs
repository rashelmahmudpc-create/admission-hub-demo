import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A1.5 / AU-SEC-01 L4: every public endpoint that can send an email/OTP or
// try a password must check Turnstile on the server before doing any work.
const HANDLER = readFileSync(new URL('./auth-native/worker/public-auth-handler.mjs', import.meta.url), 'utf8');
const CLIENT = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');

const ENDPOINTS = ['/signup', '/login', '/password-reset', '/email-ownership/start', '/verification/resend', '/telegram/verification/start', '/backup/request'];

const routeBlock = path => {
  const marker = "request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}" + path + '`';
  const start = HANDLER.indexOf(marker);
  assert.ok(start > 0, `route ${path} exists`);
  const next = HANDLER.indexOf('if (request.method ===', start + marker.length);
  return HANDLER.slice(start, next > 0 ? next : undefined);
};

for (const path of ENDPOINTS) {
  test(`server checks Turnstile on ${path} before any provider/authority call`, () => {
    const block = routeBlock(path);
    const check = block.indexOf('await verifyTurnstile({ env, token:');
    assert.ok(check > 0, `${path} calls verifyTurnstile`);
    for (const work of ['callAuthority(', 'provider.signUp(', 'provider.signIn(', 'provider.sendPasswordResetEmail(', 'firebaseReadySession(']) {
      const at = block.indexOf(work);
      if (at > 0) assert.ok(check < at, `${path}: Turnstile runs before ${work}`);
    }
  });
}

test('client sends a fresh Turnstile token on every guarded call', () => {
  for (const path of ['/signup', '/login', '/password-reset', '/email-ownership/start', '/verification/resend', '/telegram/verification/start', '/backup/request']) {
    const needle = `'${path}'`;
    let at = CLIENT.indexOf(needle);
    let seen = 0;
    while (at >= 0) {
      if (/(?:api|skyApi|backupApiPath)\($/.test(CLIENT.slice(Math.max(0, at - 14), at))) {
        seen += 1;
        assert.ok(CLIENT.slice(at, at + 260).includes('turnstileToken: await humanToken()'), `${path} call near offset ${at} sends a token`);
      }
      at = CLIENT.indexOf(needle, at + needle.length);
    }
    assert.ok(seen > 0, `client calls ${path}`);
  }
});
