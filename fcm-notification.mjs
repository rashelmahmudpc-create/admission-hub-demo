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
      )`),
      this.#d1.prepare(`CREATE TABLE IF NOT EXISTS global_notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        image_url TEXT,
        target_url TEXT,
        audience TEXT NOT NULL DEFAULT 'all_students',
        topic TEXT NOT NULL,
        dedup TEXT,
        scheduled_at INTEGER,
        sent_at INTEGER,
        created_by TEXT NOT NULL,
        status TEXT NOT NULL,
        fcm_message_id TEXT,
        reach_estimate INTEGER,
        clicks INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at INTEGER NOT NULL
      )`),
      this.#d1.prepare(`CREATE INDEX IF NOT EXISTS idx_gn_status ON global_notifications(status, scheduled_at)`),
      this.#d1.prepare(`CREATE INDEX IF NOT EXISTS idx_gn_created ON global_notifications(created_at DESC)`),
      this.#d1.prepare(`CREATE TABLE IF NOT EXISTS notification_reads (
        notification_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        read_at INTEGER NOT NULL,
        PRIMARY KEY (notification_id, user_id)
      )`)
    ]);
    try { await this.#d1.prepare('ALTER TABLE fcm_devices ADD COLUMN topics TEXT').run(); } catch (_) { /* column already exists */ }
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

  /* ── Phase 2: global notification storage ───────────────────────────────── */
  async insertGlobal(row) {
    await this.#ensureTables();
    await this.#d1.prepare(
      `INSERT INTO global_notifications(id, type, title, body, image_url, target_url, audience, topic,
        dedup, scheduled_at, created_by, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(row.id, row.type, row.title, row.body, row.imageUrl || null, row.targetUrl || null,
      row.audience, row.topic, row.dedup || null, row.scheduledAt || null,
      row.createdBy, row.status, row.createdAt).run();
  }

  async updateGlobalStatus(id, patch) {
    await this.#ensureTables();
    const sets = [];
    const binds = [];
    if (patch.status !== undefined) { sets.push('status=?'); binds.push(patch.status); }
    if (patch.sentAt !== undefined) { sets.push('sent_at=?'); binds.push(patch.sentAt); }
    if (patch.fcmMessageId !== undefined) { sets.push('fcm_message_id=?'); binds.push(patch.fcmMessageId); }
    if (patch.reachEstimate !== undefined) { sets.push('reach_estimate=?'); binds.push(patch.reachEstimate); }
    if (patch.error !== undefined) { sets.push('error=?'); binds.push(patch.error); }
    if (!sets.length) return;
    binds.push(id);
    await this.#d1.prepare(`UPDATE global_notifications SET ${sets.join(', ')} WHERE id=?`).bind(...binds).run();
  }

  async dueGlobals(now) {
    await this.#ensureTables();
    const res = await this.#d1.prepare(
      `SELECT * FROM global_notifications WHERE status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at<=? ORDER BY scheduled_at ASC LIMIT 20`
    ).bind(now).all();
    return (res?.results || []).map(row => ({
      id: row.id, type: row.type, title: row.title, body: row.body,
      imageUrl: row.image_url, targetUrl: row.target_url,
      audience: row.audience, topic: row.topic, scheduledAt: Number(row.scheduled_at || 0)
    }));
  }

  async recentGlobals(limit = 50) {
    await this.#ensureTables();
    const res = await this.#d1.prepare(
      `SELECT id, type, title, body, audience, topic, status, scheduled_at, sent_at, reach_estimate, clicks, error, created_at
       FROM global_notifications ORDER BY created_at DESC, id DESC LIMIT ?`
    ).bind(limit).all();
    return (res?.results || []).map(row => ({
      id: row.id, type: row.type, title: row.title, body: row.body,
      audience: row.audience, topic: row.topic, status: row.status,
      scheduledAt: row.scheduled_at ? Number(row.scheduled_at) : null,
      sentAt: row.sent_at ? Number(row.sent_at) : null,
      reachEstimate: row.reach_estimate ? Number(row.reach_estimate) : null,
      clicks: Number(row.clicks || 0),
      error: row.error,
      createdAt: Number(row.created_at)
    }));
  }

  async duplicateRecent(dedup, sinceMs) {
    await this.#ensureTables();
    const row = await this.#d1.prepare(
      `SELECT id FROM global_notifications WHERE dedup=? AND status IN ('sent','scheduled') AND created_at>=? LIMIT 1`
    ).bind(dedup, sinceMs).first();
    return row ? row.id : null;
  }

  async markRead(notificationId, userId, now) {
    await this.#ensureTables();
    await this.#d1.prepare(
      `INSERT OR IGNORE INTO notification_reads(notification_id, user_id, read_at) VALUES (?,?,?)`
    ).bind(notificationId, userId, now).run();
  }

  async readState(userId, ids) {
    if (!ids.length) return {};
    await this.#ensureTables();
    const res = await this.#d1.prepare(
      `SELECT notification_id, read_at FROM notification_reads WHERE user_id=? AND notification_id IN (${ids.map(() => '?').join(',')})`
    ).bind(userId, ...ids).all();
    const out = {};
    for (const row of res?.results || []) out[row.notification_id] = Number(row.read_at);
    return out;
  }

  async globalFeed(limit = 30) {
    await this.#ensureTables();
    const res = await this.#d1.prepare(
      `SELECT id, type, title, body, image_url, target_url, audience, sent_at
       FROM global_notifications WHERE status='sent' AND sent_at IS NOT NULL
       ORDER BY sent_at DESC LIMIT ?`
    ).bind(limit).all();
    return (res?.results || []).map(row => ({
      id: row.id, type: row.type, title: row.title, body: row.body,
      imageUrl: row.image_url, targetUrl: row.target_url,
      audience: row.audience, sentAt: Number(row.sent_at)
    }));
  }

  async incrementClicks(id) {
    await this.#ensureTables();
    await this.#d1.prepare(`UPDATE global_notifications SET clicks=clicks+1 WHERE id=?`).bind(id).run();
  }

  async setDeviceTopics(userId, token, topicsCsv) {
    await this.#ensureTables();
    await this.#d1.prepare('UPDATE fcm_devices SET topics=? WHERE user_id=? AND fcm_token=?')
      .bind(topicsCsv, userId, token).run();
  }

  async activeDevicesMissingTopic(topic) {
    await this.#ensureTables();
    const res = await this.#d1.prepare(
      `SELECT id, fcm_token FROM fcm_devices WHERE is_active=1 AND (topics IS NULL OR topics='' OR topics NOT LIKE ?) LIMIT 2000`
    ).bind(`%${topic}%`).all();
    return (res?.results || []).map(row => ({ id: row.id, token: row.fcm_token }));
  }

  async allActiveTokens() {
    await this.#ensureTables();
    const res = await this.#d1.prepare(
      `SELECT id, fcm_token FROM fcm_devices WHERE is_active=1 LIMIT 2000`
    ).all();
    return (res?.results || []).map(row => ({ id: row.id, token: row.fcm_token }));
  }

  async activeDeviceCount() {
    await this.#ensureTables();
    const row = await this.#d1.prepare('SELECT COUNT(*) AS n FROM fcm_devices WHERE is_active=1').first();
    return Number(row?.n || 0);
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

/* ── Phase 2 — Global Notification Engine (owner-approved 2026-09-17) ──────
 * Topic-first sends (spec "$0-first"): ONE FCM topic call reaches every
 * subscribed device — no per-user loop. Devices that could not subscribe to
 * the topic get a multi-token fallback (chunks of 500), so API calls stay
 * O(1), never O(users). Scheduled globals run from the worker cron
 * (Cloudflare Cron Triggers — the owner's no-Vercel rule replaces the
 * spec's "Vercel Cron").
 *
 * Routes (admin = session + Bearer ADMIN_TOKEN; user = session cookie):
 *   POST /api/notifications/global/send        — admin: create + send now
 *   POST /api/notifications/global/schedule    — admin: create + schedule
 *   POST /api/notifications/global/cancel      — admin: cancel a scheduled
 *   GET  /api/notifications/history            — admin: recent globals
 *   GET  /api/notifications/templates          — admin: preset templates
 *   POST /api/notifications/topics/subscribe   — user: mark device topics
 *   POST /api/notifications/topics/unsubscribe — user: unmark device topics
 *   GET  /api/notifications/inbox              — user: global feed + read state
 *   POST /api/notifications/read               — user: mark a global read
 *   POST /api/notifications/click              — user: log a deep-link click
 */
const GLOBAL_TYPES = Object.freeze(['new-content', 'announcement', 'new-feature', 'challenge', 'course', 'important']);
const GLOBAL_AUDIENCES = Object.freeze({
  all_students: { topic: 'all_students', bn: 'সব Student', en: 'All Students' },
  beginner: { topic: 'course_beginner', bn: 'Beginner Student', en: 'Beginner Students' },
  intermediate: { topic: 'course_intermediate', bn: 'Intermediate Student', en: 'Intermediate Students' },
  pro: { topic: 'course_pro', bn: 'Pro Student', en: 'Pro Students' },
  course_subscribers: { topic: 'course_all', bn: 'Course Subscribers', en: 'Course Subscribers' }
});
const GLOBAL_DAILY_CAP = 10;
const GLOBAL_MAX_SCHEDULE_DAYS = 30;
const GN_ID_RE = /^gn-[a-z0-9]{12}$/;
const TOPIC_RE = /^[a-z][a-z0-9_-]{0,63}$/;

/* Dual-language preset templates (spec §13). Variables: {{title}} {{lesson}}
 * {{course}} {{feature}} {{date}} — the admin replaces them in the composer. */
const GLOBAL_TEMPLATES = Object.freeze([
  { key: 'new-content', type: 'new-content',
    bn: { title: '{{title}} এখন available', body: 'নতুন content এখন available — দেখে নিন।' },
    en: { title: '{{title}} is now available', body: 'New content is live — take a look.' } },
  { key: 'announcement', type: 'announcement',
    bn: { title: 'গুরুত্বপূর্ণ আপডেট', body: '{{title}}' },
    en: { title: 'Important update', body: '{{title}}' } },
  { key: 'new-feature', type: 'new-feature',
    bn: { title: 'নতুন feature live হয়েছে', body: '{{feature}} এখন available — ব্যবহার করে দেখুন।' },
    en: { title: 'New feature is live', body: '{{feature}} is available — give it a try.' } },
  { key: 'challenge', type: 'challenge',
    bn: { title: 'সাপ্তাহিক challenge শুরু!', body: 'নতুন challenge ready। শেষ: {{date}}' },
    en: { title: 'Weekly challenge is on!', body: 'Your new challenge is ready. Ends: {{date}}' } },
  { key: 'course', type: 'course',
    bn: { title: '{{course}}-এ নতুন module', body: '{{course}}-এর নতুন module প্রকাশিত হয়েছে।' },
    en: { title: 'New module in {{course}}', body: 'A new module was published in {{course}}.' } },
  { key: 'important', type: 'important',
    bn: { title: '🚨 গুরুত্বপূর্ণ', body: '{{title}}' },
    en: { title: '🚨 Important', body: '{{title}}' } }
]);

async function fcmSendToTopic(env, topic, { title, body, imageUrl, data }) {
  const accessToken = await fcmAccessToken(env);
  const notification = { title, body };
  if (imageUrl) notification.image = imageUrl;
  const message = {
    topic,
    notification,
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
  return { ok: false, reason: 'error', detail: String(out?.error?.message || '').slice(0, 200) };
}

/* Multi-token batch (≤500 per call) — fallback for devices that could not
 * subscribe to the topic, or when the topic send itself fails. */
async function fcmSendToTokens(env, targets, { title, body, data }) {
  const accessToken = await fcmAccessToken(env);
  let sent = 0;
  const failed = [];
  const messageData = Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)]));
  for (let i = 0; i < targets.length; i += 500) {
    const chunk = targets.slice(i, i + 500);
    let res;
    try {
      res = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ message: { tokens: chunk.map(t => t.token), notification: { title, body }, data: messageData } })
      });
    } catch {
      failed.push(...chunk.map(t => ({ id: t.id, reason: 'error' })));
      continue;
    }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      failed.push(...chunk.map(t => ({ id: t.id, reason: 'error' })));
      continue;
    }
    const errors = out?.response?.message_processing_error || [];
    const erroredIndex = new Set(errors.map(e => Number(e?.index ?? -1)));
    for (let j = 0; j < chunk.length; j++) {
      if (erroredIndex.has(j)) {
        const code = Number((errors.find(e => Number(e?.index) === j) || {}).error?.code || 0);
        failed.push({ id: chunk[j].id, reason: code === 3 || code === 6 ? (code === 3 ? 'unregistered' : 'invalid') : 'error' });
      } else {
        sent += 1;
      }
    }
  }
  return { sent, failed };
}

async function sendGlobal(env, store, row) {
  const data = { gid: row.id, link: row.targetUrl || 'notifications', type: row.type, src: 'fcm-global' };
  const topicRes = await fcmSendToTopic(env, row.topic, { title: row.title, body: row.body, imageUrl: row.imageUrl, data });
  let fallbackSent = 0;
  let fallbackFailed = 0;
  /* Hybrid (spec §23 + iOS topic support varies by browser): topic first;
   * only devices WITHOUT the topic get the multi-token fallback. If the topic
   * send itself failed, every active device goes through the fallback. */
  const targets = topicRes.ok
    ? await store.activeDevicesMissingTopic(row.topic)
    : await store.allActiveTokens();
  if (targets.length) {
    const out = await fcmSendToTokens(env, targets, { title: row.title, body: row.body, data });
    fallbackSent = out.sent;
    fallbackFailed = out.failed.length;
    const badIds = out.failed.filter(f => f.reason === 'unregistered' || f.reason === 'invalid').map(f => f.id);
    if (badIds.length) await store.markInactive(badIds, Date.now());
  }
  const reach = await store.activeDeviceCount();
  const ok = topicRes.ok || fallbackSent > 0;
  await store.updateGlobalStatus(row.id, {
    status: ok ? 'sent' : 'failed',
    sentAt: Date.now(),
    fcmMessageId: topicRes.name || null,
    reachEstimate: reach,
    error: ok ? null : String(topicRes.detail || 'send-failed').slice(0, 200)
  });
  return { ok, topicOk: topicRes.ok, fallbackSent, fallbackFailed, reach };
}

/* Cron entry (Cloudflare Cron Triggers): send every due scheduled global.
 * Exported so the worker entry can call it from scheduled(). */
export async function runScheduledGlobalNotifications(env) {
  if (!fcmConfigured(env)) return { processed: 0 };
  const store = new FcmStore(env?.PROFILE_DB);
  if (!store.available()) return { processed: 0 };
  const due = await store.dueGlobals(Date.now());
  let processed = 0;
  for (const row of due) {
    try {
      await sendGlobal(env, store, row);
    } catch (e) {
      await store.updateGlobalStatus(row.id, { status: 'failed', error: String(e?.message || e).slice(0, 200) });
    }
    processed += 1;
  }
  return { processed };
}

const dhakaDayKey = () => {
  /* 10-day duplicate window key uses UTC day (stable, no TZ drift in tests). */
  return new Date().toISOString().slice(0, 10);
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
    /* Round 8 (owner directive 2026-09-17): no welcome push — enabling is
     * silent; the user sees nothing after tapping Allow. The bell opening
     * the inbox is the confirmation. */
    return jsonResponse(request, { ok: true, registered: true, devices: (await store.activeDevices(userId)).length }, 201);
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

  /* ── Phase 2: global notification admin routes (session + ADMIN_TOKEN) ──── */
  const adminToken = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const isAdmin = Boolean(env.ADMIN_TOKEN) && adminToken === env.ADMIN_TOKEN;

  if (path === '/api/notifications/global/send' && request.method === 'POST') {
    if (!isAdmin) return jsonResponse(request, { error: 'forbidden' }, 403);
    if (!fcmConfigured(env)) return jsonResponse(request, { error: 'fcm-not-configured' }, 503);
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const body = await parseBody(request);
    if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
    const type = GLOBAL_TYPES.includes(body.type) ? body.type : null;
    if (!type) return jsonResponse(request, { error: 'invalid-type' }, 400);
    const title = String(body.title || '').trim().slice(0, 120);
    const text = String(body.body || '').trim().slice(0, 400);
    if (title.length < 1 || title.length > 120) return jsonResponse(request, { error: 'invalid-title' }, 400);
    if (text.length < 1 || text.length > 400) return jsonResponse(request, { error: 'invalid-body' }, 400);
    const imageUrl = String(body.imageUrl || '').slice(0, 500) || null;
    const targetUrl = String(body.targetUrl || '').replace(/[^\w./#-]/g, '').slice(0, 200) || null;
    const audience = GLOBAL_AUDIENCES[body.audience] ? body.audience : 'all_students';
    const topic = GLOBAL_AUDIENCES[audience].topic;
    if (!TOPIC_RE.test(topic)) return jsonResponse(request, { error: 'invalid-topic' }, 500);
    /* Rule (spec §17): duplicate protection — same content within 10 days. */
    const dedup = (await sha256Hex(`${type}|${title}|${text}`)).slice(0, 40);
    const dup = await store.duplicateRecent(dedup, Date.now() - 10 * 86400000);
    if (dup) return jsonResponse(request, { error: 'duplicate', existingId: dup }, 409);
    /* Rule (spec §17): daily spam cap. */
    if (!(await kvRateAllow(env, `global:day:${dhakaDayKey()}`, GLOBAL_DAILY_CAP, 86400))) {
      return jsonResponse(request, { error: 'rate-limited' }, 429);
    }
    const id = `gn-${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 8)}`;
    const row = {
      id, type, title, body: text, imageUrl, targetUrl,
      audience, topic, dedup, scheduledAt: null,
      createdBy: userId, status: 'sending', createdAt: Date.now()
    };
    await store.insertGlobal(row);
    const result = await sendGlobal(env, store, row);
    return jsonResponse(request, { ok: result.ok, id, status: result.ok ? 'sent' : 'failed', reachEstimate: result.reach }, result.ok ? 201 : 502);
  }

  if (path === '/api/notifications/global/schedule' && request.method === 'POST') {
    if (!isAdmin) return jsonResponse(request, { error: 'forbidden' }, 403);
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const body = await parseBody(request);
    if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
    const type = GLOBAL_TYPES.includes(body.type) ? body.type : null;
    if (!type) return jsonResponse(request, { error: 'invalid-type' }, 400);
    const title = String(body.title || '').trim().slice(0, 120);
    const text = String(body.body || '').trim().slice(0, 400);
    if (title.length < 1 || title.length > 120) return jsonResponse(request, { error: 'invalid-title' }, 400);
    if (text.length < 1 || text.length > 400) return jsonResponse(request, { error: 'invalid-body' }, 400);
    const imageUrl = String(body.imageUrl || '').slice(0, 500) || null;
    const targetUrl = String(body.targetUrl || '').replace(/[^\w./#-]/g, '').slice(0, 200) || null;
    const audience = GLOBAL_AUDIENCES[body.audience] ? body.audience : 'all_students';
    const topic = GLOBAL_AUDIENCES[audience].topic;
    const when = Number(body.scheduledAt);
    if (!Number.isFinite(when) || when <= Date.now() + 60_000) {
      return jsonResponse(request, { error: 'invalid-schedule' }, 400);
    }
    if (when > Date.now() + GLOBAL_MAX_SCHEDULE_DAYS * 86400000) {
      return jsonResponse(request, { error: 'schedule-too-far' }, 400);
    }
    const dedup = (await sha256Hex(`${type}|${title}|${text}`)).slice(0, 40);
    const dup = await store.duplicateRecent(dedup, Date.now() - 10 * 86400000);
    if (dup) return jsonResponse(request, { error: 'duplicate', existingId: dup }, 409);
    const id = `gn-${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 8)}`;
    await store.insertGlobal({
      id, type, title, body: text, imageUrl, targetUrl,
      audience, topic, dedup, scheduledAt: Math.floor(when),
      createdBy: userId, status: 'scheduled', createdAt: Date.now()
    });
    return jsonResponse(request, { ok: true, id, status: 'scheduled', scheduledAt: Math.floor(when) }, 201);
  }

  if (path === '/api/notifications/global/cancel' && request.method === 'POST') {
    if (!isAdmin) return jsonResponse(request, { error: 'forbidden' }, 403);
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const body = await parseBody(request);
    if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
    const id = String(body.id || '');
    if (!GN_ID_RE.test(id)) return jsonResponse(request, { error: 'invalid-id' }, 400);
    const rows = await store.recentGlobals(50);
    const row = rows.find(r => r.id === id);
    if (!row) return jsonResponse(request, { error: 'not-found' }, 404);
    if (row.status !== 'scheduled') return jsonResponse(request, { error: 'not-scheduled' }, 409);
    await store.updateGlobalStatus(id, { status: 'cancelled' });
    return jsonResponse(request, { ok: true, id, status: 'cancelled' });
  }

  if (path === '/api/notifications/history' && request.method === 'GET') {
    if (!isAdmin) return jsonResponse(request, { error: 'forbidden' }, 403);
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    return jsonResponse(request, {
      ok: true,
      items: await store.recentGlobals(50),
      reachEstimate: await store.activeDeviceCount(),
      dailyCap: GLOBAL_DAILY_CAP
    });
  }

  if (path === '/api/notifications/templates' && request.method === 'GET') {
    if (!isAdmin) return jsonResponse(request, { error: 'forbidden' }, 403);
    return jsonResponse(request, { ok: true, templates: GLOBAL_TEMPLATES });
  }

  /* ── Phase 2: user routes (session) ─────────────────────────────────────── */
  if (path === '/api/notifications/topics/subscribe' && request.method === 'POST') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const body = await parseBody(request);
    if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
    const token = String(body.token || '');
    const topics = Array.isArray(body.topics) ? body.topics.map(t => String(t)).filter(t => TOPIC_RE.test(t)).slice(0, 10) : [];
    if (token.length < TOKEN_MIN_LEN || topics.length < 1) return jsonResponse(request, { error: 'invalid-payload' }, 400);
    await store.setDeviceTopics(userId, token, topics.join(','));
    return jsonResponse(request, { ok: true, topics });
  }

  if (path === '/api/notifications/topics/unsubscribe' && request.method === 'POST') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const body = await parseBody(request);
    if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
    const token = String(body.token || '');
    if (token.length < TOKEN_MIN_LEN) return jsonResponse(request, { error: 'invalid-payload' }, 400);
    await store.setDeviceTopics(userId, token, '');
    return jsonResponse(request, { ok: true });
  }

  if (path === '/api/notifications/inbox' && request.method === 'GET') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const feed = await store.globalFeed(30);
    const reads = await store.readState(userId, feed.map(r => r.id));
    const items = feed.map(r => ({ ...r, readAt: reads[r.id] || null }));
    return jsonResponse(request, { ok: true, items, unread: items.filter(r => !r.readAt).length });
  }

  if (path === '/api/notifications/read' && request.method === 'POST') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const body = await parseBody(request);
    if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
    const id = String(body.id || '');
    if (!GN_ID_RE.test(id)) return jsonResponse(request, { error: 'invalid-id' }, 400);
    await store.markRead(id, userId, Date.now());
    return jsonResponse(request, { ok: true, id });
  }

  if (path === '/api/notifications/click' && request.method === 'POST') {
    if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    const body = await parseBody(request);
    if (!body) return jsonResponse(request, { error: 'invalid-json' }, 400);
    const id = String(body.id || '');
    if (!GN_ID_RE.test(id)) return jsonResponse(request, { error: 'invalid-id' }, 400);
    if (!(await kvRateAllow(env, `click:${userId}`, 60, 600))) return jsonResponse(request, { error: 'rate-limited' }, 429);
    await store.incrementClicks(id);
    return jsonResponse(request, { ok: true, id });
  }

  return jsonResponse(request, { error: 'not-found' }, 404);
}

export const __fcmNotificationTest = Object.freeze({
  sendGlobal,
  runScheduledGlobalNotifications,
  fcmSendToTopic,
  fcmSendToTokens,
  GLOBAL_TYPES,
  GLOBAL_AUDIENCES,
  GLOBAL_TEMPLATES,
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
