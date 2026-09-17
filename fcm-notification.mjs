/* FCM Notification Foundation — Phase 1 (FCM-NOTIFICATION-BLUEPRINT.md).
 *
 * Runs inside the admission-gk worker (same origin as the app through the
 * Pages proxy, so the `__Host-ah_session` cookie authenticates natively).
 *
 * Routes:
 *   GET  /api/notifications/config           — public Firebase WEB app config (public by design)
 *   GET  /api/notifications/status           — auth: fcm readiness + own device count
 *   POST /api/notifications/register-token   — auth: upsert a device token
 *   POST /api/notifications/unregister-token — auth: deactivate a device token
 *   GET  /api/notifications/devices          — auth: list own active devices
 *   GET  /api/notifications/preferences      — auth: notification_settings row
 *   POST /api/notifications/preferences      — auth: update notification_settings
 *   POST /api/notifications/test             — ADMIN_TOKEN: send a test push
 *   GET  /internal/notifications/health      — operator health (Pages blocks /internal/*)
 *
 * Secrets (Cloudflare worker secrets, never in the browser):
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 * Public web config (safe to expose — Firebase web config is public):
 *   FIREBASE_API_KEY, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_APP_ID, FIREBASE_VAPID_KEY
 *
 * Storage: D1 binding PROFILE_DB (fcm_devices + notification_settings tables).
 * Rate limits: KV binding GK_KV (registration burst + test sends).
 */

const FCM_API_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTHORITY_NAME = 'admission-hub-global-auth-v1';
const SESSION_COOKIE = '__Host-ah_session';
const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{40,96}$/;
const MAX_DEVICES_PER_USER = 12;
const TOKEN_MIN_LEN = 100;
const TOKEN_MAX_LEN = 4096;
const PLATFORM_RE = /^[a-z0-9-]{1,32}$/;
const QUIET_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const DEFAULT_PREFS = Object.freeze({
  push_enabled: 1,
  global_enabled: 1,
  personalized_enabled: 1,
  event_enabled: 1,
  quiet_hours_enabled: 1,
  quiet_start: '23:00',
  quiet_end: '07:00'
});

const b64u = bytes => {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const sha256Hex = async value => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
};

const readSessionToken = request => {
  const cookie = String(request.headers.get('Cookie') || '');
  for (const part of cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === SESSION_COOKIE) {
      return part.slice(idx + 1).trim();
    }
  }
  return '';
};

/* Verify the session cookie against the auth authority DO. Returns
 * { user: { id, ... }, expiresAt } or null. Never throws. */
async function sessionUser(env, request) {
  const token = readSessionToken(request);
  if (!SESSION_TOKEN_RE.test(token)) return null;
  try {
    const id = env.AUTH_AUTHORITY.idFromName(AUTHORITY_NAME);
    const stub = env.AUTH_AUTHORITY.get(id, { locationHint: 'apac' });
    const res = await stub.fetch('https://auth.internal/internal/session/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken: token })
    });
    const data = await res.json();
    if (!res.ok || !data?.ok || !data.result?.user?.id) return null;
    return data.result;
  } catch {
    return null;
  }
}

/* ── D1 store (lazy schema bootstrap, same pattern as D1ProfileStore) ────── */
class FcmStore {
  #d1;
  #ready = false;

  constructor(d1) {
    this.#d1 = d1 || null;
  }

  available() {
    return Boolean(this.#d1);
  }

  async #ensureTables() {
    if (this.#ready) return;
    /* batch() takes D1PreparedStatements, NOT raw SQL strings. Passing strings
     * threw "D1_ERROR: Malformed input" and aborted the whole sequence, so
     * fcm_devices was never created and every register-token write failed —
     * which is why no device could ever receive a push. */
    await this.#d1.batch([
      this.#d1.prepare(`CREATE TABLE IF NOT EXISTS fcm_devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        fcm_token TEXT NOT NULL,
        platform TEXT,
        browser TEXT,
        device_info TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      )`),
      this.#d1.prepare(`CREATE INDEX IF NOT EXISTS idx_fcm_devices_user ON fcm_devices(user_id)`),
      this.#d1.prepare(`CREATE TABLE IF NOT EXISTS notification_settings (
        user_id TEXT PRIMARY KEY,
        push_enabled INTEGER NOT NULL DEFAULT 1,
        global_enabled INTEGER NOT NULL DEFAULT 1,
        personalized_enabled INTEGER NOT NULL DEFAULT 1,
        event_enabled INTEGER NOT NULL DEFAULT 1,
        quiet_hours_enabled INTEGER NOT NULL DEFAULT 1,
        quiet_start TEXT NOT NULL DEFAULT '23:00',
        quiet_end TEXT NOT NULL DEFAULT '07:00',
        updated_at INTEGER NOT NULL
      )`)
    ]);
    this.#ready = true;
  }

  async upsertDevice({ userId, token, platform, browser, deviceInfo, now }) {
    await this.#ensureTables();
    const id = (await sha256Hex(`${userId}|${token}`)).slice(0, 40);
    await this.#d1.prepare(
      `INSERT INTO fcm_devices(id, user_id, fcm_token, platform, browser, device_info, created_at, updated_at, last_seen, is_active)
       VALUES (?,?,?,?,?,?,?,?,?,1)
       ON CONFLICT(id) DO UPDATE SET
         updated_at=excluded.updated_at, last_seen=excluded.last_seen, is_active=1,
         platform=excluded.platform, browser=excluded.browser, device_info=excluded.device_info`
    ).bind(id, userId, token, platform, browser, deviceInfo, now, now, now).run();
    const count = await this.#d1.prepare('SELECT COUNT(*) AS n FROM fcm_devices WHERE user_id=? AND is_active=1')
      .bind(userId).first();
    let overflow = Number(count?.n || 0) - MAX_DEVICES_PER_USER;
    while (overflow > 0) {
      const victim = await this.#d1.prepare(
        `SELECT id FROM fcm_devices WHERE user_id=? AND is_active=1 AND id<>? ORDER BY updated_at ASC LIMIT 1`
      ).bind(userId, id).first();
      if (!victim) break;
      await this.#d1.prepare('UPDATE fcm_devices SET is_active=0, updated_at=? WHERE id=?').bind(now, victim.id).run();
      overflow -= 1;
    }
    return { id };
  }

  async deactivateToken(userId, token) {
    await this.#ensureTables();
    const id = (await sha256Hex(`${userId}|${token}`)).slice(0, 40);
    const res = await this.#d1.prepare('UPDATE fcm_devices SET is_active=0, updated_at=? WHERE id=? AND is_active=1')
      .bind(Date.now(), id).run();
    return Boolean(res?.meta?.changes || 0);
  }

  async markInactive(ids, now) {
    if (!ids.length) return;
    await this.#ensureTables();
    await this.#d1.batch(ids.map(id =>
      this.#d1.prepare('UPDATE fcm_devices SET is_active=0, updated_at=? WHERE id=?').bind(now, id)
    ));
  }

  async activeDevices(userId) {
    await this.#ensureTables();
    const rows = await this.#d1.prepare(
      `SELECT id, fcm_token, platform, browser, device_info, created_at, updated_at, last_seen
       FROM fcm_devices WHERE user_id=? AND is_active=1 ORDER BY updated_at DESC`
    ).bind(userId).all();
    return (rows?.results || []).map(row => ({
      id: row.id,
      token: `${String(row.fcm_token).slice(0, 10)}…`,
      platform: row.platform,
      browser: row.browser,
      deviceInfo: row.device_info,
      createdAt: Number(row.created_at),
      lastSeen: Number(row.last_seen)
    }));
  }

  async activeTokens(userId) {
    await this.#ensureTables();
    const rows = await this.#d1.prepare(
      `SELECT id, fcm_token FROM fcm_devices WHERE user_id=? AND is_active=1 ORDER BY updated_at DESC`
    ).bind(userId).all();
    return (rows?.results || []).map(row => ({ id: row.id, token: row.fcm_token }));
  }

  async getPrefs(userId) {
    await this.#ensureTables();
    const row = await this.#d1.prepare('SELECT * FROM notification_settings WHERE user_id=?').bind(userId).first();
    if (!row) return { ...DEFAULT_PREFS, stored: false };
    return {
      push_enabled: Number(row.push_enabled),
      global_enabled: Number(row.global_enabled),
      personalized_enabled: Number(row.personalized_enabled),
      event_enabled: Number(row.event_enabled),
      quiet_hours_enabled: Number(row.quiet_hours_enabled),
      quiet_start: String(row.quiet_start),
      quiet_end: String(row.quiet_end),
      stored: true
    };
  }

  async savePrefs(userId, prefs, now) {
    await this.#ensureTables();
    await this.#d1.prepare(
      `INSERT INTO notification_settings(user_id, push_enabled, global_enabled, personalized_enabled, event_enabled,
        quiet_hours_enabled, quiet_start, quiet_end, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET
         push_enabled=excluded.push_enabled, global_enabled=excluded.global_enabled,
         personalized_enabled=excluded.personalized_enabled, event_enabled=excluded.event_enabled,
         quiet_hours_enabled=excluded.quiet_hours_enabled, quiet_start=excluded.quiet_start,
         quiet_end=excluded.quiet_end, updated_at=excluded.updated_at`
    ).bind(userId, prefs.push_enabled, prefs.global_enabled, prefs.personalized_enabled, prefs.event_enabled,
      prefs.quiet_hours_enabled, prefs.quiet_start, prefs.quiet_end, now).run();
    return prefs;
  }
}

/* ── KV rate limiter (bounded; full windowing arrives in Phase 5) ────────── */
async function kvRateAllow(env, key, limit, ttlSeconds) {
  const kv = env?.GK_KV;
  if (!kv || typeof kv.get !== 'function') return true;
  try {
    const k = `fcm:${key}`;
    const n = Number(await kv.get(k) || 0);
    if (n >= limit) return false;
    await kv.put(k, String(n + 1), { expirationTtl: ttlSeconds });
    return true;
  } catch {
    return true; // rate limiting must never break the API
  }
}

/* ── FCM HTTP v1 (server-side only) ──────────────────────────────────────── */
const fcmTokenCache = { token: '', exp: 0 };

/* PEM (PKCS#8) → DER bytes for WebCrypto importKey. Handles both real
 * newlines and the `\n`-escaped form Cloudflare secret storage uses. */
const pemToDer = pemValue => {
  const pem = String(pemValue).replace(/\\n/g, '\n');
  const body = pem.replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/\s/g, '');
  if (!body) return null;
  const bin = atob(body);
  return Uint8Array.from(bin, ch => ch.charCodeAt(0));
};

async function fcmAccessToken(env) {
  if (fcmTokenCache.token && fcmTokenCache.exp > Date.now() + 60_000) return fcmTokenCache.token;
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) throw new Error('fcm-not-configured');
  const der = pemToDer(env.FIREBASE_PRIVATE_KEY);
  if (!der) throw new Error('fcm-key-invalid');
  const key = await crypto.subtle.importKey(
    'pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const iat = Math.floor(Date.now() / 1000);
  const header = b64u(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = b64u(new TextEncoder().encode(JSON.stringify({
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: FCM_API_SCOPE,
    aud: FCM_TOKEN_URL,
    iat,
    exp: iat + 3600
  })));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`));
  // Google's token endpoint enforces the full RFC 7523 URN for the JWT
  // bearer grant (the shorthand "jwt-bearer" is rejected as unsupported).
  const form = new URLSearchParams();
  form.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  form.set('assertion', `${header}.${payload}.${b64u(signature)}`);
  const res = await fetch(FCM_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  });
  const data = await res.json();
  if (!res.ok || !data?.access_token) throw new Error('fcm-auth-failed');
  fcmTokenCache.token = data.access_token;
  fcmTokenCache.exp = Date.now() + Number(data.expires_in || 3600) * 1000;
  return data.access_token;
}

/* Send one message per token. Returns per-token outcomes:
 * { ok: true } | { ok: false, reason: 'unregistered' | 'invalid' | 'error' } */
async function fcmSendToDevice(env, { token, title, body, data }) {
  const accessToken = await fcmAccessToken(env);
  const message = {
    token,
    notification: { title, body },
    data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)]))
  };
  let res;
  try {
    res = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ message })
    });
  } catch {
    return { ok: false, reason: 'error' };
  }
  const out = await res.json().catch(() => ({}));
  if (res.ok && out?.name) return { ok: true, name: out.name };
  const code = Number(out?.error?.code || 0);
  // 3 = NOT_FOUND (unregistered token), 6 = INVALID_ARGUMENT (malformed token)
  if (code === 3 || code === 6) return { ok: false, reason: code === 3 ? 'unregistered' : 'invalid' };
  return { ok: false, reason: 'error', detail: String(out?.error?.message || '').slice(0, 200) };
}

function fcmConfigured(env) {
  return Boolean(env?.FIREBASE_PROJECT_ID && env?.FIREBASE_CLIENT_EMAIL && env?.FIREBASE_PRIVATE_KEY);
}

function publicWebConfig(env) {
  if (!fcmConfigured(env)) return null;
  return {
    apiKey: String(env.FIREBASE_API_KEY || ''),
    projectId: String(env.FIREBASE_PROJECT_ID || ''),
    messagingSenderId: String(env.FIREBASE_MESSAGING_SENDER_ID || ''),
    appId: String(env.FIREBASE_APP_ID || ''),
    vapidKey: String(env.FIREBASE_VAPID_KEY || '')
  };
}

const jsonResponse = (request, obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
    'Access-Control-Allow-Credentials': 'true'
  }
});

const parseBody = async request => {
  try {
    const text = await request.text();
    if (!text) return {};
    const data = JSON.parse(text);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return null;
  }
};

/* ── Route handler ───────────────────────────────────────────────────────── */
export async function handleFcmNotificationRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const isApi = path.startsWith('/api/notifications/');
  const isInternal = path === '/internal/notifications/health';
  if (!isApi && !isInternal) return null;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    } });
  }

  const store = new FcmStore(env.PROFILE_DB);

  // Public web app config (Firebase web config values are public by design).
  if (path === '/api/notifications/config' && request.method === 'GET') {
    return jsonResponse(request, { ok: true, fcmConfigured: fcmConfigured(env), webConfig: publicWebConfig(env) });
  }

  if (path === '/internal/notifications/health') {
    return jsonResponse(request, {
      ok: true,
      fcmConfigured: fcmConfigured(env),
      d1: store.available(),
      authAuthority: Boolean(env?.AUTH_AUTHORITY?.idFromName),
      kv: Boolean(env?.GK_KV),
      at: Date.now()
    });
  }

  // Everything below requires an authenticated student.
  const session = await sessionUser(env, request);
  if (!session) return jsonResponse(request, { error: 'auth-required' }, 401);
  const userId = String(session.user.id);

  if (path === '/api/notifications/status' && request.method === 'GET') {
    const prefs = store.available() ? await store.getPrefs(userId) : { ...DEFAULT_PREFS, stored: false };
    const devices = store.available() ? (await store.activeDevices(userId)).length : 0;
    return jsonResponse(request, {
      ok: true,
      fcmConfigured: fcmConfigured(env),
      pushEnabled: Boolean(prefs.push_enabled),
      devices
    });
  }

  if (path === '/api/notifications/register-token' && request.method === 'POST') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    if (!(await kvRateAllow(env, `reg:${userId}`, 10, 3600))) {
      return jsonResponse(request, { error: 'rate-limited' }, 429);
    }
    const body = await parseBody(request);
    if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
    const token = String(body.token || '');
    if (token.length < TOKEN_MIN_LEN || token.length > TOKEN_MAX_LEN) {
      return jsonResponse(request, { error: 'invalid-token' }, 400);
    }
    const platform = PLATFORM_RE.test(String(body.platform || '')) ? String(body.platform) : 'web';
    const browser = PLATFORM_RE.test(String(body.browser || '')) ? String(body.browser) : 'unknown';
    const deviceInfo = String(body.deviceInfo || '').slice(0, 120);
    const now = Date.now();
    await store.upsertDevice({ userId, token, platform, browser, deviceInfo, now });
    /* Welcome push: the user just turned push ON — immediately send a test
     * so the user SEES the whole chain work with zero extra steps (owner:
     * "টোকেনের ঝামেলা চাই না"). Best effort — a push hiccup must never
     * fail the registration itself. */
    let welcome = false;
    try {
      if (fcmConfigured(env) && env.FCM_WELCOME_PUSH !== 'off') {
        welcome = Boolean((await fcmSendToDevice(env, {
          token,
          title: '✅ Push চালু হয়েছে',
          body: 'এটি Admission Hub-এর test push — সিস্টেম চলছে ✅ (test message)',
          data: { link: 'notifications', src: 'fcm-welcome' }
        })).ok);
      }
    } catch (_) { welcome = false; }
    return jsonResponse(request, { ok: true, registered: true, welcome, devices: (await store.activeDevices(userId)).length }, 201);
  }

  if (path === '/api/notifications/unregister-token' && request.method === 'POST') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const body = await parseBody(request);
    if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
    const token = String(body.token || '');
    if (!token) return jsonResponse(request, { error: 'invalid-token' }, 400);
    const changed = await store.deactivateToken(userId, token);
    return jsonResponse(request, { ok: true, deactivated: changed, devices: (await store.activeDevices(userId)).length });
  }

  if (path === '/api/notifications/devices' && request.method === 'GET') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    return jsonResponse(request, { ok: true, devices: await store.activeDevices(userId) });
  }

  if (path === '/api/notifications/preferences' && request.method === 'GET') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const prefs = await store.getPrefs(userId);
    return jsonResponse(request, { ok: true, prefs: { ...prefs, stored: undefined }, defaults: DEFAULT_PREFS });
  }

  if (path === '/api/notifications/preferences' && request.method === 'POST') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const body = await parseBody(request);
    if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
    const current = await store.getPrefs(userId);
    const asBool = value => (value === undefined ? null : (value ? 1 : 0));
    const next = {
      push_enabled: asBool(body.push_enabled) ?? current.push_enabled,
      global_enabled: asBool(body.global_enabled) ?? current.global_enabled,
      personalized_enabled: asBool(body.personalized_enabled) ?? current.personalized_enabled,
      event_enabled: asBool(body.event_enabled) ?? current.event_enabled,
      quiet_hours_enabled: asBool(body.quiet_hours_enabled) ?? current.quiet_hours_enabled
    };
    const quietStart = body.quiet_start === undefined ? current.quiet_start : String(body.quiet_start);
    const quietEnd = body.quiet_end === undefined ? current.quiet_end : String(body.quiet_end);
    if (!QUIET_RE.test(quietStart) || !QUIET_RE.test(quietEnd)) {
      return jsonResponse(request, { error: 'invalid-quiet-hours' }, 400);
    }
    next.quiet_start = quietStart;
    next.quiet_end = quietEnd;
    await store.savePrefs(userId, next, Date.now());
    return jsonResponse(request, { ok: true, prefs: next });
  }

  if (path === '/api/notifications/test' && request.method === 'POST') {
    const token = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
      return jsonResponse(request, { error: 'forbidden' }, 403);
    }
    if (!fcmConfigured(env)) return jsonResponse(request, { error: 'fcm-not-configured' }, 503);
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    if (!(await kvRateAllow(env, `test:${userId}`, 5, 600))) {
      return jsonResponse(request, { error: 'rate-limited' }, 429);
    }
    const body = await parseBody(request) || {};
    const title = String(body.title || '🔔 Admission Hub').slice(0, 120);
    const text = String(body.body || 'FCM notification system successfully configured.').slice(0, 400);
    const link = String(body.link || '/').replace(/[^\w./#-]/g, '').slice(0, 200);
    const targets = (await store.activeTokens(userId)).slice(0, 8);
    if (!targets.length) return jsonResponse(request, { error: 'no-devices' }, 404);
    const results = [];
    for (const device of targets) {
      const outcome = await fcmSendToDevice(env, { token: device.token, title, body: text, data: { link, src: 'fcm-test' } });
      if (!outcome.ok && (outcome.reason === 'unregistered' || outcome.reason === 'invalid')) {
        await store.markInactive([device.id], Date.now());
      }
      results.push({ id: device.id, ok: outcome.ok, reason: outcome.reason || 'ok' });
    }
    return jsonResponse(request, { ok: results.every(r => r.ok), sent: results.filter(r => r.ok).length, total: results.length, results });
  }

  /* Self-service test push: an authenticated user sends a test notification
   * to their OWN registered devices — no admin token needed (owner directive
   * 2026-09-17: "টোকেনের ঝামেলা না"). Strictly rate-limited (3/hour). */
  if (path === '/api/notifications/self-test' && request.method === 'POST') {
    if (!fcmConfigured(env)) return jsonResponse(request, { error: 'fcm-not-configured' }, 503);
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    if (!(await kvRateAllow(env, `selftest:${userId}`, 3, 3600))) {
      return jsonResponse(request, { error: 'rate-limited' }, 429);
    }
    const targets = (await store.activeTokens(userId)).slice(0, 8);
    if (!targets.length) return jsonResponse(request, { error: 'no-devices' }, 404);
    const results = [];
    for (const device of targets) {
      const outcome = await fcmSendToDevice(env, {
        token: device.token,
        title: '📡 Test notification',
        body: 'এটি Admission Hub-এর test push — সিস্টেম ঠিকঠাক চলছে ✅',
        data: { link: 'notifications', src: 'fcm-self-test' }
      });
      if (!outcome.ok && (outcome.reason === 'unregistered' || outcome.reason === 'invalid')) {
        await store.markInactive([device.id], Date.now());
      }
      results.push({ id: device.id, ok: outcome.ok, reason: outcome.reason || 'ok' });
    }
    return jsonResponse(request, { ok: results.every(r => r.ok), sent: results.filter(r => r.ok).length, total: results.length, results });
  }

  return jsonResponse(request, { error: 'not-found' }, 404);
}

export const __fcmNotificationTest = Object.freeze({
  b64u,
  sha256Hex,
  readSessionToken,
  pemToDer,
  FcmStore,
  fcmConfigured,
  publicWebConfig,
  kvRateAllow,
  DEFAULT_PREFS
});
