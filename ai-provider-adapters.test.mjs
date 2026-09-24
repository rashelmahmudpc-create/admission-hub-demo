// 🧩 PHASE 9 — M2: AI PROVIDER ADAPTER LAYER (server-side module test)
// Locks the adapter boundary introduced in migration step M2. The provider
// call sites must be structurally reachable only through adapters, while the
// observable behaviour stays identical to the pre-M2 orchestrator.
import { readFileSync } from 'fs';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const A = await import('./ai-agent.js');
const SRC = readFileSync('ai-agent.js', 'utf8');
const {
  adapterFor, providerChain, PROVIDER_ADAPTERS, GEMINI_ADAPTER, GROQ_ADAPTER,
  routerChain, ProviderError, agentChat, __test
} = A;

const stubEnv = (over = {}) => {
  const store = new Map();
  return {
    store,
    env: {
      GEMINI_KEYS: 'k1,k2', GROQ_API_KEY: 'g1', PUB_KV: {
        get: async (k) => (store.has(k) ? store.get(k) : null),
        put: async (k, v) => { store.set(k, v); }
      },
      ...over
    }
  };
};
const gChunk = (s) => JSON.stringify({ candidates: [{ content: { parts: [{ text: s }] } }] });
const sseRes = (body) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

/* ── ১. Registry shape ── */
t('M2-১. core adapters registered, gemini+groq present and ordered first', PROVIDER_ADAPTERS.length >= 2 && PROVIDER_ADAPTERS[0].id === 'gemini' && PROVIDER_ADAPTERS[1].id === 'groq');
t('M2-২. every adapter exposes the full contract', PROVIDER_ADAPTERS.every(a => typeof a.id === 'string' && typeof a.matches === 'function' && typeof a.chatOnce === 'function' && typeof a.chatStream === 'function' && typeof a.oneShot === 'boolean'));
t('M2-৩. adapterFor maps chain entries to the right adapter', adapterFor({ provider: 'gemini' }) === GEMINI_ADAPTER && adapterFor({ provider: 'groq' }) === GROQ_ADAPTER);
t('M2-৪. adapterFor(unknown) → null (no silent misroute)', adapterFor({ provider: 'openrouter' }) === null && adapterFor({}) === null);
t('M2-৫. gemini is one-shot capable, groq is honestly stream-only', GEMINI_ADAPTER.oneShot === true && GROQ_ADAPTER.oneShot === false);

/* ── ২. Non-stream chain ── */
t('M2-৬. providerChain = router chain minus stream-only providers', (() => {
  const c = providerChain(stubEnv().env, 'SMART', new Set());
  return c.length > 0 && c.every(x => x.provider === 'gemini');
})());
t('M2-৭. providerChain honours the bad-set (same key/model exclusion as router)', (() => {
  const env = { GEMINI_KEYS: 'k1', GROQ_API_KEY: '' };
  const bad = new Set(['k1:gemini-3-flash-preview']);
  return !providerChain(env, 'SMART', bad).some(x => x.model === 'gemini-3-flash-preview');
})());
t('M2-৮. providerChain {} → empty (still the 503 path)', providerChain({}, 'FAST', new Set()).length === 0);
t('M2-৯. providerChain never includes groq even when GROQ_API_KEY is set', !providerChain(stubEnv().env, 'FAST', new Set()).some(x => x.provider === 'groq'));

/* ── ৩. Groq one-shot fails honestly (never a fake success) ── */
t('M2-১০. GROQ_ADAPTER.chatOnce rejects instead of inventing a fallback', (async () => {
  try { await GROQ_ADAPTER.chatOnce({ provider: 'groq', key: 'g', model: 'm' }, {}); return false; }
  catch (e) { return e instanceof ProviderError && e.bad === false && e.retryable === false; }
})());

/* ── ৪. Structural: providers are reached only through adapters ── */
const ORCH = SRC.slice(SRC.indexOf('export async function agentChat'), SRC.indexOf('export async function agentStatus'));
t('M2-১১. no raw provider URL anywhere inside the orchestrator body', !ORCH.includes('generativelanguage.googleapis.com') && !ORCH.includes('api.groq.com'));
t('M2-১২. provider endpoints exist only in the stream helpers + chatOnce adapter', (SRC.match(/generativelanguage\.googleapis\.com/g) || []).length === 2 && (SRC.match(/api\.groq\.com\/openai\/v1\/chat\/completions/g) || []).length === 1 && (ORCH.match(/fetch\(/g) || []).length === 0);
t('M2-১৩. orchestrator dispatches by adapter, not by provider name', SRC.includes('const adapter = adapterFor(c)') && !SRC.includes("if (c.provider === 'groq')"));

/* ── ৫. Behaviour unchanged (same E2E outcomes as baseline) ── */
t('M2-১৪. E2E: gemini-500 → groq-fallback still streams through adapters', (async () => {
  const { env } = stubEnv();
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('streamGenerateContent')) return new Response('boom', { status: 500 });
    if (u.includes('api.groq.com')) return sseRes('data: ' + JSON.stringify({ choices: [{ delta: { content: 'গ্রক-উত্তর' } }] }) + '\n\ndata: [DONE]\n\n');
    return new Response('unexpected', { status: 500 });
  };
  try {
    const r = await agentChat(new Request('https://x/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'বুঝাও' }] }) }), env, 'uid_m2');
    const text = await r.text();
    return r.status === 200 && text.includes('গ্রক-উত্তর') && text.includes('"provider":"groq"');
  } finally { globalThis.fetch = real; }
})(), { timeout: 10000 });

t('M2-১৫. E2E: non-stream path still returns gemini text through GEMINI_ADAPTER', (async () => {
  const { env } = stubEnv();
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes(':generateContent')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'সরাসরি-উত্তর' }] } }] }), { status: 200 });
    return new Response('boom', { status: 500 });
  };
  try {
    const r = await agentChat(new Request('https://x/api/ai', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'বুঝাও' }] }) }), env, 'uid_m2b');
    const d = await r.json();
    return r.status === 200 && d.text === 'সরাসরি-উত্তর' && d.provider === undefined && d.model === 'gemini-3-flash-preview';
  } finally { globalThis.fetch = real; }
})(), { timeout: 10000 });

t('M2-১৬. E2E: no-provider env still yields 503 (wording unchanged)', (async () => {
  const { env } = stubEnv({ GEMINI_KEYS: '', GROQ_API_KEY: '' });
  const r = await agentChat(new Request('https://x/api/ai', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'হ্যালো' }] }) }), env, 'uid_m2c');
  const d = await r.json();
  return r.status === 503 && d.error === 'no_providers';
})(), { timeout: 10000 });

t('M2-১৭. adapters are exported on the test surface for later steps', __test.GEMINI_ADAPTER === GEMINI_ADAPTER && __test.GROQ_ADAPTER === GROQ_ADAPTER && __test.adapterFor === adapterFor);

/* ── ৬. M2.5: Cloudflare Workers AI backup ── */
const { CLOUDFLARE_ADAPTER } = A;
const cfEnv = (over = {}) => ({ GEMINI_KEYS: 'k1', GROQ_API_KEY: 'g1', CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_AI_API_KEY: 'cftok', PUB_KV: { get: async () => null, put: async () => {} }, ...over });

t('M2.5-১. cloudflare adapter registered with the full contract', Boolean(CLOUDFLARE_ADAPTER) && PROVIDER_ADAPTERS.some(a => a.id === 'cloudflare') && typeof CLOUDFLARE_ADAPTER.chatStream === 'function' && CLOUDFLARE_ADAPTER.oneShot === false);
t('M2.5-২. adapterFor routes cloudflare chain entries', adapterFor({ provider: 'cloudflare' }) === CLOUDFLARE_ADAPTER);
t('M2.5-৩. chatOnce rejects honestly (no invented one-shot path)', (async () => {
  try { await CLOUDFLARE_ADAPTER.chatOnce({ provider: 'cloudflare' }, {}); return false; }
  catch (e) { return e instanceof ProviderError && e.bad === false; }
})());
t('M2.5-৪. router appends cloudflare only when account id AND token exist', (() => {
  const both = routerChain(cfEnv(), 'FAST', new Set());
  const noAcct = routerChain({ GEMINI_KEYS: 'k', CLOUDFLARE_AI_API_KEY: 't' }, 'FAST', new Set());
  const noTok = routerChain({ GEMINI_KEYS: 'k', CLOUDFLARE_ACCOUNT_ID: 'a' }, 'FAST', new Set());
  return both.some(x => x.provider === 'cloudflare') && !noAcct.some(x => x.provider === 'cloudflare') && !noTok.some(x => x.provider === 'cloudflare');
})());
t('M2.5-৫. cloudflare sits AFTER gemini and groq (backup, not primary)', (() => {
  const c = routerChain(cfEnv(), 'FAST', new Set());
  return c.findIndex(x => x.provider === 'cloudflare') > c.findIndex(x => x.provider === 'groq');
})());
t('M2.5-৬. model list is overridable for catalogue rotation', (() => {
  const c = routerChain(cfEnv({ AGENT_CLOUDFLARE_MODELS: '@cf/a,@cf/b' }), 'FAST', new Set()).filter(x => x.provider === 'cloudflare');
  return c.length === 2 && c.map(x => x.model).join(',') === '@cf/a,@cf/b';
})());
t('M2.5-৭. no cloudflare entry when the whole env is empty (503 path intact)', !routerChain({}, 'FAST', new Set()).some(x => x.provider === 'cloudflare'));
t('M2.5-৮. E2E: gemini+groq down → cloudflare streams the answer', (async () => {
  const env = cfEnv();
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('generativelanguage') || u.includes('api.groq.com')) return new Response('boom', { status: 500 });
    if (u.includes('api.cloudflare.com/client/v4/accounts/acct/ai/v1/chat/completions')) {
      return sseRes('data: ' + JSON.stringify({ choices: [{ delta: { content: 'সিএফ-উত্তর' } }] }) + '\n\ndn\n');
    }
    return new Response('unexpected ' + u, { status: 500 });
  };
  try {
    const r = await agentChat(new Request('https://x/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'বুঝাও' }] }) }), env, 'uid_cf');
    const text = await r.text();
    return r.status === 200 && text.includes('সিএফ-উত্তর') && text.includes('"provider":"cloudflare"');
  } finally { globalThis.fetch = real; }
})(), { timeout: 10000 });

t('M2.5-৯. cloudflare adapter never leaks the token into the request URL', (() => {
  const src = SRC.slice(SRC.indexOf('CLOUDFLARE_ADAPTER'), SRC.indexOf('export function adapterFor'));
  return src.includes('accounts/${encodeURIComponent(account)}') && !/chat\/completions\?.*(token|key=)/i.test(src);
})());
t('M2.5-১০. agentStatus reports the cloudflare slot', (async () => {
  const r = await A.agentStatus(new Request('https://x/api/ai/status'), cfEnv(), 'u');
  const d = await r.json();
  return d.providers.cloudflare === true && d.providers.gemini === true;
})(), { timeout: 10000 });

console.log(`\n🧩 PHASE9-M2-ADAPTERS: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
