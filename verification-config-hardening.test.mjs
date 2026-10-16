import test from 'node:test';
import assert from 'node:assert/strict';
import { verificationConfig, withMissingSlotsFrom } from './auth-native/verification/config.mjs';

test('owner 2026-10-16: panel config cannot shorten the code below 10 minutes', () => {
  assert.equal(verificationConfig({ policy: { codeTtlSeconds: 300 } }).policy.codeTtlSeconds, 600);
  assert.equal(verificationConfig({}).policy.codeTtlSeconds, 600);
});

test('owner 2026-10-16: otp-f is off and Brevo waits at most 8s', () => {
  const cfg = verificationConfig({ providers: [{ id: 'otp-f', enabled: true, dailyQuota: 100 }, { id: 'otp-a', enabled: true, dailyQuota: 300, timeoutMs: 15000 }] });
  assert.equal(cfg.providers.find(row => row.id === 'otp-f').enabled, false);
  assert.equal(cfg.providers.find(row => row.id === 'otp-a').timeoutMs, 8000);
});

test('owner 2026-10-16: common student mailboxes are always allowed; an empty list stays open', () => {
  const cfg = verificationConfig({ allowedDomains: ['gmail.com'] });
  for (const domain of ['gmail.com', 'hotmail.com', 'live.com', 'ymail.com', 'yahoo.co.in']) assert.ok(cfg.allowedDomains.includes(domain), domain);
  assert.equal(new Set(cfg.allowedDomains).size, cfg.allowedDomains.length, 'no duplicates');
  assert.deepEqual(verificationConfig({ allowedDomains: [] }).allowedDomains, []);
});

test('owner 2026-10-16: slots missing from a saved panel config inherit the deployment row', () => {
  const saved = { enabled: true, providers: [{ id: 'otp-a', enabled: true, dailyQuota: 300 }] };
  const env = JSON.stringify({ enabled: true, providers: [{ id: 'otp-a', enabled: false, dailyQuota: 1 }, { id: 'otp-h', enabled: true, priority: 15, dailyQuota: 5000 }] });
  const merged = withMissingSlotsFrom(saved, env);
  assert.equal(merged.providers.find(row => row.id === 'otp-a').dailyQuota, 300, 'panel row wins');
  assert.equal(merged.providers.find(row => row.id === 'otp-h').dailyQuota, 5000, 'missing slot inherited');
  assert.equal(withMissingSlotsFrom(null, env), null);
});
