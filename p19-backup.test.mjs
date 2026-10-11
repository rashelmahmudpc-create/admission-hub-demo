import test from 'node:test';
import assert from 'node:assert/strict';
import {
  redactSnapshot, redactKvValue, snapshotName, makeIndexEntry, appendIndex,
  planRestore, collectSnapshot, createSnapshot, listSnapshots, restoreSnapshot,
  BACKUP_PREFIX, BACKUP_INDEX_KEY, MAX_INDEX, KV_BINDINGS,
} from './p19-backup.mjs';

/* Minimal in-memory stand-ins for the real bindings. They follow the KV, D1 and
 * R2 contracts the module actually calls (list/get/put, prepare().all(), and
 * get/put on the bucket), so the real code path runs unmodified. */
function kv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    async list({ cursor } = {}) {
      const names = [...store.keys()];
      const start = cursor ? Number(cursor) : 0;
      const page = names.slice(start, start + 2);
      const next = start + 2;
      return { keys: page.map(name => ({ name })), list_complete: next >= names.length, cursor: String(next) };
    },
  };
}

function d1(tables = {}) {
  return {
    prepare(sql) {
      if (/sqlite_master/i.test(sql)) {
        return { async all() { return { results: Object.keys(tables).map(name => ({ name })) }; } };
      }
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

function envWith(overrides = {}) {
  return { GK_KV: kv(), PUB_KV: kv(), OLD_KV: kv(), PROFILE_DB: d1(), FILE_BUCKET: r2(), ...overrides };
}

test('redactSnapshot replaces a token-shaped string with [REDACTED]', () => {
  const out = redactSnapshot({ note: 'token ghp_ABCDEFGH12345678 here' });
  assert.ok(!out.note.includes('ghp_'), 'the token must not survive redaction');
  assert.ok(out.note.includes('[REDACTED]'), 'it must be replaced, not dropped');
});

test('redactSnapshot walks nested objects and arrays without mutating the input', () => {
  const input = { a: [{ k: 'sk-ABCDEFGH1234' }], b: { c: 'AIzaSy0123456789' } };
  const out = redactSnapshot(input);
  assert.ok(!JSON.stringify(out).includes('sk-ABCDEFGH1234'));
  assert.ok(!JSON.stringify(out).includes('AIzaSy0123456789'));
  assert.equal(input.a[0].k, 'sk-ABCDEFGH1234', 'the input must be untouched');
});

test('redactKvValue keeps JSON as JSON and a plain string as a string', () => {
  assert.deepEqual(redactKvValue('{"n":1}'), { n: 1 });
  assert.equal(redactKvValue('hello'), 'hello');
  assert.equal(redactKvValue(null), null);
});

test('snapshotName is sortable and lives under the backup prefix', () => {
  const name = snapshotName(Date.UTC(2026, 9, 11, 19, 20, 0));
  assert.ok(name.startsWith(BACKUP_PREFIX));
  assert.ok(name.endsWith('.json'));
  assert.ok(!name.includes(':'), 'colons break R2 tooling; they must be replaced');
});

test('appendIndex keeps the newest first and is bounded by MAX_INDEX', () => {
  let index = [];
  for (let i = 0; i < MAX_INDEX + 5; i++) {
    index = appendIndex(index, makeIndexEntry({ key: `backups/${i}.json`, at: 1000 + i }));
  }
  assert.equal(index.length, MAX_INDEX, 'the index must stay bounded');
  assert.equal(index[0].at, 1000 + MAX_INDEX + 4, 'the newest entry must be first');
});

test('appendIndex does not duplicate a key when the same snapshot is re-indexed', () => {
  const e = makeIndexEntry({ key: 'backups/a.json', at: 5 });
  const index = appendIndex(appendIndex([], e), { ...e, at: 6 });
  assert.equal(index.length, 1);
  assert.equal(index[0].at, 6);
});

test('planRestore lists exactly the keys a snapshot would write', () => {
  const plan = planRestore({ kv: { GK_KV: { a: 1, b: 2 }, PUB_KV: { c: 3 } } });
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.filter(p => p.binding === 'GK_KV').map(p => p.key).sort(), ['a', 'b']);
});

test('collectSnapshot reads every KV namespace and every D1 table', async () => {
  const env = envWith({
    GK_KV: kv({ gkDay: '2026-10-11', mem: '{"x":1}' }),
    PUB_KV: kv({ pubContent: '{"v":1}' }),
    OLD_KV: kv({ userBank: '{"full":{}}' }),
    PROFILE_DB: d1({ profiles: [{ id: 'u1' }], avatars: [{ id: 'a1' }, { id: 'a2' }] }),
  });
  const snap = await collectSnapshot(env, { now: () => 1_700_000_000_000 });
  assert.equal(snap.kv.GK_KV.gkDay, '2026-10-11');
  assert.deepEqual(snap.kv.PUB_KV.pubContent, { v: 1 }, 'stored JSON must come back parsed');
  assert.equal(snap.d1.profiles.length, 1);
  assert.equal(snap.d1.avatars.length, 2);
  assert.equal(snap.at, 1_700_000_000_000);
});

test('collectSnapshot redacts secrets inside KV values', async () => {
  const env = envWith({ GK_KV: kv({ leak: 'key=ghp_ABCDEFGH12345678' }) });
  const snap = await collectSnapshot(env, { now: () => 1 });
  assert.ok(!JSON.stringify(snap).includes('ghp_ABCDEFGH12345678'));
});

test('collectSnapshot follows the KV cursor past one page', async () => {
  const many = {}; for (let i = 0; i < 5; i++) many[`k${i}`] = String(i);
  const snap = await collectSnapshot(envWith({ GK_KV: kv(many) }), { now: () => 1 });
  assert.equal(Object.keys(snap.kv.GK_KV).length, 5, 'all keys, not just the first page');
});

test('collectSnapshot records a note for an absent binding instead of throwing', async () => {
  const snap = await collectSnapshot({ PUB_KV: kv() }, { now: () => 1 });
  assert.ok(snap.notes.some(n => n.startsWith('GK_KV:absent')));
  assert.ok(snap.notes.some(n => n.startsWith('d1:absent')));
});

test('createSnapshot stores the snapshot in R2 and records it in the index', async () => {
  const bucket = r2();
  const pub = kv();
  const env = envWith({ FILE_BUCKET: bucket, PUB_KV: pub, GK_KV: kv({ gkDay: '2026-10-11' }) });
  const entry = await createSnapshot(env, { now: () => 1_700_000_000_000 });
  assert.ok(bucket.objects.has(entry.key), 'the snapshot must be in R2');
  assert.equal(entry.kvKeys, 1);
  assert.ok(entry.bytes > 0);
  const listed = await listSnapshots(env);
  assert.equal(listed.count, 1);
  assert.equal(listed.snapshots[0].key, entry.key);
});

test('createSnapshot refuses to pretend when there is no bucket', async () => {
  await assert.rejects(() => createSnapshot({ PUB_KV: kv() }), /no-backup-bucket/);
});

test('restoreSnapshot writes the snapshot keys back into KV', async () => {
  const gk = kv({ gkDay: 'wrong' });
  const env = envWith({ GK_KV: gk, PUB_KV: kv() });
  const entry = await createSnapshot(env, { now: () => 1 });
  await gk.put('gkDay', 'changed-after-backup');
  const result = await restoreSnapshot(env, entry.key);
  assert.equal(result.ok, true);
  assert.equal(gk.store.get('gkDay'), 'wrong', 'the restored value must come from the snapshot');
  assert.equal(result.restored, 1);
});

test('restoreSnapshot never deletes a key that is absent from the snapshot', async () => {
  const gk = kv({ a: '1' });
  const env = envWith({ GK_KV: gk, PUB_KV: kv() });
  const entry = await createSnapshot(env, { now: () => 1 });
  await gk.put('added-after-backup', 'keep-me');
  await restoreSnapshot(env, entry.key);
  assert.equal(gk.store.get('added-after-backup'), 'keep-me', 'a restore must not be a wipe');
});

test('restoreSnapshot reports a missing snapshot instead of throwing', async () => {
  const result = await restoreSnapshot(envWith(), `${BACKUP_PREFIX}nope.json`);
  assert.deepEqual(result, { ok: false, error: 'snapshot-not-found' });
});

test('listSnapshots reports an empty index honestly', async () => {
  const listed = await listSnapshots(envWith());
  assert.deepEqual(listed, { ok: true, count: 0, snapshots: [] });
});

test('the index key and the covered bindings are the documented ones', () => {
  assert.equal(BACKUP_INDEX_KEY, 'backup:index:v1');
  assert.deepEqual(KV_BINDINGS, ['GK_KV', 'PUB_KV', 'OLD_KV']);
});
