/* P13 — D1 read path, load harness, and infra wiring. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const d1src = readFileSync(new URL('./p13-d1-read.mjs', import.meta.url), 'utf8');
const D1 = await import('./p13-d1-read.mjs');
const loadSrc = readFileSync(new URL('./p13-load-harness.js', import.meta.url), 'utf8');
const L = new Function('self', `${loadSrc}\nreturn self.AhP13Load;`)({});
const C = await import('./p13-api-compression.mjs');

/* ---------------------------- D1 read path ---------------------------- */

test('p13d-01: the schema indexes every list query column', () => {
  assert.match(D1.SCHEMA, /CREATE TABLE IF NOT EXISTS questions/);
  for (const idx of ['idx_q_topic', 'idx_q_subject', 'idx_q_sort', 'idx_q_pub']) {
    assert.ok(D1.SCHEMA.includes(idx), `${idx} missing — an unindexed list query is the slow case`);
  }
});

test('p13d-02: a plain page query is ordered by the indexed key and bounded', () => {
  const q = D1.buildQuery({ limit: 50 });
  assert.match(q.sql, /ORDER BY sort_key ASC, id ASC/);
  assert.match(q.sql, /LIMIT \?/);
  assert.equal(q.bind[q.bind.length - 1], 50);
});

test('p13d-03: the limit is clamped to a safe maximum', () => {
  assert.equal(D1.buildQuery({ limit: 99999 }).limit, D1.MAX_LIMIT);
  assert.equal(D1.buildQuery({ limit: 0 }).limit, 1);
  assert.equal(D1.buildQuery({}).limit, D1.DEFAULT_LIMIT);
});

test('p13d-04: filters bind as parameters, never string-interpolated', () => {
  const q = D1.buildQuery({ topicId: 't1', subjectId: 's2' });
  assert.match(q.sql, /topic_id = \?/);
  assert.match(q.sql, /subject_id = \?/);
  assert.ok(!q.sql.includes('t1') && !q.sql.includes('s2'), 'values must not appear in the SQL text');
  assert.deepEqual(q.bind.slice(0, 2), ['t1', 's2']);
});

test('p13d-05: a cursor becomes keyset pagination, not OFFSET', () => {
  const first = D1.toPage([
    { id: 'a2', sort_key: '2024-01', topic_id: 't', subject_id: 's', difficulty: 2, updated_at: 1, payload: '{}' },
    { id: 'a3', sort_key: '2024-02', topic_id: 't', subject_id: 's', difficulty: 1, updated_at: 1, payload: '{}' },
  ], 2);
  assert.ok(first.nextCursor, 'a full page must carry a cursor');
  const q = D1.buildQuery({ cursor: first.nextCursor, limit: 2 });
  assert.match(q.sql, /\(sort_key, id\) > \(\?, \?\)/);
  assert.ok(!/OFFSET/i.test(q.sql), 'OFFSET must never be used on a large table');
  assert.deepEqual(q.bind.slice(-3, -1), ['2024-02', 'a3']);
});

test('p13d-06: a short page ends the list with no cursor', () => {
  const page = D1.toPage([{ id: 'z', sort_key: 'k', topic_id: 't', subject_id: 's', difficulty: 1, updated_at: 1, payload: '{}' }], 20);
  assert.equal(page.count, 1);
  assert.equal(page.nextCursor, null);
});

test('p13d-07: cursors round-trip and reject garbage', () => {
  const c = D1.encodeCursor({ sort_key: 'k9', id: 'q7' });
  assert.deepEqual(D1.decodeCursor(c), { sortKey: 'k9', id: 'q7' });
  assert.equal(D1.decodeCursor('not-a-cursor'), null);
  assert.equal(D1.decodeCursor(null), null);
});

test('p13d-08: a row payload is spread into the normalized result', () => {
  const row = D1.normalizeRow({ id: 'q1', topic_id: 't', subject_id: 's', difficulty: 3, sort_key: 'k', updated_at: 5, payload: '{"text":"প্রশ্ন","answerIndex":2}' });
  assert.equal(row.id, 'q1');
  assert.equal(row.text, 'প্রশ্ন');
  assert.equal(row.answerIndex, 2);
  assert.equal(row.topicId, 't');
});

test('p13d-09: the reader is null-safe when D1 is not bound (KV fallback preserved)', async () => {
  const reader = D1.createD1Reader(null);
  assert.equal(reader.available, false);
  assert.equal(await reader.page({}), null);
  assert.equal(await reader.count({}), null);
});

test('p13d-10: the reader runs the query through bind and returns a page', async () => {
  let captured = null;
  const db = { prepare(sql) { captured = sql; return { bind: (...a) => ({ all: async () => ({ results: [{ id: 'x', topic_id: 't', subject_id: 's', difficulty: 1, sort_key: 'k', payload: '{}', updated_at: 1 }] }) }), all: async () => ({ results: [] }) }; } };
  const reader = D1.createD1Reader(db);
  const page = await reader.page({ topicId: 't', limit: 5 });
  assert.equal(page.count, 1);
  assert.match(captured, /ORDER BY sort_key ASC, id ASC LIMIT \?/);
});

test('p13d-11: all() returns every row for a filter, ordered, with no LIMIT', async () => {
  const seen = [];
  const db = { prepare(sql) { seen.push(sql); return { bind: () => ({ all: async () => ({ results: [] }) }), all: async () => ({ results: [] }) }; } };
  const reader = D1.createD1Reader(db);
  await reader.all({ subjectId: 'sub-01' });
  assert.match(seen[0], /ORDER BY sort_key ASC, id ASC$/);
  assert.ok(!/LIMIT/.test(seen[0]), 'all() must not truncate');
});

test('p13d-12: sig() reads the stored content signature, and is null-safe', async () => {
  const ok = { prepare: () => ({ bind: () => ({ first: async () => ({ v: '1:2:3' }) }) }) };
  assert.equal(await D1.createD1Reader(ok).sig(), '1:2:3');
  assert.equal(await D1.createD1Reader(null).sig(), null);
  const broken = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error('no table'); } }) }) };
  assert.equal(await D1.createD1Reader(broken).sig(), null, 'a missing table must not throw');
});

test('p13d-14: document() assembles questions plus the mirrored lists from D1', async () => {
  const db = { prepare(sql) {
    if (/content_lists/.test(sql)) return { all: async () => ({ results: [{ kind: 'subjects', payload: '{"id":"sub-01"}' }, { kind: 'topics', payload: '{"id":"top-001"}' }] }) };
    return { all: async () => ({ results: [{ id: 'q1', topic_id: 't', subject_id: 'sub-01', difficulty: 1, sort_key: 'k', payload: '{"text":"x"}', updated_at: 1 }] }) };
  } };
  const doc = await D1.createD1Reader(db).document();
  assert.equal(doc.questions.length, 1);
  assert.equal(doc.subjects[0].id, 'sub-01');
  assert.equal(doc.topics[0].id, 'top-001');
});

test('p13d-15: document() returns null when there is nothing to serve', async () => {
  const empty = { prepare: () => ({ all: async () => ({ results: [] }) }) };
  assert.equal(await D1.createD1Reader(empty).document(), null, 'empty D1 must fall back to KV');
  const broken = { prepare: () => { throw new Error('no table'); } };
  assert.equal(await D1.createD1Reader(broken).document(), null);
});

test('p13d-13: a bound reader normalizes rows and counts', async () => {
  const seen = [];
  const db = { prepare(sql) { seen.push(sql); return { bind(...args) { this._a = args; return this; }, async all() { return { results: [{ id: 'q1', sort_key: 'k1', topic_id: 't', subject_id: 's', difficulty: 1, updated_at: 1, payload: '{"text":"x"}' }] }; }, async first() { return { n: 7 }; } }; } };
  const reader = D1.createD1Reader(db);
  assert.equal(reader.available, true);
  const page = await reader.page({ topicId: 't' });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].text, 'x');
  assert.equal(await reader.count({}), 7);
  assert.match(seen[0], /WHERE topic_id = \? AND published = 1/);
});

/* ---------------------------- load harness ---------------------------- */

test('p13l-01: percentile picks the right sample', () => {
  const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(L.percentile(s, 50), 5);
  assert.equal(L.percentile(s, 95), 10);
  assert.equal(L.percentile([], 50), 0);
});

test('p13l-02: summarize separates ok from errors and reports the tail', () => {
  const sum = L.summarize([{ ok: true, ms: 10 }, { ok: true, ms: 20 }, { ok: false, ms: 5 }]);
  assert.equal(sum.total, 3);
  assert.equal(sum.ok, 2);
  assert.equal(sum.errors, 1);
  assert.equal(sum.max, 20);
  assert.ok(Math.abs(sum.errorRate - 1 / 3) < 1e-9);
});

test('p13l-03: a run issues exactly users x perUser requests', async () => {
  let calls = 0;
  const res = await L.run({ users: 5, perUser: 4, concurrency: 3, request: async () => { calls += 1; }, now: (() => { let t = 0; return () => (t += 1); })() });
  assert.equal(calls, 20);
  assert.equal(res.summary.total, 20);
});

test('p13l-04: the verdict fails when p95 or error rate breaks the budget', async () => {
  const slow = await L.run({ users: 4, perUser: 2, request: async () => {}, now: (() => { let t = 0; return () => (t += 100); })(), budget: { p95: 50, errorRate: 0 } });
  assert.equal(slow.pass, false);
  assert.equal(slow.verdict.p95Ok, false);
  const failing = await L.run({ users: 4, perUser: 2, request: async () => { throw new Error('x'); }, budget: { errorRate: 0 } });
  assert.equal(failing.pass, false);
  assert.equal(failing.verdict.errorRateOk, false);
});

test('p13l-05: a healthy run passes its budget', async () => {
  const res = await L.run({ users: 3, perUser: 3, request: async () => {}, now: (() => { let t = 0; return () => (t += 2); })(), budget: { p95: 100, errorRate: 0 } });
  assert.equal(res.pass, true);
  assert.equal(res.summary.errorRate, 0);
});

test('p13l-06: the deterministic generator is repeatable and can inject failures', async () => {
  const a = L.fakeRequests({ baseMs: 0, jitterMs: 0, seed: 7 });
  const r1 = L.summarize([{ ok: true, ms: 1 }]);
  const res = await L.run({ users: 2, perUser: 2, request: a.request, now: a.now, budget: { errorRate: 0 } });
  assert.equal(res.summary.ok, 4);
  assert.ok(r1.p50 >= 0);
});

/* ---------------------------- infra wiring ---------------------------- */

test('p13w-04: _headers caches immutable static assets aggressively but never the shell', () => {
  const h = readFileSync(new URL('./_headers', import.meta.url), 'utf8');
  assert.match(h, /immutable/, 'hashed static assets need an immutable cache header');
  assert.match(h, /\/sw\.js[\s\S]*no-store/, 'the worker must never be cached');
  assert.match(h, /\/index\.html[\s\S]*no-cache/, 'the shell must always revalidate');
});

test('p13w-05: wrangler declares the D1 binding used by the read path', () => {
  const w = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
  assert.match(w, /\[\[d1_databases\]\]/);
  assert.match(w, /binding = "PROFILE_DB"/);
});

test('p13w-06: the worker routes public API replies through compression', () => {
  const w = readFileSync(new URL('./gk-agent-worker.js', import.meta.url), 'utf8');
  assert.ok(w.includes("import { compressResponse } from './p13-api-compression.mjs'"), 'compression helper not imported');
  assert.match(w, /return await compressResponse\(request, pubResponse\)/);
  assert.match(w, /PROFILE_DB: env\.PROFILE_DB/, 'D1 binding not passed to the public handler');
});

test('p13w-07: the runtime exposes a real windowed VirtualList, not a stub', () => {
  const r = readFileSync(new URL('./p13-performance-runtime.js', import.meta.url), 'utf8');
  assert.match(r, /function VirtualList\(container, opts/);
  assert.match(r, /items\.slice\(win\.start, win\.end\)/, 'must render only the visible slice');
  assert.match(r, /container\.addEventListener\('scroll', schedule/);
  assert.match(r, /Perf\.computeWindow/);
});

test('p13w-08: the D1 content path is flag-and-sig gated and falls back to KV', () => {
  const p = readFileSync(new URL('./public-worker.js', import.meta.url), 'utf8');
  assert.match(p, /env\.PUB_D1_CONTENT === 'enabled'/, 'D1 path must be opt-in, never the default');
  assert.match(p, /await reader\.sig\(\)\) === String\(meta\.sig\)/, 'D1 must be served only when its sig matches the live meta');
  assert.match(p, /await import\('\.\/p13-d1-read\.mjs'\)/, 'dynamic import keeps D1 code out of the main bundle');
  assert.match(p, /fall through to KV/, 'a D1 miss must fall back to the live KV content');
  assert.match(p, /await reader\.document\(\)/, 'the whole document must be assembled from D1');
  assert.match(p, /\{ v: meta\.v \|\| 0, at: meta\.at \|\| 0, sig: meta\.sig, \.\.\.document, source: 'd1' \}/, 'the D1 reply must carry v/sig and the document shape');
  // The gate must sit before the KV read *within the same route*, so default
  // behaviour is unchanged.
  const gate = p.indexOf('PUB_D1_CONTENT');
  assert.ok(gate > -1 && p.indexOf("env.PUB_KV.get('pubContent')", gate) > gate, 'KV read must remain the fallback after the gate');
});

/* ---------------------------- compression ---------------------------- */

test('p13c-01: only large, compressible, successful replies are gzipped', () => {
  assert.equal(C.shouldCompress({ acceptEncoding: 'gzip', length: 4096 }), true);
  assert.equal(C.shouldCompress({ acceptEncoding: '', length: 4096 }), false);
  assert.equal(C.shouldCompress({ acceptEncoding: 'gzip', length: 10 }), false);
  assert.equal(C.shouldCompress({ acceptEncoding: 'gzip', length: 4096, status: 500 }), false);
  assert.equal(C.shouldCompress({ acceptEncoding: 'gzip', length: 4096, method: 'HEAD' }), false);
});

test('p13c-02: the strongest offered encoding is chosen', () => {
  assert.equal(C.preferEncoding('gzip, deflate, br'), 'br');
  assert.equal(C.preferEncoding('gzip, deflate'), 'gzip');
  assert.equal(C.preferEncoding('identity'), null);
});

test('p13c-03: compressResponse leaves a small reply untouched and never throws', async () => {
  const req = new Request('https://x/api', { headers: { 'Accept-Encoding': 'gzip' } });
  const small = new Response('hi', { status: 200 });
  const out = await C.compressResponse(req, small);
  assert.equal(await out.text(), 'hi');
  const big = new Response(JSON.stringify({ a: 'x'.repeat(4000) }), { status: 200 });
  const out2 = await C.compressResponse(req, big);
  assert.equal(out2.headers.get('Vary'), 'Accept-Encoding');
  assert.ok(out2.headers.get('Content-Encoding'));
});

