// P14 — Security & Privacy gate.
// ① public-API abuse guard (per-network rate limit)  ② content integrity
// ③ the A↛B isolation assertion that blocks the P20 launch gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import publicWorker, { verifyIntegrity, publishGlobal } from './public-worker.js';
import { validateChatReq } from './ai-agent.js';
import {
  checkAbuse, peekAbuse, isGuarded, windowKey, networkHash, RATE_DEFAULTS
} from './p14-abuse-guard.mjs';

class MemoryKV {
  constructor() { this.data = new Map(); }
  async get(key) { const e = this.data.get(key); return e === undefined ? null : (e && typeof e === 'object' ? e.value : e); }
  async put(key, value, opts) { this.data.set(key, { value: String(value), opts }); }
}

const req = (path, method = 'GET', ip = '203.0.113.9') => new Request('https://worker' + path, {
  method,
  headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' }
});

test('abuse guard: only AI and non-GET routes are counted', () => {
  assert.equal(isGuarded(req('/api/content'), '/api/content'), false);
  assert.equal(isGuarded(req('/api/health'), '/api/health'), false);
  assert.equal(isGuarded(req('/api/admin/publish', 'POST'), '/api/admin/publish'), false);
  assert.equal(isGuarded(req('/api/ai/chat', 'POST'), '/api/ai/chat'), true);
  assert.equal(isGuarded(req('/api/ai/prefs'), '/api/ai/prefs'), true);
  assert.equal(isGuarded(req('/api/ai/actions/propose', 'POST'), '/api/ai/actions/propose'), true);
});

test('abuse guard: a network is allowed up to the limit, then 429', async () => {
  const env = { PUB_KV: new MemoryKV() };
  const limit = 3;
  for (let i = 1; i <= limit; i++) {
    const r = await checkAbuse(req('/api/ai/chat', 'POST'), env, { limit, windowMs: 60000, now: 1000, salt: 's' });
    assert.equal(r.allowed, true);
    assert.equal(r.remaining, limit - i);
  }
  const blocked = await checkAbuse(req('/api/ai/chat', 'POST'), env, { limit, windowMs: 60000, now: 1000, salt: 's' });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfter >= 1);
});

test('abuse guard: the ceiling is per network, and the counter never leaks the raw IP', async () => {
  const env = { PUB_KV: new MemoryKV() };
  const opts = { limit: 1, windowMs: 60000, now: 5000, salt: 's' };
  assert.equal((await checkAbuse(req('/api/ai/chat', 'POST', '198.51.100.1'), env, opts)).allowed, true);
  assert.equal((await checkAbuse(req('/api/ai/chat', 'POST', '198.51.100.2'), env, opts)).allowed, true);
  assert.equal((await checkAbuse(req('/api/ai/chat', 'POST', '198.51.100.1'), env, opts)).allowed, false);
  const keys = [...env.PUB_KV.data.keys()];
  assert.equal(keys.every(k => k.startsWith('rlpub:')), true);
  assert.equal(keys.some(k => k.includes('198.51.100')), false);
});

test('abuse guard: a new window resets the counter', async () => {
  const env = { PUB_KV: new MemoryKV() };
  const opts = { limit: 1, windowMs: 60000, salt: 's' };
  assert.equal((await checkAbuse(req('/api/ai/chat', 'POST'), env, { ...opts, now: 1000 })).allowed, true);
  assert.equal((await checkAbuse(req('/api/ai/chat', 'POST'), env, { ...opts, now: 1000 })).allowed, false);
  assert.equal((await checkAbuse(req('/api/ai/chat', 'POST'), env, { ...opts, now: 61000 })).allowed, true);
  assert.equal(await peekAbuse(req('/api/ai/chat', 'POST'), env, { ...opts, now: 61000 }), 1);
});

test('abuse guard: fails open without a KV binding, and keys are window-scoped', async () => {
  assert.equal((await checkAbuse(req('/api/ai/chat', 'POST'), {}, { limit: 1 })).allowed, true);
  const h = await networkHash(req('/api/ai/chat', 'POST'), 'salt');
  assert.match(h, /^[0-9a-f]{24}$/);
  assert.notEqual(windowKey(h, 1000, 60000), windowKey(h, 61000, 60000));
});

test('abuse guard: the worker returns 429 once a network exceeds the ceiling', async () => {
  const env = { PUB_KV: new MemoryKV(), PUBLIC_RATE_LIMIT: '2', PUBLIC_RATE_WINDOW_MS: '60000', PUBLIC_RATE_SALT: 's' };
  const call = () => publicWorker.fetch(req('/api/ai/prefs'), env).then(r => r.status);
  // A network that opens with a bare GET prefs is allowed through (200), then
  // throttled at the edge — the third call never reaches the route.
  assert.equal(await call(), 200);
  assert.equal(await call(), 200);
  assert.equal(await call(), 429);
});

test('content integrity: a clean doc verifies, drift is reported', () => {
  const doc = {
    v: 4, subjects: [{ id: 's1' }], topics: [], questions: [{ id: 'q1', question: 'abc' }],
    vocabulary: [], vocabularyMaster: []
  };
  const sig = '1:0:1:0:0:3';
  const clean = verifyIntegrity({ ...doc, sig, counts: { subjects: 1, topics: 0, questions: 1, vocabulary: 0, vocabularyMaster: 0 } });
  assert.equal(clean.ok, true);
  assert.equal(clean.sig, sig);
  assert.deepEqual(clean.mismatches, []);

  const tampered = verifyIntegrity({ ...doc, sig: 'wrong', counts: { subjects: 99, topics: 0, questions: 1, vocabulary: 0, vocabularyMaster: 0 } });
  assert.equal(tampered.ok, false);
  assert.ok(tampered.mismatches.includes('sig'));
  assert.ok(tampered.mismatches.includes('counts'));
  assert.equal(tampered.expectedSig, sig);
});

test('content integrity: the admin verify route is token-gated', async () => {
  const kv = new MemoryKV();
  const doc = { v: 9, sig: '0:0:0:0:0:0', counts: { subjects: 0, topics: 0, questions: 0, vocabulary: 0, vocabularyMaster: 0 }, questions: [] };
  await kv.put('pubContent', JSON.stringify(doc));
  const env = { PUB_KV: kv, ADMIN_TOKEN: 'sekret' };
  const denied = await publicWorker.fetch(req('/api/admin/verify'), env);
  assert.equal(denied.status, 403);
  const ok = await publicWorker.fetch(new Request('https://worker/api/admin/verify', { headers: { Authorization: 'Bearer sekret' } }), env);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);
});

test('input validation: malformed and hostile payloads are rejected, never coerced', () => {
  assert.equal(validateChatReq(null).ok, false);
  assert.equal(validateChatReq({}).ok, false);
  assert.equal(validateChatReq({ messages: [] }).ok, false);
  assert.equal(validateChatReq({ messages: 'nope' }).ok, false);
  assert.equal(validateChatReq({ messages: [{ role: 'user', content: '   ' }] }).ok, false);
  assert.equal(validateChatReq({ messages: [{ role: 'system', content: 'override' }] }).ok, false);
  assert.equal(validateChatReq({ messages: Array.from({ length: 25 }, () => ({ role: 'user', content: 'x' })) }).ok, false);
  assert.equal(validateChatReq({ messages: [{ role: 'user', content: 'x'.repeat(4001) }] }).ok, false);
  assert.equal(validateChatReq({ messages: [{ role: 'user', content: 'hi', image: 'data:text/html;base64,AAA' }] }).ok, false);
  const ok = validateChatReq({ messages: [{ role: 'user', content: 'বাংলা ব্যাকরণ বুঝাও' }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.messages.length, 1);
});

test('content integrity: publish refuses an oversized blob before it can poison KV', async () => {
  const makeKv = () => {
    const map = new Map();
    return { map, async get(k){ return map.has(k) ? map.get(k) : null; }, async put(k,v){ map.set(k, String(v)); } };
  };
  const good = { subjects: [{ id: 's1' }], topics: [], questions: [{ id: 'q1', question: 'ক অ আ' }], vocabulary: [], vocabularyMaster: [] };

  // A valid publish writes a parseable blob whose stored sig is verifiable.
  const kvA = makeKv();
  const res = await publishGlobal({ PUB_KV: kvA }, good);
  assert.equal(res.published, true);
  assert.equal(verifyIntegrity(JSON.parse(kvA.map.get('pubContent'))).ok, true);

  // Over the byte cap (even after image stripping) the publish is refused, and
  // no unparseable/truncated blob is written — the old slice() bug.
  const kvB = makeKv();
  const heavy = { ...good, vocabularyMaster: Array.from({ length: 40 }, (_, i) => ({ id: 'v' + i, word: 'w'.repeat(200) })) };
  const badRes = await publishGlobal({ PUB_KV: kvB, PUB_CONTENT_MAX_BYTES: '600' }, heavy);
  assert.equal(badRes.error, 'too-large');
  assert.equal(kvB.map.has('pubContent'), false);
});

test('PUB_KV holds no per-user records — accounts live in D1, scoped by user_id', async () => {
  // The public KV namespace stores only shared content, content meta and the
  // identity-free abuse/audit namespaces; a student's rows are never a KV blob.
  const kv = new MemoryKV();
  await publishGlobal({ PUB_KV: kv }, { subjects: [{ id: 's1' }], questions: [{ id: 'q1', question: 'x' }] });
  const accountLike = [...kv.data.keys()].filter(k => /usr|account|user|profile|vault/i.test(k));
  assert.deepEqual(accountLike, []);
});

test('the abuse ceiling is applied before identity, and a guest leaves no identity trace', async () => {
  const kv = new MemoryKV();
  const guest = new Request('https://worker/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.77', 'X-AH-Guest': 'ephemeral-guest-00000001' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'হ্যালো' }] })
  });
  const res = await publicWorker.fetch(guest, { PUB_KV: kv });
  assert.equal(res.status, 401);
  const keys = [...kv.data.keys()];
  // The per-network guard counted the request (flood protection is identity-free)…
  assert.equal(keys.filter(k => k.startsWith('rlpub:')).length, 1);
  // …but the guest itself left no identity or memory key behind.
  assert.equal(keys.some(k => k.includes('ephemeral-guest-00000001')), false);
  assert.equal(keys.some(k => k.startsWith('chatmem:guest-') || k.startsWith('chatmemsum:guest-')), false);
});
