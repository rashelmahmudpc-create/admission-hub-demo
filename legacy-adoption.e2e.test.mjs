/* End-to-end: real IndexedDB (fake-indexeddb) + the app's real scoping
 * functions + the real adoption module. This is the closest we can get to a
 * device without a browser: rows written before scoping must become readable
 * by the signed-in account, with no row loss and no cross-account leak. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { indexedDB } from 'fake-indexeddb';

const HTML = readFileSync('index.html', 'utf8');
const ADOPT = readFileSync('legacy-adoption.js', 'utf8');
const DB_NAME = 'admissionHubPublicDB';
const STORES = ['mistakes', 'notes', 'settings'];

function scoping(scope) {
  const sandbox = { DATA_SCOPE: scope, console };
  vm.createContext(sandbox);
  const decls = HTML.split('\n')
    .filter(l => /const persistentDataScope=|const scopedRecordId=|const toScopedRecord=|const fromScopedRecord=/.test(l))
    .join('\n');
  return vm.runInContext(decls + ';({persistentDataScope,scopedRecordId,toScopedRecord,fromScopedRecord})', sandbox);
}

function loadAdoption() {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(ADOPT, sandbox, { filename: 'legacy-adoption.js' });
  return sandbox.window.AHLegacyAdoption;
}

/* Open the real object stores and seed rows exactly as the pre-scoping app did
 * (bare ids, no ownership metadata). */
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { for (const s of STORES) request.result.createObjectStore(s, { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const tx = (db, store, mode, work) => new Promise((resolve, reject) => {
  const t = db.transaction(store, mode);
  const req = work(t.objectStore(store));
  t.oncomplete = () => resolve(req && req.result);
  t.onerror = () => reject(t.error);
});

test('legacy rows in a real IndexedDB become visible to the account after adoption', async () => {
  const scope = 'RealUser123';
  const db = await openDb();
  const { scopedRecordId, fromScopedRecord } = scoping(scope);

  /* Pre-scoping state: bare ids, no owner. */
  await tx(db, 'mistakes', 'readwrite', s => { s.put({ id: 'm1', word: 'apple' }); s.put({ id: 'm2', word: 'pear' }); });
  await tx(db, 'notes', 'readwrite', s => s.put({ id: 'n1', text: 'hello' }));

  const countBefore = {};
  for (const st of STORES) countBefore[st] = (await tx(db, st, 'readonly', s => s.getAll())).length;

  /* Before adoption the account sees nothing — the "wipe" the owner reported. */
  const beforeVisible = (await tx(db, 'mistakes', 'readonly', s => s.getAll())).map(fromScopedRecord).filter(Boolean);
  assert.equal(beforeVisible.length, 0, 'unscoped rows are invisible before adoption');

  const mod = loadAdoption();
  const flag = { v: {}, read(k) { return this.v[k] || null; }, write(k, val) { this.v[k] = val; } };
  const report = await mod.migrate({
    scope,
    stores: STORES,
    scanStore: st => tx(db, st, 'readonly', s => s.getAll()),
    writeStore: (st, ops) => tx(db, st, 'readwrite', s => { for (const op of ops) { s.delete(op.from); s.put(op.doc); } }),
    flagStore: flag,
    log: () => {}, warn: () => {}
  });

  assert.equal(report.adopted, 3, 'two mistakes + one note adopted');

  const afterVisible = (await tx(db, 'mistakes', 'readonly', s => s.getAll())).map(fromScopedRecord).filter(Boolean);
  assert.deepEqual(afterVisible.map(r => r.word).sort(), ['apple', 'pear'], 'account now reads its rows');
  assert.equal(afterVisible[0].__ahOwner, undefined, 'metadata stripped on read');

  /* No row was lost: same number of physical rows per store. */
  for (const st of STORES) {
    const after = (await tx(db, st, 'readonly', s => s.getAll())).length;
    assert.equal(after, countBefore[st], `${st}: physical row count preserved`);
  }

  /* The primary key is the scoped id, and the bare-key row is gone. */
  const rawM1 = await tx(db, 'mistakes', 'readonly', s => s.get('m1'));
  const scopedM1 = await tx(db, 'mistakes', 'readonly', s => s.get(scopedRecordId('m1')));
  assert.equal(rawM1, undefined, 'bare-key row removed');
  assert.equal(scopedM1.__ahOwner, scope, 'scoped row present with owner');

  /* Idempotent: a second sign-in adopts nothing. */
  const again = await mod.migrate({
    scope, stores: STORES,
    scanStore: st => tx(db, st, 'readonly', s => s.getAll()),
    writeStore: (st, ops) => tx(db, st, 'readwrite', s => { for (const op of ops) { s.delete(op.from); s.put(op.doc); } }),
    flagStore: flag, log: () => {}, warn: () => {}
  });
  assert.equal(again.skipped, true);
  db.close();
});

test('a second account signing in on the same device never sees the first', async () => {
  const db = await openDb();
  const A = 'AccountAAAA1';
  const B = 'AccountBBBB2';
  const mod = loadAdoption();

  await tx(db, 'notes', 'readwrite', s => { s.put({ id: 'shared', text: 'pre-account note' }); });
  const flag = { v: {}, read(k) { return this.v[k] || null; }, write(k, val) { this.v[k] = val; } };
  const io = scope => ({
    scope, stores: ['notes'],
    scanStore: st => tx(db, st, 'readonly', s => s.getAll()),
    writeStore: (st, ops) => tx(db, st, 'readwrite', s => { for (const op of ops) { s.delete(op.from); s.put(op.doc); } }),
    flagStore: flag, log: () => {}, warn: () => {}
  });

  await mod.migrate(io(A));                       // A adopts the pre-account note
  await mod.migrate(io(B));                       // B signs in afterwards

  const rows = await tx(db, 'notes', 'readonly', s => s.getAll());
  const fromA = rows.map(scoping(A).fromScopedRecord).filter(Boolean);
  const fromB = rows.map(scoping(B).fromScopedRecord).filter(Boolean);
  assert.equal(fromA.length, 1, 'A sees the adopted note');
  assert.equal(fromB.length, 0, 'B sees nothing of A\'s');

  /* B\'s data is not overwritten if B later writes the same bare id. */
  await tx(db, 'notes', 'readwrite', s => s.put(scoping(B).toScopedRecord({ id: 'shared', text: 'B own note' })));
  const rows2 = await tx(db, 'notes', 'readonly', s => s.getAll());
  assert.equal(rows2.map(scoping(A).fromScopedRecord).filter(Boolean)[0].text, 'pre-account note', 'A keeps its row');
  assert.equal(rows2.map(scoping(B).fromScopedRecord).filter(Boolean)[0].text, 'B own note', 'B keeps its own row');
  db.close();
});
