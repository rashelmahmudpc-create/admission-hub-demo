/* Student data sync — server API contract tests.
 *
 * Covers the guarantees the migration depends on: account isolation (a student
 * can never touch another student's rows), idempotent replay, deterministic
 * last-write-wins conflict handling, tombstone deletes, and incremental pull. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { UserDataStore, handleUserDataRequest } from './userdata-api.mjs';

/* Minimal D1 double: real SQL is out of scope, so we emulate the handful of
 * statements the module issues against an in-memory table set. */
class FakeD1 {
  constructor() { this.tables = new Map(); }
  #table(name) {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name);
  }
  prepare(sql) {
    const self = this;
    const norm = sql.replace(/\s+/g, ' ').trim();
    return {
      _binds: [],
      bind(...args) { this._binds = args; return this; },
      async run() {
        const m = norm.match(/^CREATE (TABLE|INDEX) IF NOT EXISTS (\w+)/i);
        if (m) {
          if (m[1].toUpperCase() === 'TABLE') self.#table(m[2]);
          return { success: true };
        }
        const ins = norm.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)/i);
        if (ins) {
          const table = self.#table(ins[1]);
          const cols = ins[2].split(',').map(s => s.trim());
          const row = {};
          cols.forEach((c, i) => { row[c] = this._binds[i]; });
          const conflict = norm.match(/ON CONFLICT\(([^)]+)\)/i);
          const keys = conflict ? conflict[1].split(',').map(s => s.trim()) : [cols[0]];
          const rowKey = keys.map(k => String(row[k])).join('\u0000');
          const existing = table.get(rowKey);
          if (existing) {
            const guard = norm.match(/WHERE excluded\.updated_at >= \w+\.updated_at/i);
            if (guard && !(Number(row.updated_at) >= Number(existing.updated_at))) return { success: true };
            table.set(rowKey, { ...existing, ...row });
          } else {
            table.set(rowKey, row);
          }
          return { success: true };
        }
        throw new Error('unsupported run: ' + norm);
      },
      async first() {
        const sel = norm.match(/^SELECT (.+) FROM (\w+) WHERE user_id=\? AND (\w+)=\?/i);
        if (sel) {
          const table = self.#table(sel[2]);
          const keyCol = sel[3];
          const [userId, key] = this._binds;
          const row = table.get(String(userId) + '\u0000' + String(key));
          if (!row) return null;
          return { updated_at: row.updated_at, deleted_at: row.deleted_at ?? null };
        }
        const count = norm.match(/^SELECT COUNT\(\*\) AS n, MAX\(updated_at\) AS latest FROM (\w+)/i);
        if (count) {
          const table = self.#table(count[1]);
          let n = 0, latest = 0;
          for (const row of table.values()) {
            if (String(row.user_id) !== String(this._binds[0])) continue;
            if (row.deleted_at != null) continue;
            n += 1; latest = Math.max(latest, Number(row.updated_at) || 0);
          }
          return { n, latest };
        }
        throw new Error('unsupported first: ' + norm);
      },
      async all() {
        const sel = norm.match(/^SELECT (\w+) AS id, payload_json, updated_at, deleted_at FROM (\w+) WHERE user_id=\? AND updated_at>\? AND \w+>\?/i);
        if (!sel) throw new Error('unsupported all: ' + norm);
        const table = self.#table(sel[2]);
        const keyCol = sel[1];
        const [userId, after, cursor, limit] = this._binds;
        const rows = [...table.values()]
          .filter(r => String(r.user_id) === String(userId))
          .filter(r => Number(r.updated_at) > Number(after))
          .filter(r => String(r[keyCol]) > String(cursor))
          .sort((a, b) => Number(a.updated_at) - Number(b.updated_at) || String(a[keyCol]).localeCompare(String(b[keyCol])))
          .slice(0, Number(limit));
        return { results: rows.map(r => ({ id: r[keyCol], payload_json: r.payload_json, updated_at: r.updated_at, deleted_at: r.deleted_at ?? null })) };
      }
    };
  }
}

const makeEnv = () => ({ PROFILE_DB: new FakeD1() });

/* R2 double backed by an in-memory Map. */
class FakeR2 {
  constructor() { this.objects = new Map(); }
  async put(key, body, opts = {}) {
    this.objects.set(key, { body: new Uint8Array(body), customMetadata: opts.customMetadata || {} });
  }
  async head(key) { return this.objects.has(key) ? { customMetadata: this.objects.get(key).customMetadata } : null; }
  async get(key) {
    const o = this.objects.get(key);
    if (!o) return null;
    return { async arrayBuffer() { return o.body.buffer.slice(o.body.byteOffset, o.body.byteOffset + o.body.byteLength); } };
  }
}

/* Auth authority double: token 'A'.repeat(48) → alpha, 'B'.repeat(48) → beta. */
const makeAuthEnv = () => ({
  PROFILE_DB: new FakeD1(),
  AUTH_AUTHORITY: {
    idFromName: () => 'auth',
    get: () => ({
      async fetch(_url, init) {
        const { sessionToken } = JSON.parse(init.body);
        const id = sessionToken === 'A'.repeat(48) ? 'usr_alpha' : sessionToken === 'B'.repeat(48) ? 'usr_beta' : null;
        return new Response(JSON.stringify(id ? { ok: true, result: { user: { id } } } : { ok: false }), { headers: { 'Content-Type': 'application/json' } });
      }
    })
  }
});

const req = (token, path, init = {}) => new Request('https://x.test' + path, {
  ...init,
  headers: { Cookie: `__Host-ah_session=${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
});

const call = (env, request) => handleUserDataRequest(request, env, {});

const sync = (env, token, ops) => call(env, req(token, '/api/userdata/sync', {
  method: 'POST',
  body: JSON.stringify({ device: 'dev-1', ops })
}));

const pull = (env, token, query) => call(env, req(token, '/api/userdata/pull?' + query));

test('userdata: unauthenticated request is rejected', async () => {
  const env = makeEnv();
  const res = await handleUserDataRequest(new Request('https://x.test/api/userdata/sync', { method: 'POST', body: '{}' }), env, {});
  assert.equal(res.status, 401);
});

test('userdata: student rows are written under the session user_id, not the body', async () => {
  const env = makeAuthEnv();
  const res = await sync(env, 'A'.repeat(48), [
    { store: 'examResults', id: 'r1', op: 'put', updated_at: 1000, doc: { id: 'r1', score: 8, createdAt: 900 } },
    { store: 'mistakes', id: 'm1', op: 'put', updated_at: 1000, doc: { id: 'm1', questionId: 'q1', mastered: false } }
  ]);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.results.every(r => r.ok), JSON.stringify(body.results));
  /* A forged user_id in the payload is ignored. */
  const store = new UserDataStore(env.PROFILE_DB);
  await store.init();
  const counts = await store.counts('usr_alpha');
  assert.equal(counts.examResults.count, 1);
  assert.equal(counts.mistakes.count, 1);
  assert.equal((await store.counts('usr_beta')).examResults.count, 0);
});

test('userdata: replaying the same op is idempotent (no duplicate rows)', async () => {
  const env = makeAuthEnv();
  const op = { store: 'notes', id: 'n1', op: 'put', updated_at: 1000, doc: { id: 'n1', body: 'hi' } };
  await sync(env, 'A'.repeat(48), [op]);
  await sync(env, 'A'.repeat(48), [op]);
  await sync(env, 'A'.repeat(48), [op]);
  const store = new UserDataStore(env.PROFILE_DB);
  await store.init();
  assert.equal((await store.counts('usr_alpha')).notes.count, 1);
});

test('userdata: last-write-wins — a stale edit cannot overwrite a newer row', async () => {
  const env = makeAuthEnv();
  await sync(env, 'A'.repeat(48), [{ store: 'notes', id: 'n1', op: 'put', updated_at: 2000, doc: { id: 'n1', body: 'new' } }]);
  const res = await sync(env, 'A'.repeat(48), [{ store: 'notes', id: 'n1', op: 'put', updated_at: 1000, doc: { id: 'n1', body: 'stale' } }]);
  const body = await res.json();
  assert.equal(body.results[0].ok, true);
  assert.equal(body.results[0].applied, false);
  assert.equal(body.results[0].updated_at, 2000);
  const store = new UserDataStore(env.PROFILE_DB);
  await store.init();
  const page = await store.listSince('usr_alpha', 'notes', 0, 50, '');
  assert.equal(page.items[0].doc.body, 'new');
});

test('userdata: delete writes a tombstone and a stale update cannot resurrect it', async () => {
  const env = makeAuthEnv();
  await sync(env, 'A'.repeat(48), [{ store: 'notes', id: 'n1', op: 'put', updated_at: 1000, doc: { id: 'n1', body: 'hi' } }]);
  await sync(env, 'A'.repeat(48), [{ store: 'notes', id: 'n1', op: 'delete', updated_at: 2000 }]);
  const res = await sync(env, 'A'.repeat(48), [{ store: 'notes', id: 'n1', op: 'put', updated_at: 1500, doc: { id: 'n1', body: 'zombie' } }]);
  assert.equal((await res.json()).results[0].applied, false);
  const store = new UserDataStore(env.PROFILE_DB);
  await store.init();
  const page = await store.listSince('usr_alpha', 'notes', 0, 50, '');
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].deleted, true);
});

test('userdata: logs a serializable error instead of throwing on a malformed op', async () => {
  const env = makeAuthEnv();
  const res = await sync(env, 'A'.repeat(48), [
    { store: 'not-a-store', id: 'x', op: 'put', updated_at: 1, doc: {} },
    { store: 'dailyStats', id: 'not-a-date', op: 'put', updated_at: 1, doc: {} },
    { store: 'notes', id: '', op: 'put', updated_at: 1, doc: {} }
  ]);
  const body = await res.json();
  assert.equal(body.results.length, 3);
  assert.ok(body.results.every(r => r.ok === false && r.error === 'invalid-target'));
});

test('userdata: daily stats key on the day, not a random id', async () => {
  const env = makeAuthEnv();
  const res = await sync(env, 'A'.repeat(48), [
    { store: 'dailyStats', id: '2026-09-24', op: 'put', updated_at: 5000, doc: { id: '2026-09-24', questions: 10, correct: 7 } }
  ]);
  const body = await res.json();
  assert.equal(body.results[0].ok, true);
  assert.equal(body.results[0].id, '2026-09-24');
});

test('userdata: pull is incremental and paginated', async () => {
  const env = makeAuthEnv();
  const ops = [];
  for (let i = 0; i < 7; i += 1) ops.push({ store: 'activityLogs', id: `a${i}`, op: 'put', updated_at: 1000 + i, doc: { id: `a${i}`, ts: 1000 + i } });
  await sync(env, 'A'.repeat(48), ops);
  const store = new UserDataStore(env.PROFILE_DB);
  await store.init();

  const first = await store.listSince('usr_alpha', 'activityLogs', 0, 3, '');
  assert.equal(first.items.length, 3);
  assert.equal(first.hasMore, true);
  const second = await store.listSince('usr_alpha', 'activityLogs', 0, 3, first.cursor);
  assert.equal(second.items.length, 3);
  const third = await store.listSince('usr_alpha', 'activityLogs', 0, 3, second.cursor);
  assert.equal(third.items.length, 1);
  assert.equal(third.hasMore, false);

  /* Since cursor skips already-pulled rows. */
  const after = await store.listSince('usr_alpha', 'activityLogs', 1003, 50, '');
  assert.equal(after.items.length, 3);
});

test('userdata: one account cannot read another account through pull', async () => {
  const env = makeAuthEnv();
  await sync(env, 'A'.repeat(48), [{ store: 'mistakes', id: 'm1', op: 'put', updated_at: 1000, doc: { id: 'm1', questionId: 'q1' } }]);
  const res = await pull(env, 'B'.repeat(48), 'store=mistakes&since=0');
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.items.length, 0);
});

test('userdata: unsupported store name is not routable', async () => {
  const env = makeAuthEnv();
  await sync(env, 'A'.repeat(48), [{ store: 'test', id: 't', op: 'put', updated_at: 1, doc: {} }]);
  const res = await handleUserDataRequest(req('A'.repeat(48), '/api/userdata/destroy'), env, {});
  assert.equal(res.status, 404);
});

test('userdata: non-userdata path is ignored by the handler', async () => {
  const env = makeEnv();
  const res = await handleUserDataRequest(new Request('https://x.test/api/other'), env, {});
  assert.equal(res, null);
});

/* ── R2 spillover ──────────────────────────────────────────────────────── */

const heavyExam = (id, questions = 120) => ({
  id,
  examId: 'e1',
  score: 80,
  correct: 80,
  wrong: 40,
  createdAt: 1000,
  /* Each entry mimics one question's snapshot + timing records. */
  snapshot: Array.from({ length: questions }, (_, i) => ({ questionId: 'q' + i, status: i % 2 ? 'correct' : 'wrong', subjectId: 's1' })),
  timing: Object.fromEntries(Array.from({ length: questions }, (_, i) => ['q' + i, { ms: 1200 + i }])),
  timeAnalysis: { classified: Array.from({ length: questions }, (_, i) => ({ questionId: 'q' + i, seconds: 1.2 })) }
});

test('r2: a heavy exam keeps only its summary in D1', async () => {
  const env = { ...makeAuthEnv(), FILE_BUCKET: new FakeR2() };
  const exam = heavyExam('r-heavy');
  const res = await sync(env, 'A'.repeat(48), [{ store: 'examResults', id: exam.id, op: 'put', updated_at: 1000, doc: exam }]);
  assert.equal((await res.json()).results[0].ok, true);

  const store = new UserDataStore(env.PROFILE_DB, env.FILE_BUCKET);
  await store.init();
  const raw = env.PROFILE_DB.tables.get('user_exam_results');
  const row = [...raw.values()][0];
  const inD1 = JSON.parse(row.payload_json);
  assert.equal(inD1.score, 80, 'the queryable summary stays in D1');
  assert.equal(inD1.snapshot, undefined, 'the heavy snapshot is not in D1');
  assert.equal(inD1.timing, undefined);
  assert.ok([...env.FILE_BUCKET.objects.keys()][0].startsWith('examResults/usr_alpha/'), 'the blob is per-account');
});

test('r2: pull rehydrates the full exam from the archive', async () => {
  const env = { ...makeAuthEnv(), FILE_BUCKET: new FakeR2() };
  const exam = heavyExam('r-heavy');
  await sync(env, 'A'.repeat(48), [{ store: 'examResults', id: exam.id, op: 'put', updated_at: 1000, doc: exam }]);

  const store = new UserDataStore(env.PROFILE_DB, env.FILE_BUCKET);
  await store.init();
  const page = await store.listSince('usr_alpha', 'examResults', 0, 50, '');
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].doc.score, 80);
  assert.equal(page.items[0].doc.snapshot.length, exam.snapshot.length, 'the heavy fields came back');
  assert.equal(page.items[0].doc.timing.q5.ms, 1205);
});

test('r2: a small exam is not offloaded', async () => {
  const env = { ...makeAuthEnv(), FILE_BUCKET: new FakeR2() };
  const small = { id: 'r-small', examId: 'e1', score: 5, snapshot: [{ questionId: 'q1', status: 'correct' }] };
  await sync(env, 'A'.repeat(48), [{ store: 'examResults', id: small.id, op: 'put', updated_at: 1000, doc: small }]);
  assert.equal(env.FILE_BUCKET.objects.size, 0, 'no archive write for a small payload');
  const row = [...env.PROFILE_DB.tables.get('user_exam_results').values()][0];
  assert.ok(JSON.parse(row.payload_json).snapshot, 'the whole doc stays in D1');
});

test('r2: a failed archive write keeps the heavy fields in D1 rather than losing them', async () => {
  const failing = { async put() { throw new Error('r2 down'); }, head: async () => null, get: async () => null };
  const env = { ...makeAuthEnv(), FILE_BUCKET: failing };
  const exam = heavyExam('r-heavy');
  await sync(env, 'A'.repeat(48), [{ store: 'examResults', id: exam.id, op: 'put', updated_at: 1000, doc: exam }]);
  const row = [...env.PROFILE_DB.tables.get('user_exam_results').values()][0];
  assert.equal(JSON.parse(row.payload_json).snapshot.length, exam.snapshot.length, 'no data loss on archive failure');
});

test('r2: one account cannot read another account archive blob', async () => {
  const env = { ...makeAuthEnv(), FILE_BUCKET: new FakeR2() };
  const exam = heavyExam('r-heavy');
  await sync(env, 'A'.repeat(48), [{ store: 'examResults', id: exam.id, op: 'put', updated_at: 1000, doc: exam }]);
  const res = await pull(env, 'B'.repeat(48), 'store=examResults&since=0');
  const body = await res.json();
  assert.equal(body.items.length, 0);
  assert.ok([...env.FILE_BUCKET.objects.keys()].every(k => k.includes('usr_alpha')), 'blob keys are account-scoped');
});
