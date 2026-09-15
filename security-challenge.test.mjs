import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CloudflareNativeAuthEngine,
  SESSION_TTL_MS
} from './auth-native/core/auth-engine.mjs';
import { AUTH_ERROR_CODES, NativeAuthError } from './auth-native/core/errors.mjs';
import { MemoryAuthRepository } from './auth-native/testing/memory-auth-repository.mjs';
import { SECURITY_CONFIG, SECURITY_POLICY_VERSION } from './auth-native/core/security-config.mjs';

const SECRET = 'security-challenge-test-secret-0123456789-ABCDEFGHIJKLMNOPQ';
const MIN_MS = 60 * 1000;

// Minimal verification orchestrator double: the delivery pipeline itself is
// covered by the verification suite; here only the security binding matters.
class TestOrchestrator {
  constructor() {
    this.tickets = new Map();
    this.requests = [];
  }

  async requestVerification(input, context) {
    this.requests.push({ ...input });
    const attemptId = `att-test-${this.tickets.size + 1}-${'k'.repeat(16)}`;
    const code = String(100000 + ((this.tickets.size * 3791) % 900000)).padStart(6, '0');
    this.tickets.set(attemptId, { code, userId: input.userId, email: input.email, purpose: input.purpose });
    return {
      accepted: true,
      attemptId,
      code,
      expiresAt: this.now() + SECURITY_CONFIG.challengeTtlMs,
      resendAfter: 60 * 1000,
      attemptsAllowed: 3
    };
  }

  async verify({ attemptId, code, userId }) {
    const ticket = this.tickets.get(attemptId);
    if (!ticket || ticket.userId !== userId || ticket.purpose !== 'sensitive-action') {
      throw new NativeAuthError(AUTH_ERROR_CODES.OTP_INVALID);
    }
    if (ticket.code !== code) throw new NativeAuthError(AUTH_ERROR_CODES.OTP_INVALID);
    return Object.freeze({ verified: true, purpose: 'sensitive-action' });
  }
}

const setup = (start = 1_800_000_000_000) => {
  let now = start;
  const repository = new MemoryAuthRepository();
  const engine = new CloudflareNativeAuthEngine({ repository, hmacSecret: SECRET, now: () => now });
  const orchestrator = new TestOrchestrator();
  orchestrator.now = () => now;
  engine.bindVerification(orchestrator);
  const context = { ip: '198.51.100.22', deviceId: 'device-challenge-test-0123456789', userAgent: 'Mozilla/5.0 Chrome/140', origin: 'https://admissionhub.pages.dev' };
  const email = 'challenge-owner@example.com';
  const subject = 'uid-security-challenge';
  return { repository, engine, orchestrator, context, email, subject, now: () => now, advance: ms => { now += ms; } };
};

const establishSession = async (state, extra = {}) => state.engine.establishFirebaseSession({
  email: state.email,
  subject: state.subject,
  remember: true,
  verified: true,
  newDevice: true,
  securityChallenge: false,
  ...extra
}, state.context);

test('challenge request: purpose-bound row, delivered through the orchestrator', async () => {
  const state = setup();
  const session = await establishSession(state);
  const result = await state.engine.requestChallenge({
    sessionToken: session.sessionToken, email: state.email, subject: state.subject, purpose: 'step-up'
  }, state.context);

  assert.match(result.challengeRef, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(result.purpose, 'step-up');
  assert.equal(result.method, 'email');
  assert.equal(result.expiresAt - state.now(), SECURITY_CONFIG.challengeTtlMs);
  assert.equal(result.policyVersion, SECURITY_POLICY_VERSION);
  const row = state.repository.getSecurityChallenge({ challengeRef: result.challengeRef, userId: session.user.id, now: state.now() });
  assert.equal(row.status, 'sent');
  const request = state.orchestrator.requests.at(-1);
  assert.equal(request.email, state.email);
  assert.equal(request.userId, session.user.id);
  assert.equal(request.purpose, 'sensitive-action');
});

test('challenge verify: correct code verifies once and issues a step-up token', async () => {
  const state = setup();
  const session = await establishSession(state);
  const challenge = await state.engine.requestChallenge({
    sessionToken: session.sessionToken, email: state.email, subject: state.subject, purpose: 'step-up'
  }, state.context);
  const code = state.orchestrator.tickets.get(challenge.attemptId).code;
  const result = await state.engine.verifyChallenge({
    sessionToken: session.sessionToken, email: state.email, subject: state.subject,
    challengeRef: challenge.challengeRef, purpose: 'step-up', code
  }, state.context);

  assert.equal(result.verified, true);
  assert.equal(result.purpose, 'step-up');
  assert.match(result.stepUpToken, /^[A-Za-z0-9_-]{43}$/);
  const row = state.repository.getSecurityChallenge({ challengeRef: challenge.challengeRef, userId: session.user.id, now: state.now() });
  assert.equal(row.status, 'verified');
  // Single-use: replaying the same code on the same challenge fails.
  await assert.rejects(
    state.engine.verifyChallenge({
      sessionToken: session.sessionToken, email: state.email, subject: state.subject,
      challengeRef: challenge.challengeRef, purpose: 'step-up', code
    }, state.context),
    (error) => error.code === AUTH_ERROR_CODES.CHALLENGE_INVALID
  );
});

test('challenge verify: wrong code consumes an attempt, unknown code never verifies', async () => {
  const state = setup();
  const session = await establishSession(state);
  const challenge = await state.engine.requestChallenge({
    sessionToken: session.sessionToken, email: state.email, subject: state.subject, purpose: 'step-up'
  }, state.context);
  await assert.rejects(
    state.engine.verifyChallenge({
      sessionToken: session.sessionToken, email: state.email, subject: state.subject,
      challengeRef: challenge.challengeRef, purpose: 'step-up', code: '000001'
    }, state.context),
    (error) => error.code === AUTH_ERROR_CODES.OTP_INVALID
  );
  const row = state.repository.getSecurityChallenge({ challengeRef: challenge.challengeRef, userId: session.user.id, now: state.now() });
  assert.equal(row.attempts, 1);
  assert.equal(row.status, 'sent');
});

test('challenge attempts: after the cap the challenge is failed even for the right code', async () => {
  const state = setup();
  const session = await establishSession(state);
  const challenge = await state.engine.requestChallenge({
    sessionToken: session.sessionToken, email: state.email, subject: state.subject, purpose: 'step-up'
  }, state.context);
  const code = state.orchestrator.tickets.get(challenge.attemptId).code;
  for (let i = 0; i < SECURITY_CONFIG.challengeMaxAttempts; i += 1) {
    await assert.rejects(
      state.engine.verifyChallenge({
        sessionToken: session.sessionToken, email: state.email, subject: state.subject,
        challengeRef: challenge.challengeRef, purpose: 'step-up', code: '000009'
      }, state.context),
      (error) => error.code === AUTH_ERROR_CODES.OTP_INVALID
    );
  }
  const row = state.repository.getSecurityChallenge({ challengeRef: challenge.challengeRef, userId: session.user.id, now: state.now() });
  assert.equal(row.status, 'failed');
  await assert.rejects(
    state.engine.verifyChallenge({
      sessionToken: session.sessionToken, email: state.email, subject: state.subject,
      challengeRef: challenge.challengeRef, purpose: 'step-up', code
    }, state.context),
    (error) => error.code === AUTH_ERROR_CODES.CHALLENGE_INVALID
  );
});

test('challenge purpose binding: a step-up challenge cannot satisfy another purpose', async () => {
  const state = setup();
  const session = await establishSession(state);
  const challenge = await state.engine.requestChallenge({
    sessionToken: session.sessionToken, email: state.email, subject: state.subject, purpose: 'step-up'
  }, state.context);
  const code = state.orchestrator.tickets.get(challenge.attemptId).code;
  await assert.rejects(
    state.engine.verifyChallenge({
      sessionToken: session.sessionToken, email: state.email, subject: state.subject,
      challengeRef: challenge.challengeRef, purpose: 'device-revoke', code
    }, state.context),
    (error) => error.code === AUTH_ERROR_CODES.CHALLENGE_INVALID
  );
});

test('challenge device binding: another device cannot verify the challenge', async () => {
  const state = setup();
  const session = await establishSession(state);
  const challenge = await state.engine.requestChallenge({
    sessionToken: session.sessionToken, email: state.email, subject: state.subject, purpose: 'step-up'
  }, state.context);
  const code = state.orchestrator.tickets.get(challenge.attemptId).code;
  const otherDevice = { ...state.context, deviceId: 'device-challenge-other-0123456789' };
  await assert.rejects(
    state.engine.verifyChallenge({
      sessionToken: session.sessionToken, email: state.email, subject: state.subject,
      challengeRef: challenge.challengeRef, purpose: 'step-up', code
    }, otherDevice),
    (error) => error.code === AUTH_ERROR_CODES.CHALLENGE_INVALID
  );
});

test('challenge expiry: after the TTL the challenge is unusable', async () => {
  const state = setup();
  const session = await establishSession(state);
  const challenge = await state.engine.requestChallenge({
    sessionToken: session.sessionToken, email: state.email, subject: state.subject, purpose: 'step-up'
  }, state.context);
  const code = state.orchestrator.tickets.get(challenge.attemptId).code;
  state.advance(SECURITY_CONFIG.challengeTtlMs + 1);
  await assert.rejects(
    state.engine.verifyChallenge({
      sessionToken: session.sessionToken, email: state.email, subject: state.subject,
      challengeRef: challenge.challengeRef, purpose: 'step-up', code
    }, state.context),
    (error) => error.code === AUTH_ERROR_CODES.CHALLENGE_INVALID
  );
});

test('challenge cancel: a cancelled challenge cannot be verified', async () => {
  const state = setup();
  const session = await establishSession(state);
  const challenge = await state.engine.requestChallenge({
    sessionToken: session.sessionToken, email: state.email, subject: state.subject, purpose: 'step-up'
  }, state.context);
  const code = state.orchestrator.tickets.get(challenge.attemptId).code;
  const cancelled = await state.engine.cancelChallenge({
    sessionToken: session.sessionToken, email: state.email, subject: state.subject,
    challengeRef: challenge.challengeRef, purpose: 'step-up'
  }, state.context);
  assert.equal(cancelled.cancelled, true);
  const row = state.repository.getSecurityChallenge({ challengeRef: challenge.challengeRef, userId: session.user.id, now: state.now() });
  assert.equal(row.status, 'cancelled');
  await assert.rejects(
    state.engine.verifyChallenge({
      sessionToken: session.sessionToken, email: state.email, subject: state.subject,
      challengeRef: challenge.challengeRef, purpose: 'step-up', code
    }, state.context),
    (error) => error.code === AUTH_ERROR_CODES.CHALLENGE_INVALID
  );
});

test('step-up logout-all: a recent low-risk session revokes without a challenge', async () => {
  const state = setup();
  const session = await establishSession(state);
  const result = await state.engine.revokeAllSessions({
    sessionToken: session.sessionToken, email: state.email, subject: state.subject
  }, state.context);
  assert.equal(result.revoked, 1);
});

test('step-up logout-all: an aged session requires a challenge, then the token works once', async () => {
  const state = setup();
  const session = await establishSession(state);
  state.advance(SECURITY_CONFIG.stepUpRecentSessionMs + MIN_MS);

  await assert.rejects(
    state.engine.revokeAllSessions({ sessionToken: session.sessionToken, email: state.email, subject: state.subject }, state.context),
    (error) => error.code === AUTH_ERROR_CODES.STEP_UP_REQUIRED
  );

  const challenge = await state.engine.requestChallenge({
    sessionToken: session.sessionToken, email: state.email, subject: state.subject, purpose: 'step-up'
  }, state.context);
  const code = state.orchestrator.tickets.get(challenge.attemptId).code;
  const verified = await state.engine.verifyChallenge({
    sessionToken: session.sessionToken, email: state.email, subject: state.subject,
    challengeRef: challenge.challengeRef, purpose: 'step-up', code
  }, state.context);

  const result = await state.engine.revokeAllSessions({
    sessionToken: session.sessionToken, email: state.email, subject: state.subject,
    stepUpToken: verified.stepUpToken
  }, state.context);
  assert.equal(result.revoked, 1);
  // The step-up token is single-use.
  const fresh = await establishSession(state);
  state.advance(SECURITY_CONFIG.stepUpRecentSessionMs + MIN_MS);
  await assert.rejects(
    state.engine.revokeAllSessions({
      sessionToken: fresh.sessionToken, email: state.email, subject: state.subject,
      stepUpToken: verified.stepUpToken
    }, state.context),
    (error) => error.code === AUTH_ERROR_CODES.CHALLENGE_INVALID
  );
});

test('step-up logout-all: elevated risk blocks even a fresh session until challenged', async () => {
  const state = setup();
  const session = await establishSession(state);
  // Push the account over the elevated-risk failure threshold within the window.
  for (let i = 0; i < SECURITY_CONFIG.riskThresholds.failedLoginElevatedAt; i += 1) {
    await state.engine.recordLoginFailure({ email: state.email }, state.context);
  }
  await assert.rejects(
    state.engine.revokeAllSessions({ sessionToken: session.sessionToken, email: state.email, subject: state.subject }, state.context),
    (error) => error.code === AUTH_ERROR_CODES.STEP_UP_REQUIRED
  );
  // Completing the challenge unlocks the action.
  const challenge = await state.engine.requestChallenge({
    sessionToken: session.sessionToken, email: state.email, subject: state.subject, purpose: 'step-up'
  }, state.context);
  const code = state.orchestrator.tickets.get(challenge.attemptId).code;
  const verified = await state.engine.verifyChallenge({
    sessionToken: session.sessionToken, email: state.email, subject: state.subject,
    challengeRef: challenge.challengeRef, purpose: 'step-up', code
  }, state.context);
  const result = await state.engine.revokeAllSessions({
    sessionToken: session.sessionToken, email: state.email, subject: state.subject,
    stepUpToken: verified.stepUpToken
  }, state.context);
  assert.equal(result.revoked, 1);
});

test('step-up token: a token from another device is rejected (replay protection)', async () => {
  const state = setup();
  const session = await establishSession(state);
  const challenge = await state.engine.requestChallenge({
    sessionToken: session.sessionToken, email: state.email, subject: state.subject, purpose: 'step-up'
  }, state.context);
  const code = state.orchestrator.tickets.get(challenge.attemptId).code;
  const verified = await state.engine.verifyChallenge({
    sessionToken: session.sessionToken, email: state.email, subject: state.subject,
    challengeRef: challenge.challengeRef, purpose: 'step-up', code
  }, state.context);
  const otherDevice = { ...state.context, deviceId: 'device-challenge-replay-012345678' };
  await assert.rejects(
    state.engine.revokeAllSessions({
      sessionToken: session.sessionToken, email: state.email, subject: state.subject,
      stepUpToken: verified.stepUpToken
    }, otherDevice),
    (error) => error.code === AUTH_ERROR_CODES.CHALLENGE_INVALID
  );
});

test('step-up token: garbage or foreign tokens never revoke', async () => {
  const state = setup();
  const session = await establishSession(state);
  await assert.rejects(
    state.engine.revokeAllSessions({
      sessionToken: session.sessionToken, email: state.email, subject: state.subject,
      stepUpToken: 'x'.repeat(64)
    }, state.context),
    (error) => error.code === AUTH_ERROR_CODES.CHALLENGE_INVALID
  );
  // A token with the right shape but the wrong MAC is rejected.
  await assert.rejects(
    state.engine.revokeAllSessions({
      sessionToken: session.sessionToken, email: state.email, subject: state.subject,
      stepUpToken: `${'a'.repeat(32)}${'b'.repeat(32)}`
    }, state.context),
    (error) => error.code === AUTH_ERROR_CODES.CHALLENGE_INVALID
  );
});

test('challenge delivery failure: the sensitive action stays unavailable (no silent bypass)', async () => {
  const state = setup();
  const session = await establishSession(state);
  state.orchestrator.requestVerification = async () => {
    throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
  };
  await assert.rejects(
    state.engine.requestChallenge({
      sessionToken: session.sessionToken, email: state.email, subject: state.subject, purpose: 'step-up'
    }, state.context),
    (error) => error.code === AUTH_ERROR_CODES.BACKUP_UNAVAILABLE
  );
  const rows = state.repository.snapshot().securityChallenges;
  for (const row of rows) assert.notEqual(row.status, 'sent', 'a failed delivery must never leave a verifiable challenge');
});
