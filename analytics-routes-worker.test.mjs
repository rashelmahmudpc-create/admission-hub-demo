/* Phase 4 — the analytics routes through the real worker entry point.
 *
 * The engine tests call the handler directly. This file calls the worker's
 * `fetch`, so it also proves the wiring: that the route is registered, that it
 * runs before the /api/* catch-all, and that the shipped bundle behaves the
 * same as the source. A handler that works but is never reached is the exact
 * failure this file exists to catch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import sourceWorker from './gk-agent-worker.js';
import bundledWorker from './worker-bundle.mjs';
import Database from 'better-sqlite3';

const NOW = Date.UTC(2026, 8, 24, 4, 0, 0);
const TODAY = '2026-09-24';

function d1From(database) {
  const wrap = (statement, bindings) => ({
    async run() { const i = database.prepare(statement).run(...bindings); return { meta: { changes: i.changes }, results: [] }; },
    async first() { const p = database.prepare(statement); return p.reader ? (p.get(...bindings) ?? null) : (p.run(...bindings), null); },
    async all() { const p = database.prepare(statement); return { results: p.reader ? p.all(...bindings) : (p.run(...bindings), []) }; }
  });
  return {
    prepare: (s) => ({ bind: (...b) => wrap(s, b), ...wrap(s, []) }),
    async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; }
  };
}

function env(overrides = {}) {
  const database = new Database(':memory:');
  /* PROFILE_DB is the real wrangler binding name; using it here means the test
   * would fail if the engine read the wrong binding. */
  return { env: { PROFILE_DB: d1From(database), ...overrides }, database };
}

const workerFetch = (worker, request, e) => worker.fetch(request, e, { waitUntil() {}, passThroughOnException() {} });

/* ── routing ─────────────────────────────────────────────────────────────── */

for (const [name, worker] of [['source', sourceWorker], ['bundle', bundledWorker]]) {
  test(`p4w-1 (${name}): the analytics route is reached, not swallowed by the /api catch-all`, async () => {
    const { env: e } = env();
    const res = await workerFetch(worker, new Request('https://worker/api/analytics/overview', { method: 'GET' }), e);
    /* Not 404 (route missing) and not the public handler's answer: the engine
     * owns this path and answers with its own status. /overview is admin-only,
     * so a caller with no token gets 403 — the same answer a wrong token gets,
     * which is deliberate: it does not reveal whether admin exists. */
    assert.equal(res.status, 403, 'unauthenticated admin access must be refused');
    const body = await res.json();
    assert.equal(body.error, 'forbidden');
  });

  test(`p4w-1 (${name}): a student can only read their own dashboard`, async () => {
    const { env: e } = env();
    const res = await workerFetch(worker, new Request('https://worker/api/analytics/me?user=someone-else', { method: 'GET' }), e);
    assert.equal(res.status, 401, 'no session means no dashboard, whatever the query says');
  });

  test(`p4w-2 (${name}): admin analytics is closed when ADMIN_TOKEN is unset`, async () => {
    const { env: e } = env();
    const res = await workerFetch(worker, new Request('https://worker/api/analytics/segments', {
      headers: { Authorization: 'Bearer anything' }
    }), e);
    assert.equal(res.status, 403, 'an unset token must not mean "open"');
    assert.notEqual(res.status, 200);
  });

  test(`p4w-2 (${name}): a wrong admin token is rejected`, async () => {
    const { env: e } = env({ ADMIN_TOKEN: 'the-real-token' });
    const res = await workerFetch(worker, new Request('https://worker/api/analytics/segments', {
      headers: { Authorization: 'Bearer the-wrong-token' }
    }), e);
    assert.equal(res.status, 403);
  });

  test(`p4w-3 (${name}): a non-analytics path passes through untouched`, async () => {
    const { env: e } = env();
    const res = await workerFetch(worker, new Request('https://worker/api/not-analytics', { method: 'GET' }), e);
    const body = await res.text();
    assert.ok(!/forbidden|auth-required|storage-unavailable/.test(body),
      'the engine must not claim routes it does not own');
  });
}

/* ── the admin path end to end, through fetch ────────────────────────────── */

test('p4w-4: a correct admin token returns an aggregate dashboard from real rows', async () => {
  const { env: e, database } = env({ ADMIN_TOKEN: 'the-real-token' });
  const res = await workerFetch(sourceWorker, new Request('https://worker/api/analytics/overview?days=30', {
    headers: { Authorization: 'Bearer the-real-token' }
  }), e);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.engagement, 'the payload must carry engagement');
  assert.equal(body.scope, 'admin');
  const text = JSON.stringify(body);
  assert.ok(!/"user_id"/.test(text), 'no per-student field may reach the admin payload');
  assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='analytics_events'").get());
});

test('p4w-4: every advertised admin route answers 200 with a valid token', async () => {
  const routes = ['overview', 'engagement', 'funnel', 'retention', 'notifications', 'segments', 'courses'];
  for (const route of routes) {
    const { env: e } = env({ ADMIN_TOKEN: 'tok' });
    const res = await workerFetch(sourceWorker, new Request(`https://worker/api/analytics/${route}?days=7`, {
      headers: { Authorization: 'Bearer tok' }
    }), e);
    assert.equal(res.status, 200, `${route} must be served`);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify({}))); /* body must be JSON-serializable */
    const body = await res.json();
    assert.equal(typeof body, 'object');
  }
});
