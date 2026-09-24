/* Student data sync — server-side student-owned learning data.
 *
 * The browser's IndexedDB stays the fast/offline working copy, but it is no
 * longer the only permanent record: every student-owned row is mirrored into D1
 * (binding PROFILE_DB) under the account's own user_id. A student can clear the
 * browser, switch devices, or log in years later and still get their history.
 *
 * Ownership is NEVER taken from the request body. It is resolved from the
 * `__Host-ah_session` cookie against the auth authority, exactly like the
 * notification module. A client cannot read or write another account's rows.
 *
 * Sync protocol (idempotent):
 *   POST /api/userdata/sync   { ops: [ { store, id, op, doc, updated_at } ] }
 *     - upsert by (user_id, id) / (user_id, day); last-write-wins on updated_at
 *     - `op:'delete'` writes a tombstone (deleted_at), it never hard-deletes
 *     - replayed op is a no-op; returns per-op ack + server updated_at
 *   GET  /api/userdata/pull?since=<ms>&store=<name>&limit=&cursor=
 *     - incremental, paginated; includes tombstones so deletes propagate
 *   GET  /api/userdata/bootstrap
 *     - cursor + per-store counts for a fresh device
 */
const AUTHORITY_NAME = 'admission-hub-global-auth-v1';
const SESSION_COOKIE = '__Host-ah_session';
const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{40,96}$/;

/* Student-owned stores. Static/shared content (questions, topics, vocabulary,
 * subjects) is NOT here on purpose — it is already server-side product data. */
const STUDENT_TABLES = Object.freeze({
  examResults: 'user_exam_results',
  exams: 'user_exams',
  mistakes: 'user_mistakes',
  dailyStats: 'user_daily_stats',
  activityLogs: 'user_activity',
  notes: 'user_notes',
  ADMISSION_PLANS: 'user_plans',
  PLAN_DAYS: 'user_plan_days',
  settings: 'user_settings'
});

/* day-keyed and single-row stores cannot use the generic (id) column. */
const DAY_KEYED = new Set(['dailyStats']);
const SINGLETON = new Set(['settings']);

const MAX_OPS_PER_SYNC = 400;
const MAX_PULL_LIMIT = 500;
const MAX_DOC_BYTES = 128 * 1024;
const MAX_PULL_TOTAL = 5000;

const jsonResponse = (request, obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(request?.headers?.get('Origin') ? { 'Access-Control-Allow-Origin': request.headers.get('Origin'), 'Access-Control-Allow-Credentials': 'true' } : {})
  }
});

const readSessionToken = request => {
  const cookie = String(request.headers.get('Cookie') || '');
  for (const part of cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === SESSION_COOKIE) return part.slice(idx + 1).trim();
  }
  return '';
};

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

const safeId = value => {
  const id = String(value ?? '');
  return id.length > 0 && id.length <= 200 && /^[\w:.@-]+$/.test(id) ? id : '';
};

const clampInt = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
};

export class UserDataStore {
  #d1;
  #ready;
  constructor(d1) {
    this.#d1 = d1 || null;
  }

  available() {
    return Boolean(this.#d1);
  }

  async init() {
    if (!this.#d1) return;
    if (!this.#ready) this.#ready = this.#createSchema().catch(err => { this.#ready = null; throw err; });
    await this.#ready;
  }

  async #createSchema() {
    const ddl = [
      `CREATE TABLE IF NOT EXISTS user_exam_results (
        user_id TEXT NOT NULL, id TEXT NOT NULL, exam_id TEXT,
        payload_json TEXT NOT NULL, created_at INTEGER, updated_at INTEGER NOT NULL,
        deleted_at INTEGER, origin_device TEXT,
        PRIMARY KEY (user_id, id))`,
      `CREATE TABLE IF NOT EXISTS user_exams (
        user_id TEXT NOT NULL, id TEXT NOT NULL, status TEXT,
        payload_json TEXT NOT NULL, created_at INTEGER, updated_at INTEGER NOT NULL,
        deleted_at INTEGER, origin_device TEXT,
        PRIMARY KEY (user_id, id))`,
      `CREATE TABLE IF NOT EXISTS user_mistakes (
        user_id TEXT NOT NULL, id TEXT NOT NULL, question_id TEXT,
        subject_id TEXT, topic_id TEXT, revision_status TEXT, mastered INTEGER,
        payload_json TEXT NOT NULL, created_at INTEGER, updated_at INTEGER NOT NULL,
        deleted_at INTEGER, origin_device TEXT,
        PRIMARY KEY (user_id, id))`,
      `CREATE TABLE IF NOT EXISTS user_daily_stats (
        user_id TEXT NOT NULL, day TEXT NOT NULL,
        payload_json TEXT NOT NULL, created_at INTEGER, updated_at INTEGER NOT NULL,
        deleted_at INTEGER, origin_device TEXT,
        PRIMARY KEY (user_id, day))`,
      `CREATE TABLE IF NOT EXISTS user_activity (
        user_id TEXT NOT NULL, id TEXT NOT NULL,
        payload_json TEXT NOT NULL, created_at INTEGER, updated_at INTEGER NOT NULL,
        deleted_at INTEGER, origin_device TEXT,
        PRIMARY KEY (user_id, id))`,
      `CREATE TABLE IF NOT EXISTS user_notes (
        user_id TEXT NOT NULL, id TEXT NOT NULL,
        payload_json TEXT NOT NULL, created_at INTEGER, updated_at INTEGER NOT NULL,
        deleted_at INTEGER, origin_device TEXT,
        PRIMARY KEY (user_id, id))`,
      `CREATE TABLE IF NOT EXISTS user_plans (
        user_id TEXT NOT NULL, id TEXT NOT NULL,
        payload_json TEXT NOT NULL, created_at INTEGER, updated_at INTEGER NOT NULL,
        deleted_at INTEGER, origin_device TEXT,
        PRIMARY KEY (user_id, id))`,
      `CREATE TABLE IF NOT EXISTS user_plan_days (
        user_id TEXT NOT NULL, id TEXT NOT NULL, plan_id TEXT,
        payload_json TEXT NOT NULL, created_at INTEGER, updated_at INTEGER NOT NULL,
        deleted_at INTEGER, origin_device TEXT,
        PRIMARY KEY (user_id, id))`,
      `CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT NOT NULL, id TEXT NOT NULL DEFAULT 'settings',
        payload_json TEXT NOT NULL, created_at INTEGER, updated_at INTEGER NOT NULL,
        deleted_at INTEGER, origin_device TEXT,
        PRIMARY KEY (user_id, id))`,
      `CREATE TABLE IF NOT EXISTS user_sync_meta (
        user_id TEXT PRIMARY KEY, last_push_at INTEGER, last_pull_at INTEGER,
        device_count INTEGER NOT NULL DEFAULT 1)`
    ];
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_uer_user_upd ON user_exam_results(user_id, updated_at)',
      'CREATE INDEX IF NOT EXISTS idx_ue_user_upd ON user_exams(user_id, updated_at)',
      'CREATE INDEX IF NOT EXISTS idx_um_user_upd ON user_mistakes(user_id, updated_at)',
      'CREATE INDEX IF NOT EXISTS idx_uds_user_upd ON user_daily_stats(user_id, updated_at)',
      'CREATE INDEX IF NOT EXISTS idx_ua_user_upd ON user_activity(user_id, updated_at)',
      'CREATE INDEX IF NOT EXISTS idx_un_user_upd ON user_notes(user_id, updated_at)',
      'CREATE INDEX IF NOT EXISTS idx_up_user_upd ON user_plans(user_id, updated_at)',
      'CREATE INDEX IF NOT EXISTS idx_upd_user_upd ON user_plan_days(user_id, updated_at)',
      'CREATE INDEX IF NOT EXISTS idx_um_q ON user_mistakes(user_id, question_id)',
      'CREATE INDEX IF NOT EXISTS idx_upd_plan ON user_plan_days(user_id, plan_id)'
    ];
    for (const stmt of [...ddl, ...indexes]) await this.#d1.prepare(stmt).run();
  }

  /* Resolve the row key and the denormalized columns for a store. */
  #shape(store, id, doc) {
    const table = STUDENT_TABLES[store];
    if (!table) return null;
    if (SINGLETON.has(store)) return { table, key: 'settings', column: 'id', keyCol: 'id' };
    if (DAY_KEYED.has(store)) {
      const day = String(id || doc?.day || doc?.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
      return { table, key: day, column: 'day', keyCol: 'day' };
    }
    const clean = safeId(id || doc?.id);
    if (!clean) return null;
    return { table, key: clean, column: 'id', keyCol: 'id' };
  }

  #extraColumns(store, doc) {
    const obj = doc && typeof doc === 'object' ? doc : {};
    if (store === 'examResults') return { exam_id: safeId(obj.examId || obj.exam_id) || null };
    if (store === 'exams') return { status: String(obj.status || obj.mode || '').slice(0, 40) || null };
    if (store === 'mistakes') {
      return {
        question_id: safeId(obj.questionId) || null,
        subject_id: safeId(obj.subjectId) || null,
        topic_id: safeId(obj.topicId) || null,
        revision_status: String(obj.revisionStatus || '').slice(0, 40) || null,
        mastered: obj.mastered === true ? 1 : 0
      };
    }
    if (store === 'PLAN_DAYS') return { plan_id: safeId(obj.planId) || null };
    return {};
  }

  /* Apply one op. Idempotent: the same (user_id, key) with an older or equal
   * updated_at cannot regress a newer row, so replays and out-of-order retries
   * are safe. Deletes write a tombstone and win only if they are newer. */
  async applyOp(userId, device, op) {
    const store = String(op?.store || '');
    const shaped = this.#shape(store, op?.id, op?.doc);
    if (!shaped) return { ok: false, store, id: String(op?.id || ''), error: 'invalid-target' };
    const doc = op?.doc && typeof op.doc === 'object' ? op.doc : {};
    let encoded;
    try {
      encoded = JSON.stringify(doc);
    } catch {
      return { ok: false, store, id: shaped.key, error: 'unencodable' };
    }
    if (encoded.length > MAX_DOC_BYTES) return { ok: false, store, id: shaped.key, error: 'too-large' };

    const updatedAt = clampInt(op?.updated_at, 0, Number.MAX_SAFE_INTEGER, Date.now());
    const createdAt = clampInt(doc?.createdAt, 0, Number.MAX_SAFE_INTEGER, updatedAt);
    const isDelete = op?.op === 'delete';
    const tombstone = isDelete ? updatedAt : null;
    const extra = isDelete ? {} : this.#extraColumns(store, doc);

    const cols = ['user_id', shaped.keyCol, ...Object.keys(extra), 'payload_json', 'created_at', 'updated_at', 'deleted_at', 'origin_device'];
    const placeholders = cols.map(() => '?').join(', ');
    const values = [
      userId, shaped.key, ...Object.values(extra), encoded, createdAt, updatedAt, tombstone, device || null
    ];

    /* Guarded upsert: only overwrite when the incoming row is newer. */
    const updateSet = cols.filter(c => c !== 'user_id' && c !== shaped.keyCol).map(c => `${c}=excluded.${c}`).join(', ');
    await this.#d1.prepare(
      `INSERT INTO ${shaped.table} (${cols.join(', ')}) VALUES (${placeholders})
       ON CONFLICT(user_id, ${shaped.keyCol}) DO UPDATE SET ${updateSet}
       WHERE excluded.updated_at >= ${shaped.table}.updated_at`
    ).bind(...values).run();

    const row = await this.#d1.prepare(
      `SELECT updated_at, deleted_at FROM ${shaped.table} WHERE user_id=? AND ${shaped.keyCol}=?`
    ).bind(userId, shaped.key).first();
    if (!row) return { ok: false, store, id: shaped.key, error: 'server-error' };
    const serverUpdatedAt = Number(row.updated_at || 0);
    /* `applied:false` means a newer server row won; the client reconciles to
     * updated_at instead of retrying forever. This is not an error. */
    return {
      ok: true,
      applied: serverUpdatedAt <= updatedAt,
      store,
      id: shaped.key,
      updated_at: serverUpdatedAt,
      deleted: row.deleted_at != null
    };
  }

  async listSince(userId, store, since, limit, cursor) {
    const shapedKey = store === 'dailyStats' ? 'day' : 'id';
    const table = STUDENT_TABLES[store];
    if (!table) return null;
    const after = clampInt(since, 0, Number.MAX_SAFE_INTEGER, 0);
    const max = clampInt(limit, 1, MAX_PULL_LIMIT, MAX_PULL_LIMIT);
    const rows = await this.#d1.prepare(
      `SELECT ${shapedKey} AS id, payload_json, updated_at, deleted_at
       FROM ${table}
       WHERE user_id=? AND updated_at>? AND ${shapedKey}>?
       ORDER BY updated_at ASC, ${shapedKey} ASC LIMIT ?`
    ).bind(userId, after, String(cursor || ''), max + 1).all();
    const items = (rows?.results || []).map(r => ({
      id: String(r.id),
      updated_at: Number(r.updated_at || 0),
      deleted: r.deleted_at != null,
      doc: r.deleted_at != null ? null : safeParse(r.payload_json)
    }));
    const limited = items.slice(0, max);
    const hasMore = items.length > max;
    return {
      store,
      items: limited,
      cursor: limited.length ? limited[limited.length - 1].id : String(cursor || ''),
      hasMore,
      nextSince: limited.length ? Number(limited[limited.length - 1].updated_at) : after
    };
  }

  async counts(userId) {
    const out = {};
    for (const [store, table] of Object.entries(STUDENT_TABLES)) {
      try {
        const row = await this.#d1.prepare(
          `SELECT COUNT(*) AS n, MAX(updated_at) AS latest FROM ${table} WHERE user_id=? AND deleted_at IS NULL`
        ).bind(userId).first();
        out[store] = { count: Number(row?.n || 0), latest: Number(row?.latest || 0) };
      } catch {
        out[store] = { count: 0, latest: 0 };
      }
    }
    return out;
  }

  async touchMeta(userId, { push = false, pull = false } = {}) {
    const now = Date.now();
    await this.#d1.prepare(
      `INSERT INTO user_sync_meta (user_id, last_push_at, last_pull_at, device_count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(user_id) DO UPDATE SET
         last_push_at = CASE WHEN ?=1 THEN ? ELSE user_sync_meta.last_push_at END,
         last_pull_at = CASE WHEN ?=1 THEN ? ELSE user_sync_meta.last_pull_at END`
    ).bind(userId, push ? now : null, pull ? now : null, push ? 1 : 0, now, pull ? 1 : 0, now).run();
  }
}

function safeParse(value) {
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function handleUserDataRequest(request, env, ctx) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/userdata/')) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  const store = new UserDataStore(env?.PROFILE_DB);
  if (!store.available()) return jsonResponse(request, { error: 'storage-unavailable' }, 503);

  /* Identity comes from the session, never from the body. */
  const session = await sessionUser(env, request);
  if (!session) return jsonResponse(request, { error: 'auth-required' }, 401);
  const userId = String(session.user.id);
  if (!/^[\w.:@-]{3,128}$/.test(userId)) return jsonResponse(request, { error: 'auth-required' }, 401);

  try {
    await store.init();

    if (url.pathname === '/api/userdata/sync' && request.method === 'POST') {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return jsonResponse(request, { error: 'invalid-json' }, 400);
      }
      const ops = Array.isArray(payload?.ops) ? payload.ops.slice(0, MAX_OPS_PER_SYNC) : null;
      if (!ops) return jsonResponse(request, { error: 'ops-required' }, 400);
      const device = safeId(payload?.device) || null;

      const results = [];
      for (const op of ops) {
        try {
          results.push(await store.applyOp(userId, device, op));
        } catch (err) {
          results.push({ ok: false, store: String(op?.store || ''), id: String(op?.id || ''), error: 'server-error' });
        }
      }
      await store.touchMeta(userId, { push: true });
      return jsonResponse(request, { ok: true, results, serverTime: Date.now() });
    }

    if (url.pathname === '/api/userdata/pull' && request.method === 'GET') {
      const storeName = String(url.searchParams.get('store') || '');
      if (!STUDENT_TABLES[storeName]) {
        /* No store given → return the per-store cursors for a bootstrap page. */
        await store.touchMeta(userId, { pull: true });
        return jsonResponse(request, { ok: true, cursor: Number(url.searchParams.get('since') || 0), counts: await store.counts(userId) });
      }
      const page = await store.listSince(
        userId,
        storeName,
        url.searchParams.get('since'),
        url.searchParams.get('limit'),
        url.searchParams.get('cursor')
      );
      await store.touchMeta(userId, { pull: true });
      return jsonResponse(request, { ok: true, ...page, serverTime: Date.now() });
    }

    if (url.pathname === '/api/userdata/bootstrap' && request.method === 'GET') {
      await store.touchMeta(userId, { pull: true });
      return jsonResponse(request, { ok: true, counts: await store.counts(userId), serverTime: Date.now() });
    }

    return jsonResponse(request, { error: 'not-found' }, 404);
  } catch (err) {
    console.error('[userdata] request failed', err);
    return jsonResponse(request, { error: 'server-error' }, 500);
  }
}
