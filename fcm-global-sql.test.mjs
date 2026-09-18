/* Regression: the global_notifications INSERT must match its column list.
 *
 * The engine tests (fcm-global.test.mjs) use a hand-written in-memory D1 whose
 * statement handlers pattern-match on the SQL text, so a column/placeholder
 * mismatch is silently accepted. Production D1 rejects it at prepare time with
 * "12 values for 13 columns", which broke every admin send with a 502 while
 * the fake-D1 suite stayed green. This suite runs the same FcmStore against
 * real SQLite so the SQL itself is validated.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import Database from 'better-sqlite3';
import { handleFcmNotificationRequest, __fcmNotificationTest as T } from './fcm-notification.mjs';

const { FcmStore } = T;
const ADMIN = 'admin-real-sql-token-0123456789';

/* Minimal D1 facade over better-sqlite3. Statement compilation is deferred to
 * execution time (matching D1, where `prepare` only parses and the schema is
 * resolved when the statement runs) — but a column/value mismatch is still a
 * compile error, so it surfaces on `.run()` exactly as it does in production. */
function realD1() {
  const db = new Database(':memory:');
  const wrap = sql => {
    const api = {
      bind: (...args) => ({
        run: async () => ({ success: true, meta: { changes: db.prepare(sql).run(...args).changes } }),
        first: async () => db.prepare(sql).get(...args) ?? null,
        all: async () => ({ results: db.prepare(sql).all(...args) })
      }),
      run: async () => ({ success: true, meta: { changes: db.prepare(sql).run().changes } }),
      first: async () => db.prepare(sql).get() ?? null,
      all: async () => ({ results: db.prepare(sql).all() })
    };
    return api;
  };
  return {
    _db: db,
    prepare: wrap,
    async batch(statements) {
      const results = [];
      for (const s of statements) results.push(await s.run());
      return results;
    }
  };
}

const pemFromPkcs8 = key =>
  `-----BEGIN PRIVATE KEY-----\n${Buffer.from(key).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`;

async function makeEnv() {
  const keyPair = await webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign']);
  const exported = await webcrypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  return {
    PROFILE_DB: realD1(),
    GK_KV: { _m: new Map(), async get(k) { return this._m.has(k) ? this._m.get(k) : null; }, async put(k, v) { this._m.set(k, v); }, async delete(k) { this._m.delete(k); } },
    ADMIN_TOKEN: ADMIN,
    FIREBASE_PROJECT_ID: 'test-project',
    FIREBASE_CLIENT_EMAIL: 'svc@test-project.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: pemFromPkcs8(exported)
  };
}

/* Mirrors the deployed admin client: the composer payload is hex-encoded into a
 * randomly named field so the Cloudflare edge filter does not rewrite it. */
function hexPayloadRequest(path, inner, { admin = ADMIN } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(inner));
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return new Request(`https://admission-gk.example.workers.dev${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
    body: JSON.stringify({ xk7f2a1q: hex })
  });
}

const globalRow = (overrides = {}) => ({
  id: 'gn-real-sql-probe',
  type: 'announcement',
  title: 'Probe title',
  body: 'Probe body',
  imageUrl: null,
  targetUrl: null,
  audience: 'all_students',
  topic: 'all_students',
  dedup: null,
  scheduledAt: null,
  createdBy: 'admin',
  status: 'sending',
  createdAt: 1_800_000_000_000,
  ...overrides
});

test('FcmStore.insertGlobal matches columns and placeholders (real SQL)', async () => {
  const env = await makeEnv();
  const store = new FcmStore(env.PROFILE_DB);
  assert.equal(store.available(), true);

  await store.insertGlobal(globalRow());

  const saved = env.PROFILE_DB._db
    .prepare('SELECT * FROM global_notifications WHERE id=?').get('gn-real-sql-probe');
  assert.equal(saved.id, 'gn-real-sql-probe');
  assert.equal(saved.type, 'announcement');
  assert.equal(saved.title, 'Probe title');
  assert.equal(saved.body, 'Probe body');
  assert.equal(saved.audience, 'all_students');
  assert.equal(saved.topic, 'all_students');
  assert.equal(saved.created_by, 'admin');
  assert.equal(saved.status, 'sending');
  assert.equal(saved.created_at, 1_800_000_000_000);
  assert.equal(saved.image_url, null);
  assert.equal(saved.target_url, null);
  assert.equal(saved.dedup, null);
  assert.equal(saved.scheduled_at, null);
});

test('insertGlobal persists every column the history route reads back', async () => {
  const env = await makeEnv();
  const store = new FcmStore(env.PROFILE_DB);
  await store.insertGlobal(globalRow({
    id: 'gn-with-extras',
    imageUrl: 'https://cdn.example.com/a.png',
    targetUrl: '/notifications',
    dedup: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    scheduledAt: 1_800_000_060_000
  }));

  const saved = env.PROFILE_DB._db
    .prepare('SELECT * FROM global_notifications WHERE id=?').get('gn-with-extras');
  assert.equal(saved.image_url, 'https://cdn.example.com/a.png');
  assert.equal(saved.target_url, '/notifications');
  assert.equal(saved.dedup, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(saved.scheduled_at, 1_800_000_060_000);
});

test('FcmStore.upsertDevice survives real SQL and keeps one row per user+token', async () => {
  const env = await makeEnv();
  const store = new FcmStore(env.PROFILE_DB);
  const token = 'f'.repeat(120);

  const first = await store.upsertDevice({
    userId: 'user-1', token, platform: 'web', browser: 'Chrome', deviceInfo: '{}', now: 1_800_000_000_000
  });
  await store.upsertDevice({
    userId: 'user-1', token, platform: 'web', browser: 'Firefox', deviceInfo: '{}', now: 1_800_000_010_000
  });

  const rows = env.PROFILE_DB._db.prepare('SELECT * FROM fcm_devices WHERE user_id=?').all('user-1');
  assert.equal(rows.length, 1, 'upsert must not duplicate the same user+token');
  assert.equal(rows[0].id, first.id);
  assert.equal(rows[0].browser, 'Firefox', 'second upsert wins on conflict');
  assert.equal(rows[0].is_active, 1);
});

test('status flip after insert survives real SQL (the send-now path)', async () => {
  const env = await makeEnv();
  const store = new FcmStore(env.PROFILE_DB);
  /* Mirrors what the send route persists: insert as 'sending', then flip to
   * the terminal state. Both statements must survive real SQLite. */
  await store.insertGlobal(globalRow({ id: 'gn-flip' }));
  await store.updateGlobalStatus('gn-flip', { status: 'sent', sentAt: 1_800_000_100_000, fcmMessageId: 'msg-1' });

  const saved = env.PROFILE_DB._db.prepare('SELECT * FROM global_notifications WHERE id=?').get('gn-flip');
  assert.equal(saved.status, 'sent');
  assert.equal(saved.sent_at, 1_800_000_100_000);
  assert.equal(saved.fcm_message_id, 'msg-1');
});

test('dueGlobals returns a scheduled row written through the real schema', async () => {
  const env = await makeEnv();
  const store = new FcmStore(env.PROFILE_DB);
  await store.insertGlobal(globalRow({
    id: 'gn-due', status: 'scheduled', scheduledAt: 1_800_000_000_000
  }));
  await store.insertGlobal(globalRow({
    id: 'gn-future', status: 'scheduled', scheduledAt: 4_100_000_000_000
  }));

  const due = await store.dueGlobals(1_800_000_500_000);
  const ids = due.map(r => r.id);
  assert.ok(ids.includes('gn-due'), 'past-due scheduled row is returned');
  assert.ok(!ids.includes('gn-future'), 'future row is not due yet');
});

/* ── End-to-end through the real route with real SQL ────────────────────── */

test('live client hex payload reaches send and persists (real SQL)', async () => {
  const env = await makeEnv();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'tok', expires_in: 3600 });
    if (url.includes('fcm.googleapis.com')) {
      const msg = JSON.parse(init?.body || '{}').message || {};
      return Response.json({ name: msg.topic ? 'projects/test/messages/t1' : 'projects/test/messages/b1', response: { message_count: (msg.tokens || []).length } });
    }
    return realFetch(input, init);
  };
  try {
    const res = await handleFcmNotificationRequest(hexPayloadRequest('/api/notifications/global/send', {
      type: 'announcement',
      title: 'হেক্স পেলোড',
      body: 'hex payload body',
      imageUrl: '',
      targetUrl: '',
      audience: 'all_students'
    }), env);

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${await res.clone().text()}`);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.status, 'sent');

    const saved = env.PROFILE_DB._db.prepare('SELECT * FROM global_notifications WHERE id=?').get(data.id);
    assert.ok(saved, 'row persisted through real SQL');
    assert.equal(saved.title, 'হেক্স পেলোড');
    assert.equal(saved.body, 'hex payload body');
    assert.equal(saved.type, 'announcement');
    assert.equal(saved.audience, 'all_students');
    assert.equal(saved.topic, 'all_students');
    assert.equal(saved.created_by, 'admin');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('hex schedule payload is accepted and stored as scheduled (real SQL)', async () => {
  const env = await makeEnv();
  const when = Date.now() + 3600_000;
  const res = await handleFcmNotificationRequest(hexPayloadRequest('/api/notifications/global/schedule', {
    type: 'challenge',
    title: 'Scheduled hex',
    body: 'scheduled body',
    audience: 'beginner',
    scheduledAt: when
  }), env);

  assert.equal(res.status, 201, `expected 201, got ${res.status}: ${await res.clone().text()}`);
  const data = await res.json();
  const saved = env.PROFILE_DB._db.prepare('SELECT * FROM global_notifications WHERE id=?').get(data.id);
  assert.ok(saved, 'scheduled row persisted through real SQL');
  assert.equal(saved.status, 'scheduled');
  assert.equal(saved.topic, 'course_beginner');
  assert.equal(saved.scheduled_at, when);

  const due = await new FcmStore(env.PROFILE_DB).dueGlobals(when + 1);
  assert.ok(due.map(r => r.id).includes(data.id), 'scheduled row is picked up by the cron query once due');
});

test('plain JSON payload still works alongside the hex form (real SQL)', async () => {
  const env = await makeEnv();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'tok', expires_in: 3600 });
    if (url.includes('fcm.googleapis.com')) return Response.json({ name: 'projects/test/messages/t1' });
    return realFetch(input);
  };
  try {
    const res = await handleFcmNotificationRequest(new Request(
      'https://admission-gk.example.workers.dev/api/notifications/global/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN}` },
        body: JSON.stringify({ type: 'new-feature', title: 'Plain title', body: 'plain body', audience: 'pro' })
      }), env);
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${await res.clone().text()}`);
    const saved = env.PROFILE_DB._db.prepare('SELECT * FROM global_notifications').get();
    assert.equal(saved.title, 'Plain title');
    assert.equal(saved.topic, 'course_pro');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('wrong admin token on the hex path is rejected before any DB write', async () => {
  const env = await makeEnv();
  /* Touch the store first so the schema exists — otherwise the table check
   * below would fail for the wrong reason. */
  await new FcmStore(env.PROFILE_DB).insertGlobal(globalRow({ id: 'gn-baseline' }));

  const res = await handleFcmNotificationRequest(
    hexPayloadRequest('/api/notifications/global/send', {
      type: 'announcement', title: 'nope', body: 'nope', audience: 'all_students'
    }, { admin: 'wrong-token' }), env);
  assert.equal(res.status, 403);
  assert.equal(env.PROFILE_DB._db.prepare('SELECT COUNT(*) AS n FROM global_notifications').get().n, 1,
    'the rejected request wrote nothing');
});

test('a hex field that is not a composer payload falls back to the raw body sensibly', async () => {
  const env = await makeEnv();
  const res = await handleFcmNotificationRequest(new Request(
    'https://admission-gk.example.workers.dev/api/notifications/global/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN}` },
      body: JSON.stringify({ xdeadbeef: '00'.repeat(40) })
    }), env);
  assert.equal(res.status, 400, 'undecodable payload is a validation error, not a crash');
  assert.equal((await res.json()).error, 'invalid-type');
});

test('native envelope {n:{...}} is unwrapped on the send path', async () => {
  const env = await makeEnv();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'tok', expires_in: 3600 });
    if (url.includes('fcm.googleapis.com')) return Response.json({ name: 'projects/test/messages/t1' });
    return realFetch(input, init);
  };
  try {
    const res = await handleFcmNotificationRequest(new Request(
      'https://admission-gk.example.workers.dev/api/notifications/global/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN}` },
        body: JSON.stringify({ n: { type: 'announcement', title: 'Envelope title', body: 'envelope body', audience: 'all_students' } })
      }), env);
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${await res.clone().text()}`);
    const saved = env.PROFILE_DB._db.prepare('SELECT * FROM global_notifications').get();
    assert.equal(saved.title, 'Envelope title');
    assert.equal(saved.body, 'envelope body');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('base64 "nonce|json" payload is decoded on the send path', async () => {
  const env = await makeEnv();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'tok', expires_in: 3600 });
    if (url.includes('fcm.googleapis.com')) return Response.json({ name: 'projects/test/messages/t1' });
    return realFetch(input, init);
  };
  try {
    const inner = JSON.stringify({ type: 'announcement', title: 'Base64 title', body: 'base64 body', audience: 'all_students' });
    const b64 = Buffer.from(`nonce123|${inner}`, 'utf8').toString('base64');
    const res = await handleFcmNotificationRequest(new Request(
      'https://admission-gk.example.workers.dev/api/notifications/global/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN}` },
        body: JSON.stringify({ xrandom99: b64 })
      }), env);
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${await res.clone().text()}`);
    const saved = env.PROFILE_DB._db.prepare('SELECT * FROM global_notifications').get();
    assert.equal(saved.title, 'Base64 title');
    assert.equal(saved.body, 'base64 body');
  } finally {
    globalThis.fetch = realFetch;
  }
});
