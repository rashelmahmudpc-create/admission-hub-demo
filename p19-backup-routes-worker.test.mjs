/* P19 — the backup/restore routes through the real worker entry point.
 *
 * p19-backup.test.mjs calls the module directly. This file calls the worker's
 * `fetch`, so it pins the wiring a unit test cannot see: that the routes are
 * registered under the admin gate, that a missing or wrong token is refused
 * before any R2/KV work happens, and that the shipped bundle behaves the same
 * as the source.
 *
 * The security test is the important one. A backup endpoint that answers
 * without the admin token would hand the entire dataset — student state, chat
 * memory, published content — to anyone who guesses the path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import sourceWorker from './gk-agent-worker.js';
import bundledWorker from './worker-bundle.mjs';

function kv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [...store.keys()].map(name => ({ name })), list_complete: true, cursor: undefined }; },
  };
}

function d1(tables = {}) {
  return {
    prepare(sql) {
      if (/sqlite_master/i.test(sql)) return { async all() { return { results: Object.keys(tables).map(name => ({ name })) }; } };
      const name = sql.replace(/.*FROM "?([^"]+)"?.*/i, '$1');
      return { async all() { return { results: tables[name] || [] }; } };
    },
  };
}

function r2() {
  const objects = new Map();
  return {
    objects,
    async put(k, body) { objects.set(k, body); },
    async get(k) { const body = objects.get(k); return body == null ? null : { async text() { return body; } }; },
  };
}

function env(overrides = {}) {
  return {
    ADMIN_TOKEN: 'admin-tok',
    GK_KV: kv({ gkDay: '2026-10-11' }),
    PUB_KV: kv(),
    OLD_KV: kv({ userBank: '{"full":{}}' }),
    PROFILE_DB: d1({ profiles: [{ id: 'u1' }] }),
    FILE_BUCKET: r2(),
    ...overrides,
  };
}

const workerFetch = (worker, request, e) => worker.fetch(request, e, { waitUntil() {}, passThroughOnException() {} });
const withToken = (url, method, token) => new Request(url, {
  method,
  headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
});

for (const [name, worker] of [['source', sourceWorker], ['bundle', bundledWorker]]) {
  test(`p19b-১ (${name}): every backup route is closed without the admin token`, async () => {
    const routes = [['/api/admin/backup', 'GET'], ['/api/admin/backup', 'POST'], ['/api/admin/restore', 'POST']];
    for (const [path, method] of routes) {
      const res = await workerFetch(worker, withToken(`https://worker${path}`, method), env());
      assert.equal(res.status, 403, `${method} ${path} must require the admin token`);
      assert.equal((await res.json()).error, 'forbidden');
    }
  });

  test(`p19b-২ (${name}): a wrong token gets the same refusal as no token`, async () => {
    const res = await workerFetch(worker, withToken('https://worker/api/admin/backup', 'POST', 'wrong-tok'), env());
    assert.equal(res.status, 403);
  });

  test(`p19b-৩ (${name}): an empty index is reported as empty, never padded`, async () => {
    const res = await workerFetch(worker, withToken('https://worker/api/admin/backup', 'GET', 'admin-tok'), env());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.count, 0);
    assert.deepEqual(body.snapshots, []);
  });

  test(`p19b-৪ (${name}): a snapshot is taken, stored, and then listed`, async () => {
    const e = env();
    const made = await workerFetch(worker, withToken('https://worker/api/admin/backup', 'POST', 'admin-tok'), e);
    assert.equal(made.status, 200);
    const { snapshot } = await made.json();
    assert.ok(snapshot.key.startsWith('backups/'));
    assert.ok(e.FILE_BUCKET.objects.has(snapshot.key), 'the snapshot must be in R2');
    assert.equal(snapshot.kvKeys, 2, 'gkDay plus userBank across the two seeded namespaces');

    const listed = await workerFetch(worker, withToken('https://worker/api/admin/backup', 'GET', 'admin-tok'), e);
    const body = await listed.json();
    assert.equal(body.count, 1);
    assert.equal(body.snapshots[0].key, snapshot.key);
  });

  test(`p19b-৫ (${name}): a restore writes the snapshot back and names what it touched`, async () => {
    const e = env();
    const made = await workerFetch(worker, withToken('https://worker/api/admin/backup', 'POST', 'admin-tok'), e);
    const { snapshot } = await made.json();
    await e.GK_KV.put('gkDay', 'corrupted-after-backup');

    const res = await workerFetch(worker, new Request('https://worker/api/admin/restore', {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: snapshot.key }),
    }), e);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.restored, 2);
    assert.equal(e.GK_KV.store.get('gkDay'), '2026-10-11', 'the restored value must come from the snapshot');
  });

  test(`p19b-৬ (${name}): a restore without a key is refused, not guessed`, async () => {
    const res = await workerFetch(worker, new Request('https://worker/api/admin/restore', {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }), env());
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'key-required');
  });

  test(`p19b-৭ (${name}): a snapshot with no bucket is an honest 500, not a fake ok`, async () => {
    const res = await workerFetch(worker, withToken('https://worker/api/admin/backup', 'POST', 'admin-tok'), env({ FILE_BUCKET: undefined }));
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, 'no-backup-bucket');
  });

  test(`p19b-৮ (${name}): an unknown snapshot key is a 404`, async () => {
    const res = await workerFetch(worker, new Request('https://worker/api/admin/restore', {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'backups/missing.json' }),
    }), env());
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'snapshot-not-found');
  });
}
