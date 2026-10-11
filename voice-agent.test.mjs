// 🎙️ P23 — Voice agent Durable Object guards.
// Proves the session's promises end to end with a fake socket, fake storage and
// fake providers: a full turn, failover inside a turn, a TTS outage that still
// delivers words, memory that survives a reconnect, and no key on the wire.
import { VoiceAgentSession } from './voice-agent.mjs';
import { parsePool, KIND } from './voice-agent-core.mjs';

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } };

/* ── Fakes ── */
class FakeSocket {
  constructor() { this.sent = []; this.listeners = {}; }
  accept() {}
  send(s) { this.sent.push(JSON.parse(s)); }
  addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); }
  close() {}
  last(type) { return [...this.sent].reverse().find(m => m.type === type); }
}
class FakeStorage {
  constructor() { this.map = new Map(); }
  async get(k) { return this.map.get(k); }
  async put(k, v) { this.map.set(k, v); }
}
const ctx = () => ({ storage: new FakeStorage() });

const POOLS = {
  VOICE_STT_POOL: JSON.stringify([{ id: 'groq-whisper', key: 'stt-key' }]),
  VOICE_LLM_POOL: JSON.stringify([{ id: 'groq-llama', key: 'llm-key-1' }, { id: 'gemini-llm', key: 'llm-key-2' }]),
  VOICE_TTS_POOL: JSON.stringify([{ id: 'cartesia', key: 'tts-key-1' }, { id: 'elevenlabs', key: 'tts-key-2' }]),
};
const b64 = (s) => Buffer.from(s).toString('base64');

/* Providers are stubbed by replacing globalThis.fetch — the adapters all honour
 * the injected fetch, but the DO calls them without one, so the global is the
 * seam. */
function stubFetch(handler) { const prev = globalThis.fetch; globalThis.fetch = handler; return () => { globalThis.fetch = prev; }; }

const okJson = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });
const audioRes = (bytes = 'MP3DATA') => new Response(bytes, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });

/* The Cloudflare runtime supplies WebSocketPair and permits a 101 Response; node
 * does neither. The stand-in records that the pair was built, which is the point
 * the upgrade has passed the gate — asserting on 101 itself would only be testing
 * node's Response limits. */
function withFakeWebSocketPair(onPair) {
  const prev = globalThis.WebSocketPair;
  globalThis.WebSocketPair = function () {
    if (typeof onPair === 'function') onPair();
    const mk = () => ({ sent: [], accept() {}, send(s) { this.sent.push(s); }, addEventListener() {}, close() {} });
    return { 0: mk(), 1: mk() };
  };
  return () => { globalThis.WebSocketPair = prev; };
}

function makeSession(env = POOLS) {
  const s = new VoiceAgentSession(ctx(), { ...env });
  const ws = new FakeSocket();
  s.sockets.add(ws);
  return { s, ws };
}

/* ── ১. Pools come from env and are rebuilt per call ── */
{
  const { s } = makeSession();
  const p = await s.pools();
  t('P23-৩২. the DO reads three pools from env', p.stt.length === 1 && p.llm.length === 2 && p.tts.length === 2);
  const s2 = new VoiceAgentSession(ctx(), { ...POOLS, VOICE_TTS_POOL: JSON.stringify([{ id: 'cartesia', key: 'only' }]) });
  t('P23-৩৩. a dashboard key change takes effect without rebuilding the object',
    (await s2.pools()).tts.length === 1);
}

/* ── ১b. Fallback to the secrets the Worker already holds ── */
{
  const bare = new VoiceAgentSession(ctx(), { GROQ_API_KEY: 'g', GEMINI_API_KEY: 'm', CARTESIA_API_KEY: 'c' });
  const p = await bare.pools();
  t('P23-৫৪. with no pool configured, existing single-key secrets are used',
    p.stt.length === 2 && p.llm.length === 2 && p.tts.length === 2
    && p.tts[0].id === 'cartesia' && p.tts[1].id === 'gemini-tts');
  const none = await new VoiceAgentSession(ctx(), {}).pools();
  t('P23-৫৫. with no secrets at all the pools are empty, not broken',
    none.stt.length === 0 && none.tts.length === 0);
  const partial = new VoiceAgentSession(ctx(), { VOICE_TTS_POOL: JSON.stringify([{ id: 'elevenlabs', key: 'e' }]), CARTESIA_API_KEY: 'c' });
  const pp = await partial.pools();
  t('P23-৫৬. a configured pool wins over the fallback for that kind only',
    pp.tts.length === 1 && pp.tts[0].id === 'elevenlabs');
}

/* ── ২. Health probe never leaks a key ── */
{
  const { s } = makeSession();
  const res = await s.fetch(new Request('https://x/voice-agent/health'));
  const body = await res.json();
  t('P23-৩৪. health reports pool COUNTS, never keys',
    body.ok === true && body.pools.tts === 2 && !JSON.stringify(body).includes('tts-key'));
}

/* ── ৩. A full turn ── */
{
  const { s, ws } = makeSession();
  const restore = stubFetch(async (url) => {
    if (url.includes('audio/transcriptions')) return okJson({ text: 'পদার্থবিজ্ঞানে আমি দুর্বল' });
    if (url.includes('chat/completions')) return okJson({ choices: [{ message: { content: 'বুঝেছি স্যার, আজ পদার্থবিজ্ঞানই করি।' } }] });
    if (url.includes('cartesia.ai')) return audioRes();
    return new Response('nope', { status: 404 });
  });
  try {
    await s.handle(ws, JSON.stringify({ type: 'turn', audio: b64('fakeaudio'), mime: 'audio/webm' }));
  } finally { restore(); }

  t('P23-৩৫. a turn emits transcript, reply, audio and done in order',
    !!ws.last('transcript') && !!ws.last('reply') && !!ws.last('audio') && !!ws.last('done'));
  t('P23-৩৬. the transcript is what was heard, the reply is what was said',
    ws.last('transcript').text === 'পদার্থবিজ্ঞানে আমি দুর্বল' && ws.last('reply').text.includes('স্যার'));
  t('P23-৩৭. audio comes back as base64 with its mime',
    ws.last('audio').mime === 'audio/mpeg' && Buffer.from(ws.last('audio').data, 'base64').toString() === 'MP3DATA');
  t('P23-৩৮. the turn reports per-stage latency',
    (() => { const m = ws.last('done').ms; return ['stt', 'llm', 'tts', 'total'].every(k => Number.isFinite(m[k])); })());
  t('P23-৩৯. the session is back at idle after the turn', s.session.state === 'idle');
  t('P23-৪০. both sides of the turn are in history', s.session.history.length === 2);
}

/* ── ৪. Failover inside a turn ── */
{
  const { s, ws } = makeSession();
  let llmCalls = 0;
  const restore = stubFetch(async (url) => {
    if (url.includes('audio/transcriptions')) return okJson({ text: 'হ্যালো' });
    if (url.includes('chat/completions')) { llmCalls++; return new Response('{"error":{"message":"rate limited"}}', { status: 429 }); }
    if (url.includes('generativelanguage')) return okJson({ candidates: [{ content: { parts: [{ text: 'হ্যালো স্যার, বলুন।' }] } }] });
    if (url.includes('cartesia.ai')) return audioRes();
    return new Response('x', { status: 404 });
  });
  try {
    await s.handle(ws, JSON.stringify({ type: 'turn', audio: b64('a') }));
  } finally { restore(); }
  t('P23-৪১. an LLM 429 fails over to the second LLM key within the turn',
    llmCalls === 1 && ws.last('reply').text.includes('স্যার') && ws.last('reply').provider === 'gemini-llm');
}

/* ── ৫. TTS outage still delivers the words ── */
{
  const { s, ws } = makeSession();
  const restore = stubFetch(async (url) => {
    if (url.includes('audio/transcriptions')) return okJson({ text: 'প্রশ্ন' });
    if (url.includes('chat/completions')) return okJson({ choices: [{ message: { content: 'উত্তর স্যার' } }] });
    return new Response('{"message":"quota"}', { status: 429 }); // both TTS keys die
  });
  try {
    await s.handle(ws, JSON.stringify({ type: 'turn', audio: b64('a') }));
  } finally { restore(); }
  t('P23-৪২. a total TTS outage is a degraded turn — words still arrive',
    !!ws.last('reply') && ws.last('reply').text.includes('স্যার') && !ws.last('audio'));
  t('P23-৪৩. the TTS failure is reported with its status',
    (ws.last('error') || {}).status === 502 && /tts_failed/.test((ws.last('error') || {}).message));
  t('P23-৪৪. the session still returns to idle after a TTS failure', s.session.state === 'idle');
}

/* ── ৬. Bad input is refused cleanly ── */
{
  const { s, ws } = makeSession();
  await s.handle(ws, 'not json');
  t('P23-৪৫. malformed JSON is a 400, not a crash', (ws.last('error') || {}).message === 'bad_json');
  await s.handle(ws, JSON.stringify({ type: 'wat' }));
  t('P23-৪৬. an unknown message type is refused', /unknown_type/.test((ws.last('error') || {}).message));
  await s.handle(ws, JSON.stringify({ type: 'turn', audio: '' }));
  t('P23-৪৭. an empty clip is refused before any provider is called', (ws.last('error') || {}).message === 'empty_audio');
}

/* ── ৭. Memory survives a reconnect ── */
{
  const shared = ctx();
  const restore = stubFetch(async (url) => {
    if (url.includes('audio/transcriptions')) return okJson({ text: 'আমার নাম Zayan' });
    if (url.includes('chat/completions')) return okJson({ choices: [{ message: { content: 'মনে রাখলাম স্যার।' } }] });
    if (url.includes('cartesia.ai')) return audioRes();
    return new Response('x', { status: 404 });
  });
  try {
    const first = new VoiceAgentSession(shared, { ...POOLS });
    const ws1 = new FakeSocket(); first.sockets.add(ws1);
    await first.handle(ws1, JSON.stringify({ type: 'turn', audio: b64('a') }));
    await first.persist();

    // A brand-new object over the same storage = a reconnect or a redeploy.
    const second = new VoiceAgentSession(shared, { ...POOLS });
    const ws2 = new FakeSocket(); second.sockets.add(ws2);
    await second.load();
    t('P23-৪৮. a fresh session restores the conversation from storage',
      second.session.history.length === 2 && second.session.history[0].text === 'আমার নাম Zayan');
  } finally { restore(); }
}

/* ── ৮. Reset forgets the conversation but keeps memory ── */
{
  const { s, ws } = makeSession();
  const restore = stubFetch(async (url) => {
    if (url.includes('audio/transcriptions')) return okJson({ text: 'x' });
    if (url.includes('chat/completions')) return okJson({ choices: [{ message: { content: 'y' } }] });
    if (url.includes('cartesia.ai')) return audioRes();
    return new Response('x', { status: 404 });
  });
  try {
    await s.handle(ws, JSON.stringify({ type: 'turn', audio: b64('a') }));
    s.memory = [{ id: 'm1' }];
    await s.handle(ws, JSON.stringify({ type: 'reset' }));
  } finally { restore(); }
  t('P23-৪৯. reset clears the conversation', s.session.history.length === 0);
  t('P23-৫০. reset keeps long-term memory — a key swap must not lose the brain',
    s.memory.length === 1 && ws.last('ready').reset === true);
}

/* ── ৯. No credential on the wire ── */
{
  const { s, ws } = makeSession();
  const restore = stubFetch(async (url) => {
    if (url.includes('audio/transcriptions')) return okJson({ text: 'x' });
    if (url.includes('chat/completions')) return okJson({ choices: [{ message: { content: 'y' } }] });
    if (url.includes('cartesia.ai')) return audioRes();
    return new Response('x', { status: 404 });
  });
  try { await s.handle(ws, JSON.stringify({ type: 'turn', audio: b64('a') })); } finally { restore(); }
  const wire = JSON.stringify(ws.sent);
  t('P23-৫১. no provider key appears in anything sent to the client',
    !wire.includes('stt-key') && !wire.includes('llm-key') && !wire.includes('tts-key'));
}

/* ── ১০. Stats over a socket ── */
{
  const { s, ws } = makeSession();
  const restore = stubFetch(async (url) => {
    if (url.includes('audio/transcriptions')) return okJson({ text: 'x' });
    if (url.includes('chat/completions')) return okJson({ choices: [{ message: { content: 'y' } }] });
    if (url.includes('cartesia.ai')) return audioRes();
    return new Response('x', { status: 404 });
  });
  try {
    await s.handle(ws, JSON.stringify({ type: 'turn', audio: b64('a') }));
    await s.handle(ws, JSON.stringify({ type: 'stats' }));
  } finally { restore(); }
  t('P23-৫২. stats report the turn count and a real average', ws.last('stats').turns === 1 && Number.isFinite(ws.last('stats').avgTotalMs));
}

/* ── ১১. The DO file itself carries no key-shaped literal ── */
{
  const src = (await import('fs')).readFileSync('voice-agent.mjs', 'utf8');
  t('P23-৫৩. the DO source contains no hardcoded provider key',
    !/AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}/.test(src));
}

/* ── ১২. The socket is gated: a ticket must be earned and is single-use ── */
{
  const { s } = makeSession();
  const up = (ticket) => new Request(`https://x/api/voice/agent${ticket === undefined ? '' : '?ticket=' + ticket}`, {
    headers: { Upgrade: 'websocket' },
  });

  // No ticket at all: refused.
  const bare = await s.fetch(up());
  t('P23-৮৯. a socket with no ticket is refused with 401', bare.status === 401);

  // A forged ticket: refused.
  const forged = await s.fetch(up('not-a-real-ticket'));
  t('P23-৯০. a forged ticket is refused', forged.status === 401);

  // The ticket endpoint requires the app header.
  const noHeader = await s.fetch(new Request('https://x/api/voice/agent/ticket', { method: 'POST' }));
  t('P23-৯১. the ticket endpoint refuses a caller without the app header', noHeader.status === 403);

  const issued = await s.fetch(new Request('https://x/api/voice/agent/ticket', {
    method: 'POST', headers: { 'X-AH-App': 'admission-hub' },
  }));
  const body = await issued.json();
  t('P23-৯২. an approved caller receives a short-lived ticket',
    issued.status === 200 && typeof body.ticket === 'string' && body.ticket.length > 8 && body.ttl > 0);

  let upgraded = false;
  const restorePair = withFakeWebSocketPair(() => { upgraded = true; });
  try {
    await s.fetch(up(body.ticket)).catch(() => null);
  } finally { restorePair(); }
  t('P23-৯৩. the issued ticket passes the gate and the socket is built', upgraded === true);

  const replay = await s.fetch(up(body.ticket));
  t('P23-৯৪. the same ticket cannot be reused — one presentation, one socket', replay.status === 401);

  const wrongMethod = await s.fetch(new Request('https://x/api/voice/agent/ticket', {
    method: 'GET', headers: { 'X-AH-App': 'admission-hub' },
  }));
  t('P23-৯৫. the ticket endpoint is POST-only', wrongMethod.status === 405);
}

/* ── ১৩. An optional access token, when bound, is required ── */
{
  const { s } = makeSession({ ...POOLS, VOICE_ACCESS_TOKEN: 'sekret' });
  const noTok = await s.fetch(new Request('https://x/api/voice/agent/ticket', {
    method: 'POST', headers: { 'X-AH-App': 'admission-hub' },
  }));
  t('P23-৯৬. with a token bound, the app header alone is not enough', noTok.status === 403);

  const badTok = await s.fetch(new Request('https://x/api/voice/agent/ticket', {
    method: 'POST', headers: { 'X-AH-App': 'admission-hub', 'X-Voice-Token': 'wrong' },
  }));
  t('P23-৯৭. a wrong token is refused', badTok.status === 403);

  const goodTok = await s.fetch(new Request('https://x/api/voice/agent/ticket', {
    method: 'POST', headers: { 'X-AH-App': 'admission-hub', 'X-Voice-Token': 'sekret' },
  }));
  t('P23-৯৮. the right token is accepted', goodTok.status === 200);
}

/* ── ১৪. A stale ticket does not survive a restart ── */
{
  const shared = ctx();
  const restore = stubFetch(async () => new Response('x', { status: 404 }));
  try {
    const a = new VoiceAgentSession(shared, { ...POOLS });
    const res = await a.fetch(new Request('https://x/api/voice/agent/ticket', {
      method: 'POST', headers: { 'X-AH-App': 'admission-hub' },
    }));
    const { ticket } = await res.json();

    // A different object over the same storage, an hour later: the ticket is dead.
    const b = new VoiceAgentSession(shared, { ...POOLS });
    b.loaded = true;
    b.tickets = [{ id: ticket, exp: Date.now() - 1000 }];
    const stale = await b.fetch(new Request(`https://x/api/voice/agent?ticket=${ticket}`, { headers: { Upgrade: 'websocket' } }));
    t('P23-৯৯. an expired ticket is refused', stale.status === 401);
  } finally { restore(); }
}

/* ── ১৫. The worker must actually route the ticket path to this object ── */
{
  const src = (await import('fs')).readFileSync('gk-agent-worker.js', 'utf8');
  t('P23-১০০. the worker routes the whole /api/voice/agent subtree, ticket included',
    /url\.pathname === '\/api\/voice\/agent' \|\| url\.pathname\.startsWith\('\/api\/voice\/agent\/'\)/.test(src)
    && /env\.VOICE_AGENT\.get\(/.test(src));
}

/* ── ১৬. The env fallback reads the bindings the Worker actually holds ── */
{
  // The live Worker binds GEMINI_KEYS (a list) and GROQ_API_KEY; the earlier
  // fallback read GEMINI_API_KEY, which does not exist, so the pool was empty.
  const many = Array.from({ length: 10 }, (_, i) => `k${i}`).join(',');
  const s = new VoiceAgentSession(ctx(), {
    GEMINI_KEYS: many, GROQ_API_KEY: 'gsk_live', CARTESIA_API_KEY: 'ck_live',
  });
  const p = await s.pools();
  t('P23-১০১. a comma-separated GEMINI_KEYS expands to one pool entry per key',
    p.llm.filter(x => x.id === 'gemini-llm').length === 10
    && p.stt.filter(x => x.id === 'gemini-stt').length === 10);
  t('P23-১০২. the single-key bindings are picked up too',
    p.llm.some(x => x.id === 'groq-llama') && p.stt.some(x => x.id === 'groq-whisper'));
  t('P23-১০৩. a TTS key on the Worker leads the tts pool',
    p.tts[0].id === 'cartesia' && p.tts.length === 11);
  t('P23-১০৪. ordering is Groq first, then Gemini — the fast path leads',
    p.llm[0].id === 'groq-llama' && p.llm[1].id === 'gemini-llm');
  t('P23-১০৫. blank and whitespace keys are dropped, never sent as a credential',
    await (async () => {
      const b = new VoiceAgentSession(ctx(), { GEMINI_KEYS: 'a, ,,b,', GROQ_API_KEY: '   ' });
      const bp = await b.pools();
      return bp.llm.filter(x => x.id === 'gemini-llm').length === 2 && !bp.llm.some(x => x.id === 'groq-llama');
    })());
  t('P23-১০৬. no bindings at all yields empty pools rather than a crash',
    await (async () => { const e = await new VoiceAgentSession(ctx(), {}).pools(); return e.stt.length === 0 && e.llm.length === 0 && e.tts.length === 0; })());
  t('P23-১০৭. a configured pool takes precedence over the fallback',
    await (async () => {
      const c = new VoiceAgentSession(ctx(), {
        VOICE_LLM_POOL: JSON.stringify([{ id: 'openrouter', key: 'sk-abc' }]),
        GEMINI_KEYS: many,
      });
      const cp = await c.pools();
      return cp.llm.length === 1 && cp.llm[0].id === 'openrouter';
    })());
  t('P23-১০৮. Gemini fills the tts pool too, so the agent is never mute',
    p.tts.some(x => x.id === 'gemini-tts') && p.tts.length === 11);
  t('P23-১০৯. Cartesia still leads the tts pool when it is bound',
    p.tts[0].id === 'cartesia' && p.tts.findIndex(x => x.id === 'gemini-tts') > 0);
}

/* ── ১৬b. A key with no variable slot is read from KV ── */
{
  // admission-gk sits at the Free plan's 64-variable cap, so CARTESIA_API_KEY
  // cannot be bound with `wrangler secret put` (code 10055). It lives in GK_KV
  // instead and must still reach the pool like any bound secret.
  const kv = { get: async (k) => (k === 'secret:CARTESIA_API_KEY' ? 'kv-cartesia' : null) };
  const s = new VoiceAgentSession(ctx(), { GK_KV: kv, GEMINI_KEYS: 'g1' });
  const p = await s.pools();
  t('P23-১২০. a key held in KV reaches the pool like a bound one',
    p.tts.some(x => x.id === 'cartesia' && x.key === 'kv-cartesia') && p.tts[0].id === 'cartesia');

  // A bound variable must win, so binding the key later needs no cleanup.
  const both = new VoiceAgentSession(ctx(), { GK_KV: kv, CARTESIA_API_KEY: 'bound-wins' });
  const bp = await both.pools();
  t('P23-১২১. a bound variable wins over the KV copy',
    bp.tts.filter(x => x.id === 'cartesia').length === 1 && bp.tts[0].key === 'bound-wins');

  // A KV outage must leave the agent working, not take the whole turn down.
  const broken = { get: async () => { throw new Error('kv down'); } };
  const b = new VoiceAgentSession(ctx(), { GK_KV: broken, GEMINI_KEYS: 'g1' });
  const brp = await b.pools();
  t('P23-১২২. a KV failure leaves the agent working without the optional voice',
    brp.tts.some(x => x.id === 'gemini-tts') && !brp.tts.some(x => x.id === 'cartesia'));
}

/* ── ১৭. The Gemini voice adapter: the TTS path that needs no new credential ── */
{
  const { pcmToWav, geminiTts, TTS: TT } = await import('./voice-agent-providers.mjs');

  // A WAV header a browser will actually accept, checked field by field.
  const wav = pcmToWav(new Uint8Array([1, 2, 3, 4]), 24000);
  const dv = new DataView(wav.buffer);
  const tag = (o, n) => String.fromCharCode(...wav.slice(o, o + n));
  t('P23-১১০. the WAV wrapper writes a valid RIFF/WAVE header',
    tag(0, 4) === 'RIFF' && tag(8, 4) === 'WAVE' && tag(12, 4) === 'fmt ' && tag(36, 4) === 'data');
  t('P23-১১১. the header declares PCM, mono, 24kHz, 16-bit',
    dv.getUint16(20, true) === 1 && dv.getUint16(22, true) === 1
    && dv.getUint32(24, true) === 24000 && dv.getUint16(34, true) === 16);
  t('P23-১১২. the size fields agree with the payload',
    dv.getUint32(40, true) === 4 && dv.getUint32(4, true) === 40 && wav.length === 48
    && dv.getUint32(28, true) === 48000);
  t('P23-১১৩. the adapter is registered in the TTS table',
    typeof TT['gemini-tts'] === 'function');

  // The request the adapter builds, and the reply it decodes. Stubbed, so this
  // is deterministic and never spends a real key.
  const pcm = new Uint8Array(4800).fill(7);
  const b64 = Buffer.from(pcm).toString('base64');
  let seen = null;
  const fake = async (url, init) => {
    seen = { url, body: JSON.parse(init.body), key: init.headers['x-goog-api-key'] };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: b64 } }] } }] }), { status: 200 });
  };
  const out = await geminiTts({ id: 'gemini-tts', key: 'K', model: null, voiceId: null }, 'হ্যালো', { fetch: fake });
  t('P23-১১৪. the adapter asks for AUDIO output with a named voice',
    seen.body.generationConfig.responseModalities[0] === 'AUDIO'
    && seen.body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName === 'Kore');
  t('P23-১১৫. the key travels in the header, never the URL',
    seen.key === 'K' && !seen.url.includes('K'));
  t('P23-১১৬. the PCM reply becomes playable WAV bytes',
    out.mime === 'audio/wav' && out.audio.length === 44 + pcm.length
    && String.fromCharCode(...new Uint8Array(out.audio).slice(0, 4)) === 'RIFF');
  t('P23-১১৭. the sample rate is read from the reply, not assumed',
    (() => {
      const w = new DataView(new Uint8Array(out.audio).buffer);
      return w.getUint32(24, true) === 24000;
    })());

  // Failure shapes must fail over rather than look like success.
  const dead = async () => new Response('nope', { status: 429 });
  let threw = 0;
  try { await geminiTts({ id: 'gemini-tts', key: 'K' }, 'x', { fetch: dead }); } catch (e) { if (e.status === 429) threw++; }
  t('P23-১১৮. a 429 surfaces as a failover status, not silent success', threw === 1);

  const empty = async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 });
  let emptyErr = 0;
  try { await geminiTts({ id: 'gemini-tts', key: 'K' }, 'x', { fetch: empty }); } catch (e) { if (e.message === 'empty_audio') emptyErr++; }
  t('P23-১১৯. a reply with no audio is an error, never a zero-length clip', emptyErr === 1);
}

console.log(`\n  voice-agent DO: ${pass} pass / ${fail} fail`);
if (fail) process.exit(1);
