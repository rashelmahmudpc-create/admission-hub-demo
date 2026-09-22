/* Phase 2 — Global Notification Engine contract (fcm-notification.mjs).
 * Stubs: D1 (in-memory, pattern-matched on the module's fixed SQL),
 * AUTH_AUTHORITY (session DO), GK_KV (Map), and globalThis.fetch
 * (OAuth + FCM endpoints). No network access.
 *
 * Covers: admin auth, topic-first send, hybrid multi-token fallback (500
 * chunks), dead-token cleanup, duplicate block (10-day), daily spam cap,
 * schedule + cron, cancel, history, templates, user inbox/read/click,
 * topic (de)subscription. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  handleFcmNotificationRequest,
  __fcmNotificationTest as T
} from './fcm-notification.mjs';

const VALID_SESSION = `sess-${'a'.repeat(40)}`.slice(0, 64);
const USER_ID = 'user-global-1';
const ADMIN = 'admin-global-test-token-0123456789';

/* ── in-memory D1 (Phase 1 + Phase 2 SQL) ────────────────────────────────── */
function makeFakeD1() {
  const devices = new Map();   // id → row
  const globals = new Map();   // id → row
  const reads = new Map();     // `${nid}|${uid}` → readAt

  const deviceRow = (args) => ({
    id: args[0], userId: args[1], fcmToken: args[2], platform: args[3],
    browser: args[4], deviceInfo: args[5], createdAt: args[6],
    updatedAt: args[7], lastSeen: args[8], isActive: 1, topics: null
  });

  const stmt = (sql, args) => {
    const run = () => {
      if (sql.includes('INSERT INTO fcm_devices')) {
        devices.set(args[0], deviceRow(args));
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.includes('UPDATE fcm_devices SET topics=?')) {
        const [topics, userId, fcmToken] = args;
        for (const row of devices.values()) {
          if (row.userId === userId && row.fcmToken === fcmToken) { row.topics = topics; break; }
        }
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.includes('UPDATE fcm_devices SET is_active=0, updated_at=? WHERE id=? AND is_active=1')) {
        const [now, id] = args;
        const row = devices.get(id);
        if (row && row.isActive) { row.isActive = 0; row.updatedAt = now; return { success: true, meta: { changes: 1 } }; }
        return { success: true, meta: { changes: 0 } };
      }
      if (sql.includes('UPDATE fcm_devices SET is_active=0, updated_at=? WHERE id=?')) {
        const [now, id] = args;
        const row = devices.get(id);
        if (row) { row.isActive = 0; row.updatedAt = now; }
        return { success: true, meta: { changes: row ? 1 : 0 } };
      }
      if (sql.includes('INSERT INTO global_notifications')) {
        const [id, type, title, body, imageUrl, targetUrl, audience, topic, dedup, scheduledAt, createdBy, status, createdAt] = args;
        globals.set(id, {
          id, type, title, body, image_url: imageUrl, target_url: targetUrl,
          audience, topic, dedup, scheduled_at: scheduledAt,
          created_by: createdBy, status, fcm_message_id: null,
          sent_at: null, reach_estimate: null, clicks: 0, error: null, created_at: createdAt
        });
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.includes('UPDATE global_notifications SET clicks=clicks+1')) {
        const row = globals.get(args[0]);
        if (row) row.clicks += 1;
        return { success: true, meta: { changes: row ? 1 : 0 } };
      }
      if (sql.includes('UPDATE global_notifications SET')) {
        const [sets, ...rest] = [sql];
        void sets;
        const binds = args.slice(0, args.length - 1);
        const id = args[args.length - 1];
        const row = globals.get(id);
        if (row) {
          /* Parse ONLY the SET clause — `WHERE id=?` would otherwise match. */
          const setPart = sql.split(' WHERE ')[0];
          const fields = setPart.match(/([a-z_]+)=\?/g) || [];
          fields.forEach((f, i) => {
            const key = f.split('=')[0];
            row[key] = binds[i];
          });
        }
        return { success: true, meta: { changes: row ? 1 : 0 } };
      }
      if (sql.includes('INSERT OR IGNORE INTO notification_reads')) {
        const key = `${args[0]}|${args[1]}`;
        if (!reads.has(key)) reads.set(key, args[2]);
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.includes('INSERT INTO notification_settings')) {
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    };

    const activeDevices = () => [...devices.values()].filter(r => r.isActive);

    const first = () => {
      if (sql.includes('SELECT COUNT(*) AS n FROM fcm_devices WHERE user_id=?')) {
        return { n: activeDevices().filter(r => r.userId === args[0]).length };
      }
      if (sql.includes('SELECT COUNT(*) AS n FROM fcm_devices WHERE is_active=1')) {
        return { n: activeDevices().length };
      }
      if (sql.includes('SELECT id FROM fcm_devices') && sql.includes('id<>?')) {
        const [userId, selfId] = args;
        const victim = activeDevices()
          .filter(r => r.userId === userId && r.id !== selfId)
          .sort((a, b) => a.updatedAt - b.updatedAt)[0];
        return victim ? { id: victim.id } : null;
      }
      if (sql.includes('SELECT id FROM global_notifications WHERE dedup=?')) {
        const rows = [...globals.values()]
          .filter(r => r.dedup === args[0] && (r.status === 'sent' || r.status === 'scheduled') && r.created_at >= args[1]);
        return rows.length ? { id: rows[0].id } : null;
      }
      if (sql.includes('SELECT * FROM notification_settings')) {
        return null;
      }
      return null;
    };

    const all = () => {
      if (sql.includes('SELECT id, fcm_token, topics FROM fcm_devices')) {
        /* Mirrors the production filter: whole topic names only. */
        const topic = String(args[0] || '');
        return { results: activeDevices()
          .filter(r => !topic || !String(r.topics || '').split(',').includes(topic))
          .map(r => ({ id: r.id, fcm_token: r.fcmToken, topics: r.topics || null })) };
      }
      if (sql.includes('SELECT id, fcm_token FROM fcm_devices WHERE is_active=1')) {
        return { results: activeDevices().map(r => ({ id: r.id, fcm_token: r.fcmToken })) };
      }
      if (sql.includes('SELECT id, fcm_token FROM fcm_devices WHERE user_id=?')) {
        return { results: activeDevices().filter(r => r.userId === args[0])
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map(r => ({ id: r.id, fcm_token: r.fcmToken })) };
      }
      if (sql.includes('SELECT id, fcm_token, platform, browser, device_info')) {
        return { results: activeDevices().filter(r => r.userId === args[0])
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map(r => ({ id: r.id, fcm_token: r.fcmToken, platform: r.platform, browser: r.browser, device_info: r.deviceInfo, created_at: r.createdAt, updated_at: r.updatedAt, last_seen: r.lastSeen })) };
      }
      if (sql.includes('SELECT * FROM global_notifications WHERE status=\'scheduled\'')) {
        const rows = [...globals.values()]
          .filter(r => r.status === 'scheduled' && r.scheduled_at != null && r.scheduled_at <= args[0])
          .sort((a, b) => a.scheduled_at - b.scheduled_at)
          .slice(0, 20);
        return { results: rows };
      }
      if (sql.includes('FROM global_notifications ORDER BY created_at DESC')) {
        const rows = [...globals.values()]
          .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : -1))
          .slice(0, Number(args[0] || 50));
        return { results: rows };
      }
      if (sql.includes('FROM global_notifications WHERE status=\'sent\' AND sent_at IS NOT NULL')) {
        const rows = [...globals.values()]
          .filter(r => r.status === 'sent' && r.sent_at != null)
          .sort((a, b) => b.sent_at - a.sent_at)
          .slice(0, Number(args[0] || 30));
        return { results: rows };
      }
      if (sql.includes('SELECT notification_id, read_at FROM notification_reads')) {
        const [userId, ...ids] = args;
        return { results: ids.filter(nid => reads.has(`${nid}|${userId}`))
          .map(nid => ({ notification_id: nid, read_at: reads.get(`${nid}|${userId}`) })) };
      }
      return { results: [] };
    };

    return { run, first, all };
  };

  return {
    _devices: devices, _globals: globals, _reads: reads,
    prepare(sql) {
      /* D1 rejects a statement whose bind count differs from its placeholder
       * count ("N values for M columns"). The fake used to ignore both, so a
       * 13-column INSERT with 12 placeholders passed here and only failed in
       * production. Enforce it so that class of bug cannot hide again. */
      const placeholders = (sql.match(/\?/g) || []).length;
      const bound = (...args) => {
        if (args.length !== placeholders) {
          throw new Error(`D1_ERROR: ${args.length} values for ${placeholders} placeholders: SQLITE_ERROR`);
        }
        return stmt(sql, args);
      };
      return { ...stmt(sql, []), bind: bound };
    },
    async batch(statements) {
      const results = [];
      for (const s of statements) {
        if (typeof s === 'string') throw new Error('D1_ERROR: Malformed input');
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

async function makeEnv(overrides = {}) {
  const keyPair = await webcrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
  const exported = await webcrypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  return {
    AUTH_AUTHORITY: makeAuthority(),
    PROFILE_DB: makeFakeD1(),
    GK_KV: makeFakeKV(),
    ADMIN_TOKEN: ADMIN,
    FIREBASE_PROJECT_ID: 'test-project',
    FIREBASE_CLIENT_EMAIL: 'svc@test-project.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: pemFromPkcs8(exported),
    FIREBASE_API_KEY: 'AIzaTestWebApiKey',
    FIREBASE_MESSAGING_SENDER_ID: '1234567890',
    FIREBASE_APP_ID: '1:1234567890:web:abc123',
    FIREBASE_VAPID_KEY: 'BJtpTestVapidKey',
    ...overrides
  };
}

const cookieRequest = (path, { method = 'GET', session = VALID_SESSION, admin = ADMIN, body } = {}) => {
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

/* FCM fetch stub. `topicFail` fails topic sends, `deadTokenIndexes` marks
 * which sequential token sends come back NOT_FOUND, `throwAll` simulates a
 * total network outage to FCM.
 *
 * The token branch models the REAL single-send contract: the body must carry
 * `message.token`. A batch-shaped `message.tokens` is rejected the way FCM
 * rejects it, so a regression to the old dead-code payload fails loudly
 * instead of "succeeding" while delivering nothing. */
function withFcmStub(env, { topicFail = false, deadTokenIndexes = {}, throwAll = false } = {}) {
  const realFetch = globalThis.fetch;
  const calls = { topic: [], tokens: [] };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com')) {
      return Response.json({ access_token: 'fake-oauth-token', expires_in: 3600 });
    }
    if (url.includes('fcm.googleapis.com')) {
      if (throwAll) throw new Error('network down');
      const payload = JSON.parse(init?.body);
      const message = payload.message || {};
      if (message.topic) {
        calls.topic.push({ body: message });
        if (topicFail) return Response.json({ error: { code: 5, message: 'topic send exploded', status: 'UNAVAILABLE' } }, { status: 503 });
        return Response.json({ name: `projects/test-project/messages/topic-${calls.topic.length}` });
      }
      calls.tokens.push({ body: message });
      if (!message.token) {
        return Response.json({ error: { code: 400, message: 'Recipient of the message is not set.' } }, { status: 400 });
      }
      const callIndex = calls.tokens.length - 1;
      if (deadTokenIndexes[callIndex]) {
        return Response.json({ error: { code: 404, message: 'Requested entity was not found.' } }, { status: 404 });
      }
      return Response.json({ name: `projects/test-project/messages/dev-${callIndex}` });
    }
    return realFetch(input, init);
  };
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}

const registerDevice = async (env, suffix) => {
  const token = `tok-${suffix}-${'x'.repeat(110)}`.slice(0, 140);
  const out = await call(cookieRequest('/api/notifications/register-token', { method: 'POST', body: { token } }), env);
  assert.equal(out.response.status, 201);
  return token;
};

test('admin routes: Bearer token is the credential (session optional)', async () => {
  const env = await makeEnv();
  const noSessionNoToken = await call(cookieRequest('/api/notifications/global/send', { method: 'POST', session: null, admin: null, body: { type: 'announcement', title: 'x', body: 'y' } }), env);
  assert.equal(noSessionNoToken.response.status, 403, 'no token → 403');
  const badAdmin = await call(cookieRequest('/api/notifications/global/send', { method: 'POST', session: null, admin: 'wrong', body: { type: 'announcement', title: 'x', body: 'y' } }), env);
  assert.equal(badAdmin.response.status, 403, 'wrong token → 403');
  const histNoAdmin = await call(cookieRequest('/api/notifications/history', { session: null, admin: null }), env);
  assert.equal(histNoAdmin.response.status, 403);
  const tplNoAdmin = await call(cookieRequest('/api/notifications/templates', { session: null, admin: null }), env);
  assert.equal(tplNoAdmin.response.status, 403);
  /* the owner fix (2026-09-18): a valid token works WITHOUT a logged-in
   * session — the Admin Center must not depend on the app sign-in state */
  const histTokenOnly = await call(cookieRequest('/api/notifications/history', { session: null }), env);
  assert.equal(histTokenOnly.response.status, 200, 'token only (no session) → 200');
  const tplTokenOnly = await call(cookieRequest('/api/notifications/templates', { session: null }), env);
  assert.equal(tplTokenOnly.response.status, 200);
  assert.equal(tplTokenOnly.data.templates.length, 6);
  /* user routes still require a session */
  const inboxNoSession = await call(cookieRequest('/api/notifications/inbox', { session: null, admin: null }), env);
  assert.equal(inboxNoSession.response.status, 401, 'user route without session → 401');
});

test('global/send: topic-first send, stored row, reliable reach estimate', async () => {
  const env = await makeEnv();
  const tokenA = await registerDevice(env, 'a');
  const tokenB = await registerDevice(env, 'b');
  for (const token of [tokenA, tokenB]) {
    await call(cookieRequest('/api/notifications/topics/subscribe', { method: 'POST', body: { token, topics: ['all_students'] } }), env);
  }
  const stub = withFcmStub(env);
  try {
    const out = await call(cookieRequest('/api/notifications/global/send', {
      method: 'POST',
      body: { type: 'new-content', title: '📚 নতুন Lesson Available', body: 'B1 unit-এর নতুন lesson live।', audience: 'all_students', targetUrl: '/lesson/25' }
    }), env);
    assert.equal(out.response.status, 201);
    assert.equal(out.data.ok, true);
    assert.equal(out.data.status, 'sent');
    assert.match(out.data.id, /^gn-[a-z0-9]{12}$/);
    assert.equal(out.data.reachEstimate, 2);
    /* ONE topic call — no per-user loop (spec: $0-first) */
    assert.equal(stub.calls.topic.length, 1);
    assert.equal(stub.calls.tokens.length, 0, 'all devices have the topic → zero fallback calls');
    assert.equal(stub.calls.topic[0].body.topic, 'all_students');
    assert.equal(stub.calls.topic[0].body.data.gid, out.data.id);
    assert.equal(stub.calls.topic[0].body.data.link, '/lesson/25');
    assert.equal(stub.calls.topic[0].body.data.src, 'fcm-global');
    assert.equal(stub.calls.topic[0].body.notification.title, '📚 নতুন Lesson Available');
    /* stored row */
    const hist = await call(cookieRequest('/api/notifications/history'), env);
    assert.equal(hist.data.items.length, 1);
    assert.equal(hist.data.items[0].id, out.data.id);
    assert.equal(hist.data.items[0].status, 'sent');
    assert.equal(hist.data.items[0].reachEstimate, 2);
    assert.equal(hist.data.dailyCap, 10);
  } finally { stub.restore(); }
});

test('hybrid fallback: only devices WITHOUT the topic get multi-token sends', async () => {
  const env = await makeEnv();
  const tokenA = await registerDevice(env, 'topic');
  const tokenB = await registerDevice(env, 'notopic');
  await call(cookieRequest('/api/notifications/topics/subscribe', { method: 'POST', body: { token: tokenA, topics: ['all_students'] } }), env);
  const stub = withFcmStub(env);
  try {
    const out = await call(cookieRequest('/api/notifications/global/send', {
      method: 'POST', body: { type: 'announcement', title: 'fallback test', body: 'b' }
    }), env);
    assert.equal(out.response.status, 201);
    assert.equal(out.data.ok, true);
    assert.equal(stub.calls.topic.length, 1);
    assert.equal(stub.calls.tokens.length, 1, 'exactly one fallback send');
    assert.deepEqual(stub.calls.tokens[0].body.token, tokenB, 'only the non-topic device');
  } finally { stub.restore(); }
});

test('topic send failure → every active device goes through the fallback', async () => {
  const env = await makeEnv();
  const tokenA = await registerDevice(env, 't1');
  const tokenB = await registerDevice(env, 't2');
  const stub = withFcmStub(env, { topicFail: true });
  try {
    const out = await call(cookieRequest('/api/notifications/global/send', {
      method: 'POST', body: { type: 'important', title: 'topic down', body: 'fallback works' }
    }), env);
    assert.equal(out.response.status, 201);
    assert.equal(out.data.ok, true, 'fallback delivers');
    assert.equal(stub.calls.tokens.length, 2, 'one send per device');
    assert.ok(stub.calls.tokens.every(c => c.body.token), 'every send carries a single token');
    const hist = await call(cookieRequest('/api/notifications/history'), env);
    assert.equal(hist.data.items[0].status, 'sent');
  } finally { stub.restore(); }
});

test('NOT_FOUND in a token batch deactivates the dead token (no infinite retry)', async () => {
  const env = await makeEnv();
  const tokenA = await registerDevice(env, 'alive');
  const tokenB = await registerDevice(env, 'dead');
  void tokenA;
  const stub = withFcmStub(env, { deadTokenIndexes: { 1: true } });
  try {
    const out = await call(cookieRequest('/api/notifications/global/send', {
      method: 'POST', body: { type: 'announcement', title: 'dead token test', body: 'b' }
    }), env);
    assert.equal(out.response.status, 201);
    const alive = [...env.PROFILE_DB._devices.values()].filter(r => r.isActive);
    assert.equal(alive.length, 1, 'dead token deactivated');
    assert.equal(alive[0].fcmToken, tokenA);
    const hist = await call(cookieRequest('/api/notifications/history'), env);
    assert.equal(hist.data.items[0].status, 'sent');
  } finally { stub.restore(); }
});

test('total FCM outage → row marked failed with error, 502 response', async () => {
  const env = await makeEnv();
  await registerDevice(env, 'only');
  const stub = withFcmStub(env, { throwAll: true });
  try {
    const out = await call(cookieRequest('/api/notifications/global/send', {
      method: 'POST', body: { type: 'course', title: 'outage test', body: 'b' }
    }), env);
    assert.equal(out.response.status, 502);
    assert.equal(out.data.ok, false);
    const hist = await call(cookieRequest('/api/notifications/history'), env);
    assert.equal(hist.data.items[0].status, 'failed');
    assert.ok(hist.data.items[0].error, 'error logged');
  } finally { stub.restore(); }
});

test('duplicate protection: same content within 10 days → 409', async () => {
  const env = await makeEnv();
  await registerDevice(env, 'dup');
  const stub = withFcmStub(env);
  try {
    const first = await call(cookieRequest('/api/notifications/global/send', {
      method: 'POST', body: { type: 'challenge', title: 'Weekly challenge', body: 'Start now!' }
    }), env);
    assert.equal(first.response.status, 201);
    const second = await call(cookieRequest('/api/notifications/global/send', {
      method: 'POST', body: { type: 'challenge', title: 'Weekly challenge', body: 'Start now!' }
    }), env);
    assert.equal(second.response.status, 409);
    assert.equal(second.data.error, 'duplicate');
    assert.equal(second.data.existingId, first.data.id);
    /* different type → different dedup → allowed */
    const third = await call(cookieRequest('/api/notifications/global/send', {
      method: 'POST', body: { type: 'announcement', title: 'Weekly challenge', body: 'Start now!' }
    }), env);
    assert.equal(third.response.status, 201);
  } finally { stub.restore(); }
});

test('daily spam cap: 10th send of the day succeeds, 11th → 429', async () => {
  const env = await makeEnv();
  await registerDevice(env, 'cap');
  const stub = withFcmStub(env);
  try {
    let last = null;
    for (let i = 1; i <= 10; i++) {
      last = await call(cookieRequest('/api/notifications/global/send', {
        method: 'POST', body: { type: 'announcement', title: `cap notice ${i}`, body: 'b' }
      }), env);
      assert.equal(last.response.status, 201, `send ${i}`);
    }
    const eleventh = await call(cookieRequest('/api/notifications/global/send', {
      method: 'POST', body: { type: 'announcement', title: 'cap notice 11', body: 'b' }
    }), env);
    assert.equal(eleventh.response.status, 429);
    assert.equal(eleventh.data.error, 'rate-limited');
  } finally { stub.restore(); }
});

test('schedule: valid window accepted, past and >30d rejected', async () => {
  const env = await makeEnv();
  const past = await call(cookieRequest('/api/notifications/global/schedule', {
    method: 'POST', body: { type: 'announcement', title: 'past', body: 'b', scheduledAt: Date.now() - 5000 }
  }), env);
  assert.equal(past.response.status, 400);
  assert.equal(past.data.error, 'invalid-schedule');
  const tooFar = await call(cookieRequest('/api/notifications/global/schedule', {
    method: 'POST', body: { type: 'announcement', title: 'too far', body: 'b', scheduledAt: Date.now() + 31 * 86400000 }
  }), env);
  assert.equal(tooFar.response.status, 400);
  assert.equal(tooFar.data.error, 'schedule-too-far');
  const valid = Date.now() + 5 * 60_000;
  const ok = await call(cookieRequest('/api/notifications/global/schedule', {
    method: 'POST', body: { type: 'new-feature', title: 'scheduled feature', body: 'b', scheduledAt: valid }
  }), env);
  assert.equal(ok.response.status, 201);
  assert.equal(ok.data.status, 'scheduled');
  assert.equal(ok.data.scheduledAt, Math.floor(valid));
});

test('cron: due scheduled globals are sent; future ones wait', async () => {
  const env = await makeEnv();
  const token = await registerDevice(env, 'cron');
  const stub = withFcmStub(env);
  try {
    /* not yet due */
    const future = Date.now() + 10 * 60_000;
    const scheduled = await call(cookieRequest('/api/notifications/global/schedule', {
      method: 'POST', body: { type: 'course', title: 'future module', body: 'b', scheduledAt: future }
    }), env);
    const idle = await T.runScheduledGlobalNotifications(env);
    assert.equal(idle.processed, 0, 'nothing due yet');
    assert.equal(stub.calls.topic.length, 0);

    /* seed a due row directly (as if the minute passed) */
    const store = new T.FcmStore(env.PROFILE_DB);
    const dueId = 'gn-cronseed0001';
    await store.insertGlobal({
      id: dueId, type: 'challenge', title: 'due challenge', body: 'b',
      imageUrl: null, targetUrl: '/challenge/1', audience: 'all_students',
      topic: 'all_students', dedup: null, scheduledAt: Date.now() - 60_000,
      createdBy: USER_ID, status: 'scheduled', createdAt: Date.now() - 3600_000
    });
    const ran = await T.runScheduledGlobalNotifications(env);
    assert.equal(ran.processed, 1);
    assert.equal(stub.calls.topic.length, 1);
    assert.equal(stub.calls.topic[0].body.topic, 'all_students');
    const hist = await call(cookieRequest('/api/notifications/history'), env);
    const dueRow = hist.data.items.find(r => r.id === dueId);
    assert.equal(dueRow.status, 'sent');
    const futureRow = hist.data.items.find(r => r.id === scheduled.data.id);
    assert.equal(futureRow.status, 'scheduled', 'future row untouched');
  } finally { stub.restore(); }
});

test('cancel: scheduled → cancelled; sent → 409; bad id → 400', async () => {
  const env = await makeEnv();
  const when = Date.now() + 8 * 60_000;
  const scheduled = await call(cookieRequest('/api/notifications/global/schedule', {
    method: 'POST', body: { type: 'announcement', title: 'cancel me', body: 'b', scheduledAt: when }
  }), env);
  const cancelled = await call(cookieRequest('/api/notifications/global/cancel', { method: 'POST', body: { id: scheduled.data.id } }), env);
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.data.status, 'cancelled');
  const again = await call(cookieRequest('/api/notifications/global/cancel', { method: 'POST', body: { id: scheduled.data.id } }), env);
  assert.equal(again.response.status, 409, 'already cancelled → not-scheduled');
  const badId = await call(cookieRequest('/api/notifications/global/cancel', { method: 'POST', body: { id: 'gn-!!!' } }), env);
  assert.equal(badId.response.status, 400);
  const missing = await call(cookieRequest('/api/notifications/global/cancel', { method: 'POST', body: { id: 'gn-000000000000' } }), env);
  assert.equal(missing.response.status, 404);
  /* a cancelled row is out of the dedup window → rescheduling is allowed */
  const rescheduled = await call(cookieRequest('/api/notifications/global/schedule', {
    method: 'POST', body: { type: 'announcement', title: 'cancel me', body: 'b', scheduledAt: Date.now() + 9 * 60_000 }
  }), env);
  assert.equal(rescheduled.response.status, 201);
});

test('history shape: items, reachEstimate, dailyCap', async () => {
  const env = await makeEnv();
  const token = await registerDevice(env, 'hist');
  void token;
  const { data } = await call(cookieRequest('/api/notifications/history'), env);
  assert.equal(data.ok, true);
  assert.deepEqual(data.items, []);
  assert.equal(data.reachEstimate, 1);
  assert.equal(data.dailyCap, 10);
});

test('templates: 6 dual-language presets with {{variables}}', async () => {
  const env = await makeEnv();
  const { data } = await call(cookieRequest('/api/notifications/templates'), env);
  assert.equal(data.ok, true);
  assert.equal(data.templates.length, 6);
  for (const tpl of data.templates) {
    assert.ok(tpl.bn.title && tpl.bn.body, `${tpl.key} bn`);
    assert.ok(tpl.en.title && tpl.en.body, `${tpl.key} en`);
  }
  const keys = data.templates.map(t => t.key).sort();
  assert.deepEqual(keys, ['announcement', 'challenge', 'course', 'important', 'new-content', 'new-feature'].sort());
  assert.ok(T.GLOBAL_TEMPLATES.some(t => t.en.body.includes('{{date}}') || t.bn.body.includes('{{date}}')));
});

test('user inbox: sent feed + unread; read clears it; click counts', async () => {
  const env = await makeEnv();
  await registerDevice(env, 'inbox');
  const stub = withFcmStub(env);
  try {
    const sent = await call(cookieRequest('/api/notifications/global/send', {
      method: 'POST', body: { type: 'new-content', title: 'inbox row', body: 'b', targetUrl: '/lesson/9' }
    }), env);
    const id = sent.data.id;

    const feed1 = await call(cookieRequest('/api/notifications/inbox'), env);
    assert.equal(feed1.response.status, 200);
    assert.equal(feed1.data.items.length, 1);
    assert.equal(feed1.data.items[0].id, id);
    assert.equal(feed1.data.items[0].targetUrl, '/lesson/9');
    assert.equal(feed1.data.items[0].readAt, null);
    assert.equal(feed1.data.unread, 1);

    const read = await call(cookieRequest('/api/notifications/read', { method: 'POST', body: { id } }), env);
    assert.equal(read.response.status, 200);
    const feed2 = await call(cookieRequest('/api/notifications/inbox'), env);
    assert.equal(feed2.data.unread, 0);
    assert.ok(feed2.data.items[0].readAt > 0);

    const click = await call(cookieRequest('/api/notifications/click', { method: 'POST', body: { id } }), env);
    assert.equal(click.response.status, 200);
    const hist = await call(cookieRequest('/api/notifications/history'), env);
    assert.equal(hist.data.items[0].clicks, 1);

    const badRead = await call(cookieRequest('/api/notifications/read', { method: 'POST', body: { id: 'nope' } }), env);
    assert.equal(badRead.response.status, 400);
  } finally { stub.restore(); }
});

test('topics/subscribe + unsubscribe update the device row', async () => {
  const env = await makeEnv();
  const token = await registerDevice(env, 'topicsub');
  const bad = await call(cookieRequest('/api/notifications/topics/subscribe', { method: 'POST', body: { token: 'short', topics: ['all_students'] } }), env);
  assert.equal(bad.response.status, 400);
  const ok = await call(cookieRequest('/api/notifications/topics/subscribe', { method: 'POST', body: { token, topics: ['all_students', 'course_beginner', 'EVIL TOPIC'] } }), env);
  assert.equal(ok.response.status, 200);
  assert.deepEqual(ok.data.topics, ['all_students', 'course_beginner'], 'invalid topic names are dropped');
  const row = [...env.PROFILE_DB._devices.values()].find(r => r.fcmToken === token);
  assert.equal(row.topics, 'all_students,course_beginner');
  const unsub = await call(cookieRequest('/api/notifications/topics/unsubscribe', { method: 'POST', body: { token } }), env);
  assert.equal(unsub.response.status, 200);
  assert.equal(row.topics, '');
});

test('unconfigured FCM: cron is a safe no-op, send → 503', async () => {
  const env = await makeEnv({ FIREBASE_PROJECT_ID: '', FIREBASE_CLIENT_EMAIL: '', FIREBASE_PRIVATE_KEY: '' });
  const result = await T.runScheduledGlobalNotifications(env);
  assert.equal(result.processed, 0);
  const out = await call(cookieRequest('/api/notifications/global/send', {
    method: 'POST', body: { type: 'announcement', title: 'x', body: 'y' }
  }), env);
  assert.equal(out.response.status, 503);
  assert.equal(out.data.error, 'fcm-not-configured');
});
