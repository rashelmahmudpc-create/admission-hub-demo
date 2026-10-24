import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SKY_AI_IDENTITY_ROUTES, forwardWithIdentity } from './sky-ai-route.mjs';

const U = 'https://admission-gk.example/api/ai/prefs';
const R = ['GET /api/ai/prefs'];
const kv = (d) => ({ get: async (k) => (k in d ? d[k] : null) });

test('identity allowlist contains only prefs + actions audit + sky-flags', () => {
  assert.deepEqual([...SKY_AI_IDENTITY_ROUTES], ['GET /api/ai/prefs', 'GET /api/ai/actions/audit', 'GET /api/ai/sky-flags']);
});

/* F0.2 / DV-02: the route only works when admission-gk answers it. sky-ai has
 * served GET /api/ai/sky-flags since F0.2, but with no handler here the public
 * URL answered 404 (verified live 2026-10-24). This pins the wiring. */
test('admission-gk answers GET /api/ai/sky-flags and forwards it with the uid', async () => {
  const src = await readFile(new URL('./public-worker.js', import.meta.url), 'utf8');
  assert.match(src, /path === '\/api\/ai\/sky-flags' && request\.method === 'GET'/);
  let seen = null;
  const env = { PUB_KV: kv({ 'secret:sky-internal': 'K' }), SKY_AI: { fetch: async (r) => { seen = r; return new Response('{"ok":true}'); } } };
  const res = await forwardWithIdentity(new Request('https://admission-gk.example/api/ai/sky-flags', { headers: { 'x-sky-uid': 'evil' } }), env, 'account-1');
  assert.equal(res.status, 200);
  assert.equal(seen.headers.get('x-sky-uid'), 'account-1');
  assert.equal(seen.headers.get('x-sky-ai-caller'), 'admission-gk');
});

test('forwards uid + internal key when listed and key exists', async () => {
  let seen = null;
  const env = { PUB_KV: kv({ 'secret:sky-internal': 'K' }), SKY_AI: { fetch: async (r) => { seen = r; return new Response('{"prefs":{}}'); } } };
  const res = await forwardWithIdentity(new Request(U, { headers: { 'x-sky-uid': 'evil' } }), env, 'account-1', R);
  assert.equal(res.status, 200);
  assert.equal(seen.headers.get('x-sky-uid'), 'account-1');
  assert.equal(seen.headers.get('x-sky-internal'), 'K');
  assert.equal(seen.headers.get('x-sky-ai-caller'), 'admission-gk');
});

test('falls back (null) when unlisted, no key, no uid, POST, or sky-ai fails', async () => {
  const ok = { fetch: async () => new Response('x') };
  const withKey = { PUB_KV: kv({ 'secret:sky-internal': 'K' }), SKY_AI: ok };
  assert.equal(await forwardWithIdentity(new Request(U), withKey, 'u', []), null);
  assert.equal(await forwardWithIdentity(new Request(U), { PUB_KV: kv({}), SKY_AI: ok }, 'u', R), null);
  assert.equal(await forwardWithIdentity(new Request(U), withKey, '', R), null);
  assert.equal(await forwardWithIdentity(new Request(U, { method: 'POST', body: '{}' }), withKey, 'u', ['POST /api/ai/prefs']), null);
  for (const f of [async () => new Response('', { status: 404 }), async () => new Response('', { status: 500 }), async () => { throw new Error('x'); }]) {
    assert.equal(await forwardWithIdentity(new Request(U), { PUB_KV: kv({ 'secret:sky-internal': 'K' }), SKY_AI: { fetch: f } }, 'u', R), null);
  }
});
