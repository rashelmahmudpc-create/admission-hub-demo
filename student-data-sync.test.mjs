/* Student data sync — client engine tests.
 *
 * The engine must never lose a write, never block the UI, and never let one
 * account inherit another account's queue. These tests exercise those
 * guarantees against a fetch double. */
import test from 'node:test';
import assert from 'node:assert/strict';

/* ── minimal browser environment ───────────────────────────────────────── */
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
try { Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true }); } catch { /* keep node default */ }

const win = new EventTarget();
globalThis.window = win;

/* Local IDB-ish stub the engine pulls into. */
const localRows = new Map();
const localKey = (store, id) => store + '\u0000' + String(id);
win.dbGetAll = async store => [...localRows.values()].filter(r => r.__store === store).map(({ __store, ...r }) => r);
win.dbPut = async (store, doc) => { localRows.set(localKey(store, doc.id), { ...doc, __store: store }); return doc; };
win.dbDel = async (store, id) => { localRows.delete(localKey(store, id)); return true; };

/* fetch double: records calls, answers from a per-test responder. */
let responder = () => ({ status: 200, body: { ok: true, results: [] } });
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const record = { url: String(url), init, body: init.body ? JSON.parse(init.body) : null };
  calls.push(record);
  const out = responder(record) || {};
  const status = out.status ?? 200;
  return { status, ok: status >= 200 && status < 300, async json() { return out.body ?? {}; } };
};

/* Import once; the IIFE registers listeners on `win`. */
await import('./student-data-sync.js?t=' + Date.now());
const sync = globalThis.window.AHStudentSync;

const tick = (ms = 25) => new Promise(r => setTimeout(r, ms));
const write = (store, id, doc, updatedAt) => win.dispatchEvent(new CustomEvent('admissionhub:local-write', {
  detail: { store, id, doc, op: 'put', updated_at: updatedAt }
}));
const del = (store, id, updatedAt) => win.dispatchEvent(new CustomEvent('admissionhub:local-write', {
  detail: { store, id, op: 'delete', updated_at: updatedAt }
}));
const auth = id => win.dispatchEvent(new CustomEvent('admissionhub:authchange', {
  detail: { authenticated: true, user: { id } }
}));

const reset = () => {
  sync.deactivate();
  lsStore.clear();
  localRows.clear();
  calls.length = 0;
  responder = () => ({ status: 200, body: { ok: true, results: [] } });
};

test('sync: writes are only mirrored for a verified account', async () => {
  reset();
  write('notes', 'n1', { id: 'n1', body: 'a' }, 1000);
  assert.equal(sync.status().pending, 0, 'nothing queued while signed out');

  sync.activate('user_alpha');
  await tick();
  calls.length = 0;
  write('notes', 'n2', { id: 'n2', body: 'b' }, 2000);
  assert.equal(sync.status().pending, 1);
});

test('sync: a local write is pushed once and the queue drains', async () => {
  reset();
  sync.activate('user_alpha');
  await tick();
  calls.length = 0;
  responder = rec => ({
    status: 200,
    body: {
      ok: true,
      results: (rec.body?.ops || []).map(o => ({ ok: true, applied: true, store: o.store, id: o.id, updated_at: o.updated_at }))
    }
  });
  write('mistakes', 'm1', { id: 'm1', questionId: 'q1' }, 3000);
  const out = await sync.flush();
  assert.equal(out.sent, 1);
  const push = calls.filter(c => c.url.endsWith('/api/userdata/sync')).pop();
  assert.ok(push, 'a sync request was sent');
  assert.equal(push.body.ops.length, 1);
  assert.equal(push.body.ops[0].store, 'mistakes');
  assert.ok(push.body.device, 'a device id is sent for diagnostics');
  assert.equal(sync.status().pending, 0, 'queue drained after ack');
});

test('sync: the request body never carries a user id', async () => {
  reset();
  sync.activate('user_alpha');
  await tick();
  calls.length = 0;
  responder = rec => ({ status: 200, body: { ok: true, results: (rec.body?.ops || []).map(o => ({ ok: true, applied: true, store: o.store, id: o.id, updated_at: o.updated_at })) } });
  write('notes', 'n1', { id: 'n1' }, 1);
  await sync.flush();
  const push = calls.find(c => c.url.endsWith('/api/userdata/sync'));
  assert.ok(!('user_id' in push.body) && !('userId' in push.body), 'identity is server-derived');
  assert.ok(!JSON.stringify(push.body).includes('user_alpha'), 'scope id is not leaked in the payload');
});

test('sync: repeated edits to one record coalesce into a single op', async () => {
  reset();
  sync.activate('user_alpha');
  await tick();
  write('notes', 'n1', { id: 'n1', body: 'v1' }, 1);
  write('notes', 'n1', { id: 'n1', body: 'v2' }, 2);
  write('notes', 'n1', { id: 'n1', body: 'v3' }, 3);
  assert.equal(sync.status().pending, 1, 'one op for one record');
});

test('sync: offline writes are retained and flushed when the network returns', async () => {
  reset();
  sync.activate('user_alpha');
  await tick();
  sync.setOnline(false);
  write('notes', 'n1', { id: 'n1' }, 1);
  const skipped = await sync.flush();
  assert.equal(skipped.skipped, true);
  assert.equal(sync.status().pending, 1, 'the write is safe locally');
  calls.length = 0;
  responder = rec => ({ status: 200, body: { ok: true, results: (rec.body?.ops || []).map(o => ({ ok: true, applied: true, store: o.store, id: o.id, updated_at: o.updated_at })) } });
  sync.setOnline(true);
  await tick(40);
  assert.equal(sync.status().pending, 0, 'queue drained after reconnect');
});

test('sync: a 401 stops syncing instead of retrying forever', async () => {
  reset();
  sync.activate('user_alpha');
  await tick();
  responder = () => ({ status: 401, body: { error: 'auth-required' } });
  write('notes', 'n1', { id: 'n1' }, 1);
  await sync.flush();
  assert.equal(sync.status().active, false, 'the session is treated as gone');
  assert.equal(sync.status().pending, 1, 'the op is kept, not dropped');
});

test('sync: signing out clears the queue so another account cannot inherit it', async () => {
  reset();
  sync.activate('user_alpha');
  await tick();
  write('notes', 'n1', { id: 'n1' }, 1);
  assert.equal(sync.status().pending, 1);
  sync.deactivate();
  assert.equal(sync.status().pending, 0);
});

test('sync: a newer server row wins and the client adopts it', async () => {
  reset();
  sync.activate('user_alpha');
  await tick();
  localRows.set(localKey('notes', 'n1'), { id: 'n1', body: 'mine', updatedAt: 100, __store: 'notes' });
  responder = () => ({ status: 200, body: { ok: true, results: [{ ok: true, applied: false, store: 'notes', id: 'n1', updated_at: 999, deleted: false }] } });
  write('notes', 'n1', { id: 'n1', body: 'mine' }, 100);
  await sync.flush();
  assert.equal(sync.status().pending, 0, 'the losing op is not retried');
});

test('sync: pull applies server rows and tombstones locally', async () => {
  reset();
  sync.activate('user_alpha');
  await tick();
  localRows.set(localKey('mistakes', 'm2'), { id: 'm2', questionId: 'q2', __store: 'mistakes' });
  responder = rec => {
    if (rec.url.includes('/api/userdata/pull') && rec.url.includes('store=mistakes')) {
      return {
        status: 200,
        body: {
          ok: true,
          store: 'mistakes',
          cursor: 'm1',
          hasMore: false,
          items: [
            { id: 'm1', updated_at: 10, deleted: false, doc: { id: 'm1', questionId: 'q1' } },
            { id: 'm2', updated_at: 11, deleted: true, doc: null }
          ]
        }
      };
    }
    return { status: 200, body: { ok: true, items: [], cursor: '', hasMore: false } };
  };
  await sync.pull();
  assert.ok(localRows.has(localKey('mistakes', 'm1')), 'a server row landed locally');
  assert.ok(!localRows.has(localKey('mistakes', 'm2')), 'a server tombstone removed the local row');
});

test('sync: first-run migration uploads existing local rows once per account', async () => {
  reset();
  localRows.set(localKey('notes', 'n1'), { id: 'n1', body: 'old', __store: 'notes' });
  responder = rec => ({ status: 200, body: { ok: true, results: (rec.body?.ops || []).map(o => ({ ok: true, applied: true, store: o.store, id: o.id, updated_at: o.updated_at })) } });
  sync.activate('user_alpha');
  await tick(60);
  const pushed = calls.filter(c => c.url.endsWith('/api/userdata/sync')).flatMap(c => c.body.ops);
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].store, 'notes');
  /* A second activation must not re-upload. */
  calls.length = 0;
  sync.deactivate();
  auth('user_alpha');
  await tick(60);
  const again = calls.filter(c => c.url.endsWith('/api/userdata/sync')).flatMap(c => c.body.ops);
  assert.equal(again.length, 0, 'migration is not repeated');
});

test('sync: pull emits one sync-applied signal, not one per row', async () => {
  reset();
  sync.activate('user_alpha');
  await tick();
  let signals = 0;
  win.addEventListener('admissionhub:sync-applied', () => { signals += 1; });
  responder = rec => {
    if (rec.url.includes('/api/userdata/pull') && rec.url.includes('store=notes')) {
      return { status: 200, body: { ok: true, store: 'notes', cursor: 'n2', hasMore: false, items: [
        { id: 'n1', updated_at: 1, deleted: false, doc: { id: 'n1' } },
        { id: 'n2', updated_at: 2, deleted: false, doc: { id: 'n2' } }
      ] } };
    }
    return { status: 200, body: { ok: true, items: [], cursor: '', hasMore: false } };
  };
  await sync.pull();
  assert.equal(signals, 1, 'one debounced signal for the whole pull');
});

test('sync: pulled rows are written without a mirroring event', async () => {
  reset();
  sync.activate('user_alpha');
  await tick();
  const mirrored = [];
  win.addEventListener('admissionhub:local-write', e => mirrored.push(e.detail));
  responder = rec => {
    if (rec.url.includes('/api/userdata/pull') && rec.url.includes('store=mistakes')) {
      return { status: 200, body: { ok: true, store: 'mistakes', cursor: 'm1', hasMore: false, items: [
        { id: 'm1', updated_at: 1, deleted: false, doc: { id: 'm1', questionId: 'q1' } }
      ] } };
    }
    return { status: 200, body: { ok: true, items: [], cursor: '', hasMore: false } };
  };
  await sync.pull();
  assert.equal(mirrored.length, 0, 'the engine writes to IDB directly, bypassing the app event');
});
