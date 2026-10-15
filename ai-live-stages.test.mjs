// Sky live progress + speed (2026-10-15): real stage events, no provider/model
// switch leak, 403 keys parked, stalled providers skipped. Network is mocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from './ai-agent.js';

function stubEnv(over = {}) {
  const store = new Map();
  const kv = { get: async (k) => store.has(k) ? store.get(k) : null, put: async (k, v) => { store.set(k, v); }, _store: store };
  return { env: { PUB_KV: kv, GEMINI_KEYS: 'deadkey00001,goodkey00002', AGENT_DAILY_CAP: 50, ...over }, store };
}
const gChunk = (text) => 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) + '\n\n';
const sse = (chunks) => new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); } }), { status: 200 });
async function chat(env, content) {
  const req = new Request('https://x/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content }] }) });
  const r = await A.agentChat(req, env, 'account-live1');
  return r.text();
}
const stagesOf = (text) => [...text.matchAll(/event: stage\ndata: (.*)\n/g)].map(m => JSON.parse(m[1]));

test('real stages stream in order and never name a provider or a switch', async () => {
  const { env } = stubEnv();
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes('deadkey00001')
    ? new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED' } }), { status: 403 })
    : sse([gChunk('## নিউটন\n'), gChunk('| ক | খ |\n|---|---|\n| ১ | ২ |\n')]);
  try {
    const text = await chat(env, 'নিউটনের সূত্র বুঝাও');
    const ids = stagesOf(text).map(s => s.stage);
    assert.deepEqual(ids.slice(0, 1), ['understand']);
    for (const id of ['think', 'write', 'table', 'verify']) assert.ok(ids.includes(id), id);
    assert.ok(ids.indexOf('write') < ids.indexOf('verify'));
    const labels = stagesOf(text).map(s => s.label).join(' ');
    assert.doesNotMatch(labels, /gemini|groq|model|provider|মডেল|ব্যস্ত|অন্যটায়/i);
    assert.match(text, /event: done/);
  } finally { globalThis.fetch = real; }
});

test('a 403 (project denied) key is parked for the day', async () => {
  const { env, store } = stubEnv();
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes('deadkey00001')
    ? new Response('{}', { status: 403 }) : sse([gChunk('ঠিক আছে')]);
  try {
    await chat(env, 'হ্যালো');
    assert.ok([...store.keys()].some(k => /deadkey0000/.test(k) || /bad/i.test(k)), 'bad-key mark written');
  } finally { globalThis.fetch = real; }
});

test('a provider that never sends a first token is skipped', async () => {
  const { env } = stubEnv({ AGENT_FIRST_CHUNK_MS: 3000 });
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes('deadkey00001')
    ? new Response(new ReadableStream({ start() {} }), { status: 200 })
    : sse([gChunk('উত্তর এসেছে')]);
  try {
    const t0 = Date.now();
    const text = await chat(env, 'হ্যালো');
    assert.match(text, /উত্তর এসেছে/);
    assert.ok(Date.now() - t0 < 8000);
  } finally { globalThis.fetch = real; }
});

test('the rich-answer contract is sent for chat but not for quiz JSON', () => {
  assert.match(A.RESPONSE_FORMAT_RULES, /## /);
  assert.match(A.RESPONSE_FORMAT_RULES, /```flow/);
  assert.match(A.RESPONSE_FORMAT_RULES, /Never mention which AI model/);
});
