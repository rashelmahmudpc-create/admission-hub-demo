/* Legacy (pre-account) record adoption — correctness + safety.
 *
 * The owner reported "my data is gone" after signing in: rows written before
 * per-account scoping were hidden by fromScopedRecord() and the app re-seeded
 * defaults, which looked like a wipe. Owner approved a one-time adoption.
 *
 * These tests drive the real module with in-memory stores, so they assert the
 * actual behaviour: in-place relabelling, no overwrite, no cross-account leak,
 * idempotency and retry-after-failure. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('./legacy-adoption.js', import.meta.url), 'utf8');

function loadModule() {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'legacy-adoption.js' });
  return sandbox.window.AHLegacyAdoption;
}

/* A faithful stand-in for one IndexedDB store: rows keyed by their `id`. */
function makeStore(rows = []) {
  const map = new Map(rows.map(r => [String(r.id), { ...r }]));
  return {
    map,
    rows: () => [...map.values()],
    scan: () => [...map.values()].map(r => ({ ...r })),
    write: ops => {
      for (const op of ops) { map.delete(op.from); map.set(String(op.doc.id), { ...op.doc }); }
    }
  };
}

function makeFlagStore() {
  const map = new Map();
  return { map, read: k => map.get(k) || null, write: (k, v) => map.set(k, v) };
}

const deps = (scope, stores, flagStore, overrides = {}) => ({
  scope,
  stores: Object.keys(stores),
  scanStore: s => stores[s].scan(),
  writeStore: (s, ops) => stores[s].write(ops),
  flagStore,
  log: () => {},
  warn: () => {},
  ...overrides
});

test('legacy rows are relabelled in place and become visible to the account', () => {
  const mod = loadModule();
  const stores = { mistakes: makeStore([{ id: 'm1', word: 'apple' }, { id: 'm2', word: 'banana' }]) };
  const report = mod.planStore(stores.mistakes.scan(), 'userA');
  assert.equal(report.ops.length, 2, 'both unscoped rows are eligible');
  assert.equal(report.ops[0].to, 'userA::m1');
  assert.equal(report.ops[0].doc.__ahOwner, 'userA');
  assert.equal(report.ops[0].doc.__ahId, 'm1');
  assert.equal(report.ops[0].doc.word, 'apple', 'payload preserved');
});

test('the account\'s own rows are never overwritten by a legacy row', async () => {
  const mod = loadModule();
  const stores = {
    mistakes: makeStore([
      { id: 'm1', word: 'legacy', },                                   // unscoped
      { id: 'userA::m1', __ahOwner: 'userA', __ahId: 'm1', word: 'mine' } // account row, same bare id
    ])
  };
  const flag = makeFlagStore();
  const report = await mod.migrate(deps('userA', stores, flag));
  assert.equal(report.adopted, 0, 'conflicting legacy row is skipped, not merged');
  const row = stores.mistakes.map.get('userA::m1');
  assert.equal(row.word, 'mine', 'account data is untouched');
  assert.equal(stores.mistakes.map.has('m1'), true, 'legacy row is left alone for a future decision');
});

test('another account\'s rows are invisible and untouched', async () => {
  const mod = loadModule();
  const stores = {
    notes: makeStore([
      { id: 'userB::n1', __ahOwner: 'userB', __ahId: 'n1', text: 'B private' },
      { id: 'n2', text: 'pre-account' }
    ])
  };
  const flag = makeFlagStore();
  const report = await mod.migrate(deps('userA', stores, flag));
  assert.equal(report.adopted, 1, 'only the truly-unowned row is adopted');
  const b = stores.notes.map.get('userB::n1');
  assert.equal(b.__ahOwner, 'userB', 'B keeps ownership');
  assert.equal(stores.notes.map.has('userA::n2'), true);
  assert.equal(stores.notes.map.get('userA::n2').text, 'pre-account');
});

test('a row already scoped to this account is not re-adopted', async () => {
  const mod = loadModule();
  const stores = { settings: makeStore([{ id: 'userA::s1', __ahOwner: 'userA', __ahId: 's1', theme: 'dark' }]) };
  const flag = makeFlagStore();
  const report = await mod.migrate(deps('userA', stores, flag));
  assert.equal(report.adopted, 0);
  assert.deepEqual(stores.settings.map.get('userA::s1').theme, 'dark');
});

test('adoption is idempotent across sign-ins and never runs twice per account', async () => {
  const mod = loadModule();
  const stores = { exams: makeStore([{ id: 'e1', title: 'Mock' }]) };
  const flag = makeFlagStore();
  const first = await mod.migrate(deps('userA', stores, flag));
  assert.equal(first.adopted, 1);
  const second = await mod.migrate(deps('userA', stores, flag));
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'already-done');
  assert.equal(stores.exams.map.size, 1, 'no duplicate rows created');
});

test('total record count per store is preserved (nothing is lost)', async () => {
  const mod = loadModule();
  const stores = {
    vocabulary: makeStore([{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }]),
    mistakes: makeStore([{ id: 'm1' }])
  };
  const before = { vocabulary: stores.vocabulary.map.size, mistakes: stores.mistakes.map.size };
  await mod.migrate(deps('userA', stores, makeFlagStore()));
  assert.equal(stores.vocabulary.map.size, before.vocabulary, 'count unchanged');
  assert.equal(stores.mistakes.map.size, before.mistakes, 'count unchanged');
});

test('a store that fails to write is left unchanged and retried next sign-in', async () => {
  const mod = loadModule();
  const stores = { mistakes: makeStore([{ id: 'm1' }]) };
  const flag = makeFlagStore();
  let attempts = 0;
  const failing = deps('userA', stores, flag, {
    writeStore: (s, ops) => { attempts += 1; if (attempts === 1) throw new Error('quota'); stores[s].write(ops); }
  });
  const first = await mod.migrate(failing);
  assert.equal(first.done, false, 'not marked done after a failure');
  assert.equal(stores.mistakes.map.has('m1'), true, 'row not half-migrated');
  const second = await mod.migrate(deps('userA', stores, flag));
  assert.equal(second.adopted, 1, 'the retry succeeds');
  assert.equal(second.done, true);
});

test('a pre-adoption snapshot is taken before any relabelling', async () => {
  const mod = loadModule();
  const order = [];
  const stores = { mistakes: makeStore([{ id: 'm1' }]) };
  await mod.migrate(deps('userA', stores, makeFlagStore(), {
    snapshot: () => { order.push('snapshot'); },
    scanStore: s => { order.push('scan'); return stores[s].scan(); }
  }));
  assert.equal(order[0], 'snapshot', 'backup happens first, so a bad run is recoverable');
});

test('adopted rows are handed to the sync hook so the rescue reaches the cloud', async () => {
  const mod = loadModule();
  const stores = { mistakes: makeStore([{ id: 'm1', word: 'apple', updatedAt: 111 }, { id: 'm2' }]) };
  const seen = [];
  await mod.migrate(deps('userA', stores, makeFlagStore(), {
    onAdopted: (store, ops) => { for (const op of ops) seen.push([store, op.doc.__ahId, op.doc.word]); }
  }));
  assert.deepEqual(seen, [['mistakes', 'm1', 'apple'], ['mistakes', 'm2', undefined]],
    'each adopted row is reported with its store and bare id');
});

test('a failing sync hook does not abort or roll back adoption', async () => {
  const mod = loadModule();
  const stores = { mistakes: makeStore([{ id: 'm1' }]) };
  const report = await mod.migrate(deps('userA', stores, makeFlagStore(), {
    onAdopted: () => { throw new Error('offline'); }
  }));
  assert.equal(report.adopted, 1, 'the row is still adopted locally');
  assert.equal(report.done, true, 'and the run is considered complete');
  assert.equal(stores.mistakes.map.get('userA::m1').__ahOwner, 'userA');
});

test('a sign-out (no scope) never attempts adoption', async () => {
  const mod = loadModule();
  const stores = { mistakes: makeStore([{ id: 'm1' }]) };
  const report = await mod.migrate({ ...deps('', stores, makeFlagStore()) });
  assert.equal(report.skipped, true);
  assert.equal(report.reason, 'no-scope');
  assert.equal(stores.mistakes.map.has('m1'), true, 'signed-out data is untouched');
});

test('guests keep session-only memory rows; adoption only runs for a real account', () => {
  const html = readFileSync('index.html', 'utf8');
  assert.match(html, /legacy-adoption\.js\?v=legacy-v1/, 'module is loaded');
  const handler = html.slice(html.indexOf("addEventListener('admissionhub:authchange'"), html.indexOf("addEventListener('admissionhub:authchange'") + 1400);
  assert.match(handler, /adoptLegacyRecords\(next\)/, 'adoption runs on auth change');
  assert.match(html, /if\(!next\) MEMORY_DB\.forEach\(store=>store\.clear\(\)\)/, 'guest memory is cleared on sign-out');
});

test('raw scan/write helpers exist and are separate from the scoped API', () => {
  const html = readFileSync('index.html', 'utf8');
  assert.match(html, /function dbScanRaw\(store\)/, 'raw scan exists');
  assert.match(html, /function dbRelabelRaw\(store,ops\)/, 'raw relabel exists');
  assert.match(html, /dbScanRaw[\s\S]{0,400}getAll\(\)\)\.then\(rows=>\(rows\|\|\[\]\)\)/, 'raw scan returns untransformed rows');
});

test('the reachable API surface is exactly what the app calls', () => {
  const mod = loadModule();
  assert.deepEqual(Object.keys(mod).sort(), ['FLAG_PREFIX', 'isLegacy', 'migrate', 'planStore']);
  assert.equal(mod.isLegacy({ id: 'x' }), true);
  assert.equal(mod.isLegacy({ id: 'x', __ahOwner: 'u' }), false);
  assert.equal(mod.isLegacy(null), false);
});
