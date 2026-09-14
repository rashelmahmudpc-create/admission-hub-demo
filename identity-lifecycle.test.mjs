import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_STATES,
  SESSION_USABLE_STATES,
  DEACTIVATION_POLICY,
  normalizeAccountStatus,
  canTransition,
  transitionAccount,
  isSessionUsable
} from './auth-native/core/account-lifecycle.mjs';
import {
  KNOWN_IDENTITY_PROVIDERS,
  reconcileIdentitySnapshot,
  summarizeIdentityHealth
} from './auth-native/core/identity-reconciliation.mjs';
import { AUTH_ERROR_CODES, NativeAuthError } from './auth-native/core/errors.mjs';

const user = (id, status = 'active') => ({ id, status, emailRef: `ref-${id}`, createdAt: 1 });
const identity = (provider, subjectRef, userId) => ({ provider, subjectRef, userId });

test('canonical state set matches the blueprint', () => {
  assert.deepEqual([...ACCOUNT_STATES].sort(), [
    'active', 'deactivated', 'provisioning', 'recovery', 'restricted', 'suspended', 'verification_required'
  ]);
  assert.deepEqual(SESSION_USABLE_STATES, ['active']);
});

test('normalizes legacy and noisy statuses', () => {
  assert.equal(normalizeAccountStatus('active'), 'active');
  assert.equal(normalizeAccountStatus('DISABLED'), 'suspended');
  assert.equal(normalizeAccountStatus('  verification_required '), 'verification_required');
  assert.throws(() => normalizeAccountStatus('bogus'), NativeAuthError);
  assert.throws(() => normalizeAccountStatus(null), NativeAuthError);
});

test('full transition matrix: every state pair is classified correctly', () => {
  const expected = {
    provisioning: new Set(['verification_required', 'active', 'restricted', 'suspended', 'deactivated']),
    verification_required: new Set(['active', 'restricted', 'suspended', 'deactivated']),
    active: new Set(['verification_required', 'restricted', 'suspended', 'recovery', 'deactivated']),
    restricted: new Set(['active', 'suspended', 'deactivated']),
    suspended: new Set(['active', 'recovery', 'deactivated']),
    recovery: new Set(['active', 'suspended', 'deactivated']),
    deactivated: new Set(['recovery'])
  };
  for (const from of ACCOUNT_STATES) {
    for (const to of ACCOUNT_STATES) {
      if (from === to) {
        assert.equal(canTransition(from, to), true, `${from} -> ${to} (self)`);
        assert.equal(transitionAccount(from, to), to, `${from} -> ${to} (self)`);
        continue;
      }
      const allowed = expected[from].has(to);
      assert.equal(canTransition(from, to), allowed, `${from} -> ${to}`);
      if (allowed) {
        assert.equal(transitionAccount(from, to), to, `${from} -> ${to} (apply)`);
      } else {
        assert.throws(() => transitionAccount(from, to), NativeAuthError, `${from} -> ${to} must reject`);
      }
    }
  }
});

test('illegal transitions throw the normalized identity error', () => {
  assert.throws(() => transitionAccount('active', 'provisioning'), err => err.code === AUTH_ERROR_CODES.ACCOUNT_STATE_INVALID);
  assert.throws(() => transitionAccount('deactivated', 'active'), NativeAuthError);
  assert.throws(() => transitionAccount('verification_required', 'recovery'), NativeAuthError);
  assert.throws(() => transitionAccount('bogus', 'active'), NativeAuthError);
});

test('legacy alias transitions behave canonically', () => {
  assert.equal(canTransition('disabled', 'active'), true);
  assert.equal(transitionAccount('disabled', 'recovery'), 'recovery');
  assert.equal(isSessionUsable('disabled'), false);
});

test('session usability is exactly the live contract: only active', () => {
  for (const state of ACCOUNT_STATES) {
    assert.equal(isSessionUsable(state), state === 'active', state);
  }
  assert.equal(isSessionUsable('active'), true);
  assert.equal(isSessionUsable('bogus'), false);
});

test('deactivation policy freezes the ownership contract', () => {
  assert.equal(DEACTIVATION_POLICY.retainsIdentity, true);
  assert.equal(DEACTIVATION_POLICY.revokesSessions, true);
  assert.equal(DEACTIVATION_POLICY.userIdNeverReused, true);
  assert.equal(DEACTIVATION_POLICY.reactivationPath, 'recovery');
});

test('known provider set is frozen and minimal', () => {
  assert.deepEqual(KNOWN_IDENTITY_PROVIDERS, ['firebase']);
  assert.ok(Object.isFrozen(KNOWN_IDENTITY_PROVIDERS));
});

const healthySnapshot = () => ({
  users: [user('u1'), user('u2')],
  externalIdentities: [identity('firebase', 'sub-1', 'u1'), identity('firebase', 'sub-2', 'u2')]
});

test('healthy snapshot reconciles clean', () => {
  const result = reconcileIdentitySnapshot(healthySnapshot());
  assert.equal(result.health.ok, true);
  assert.deepEqual(result.findings, []);
  assert.equal(result.totals.users, 2);
  assert.equal(result.totals.externalIdentities, 2);
});

test('detects orphan external identity', () => {
  const result = reconcileIdentitySnapshot({
    users: [user('u1')],
    externalIdentities: [identity('firebase', 'sub-1', 'u1'), identity('firebase', 'sub-gone', 'u-missing')]
  });
  assert.equal(result.health.ok, false);
  assert.equal(result.counts['orphan-external-identity'], 1);
  assert.equal(result.health.checks['identity.mapping'].ok, false);
});

test('detects orphan user', () => {
  const result = reconcileIdentitySnapshot({
    users: [user('u1'), user('u2')],
    externalIdentities: [identity('firebase', 'sub-1', 'u1')]
  });
  assert.equal(result.counts['orphan-user'], 1);
  assert.equal(result.health.checks['identity.account'].ok, false);
});

test('detects duplicate provider identity across users', () => {
  const result = reconcileIdentitySnapshot({
    users: [user('u1'), user('u2')],
    externalIdentities: [identity('firebase', 'sub-1', 'u1'), identity('firebase', 'sub-1', 'u2')]
  });
  assert.equal(result.counts['duplicate-provider-identity'], 1);
});

test('detects unknown provider rows', () => {
  const result = reconcileIdentitySnapshot({
    users: [user('u1')],
    externalIdentities: [identity('firebase', 'sub-1', 'u1'), identity('acme', 'x-1', 'u1')]
  });
  assert.equal(result.counts['unknown-provider'], 1);
  assert.equal(result.health.checks['identity.security'].ok, false);
});

test('detects invalid user status and unknown statuses', () => {
  const result = reconcileIdentitySnapshot({
    users: [user('u1', 'half-active'), user('u2', 'disabled')],
    externalIdentities: [identity('firebase', 'sub-1', 'u1'), identity('firebase', 'sub-2', 'u2')]
  });
  assert.equal(result.counts['invalid-user-status'], 1); // only 'half-active'
  assert.ok(result.findings.every(f => f.userId !== 'u2')); // legacy 'disabled' is valid via alias
});

test('empty snapshot is healthy (fresh authority)', () => {
  const result = reconcileIdentitySnapshot({ users: [], externalIdentities: [] });
  assert.equal(result.health.ok, true);
});

test('summary is count/flag-only: no raw subjects or secrets leak', () => {
  const summary = summarizeIdentityHealth(reconcileIdentitySnapshot({
    users: [user('u1')],
    externalIdentities: [identity('firebase', 'secret-subject-value', 'u-missing')]
  }));
  const text = JSON.stringify(summary);
  assert.doesNotMatch(text, /secret-subject-value/);
  assert.equal(summary.ok, false);
  assert.equal(summary.users, 1);
  assert.equal(summary.findings['orphan-external-identity'], 1);
});

test('malformed rows are classified, never crash reconciliation', () => {
  const result = reconcileIdentitySnapshot({
    users: [null, { status: 'active' }, user('u1')],
    externalIdentities: [null, { userId: 'u1' }, identity('firebase', 'sub-1', 'u1')]
  });
  assert.equal(result.counts['invalid-user'], 2);
  assert.equal(result.counts['invalid-identity'], 2);
  assert.equal(result.health.checks['identity.authority'].ok, true);
});
