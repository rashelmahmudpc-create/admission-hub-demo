import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import publicWorker from './public-worker.js';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const chat = readFileSync(new URL('./ai-agent-chat.js', import.meta.url), 'utf8');

class MemoryKV {
  constructor() { this.data = new Map(); }
  async get(key) { return this.data.get(key) ?? null; }
  async put(key, value) { this.data.set(key, String(value)); }
}

const authBinding = new Map([
  ['A'.repeat(48), 'usr_account_alpha'],
  ['B'.repeat(48), 'usr_account_beta']
]);

const authority = {
  idFromName(name) { assert.equal(name, 'admission-hub-global-auth-v1'); return name; },
  get() {
    return {
      async fetch(_url, init) {
        const { sessionToken } = JSON.parse(init.body);
        const id = authBinding.get(sessionToken);
        return new Response(JSON.stringify(id
          ? { ok: true, result: { user: { id } } }
          : { ok: false, error: { code: 'SESSION_INVALID' } }), {
          status: id ? 200 : 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    };
  }
};

const chatRequest = (sessionToken, guest = 'ephemeral-guest-00000001') => new Request('https://worker/api/ai/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': sessionToken ? `__Host-ah_session=${sessionToken}` : '',
    'X-AH-Guest': guest,
    'CF-Connecting-IP': '203.0.113.50'
  },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'বাংলা ব্যাকরণ বুঝাও' }] })
});

test('core IndexedDB records are Firebase-account scoped while guests use session memory only', () => {
  assert.match(html, /let DATA_SCOPE=''/);
  assert.match(html, /detail\.authenticated===true/);
  assert.match(html, /scopedRecordId\(id\)/);
  assert.match(html, /__ahOwner:DATA_SCOPE/);
  assert.match(html, /if\(!persistentDataScope\(\)\)\{MEMORY_DB\.get\(store\)\?\.set/);
  assert.match(html, /window\.addEventListener\('admissionhub:authchange'/);
  assert.match(html, /if\(!next\) MEMORY_DB\.forEach\(store=>store\.clear\(\)\)/);
});

test('AI browser history is never shared globally and guest conversations are not persisted', () => {
  assert.match(chat, /scopedKey = key => accountScope/);
  assert.match(chat, /window\.addEventListener\('admissionhub:authchange'/);
  assert.match(chat, /if \(!accountScope\) return;/);
  assert.match(chat, /localStorage\.removeItem\(key\)/);
  assert.doesNotMatch(chat, /localStorage\.setItem\(['"]ahAiGuestV1/);
});

test('AI backend derives separate account identities from HttpOnly sessions and guest content has no memory key', async () => {
  const kv = new MemoryKV();
  const env = { PUB_KV: kv, AUTH_AUTHORITY: authority };
  assert.equal((await publicWorker.fetch(chatRequest('A'.repeat(48)), env)).status, 503);
  assert.equal((await publicWorker.fetch(chatRequest('B'.repeat(48)), env)).status, 503);
  // M7: a guest is refused before any processing — it never reaches the provider,
  // so it is 401 rather than the account-only 503 (no-key) path.
  assert.equal((await publicWorker.fetch(chatRequest('', 'ephemeral-guest-00000002'), env)).status, 401);
  const keys = [...kv.data.keys()];
  const accountRateKeys = keys.filter(key => key.startsWith('airl:account-'));
  assert.equal(accountRateKeys.length, 2);
  assert.notEqual(accountRateKeys[0], accountRateKeys[1]);
  assert.equal(keys.some(key => key.includes('usr_account_alpha') || key.includes('usr_account_beta')), false);
  assert.equal(keys.some(key => key.startsWith('chatmem:guest-') || key.startsWith('chatmemsum:guest-')), false);
  assert.equal(keys.some(key => key.includes('ephemeral-guest-00000002')), false);
});
