import test from 'node:test';
import assert from 'node:assert/strict';
import { SECURITY_CONFIG, SECURITY_POLICY_VERSION, resolveSecurityConfig } from './auth-native/core/security-config.mjs';
import { SECURITY_RISK_LEVELS, evaluateRisk, cooldownForFailure, resolveFailSafe } from './auth-native/core/security-policy.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

const cleanSignals = {
  accountState: 'active',
  failedLogins: 0,
  rapidRequests: 0,
  newDevice: false,
  recoveryActive: false,
  unverifiedAccount: false
};

test('security config is frozen and immutable', () => {
  assert.ok(Object.isFrozen(SECURITY_CONFIG), 'config must be frozen');
  assert.throws(() => { SECURITY_CONFIG.challengeTtlMs = 1; }, TypeError);
  assert.equal(SECURITY_CONFIG.challengeTtlMs, 15 * MIN_MS);
  assert.deepEqual([...SECURITY_CONFIG.challengeMethods], ['email', 'telegram', 'passkey']);
  assert.equal(SECURITY_CONFIG.trustTtlMs, 30 * DAY_MS);
  assert.equal(SECURITY_CONFIG.trustMaxDevicesPerUser, 10);
  assert.equal(SECURITY_CONFIG.cooldownThresholdFailures, 5);
  assert.deepEqual([...SECURITY_CONFIG.cooldownStepsMs], [5 * MIN_MS, 15 * MIN_MS, 60 * MIN_MS]);
  assert.equal(SECURITY_POLICY_VERSION, 'security-policy-v1');
});

test('resolveSecurityConfig is override-safe: bad input falls back to defaults', () => {
  assert.equal(resolveSecurityConfig(undefined), SECURITY_CONFIG);
  assert.equal(resolveSecurityConfig(''), SECURITY_CONFIG);
  assert.equal(resolveSecurityConfig('not-json'), SECURITY_CONFIG);
  assert.equal(resolveSecurityConfig(42), SECURITY_CONFIG);
  assert.equal(resolveSecurityConfig({ challengeTtlMs: -5 }), SECURITY_CONFIG, 'non-positive number rejected');
  assert.equal(resolveSecurityConfig({ policyVersion: '' }), SECURITY_CONFIG, 'empty string rejected');
  assert.deepEqual(resolveSecurityConfig({ unknown: true }), SECURITY_CONFIG, 'unknown keys ignored');
  assert.deepEqual(
    resolveSecurityConfig({ riskSessionPolicy: { HIGH: { sessionTtlMs: 1 } } }),
    SECURITY_CONFIG,
    'nested policy tables are never overrideable in v1'
  );
});

test('resolveSecurityConfig accepts safe scalar overrides only', () => {
  const overridden = resolveSecurityConfig(JSON.stringify({ challengeTtlMs: 30 }));
  assert.equal(overridden.challengeTtlMs, 30);
  assert.equal(overridden.trustTtlMs, SECURITY_CONFIG.trustTtlMs, 'untouched knobs keep defaults');
  assert.ok(Object.isFrozen(overridden));
});

test('clean login on a known device stays NORMAL and proceeds', () => {
  const result = evaluateRisk(cleanSignals);
  assert.equal(result.level, 'NORMAL');
  assert.deepEqual(result.reasons, []);
  assert.equal(result.actions.proceed, true);
  assert.equal(result.actions.challenge, null);
  assert.equal(result.actions.block, false);
  assert.equal(result.actions.sessionTtlMs, SECURITY_CONFIG.riskSessionPolicy.NORMAL.sessionTtlMs);
  assert.equal(result.actions.trustOffer, true);
  assert.equal(result.policyVersion, SECURITY_POLICY_VERSION);
});

test('a new device alone is ELEVATED with a new-device challenge and trust offer', () => {
  const result = evaluateRisk({ ...cleanSignals, newDevice: true });
  assert.equal(result.level, 'ELEVATED');
  assert.deepEqual(result.reasons, ['new-device']);
  assert.equal(result.actions.proceed, false);
  assert.equal(result.actions.challenge, 'new-device');
  assert.equal(result.actions.block, false);
  assert.equal(result.actions.trustOffer, true);
});

test('failed logins escalate by count; one signal alone is capped at ELEVATED', () => {
  const three = evaluateRisk({ ...cleanSignals, failedLogins: 3 });
  assert.equal(three.level, 'ELEVATED');
  assert.deepEqual(three.reasons, ['failed-logins-elevated']);

  const eight = evaluateRisk({ ...cleanSignals, failedLogins: 8 });
  assert.equal(eight.level, 'ELEVATED', 'one signal alone never exceeds ELEVATED');
  assert.deepEqual(eight.reasons, ['failed-logins-high']);
});

test('rapid auth requests alone are ELEVATED, never more', () => {
  const result = evaluateRisk({ ...cleanSignals, rapidRequests: 25 });
  assert.equal(result.level, 'ELEVATED');
  assert.deepEqual(result.reasons, ['rapid-requests']);
});

test('two independent behaviours escalate one step to HIGH with a step-up challenge', () => {
  const result = evaluateRisk({ ...cleanSignals, newDevice: true, failedLogins: 3 });
  assert.equal(result.level, 'HIGH');
  assert.equal(result.actions.challenge, 'step-up');
  assert.equal(result.actions.sessionTtlMs, SECURITY_CONFIG.riskSessionPolicy.HIGH.sessionTtlMs, 'HIGH gets a short session');
  assert.equal(result.actions.sessionTtlMs, DAY_MS);
  assert.equal(result.actions.trustOffer, false, 'HIGH never trusts the device');
  assert.equal(result.actions.block, false);
});

test('an account fact plus any behaviour reaches at least HIGH', () => {
  const result = evaluateRisk({ ...cleanSignals, accountState: 'restricted', newDevice: true });
  assert.equal(result.level, 'HIGH');
  assert.ok(result.reasons.includes('account-restricted'));
});

test('suspended or deactivated account is CRITICAL and blocks into recovery', () => {
  for (const state of ['suspended', 'deactivated']) {
    const result = evaluateRisk({ ...cleanSignals, accountState: state, newDevice: true, failedLogins: 9, rapidRequests: 30 });
    assert.equal(result.level, 'CRITICAL');
    assert.ok(result.reasons.includes('account-disabled'));
    assert.equal(result.actions.block, true);
    assert.equal(result.actions.proceed, false);
    assert.equal(result.actions.challenge, null);
    assert.equal(result.actions.recoveryPath, true);
  }
});

test('risk results are frozen, level is always known, unverified alone is not an accusation', () => {
  const result = evaluateRisk({ ...cleanSignals, newDevice: true, unverifiedAccount: true });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.reasons));
  assert.ok(SECURITY_RISK_LEVELS.includes(result.level));
  assert.ok(result.reasons.includes('unverified-account'));

  const unverifiedAlone = evaluateRisk({ ...cleanSignals, unverifiedAccount: true });
  assert.equal(unverifiedAlone.level, 'NORMAL', 'unverified account alone must not block or step up');
  assert.equal(unverifiedAlone.actions.proceed, true);
});

test('cooldown escalates with failures but never locks an account out permanently', () => {
  const floor = SECURITY_CONFIG.cooldownThresholdFailures;
  assert.equal(cooldownForFailure(floor - 1), 0);
  assert.equal(cooldownForFailure(floor), 5 * MIN_MS);
  assert.equal(cooldownForFailure(floor + 1), 15 * MIN_MS);
  assert.equal(cooldownForFailure(floor + 2), 60 * MIN_MS);
  assert.equal(cooldownForFailure(999), 60 * MIN_MS, 'ceiling is a delay, not a lockout');
});

test('fail-safe mapping: sensitive actions are never blind-allowed, unknown classes fail toward challenge', () => {
  const low = resolveFailSafe('lowRisk');
  assert.equal(low.fallback, 'proceed');
  assert.equal(low.proceed, true);
  assert.equal(low.block, false);

  const sensitive = resolveFailSafe('sensitive');
  assert.equal(sensitive.fallback, 'challenge');
  assert.equal(sensitive.proceed, false);
  assert.equal(sensitive.challenge, true);
  assert.equal(sensitive.block, false);

  const critical = resolveFailSafe('critical');
  assert.equal(critical.fallback, 'block');
  assert.equal(critical.block, true);

  const garbage = resolveFailSafe('garbage');
  assert.equal(garbage.fallback, 'challenge', 'unknown action classes fail conservatively toward challenge');

  assert.deepEqual(Object.assign({}, SECURITY_CONFIG.failSafePolicy), { lowRisk: 'proceed', sensitive: 'challenge', critical: 'block' });
});
