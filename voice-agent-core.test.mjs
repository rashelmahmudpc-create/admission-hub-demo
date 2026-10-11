// 🎙️ P23 — Live Voice Agent core guards.
// Locks the promises made to the owner: a provider POOL with real failover, a
// session that can be interrupted, memory that survives a key/model swap, and
// no credential ever reaching a log line.
import { readFileSync } from 'fs';
import {
  VOICE_AGENT_VERSION, KIND, PROVIDERS, STATE,
  isFailoverStatus, sanitizeSecret, parsePool, parseProviderPools,
  runWithFailover, canTransition, createSession,
  buildSystemPrompt, buildMessages, foldSummary, splitSentences,
  validateVoiceAgentCore, MAX_SUMMARY_LEN, HISTORY_WINDOW,
  makeTicket, pruneTickets, consumeTicket, safeEqual, TICKET_TTL_MS,
} from './voice-agent-core.mjs';

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } };

/* ── ১. Engine shape ── */
t('P23-১. core self-validation is clean and the version is stamped',
  validateVoiceAgentCore().length === 0 && VOICE_AGENT_VERSION === 'voice-v1');
t('P23-২. three provider kinds, and every catalogued provider declares one',
  Object.values(KIND).length === 3 && Object.values(PROVIDERS).every(p => Object.values(KIND).includes(p.kind)));

/* ── ২. Failover decision ── */
t('P23-৩. quota/auth/upstream statuses all trigger failover',
  isFailoverStatus(429) && isFailoverStatus(402) && isFailoverStatus(401)
  && isFailoverStatus(403) && isFailoverStatus(500) && isFailoverStatus(503));
t('P23-৪. a bad request does NOT fail over (retrying it only burns quota)',
  !isFailoverStatus(400) && !isFailoverStatus(404) && !isFailoverStatus(422) && !isFailoverStatus(200) && !isFailoverStatus(undefined));

/* ── ৩. Secret hygiene ── */
t('P23-৫. provider-shaped secrets are scrubbed from anything loggable',
  sanitizeSecret('key sk-abcdefghijklmnop1234 end') === 'key [redacted] end'
  && sanitizeSecret('gsk_abcdefghijklmnop1234').includes('[redacted]')
  && sanitizeSecret('AIzaSyABCDEFGHIJKLMNOPQRSTUVWX').includes('[redacted]')
  && !sanitizeSecret('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9xx').includes('eyJhbGci'));
t('P23-৬. ordinary prose passes through untouched',
  sanitizeSecret('আজ পদার্থবিজ্ঞান পড়ব') === 'আজ পদার্থবিজ্ঞান পড়ব' && sanitizeSecret(null) === '');

/* ── ৪. Pool parsing ── */
const goodPool = parsePool(JSON.stringify([
  { id: 'cartesia', key: 'k1' },
  { id: 'cartesia-2', key: 'k2' },
  { id: 'elevenlabs', key: 'k3' },
]), KIND.TTS);
t('P23-৭. a valid TTS pool keeps all three keys in order',
  goodPool.length === 3 && goodPool[0].id === 'cartesia' && goodPool[1].id === 'cartesia-2' && goodPool[2].id === 'elevenlabs');
t('P23-৮. an entry of the wrong kind is dropped, not thrown on',
  parsePool('[{"id":"cartesia","key":"k"}]', KIND.LLM).length === 0
  && parsePool('[{"id":"groq-llama","key":"k"}]', KIND.LLM).length === 1);
t('P23-৯. missing credential / unknown id / bad JSON degrade to a shorter pool',
  parsePool('[{"id":"cartesia"}]', KIND.TTS).length === 0
  && parsePool('[{"id":"nope","key":"k"}]', KIND.TTS).length === 0
  && parsePool('{not json', KIND.TTS).length === 0
  && parsePool('', KIND.TTS).length === 0);
t('P23-১০. a duplicate provider id cannot occupy two slots',
  parsePool('[{"id":"cartesia","key":"k1"},{"id":"cartesia","key":"k2"}]', KIND.TTS).length === 1);
t('P23-১১. pools never carry a key into the label (labels are safe to show)',
  goodPool.every(p => !p.label.includes('k1') && !p.label.includes('k2')));
t('P23-১২. an empty config yields three empty pools, not undefined',
  (() => { const p = parseProviderPools({}); return Array.isArray(p.stt) && Array.isArray(p.llm) && Array.isArray(p.tts) && !p.stt.length; })());

/* ── ৫. Failover runner ── */
const pool = parsePool('[{"id":"cartesia","key":"a"},{"id":"cartesia-2","key":"b"},{"id":"elevenlabs","key":"c"}]', KIND.TTS);
const fail429 = () => { const e = new Error('quota'); e.status = 429; return Promise.reject(e); };

await (async () => {
  const notes = [];
  const first = await runWithFailover(pool, (p) => p.id === 'cartesia' ? fail429() : Promise.resolve('audio-' + p.id),
    n => notes.push(n));
  t('P23-১৩. a 429 on the first key silently falls through to the second',
    first.provider === 'cartesia-2' && first.result === 'audio-cartesia-2' && first.index === 1);
  t('P23-১৪. the failover is observable — provider, status and remaining are reported',
    notes.length === 1 && notes[0].provider === 'cartesia' && notes[0].status === 429
    && notes[0].failover === true && notes[0].remaining === 2);
  t('P23-১৫. the observability note carries no credential',
    notes.every(n => !String(n.reason).includes('key') && !JSON.stringify(n).includes('"a"')));

  const allDead = await runWithFailover(pool, fail429).then(() => null, e => e);
  t('P23-১৬. every key exhausted raises a 502 naming the failure',
    allDead && allDead.status === 502 && /all_providers_exhausted/.test(allDead.message));

  let calls = 0;
  const bad = await runWithFailover(pool, () => { calls++; const e = new Error('bad_request'); e.status = 400; return Promise.reject(e); })
    .then(() => null, e => e);
  t('P23-১৭. a 400 stops at the first key — one call, not three',
    bad && bad.status === 400 && calls === 1);

  const empty = await runWithFailover([], () => Promise.resolve('x')).then(() => null, e => e);
  t('P23-১৮. an unconfigured pool is a clear 503, not a crash',
    empty && empty.status === 503 && /no_provider_configured/.test(empty.message));

  const badHook = await runWithFailover(pool, (p) => p.id === 'cartesia' ? fail429() : Promise.resolve('ok'),
    () => { throw new Error('hook blew up'); }).then(r => r, () => null);
  t('P23-১৯. a throwing observability hook cannot break the call',
    badHook && badHook.provider === 'cartesia-2');
})();

/* ── ৬. Session state machine ── */
t('P23-২০. illegal transitions are refused',
  !canTransition(STATE.IDLE, STATE.SPEAKING) && !canTransition(STATE.CLOSED, STATE.IDLE)
  && canTransition(STATE.IDLE, STATE.LISTENING) && canTransition(STATE.SPEAKING, STATE.LISTENING));
t('P23-২১. a full turn walks idle→listening→thinking→speaking→idle',
  (() => {
    const s = createSession();
    s.beginTurn(); s.endListening('পড়াশোনা কেমন চলছে', 280); s.endThinking('ভালো চলছে স্যার', 480); s.endSpeaking(390);
    return s.state === STATE.IDLE && s.history.length === 2 && s.history[0].role === 'user' && s.history[1].role === 'agent';
  })());
t('P23-২২. barge-in cuts the agent off and returns to listening',
  (() => { const s = createSession(); s.beginTurn(); s.endListening('x', 100); s.endThinking('y', 100); s.interrupt(); return s.state === STATE.LISTENING; })());
t('P23-২৩. latency is recorded per turn and rollable up',
  (() => {
    const s = createSession();
    s.beginTurn(); s.endListening('a', 100); s.endThinking('b', 200); s.endSpeaking(300);
    s.beginTurn(); s.endListening('c', 100); s.endThinking('d', 200); s.endSpeaking(300);
    const st = s.stats();
    return st.turns === 2 && Number.isFinite(st.avgTotalMs) && Number.isFinite(st.p95TotalMs);
  })());
t('P23-২৪. an empty session reports no latency rather than zero',
  (() => { const s = createSession(); return s.stats().turns === 0 && s.stats().avgTotalMs === null; })());
t('P23-২৫. close is terminal and idempotent',
  (() => { const s = createSession(); s.close(); s.close(); return s.state === STATE.CLOSED; })());

/* ── ৭. Memory survives a swap ── */
t('P23-২৬. the system prompt addresses the owner as স্যার',
  buildSystemPrompt({}).includes('স্যার'));
t('P23-২৭. brain and long-term memory both reach the prompt',
  (() => { const p = buildSystemPrompt({ brain: 'BRAINMARK', memory: 'MEMMARK' }); return p.includes('BRAINMARK') && p.includes('MEMMARK'); })());
t('P23-২৮. a long conversation folds its oldest turns into the summary',
  (() => {
    const h = Array.from({ length: HISTORY_WINDOW + 5 }, (_, i) => ({ role: 'user', text: 't' + i, ts: i }));
    const { summary, folded } = foldSummary(h, '');
    return folded === 5 && summary.includes('t0') && summary.length <= MAX_SUMMARY_LEN;
  })());
t('P23-২৯. a short conversation folds nothing',
  foldSummary([{ role: 'user', text: 'a' }], 'keep').folded === 0);
t('P23-৩০. the model window is bounded, with the summary as prior context',
  (() => {
    const h = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'agent' : 'user', text: 'x' + i, ts: i }));
    const m = buildMessages(h, 'SUM');
    return m.length === HISTORY_WINDOW + 1 && m[0].content.includes('SUM') && m[m.length - 1].content === 'x39';
  })());
t('P23-৩১. nothing in the core hardcodes a provider key or a single-provider assumption',
  (() => {
    const src = readFileSync('voice-agent-core.mjs', 'utf8');
    return !/AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}/.test(src)
      && /parseProviderPools/.test(src) && /runWithFailover/.test(src);
  })());

/* ── ৮. Tickets: the socket is gated and a ticket is single-use ── */
const T0 = 1_000_000;
t('P23-৩২. a ticket is opaque and carries a short expiry',
  (() => { const tk = makeTicket(T0, () => 'abc'); return tk.id === 'abc' && tk.exp === T0 + TICKET_TTL_MS && TICKET_TTL_MS <= 120000; })());
t('P23-৩৩. two tickets are never the same', (() => {
  const a = makeTicket(T0), b = makeTicket(T0);
  return a.id !== b.id && a.id.length > 8;
})());
t('P23-৩৪. an expired ticket is pruned',
  (() => {
    const list = [{ id: 'old', exp: T0 - 1 }, { id: 'live', exp: T0 + 1000 }];
    const kept = pruneTickets(list, T0);
    return kept.length === 1 && kept[0].id === 'live';
  })());
t('P23-৩৫. junk in the ticket list cannot crash a prune',
  pruneTickets([null, {}, { id: 5 }, 'x'], T0).length === 0
  && pruneTickets(undefined, T0).length === 0);
t('P23-৩৬. a valid ticket is consumed exactly once',
  (() => {
    const list = [{ id: 'a', exp: T0 + 1000 }, { id: 'b', exp: T0 + 1000 }];
    const first = consumeTicket(list, 'a', T0);
    const second = consumeTicket(first.tickets, 'a', T0);
    return first.ok && first.tickets.length === 1 && !second.ok && second.reason === 'invalid';
  })());
t('P23-৩৭. a missing or unknown ticket is refused with a reason',
  (() => {
    const none = consumeTicket([], '', T0);
    const unknown = consumeTicket([], 'nope', T0);
    return !none.ok && none.reason === 'missing' && !unknown.ok && unknown.reason === 'invalid';
  })());
t('P23-৩৮. a ticket that expires between issue and use is refused',
  (() => {
    const list = [makeTicket(T0, () => 't')];
    const later = consumeTicket(list, 't', T0 + TICKET_TTL_MS + 1);
    return !later.ok && later.reason === 'invalid';
  })());
t('P23-৩৯. the token compare is length-safe and exact',
  safeEqual('abc', 'abc') && !safeEqual('abc', 'abd') && !safeEqual('abc', 'ab') && !safeEqual('', 'x')
  && safeEqual(null, null));

/* ── Sentence streaming (the "too slow" fix) ── */
t('P23-৪০. a short reply is spoken whole, in one chunk',
  splitSentences('হ্যাঁ স্যার।').length === 1);
t('P23-৪১. a long reply splits on Bengali দাঁড়ি so the first part is heard early',
  (() => { const s = splitSentences('প্রথম বাক্য এখানে অনেক লম্বা করে লিখছি। দ্বিতীয় বাক্যটিও বেশ লম্বা করে লিখছি যাতে ভাগ হয়।', 20);
    return s.length >= 2 && s[0].includes('প্রথম'); })());
t('P23-৪২. no chunk exceeds the limit, and nothing is lost',
  (() => { const text = 'এক। দুই। তিন। চার। পাঁচ। ছয়। সাত। আট।';
    const s = splitSentences(text, 12);
    return s.every(c => c.length <= 12) && s.join(' ').replace(/\s+/g, '') === text.replace(/\s+/g, ''); })());
t('P23-৪৩. empty or missing text yields no chunk rather than a blank clip',
  splitSentences('').length === 0 && splitSentences(null).length === 0 && splitSentences('   ').length === 0);

/* ── The owner's named voice and the gateway provider ── */
t('P23-৪৪. the default Bengali voice is the MASCULINE "Rubel" the owner asked for',
  (() => { const src = readFileSync('voice-agent-providers.mjs', 'utf8');
    return /CARTESIA_VOICE_BN = '2ba861ea-7cdc-43d1-8608-4045b5a41de5'/.test(src)
      && !/db6b0ed5/.test(src); })());
t('P23-৪৫. an OpenAI-compatible provider exists so a stronger model can be pointed at without a code change',
  Boolean(PROVIDERS['openai-compat']) && PROVIDERS['openai-compat'].kind === KIND.LLM);

console.log(`\n  voice-agent-core: ${pass} pass / ${fail} fail`);
if (fail) process.exit(1);
