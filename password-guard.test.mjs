import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PASSWORD_GUARD_SCALES,
  guardDecision,
  recordPasswordFailure,
  recordPasswordSuccess,
  normalizeGuardState,
  createKvPasswordGuard
} from './auth-native/core/password-guard.mjs';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const user = PASSWORD_GUARD_SCALES.user;
const admin = PASSWORD_GUARD_SCALES.admin;

test('user scale: three wrong passwords in a minute cost five hours', () => {
  let state = null;
  const t0 = 1_000_000_000_000;
  let decision;
  for (let i = 0; i < 3; i += 1) {
    const result = recordPasswordFailure(state, t0 + i * 1000, user);
    state = result.state;
    decision = result.decision;
  }
  assert.equal(decision.blocked, true);
  assert.equal(decision.retryAfterMs, 5 * HOUR);
  assert.equal(decision.strikes, 1);
  assert.equal(decision.recoveryRequired, true);
});

test('user scale: two failures inside the minute do not block', () => {
  let state = null;
  for (let i = 0; i < 2; i += 1) {
    state = recordPasswordFailure(state, 1_000_000_000_000 + i * 1000, user).state;
  }
  const decision = guardDecision(state, 1_000_000_000_000 + 2000, user);
  assert.equal(decision.blocked, false);
  assert.equal(decision.attemptsRemaining, 1);
});

test('user scale: after the five hours two more chances, then a day', () => {
  let state = null;
  const t0 = 1_000_000_000_000;
  for (let i = 0; i < 3; i += 1) state = recordPasswordFailure(state, t0 + i * 1000, user).state;

  const afterBlock = state.until + 1000;
  const first = recordPasswordFailure(state, afterBlock, user);
  state = first.state;
  assert.equal(first.decision.blocked, false, 'the block expires on its own');
  assert.equal(first.decision.strikes, 1, 'the strike ladder is kept');

  const second = recordPasswordFailure(state, afterBlock + 1000, user);
  state = second.state;
  assert.equal(second.decision.blocked, true);
  assert.equal(second.decision.retryAfterMs, 1 * DAY);
  assert.equal(second.decision.strikes, 2);
});

test('user scale: a fresh window forgets earlier failures', () => {
  let state = null;
  const t0 = 1_000_000_000_000;
  state = recordPasswordFailure(state, t0, user).state;
  state = recordPasswordFailure(state, t0 + 1000, user).state;
  const later = recordPasswordFailure(state, t0 + 2 * MINUTE, user);
  assert.equal(later.decision.blocked, false);
  assert.equal(later.state.fails, 1, 'the old two fell outside the window');
});

test('admin scale: every wrong password escalates 5m, 7h, 2d, 7d', () => {
  let state = null;
  let now = 1_000_000_000_000;
  const expected = [5 * MINUTE, 7 * HOUR, 2 * DAY, 7 * DAY, 7 * DAY];
  for (const duration of expected) {
    const result = recordPasswordFailure(state, now, admin);
    state = result.state;
    assert.equal(result.decision.retryAfterMs, duration);
    assert.equal(result.decision.blocked, true);
    now += duration + 1000;
  }
});

test('admin scale: a wrong password during a block does not extend it', () => {
  const t0 = 1_000_000_000_000;
  const first = recordPasswordFailure(null, t0, admin);
  const during = recordPasswordFailure(first.state, t0 + 1000, admin);
  assert.equal(during.escalated, false);
  assert.equal(during.decision.retryAfterMs, 5 * MINUTE - 1000, 'the clock is not pushed back');
});

test('a correct password during a block clears nothing', () => {
  const t0 = 1_000_000_000_000;
  const blocked = recordPasswordFailure(null, t0, admin).state;
  const after = recordPasswordSuccess(blocked, t0 + 1000, admin);
  assert.equal(after.until, blocked.until, 'the block survives a correct guess');
  assert.equal(guardDecision(after, t0 + 1000, admin).blocked, true);
});

test('a correct password outside a block resets the ladder', () => {
  const t0 = 1_000_000_000_000;
  let state = null;
  for (let i = 0; i < 3; i += 1) state = recordPasswordFailure(state, t0 + i * 1000, user).state;
  const cleared = recordPasswordSuccess(state, state.until + 1000, user);
  assert.equal(cleared.strikes, 0);
  assert.equal(cleared.fails, 0);
});

test('a malformed stored record fails closed to the empty state', () => {
  assert.deepEqual(normalizeGuardState('not json'), { fails: 0, windowStartedAt: 0, strikes: 0, until: 0, lastAt: 0 });
  assert.deepEqual(normalizeGuardState({ fails: -5, until: 'x' }), { fails: 0, windowStartedAt: 0, strikes: 0, until: 0, lastAt: 0 });
  assert.equal(guardDecision(null, Date.now(), admin).blocked, false);
});

test('the kv guard tracks the account and the ip separately', async () => {
  const store = new Map();
  const kv = {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    }
  };
  let now = 1_000_000_000_000;
  const guard = createKvPasswordGuard(kv, { now: () => now });

  const identities = [
    { scope: 'account', identity: 'a@example.com' },
    { scope: 'ip', identity: '203.0.113.7' }
  ];
  const first = await guard.recordFailure(identities, admin);
  assert.equal(first.blocked, true);

  const sameAccount = await guard.check([{ scope: 'account', identity: 'a@example.com' }], admin);
  assert.equal(sameAccount.blocked, true, 'the account counter is blocked');

  const otherIp = await guard.check([{ scope: 'ip', identity: '198.51.100.9' }], admin);
  assert.equal(otherIp.blocked, false, 'a fresh ip is not blocked by the account block');

  const otherAccount = await guard.check([{ scope: 'account', identity: 'b@example.com' }], admin);
  assert.equal(otherAccount.blocked, false, 'a shared ip does not block a second account');

  now += 5 * MINUTE + 1000;
  await guard.recordSuccess(identities, admin);
  const cleared = await guard.check(identities, admin);
  assert.equal(cleared.blocked, false, 'the recovery path can clear the counters');
});
