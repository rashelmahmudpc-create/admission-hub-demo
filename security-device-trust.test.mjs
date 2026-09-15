import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CloudflareNativeAuthEngine,
  REMEMBER_OFF_TTL_MS,
  SESSION_TTL_MS
} from './auth-native/core/auth-engine.mjs';
import { AUTH_ERROR_CODES } from './auth-native/core/errors.mjs';
import { MemoryAuthRepository } from './auth-native/testing/memory-auth-repository.mjs';
import { SECURITY_CONFIG, SECURITY_POLICY_VERSION } from './auth-native/core/security-config.mjs';

const SECRET = 'security-trust-test-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXY';
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

const setup = (start = 1_800_000_000_000) => {
  let now = start;
  const repository = new MemoryAuthRepository();
  const engine = new CloudflareNativeAuthEngine({ repository, hmacSecret: SECRET, now: () => now });
  const context = { ip: '203.0.113.9', deviceId: 'device-security-test-0123456789', userAgent: 'Mozilla/5.0 Windows Chrome/140', origin: 'https://admissionhub.pages.dev' };
  return { repository, engine, context, now: () => now, advance: ms => { now += ms; } };
};

const loginInput = (email, subject, extra = {}) => ({
  email,
  subject,
  remember: true,
  verified: true,
  newDevice: true,
  securityChallenge: true,
  ...extra
});

test('trusted device fast path: a trusted device is never challenged again', async () => {
  const state = setup();
  const email = 'trusted@example.com';
  const subject = 'uid-trusted-device';
  // First login on a brand-new device: challenged, no session.
  const first = await state.engine.establishFirebaseSession(loginInput(email, subject), state.context);
  assert.equal(first.challenge?.type, 'new-device');
  assert.equal(first.sessionToken, undefined);
  assert.equal(state.repository.snapshot().sessions.length, 0);

  // A session exists once the challenge is completed (or the route does not
  // gate); trust is then registered for the device.
  const session = await state.engine.establishFirebaseSession(loginInput(email, subject, { securityChallenge: false }), state.context);
  const registered = await state.engine.trustCurrentDevice({ sessionToken: session.sessionToken, email, subject }, state.context);
  assert.equal(registered.trusted, true);
  assert.equal(registered.expiresAt - state.now(), SECURITY_CONFIG.trustTtlMs);

  // Now the same "new device" logs in again: trusted fast path, full 30-day session.
  const again = await state.engine.establishFirebaseSession(loginInput(email, subject), state.context);
  assert.equal(again.challenge, undefined);
  assert.equal(again.security.trusted, true);
  assert.equal(again.security.level, 'NORMAL');
  assert.equal(again.sessionExpiresAt - state.now(), SESSION_TTL_MS);
});

test('trust expires: after the TTL the same device is challenged again', async () => {
  const state = setup();
  const email = 'expiry@example.com';
  const subject = 'uid-trust-expiry';
  const session = await state.engine.establishFirebaseSession(loginInput(email, subject, { securityChallenge: false }), state.context);
  await state.engine.trustCurrentDevice({ sessionToken: session.sessionToken, email, subject }, state.context);

  state.advance(SECURITY_CONFIG.trustTtlMs - 1);
  const before = await state.engine.establishFirebaseSession(loginInput(email, subject), state.context);
  assert.equal(before.challenge, undefined, 'trust still valid just before expiry');

  state.advance(2);
  const after = await state.engine.establishFirebaseSession(loginInput(email, subject), state.context);
  assert.equal(after.challenge?.type, 'new-device', 'expired trust is treated as an untrusted device again');
});

test('revocation: current, by-ref and all are user-scoped and audited', async () => {
  const state = setup();
  const email = 'revoke@example.com';
  const subject = 'uid-revoke';
  const session = await state.engine.establishFirebaseSession(loginInput(email, subject, { securityChallenge: false }), state.context);
  await state.engine.trustCurrentDevice({ sessionToken: session.sessionToken, email, subject }, state.context);
  let devices = await state.engine.getSecurityState({ sessionToken: session.sessionToken, email, subject }, state.context);
  assert.equal(devices.devices.length, 1);
  assert.equal(devices.currentDeviceTrusted, true);

  const otherDevice = `device-ref-to-revoke-${'x'.repeat(24)}`;
  // by-ref on an unknown ref revokes nothing
  const unknown = await state.engine.revokeTrustedDevice({ sessionToken: session.sessionToken, email, subject, deviceRef: otherDevice }, state.context);
  assert.equal(unknown.revoked, 0);

  const current = await state.engine.revokeTrustedDevice({ sessionToken: session.sessionToken, email, subject, scope: 'current' }, state.context);
  assert.equal(current.revoked, 1);
  devices = await state.engine.getSecurityState({ sessionToken: session.sessionToken, email, subject }, state.context);
  assert.equal(devices.devices.length, 0);
  assert.equal(devices.currentDeviceTrusted, false);

  // multi-device: trust two, revoke all
  await state.engine.trustCurrentDevice({ sessionToken: session.sessionToken, email, subject }, state.context);
  const secondContext = { ...state.context, deviceId: 'device-security-test-second-0123456' };
  await state.engine.trustCurrentDevice({ sessionToken: session.sessionToken, email, subject }, secondContext);
  const before = await state.engine.getSecurityState({ sessionToken: session.sessionToken, email, subject }, state.context);
  assert.equal(before.devices.length, 2);
  const all = await state.engine.revokeTrustedDevice({ sessionToken: session.sessionToken, email, subject, scope: 'all' }, state.context);
  assert.equal(all.revoked, 2);
  const events = state.repository.snapshot().events.filter(row => row.type === 'device-revoked');
  assert.equal(events.length, 2);
});

test('device trust cap: the oldest device is evicted when the 10-device limit is exceeded', async () => {
  const state = setup();
  const email = 'cap@example.com';
  const subject = 'uid-cap';
  const session = await state.engine.establishFirebaseSession(loginInput(email, subject, { securityChallenge: false }), state.context);
  for (let index = 0; index < 11; index += 1) {
    const context = { ...state.context, deviceId: `device-cap-${String(index).padStart(2, '0')}-0123456789` };
    await state.engine.trustCurrentDevice({ sessionToken: session.sessionToken, email, subject }, context);
    state.advance(1000);
  }
  const result = await state.engine.getSecurityState({ sessionToken: session.sessionToken, email, subject }, state.context);
  assert.equal(result.devices.length, SECURITY_CONFIG.trustMaxDevicesPerUser);
  const evicted = state.repository.snapshot().events.filter(row => row.type === 'device-trust-evicted');
  assert.ok(evicted.length >= 1);
});

test('new-device challenge path issues no session and is purpose-bound to new-device', async () => {
  const state = setup();
  const email = 'challenge@example.com';
  const subject = 'uid-challenge';
  const first = await state.engine.establishFirebaseSession(loginInput(email, subject), state.context);
  assert.equal(first.challenge?.type, 'new-device');
  assert.equal(first.challenge.level, 'ELEVATED');
  assert.equal(first.challenge.policyVersion, SECURITY_POLICY_VERSION);
  assert.equal(state.repository.snapshot().sessions.length, 0);
  assert.equal(state.repository.snapshot().users.length, 0, 'no local user is created by a challenged login');

  // Completing the purpose-bound ticket issues the session and the trust.
  const prepared = await state.engine.beginFirebaseAccountVerification({
    email,
    subject,
    refreshToken: `refresh-${'y'.repeat(40)}`,
    purpose: 'new-device'
  }, state.context);
  const completed = await state.engine.completeFirebaseAccountVerification({
    verificationTicket: prepared.verificationTicket,
    email,
    subject
  }, state.context);
  assert.equal(completed.trusted, true, 'completing a new-device challenge is the trust consent');
  const rows = state.repository.snapshot().trustedDevices;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].expiresAt - rows[0].trustedAt, SECURITY_CONFIG.trustTtlMs);

  const next = await state.engine.establishFirebaseSession(loginInput(email, subject), state.context);
  assert.equal(next.challenge, undefined);
  assert.equal(next.security.trusted, true);
});

test('challenge is opt-in per route: without securityChallenge the same risk shortens nothing for a lone signal', async () => {
  const state = setup();
  const email = 'nochallenge@example.com';
  const subject = 'uid-no-challenge';
  const result = await state.engine.establishFirebaseSession(loginInput(email, subject, { securityChallenge: false }), state.context);
  assert.equal(result.challenge, undefined);
  assert.ok(result.sessionToken);
  assert.equal(result.security.trustOffer, true);
  assert.equal(result.sessionExpiresAt - state.now(), SESSION_TTL_MS);
});

test('HIGH risk (new device + repeated failures) shortens the session to 24h and offers no trust', async () => {
  const state = setup();
  const email = 'highrisk@example.com';
  const subject = 'uid-high-risk';
  for (let index = 0; index < 3; index += 1) {
    await state.engine.recordLoginFailure({ email }, state.context);
  }
  const result = await state.engine.establishFirebaseSession(loginInput(email, subject, { securityChallenge: false }), state.context);
  assert.equal(result.challenge, undefined);
  assert.equal(result.security.level, 'HIGH');
  assert.equal(result.sessionExpiresAt - state.now(), 24 * HOUR_MS());
  assert.equal(result.security.trustOffer, false);
});

function HOUR_MS() { return 60 * MIN_MS; }

test('CRITICAL account state blocks login even on a trusted device', async () => {
  const state = setup();
  const email = 'suspended@example.com';
  const subject = 'uid-suspended';
  const session = await state.engine.establishFirebaseSession(loginInput(email, subject, { securityChallenge: false }), state.context);
  const user = state.repository.snapshot().users[0];
  await state.engine.trustCurrentDevice({ sessionToken: session.sessionToken, email, subject }, state.context);
  await state.repository.setAccountState({ userId: user.id, toStatus: 'suspended', now: state.now() });

  await assert.rejects(
    () => state.engine.establishFirebaseSession(loginInput(email, subject), state.context),
    error => error?.code === AUTH_ERROR_CODES.ACCOUNT_DISABLED
  );
});

test('fail-safe: when risk evaluation cannot complete, the login fails toward a challenge, never a silent proceed', async () => {
  const state = setup();
  const email = 'failsafe@example.com';
  const subject = 'uid-fail-safe';
  state.repository.getLoginRiskSignals = async () => { throw new Error('storage blip'); };
  const result = await state.engine.establishFirebaseSession(loginInput(email, subject), state.context);
  assert.equal(result.challenge?.type, 'new-device', 'sensitive action falls toward challenge');
  assert.equal(state.repository.snapshot().sessions.length, 0);
  assert.equal(state.repository.snapshot().users.length, 0);
});

test('multi-device isolation: another user is never trusted by the first user\'s device trust', async () => {
  const state = setup();
  // The owner already has a session (challenge completed earlier in their
  // journey) and trusts this device.
  const session = await state.engine.establishFirebaseSession(loginInput('owner@example.com', 'uid-owner', { securityChallenge: false }), state.context);
  await state.engine.trustCurrentDevice({ sessionToken: session.sessionToken, email: 'owner@example.com', subject: 'uid-owner' }, state.context);

  // A different account from the SAME device must still be challenged.
  const intruder = await state.engine.establishFirebaseSession(loginInput('other@example.com', 'uid-other'), state.context);
  assert.equal(intruder.challenge?.type, 'new-device');
  const rows = state.repository.snapshot().trustedDevices;
  assert.equal(rows.length, 1, 'trust rows stay owned by one user');
});

test('escalating cooldown: measured from recorded failures, delayed per step, never a lockout', async () => {
  const state = setup();
  // window-aligned start: 1_800_000_000_000 is a multiple of 15 minutes
  assert.equal(state.now() % (15 * MIN_MS), 0);
  const email = 'cooldown@example.com';
  const threshold = SECURITY_CONFIG.cooldownThresholdFailures;

  // below the threshold: attempts keep working
  for (let index = 0; index < threshold - 1; index += 1) {
    await state.engine.recordLoginFailure({ email }, state.context);
  }
  const under = await state.engine.consumeFirebaseOperation({ operation: 'login', email }, state.context);
  assert.equal(under.retryAfter, undefined);

  // the threshold-th failure arms the 5-minute step: the NEXT login is delayed
  const armed = await state.engine.recordLoginFailure({ email }, state.context);
  assert.ok(armed.retryAfter > 0 && armed.retryAfter <= 5 * MIN_MS / 1000);
  const blocked = await state.engine.consumeFirebaseOperation({ operation: 'login', email }, state.context);
  assert.ok(blocked.retryAfter > 0, 'attempts during the cooldown are delayed');

  // a different email is not affected (per-account measurement)
  const other = await state.engine.consumeFirebaseOperation({ operation: 'login', email: 'other-cooldown@example.com' }, state.context);
  assert.equal(other.retryAfter, undefined);

  // the delay always ends: once the failure window rolls over the count
  // resets and the account can log in again — a delay, never a lockout
  state.advance(16 * MIN_MS);
  const free = await state.engine.consumeFirebaseOperation({ operation: 'login', email }, state.context);
  assert.equal(free.retryAfter, undefined);
});

test('cooldown ceiling: even 99 failures in the window delay at most 60 minutes', async () => {
  const state = setup();
  const email = 'ceiling@example.com';
  let retryAfter = 0;
  for (let index = 0; index < 99; index += 1) {
    const recorded = await state.engine.recordLoginFailure({ email }, state.context);
    retryAfter = Math.max(retryAfter, Number(recorded.retryAfter || 0));
  }
  assert.ok(retryAfter > 0);
  assert.ok(retryAfter <= 60 * MIN_MS / 1000, 'ceiling is 60 minutes — never a permanent lockout');
});

test('rapid requests from one IP combine with a new device to reach HIGH', async () => {
  const state = setup();
  // 20+ auth requests from the same IP in one minute (distinct emails keep
  // the per-email budget untouched).
  for (let index = 0; index < 20; index += 1) {
    await state.engine.consumeFirebaseOperation({ operation: 'login', email: `rapid-${index}@example.com` }, state.context);
  }
  const result = await state.engine.establishFirebaseSession(loginInput('rapid-victim@example.com', 'uid-rapid', { securityChallenge: false }), state.context);
  assert.equal(result.security.level, 'HIGH', 'two independent behaviours reach HIGH');
  assert.equal(result.sessionExpiresAt - state.now(), 24 * HOUR_MS());
  assert.equal(result.security.trustOffer, false);
});

test('unknown challenge purposes are rejected at begin and never earn trust', async () => {
  const state = setup();
  const email = 'purpose@example.com';
  const subject = 'uid-purpose';
  const prepared = await state.engine.beginFirebaseAccountVerification({
    email,
    subject,
    refreshToken: `refresh-${'z'.repeat(40)}`,
    purpose: 'bogus-purpose'
  }, state.context);
  const completed = await state.engine.completeFirebaseAccountVerification({
    verificationTicket: prepared.verificationTicket,
    email,
    subject
  }, state.context);
  assert.equal(completed.trusted, false);
  assert.equal(state.repository.snapshot().trustedDevices.length, 0);
});

test('remember-me false combined with HIGH risk takes the shorter TTL', async () => {
  const state = setup();
  const email = 'remember@example.com';
  const subject = 'uid-remember';
  for (let index = 0; index < 3; index += 1) {
    await state.engine.recordLoginFailure({ email }, state.context);
  }
  const result = await state.engine.establishFirebaseSession(loginInput(email, subject, { securityChallenge: false, remember: false }), state.context);
  assert.equal(result.security.level, 'HIGH');
  assert.equal(result.sessionExpiresAt - state.now(), Math.min(REMEMBER_OFF_TTL_MS, 24 * HOUR_MS()));
});
