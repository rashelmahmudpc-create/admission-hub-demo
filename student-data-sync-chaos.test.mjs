/* Student data sync — chaos / resilience tests (Phase H).
 *
 * The happy paths live in student-data-sync.test.mjs. These tests attack the
 * engine with the situations that actually lose data in the field:
 * partial acks, auth loss mid-batch, writes that race an in-flight flush,
 * paginated pulls, account switches, and a queue under pressure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const lsStore = new Map();
globalThis.localStorage = {
  getItem: k => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => { lsStore.set(k, String(v)); },
  removeItem: k => { lsStore.delete(k); },
  clear: () => lsStore.clear()
};
if (typeof globalThis.CustomEvent !== 'function') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, init = {}) { super(type); this.detail = init.detail; }
  };
}
try { Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true }); } catch { /* node default */ }

const win = new EventTarget();
globalThis.window = win;

const localRows = new Map();
const localKey = (store, id) => store + '\u0000' + String(id);
win.dbGetAll = async store => [...localRows.values()].filter(r => r.__store === store).map(({ __store, ...r }) => r);
win.dbPut = async (store, doc) => { localRows.set(localKey(store, doc.id), { ...doc, __store: store }); return doc; };
win.dbDel = async (store, id) => { localRows.delete(localKey(store, id)); return true; };

let responder = () => ({ status: 200, body: { ok: true, results: [] } });
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const record = { url: String(url), init, body: init.body ? JSON.parse(init.body) : null };
  calls.push(record);
  const out = await responder(record) || {};
  const status = out.status ?? 200;
  return { status, ok: status >= 200 && status < 300, async json() { return out.body ?? {}; } };
};

await import('./student-data-sync.js?chaos=' + Date.now());
const sync = globalThis.window.AHStudentSync;

const tick = (ms = 25) => new Promise(r => setTimeout(r, ms));
const write = (store, id, doc, updatedAt) => win.dispatchEvent(new CustomEvent('admissionhub:local-write', {
  detail: { store, id, doc, op: 'put', updated_at: updatedAt }
}));

const reset = () => {
  sync.deactivate();
  lsStore.clear();
  localRows.clear();
  calls.length = 0;
  responder = () => ({ status: 200, body: { ok: true, results: [] } });
};

/* ── partial acks and auth loss ─────────────────────────────────────────── */

test('chaos: an op the server never acknowledged is kept, not dropped', async () => {
  reset();
  sync.activate('user_alpha');
  await tick();
  /* Server accepts n1 but says nothing about n2 — n2 must not vanish. */
  responder = rec => ({
    status: 200,
    body: { ok: true, results: (rec.body?.ops || []).filter(o => o.id === 'n1').map(o => ({ ok: true, applied: true, store: o.store, id: o.id, updated_at: o.updated_at })) }
  });
  write('notes', 'n1', { id: 'n1' }, 1);
  write('notes', 'n2', { id: 'n2' }, 2);
  await sync.flush();
  const pendingIds = calls.length ? sync.status().pending : -1;
  assert.equal(pendingIds, 1, 'the unacked op stays queued for a retry');
});

test('chaos: 401 mid-flush preserves the ops that were not sent', async () => {
  reset();
  sync.activate('user_alpha');
  await tick();
  responder = () => ({ status: 401, body: { error: 'auth-required' } });
  for (let i = 0; i < 5; i += 1) write('notes', 'n' + i, { id: 'n' + i }, i);
  await sync.flush();
  assert.equal(sync.status().active, false, 'the session is treated as gone');
  assert.equal(sync.status().pending, 5, 'every unsent op is still queued');
});

/* ── the in-flight race: a write during flush must survive ──────────────── */

test('chaos: a newer write racing an in-flight flush is never lost', async () => {
  reset();
  sync.activate('user_alpha');
  await tick();

  let release;
  const gate = new Promise(r => { release = r; });
  responder = async rec => {
    await gate; /* hold the request open while we write a newer version */
    return { status: 200, body: { ok: true, results: (rec.body?.ops || []).map(o => ({ ok: true, applied: true, store: o.store, id: o.id, updated_at: o.updated_at })) } };
  };

  write('notes', 'n1', { id: 'n1', body: 'v1' }, 100);
  const inflight = sync.flush();
  await tick(5);
  /* Same record edited again while the first request is still open. */
  write('notes', 'n1', { id: 'n1', body: 'v2' }, 200);
  release();
  await inflight;
  await tick(10);

  assert.equal(sync.status().pending, 1, 'the newer edit is still queued');

  calls.length = 0;
  responder = rec => ({ status: 200, body: { ok: true, results: (rec.body?.ops || []).map(o => ({ ok: true, applied: true, store: o.store, id: o.id, updated_at: o.updated_at })) } });
  await sync.flush();
  const last = calls.at(-1);
  assert.equal(last.body.ops.length, 1, 'the newer edit is pushed next');
  assert.equal(last.body.ops[0].updated_at, 200, 'and it carries the newer timestamp');
});

/* ── pull pagination and idempotency ────────────────────────────────────── */

test('chaos: pull follows the cursor across pages and stops at hasMore=false', async () => {
  reset();
  sync.activate('user_alpha');
  await tick();
  const seen = [];
  responder = rec => {
    if (!rec.url.includes('/api/userdata/pull')) return { status: 200, body: { ok: true, items: [], cursor: '', hasMore: false } };
    const store = new URL('https://x.test' + rec.url).searchParams.get('store');
    const cursor = new URL('https://x.test' + rec.url).searchParams.get('cursor') || '';
    if (store !== 'notes') return { status: 200, body: { ok: true, store, items: [], cursor, hasMore: false } };
    seen.push(cursor);
    if (cursor === '') return { status: 200, body: { ok: true, store, cursor: 'p1', hasMore: true, items: [{ id: 'n1', updated_at: 1, deleted: false, doc: { id: 'n1' } }] } };
    if (cursor === 'p1') return { status: 200, body: { ok: true, store, cursor: 'p2', hasMore: true, items: [{ id: 'n2', updated_at: 2, deleted: false, doc: { id: 'n2' } }] } };
    return { status: 200, body: { ok: true, store, cursor: 'p2', hasMore: false, items: [{ id: 'n3', updated_at: 3, deleted: false, doc: { id: 'n3' } }] } };
  };
  await sync.pull();
  assert.deepEqual(seen, ['', 'p1', 'p2'], 'each page was requested once, in order');
  for (const id of ['n1', 'n2', 'n3']) assert.ok(localRows.has(localKey('notes', id)), `${id} landed locally`);
});

test('chaos: a server that never says hasMore=false cannot loop forever', async () => {
  reset();
  sync.activate('user_alpha');
  await tick(60);
  const perStore = new Map();
  responder = rec => {
    if (!rec.url.includes('/api/userdata/pull')) return { status: 200, body: { ok: true, items: [], cursor: '', hasMore: false } };
    const store = new URL('https://x.test' + rec.url).searchParams.get('store');
    const n = (perStore.get(store) || 0) + 1;
    perStore.set(store, n);
    return { status: 200, body: { ok: true, store, cursor: 'c' + n, hasMore: true, items: [{ id: 'n' + n, updated_at: n, deleted: false, doc: { id: 'n' + n } }] } };
  };
  await sync.pull();
  for (const [store, n] of perStore) assert.ok(n <= 50, `${store} was paginated at most 50 times (asked ${n})`);
});

test('chaos: pulling the same page twice converges, does not duplicate', async () => {
  reset();
  sync.activate('user_alpha');
  await tick();
  responder = rec => {
    if (!rec.url.includes('/api/userdata/pull')) return { status: 200, body: { ok: true, items: [], cursor: '', hasMore: false } };
    const cursor = new URL('https://x.test' + rec.url).searchParams.get('cursor') || '';
    const store = new URL('https://x.test' + rec.url).searchParams.get('store');
    if (store !== 'mistakes') return { status: 200, body: { ok: true, store, items: [], cursor, hasMore: false } };
    /* Always re-serve the same row. */
    return { status: 200, body: { ok: true, store, cursor, hasMore: false, items: [{ id: 'm1', updated_at: 5, deleted: false, doc: { id: 'm1', questionId: 'q1' } }] } };
  };
  await sync.pull();
  await sync.pull();
  const row = localRows.get(localKey('mistakes', 'm1'));
  assert.equal(row.questionId, 'q1', 'the row is applied idempotently');
  assert.equal([...localRows.values()].filter(r => r.id === 'm1').length, 1, 'and never duplicated');
});

/* ── account isolation under churn ──────────────────────────────────────── */

test('chaos: a rapid account switch never leaks one account\'s ops to another', async () => {
  reset();
  sync.activate('user_alpha');
  await tick();
  write('notes', 'a1', { id: 'a1' }, 1);
  assert.equal(sync.status().pending, 1);

  /* Sign out and straight into another account. */
  sync.deactivate();
  sync.activate('user_beta');
  await tick(40);

  const pushed = calls.filter(c => c.url.endsWith('/api/userdata/sync')).flatMap(c => c.body.ops);
  assert.ok(!pushed.some(o => o.id === 'a1'), 'alpha\'s op is never sent for beta');
  assert.equal(sync.status().pending, 0, 'beta starts with a clean queue');
});

test('chaos: an op for an unknown store is dropped, not sent', async () => {
  reset();
  sync.activate('user_alpha');
  await tick(60);
  write('notes', 'n1', { id: 'n1' }, 1);
  write('not_a_store', 'x1', { id: 'x1' }, 1);
  responder = rec => ({ status: 200, body: { ok: true, results: (rec.body?.ops || []).map(o => ({ ok: true, applied: true, store: o.store, id: o.id, updated_at: o.updated_at })) } });
  await sync.flush();
  const pushed = calls.filter(c => c.url.endsWith('/api/userdata/sync')).flatMap(c => c.body.ops);
  assert.ok(!pushed.some(o => o.store === 'not_a_store'), 'the unknown store never reaches the server');
  assert.equal(sync.status().pending, 0, 'and the queue drains');
});

/* ── queue pressure ─────────────────────────────────────────────────────── */

test('chaos: queue overflow drops the oldest ops, loudly, and keeps the newest', async () => {
  reset();
  sync.activate('user_alpha');
  await tick();
  const warn = console.warn;
  let warned = 0;
  console.warn = (...args) => { if (String(args[0]).includes('overflow')) warned += 1; };
  try {
    for (let i = 0; i < 5100; i += 1) write('notes', 'n' + i, { id: 'n' + i }, i);
  } finally { console.warn = warn; }
  assert.equal(sync.status().pending, 5000, 'the queue is capped at its limit');
  assert.ok(warned >= 1, 'the drop was announced, not silent');
  assert.equal(lsStore.size > 0, true, 'the queue was persisted');
});

/* ── network failure during flush ───────────────────────────────────────── */

test('chaos: a thrown network error pauses the flush and keeps every op', async () => {
  reset();
  sync.activate('user_alpha');
  await tick();
  responder = () => { throw new Error('network down'); };
  write('notes', 'n1', { id: 'n1' }, 1);
  write('notes', 'n2', { id: 'n2' }, 2);
  await sync.flush();
  assert.equal(sync.status().pending, 2, 'both ops survive');
  assert.equal(sync.status().lastError, 'network', 'the failure is recorded');
});

test('chaos: pull is skipped while offline and resumes when back online', async () => {
  reset();
  sync.activate('user_alpha');
  await tick(60); /* let activation's own migrate/pull/flush settle first */
  calls.length = 0;
  sync.setOnline(false);
  const skipped = await sync.pull();
  assert.equal(skipped.skipped, true, 'no pull while offline');
  responder = rec => ({ status: 200, body: rec.url.includes('/api/userdata/pull') ? { ok: true, store: 'notes', cursor: '', hasMore: false, items: [] } : { ok: true, results: [] } });
  sync.setOnline(true); /* reconnect triggers a pull on its own */
  await tick(40);
  assert.ok(calls.some(c => c.url.includes('/api/userdata/pull')), 'pull resumed when online');
});
