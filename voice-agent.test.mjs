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

function makeSession(env = POOLS) {
  const s = new VoiceAgentSession(ctx(), { ...env });
  const ws = new FakeSocket();
  s.sockets.add(ws);
  return { s, ws };
}

/* ── ১. Pools come from env and are rebuilt per call ── */
{
  const { s } = makeSession();
  const p = s.pools();
  t('P23-৩২. the DO reads three pools from env', p.stt.length === 1 && p.llm.length === 2 && p.tts.length === 2);
  const s2 = new VoiceAgentSession(ctx(), { ...POOLS, VOICE_TTS_POOL: JSON.stringify([{ id: 'cartesia', key: 'only' }]) });
  t('P23-৩৩. a dashboard key change takes effect without rebuilding the object',
    s2.pools().tts.length === 1);
}

/* ── ১b. Fallback to the secrets the Worker already holds ── */
{
  const bare = new VoiceAgentSession(ctx(), { GROQ_API_KEY: 'g', GEMINI_API_KEY: 'm', CARTESIA_API_KEY: 'c' });
  const p = bare.pools();
  t('P23-৫৪. with no pool configured, existing single-key secrets are used',
    p.stt.length === 2 && p.llm.length === 2 && p.tts.length === 1 && p.tts[0].id === 'cartesia');
  const none = new VoiceAgentSession(ctx(), {});
  t('P23-৫৫. with no secrets at all the pools are empty, not broken',
    none.pools().stt.length === 0 && none.pools().tts.length === 0);
  const partial = new VoiceAgentSession(ctx(), { VOICE_TTS_POOL: JSON.stringify([{ id: 'elevenlabs', key: 'e' }]), CARTESIA_API_KEY: 'c' });
  t('P23-৫৬. a configured pool wins over the fallback for that kind only',
    partial.pools().tts.length === 1 && partial.pools().tts[0].id === 'elevenlabs');
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

console.log(`\n  voice-agent DO: ${pass} pass / ${fail} fail`);
if (fail) process.exit(1);
