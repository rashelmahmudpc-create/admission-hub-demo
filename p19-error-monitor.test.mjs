// ✅ P19 — error-monitoring contract (monitoring/error-tracking was the last
// open P19 item). These tests pin the two rules the module promises: a log
// entry is a real failure (never invented) and is not a transcript (a secret
// caught in an exception string must not survive into KV).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeErrorText, errorSignature, makeErrorEntry, appendError,
  totalErrors, summarizeErrors, recordError, ERROR_LOG_KEY, MAX_KINDS, MAX_MESSAGE,
} from './p19-error-monitor.mjs';

/** A PUB_KV stand-in with the two methods recordError uses. No network, no mock
 *  of the code under test — the store is a Map and the module is the real one. */
function memoryKV(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    _dump() { return Object.fromEntries(m); },
  };
}

test('১. sanitizeErrorText: প্রতিটি সিক্রেট-প্যাটার্ন [REDACTED] হয়', () => {
  const cases = [
    'failed with sk-abcdefghijklmnop',
    'token ghp_ABCDEFGHIJKLMNOPQRSTUV',
    'key AIzaSyA1234567890abcdefg',
    'ck_0123456789abcdef',
    'gsk_abcdefghijklmnop',
    'xoxb-1234567890-abcdefghij',
    'authorization: Bearer abc123def456',
  ];
  for (const input of cases) {
    const out = sanitizeErrorText(input);
    assert.ok(!/sk-[A-Za-z0-9_-]{8,}|ghp_|AIza|ck_|gsk_|xoxb-/.test(out), `leaked: ${out}`);
  }
});

test('২. sanitizeErrorText: পাসওয়ার্ড/টোকেন মান ঢাকে, নাম রাখে', () => {
  const out = sanitizeErrorText('connect failed password=hunter2 token=abc123');
  assert.ok(!out.includes('hunter2'), out);
  assert.ok(!out.includes('abc123'), out);
  assert.match(out, /password=\[REDACTED\]/);
});

test('৩. sanitizeErrorText: বার্তা MAX_MESSAGE-এ ক্লিপ হয়', () => {
  const out = sanitizeErrorText('x'.repeat(5000));
  assert.equal(out.length, MAX_MESSAGE);
});

test('৪. errorSignature: একই path+বার্তা একই স্বাক্ষর দেয়', () => {
  assert.equal(
    errorSignature('/api/ai/chat', 'boom'),
    errorSignature('/api/ai/chat', 'boom'),
  );
  assert.notEqual(
    errorSignature('/api/ai/chat', 'boom'),
    errorSignature('/api/ai/content', 'boom'),
  );
});

test('৫. appendError: নতুন স্বাক্ষর সামনে বসে, count ১', () => {
  const log = appendError([], makeErrorEntry({ path: '/a', method: 'get', status: 500, message: 'boom', at: 111 }));
  assert.equal(log.length, 1);
  assert.equal(log[0].count, 1);
  assert.equal(log[0].firstAt, 111);
  assert.equal(log[0].lastAt, 111);
  assert.equal(log[0].method, 'GET');
  assert.equal(log[0].status, 500);
});

test('৬. appendError: পুনরাবৃত্তি count বাড়ায়, এন্ট্রি বাড়ায় না', () => {
  let log = appendError([], makeErrorEntry({ path: '/a', method: 'GET', status: 500, message: 'boom', at: 1 }));
  log = appendError(log, makeErrorEntry({ path: '/a', method: 'GET', status: 500, message: 'boom', at: 2 }));
  log = appendError(log, makeErrorEntry({ path: '/a', method: 'POST', status: 503, message: 'boom', at: 3 }));
  assert.equal(log.length, 1);
  assert.equal(log[0].count, 3);
  assert.equal(log[0].firstAt, 1, 'firstAt অপরিবর্তিত');
  assert.equal(log[0].lastAt, 3, 'lastAt সর্বশেষ');
  assert.equal(log[0].method, 'POST', 'সর্বশেষ method');
  assert.equal(log[0].status, 503, 'সর্বশেষ status');
  assert.equal(totalErrors(log), 3);
});

test('৭. appendError: MAX_KINDS-এ সীমাবদ্ধ, পুরনো বাদ', () => {
  let log = [];
  for (let i = 0; i < MAX_KINDS + 20; i++) {
    log = appendError(log, makeErrorEntry({ path: `/p${i}`, method: 'GET', status: 500, message: `e${i}`, at: i }));
  }
  assert.equal(log.length, MAX_KINDS);
  assert.equal(log[0].path, `/p${MAX_KINDS + 19}`, 'নতুন সবার আগে');
});

test('৮. appendError: ইনপুট mutate করে না (pure)', () => {
  const before = appendError([], makeErrorEntry({ path: '/a', method: 'GET', status: 500, message: 'boom', at: 1 }));
  const snapshot = JSON.parse(JSON.stringify(before));
  appendError(before, makeErrorEntry({ path: '/a', method: 'GET', status: 500, message: 'boom', at: 2 }));
  assert.deepEqual(before, snapshot, 'আগের log অপরিবর্তিত থাকতে হবে');
});

test('৯. summarizeErrors: খালি log = শূন্য, বানানো কিছু নয়', () => {
  const s = summarizeErrors([]);
  assert.equal(s.ok, true);
  assert.equal(s.kinds, 0);
  assert.equal(s.total, 0);
  assert.deepEqual(s.errors, []);
});

test('১০. recordError: KV-তে লিখে, দ্বিতীয়বার count বাড়ায়', async () => {
  const env = { PUB_KV: memoryKV() };
  await recordError(env, { path: '/api/x', method: 'POST', status: 500, message: 'kaboom', now: () => 5 });
  await recordError(env, { path: '/api/x', method: 'POST', status: 500, message: 'kaboom', now: () => 9 });
  const stored = JSON.parse(env.PUB_KV._dump()[ERROR_LOG_KEY]);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].count, 2);
  assert.equal(stored[0].firstAt, 5);
  assert.equal(stored[0].lastAt, 9);
});

test('১১. recordError: সিক্রেট KV-তে পৌঁছায় না', async () => {
  const env = { PUB_KV: memoryKV() };
  await recordError(env, { path: '/api/x', method: 'GET', status: 500, message: 'boom sk-abcdefghijklmnop' });
  const raw = env.PUB_KV._dump()[ERROR_LOG_KEY];
  assert.ok(!/sk-abcdefghijklmnop/.test(raw), 'সিক্রেট লেখা হয়ে গেছে');
  assert.match(raw, /REDACTED/);
});

test('১২. recordError: KV নেই বা ভাঙা হলে চুপচাপ চলে, throw করে না', async () => {
  await recordError(null, { path: '/a', message: 'x' });
  await recordError({}, { path: '/a', message: 'x' });
  const broken = { PUB_KV: { async get() { throw new Error('kv down'); }, async put() { throw new Error('kv down'); } } };
  await recordError(broken, { path: '/a', message: 'x' });
  await recordError({ PUB_KV: { async get() { return '{not json'; }, async put() {} } }, { path: '/a', message: 'x' });
});

test('১৩. recordError: আগের ভাঙা KV-ডেটার ওপরও লিখতে পারে', async () => {
  const env = { PUB_KV: memoryKV({ [ERROR_LOG_KEY]: 'not-json-at-all' }) };
  await recordError(env, { path: '/api/x', method: 'GET', status: 500, message: 'boom', now: () => 1 });
  const stored = JSON.parse(env.PUB_KV._dump()[ERROR_LOG_KEY]);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].count, 1);
});
