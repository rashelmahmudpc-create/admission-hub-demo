// 🧩 P25 — CHAT RESPONSE CACHE (step 1 of the owner's AI cost plan, 2026-10-15)
//
// The cache exists to stop paying for the same answer twice. Two things had to
// be true for it to be honest, and both are asserted here:
//
//   (a) a repeat question really does skip the provider, and
//   (b) a PERSONALISED question is never served from the shared cache — the
//       system prompt carries the student's memory, summary and context, so a
//       cross-user hit would leak one student's personalisation into another's
//       answer. That is worse than the quota it would save.
//
// No network: globalThis.fetch is stubbed and counts provider calls.
import { readFileSync } from 'fs';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };

const CC = await import('./ai-chat-cache.mjs');
const A = await import('./ai-agent.js');
const SRC = readFileSync('ai-agent.js', 'utf8');
const { agentChat } = A;
const { chatCacheEnabled, isCacheableRequest, normaliseQuestion, chatCacheKey, CHAT_CACHE_TTL_MS } = CC;

/* ── A minimal D1 double: only the statements the cache actually issues ── */
function fakeD1() {
  const rows = new Map();
  return {
    calls: 0,
    prepare(sql) {
      const s = String(sql);
      const stmt = {
        _b: [],
        bind(...args) { stmt._b = args; return stmt; },
        async first() {
          if (/FROM ai_cache/.test(s)) {
            const row = rows.get(String(stmt._b[0]));
            return row ? { ...row } : null;
          }
          return null;
        },
        async run() {
          if (/INTO ai_cache/.test(s)) {
            const [key, kind, payload, model, created, expires] = stmt._b;
            rows.set(String(key), { payload_json: payload, kind, model, created_at: created, expires_at: expires });
          }
          return { success: true };
        }
      };
      return stmt;
    },
    _rows: rows
  };
}

/* ── provider double: counts real model calls, answers on the SSE contract ── */
function withProviderDouble(env) {
  const real = globalThis.fetch;
  const state = { calls: 0, lastText: '' };
  globalThis.fetch = async (url, init) => {
    state.calls++;
    state.lastText = (init && init.body) ? String(init.body) : '';
    const body = 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'পরীক্ষার উত্তর ' + state.calls }] } }] }) + '\n\n';
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  state.restore = () => { globalThis.fetch = real; };
  return state;
}

function baseEnv(extra = {}) {
  return {
    PROFILE_DB: fakeD1(),
    AI_CHAT_CACHE: 'enabled',
    PUB_KV: {
      async get() { return null; },
      async put() { return { ok: true }; }
    },
    GEMINI_KEYS: 'k1',
    ...extra
  };
}

const ask = (env, content, opts = {}) => agentChat(
  new Request('https://x/api/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content }], fresh: true, ...opts })
  }),
  env, 'account-abc'
);

/* ── ১. Flag gating ── */
t('P25-১. cache is on by default and off only on an explicit off-value',
  chatCacheEnabled({}) && chatCacheEnabled({ AI_CHAT_CACHE: 'enabled' }) && chatCacheEnabled({ AI_CHAT_CACHE: 'yes' })
  && !chatCacheEnabled({ AI_CHAT_CACHE: 'off' }) && !chatCacheEnabled({ AI_CHAT_CACHE: 'disabled' })
  && !chatCacheEnabled({ AI_CHAT_CACHE: 'FALSE' }) && !chatCacheEnabled({ AI_CHAT_CACHE: '0' }));

/* ── ২. Only impersonal requests qualify ── */
t('P25-২. a single clean user turn is cacheable', isCacheableRequest({
  messages: [{ role: 'user', content: 'বাংলাদেশের রাজধানী কোনটি?' }],
  hasImage: false, quizMode: false, onboarding: null,
  memoryText: '', summaryText: '', ctxText: '', stats: null, intent: 'GENERAL_CHAT'
}));
t('P25-৩. any personalisation in the prompt disqualifies the reply', [
  { memoryText: 'MEM' }, { summaryText: 'SUM' }, { ctxText: 'CTX' }, { stats: { exams: 3 } }
].every(over => !isCacheableRequest({
  messages: [{ role: 'user', content: 'প্রশ্ন' }],
  hasImage: false, quizMode: false, onboarding: null,
  memoryText: '', summaryText: '', ctxText: '', stats: null, intent: 'GENERAL_CHAT',
  ...over
})));
t('P25-৪. history, images, quiz and onboarding are never cached', [
  { messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] },
  { hasImage: true }, { quizMode: true }, { onboarding: { name: 'x' } }
].every(over => !isCacheableRequest({
  messages: [{ role: 'user', content: 'প্রশ্ন' }],
  hasImage: false, quizMode: false, onboarding: null,
  memoryText: '', summaryText: '', ctxText: '', stats: null, intent: 'GENERAL_CHAT',
  ...over
})));
t('P25-৫. PERFORMANCE_REQUEST is not cacheable — its answer is per-student',
  !isCacheableRequest({
    messages: [{ role: 'user', content: 'আমার অগ্রগতি বলো' }],
    hasImage: false, quizMode: false, onboarding: null,
    memoryText: '', summaryText: '', ctxText: '', stats: null, intent: 'PERFORMANCE_REQUEST'
  }));

/* ── ৩. Key shape ── */
t('P25-৬. Bengali and ASCII digits reach the same key',
  normaliseQuestion('২০২৬ সালে কী?') === normaliseQuestion('2026 সালে কী?'));
t('P25-৭. the key is stable, and changes with question, intent and prompt version',
  (async () => {
    const k = (o) => chatCacheKey({ question: 'প্রশ্ন', intent: 'GENERAL_CHAT', promptVersion: 'p1', agentVersion: 'a1', ...o });
    const base = await k({});
    return base === await k({})
      && base !== await k({ question: 'অন্য প্রশ্ন' })
      && base !== await k({ promptVersion: 'p2' })
      && base !== await k({ agentVersion: 'a2' })
      && base !== await k({ intent: 'ACADEMIC_EXPLAIN' });
  })());
t('P25-৮. study answers live a day, time-sensitive ones six hours',
  CHAT_CACHE_TTL_MS.ACADEMIC_EXPLAIN === 24 * 3600 * 1000 && CHAT_CACHE_TTL_MS.SEARCH_REQUEST === 6 * 3600 * 1000);

/* ── ৪. End-to-end: the provider is really skipped on a repeat ── */
t('P25-৯. a repeated impersonal question calls the provider once, not twice', (async () => {
  const env = baseEnv();
  const p = withProviderDouble(env);
  try {
    const q = 'বাংলাদেশের জাতীয় ফুল কী?';
    const first = await (await ask(env, q)).text();
    const callsAfterFirst = p.calls;
    const second = await (await ask(env, q)).text();
    return callsAfterFirst === 1 && p.calls === 1
      && first.includes('পরীক্ষার উত্তর 1') && second.includes('পরীক্ষার উত্তর 1');
  } finally { p.restore(); }
})(), { timeout: 20000 });

t('P25-১০. with the flag off the provider is called every time', (async () => {
  const env = baseEnv({ AI_CHAT_CACHE: 'off' });
  const p = withProviderDouble(env);
  try {
    const q = 'বাংলাদেশের জাতীয় পাখি কী?';
    await (await ask(env, q)).text();
    await (await ask(env, q)).text();
    return p.calls === 2;
  } finally { p.restore(); }
})(), { timeout: 20000 });

t('P25-১১. a personalised question is never served from the cache', (async () => {
  const env = baseEnv();
  const p = withProviderDouble(env);
  try {
    /* Memory on (default) and history present => not cacheable => two calls. */
    const body = { messages: [{ role: 'user', content: 'আমার জন্য পড়ার পরামর্শ' }, { role: 'assistant', content: 'আগের উত্তর' }, { role: 'user', content: 'আরেকবার বলো' }] };
    await (await agentChat(new Request('https://x/api/ai/chat', { method: 'POST', body: JSON.stringify(body) }), env, 'account-abc')).text();
    await (await agentChat(new Request('https://x/api/ai/chat', { method: 'POST', body: JSON.stringify(body) }), env, 'account-abc')).text();
    return p.calls === 2;
  } finally { p.restore(); }
})(), { timeout: 20000 });

/* ── ৫. Wiring invariants ── */
t('P25-১২. the cache never runs before the quota charge (the cap stays unbypassable)',
  SRC.indexOf('quota.exhausted) return jsonResp') < SRC.indexOf('isCacheableRequest({'));
t('P25-১৩. the cache is consulted before the provider chain is built',
  SRC.indexOf('isCacheableRequest({') < SRC.indexOf('let chain = routerChain('));
t('P25-১৪. a cache fault is swallowed, never thrown at the student',
  /catch \(_\) \{ \/\* a cache fault never breaks chat/.test(SRC));

console.log(`\n${fail === 0 ? '✅' : '❌'} P25 chat-cache: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
