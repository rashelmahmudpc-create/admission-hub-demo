import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudflareNativeAuthEngine, SESSION_TTL_MS } from './auth-native/core/auth-engine.mjs';
import { AUTH_ERROR_CODES, asNativeAuthError } from './auth-native/core/errors.mjs';
import { MemoryAuthRepository } from './auth-native/testing/memory-auth-repository.mjs';
import { AUTH_API_PREFIX, createNativeAuthHandler } from './auth-native/worker/public-auth-handler.mjs';

const SECRET = 'native-auth-test-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const setup = (start = 1_800_000_000_000) => {
  let now = start;
  const repository = new MemoryAuthRepository();
  const engine = new CloudflareNativeAuthEngine({ repository, hmacSecret: SECRET, now: () => now });
  const context = { ip: '203.0.113.9', deviceId: 'device-test-0123456789012345', userAgent: 'Mozilla/5.0 Android Chrome/140' };
  return { repository, engine, context, now: () => now, advance: milliseconds => { now += milliseconds; } };
};

async function expectCode(action, code) {
  await assert.rejects(action, error => error?.code === code);
}

test('retired standalone OTP identity methods are absent and cannot create a session', () => {
  const state = setup();
  assert.equal(typeof state.engine.prepareOtp, 'undefined');
  assert.equal(typeof state.engine.markDelivery, 'undefined');
  assert.equal(typeof state.engine.verifyOtp, 'undefined');
  const snapshot = state.repository.snapshot();
  assert.equal(snapshot.users.length, 0);
  assert.equal(snapshot.sessions.length, 0);
});

test('same Firebase subject and email preserve one durable identity across sessions', async () => {
  const state = setup();
  const first = await state.engine.establishFirebaseSession({ email: 'SAME@example.com', subject: 'firebase-uid-one' }, state.context);
  const second = await state.engine.establishFirebaseSession({ email: 'same@example.com', subject: 'firebase-uid-one' }, state.context);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.user.id, first.user.id);
  assert.notEqual(second.sessionToken, first.sessionToken);
  assert.equal(state.repository.snapshot().users.length, 1);
});

test('different Firebase subject cannot silently take over an existing email-linked account', async () => {
  const state = setup();
  await state.engine.establishFirebaseSession({ email: 'collision@example.com', subject: 'firebase-uid-original' }, state.context);
  await expectCode(
    () => state.engine.establishFirebaseSession({ email: 'collision@example.com', subject: 'firebase-uid-other' }, state.context),
    AUTH_ERROR_CODES.ACCOUNT_CONFLICT
  );
  assert.equal(state.repository.snapshot().users.length, 1);
  assert.equal(state.repository.snapshot().externalIdentities.length, 1);
});

test('Firebase operation limits are consumed atomically', async () => {
  const state = setup();
  for (let index = 0; index < 12; index += 1) {
    await state.engine.consumeFirebaseOperation({ operation: 'login', email: 'limited@example.com' }, state.context);
  }
  await expectCode(
    () => state.engine.consumeFirebaseOperation({ operation: 'login', email: 'limited@example.com' }, state.context),
    AUTH_ERROR_CODES.RATE_LIMITED
  );
  for (let index = 0; index < 20; index += 1) {
    await state.engine.consumeFirebaseOperation({ operation: 'pending-profile-write' }, state.context);
  }
  await expectCode(
    () => state.engine.consumeFirebaseOperation({ operation: 'pending-profile-write' }, state.context),
    AUTH_ERROR_CODES.RATE_LIMITED
  );
});

test('guided profile is validated, verification-ticket scoped, and readable only through the canonical account session', async () => {
  const state = setup();
  const email = 'profile@example.com';
  const subject = 'firebase-profile-subject';
  const prepared = await state.engine.beginFirebaseAccountVerification({
    email,
    subject,
    refreshToken: `refresh-${'x'.repeat(40)}`
  }, state.context);
  const profile = {
    fullName: 'রহিম আহমেদ',
    dob: '2007-05-12',
    school: { id: 's-cox-govt-high', name: 'Cox’s Bazar Government High School', district: 'Cox’s Bazar' },
    higherInstitution: { id: 'h-du', name: 'University of Dhaka', district: 'Dhaka' }
  };
  const saved = await state.engine.savePendingProfile(prepared.verificationTicket, profile, state.context);
  assert.equal(saved.saved, true);
  assert.equal(saved.profile.fullName, profile.fullName);
  assert.equal(JSON.stringify(state.repository.snapshot()).includes('refresh-xxxxxxxx'), false);

  await expectCode(
    () => state.engine.savePendingProfile(prepared.verificationTicket, { ...profile, dob: '2029-01-01' }, state.context),
    AUTH_ERROR_CODES.INVALID_INPUT
  );
  await expectCode(
    () => state.engine.savePendingProfile(prepared.verificationTicket, profile, { ...state.context, deviceId: 'different-device-01234567890' }),
    AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID
  );

  const session = await state.engine.completeFirebaseAccountVerification({
    verificationTicket: prepared.verificationTicket,
    email,
    subject
  }, state.context);
  const loaded = await state.engine.getProfile({
    sessionToken: session.sessionToken,
    email,
    subject
  }, state.context);
  assert.equal(loaded.profile.school.id, 's-cox-govt-high');
  assert.equal(loaded.profile.higherInstitution.id, 'h-du');
});

test('opaque Firebase sessions expire and revoke without exposing stored token', async () => {
  const state = setup();
  const login = await state.engine.establishFirebaseSession({ email: 'session@example.com', subject: 'firebase-uid-session' }, state.context);
  assert.equal(JSON.stringify(state.repository.snapshot()).includes(login.sessionToken), false);
  assert.equal((await state.engine.revokeSession(login.sessionToken)).revoked, true);
  await expectCode(() => state.engine.getSession(login.sessionToken), AUTH_ERROR_CODES.SESSION_INVALID);

  const login2 = await state.engine.establishFirebaseSession({ email: 'session@example.com', subject: 'firebase-uid-session' }, state.context);
  state.advance(SESSION_TTL_MS + 1);
  await expectCode(() => state.engine.getSession(login2.sessionToken), AUTH_ERROR_CODES.SESSION_INVALID);
});

class EngineNamespace {
  constructor(engine, { backupCapabilities = null } = {}) {
    this.engine = engine;
    this.backupCapabilities = backupCapabilities;
    this.calls = [];
  }
  idFromName(name) { return name; }
  get() {
    return { fetch: (request, init) => this.fetch(request instanceof Request ? request : new Request(request, init)) };
  }
  async fetch(request) {
    try {
      const url = new URL(request.url);
      this.calls.push(url.pathname);
      if (request.method === 'GET' && url.pathname === '/internal/ping') return Response.json({ ok: true, ...(await this.engine.ping()) });
      const body = await request.json();
      if (url.pathname === '/internal/verification/capabilities' && this.backupCapabilities) {
        return Response.json({ ok: true, result: this.backupCapabilities });
      }
      const routes = {
        '/internal/firebase/rate': () => this.engine.consumeFirebaseOperation(body.input, body.context),
        '/internal/firebase/session/create': () => this.engine.establishFirebaseSession(body.input, body.context),
        '/internal/firebase/session/get': () => this.engine.getFirebaseSession(body.sessionToken, body.input),
        '/internal/firebase/account-verification/begin': () => this.engine.beginFirebaseAccountVerification(body.input, body.context),
        '/internal/firebase/account-verification/material': () => this.engine.getFirebaseAccountVerification(body.verificationTicket, body.input || {}, body.context),
        '/internal/firebase/account-verification/complete': () => this.engine.completeFirebaseAccountVerification(body.input, body.context),
        '/internal/profile/save-pending': () => this.engine.savePendingProfile(body.verificationTicket, body.input, body.context),
        '/internal/profile/save': () => this.engine.saveProfile(body.input, body.context),
        '/internal/profile/get': () => this.engine.getProfile(body.input, body.context),
        '/internal/profile/get-v2': () => this.engine.getProfileV2(body.input, body.context),
        '/internal/profile/patch': () => this.engine.saveProfilePatch(body.input, body.context),
        '/internal/avatar/save': () => this.engine.saveAvatar(body.input, body.context),
        '/internal/avatar/delete': () => this.engine.deleteAvatar(body.input, body.context),
        '/internal/avatar/get': () => this.engine.getAvatarData(body.input, body.context),
        '/internal/public-profile/get': () => this.engine.getPublicProfile(body.input || {}),
        '/internal/public-profile/avatar': () => this.engine.getPublicAvatar(body.input || {}),
        '/internal/session/get': () => this.engine.getSession(body.sessionToken),
        '/internal/session/revoke': () => this.engine.revokeSession(body.sessionToken),
        '/internal/firebase/login/failure': () => this.engine.recordLoginFailure(body.input, body.context),
        '/internal/security/device/trust': () => this.engine.trustCurrentDevice(body.input, body.context),
        '/internal/security/device/revoke': () => this.engine.revokeTrustedDevice(body.input, body.context),
        '/internal/security/state': () => this.engine.getSecurityState(body.input, body.context)
      };
      if (!routes[url.pathname]) return Response.json({ ok: false }, { status: 404 });
      return Response.json({ ok: true, result: await routes[url.pathname]() });
    } catch (cause) {
      const error = asNativeAuthError(cause);
      return Response.json({ ok: false, error: error.toPublic() }, { status: error.status, headers: error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {} });
    }
  }
}

class FirebaseMock {
  constructor() {
    this.users = new Map();
    this.tokens = new Map();
    this.refreshTokens = new Map();
    this.calls = [];
    this.sequence = 0;
    this.failVerification = false;
    this.malformedVerification = false;
    this.malformedSignIn = false;
  }

  token(prefix) {
    this.sequence += 1;
    return `${prefix}_${String(this.sequence).padStart(4, '0')}_${'x'.repeat(30)}`;
  }

  response(payload, status = 200) {
    return Response.json(payload, { status });
  }

  error(message, status = 400) {
    return this.response({ error: { message } }, status);
  }

  async fetch(url, init) {
    const parsed = new URL(url);
    const form = String(init?.headers?.['Content-Type'] || '').includes('x-www-form-urlencoded');
    const body = form ? Object.fromEntries(new URLSearchParams(String(init.body || ''))) : JSON.parse(String(init?.body || '{}'));
    this.calls.push({ pathname: parsed.pathname, body: { ...body, ...(body.password ? { password: '[redacted]' } : {}) } });

    if (parsed.pathname.endsWith('/projects') && init?.method === 'GET') {
      return this.response({ projectId: 'admission-hub-test', authorizedDomains: ['admissionhub.pages.dev'] });
    }

    if (parsed.pathname.endsWith('/accounts:createAuthUri')) {
      return this.response({
        providerId: 'google.com',
        sessionId: `provider-session-${'x'.repeat(32)}`,
        authUri: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=123456789012-nativeauthclient.apps.googleusercontent.com'
      });
    }

    if (parsed.pathname.endsWith('/accounts:signUp')) {
      const email = String(body.email || '').toLowerCase();
      if (this.users.has(email)) return this.error('EMAIL_EXISTS');
      const localId = this.token('firebase-user');
      const idToken = this.token('firebase-id');
      const refreshToken = this.token('firebase-refresh');
      const user = { email, password: body.password, localId, emailVerified: false, disabled: false };
      this.users.set(email, user);
      this.tokens.set(idToken, user);
      this.refreshTokens.set(refreshToken, user);
      return this.response({ localId, idToken, refreshToken, expiresIn: '3600' });
    }

    if (parsed.pathname.endsWith('/accounts:sendOobCode')) {
      if (body.requestType === 'PASSWORD_RESET') {
        const user = this.users.get(String(body.email || '').toLowerCase());
        if (!user) return this.error('EMAIL_NOT_FOUND');
        if (user.disabled) return this.error('USER_DISABLED');
        return this.response({ email: user.email });
      }
      if (this.failVerification) return this.error('QUOTA_EXCEEDED', 429);
      if (this.malformedVerification) return this.response({});
      const user = this.tokens.get(body.idToken);
      if (!user || body.requestType !== 'VERIFY_EMAIL') return this.error('INVALID_ID_TOKEN');
      return this.response({ email: user.email });
    }

    if (parsed.pathname.endsWith('/accounts:delete')) {
      const user = this.tokens.get(body.idToken);
      if (!user) return this.error('INVALID_ID_TOKEN');
      this.users.delete(user.email);
      return this.response({ kind: 'identitytoolkit#DeleteAccountResponse' });
    }

    if (parsed.pathname.endsWith('/accounts:signInWithPassword')) {
      if (this.malformedSignIn) return this.response({});
      const user = this.users.get(String(body.email || '').toLowerCase());
      if (!user || user.password !== body.password) return this.error('INVALID_LOGIN_CREDENTIALS');
      if (user.disabled) return this.error('USER_DISABLED');
      const idToken = this.token('firebase-id');
      const refreshToken = this.token('firebase-refresh');
      this.tokens.set(idToken, user);
      this.refreshTokens.set(refreshToken, user);
      return this.response({ localId: user.localId, idToken, refreshToken, expiresIn: '3600' });
    }

    if (parsed.pathname.endsWith('/accounts:lookup')) {
      const user = this.tokens.get(body.idToken);
      if (!user) return this.error('INVALID_ID_TOKEN');
      return this.response({ users: [{ localId: user.localId, email: user.email, emailVerified: user.emailVerified, disabled: user.disabled }] });
    }

    if (parsed.pathname.endsWith('/token')) {
      const user = this.refreshTokens.get(body.refresh_token);
      if (!user) return this.error('INVALID_REFRESH_TOKEN');
      const idToken = this.token('firebase-id');
      const refreshToken = this.token('firebase-refresh');
      this.tokens.set(idToken, user);
      this.refreshTokens.set(refreshToken, user);
      return this.response({ user_id: user.localId, id_token: idToken, refresh_token: refreshToken, expires_in: '3600' });
    }

    return this.error('NOT_FOUND', 404);
  }
}

const extractCookiePair = (response, name) => {
  const raw = response.headers.get('Set-Cookie') || '';
  const match = raw.match(new RegExp(`(?:^|,\\s*)(${name}=[^;]+)`));
  return match?.[1] || '';
};

const apiRequest = (path, { method = 'GET', body, cookie = '', origin = 'https://admissionhub.pages.dev', ui = 'auth-premium-v6' } = {}) => new Request(`https://worker.example${path}`, {
  method,
  headers: {
    Origin: origin,
    'CF-Connecting-IP': '203.0.113.10',
    'User-Agent': 'Mozilla/5.0 Android Chrome/140',
    ...(ui ? { 'X-AH-Auth-UI': ui } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {})
  },
  ...(body ? { body: JSON.stringify(body) } : {})
});

const handlerSetup = ({ backupCapabilities = null } = {}) => {
  const state = setup();
  const firebase = new FirebaseMock();
  const handler = createNativeAuthHandler({ fetchImpl: firebase.fetch.bind(firebase) });
  const authority = new EngineNamespace(state.engine, { backupCapabilities });
  const env = {
    AUTH_AUTHORITY: authority,
    FIREBASE_WEB_API_KEY: 'test-firebase-api-key-1234567890',
    FIREBASE_CONTINUE_URL: 'https://admissionhub.pages.dev/?firebaseVerified=1'
  };
  return { state, firebase, handler, authority, env };
};

test('Firebase signup sends standard verification but creates no authenticated session', async () => {
  const app = handlerSetup();
  const email = 'real.user@example.com';
  const password = 'Correct-Horse-42';
  const signup = await app.handler(apiRequest(`${AUTH_API_PREFIX}/signup`, { method: 'POST', body: { email, password } }), app.env, {});
  assert.equal(signup.status, 202);
  const body = await signup.json();
  assert.equal(body.accountCreated, true);
  assert.equal(body.authenticated, false);
  assert.equal(body.verification.sent, true);
  assert.equal(body.verification.dailyCapacity, 1000);
  assert.equal(body.verification.resendAfter, 60);
  assert.equal(JSON.stringify(body).includes(email), false);
  assert.equal(JSON.stringify(body).includes(password), false);
  assert.equal(app.firebase.calls.filter(call => call.pathname.endsWith('/accounts:sendOobCode')).length, 1);
  assert.equal(app.firebase.calls.find(call => call.pathname.endsWith('/accounts:sendOobCode')).body.requestType, 'VERIFY_EMAIL');
  assert.equal(extractCookiePair(signup, '__Host-ah_session'), '');
  assert.equal(extractCookiePair(signup, '__Host-ah_firebase'), '');
  assert.ok(extractCookiePair(signup, '__Host-ah_device'));
});

test('password reset uses genuine email action while returning the same non-enumerating response for known and unknown addresses', async () => {
  const app = handlerSetup();
  const email = 'reset.user@example.com';
  await app.handler(apiRequest(`${AUTH_API_PREFIX}/signup`, {
    method: 'POST', body: { email, password: 'Reset-password-44' }
  }), app.env, {});

  const known = await app.handler(apiRequest(`${AUTH_API_PREFIX}/password-reset`, {
    method: 'POST', body: { email }
  }), app.env, {});
  const unknown = await app.handler(apiRequest(`${AUTH_API_PREFIX}/password-reset`, {
    method: 'POST', body: { email: 'missing.user@example.com' }
  }), app.env, {});
  const disabledEmail = 'disabled.reset@example.com';
  await app.handler(apiRequest(`${AUTH_API_PREFIX}/signup`, {
    method: 'POST', body: { email: disabledEmail, password: 'Reset-password-55' }
  }), app.env, {});
  app.firebase.users.get(disabledEmail).disabled = true;
  const disabled = await app.handler(apiRequest(`${AUTH_API_PREFIX}/password-reset`, {
    method: 'POST', body: { email: disabledEmail }
  }), app.env, {});
  const knownBody = await known.json();
  const unknownBody = await unknown.json();
  const disabledBody = await disabled.json();
  assert.equal(known.status, 202);
  assert.equal(unknown.status, 202);
  assert.equal(disabled.status, 202);
  assert.deepEqual(knownBody, unknownBody);
  assert.deepEqual(knownBody, disabledBody);
  assert.equal(knownBody.accepted, true);
  assert.equal(knownBody.deliveryDisclosed, false);
  const resets = app.firebase.calls.filter(call => call.pathname.endsWith('/accounts:sendOobCode') && call.body.requestType === 'PASSWORD_RESET');
  assert.equal(resets.length, 3);
  assert.equal(resets[0].body.continueUrl, 'https://admissionhub.pages.dev/?passwordReset=1');
});

test('unverified Firebase account is denied, verified account on a new device passes one challenge then fast-paths', async () => {
  const app = handlerSetup();
  const email = 'verified.user@example.com';
  const password = 'Secure-password-88';
  await app.handler(apiRequest(`${AUTH_API_PREFIX}/signup`, { method: 'POST', body: { email, password } }), app.env, {});

  const denied = await app.handler(apiRequest(`${AUTH_API_PREFIX}/login`, { method: 'POST', body: { email, password } }), app.env, {});
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
  assert.equal(extractCookiePair(denied, '__Host-ah_session'), '');

  app.firebase.users.get(email).emailVerified = true;
  // Phase 6: verified account + brand-new device = ONE challenge (202),
  // not an immediate session. The existing verification selection UI
  // carries the challenge; completing it issues the session AND 30-day
  // device trust (single consent moment).
  const challenged = await app.handler(apiRequest(`${AUTH_API_PREFIX}/login`, { method: 'POST', body: { email, password } }), app.env, {});
  assert.equal(challenged.status, 202);
  const challengeBody = await challenged.json();
  assert.equal(challengeBody.authenticated, false);
  assert.equal(challengeBody.accountVerified, true);
  assert.equal(challengeBody.verification.selectionRequired, true);
  assert.equal(challengeBody.verification.reason, 'new-device');
  assert.equal(challengeBody.security.challenge, 'new-device');
  assert.equal(extractCookiePair(challenged, '__Host-ah_session'), '');
  const deviceCookie = extractCookiePair(challenged, '__Host-ah_device');
  const verificationCookie = extractCookiePair(challenged, '__Host-ah_verification');
  assert.ok(deviceCookie);
  assert.ok(verificationCookie);

  const cookies = `${deviceCookie}; ${verificationCookie}`;
  // The account is already email-verified, so the email method short-circuits
  // (existing behaviour); completing the device-bound ticket is what issues
  // the session and the 30-day trust.
  const started = await app.handler(apiRequest(`${AUTH_API_PREFIX}/account-verification/email/start`, { method: 'POST', body: {}, cookie: cookies }), app.env, {});
  assert.equal(started.status, 200);
  assert.equal((await started.json()).alreadyVerified, true);
  const completed = await app.handler(apiRequest(`${AUTH_API_PREFIX}/account-verification/email/status`, { method: 'POST', body: {}, cookie: cookies }), app.env, {});
  assert.equal(completed.status, 200);
  const loginBody = await completed.json();
  assert.equal(loginBody.authenticated, true);
  assert.equal(loginBody.emailVerified, true);
  assert.equal('sessionToken' in loginBody, false);
  assert.equal(JSON.stringify(loginBody).includes(password), false);
  const session = extractCookiePair(completed, '__Host-ah_session');
  const firebase = extractCookiePair(completed, '__Host-ah_firebase');
  assert.ok(session);
  assert.ok(firebase);
  assert.match(completed.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Strict/);

  // Completing the new-device challenge registered 30-day trust for exactly
  // this user+device — nothing stored for anyone else.
  const trustedRows = app.state.repository.snapshot().trustedDevices;
  assert.equal(trustedRows.length, 1);
  assert.equal(trustedRows[0].userId, loginBody.user.id);
  assert.equal(trustedRows[0].expiresAt - trustedRows[0].trustedAt, 30 * 24 * 60 * 60 * 1000);

  const current = await app.handler(apiRequest(`${AUTH_API_PREFIX}/session`, { cookie: `${session}; ${firebase}` }), app.env, {});
  assert.equal(current.status, 200);
  const currentBody = await current.json();
  assert.equal(currentBody.emailVerified, true);
  assert.equal(currentBody.user.id, loginBody.user.id);
  assert.ok(extractCookiePair(current, '__Host-ah_firebase'));

  // Same device again: trusted fast path, no second challenge.
  const fast = await app.handler(apiRequest(`${AUTH_API_PREFIX}/login`, { method: 'POST', body: { email, password }, cookie: deviceCookie }), app.env, {});
  assert.equal(fast.status, 200, 'trusted device skips the new-device challenge');
  const fastBody = await fast.json();
  assert.equal(fastBody.authenticated, true);
  assert.equal(fastBody.session.security.trusted, true);

  const logout = await app.handler(apiRequest(`${AUTH_API_PREFIX}/session/logout`, { method: 'POST', cookie: `${session}; ${firebase}`, body: {} }), app.env, {});
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0; HttpOnly; Secure; SameSite=Strict/);
  const after = await app.handler(apiRequest(`${AUTH_API_PREFIX}/session`, { cookie: `${session}; ${firebase}` }), app.env, {});
  assert.equal(after.status, 401);
});

test('verification resend requires password and never authenticates the user', async () => {
  const app = handlerSetup();
  const email = 'resend.user@example.com';
  const password = 'Resend-password-77';
  await app.handler(apiRequest(`${AUTH_API_PREFIX}/signup`, { method: 'POST', body: { email, password } }), app.env, {});
  const early = await app.handler(apiRequest(`${AUTH_API_PREFIX}/verification/resend`, { method: 'POST', body: { email, password } }), app.env, {});
  assert.equal(early.status, 429);
  assert.equal((await early.json()).error.retryAfter, 60);
  assert.equal(app.firebase.calls.filter(call => call.pathname.endsWith('/accounts:sendOobCode')).length, 1);
  app.state.advance(60_001);
  const resent = await app.handler(apiRequest(`${AUTH_API_PREFIX}/verification/resend`, { method: 'POST', body: { email, password } }), app.env, {});
  assert.equal(resent.status, 202);
  const resentBody = await resent.json();
  assert.equal(resentBody.authenticated, false);
  assert.equal(resentBody.verification.resendAfter, 60);
  assert.equal(extractCookiePair(resent, '__Host-ah_session'), '');
  assert.equal(app.firebase.calls.filter(call => call.pathname.endsWith('/accounts:sendOobCode')).length, 2);
});

test('config publishes verified-only Firebase mode and correct Spark verification capacity', async () => {
  const app = handlerSetup();
  const response = await app.handler(apiRequest(`${AUTH_API_PREFIX}/config`), app.env, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.auth.provider, 'firebase');
  assert.equal(body.auth.mode, 'firebase-canonical-multi-method');
  assert.equal(body.auth.available, true);
  assert.equal(body.auth.uiContract, 'auth-premium-v6');
  assert.equal(body.auth.onboarding.version, 'premium-onboarding-v1');
  assert.equal(body.auth.onboarding.profileVersion, 1);
  assert.equal(body.auth.methods.emailPassword.available, true);
  assert.equal(body.auth.methods.passwordReset.available, true);
  assert.equal(body.auth.methods.profile.available, true);
  assert.equal(body.auth.methods.profile.accountScoped, true);
  assert.equal(body.auth.methods.google.available, false);
  assert.equal(body.auth.methods.passkey.neverMandatory, true);
  assert.equal(body.auth.methods.backup.available, false);
  assert.equal(body.auth.availabilityCode, 'READY');
  assert.equal(body.auth.providerStatus, 0);
  assert.equal(body.auth.emailVerifiedRequired, true);
  assert.equal(body.auth.verificationEmail.dailyCapacity, 1000);
  assert.equal(body.auth.verificationEmail.resendCooldownSeconds, 60);
  assert.equal(body.auth.verificationEmail.statusCheckAvailable, true);
  assert.equal(body.auth.registeredAccountLimit, 'unlimited');
  const firebaseCalls = app.firebase.calls.length;
  const cached = await app.handler(apiRequest(`${AUTH_API_PREFIX}/config`), app.env, {});
  assert.equal(cached.status, 200);
  assert.equal(app.firebase.calls.length, firebaseCalls);
});

test('Passkey canary is server-authorized only for the explicit test URL and cannot leak through config cache', async () => {
  const app = handlerSetup();
  app.env.PASSKEY_AUTH_ACTIVATION = 'canary';

  const canary = await app.handler(apiRequest(`${AUTH_API_PREFIX}/config?passkeyCanary=1`), app.env, {});
  assert.equal(canary.status, 200);
  assert.equal((await canary.json()).auth.methods.passkey.available, true);

  const publicConfig = await app.handler(apiRequest(`${AUTH_API_PREFIX}/config`), app.env, {});
  assert.equal(publicConfig.status, 200);
  const publicBody = await publicConfig.json();
  assert.equal(publicBody.auth.methods.passkey.available, false);
  assert.equal(publicBody.auth.methods.passkey.availabilityCode, 'LIVE_E2E_PENDING');

  const cachedCanary = await app.handler(apiRequest(`${AUTH_API_PREFIX}/config?passkeyCanary=1`), app.env, {});
  assert.equal((await cachedCanary.json()).auth.methods.passkey.available, true);
});

test('Google canary is server-authorized only for its explicit test URL and cannot leak through config cache', async () => {
  const app = handlerSetup();
  app.env.GOOGLE_AUTH_ACTIVATION = 'canary';

  const canary = await app.handler(apiRequest(`${AUTH_API_PREFIX}/config?googleCanary=1`), app.env, {});
  assert.equal(canary.status, 200);
  const canaryBody = await canary.json();
  assert.equal(canaryBody.auth.methods.google.available, true);
  assert.equal(canaryBody.auth.methods.google.availabilityCode, 'READY');
  assert.match(canaryBody.auth.methods.google.clientId, /\.apps\.googleusercontent\.com$/);

  const publicConfig = await app.handler(apiRequest(`${AUTH_API_PREFIX}/config`), app.env, {});
  assert.equal(publicConfig.status, 200);
  const publicBody = await publicConfig.json();
  assert.equal(publicBody.auth.methods.google.available, false);
  assert.equal(publicBody.auth.methods.google.availabilityCode, 'LIVE_E2E_PENDING');
  assert.equal('clientId' in publicBody.auth.methods.google, false);

  const cachedCanary = await app.handler(apiRequest(`${AUTH_API_PREFIX}/config?googleCanary=1`), app.env, {});
  assert.equal((await cachedCanary.json()).auth.methods.google.available, true);
});

test('Telegram canary is exact-query isolated, generic, and cannot leak through the ordinary config cache', async () => {
  const capabilities = {
    available: true,
    availabilityCode: 'READY',
    genericFlow: true,
    providerNamesExposed: false,
    contactInput: 'none',
    maxAttempts: 5,
    expiresInSeconds: 300
  };
  const app = handlerSetup({ backupCapabilities: { ...capabilities, telegramAvailable: true } });
  app.env.VERIFICATION_AUTH_ACTIVATION = 'canary';

  const ordinary = await app.handler(apiRequest(`${AUTH_API_PREFIX}/config`), app.env, {});
  assert.equal(ordinary.status, 200);
  const ordinaryBackup = (await ordinary.json()).auth.methods.backup;
  assert.equal(ordinaryBackup.available, false);
  assert.equal(ordinaryBackup.availabilityCode, 'LIVE_E2E_PENDING');
  assert.equal(app.authority.calls.filter(path => path === '/internal/verification/capabilities').length, 0);

  const canary = await app.handler(apiRequest(`${AUTH_API_PREFIX}/config?telegramCanary=1`), app.env, {});
  assert.equal(canary.status, 200);
  const canaryAuth = (await canary.json()).auth;
  assert.deepEqual(canaryAuth.methods.backup, capabilities);
  assert.equal(canaryAuth.methods.telegramVerification.available, true);
  assert.equal(canaryAuth.methods.telegramVerification.codeLength, 6);
  assert.equal(canaryAuth.methods.telegramVerification.verifiesEmailOwnership, false);
  assert.equal(canaryAuth.methods.telegramVerification.canonicalIdentity, 'firebase-uid');
  assert.equal(canaryAuth.accountVerificationRequired, true);
  assert.equal(canaryAuth.emailVerifiedRequired, false);
  assert.equal('telegramAvailable' in canaryAuth.methods.backup, false);
  assert.equal(app.authority.calls.filter(path => path === '/internal/verification/capabilities').length, 1);

  const ordinaryCached = await app.handler(apiRequest(`${AUTH_API_PREFIX}/config`), app.env, {});
  assert.equal((await ordinaryCached.json()).auth.methods.backup.available, false);
  const canaryCached = await app.handler(apiRequest(`${AUTH_API_PREFIX}/config?telegramCanary=1`), app.env, {});
  assert.equal((await canaryCached.json()).auth.methods.backup.available, true);
  assert.equal(app.authority.calls.filter(path => path === '/internal/verification/capabilities').length, 1);
});

test('email OTP publication exposes the generic backup channel only when a provider is healthy', async () => {
  const capabilities = {
    available: true,
    availabilityCode: 'READY',
    genericFlow: true,
    providerNamesExposed: false,
    contactInput: 'none',
    maxAttempts: 5,
    expiresInSeconds: 300,
    telegramAvailable: true
  };

  // Flag off: the channel stays dark even though the orchestrator is healthy.
  const dormant = handlerSetup({ backupCapabilities: capabilities });
  dormant.env.VERIFICATION_AUTH_ACTIVATION = 'enabled';
  const dormantAuth = (await (await dormant.handler(apiRequest(`${AUTH_API_PREFIX}/config`), dormant.env, {})).json()).auth;
  assert.equal(dormantAuth.methods.backup.available, false);
  assert.equal(dormantAuth.methods.backup.availabilityCode, 'LIVE_E2E_PENDING');

  // Flag on with a healthy provider: the selector is exposed.
  const live = handlerSetup({ backupCapabilities: capabilities });
  live.env.VERIFICATION_AUTH_ACTIVATION = 'enabled';
  live.env.VERIFICATION_EMAIL_OTP_PUBLICATION = 'enabled';
  const liveAuth = (await (await live.handler(apiRequest(`${AUTH_API_PREFIX}/config`), live.env, {})).json()).auth;
  assert.equal(liveAuth.methods.backup.available, true);
  assert.equal(liveAuth.methods.backup.availabilityCode, 'READY');
  assert.equal(liveAuth.methods.backup.providerNamesExposed, false);
  assert.equal('telegramAvailable' in liveAuth.methods.backup, false);
  // Provider names must never leak into the public projection.
  assert.equal(/otp-a|apps-script|google|bridge/i.test(JSON.stringify(liveAuth.methods.backup)), false);
});

test('email OTP publication stays dark when the orchestrator reports no healthy provider', async () => {
  const app = handlerSetup({
    backupCapabilities: {
      available: false,
      availabilityCode: 'NO_HEALTHY_PROVIDER',
      genericFlow: true,
      providerNamesExposed: false,
      contactInput: 'none'
    }
  });
  app.env.VERIFICATION_AUTH_ACTIVATION = 'enabled';
  app.env.VERIFICATION_EMAIL_OTP_PUBLICATION = 'enabled';
  const auth = (await (await app.handler(apiRequest(`${AUTH_API_PREFIX}/config`), app.env, {})).json()).auth;
  assert.equal(auth.methods.backup.available, false);
  // A set-but-broken deployment must not advertise a channel it cannot deliver.
  assert.equal(auth.methods.backup.availabilityCode, 'LIVE_E2E_PENDING');
});

test('approved Telegram publication exposes only the Email-or-Telegram selector while generic backup stays protected', async () => {
  const capabilities = {
    available: true,
    availabilityCode: 'READY',
    genericFlow: true,
    providerNamesExposed: false,
    contactInput: 'none',
    maxAttempts: 5,
    expiresInSeconds: 300,
    telegramAvailable: true
  };
  const app = handlerSetup({ backupCapabilities: capabilities });
  app.env.VERIFICATION_AUTH_ACTIVATION = 'enabled';
  app.env.PASSKEY_AUTH_ACTIVATION = 'canary';
  const response = await app.handler(apiRequest(`${AUTH_API_PREFIX}/config`), app.env, {});
  assert.equal(response.status, 200);
  const auth = (await response.json()).auth;
  assert.equal(auth.methods.telegramVerification.available, true);
  assert.equal(auth.methods.telegramVerification.availabilityCode, 'READY');
  assert.equal(auth.methods.telegramVerification.verifiesEmailOwnership, false);
  assert.equal(auth.emailVerifiedRequired, false);
  assert.equal(auth.methods.passkey.available, false);
  assert.equal(auth.methods.passkey.enrollmentAvailable, true);
  assert.equal(auth.methods.backup.available, false);
  assert.equal(auth.methods.backup.availabilityCode, 'LIVE_E2E_PENDING');
  const diagnostic = await app.handler(apiRequest(`${AUTH_API_PREFIX}/config?telegramCanary=1`), app.env, {});
  assert.equal((await diagnostic.json()).auth.methods.backup.available, true);
});

test('Email status creates a session only after real verification and preserves the ticket-scoped guided profile', async () => {
  const app = handlerSetup({ backupCapabilities: { available: true, availabilityCode: 'READY', telegramAvailable: true } });
  app.env.VERIFICATION_AUTH_ACTIVATION = 'enabled';
  const email = 'guided.status@example.com';
  const password = 'StrongPassword!9';
  const signup = await app.handler(apiRequest(`${AUTH_API_PREFIX}/signup`, {
    method: 'POST', body: { email, password }
  }), app.env, {});
  assert.equal(signup.status, 202);
  assert.equal((await signup.clone().json()).verification.sent, false);
  const verificationCookie = extractCookiePair(signup, '__Host-ah_verification');
  const deviceCookie = extractCookiePair(signup, '__Host-ah_device');
  const pendingCookies = [verificationCookie, deviceCookie].filter(Boolean).join('; ');
  assert.ok(verificationCookie);
  assert.ok(deviceCookie);

  const profile = {
    fullName: 'Guided Student',
    dob: '2007-05-12',
    school: { id: 's-cox-govt-high', name: 'Cox’s Bazar Government High School', district: 'Cox’s Bazar' },
    higherInstitution: null
  };
  const saved = await app.handler(apiRequest(`${AUTH_API_PREFIX}/profile/pending`, {
    method: 'POST', cookie: pendingCookies, body: profile
  }), app.env, {});
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).saved, true);

  const started = await app.handler(apiRequest(`${AUTH_API_PREFIX}/account-verification/email/start`, {
    method: 'POST', cookie: pendingCookies, body: {}
  }), app.env, {});
  assert.equal(started.status, 202);
  assert.equal((await started.json()).verification.sent, true);

  const before = await app.handler(apiRequest(`${AUTH_API_PREFIX}/account-verification/email/status`, {
    method: 'POST', cookie: pendingCookies, body: {}
  }), app.env, {});
  assert.equal(before.status, 200);
  assert.equal((await before.json()).authenticated, false);
  assert.equal(extractCookiePair(before, '__Host-ah_session'), '');

  app.firebase.users.get(email).emailVerified = true;
  const after = await app.handler(apiRequest(`${AUTH_API_PREFIX}/account-verification/email/status`, {
    method: 'POST', cookie: pendingCookies, body: {}
  }), app.env, {});
  assert.equal(after.status, 200);
  const afterBody = await after.clone().json();
  assert.equal(afterBody.authenticated, true);
  assert.equal(afterBody.emailVerified, true);
  const sessionCookies = [
    extractCookiePair(after, '__Host-ah_session'),
    extractCookiePair(after, '__Host-ah_firebase'),
    deviceCookie
  ].filter(Boolean).join('; ');
  const loaded = await app.handler(apiRequest(`${AUTH_API_PREFIX}/profile`, { cookie: sessionCookies }), app.env, {});
  assert.equal(loaded.status, 200);
  const loadedBody = await loaded.json();
  assert.equal(loadedBody.profile.fullName, profile.fullName);
  assert.equal(loadedBody.profile.school.id, profile.school.id);
});

test('stale cached Auth UI is rejected before signup creates an account or sends Email', async () => {
  const app = handlerSetup({ backupCapabilities: { available: true, availabilityCode: 'READY', telegramAvailable: true } });
  app.env.VERIFICATION_AUTH_ACTIVATION = 'enabled';
  const response = await app.handler(apiRequest(`${AUTH_API_PREFIX}/signup`, {
    method: 'POST',
    ui: '',
    body: { email: 'stale-ui@example.com', password: 'StrongPassword!9' }
  }), app.env, {});
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.code, AUTH_ERROR_CODES.CLIENT_UPDATE_REQUIRED);
  assert.equal(app.firebase.users.size, 0);
  assert.equal(app.firebase.calls.some(call => call.pathname.endsWith('/accounts:signUp')), false);
  assert.equal(app.firebase.calls.some(call => call.pathname.endsWith('/accounts:sendOobCode')), false);
});

test('selector setup failure preserves the account but never auto-sends Firebase Email', async () => {
  const app = handlerSetup({ backupCapabilities: { available: true, availabilityCode: 'READY', telegramAvailable: true } });
  app.env.VERIFICATION_AUTH_ACTIVATION = 'enabled';
  const authorityFetch = app.authority.fetch.bind(app.authority);
  app.authority.fetch = request => new URL(request.url).pathname === '/internal/firebase/account-verification/begin'
    ? jsonResponse({ error: { code: AUTH_ERROR_CODES.VERIFICATION_UNAVAILABLE } }, 503)
    : authorityFetch(request);
  const email = 'selector-outage@example.com';
  const response = await app.handler(apiRequest(`${AUTH_API_PREFIX}/signup`, {
    method: 'POST',
    body: { email, password: 'StrongPassword!9' }
  }), app.env, {});
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error.code, AUTH_ERROR_CODES.VERIFICATION_UNAVAILABLE);
  assert.equal(app.firebase.users.has(email), true);
  assert.equal(app.firebase.calls.some(call => call.pathname.endsWith('/accounts:sendOobCode')), false);
});

test('approved Google activation publishes the provider on the ordinary config without publishing Passkey', async () => {
  const app = handlerSetup();
  app.env.GOOGLE_AUTH_ACTIVATION = 'enabled';
  app.env.PASSKEY_AUTH_ACTIVATION = 'canary';

  const result = await app.handler(apiRequest(`${AUTH_API_PREFIX}/config`), app.env, {});
  assert.equal(result.status, 200);
  const methods = (await result.json()).auth.methods;
  assert.equal(methods.google.available, true);
  assert.equal(methods.google.availabilityCode, 'READY');
  assert.match(methods.google.clientId, /\.apps\.googleusercontent\.com$/);
  assert.equal(methods.passkey.available, false);
  assert.equal(methods.passkey.availabilityCode, 'LIVE_E2E_PENDING');
});

test('public API rejects untrusted origins, weak or oversized input, and fails closed without Firebase config', async () => {
  const app = handlerSetup();
  const forbidden = await app.handler(apiRequest(`${AUTH_API_PREFIX}/config`, { origin: 'https://evil.example' }), app.env, {});
  assert.equal(forbidden.status, 403);
  const missingOrigin = await app.handler(apiRequest(`${AUTH_API_PREFIX}/signup`, {
    method: 'POST', origin: '', body: { email: 'origin@example.com', password: 'StrongPass!123' }
  }), app.env, {});
  assert.equal(missingOrigin.status, 403);

  const weak = await app.handler(apiRequest(`${AUTH_API_PREFIX}/signup`, {
    method: 'POST', body: { email: 'weak@example.com', password: 'short' }
  }), app.env, {});
  assert.equal(weak.status, 400);
  assert.equal((await weak.json()).error.code, AUTH_ERROR_CODES.WEAK_PASSWORD);
  assert.equal(app.firebase.calls.length, 0);

  const oversized = await app.handler(apiRequest(`${AUTH_API_PREFIX}/signup`, {
    method: 'POST', body: { email: 'large@example.com', password: 'x'.repeat(5000) }
  }), app.env, {});
  assert.equal(oversized.status, 400);
  assert.equal(app.firebase.calls.length, 0);

  const missing = { ...app.env };
  delete missing.FIREBASE_WEB_API_KEY;
  const missingConfig = await app.handler(apiRequest(`${AUTH_API_PREFIX}/config`), missing, {});
  const missingConfigBody = await missingConfig.json();
  assert.equal(missingConfigBody.auth.available, false);
  assert.equal(missingConfigBody.auth.availabilityCode, 'CREDENTIAL_MISSING');
  assert.equal(missingConfigBody.auth.providerStatus, 0);

  const unavailable = await app.handler(apiRequest(`${AUTH_API_PREFIX}/signup`, {
    method: 'POST', body: { email: 'closed@example.com', password: 'Safe-password-11' }
  }), missing, {});
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error.code, AUTH_ERROR_CODES.NOT_CONFIGURED);
  assert.equal(extractCookiePair(unavailable, '__Host-ah_session'), '');
});

test('verification provider failure does not create a local authenticated identity', async () => {
  const app = handlerSetup();
  app.firebase.failVerification = true;
  const response = await app.handler(apiRequest(`${AUTH_API_PREFIX}/signup`, {
    method: 'POST', body: { email: 'quota@example.com', password: 'Safe-password-22' }
  }), app.env, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, AUTH_ERROR_CODES.VERIFICATION_UNAVAILABLE);
  assert.equal(app.state.repository.snapshot().users.length, 0);
  assert.equal(app.state.repository.snapshot().sessions.length, 0);
});

test('failed duplicate signup cannot consume the 1000/day verification-send capacity', async () => {
  const app = handlerSetup();
  const email = 'duplicate.user@example.com';
  const password = 'Secure-password-66';
  const first = await app.handler(apiRequest(`${AUTH_API_PREFIX}/signup`, { method: 'POST', body: { email, password } }), app.env, {});
  assert.equal(first.status, 202);
  app.state.advance(60_001);
  const duplicate = await app.handler(apiRequest(`${AUTH_API_PREFIX}/signup`, { method: 'POST', body: { email, password } }), app.env, {});
  assert.equal(duplicate.status, 409);
  const globalRows = app.state.repository.snapshot().rates.filter(([key]) => key.startsWith('firebase-verification-global-day:'));
  assert.equal(globalRows.length, 1);
  assert.equal(globalRows[0][1].count, 1);
});

test('provider failures expose only a bounded operation diagnostic header', async () => {
  const app = handlerSetup();
  const email = 'diagnostic.user@example.com';
  const password = 'Safe-password-77';
  await app.handler(apiRequest(`${AUTH_API_PREFIX}/signup`, { method: 'POST', body: { email, password } }), app.env, {});
  app.firebase.malformedSignIn = true;
  const response = await app.handler(apiRequest(`${AUTH_API_PREFIX}/login`, {
    method: 'POST', body: { email, password }
  }), app.env, {});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('X-AH-Auth-Diagnostic'), 'SIGNIN_INVALID_PROVIDER_RESPONSE');
  const body = await response.json();
  assert.equal(body.error.code, AUTH_ERROR_CODES.AUTH_PROVIDER_UNAVAILABLE);
  assert.equal('providerDiagnostic' in body.error, false);
  assert.equal(JSON.stringify(body).includes(email), false);
  assert.equal(JSON.stringify(body).includes(password), false);
});

test('malformed Firebase verification acceptance fails closed without an authenticated session', async () => {
  const app = handlerSetup();
  app.firebase.malformedVerification = true;
  const response = await app.handler(apiRequest(`${AUTH_API_PREFIX}/signup`, {
    method: 'POST', body: { email: 'malformed@example.com', password: 'Safe-password-33' }
  }), app.env, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, AUTH_ERROR_CODES.VERIFICATION_UNAVAILABLE);
  assert.equal(app.state.repository.snapshot().users.length, 0);
  assert.equal(app.state.repository.snapshot().sessions.length, 0);
});

// ---------------------------------------------------------------------------
// Public-safe profile HTTP route. The route lived outside the /api/auth/v1
// prefix while the handler's entry gate only admitted that prefix, so every
// shared profile link fell through to the product API and 404'd with
// {"error":"not-found"} — the handler's own route was unreachable dead code.
// ---------------------------------------------------------------------------

const publicProfileRequest = publicId => new Request(`https://worker.example/api/public/profile/${publicId}`, {
  headers: { Origin: 'https://admissionhub.pages.dev' }
});

const publishPublicProfile = async app => {
  app.env.VERIFICATION_AUTH_ACTIVATION = 'enabled';
  const email = 'shared.profile@example.com';
  const signup = await app.handler(apiRequest(`${AUTH_API_PREFIX}/signup`, {
    method: 'POST', body: { email, password: 'StrongPassword!9' }
  }), app.env, {});
  const cookies = [extractCookiePair(signup, '__Host-ah_verification'), extractCookiePair(signup, '__Host-ah_device')]
    .filter(Boolean).join('; ');
  const deviceCookie = extractCookiePair(signup, '__Host-ah_device');
  await app.handler(apiRequest(`${AUTH_API_PREFIX}/profile/pending`, {
    method: 'POST', cookie: cookies,
    body: { fullName: 'Shared Student', dob: '2007-05-12', school: null, higherInstitution: null }
  }), app.env, {});
  app.firebase.users.get(email).emailVerified = true;
  await app.handler(apiRequest(`${AUTH_API_PREFIX}/account-verification/email/start`, {
    method: 'POST', cookie: cookies, body: {}
  }), app.env, {});
  const verified = await app.handler(apiRequest(`${AUTH_API_PREFIX}/account-verification/email/status`, {
    method: 'POST', cookie: cookies, body: {}
  }), app.env, {});
  const sessionCookie = [
    extractCookiePair(verified, '__Host-ah_session'),
    extractCookiePair(verified, '__Host-ah_firebase'),
    deviceCookie
  ].filter(Boolean).join('; ');
  assert.ok(sessionCookie, 'verification must establish a session');
  const profile = await app.handler(apiRequest(`${AUTH_API_PREFIX}/profile`, { cookie: sessionCookie }), app.env, {});
  // publicId is a sibling of profile on the read model, not nested inside it
  const publicId = (await profile.json()).publicId;
  assert.ok(publicId, 'publishing a profile must yield a public ID');
  return { publicId, sessionCookie };
};

test('GET /api/public/profile/:id is routed to the native handler, not the product API', async () => {
  const app = handlerSetup();
  const { publicId, sessionCookie } = await publishPublicProfile(app);
  const patched = await app.handler(apiRequest(`${AUTH_API_PREFIX}/profile/patch`, {
    method: 'POST',
    cookie: sessionCookie,
    body: { fields: { visibility: 'public', bio: 'future engineer' } }
  }), app.env, {});
  assert.equal(patched.status, 200);
  const response = await app.handler(publicProfileRequest(publicId), app.env, {});
  assert.ok(response, 'the public profile route must be handled, not skipped');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.profile.publicId, publicId);
  assert.equal(body.profile.visibility, 'public');
  assert.equal(body.profile.bio, 'future engineer');
  // the true public-safe allowlist: never email/mobile/DOB/school
  assert.equal(body.profile.email, undefined);
  assert.equal(body.profile.mobile, undefined);
  assert.equal(body.profile.dob, undefined);
  assert.equal(body.profile.school, undefined);
});

test('GET /api/public/profile/:id answers an unknown ID without leaking a profile', async () => {
  const app = handlerSetup();
  const response = await app.handler(publicProfileRequest('AH-ZZZZZZ'), app.env, {});
  // Fail-closed: an unknown ID is a hard not-found, never an empty profile body
  // that a caller could mistake for "no data set yet".
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'PUBLIC_PROFILE_NOT_FOUND');
  assert.equal(body.profile, undefined);
});

test('unrelated /api/public paths are still not claimed by the native handler', async () => {
  const app = handlerSetup();
  const response = await app.handler(new Request('https://worker.example/api/public/other', {
    headers: { Origin: 'https://admissionhub.pages.dev' }
  }), app.env, {});
  assert.equal(response, null, 'only the profile prefix belongs to the native handler');
});
