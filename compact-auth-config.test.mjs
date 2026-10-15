import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createConfiguredVerificationProviders } from './auth-native/verification/providers.mjs';
const text = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
const packed = text.match(/^VERIFICATION_ORCHESTRATOR_CONFIG = '(.*)'$/m)?.[1];
const slot = JSON.parse(packed).providers.find(row => row.id === 'otp-h');
const provider = env => createConfiguredVerificationProviders(env).find(row => row.id === 'otp-h');

test('compact configuration keeps Logto identity, quota and all existing mailer caps', () => {
  const p = provider({ VERIFICATION_ORCHESTRATOR_CONFIG: packed });
  assert.equal(p.configured, true);
  assert.equal(p.endpoint, 'https://dl635v.logto.app');
  assert.equal(p.appId, 'dk00yf3jvdmyy4mduoizp');
  assert.equal(p.redirectUri, 'https://admissionsky.pages.dev/logto-callback');
  assert.equal(p.declaredDailyQuota, 1000);
  assert.equal(p.declaredDailyQuota, slot.dailyQuota);
  for (const [name, quota] of Object.entries({ A: 300, B: 100, C: 200, D: 100, E: 100, F: 100, G: 150 })) {
    assert.match(text, new RegExp(`^OTP_${name}_DAILY_QUOTA = "${quota}"$`, 'm'));
  }
  assert.doesNotMatch(text, /^(?:LOGTO_ENDPOINT|LOGTO_APP_ID|LOGTO_REDIRECT_URI|OTP_H_DAILY_QUOTA)\s*=/m);
});

test('explicit environment overrides remain authoritative', () => {
  const p = provider({ VERIFICATION_ORCHESTRATOR_CONFIG: packed, LOGTO_ENDPOINT: 'https://override.logto.app', OTP_H_DAILY_QUOTA: '7' });
  assert.equal(p.endpoint, 'https://override.logto.app');
  assert.equal(p.declaredDailyQuota, 7);
});

test('missing, malformed and disabled compact config never activates a provider', () => {
  for (const raw of [undefined, '{', '{}', JSON.stringify({ enabled: false, providers: [slot] }), JSON.stringify({ enabled: true, providers: [{ ...slot, enabled: false }] })]) {
    assert.equal(provider({ VERIFICATION_ORCHESTRATOR_CONFIG: raw }).configured, false);
  }
});
