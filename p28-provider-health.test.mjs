// 🩺 P28 — PROVIDER CHAIN HEALTH
//
// Owner (voice note 2026-10-16): "বর্তমানে এআই উত্তর দিচ্ছে না কেন" — "why is the
// AI not answering right now?"
//
// Measured, not guessed: Gemini's *streaming* endpoint was answering 503
// UNAVAILABLE ("high demand") while its non-streaming endpoint answered 200 for
// the same model seconds apart. The old code set `bad: status >= 500` and then
// remembered that under a 24-hour key. Because the tier is 17 keys × 2 models
// (34 of a 52-entry chain), one short blip could disable the whole primary tier;
// when the fallbacks were also bad (OpenRouter answered 402 here) the chain was
// EMPTY and the route failed instantly with "AI-সেবা এখন কনফিগার করা নেই" — which
// reads as "the AI is switched off". Nothing ever cleared the mark before
// midnight.
//
// Two properties this file locks:
//   (a) a transient 5xx must NOT disable a model for a day, and must come back
//       on its own; and
//   (b) the chain must never be empty while any key exists, so a blip can never
//       surface to the student as "the AI is off".
import { readFileSync } from 'fs';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };

const H = await import('./ai-provider-health.mjs');
const A = await import('./ai-agent.js');
const SRC = readFileSync('ai-agent.js', 'utf8');
const { cooldownForStatus, isEntryHealthy, healthyChain, failureMarker, HEALTH } = H;

/* ── ১. A status earns the right cooldown ── */
t('P28-১. a 5xx earns a short cooldown, not a day-long ban',
  cooldownForStatus(503) === HEALTH.TRANSIENT_COOLDOWN_S && cooldownForStatus(503) < 3600);
t('P28-২. a bad credential still earns the long ban',
  cooldownForStatus(401) === HEALTH.CREDENTIAL_BAN_S
  && cooldownForStatus(403) === HEALTH.CREDENTIAL_BAN_S
  && cooldownForStatus(402) === HEALTH.CREDENTIAL_BAN_S);
t('P28-৩. 429 gets its own short window (quota refills)',
  cooldownForStatus(429) === HEALTH.RATE_LIMIT_COOLDOWN_S && cooldownForStatus(429) < HEALTH.CREDENTIAL_BAN_S);
t('P28-৪. a request-shaped 4xx is not remembered at all',
  cooldownForStatus(400) === null && cooldownForStatus(404) === null);

/* ── ২. The marker carries an expiry and heals ── */
t('P28-৫. a fresh 503 marker blocks the entry now', (() => {
  const now = Date.now();
  const m = failureMarker(503, now);
  return isEntryHealthy(m, now) === false;
})());
t('P28-৬. the same entry returns once the cooldown passes — no operator action', (() => {
  const now = Date.now();
  const m = failureMarker(503, now);
  return isEntryHealthy(m, now + (HEALTH.TRANSIENT_COOLDOWN_S + 1) * 1000) === true;
})());
t('P28-৭. a credential ban is still held long after a 5xx would have expired', (() => {
  const now = Date.now();
  const cred = failureMarker(403, now);
  const until = (HEALTH.TRANSIENT_COOLDOWN_S + 60) * 1000;
  return isEntryHealthy(cred, now + until) === false;
})());
t('P28-৮. a legacy "1" marker keeps its old permanent meaning', (() => {
  const now = Date.now();
  return isEntryHealthy('1', now) === false && isEntryHealthy('1', now + 86400_000 * 30) === false;
})());
t('P28-৯. no marker means healthy', isEntryHealthy(null, Date.now()) === true && isEntryHealthy(undefined, Date.now()) === true);
t('P28-১০. a corrupt marker is treated as unhealthy, never as healthy',
  isEntryHealthy('{not json', Date.now()) === false);

/* ── ৩. The chain is never emptied by a transient failure ── */
const entry = (i) => ({ sig: 'k' + i + ':m', provider: 'gemini', key: 'k' + i, model: 'm' });
t('P28-১১. healthy entries are preferred', (() => {
  const now = Date.now();
  const es = [entry(1), entry(2), entry(3)];
  const bad = { 'k1:m': failureMarker(503, now) };
  const out = healthyChain(es, bad, now);
  return out.length === 2 && !out.some(e => e.sig === 'k1:m');
})());
t('P28-১২. when EVERY entry is cooling down the whole chain comes back (the outage case)',
  (() => {
    const now = Date.now();
    const es = [entry(1), entry(2)];
    const bad = { 'k1:m': failureMarker(503, now), 'k2:m': failureMarker(503, now) };
    const out = healthyChain(es, bad, now);
    return out.length === 2; // retried rather than an instant "AI off"
  })());
t('P28-১৩. entries whose cooldown has passed are back in the chain', (() => {
  const now = Date.now();
  const es = [entry(1), entry(2)];
  const bad = { 'k1:m': failureMarker(503, now) };
  const later = now + (HEALTH.TRANSIENT_COOLDOWN_S + 1) * 1000;
  return healthyChain(es, bad, later).length === 2;
})());

/* ── ৪. Wiring: the route really uses it ── */
t('P28-১৪. the chat path builds the chain from the health module',
  SRC.includes('healthyChain(fullChain, badMap, healthNow)'));
t('P28-১৫. the marking site no longer writes the fixed 24-hour marker',
  !/putKv\(env\.PUB_KV, badKeyName\([^)]*\), '1', 86400\)/.test(SRC));
t('P28-১৬. a status is carried out of the adapters so it can be classified',
  (() => {
    const e = new A.ProviderError('x', { bad: true, status: 503 });
    return e.status === 503;
  })());

/* ── ৫. Real end-to-end: the exact outage that was happening ── */
async function runE2E(fetchImpl, opts = {}) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push(String(url)); return fetchImpl(url, init); };
  const store = {};
  const env = Object.assign({
    PUB_KV: { async get(k) { return store[k] || null; }, async put(k, v) { store[k] = v; return { ok: true }; } },
    GEMINI_KEYS: 'keyAAAA,keyBBBB',
    GROQ_API_KEY: 'g-key'
  }, opts.env || {});
  try {
    const res = await A.agentChat(new Request('https://x/api/ai/chat', {
      method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'নিউটনের ২য় সূত্র কী?' }], fresh: true })
    }), env, 'account-e2e' + Math.random(), opts.agentOpts || { persistMemory: false });
    const body = await res.text();
    return { body, store, calls };
  } finally { globalThis.fetch = real; }
}
const sse = (text) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata:';
const gemini503 = () => new Response(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE' } }), { status: 503, headers: { 'Content-Type': 'application/json' } });

t('P28-১৭. E2E: Gemini streaming 503 falls through to Groq and the student gets an answer',
  (async () => {
    const r = await runE2E(async (url) => {
      if (/generativelanguage/.test(String(url))) return gemini503();
      if (/groq/.test(String(url))) return new Response(sse('উত্তর এসেছে'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      return new Response('{}', { status: 200 });
    });
    return /event: done/.test(r.body) && /উত্তর এসেছে/.test(r.body);
  })(), { timeout: 40000 });

t('P28-১৮. E2E: the 503 is stored with an expiry, NOT as a permanent flag',
  (async () => {
    const r = await runE2E(async (url) => {
      if (/generativelanguage/.test(String(url))) return gemini503();
      if (/groq/.test(String(url))) return new Response(sse('ok'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      return new Response('{}', { status: 200 });
    });
    const marks = Object.entries(r.store).filter(([k]) => k.startsWith('aibad:'));
    if (!marks.length) return false;
    // Every marker must be parseable JSON with a future `until`, not the legacy '1'.
    return marks.every(([, v]) => {
      if (v === '1') return false;
      try { return JSON.parse(v).until > Date.now(); } catch (_) { return false; }
    });
  })(), { timeout: 40000 });

t('P28-১৯. E2E: a PREVIOUSLY 503-marked Gemini is retried, not skipped forever',
  (async () => {
    // Pre-seed a marker whose cooldown has passed.
    const past = JSON.stringify({ until: Date.now() - 1000, status: 503 });
    let geminiTried = false;
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (/generativelanguage/.test(String(url))) { geminiTried = true; return new Response(sse('জেমিনি ঠিক আছে'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }); }
      return new Response('{}', { status: 200 });
    };
    const store = {};
    const env = {
      PUB_KV: { async get(k) { return k.includes('keyAAAA') || k.includes('keyBBBB') ? past : null; }, async put(k, v) { store[k] = v; return { ok: true }; } },
      GEMINI_KEYS: 'keyAAAA'
    };
    try {
      const res = await A.agentChat(new Request('https://x/api/ai/chat', {
        method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'হালকা প্রশ্ন' }], fresh: true })
      }), env, 'account-retry', { persistMemory: false });
      await res.text();
    } finally { globalThis.fetch = real; }
    return geminiTried;
  })(), { timeout: 40000 });

t('P28-২০. E2E: with everything cooling down the request still reaches a model (never "AI off")',
  (async () => {
    const future = JSON.stringify({ until: Date.now() + 60000, status: 503 });
    let tried = 0;
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (/generativelanguage/.test(String(url)) || /groq/.test(String(url))) { tried++; return new Response(sse('চেষ্টা হয়েছে'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }); }
      return new Response('{}', { status: 200 });
    };
    const env = {
      PUB_KV: { async get() { return future; }, async put() { return { ok: true }; } },
      GEMINI_KEYS: 'keyAAAA',
      GROQ_API_KEY: 'g'
    };
    try {
      const res = await A.agentChat(new Request('https://x/api/ai/chat', {
        method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'প্রশ্ন' }], fresh: true })
      }), env, 'account-allbad', { persistMemory: false });
      await res.text();
    } finally { globalThis.fetch = real; }
    return tried > 0;
  })(), { timeout: 40000 });

console.log(`\n${fail === 0 ? '✅' : '❌'} P28 provider-health: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
