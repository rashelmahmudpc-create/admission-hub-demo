/* Phase 1 — FCM foundation contract (fcm-notification.mjs).
 * Stubs: D1 (in-memory, pattern-matched on the module's fixed SQL),
 * AUTH_AUTHORITY (session DO), GK_KV (Map), and globalThis.fetch
 * (OAuth + FCM endpoints). No network access. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  handleFcmNotificationRequest,
  __fcmNotificationTest as T
} from './fcm-notification.mjs';

const VALID_SESSION = `sess-${'a'.repeat(40)}`.slice(0, 64); // 40–96 chars, [A-Za-z0-9_-]
const USER_ID = 'user-fcm-1';

/* Registration now also subscribes the device to the topic server-side (an
 * extra outbound call). Default the transport to "offline" so the suite stays
 * hermetic: the subscribe is designed to be best-effort, and every test that
 * needs FCM/OAuth stubs fetch itself and still restores to this offline stub. */
const OFFLINE_FETCH = async () => { throw new Error('offline-test-transport'); };
globalThis.fetch = OFFLINE_FETCH;

// ── in-memory D1 (pattern-matched on the module's fixed SQL) ───────────────
function makeFakeD1() {
  const devices = new Map(); // id → row
  const settings = new Map(); // user_id → row
  const stmt = (sql, args) => {
    const run = () => {
      if (sql.includes('INSERT INTO fcm_devices')) {
        const [id, userId, fcmToken, platform, browser, deviceInfo, createdAt, updatedAt, lastSeen] = args;
        devices.set(id, { id, userId, fcmToken, platform, browser, deviceInfo, createdAt, updatedAt, lastSeen, isActive: 1 });
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.includes('UPDATE fcm_devices SET is_active=0') && sql.includes('AND is_active=1')) {
        const [now, id] = args;
        const row = devices.get(id);
        if (row && row.isActive) { row.isActive = 0; row.updatedAt = now; return { success: true, meta: { changes: 1 } }; }
        return { success: true, meta: { changes: 0 } };
      }
      if (sql.includes('UPDATE fcm_devices SET is_active=0')) {
        const [now, id] = args;
        const row = devices.get(id);
        if (row) { row.isActive = 0; row.updatedAt = now; }
        return { success: true, meta: { changes: row ? 1 : 0 } };
      }
      if (sql.includes('INSERT INTO notification_settings')) {
        const [userId, pushEnabled, globalEnabled, personalizedEnabled, eventEnabled, quietHoursEnabled, quietStart, quietEnd, now] = args;
        settings.set(userId, { user_id: userId, push_enabled: pushEnabled, global_enabled: globalEnabled, personalized_enabled: personalizedEnabled, event_enabled: eventEnabled, quiet_hours_enabled: quietHoursEnabled, quiet_start: quietStart, quiet_end: quietEnd, updated_at: now });
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    };
    const first = () => {
      if (sql.includes('SELECT COUNT(*)')) {
        const [userId] = args;
        return { n: [...devices.values()].filter(r => r.userId === userId && r.isActive).length };
      }
      if (sql.includes('SELECT id FROM fcm_devices')) {
        const [userId, selfId] = args;
        const victim = [...devices.values()]
          .filter(r => r.userId === userId && r.isActive && r.id !== selfId)
          .sort((a, b) => a.updatedAt - b.updatedAt)[0];
        return victim ? { id: victim.id } : null;
      }
      if (sql.includes('SELECT * FROM notification_settings')) {
        return settings.get(args[0]) || null;
      }
      return null;
    };
    const all = () => {
      if (sql.includes('SELECT id, fcm_token, platform, browser, device_info')) {
        const rows = [...devices.values()].filter(r => r.userId === args[0] && r.isActive)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map(r => ({ id: r.id, fcm_token: r.fcmToken, platform: r.platform, browser: r.browser, device_info: r.deviceInfo, created_at: r.createdAt, updated_at: r.updatedAt, last_seen: r.lastSeen }));
        return { results: rows };
      }
      if (sql.includes('SELECT id, fcm_token FROM fcm_devices')) {
        const rows = [...devices.values()].filter(r => r.userId === args[0] && r.isActive)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map(r => ({ id: r.id, fcm_token: r.fcmToken }));
        return { results: rows };
      }
      return { results: [] };
    };
    return { run, first, all };
  };
  return {
    _devices: devices, _settings: settings,
    prepare(sql) {
      // Real D1PreparedStatement exposes run/first/all directly AND bind().
      return { ...stmt(sql, []), bind: (...args) => stmt(sql, args) };
    },
    async batch(statements) {
      const results = [];
      for (const s of statements) {
        // Real D1 rejects raw SQL strings here ("Malformed input"), so the fake
        // must too — otherwise a string-vs-prepared-statement mistake in a
        // caller passes CI and then fails on every real registration.
        if (typeof s === 'string') {
          throw new Error('D1_ERROR: Malformed input: [{}], should be {sql: string, params?: any[]} or an array of these query objects');
        }
        results.push(await s.run());
      }
      return results;
    }
  };
}

function makeAuthority(validTokens = new Set([VALID_SESSION])) {
  return {
    idFromName(name) { return name; },
    get() {
      return {
        async fetch(input, init) {
          const url = new URL(input);
          if (url.pathname !== '/internal/session/get') return Response.json({ ok: false }, { status: 404 });
          const body = JSON.parse(init?.body || '{}');
          if (!validTokens.has(body.sessionToken)) return Response.json({ ok: false, error: { code: 'SESSION_INVALID' } }, { status: 401 });
          return Response.json({
            ok: true,
            result: { expiresAt: Date.now() + 3600_000, user: { id: USER_ID, emailMasked: 'a…e.com', status: 'active', createdAt: 1 } }
          });
        }
      };
    }
  };
}

function makeFakeKV() {
  const map = new Map();
  return {
    _map: map,
    async get(k) { return map.has(k) ? map.get(k).v : null; },
    async put(k, v) { map.set(k, { v, t: Date.now() }); },
    async delete(k) { map.delete(k); }
  };
}

function pemFromPkcs8(key) {
  const der = Buffer.from(key);
  const b64 = der.toString('base64');
  const lines = b64.match(/.{1,64}/g).join('\n');
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
}

async function makeFcmEnv(overrides = {}) {
  const keyPair = await webcrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
  const exported = await webcrypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  return {
    AUTH_AUTHORITY: makeAuthority(),
    PROFILE_DB: makeFakeD1(),
    GK_KV: makeFakeKV(),
    ADMIN_TOKEN: 'admin-fcm-test-token-0123456789',
    FIREBASE_PROJECT_ID: 'test-project',
    FIREBASE_CLIENT_EMAIL: 'svc@test-project.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: pemFromPkcs8(exported),
    FIREBASE_API_KEY: 'AIzaTestWebApiKey',
    FIREBASE_MESSAGING_SENDER_ID: '1234567890',
    FIREBASE_APP_ID: '1:1234567890:web:abc123',
    FIREBASE_VAPID_KEY: 'BJtpTestVapidKey',
    FCM_WELCOME_PUSH: 'off', /* base env: skip the automatic welcome push (external FCM call) */
    ...overrides
  };
}

const cookieRequest = (path, { method = 'GET', session = VALID_SESSION, admin, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (session) headers.Cookie = `__Host-ah_session=${session}`;
  if (admin) headers.Authorization = `Bearer ${admin}`;
  return new Request(`https://admission-gk.admissionhub.workers.dev${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
};

const call = async (request, env) => {
  const response = await handleFcmNotificationRequest(request, env);
  assert.ok(response instanceof Response, 'expected a Response');
  return { response, data: await response.json() };
};

test('unit: b64u / sha256Hex / readSessionToken', async () => {
  assert.equal(T.b64u(new TextEncoder().encode('hello')), 'aGVsbG8');
  assert.equal((await T.sha256Hex('x')).length, 64);
  assert.equal(T.readSessionToken(new Request('https://x/', { headers: { Cookie: 'a=1; __Host-ah_session=abc123; b=2' } })), 'abc123');
  assert.equal(T.readSessionToken(new Request('https://x/', { headers: { Cookie: 'a=1' } })), '');
});

test('config route is public and hides nothing sensitive', async () => {
  const env = await makeFcmEnv();
  const { response, data } = await call(new Request('https://x/api/notifications/config'), env);
  assert.equal(response.status, 200);
  assert.equal(data.fcmConfigured, true);
  assert.equal(data.webConfig.vapidKey, 'BJtpTestVapidKey');
  assert.equal(data.webConfig.projectId, 'test-project');
  assert.ok(!JSON.stringify(data).includes('PRIVATE_KEY'), 'private key must never be exposed');
  const bare = await makeFcmEnv({ FIREBASE_PROJECT_ID: '', FIREBASE_CLIENT_EMAIL: '', FIREBASE_PRIVATE_KEY: '' });
  const unconfigured = await call(new Request('https://x/api/notifications/config'), bare);
  assert.equal(unconfigured.data.fcmConfigured, false);
  assert.equal(unconfigured.data.webConfig, null);
});

test('auth-required routes reject missing/invalid sessions', async () => {
  const env = await makeFcmEnv();
  for (const session of [null, 'short', 'x'.repeat(200)]) {
    const { response } = await call(cookieRequest('/api/notifications/status', { session }), env);
    assert.equal(response.status, 401, `session=${session && session.length}`);
  }
});

test('status reports readiness + device count', async () => {
  const env = await makeFcmEnv();
  const { response, data } = await call(cookieRequest('/api/notifications/status'), env);
  assert.equal(response.status, 200);
  assert.equal(data.fcmConfigured, true);
  assert.equal(data.devices, 0);
});

test('register-token validates, upserts and caps devices at 12', async () => {
  const env = await makeFcmEnv();
  const short = await call(cookieRequest('/api/notifications/register-token', { method: 'POST', body: { token: 'too-short' } }), env);
  assert.equal(short.response.status, 400);
  assert.equal(short.data.error, 'invalid-token');
  const anon = await call(cookieRequest('/api/notifications/register-token', { method: 'POST', session: null, body: { token: 't'.repeat(120) } }), env);
  assert.equal(anon.response.status, 401);

  // Seed 12 devices directly (the per-hour rate limit correctly blocks 12+
  // API registrations in one burst — that is tested separately below).
  const d1 = env.PROFILE_DB;
  for (let i = 0; i < 12; i++) {
    const id = `seed-${i}`;
    d1._devices.set(id, {
      id, userId: USER_ID, fcmToken: `seed-${'s'.repeat(100)}-${i}`,
      platform: 'android', browser: 'chrome', deviceInfo: '',
      createdAt: 1000 + i, updatedAt: 1000 + i, lastSeen: 1000 + i, isActive: 1
    });
  }
  const out = await call(cookieRequest('/api/notifications/register-token', { method: 'POST', body: { token: `new-${'n'.repeat(120)}`.slice(0, 150), platform: 'ios', browser: 'safari' } }), env);
  assert.equal(out.response.status, 201);
  const { data } = await call(cookieRequest('/api/notifications/devices'), env);
  assert.equal(data.devices.length, 12, 'oldest device evicted beyond the cap');
  const tokens = data.devices.map(d => d.token);
  assert.ok(!tokens.includes('seed-0'), 'the oldest seeded device was evicted');
  assert.ok(data.devices[0].token.endsWith('…'), 'tokens are masked in listings');
});

test('unregister-token deactivates and reports remaining count', async () => {
  const env = await makeFcmEnv();
  const token = `rem-${'q'.repeat(120)}`;
  await call(cookieRequest('/api/notifications/register-token', { method: 'POST', body: { token } }), env);
  const out = await call(cookieRequest('/api/notifications/unregister-token', { method: 'POST', body: { token } }), env);
  assert.equal(out.data.deactivated, true);
  assert.equal(out.data.devices, 0);
  const again = await call(cookieRequest('/api/notifications/unregister-token', { method: 'POST', body: { token } }), env);
  assert.equal(again.data.deactivated, false);
});

test('preferences defaults, partial update and quiet-hours validation', async () => {
  const env = await makeFcmEnv();
  const defaults = await call(cookieRequest('/api/notifications/preferences'), env);
  assert.equal(defaults.data.prefs.push_enabled, 1);
  assert.equal(defaults.data.prefs.quiet_start, '23:00');
  const updated = await call(cookieRequest('/api/notifications/preferences', { method: 'POST', body: { push_enabled: false, quiet_start: '00:30', quiet_end: '07:00' } }), env);
  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.prefs.push_enabled, 0);
  assert.equal(updated.data.prefs.quiet_start, '00:30');
  assert.equal(updated.data.prefs.global_enabled, 1, 'untouched fields keep their value');
  const bad = await call(cookieRequest('/api/notifications/preferences', { method: 'POST', body: { quiet_start: '25:99' } }), env);
  assert.equal(bad.response.status, 400);
  assert.equal(bad.data.error, 'invalid-quiet-hours');
});

test('registration burst is rate limited (10/hour per user)', async () => {
  const env = await makeFcmEnv();
  let last = null;
  for (let i = 0; i < 12; i++) {
    last = await call(cookieRequest('/api/notifications/register-token', { method: 'POST', body: { token: `rl-${'z'.repeat(100)}-${i}`.slice(0, 150) } }), env);
  }
  assert.equal(last.response.status, 429);
  assert.equal(last.data.error, 'rate-limited');
});

test('test endpoint requires admin token, devices, and sends via FCM v1', async () => {
  const env = await makeFcmEnv();
  const token = `tst-${'m'.repeat(120)}`;
  await call(cookieRequest('/api/notifications/register-token', { method: 'POST', body: { token } }), env);

  const noAdmin = await call(cookieRequest('/api/notifications/test', { method: 'POST', body: { body: 'hi' } }), env);
  assert.equal(noAdmin.response.status, 403);
  const badAdmin = await call(cookieRequest('/api/notifications/test', { method: 'POST', admin: 'wrong', body: { body: 'hi' } }), env);
  assert.equal(badAdmin.response.status, 403);

  const realFetch = globalThis.fetch;
  const seen = [];
  let oauthBody = '';
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com')) {
      oauthBody = String(init?.body || '');
      return Response.json({ access_token: 'fake-oauth-token', expires_in: 3600 });
    }
    if (url.includes('fcm.googleapis.com')) {
      seen.push({ url, auth: init?.headers?.Authorization, body: JSON.parse(init?.body) });
      return Response.json({ name: 'projects/test-project/messages/msg-1' });
    }
    return realFetch(input, init);
  };
  try {
    const ok = await call(cookieRequest('/api/notifications/test', { method: 'POST', admin: 'admin-fcm-test-token-0123456789', body: { body: 'hello device', link: 'dashboard' } }), env);
    assert.equal(ok.response.status, 200);
    assert.equal(ok.data.sent, 1);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].auth, 'Bearer fake-oauth-token');
    assert.equal(seen[0].body.message.notification.body, 'hello device');
    assert.equal(seen[0].body.message.data.link, 'dashboard');
    // Google enforces the full RFC 7523 URN — the shorthand is rejected.
    assert.match(oauthBody, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
    assert.match(oauthBody, /assertion=eyJhbGciOiJSUzI1NiI/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('FCM NOT_FOUND deactivates the dead token', async () => {
  const env = await makeFcmEnv();
  const token = `dead-${'d'.repeat(120)}`;
  await call(cookieRequest('/api/notifications/register-token', { method: 'POST', body: { token } }), env);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'fake-oauth-token', expires_in: 3600 });
    if (url.includes('fcm.googleapis.com')) {
      return Response.json({ error: { code: 3, message: 'Requested entity was not found.', status: 'NOT_FOUND' } }, { status: 404 });
    }
    return realFetch(input, init);
  };
  try {
    const out = await call(cookieRequest('/api/notifications/test', { method: 'POST', admin: 'admin-fcm-test-token-0123456789', body: {} }), env);
    assert.equal(out.data.sent, 0);
    assert.equal(out.data.results[0].reason, 'unregistered');
    const devices = await call(cookieRequest('/api/notifications/devices'), env);
    assert.equal(devices.data.devices.length, 0, 'dead token removed from the active list');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('register-token sends NO welcome push (owner 2026-09-17: enabling is silent)', async () => {
  const env = await makeFcmEnv({ FCM_WELCOME_PUSH: 'on' });
  const realFetch = globalThis.fetch;
  let fcmCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'fake-oauth-token', expires_in: 3600 });
    if (url.includes('fcm.googleapis.com')) { fcmCalls++; return Response.json({ name: 'x' }, { status: 200 }); }
    return realFetch(input, init);
  };
  try {
    const out = await call(cookieRequest('/api/notifications/register-token', { method: 'POST', body: { token: `wel-${'w'.repeat(120)}` } }), env);
    assert.equal(out.response.status, 201);
    assert.equal('welcome' in out.data, false, 'no welcome field in the register response');
    assert.equal(fcmCalls, 0, 'zero FCM sends on registration — nothing is shown to the user');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('self-test: users push a test to their OWN devices, no admin token, rate-limited', async () => {
  const env = await makeFcmEnv();
  const token = `st-${'t'.repeat(120)}`;
  await call(cookieRequest('/api/notifications/register-token', { method: 'POST', body: { token } }), env);
  const realFetch = globalThis.fetch;
  let fcmCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'fake-oauth-token', expires_in: 3600 });
    if (url.includes('fcm.googleapis.com')) { fcmCalls++; return Response.json({ name: 'projects/test-project/messages/self-1' }, { status: 200 }); }
    return realFetch(input, init);
  };
  try {
    const ok = await call(cookieRequest('/api/notifications/self-test', { method: 'POST' }), env);
    assert.equal(ok.response.status, 200);
    assert.equal(ok.data.ok, true);
    assert.equal(ok.data.sent, 1);
    assert.equal(fcmCalls, 1);
    const anon = await call(cookieRequest('/api/notifications/self-test', { method: 'POST', session: null }), env);
    assert.equal(anon.response.status, 401, 'no session → 401');
    await call(cookieRequest('/api/notifications/unregister-token', { method: 'POST', body: { token } }), env);
    const noDevices = await call(cookieRequest('/api/notifications/self-test', { method: 'POST' }), env);
    assert.equal(noDevices.response.status, 404, 'no registered device → 404');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('health endpoint reports components', async () => {
  const env = await makeFcmEnv();
  const { response, data } = await call(new Request('https://x/internal/notifications/health'), env);
  assert.equal(response.status, 200);
  assert.equal(data.fcmConfigured, true);
  assert.equal(data.d1, true);
  assert.equal(data.authAuthority, true);
});

test('non-notification paths pass through (null)', async () => {
  const env = await makeFcmEnv();
  assert.equal(await handleFcmNotificationRequest(new Request('https://x/api/ask'), env), null);
  assert.equal(await handleFcmNotificationRequest(new Request('https://x/'), env), null);
  const unknown = await call(cookieRequest('/api/notifications/whatever'), env);
  assert.equal(unknown.response.status, 404);
});
