/**
 * 🎙️ P23 — LIVE VOICE AGENT · DURABLE OBJECT
 *
 * One instance per owner. Holds the WebSocket for a conversation and owns the
 * durable memory, so the session can be torn down and rebuilt without losing
 * context — the property the owner asked for when swapping provider keys.
 *
 * Transport only: every decision (failover, transitions, prompt assembly) lives
 * in voice-agent-core.mjs, which is tested without a network.
 *
 * Stage 1 scope, stated honestly: a turn is STT → LLM → TTS, with the audio
 * returned as one clip. Chunk-level streaming and true barge-in arrive in
 * stage 4; the session already records an `interrupt` so the state machine is
 * ready for it.
 *
 * Wire protocol (JSON over the socket):
 *   → {type:'turn',    audio:<base64>, mime:'audio/webm'}
 *   → {type:'interrupt'}
 *   → {type:'stats'}
 *   → {type:'reset'}                       // forget this conversation, keep memory
 *   ← {type:'ready',   pools:{stt,llm,tts}}   // provider COUNTS only, never keys
 *   ← {type:'transcript', text}
 *   ← {type:'reply',   text}
 *   ← {type:'audio',   data:<base64>, mime}
 *   ← {type:'done',    ms:{stt,llm,tts,total}}
 *   ← {type:'error',   message, status}
 */

import {
  VOICE_AGENT_VERSION, createSession, parseProviderPools, runWithFailover,
  buildSystemPrompt, buildMessages, foldSummary, sanitizeSecret, STATE,
} from './voice-agent-core.mjs';
import { STT, LLM, TTS, pickAdapter } from './voice-agent-providers.mjs';
import { renderMemory, upsertMemory, extractMemoryCandidates, makeMemory, resolveMemoryOwner } from './memory-engine.js';

const HISTORY_KEY = 'va_history';
const SUMMARY_KEY = 'va_summary';
const MEMORY_KEY = 'va_memory';
const MAX_STORED_TURNS = 200;

/**
 * Build a one-entry pool from a single-key secret the Worker already holds.
 * This is what makes the agent usable before any new secret is created; it is
 * deliberately read-only over `env` and never invents a credential.
 */
function fallbackPool(env, kind) {
  const map = {
    stt: [
      { env: 'GROQ_API_KEY', id: 'groq-whisper' },
      { env: 'GEMINI_API_KEY', id: 'gemini-stt' },
    ],
    llm: [
      { env: 'GROQ_API_KEY', id: 'groq-llama' },
      { env: 'GEMINI_API_KEY', id: 'gemini-llm' },
    ],
    tts: [
      { env: 'CARTESIA_API_KEY', id: 'cartesia' },
      { env: 'ELEVENLABS_API_KEY', id: 'elevenlabs' },
    ],
  };
  const out = [];
  for (const entry of map[kind] || []) {
    const key = env && env[entry.env];
    if (typeof key === 'string' && key.trim()) {
      out.push(Object.freeze({ id: entry.id, key: key.trim(), model: null, voiceId: null }));
    }
  }
  return out;
}

/* base64 <-> bytes without Buffer, so one implementation serves Worker + tests. */
function toBase64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
function fromBase64(b64) {
  const bin = atob(String(b64 || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class VoiceAgentSession {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.session = null;
    this.sockets = new Set();
    this.ownerUid = null;
    this.brain = '';
    this.memory = [];
    this.loaded = false;
  }

  /* ── HTTP entry: upgrade to a socket, or answer a health probe ── */
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/health')) {
      const pools = this.pools();
      return Response.json({
        ok: true,
        version: VOICE_AGENT_VERSION,
        pools: { stt: pools.stt.length, llm: pools.llm.length, tts: pools.tts.length },
      });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }

    await this.load();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sockets.add(server);

    server.addEventListener('message', (ev) => {
      this.handle(server, ev.data).catch((e) => {
        this.send(server, { type: 'error', message: sanitizeSecret(e && e.message).slice(0, 200), status: e && e.status || 500 });
      });
    });
    const drop = () => { this.sockets.delete(server); this.persist(); };
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);

    this.send(server, {
      type: 'ready',
      version: VOICE_AGENT_VERSION,
      pools: (() => { const p = this.pools(); return { stt: p.stt.length, llm: p.llm.length, tts: p.tts.length }; })(),
      resumed: this.session ? this.session.history.length : 0,
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  /* ── Provider pools, rebuilt from env on every use so a new dashboard key
   *    takes effect without a redeploy of this object's state.
   *
   *    A configured pool wins. When a pool is absent the object falls back to
   *    the single-key secrets the Worker already holds, so the agent is usable
   *    before any new secret exists. Adding a pool later upgrades it to the
   *    multi-key behaviour without a code change. ── */
  pools() {
    const configured = parseProviderPools({
      stt: this.env.VOICE_STT_POOL,
      llm: this.env.VOICE_LLM_POOL,
      tts: this.env.VOICE_TTS_POOL,
    });
    return {
      stt: configured.stt.length ? configured.stt : fallbackPool(this.env, 'stt'),
      llm: configured.llm.length ? configured.llm : fallbackPool(this.env, 'llm'),
      tts: configured.tts.length ? configured.tts : fallbackPool(this.env, 'tts'),
    };
  }

  /* ── Durable memory ── */
  async load() {
    if (this.loaded) return;
    const history = await this.ctx.storage.get(HISTORY_KEY);
    const summary = await this.ctx.storage.get(SUMMARY_KEY);
    const memory = await this.ctx.storage.get(MEMORY_KEY);

    this.session = createSession();
    this.session.restore(history, summary, MAX_STORED_TURNS);
    this.memory = Array.isArray(memory) ? memory : [];
    this.brain = String(this.env.VOICE_BRAIN || '');
    this.loaded = true;
  }

  async persist() {
    if (!this.session) return;
    try {
      await this.ctx.storage.put(HISTORY_KEY, this.session.history.slice(-MAX_STORED_TURNS));
      await this.ctx.storage.put(SUMMARY_KEY, this.session.summary);
      await this.ctx.storage.put(MEMORY_KEY, this.memory.slice(-500));
    } catch (_) { /* persistence is best-effort; the socket must not fail on it */ }
  }

  send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch (_) { /* socket already gone */ }
  }

  async handle(ws, raw) {
    await this.load();
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return this.send(ws, { type: 'error', message: 'bad_json', status: 400 }); }
    const type = msg && msg.type;

    if (type === 'reset') {
      this.session = createSession();
      await this.persist();
      return this.send(ws, { type: 'ready', reset: true });
    }

    if (type === 'stats') return this.send(ws, { type: 'stats', ...this.session.stats() });

    if (type === 'interrupt') {
      this.session.interrupt();
      return this.send(ws, { type: 'interrupted', state: this.session.state });
    }

    if (type === 'turn') return this.runTurn(ws, msg);

    return this.send(ws, { type: 'error', message: 'unknown_type:' + type, status: 400 });
  }

  /* ── The turn: STT → LLM → TTS, each step through the pool ── */
  async runTurn(ws, msg) {
    const pools = this.pools();
    const now = () => Date.now();
    const clock = { t0: now() };

    this.session.beginTurn();

    /* 1. Speech → text */
    const audio = fromBase64(msg.audio);
    if (!audio.byteLength) { this.session.transition(STATE.IDLE); return this.send(ws, { type: 'error', message: 'empty_audio', status: 400 }); }

    const sttRun = await runWithFailover(pools.stt, (p) =>
      pickAdapter(STT, p)(p, audio, { mime: msg.mime || 'audio/webm', base64: msg.audio }));
    const sttMs = now() - clock.t0;
    const heard = this.session.endListening(sttRun.result.text, sttMs);
    this.send(ws, { type: 'transcript', text: heard, provider: sttRun.provider });

    if (!heard) {
      this.session.transition(STATE.IDLE);
      return this.send(ws, { type: 'done', ms: { stt: sttMs, llm: 0, tts: 0, total: now() - clock.t0 } });
    }

    /* 2. Text → reply */
    const t1 = now();
    const system = buildSystemPrompt({
      brain: this.brain,
      memory: renderMemory(this.memory),
      summary: this.session.summary,
      ownerName: this.env.VOICE_OWNER_NAME || 'স্যার',
    });
    const messages = buildMessages(this.session.history, '');
    const llmRun = await runWithFailover(pools.llm, (p) =>
      pickAdapter(LLM, p)(p, messages, { system, maxTokens: 400 }));
    const llmMs = now() - t1;
    const reply = this.session.endThinking(llmRun.result.text, llmMs);
    this.send(ws, { type: 'reply', text: reply, provider: llmRun.provider });

    /* 3. Reply → speech */
    const t2 = now();
    let audioOut = null;
    try {
      const ttsRun = await runWithFailover(pools.tts, (p) =>
        pickAdapter(TTS, p)(p, reply, { language: 'bn' }));
      audioOut = ttsRun.result;
      this.send(ws, { type: 'audio', data: toBase64(audioOut.audio), mime: audioOut.mime, provider: ttsRun.provider });
    } catch (e) {
      // The words are already delivered, so a TTS failure is a degraded turn,
      // not a failed one — report it and let the client decide.
      this.send(ws, { type: 'error', message: 'tts_failed:' + sanitizeSecret(e && e.message).slice(0, 120), status: e && e.status || 502 });
    }
    const ttsMs = now() - t2;

    /* 4. Fold old turns into the summary, then remember anything worth keeping */
    const folded = foldSummary(this.session.history, this.session.summary);
    if (folded.folded) this.session.setSummary(folded.summary);
    this.absorbMemory(heard, reply);

    const turn = this.session.endSpeaking(ttsMs);
    this.send(ws, { type: 'done', ms: { stt: sttMs, llm: llmMs, tts: ttsMs, total: turn && turn.totalMs || now() - clock.t0 } });
    await this.persist();
  }

  /* Long-term memory is the same engine the text agent uses, so the voice agent
   * and the chat agent share one brain rather than drifting apart. */
  absorbMemory(heard, reply) {
    try {
      const owner = resolveMemoryOwner(this.ownerUid || this.env.VOICE_OWNER_UID || 'voice-owner');
      if (!owner) return;
      const candidates = extractMemoryCandidates(String(reply || '') + '\n' + String(heard || ''));
      for (const c of candidates || []) {
        const rec = makeMemory(c, owner);
        if (rec) this.memory = upsertMemory(this.memory, rec, owner);
      }
    } catch (_) { /* memory is a bonus; never fail a turn over it */ }
  }
}

export default VoiceAgentSession;
