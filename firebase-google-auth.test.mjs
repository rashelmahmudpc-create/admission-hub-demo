import test from 'node:test';
import assert from 'node:assert/strict';
import { FirebaseEmailPasswordProvider, FirebaseRequestError } from './auth-native/providers/firebase-auth.mjs';
import { AUTH_API_PREFIX, createNativeAuthHandler } from './auth-native/worker/public-auth-handler.mjs';
import { AUTH_ERROR_CODES } from './auth-native/core/errors.mjs';

const API_KEY = 'firebase-google-test-key-1234567890';
const CLIENT_ID = '123456789012-exampleclientidentifier.apps.googleusercontent.com';
const TOKEN = prefix => `${prefix}-${'x'.repeat(40)}`;
const response = (body, status = 200) => Response.json(body, { status });

const request = (path, body) => new Request(`https://worker.example${path}`, {
  method: 'POST',
  headers: {
    Origin: 'https://admissionhub.pages.dev',
    'CF-Connecting-IP': '203.0.113.44',
    'User-Agent': 'Chrome Test',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(body)
});

class AuthorityMock {
  constructor({ conflict = false, profile = null, profileError = false } = {}) {
    this.conflict = conflict; this.profile = profile; this.profileError = profileError; this.calls = [];
  }
  idFromName(name) { return name; }
  get() { return { fetch: this.fetch.bind(this) }; }
  async fetch(input, init) {
    const req = input instanceof Request ? input : new Request(input, init);
    const path = new URL(req.url).pathname;
    const body = req.method === 'GET' ? {} : await req.json();
    this.calls.push({ path, body });
    if (path === '/internal/profile/get-v2') {
      if (this.profileError) return response({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } }, 500);
      return response({ ok: true, result: {
        profile: { fullName: this.profile?.name || '', version: 1 },
        avatar: { present: Boolean(this.profile?.avatarPresent) },
        publicId: 'AH-TEST01', completion: this.profile?.name ? 15 : 0
      } });
    }
    if (path === '/internal/profile/patch') return response({ ok: true, result: { saved: true, profile: null } });
    if (path === '/internal/avatar/save') return response({ ok: true, result: { saved: true } });
    if (path === '/internal/firebase/rate') return response({ ok: true, result: { accepted: true, ...(body.input?.email ? { email: body.input.email } : {}) } });
    if (path === '/internal/firebase/session/create') {
      if (this.conflict) return response({ ok: false, error: { code: AUTH_ERROR_CODES.ACCOUNT_CONFLICT } }, 409);
      return response({ ok: true, result: {
        created: false,
        sessionToken: TOKEN('app-session'),
        sessionExpiresAt: Date.now() + 3_600_000,
        user: { id: 'usr-canonical', emailMask: 'g***@example.com', status: 'active' }
      } });
    }
    return response({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
  }
}

function googleFetch({ isNewUser = false, deleted = [], deleteFails = false, includeGoogle = true, displayName = undefined, photoUrl = undefined } = {}) {
  return async (url, init = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (path.endsWith('/accounts:createAuthUri')) {
      return response({
        providerId: 'google.com',
        sessionId: TOKEN('provider-session'),
        authUri: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(CLIENT_ID)}`
      });
    }
    if (path.endsWith('/accounts:signInWithIdp')) {
      assert.equal(body.requestUri, 'https://admissionhub.pages.dev');
      assert.equal(body.autoCreate, true);
      assert.equal(body.returnIdpCredential, true);
      assert.equal(body.returnSecureToken, true);
      assert.match(body.postBody, /^id_token=/);
      assert.match(body.postBody, /providerId=google.com/);
      return response({
        idToken: TOKEN('firebase-id'),
        refreshToken: TOKEN('firebase-refresh'),
        localId: 'firebase-google-uid',
        email: 'google.user@example.com',
        emailVerified: true,
        isNewUser,
        expiresIn: '3600'
      });
    }
    if (path.endsWith('/accounts:lookup')) {
      return response({ users: [{
        localId: 'firebase-google-uid',
        email: 'google.user@example.com',
        emailVerified: true,
        disabled: false,
        displayName,
        photoUrl,
        providerUserInfo: includeGoogle ? [{ providerId: 'google.com', rawId: 'google-subject' }] : []
      }] });
    }
    if (path.endsWith('/accounts:delete')) {
      deleted.push(body.idToken);
      return deleteFails ? response({ error: { message: 'NETWORK_ERROR' } }, 503) : response({});
    }
    return response({ error: { message: 'NOT_FOUND' } }, 404);
  };
}

test('Google readiness accepts only a validated Firebase Google client and Pages origin', async () => {
  const calls = [];
  const provider = new FirebaseEmailPasswordProvider({
    apiKey: API_KEY,
    continueUrl: 'https://admissionhub.pages.dev/?firebaseVerified=1',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return response({
        providerId: 'google.com',
        sessionId: TOKEN('provider-session'),
        authUri: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(CLIENT_ID)}`
      });
    }
  });
  assert.deepEqual(await provider.inspectGoogleProvider(), { available: true, clientId: CLIENT_ID });
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(sent.providerId, 'google.com');
  assert.equal(sent.continueUri, 'https://admissionhub.pages.dev');
  assert.deepEqual(sent.customParameter, { prompt: 'select_account' });
  assert.equal(JSON.stringify(calls).includes(API_KEY), true);
});

test('Google readiness fails closed on an untrusted authorization host or malformed public client ID', async () => {
  for (const authUri of [
    `https://evil.example/auth?client_id=${CLIENT_ID}`,
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=not-a-google-client'
  ]) {
    const provider = new FirebaseEmailPasswordProvider({
      apiKey: API_KEY,
      fetchImpl: async () => response({ providerId: 'google.com', sessionId: TOKEN('session'), authUri })
    });
    await assert.rejects(() => provider.inspectGoogleProvider(), error => error instanceof FirebaseRequestError && error.reason === 'INVALID_PROVIDER_RESPONSE');
  }
});

test('Google sign-in exchanges the credential only with Firebase and returns canonical Firebase tokens', async () => {
  const provider = new FirebaseEmailPasswordProvider({ apiKey: API_KEY, fetchImpl: googleFetch() });
  const signed = await provider.signInWithGoogle({ idToken: TOKEN('google-id') });
  assert.equal(signed.subject, 'firebase-google-uid');
  assert.equal(signed.email, 'google.user@example.com');
  assert.equal(signed.emailVerified, true);
  assert.match(signed.refreshToken, /^firebase-refresh/);
});

test('public Google route is publish-gated and never exposes Firebase credentials', async () => {
  const authority = new AuthorityMock();
  const handler = createNativeAuthHandler({ fetchImpl: googleFetch() });
  const baseEnv = { AUTH_AUTHORITY: authority, FIREBASE_WEB_API_KEY: API_KEY };
  const disabled = await handler(request(`${AUTH_API_PREFIX}/google`, { idToken: TOKEN('google-id') }), baseEnv);
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json()).error.code, AUTH_ERROR_CODES.GOOGLE_UNAVAILABLE);

  const canary = await handler(request(`${AUTH_API_PREFIX}/google`, { idToken: TOKEN('google-id-canary') }), {
    ...baseEnv, GOOGLE_AUTH_ACTIVATION: 'canary'
  });
  assert.equal(canary.status, 200);

  const enabled = await handler(request(`${AUTH_API_PREFIX}/google`, { idToken: TOKEN('google-id') }), {
    ...baseEnv, GOOGLE_AUTH_ACTIVATION: 'enabled'
  });
  assert.equal(enabled.status, 200);
  const body = await enabled.json();
  assert.equal(body.authenticated, true);
  assert.equal(body.user.id, 'usr-canonical');
  assert.equal(JSON.stringify(body).includes('firebase-refresh'), false);
  assert.equal(JSON.stringify(body).includes('firebase-id'), false);
  assert.match(enabled.headers.get('Set-Cookie') || '', /HttpOnly; Secure; SameSite=Strict/);
});

test('Google route rejects a Firebase response that does not prove the Google provider binding', async () => {
  const authority = new AuthorityMock();
  const handler = createNativeAuthHandler({ fetchImpl: googleFetch({ includeGoogle: false }) });
  const result = await handler(request(`${AUTH_API_PREFIX}/google`, { idToken: TOKEN('google-id') }), {
    AUTH_AUTHORITY: authority,
    FIREBASE_WEB_API_KEY: API_KEY,
    GOOGLE_AUTH_ACTIVATION: 'enabled'
  });
  assert.equal(result.status, 409);
  assert.equal((await result.json()).error.code, AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
  assert.equal(authority.calls.some(call => call.path === '/internal/firebase/session/create'), false);
});

test('new duplicate Google identity is deleted and requires explicit Firebase account linking', async () => {
  const deleted = [];
  const authority = new AuthorityMock({ conflict: true });
  const handler = createNativeAuthHandler({ fetchImpl: googleFetch({ isNewUser: true, deleted }) });
  const result = await handler(request(`${AUTH_API_PREFIX}/google`, { idToken: TOKEN('google-id') }), {
    AUTH_AUTHORITY: authority,
    FIREBASE_WEB_API_KEY: API_KEY,
    GOOGLE_AUTH_ACTIVATION: 'enabled'
  });
  assert.equal(result.status, 409);
  assert.equal((await result.json()).error.code, AUTH_ERROR_CODES.ACCOUNT_LINK_REQUIRED);
  assert.equal(deleted.length, 1);
  assert.match(deleted[0], /^firebase-id/);
});


test('duplicate Google cleanup failure stays a hard conflict instead of claiming linking is safe', async () => {
  const deleted = [];
  const authority = new AuthorityMock({ conflict: true });
  const handler = createNativeAuthHandler({ fetchImpl: googleFetch({ isNewUser: true, deleted, deleteFails: true }) });
  const result = await handler(request(`${AUTH_API_PREFIX}/google`, { idToken: TOKEN('google-id') }), {
    AUTH_AUTHORITY: authority,
    FIREBASE_WEB_API_KEY: API_KEY,
    GOOGLE_AUTH_ACTIVATION: 'enabled'
  });
  assert.equal(result.status, 409);
  assert.equal((await result.json()).error.code, AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
  assert.equal(deleted.length, 1);
});


test('Google linking reauthenticates the existing Firebase account and preserves its UID', async () => {
  const calls = [];
  const existingSubject = 'firebase-existing-password-uid';
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    calls.push({ path: parsed.pathname, init });
    if (parsed.hostname === 'www.googleapis.com') {
      assert.match(init.headers.Authorization, /^Bearer google-access-/);
      return response({ sub: 'google-subject', email: 'google.user@example.com', email_verified: true });
    }
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (parsed.pathname.endsWith('/accounts:signInWithPassword')) {
      assert.equal(body.email, 'google.user@example.com');
      return response({ localId: existingSubject, idToken: TOKEN('password-id'), refreshToken: TOKEN('password-refresh'), expiresIn: '3600' });
    }
    if (parsed.pathname.endsWith('/accounts:signInWithIdp')) {
      assert.equal(body.idToken, TOKEN('password-id'));
      assert.equal(body.autoCreate, false);
      assert.match(body.postBody, /^access_token=/);
      return response({
        localId: existingSubject,
        idToken: TOKEN('linked-id'),
        refreshToken: TOKEN('linked-refresh'),
        email: 'google.user@example.com',
        emailVerified: true,
        isNewUser: false,
        expiresIn: '3600'
      });
    }
    if (parsed.pathname.endsWith('/accounts:lookup')) {
      return response({ users: [{ localId: existingSubject, email: 'google.user@example.com', emailVerified: true, disabled: false, providerUserInfo: [{ providerId: 'google.com', rawId: 'google-subject' }] }] });
    }
    return response({ error: { message: 'NOT_FOUND' } }, 404);
  };
  const authority = new AuthorityMock();
  const handler = createNativeAuthHandler({ fetchImpl });
  const result = await handler(request(`${AUTH_API_PREFIX}/google/link`, {
    email: 'google.user@example.com',
    password: 'correct-password',
    accessToken: TOKEN('google-access')
  }), {
    AUTH_AUTHORITY: authority,
    FIREBASE_WEB_API_KEY: API_KEY,
    GOOGLE_AUTH_ACTIVATION: 'enabled'
  });
  const body = await result.json();
  assert.equal(result.status, 200, JSON.stringify({ body, calls: calls.map(call => ({ path: call.path, requestBody: String(call.init?.body || '') })) }));
  assert.equal(body.user.id, 'usr-canonical');
  assert.equal(JSON.stringify(body).includes('linked-refresh'), false);
  const sessionCall = authority.calls.find(call => call.path === '/internal/firebase/session/create');
  assert.equal(sessionCall.body.input.subject, existingSubject);
  assert.equal(sessionCall.body.input.email, 'google.user@example.com');
  assert.equal(calls.every(call => call.init.redirect === 'manual'), true);
});

/* ---------------- Google → automatic profile sync (owner blueprint) ---------------- */

const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(24, 7)]);

function withAvatarFetch(urlText, impl) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes(urlText)) return impl(String(url), init);
    return real.call(globalThis, url, init);
  };
  return () => { globalThis.fetch = real; };
}

test('Google login seeds a BLANK profile with the verified name + avatar (no user re-entry)', async () => {
  const authority = new AuthorityMock({ profile: { name: '', avatarPresent: false } });
  const restore = withAvatarFetch('googleusercontent.com', () => new Response(JPEG_BYTES, { status: 200, headers: { 'Content-Type': 'image/jpeg' } }));
  try {
    const handler = createNativeAuthHandler({ fetchImpl: googleFetch({ displayName: 'Rashel Zayan', photoUrl: 'https://lh3.googleusercontent.com/a/face-photo' }) });
    const result = await handler(request(`${AUTH_API_PREFIX}/google`, { idToken: TOKEN('google-id') }), {
      AUTH_AUTHORITY: authority,
      FIREBASE_WEB_API_KEY: API_KEY,
      GOOGLE_AUTH_ACTIVATION: 'enabled'
    });
    assert.equal(result.status, 200);
    const patchCall = authority.calls.find(c => c.path === '/internal/profile/patch');
    assert.ok(patchCall, 'name patch issued');
    assert.equal(patchCall.body.input.fields.fullName, 'Rashel Zayan');
    const avatarCall = authority.calls.find(c => c.path === '/internal/avatar/save');
    assert.ok(avatarCall, 'avatar seeded');
    assert.equal(avatarCall.body.input.mime, 'image/jpeg');
    assert.equal(Buffer.from(avatarCall.body.input.data, 'base64').subarray(0, 3).toString('hex'), 'ffd8ff');
  } finally { restore(); }
});

test('Google login NEVER overwrites data the user already set (no silent overwrite)', async () => {
  const authority = new AuthorityMock({ profile: { name: 'Rasel Ahmed', avatarPresent: true } });
  const restore = withAvatarFetch('googleusercontent.com', () => new Response(JPEG_BYTES, { status: 200 }));
  try {
    const handler = createNativeAuthHandler({ fetchImpl: googleFetch({ displayName: 'Rashel Zayan', photoUrl: 'https://lh3.googleusercontent.com/a/face-photo' }) });
    const result = await handler(request(`${AUTH_API_PREFIX}/google`, { idToken: TOKEN('google-id') }), {
      AUTH_AUTHORITY: authority,
      FIREBASE_WEB_API_KEY: API_KEY,
      GOOGLE_AUTH_ACTIVATION: 'enabled'
    });
    assert.equal(result.status, 200);
    assert.equal(authority.calls.some(c => c.path === '/internal/profile/patch'), false);
    assert.equal(authority.calls.some(c => c.path === '/internal/avatar/save'), false);
  } finally { restore(); }
});

test('Google avatar seeding refuses non-Google URLs (no SSRF) and missing data', async () => {
  const authority = new AuthorityMock({ profile: { name: '', avatarPresent: false } });
  const restore = withAvatarFetch('evil.example', () => new Response(JPEG_BYTES, { status: 200 }));
  try {
    const handler = createNativeAuthHandler({ fetchImpl: googleFetch({ displayName: 'Rashel Zayan', photoUrl: 'https://evil.example/photo.jpg' }) });
    const result = await handler(request(`${AUTH_API_PREFIX}/google`, { idToken: TOKEN('google-id') }), {
      AUTH_AUTHORITY: authority,
      FIREBASE_WEB_API_KEY: API_KEY,
      GOOGLE_AUTH_ACTIVATION: 'enabled'
    });
    assert.equal(result.status, 200);
    assert.equal(authority.calls.some(c => c.path === '/internal/avatar/save'), false);
    assert.ok(authority.calls.some(c => c.path === '/internal/profile/patch'), 'name still seeded');
  } finally { restore(); }
});

test('Profile seed failure never breaks the Google login (best-effort by design)', async () => {
  const authority = new AuthorityMock({ profile: { name: '' }, profileError: true });
  const handler = createNativeAuthHandler({ fetchImpl: googleFetch({ displayName: 'Rashel Zayan', photoUrl: 'https://lh3.googleusercontent.com/a/x' }) });
  const result = await handler(request(`${AUTH_API_PREFIX}/google`, { idToken: TOKEN('google-id') }), {
    AUTH_AUTHORITY: authority,
    FIREBASE_WEB_API_KEY: API_KEY,
    GOOGLE_AUTH_ACTIVATION: 'enabled'
  });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).authenticated, true);
});
