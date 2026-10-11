/**
 * 🎙️ P23 — LIVE VOICE AGENT · PROVIDER ADAPTERS
 *
 * One function per provider, each returning a normalised result. Every adapter
 * takes an injectable `fetch` so the pool can be tested without a network.
 *
 * Rules that hold across every adapter:
 *  • A non-OK response throws an Error carrying `.status`, so the failover
 *    runner can decide whether to move on. Adapters never swallow a status.
 *  • No adapter logs or returns a credential.
 *  • STT/TTS work in Bengali; the language is stated, not guessed, wherever the
 *    provider takes a parameter.
 */

import { sanitizeSecret } from './voice-agent-core.mjs';

const ok = (r) => r && typeof r.ok === 'boolean' ? r.ok : false;

async function statusError(res, fallback) {
  let detail = '';
  try { detail = String((await res.json())?.error?.message || (await res.json())?.message || ''); } catch (_) { /* non-json */ }
  const err = new Error(sanitizeSecret(detail || `${fallback}_${res.status}`).slice(0, 200));
  err.status = res.status;
  return err;
}

/* ── Speech → text ──────────────────────────────────────────────────────── */

/** Groq Whisper. Multipart upload of the recorded clip. */
export async function groqStt(provider, audio, opts = {}) {
  const f = opts.fetch || fetch;
  const form = new FormData();
  form.append('file', new Blob([audio], { type: opts.mime || 'audio/webm' }), 'clip.webm');
  form.append('model', provider.model || 'whisper-large-v3');
  form.append('language', opts.language || 'bn');
  form.append('response_format', 'json');
  const res = await f('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.key}` },
    body: form,
  });
  if (!ok(res)) throw await statusError(res, 'groq_stt');
  const data = await res.json();
  return { text: String(data.text || '').trim(), provider: provider.id };
}

/** Deepgram. Raw audio body with the content type in a header. */
export async function deepgramStt(provider, audio, opts = {}) {
  const f = opts.fetch || fetch;
  const params = new URLSearchParams({ model: provider.model || 'nova-3', language: opts.language || 'bn', smart_format: 'true' });
  const res = await f(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: { Authorization: `Token ${provider.key}`, 'Content-Type': opts.mime || 'audio/webm' },
    body: audio,
  });
  if (!ok(res)) throw await statusError(res, 'deepgram_stt');
  const data = await res.json();
  const alt = data?.results?.channels?.[0]?.alternatives?.[0];
  return { text: String(alt?.transcript || '').trim(), provider: provider.id };
}

/** Gemini. Inline base64 audio, the same path the relay already uses. */
export async function geminiStt(provider, audio, opts = {}) {
  const f = opts.fetch || fetch;
  const b64 = opts.base64 || base64From(audio);
  const model = provider.model || 'gemini-2.5-flash';
  const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': provider.key },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: 'এই অডিওটি বাংলায় হুবহু লিখে দাও। শুধু লেখাটা দাও, আর কিছু নয়।' },
        { inline_data: { mime_type: opts.mime || 'audio/webm', data: b64 } },
      ] }],
    }),
  });
  if (!ok(res)) throw await statusError(res, 'gemini_stt');
  const data = await res.json();
  return { text: String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim(), provider: provider.id };
}

/* base64 without Buffer, so the same code runs in a Worker and in node tests. */
function base64From(audio) {
  const bytes = audio instanceof Uint8Array ? audio : new Uint8Array(audio);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/* ── Text → text ────────────────────────────────────────────────────────── */

/** OpenAI-compatible chat completion — shared by Groq and OpenRouter. */
async function openAiChat(url, provider, messages, opts, fallbackName) {
  const f = opts.fetch || fetch;
  const res = await f(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}` },
    body: JSON.stringify({
      model: provider.model || opts.defaultModel,
      messages,
      temperature: opts.temperature == null ? 0.6 : opts.temperature,
      max_tokens: opts.maxTokens || 400,
    }),
  });
  if (!ok(res)) throw await statusError(res, fallbackName);
  const data = await res.json();
  return { text: String(data?.choices?.[0]?.message?.content || '').trim(), provider: provider.id };
}

export function groqLlm(provider, messages, opts = {}) {
  return openAiChat('https://api.groq.com/openai/v1/chat/completions', provider, messages,
    { defaultModel: 'llama-3.3-70b-versatile', ...opts }, 'groq_llm');
}

export function openrouterLlm(provider, messages, opts = {}) {
  return openAiChat('https://openrouter.ai/api/v1/chat/completions', provider, messages,
    { defaultModel: 'meta-llama/llama-3.3-70b-instruct:free', ...opts }, 'openrouter_llm');
}

/** Gemini chat. The system prompt goes in system_instruction, history as turns. */
export async function geminiLlm(provider, messages, opts = {}) {
  const f = opts.fetch || fetch;
  const model = provider.model || 'gemini-2.5-flash';
  const system = opts.system || '';
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content || '') }],
  }));
  const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': provider.key },
    body: JSON.stringify({
      ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig: { temperature: opts.temperature == null ? 0.6 : opts.temperature, maxOutputTokens: opts.maxTokens || 400 },
    }),
  });
  if (!ok(res)) throw await statusError(res, 'gemini_llm');
  const data = await res.json();
  return { text: String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim(), provider: provider.id };
}

/* ── Text → speech ──────────────────────────────────────────────────────── */

const CARTESIA_URL = 'https://api.cartesia.ai/tts/bytes';
const CARTESIA_VERSION = '2026-08-14';
const CARTESIA_VOICE_BN = 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4';

/** Cartesia Sonic. Returns MP3 bytes. Used for both pool slots. */
export async function cartesiaTts(provider, text, opts = {}) {
  const f = opts.fetch || fetch;
  const res = await f(CARTESIA_URL, {
    method: 'POST',
    headers: {
      'Cartesia-Version': CARTESIA_VERSION,
      Authorization: `Bearer ${provider.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model_id: provider.model || 'sonic-3.6',
      transcript: text,
      voice: { id: provider.voiceId || opts.voiceId || CARTESIA_VOICE_BN },
      language: opts.language || 'bn',
      generation_config: { speed: opts.speed || 0.95 },
      output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
    }),
  });
  if (!ok(res)) throw await statusError(res, 'cartesia_tts');
  const buf = await res.arrayBuffer();
  if (!buf.byteLength) { const e = new Error('empty_audio'); e.status = 502; throw e; }
  return { audio: buf, mime: 'audio/mpeg', provider: provider.id };
}

/** ElevenLabs. The fallback voice. */
export async function elevenTts(provider, text, opts = {}) {
  const f = opts.fetch || fetch;
  const voiceId = provider.voiceId || opts.voiceId || 'EXAVITQu4vr4xnSDxMaL';
  const format = opts.format || 'mp3_22050_32';
  const res = await f(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${format}`, {
    method: 'POST',
    headers: { 'xi-api-key': provider.key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: provider.model || 'eleven_flash_v2_5',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1.0 },
    }),
  });
  if (!ok(res)) throw await statusError(res, 'elevenlabs_tts');
  const buf = await res.arrayBuffer();
  if (!buf.byteLength) { const e = new Error('empty_audio'); e.status = 502; throw e; }
  return { audio: buf, mime: 'audio/mpeg', provider: provider.id };
}

/* ── Dispatch tables ────────────────────────────────────────────────────── */

export const STT = { 'groq-whisper': groqStt, deepgram: deepgramStt, 'gemini-stt': geminiStt };
export const LLM = { 'groq-llama': groqLlm, openrouter: openrouterLlm, 'gemini-llm': geminiLlm };
export const TTS = { cartesia: cartesiaTts, 'cartesia-2': cartesiaTts, elevenlabs: elevenTts };

export function pickAdapter(table, provider) {
  const fn = table[provider && provider.id];
  if (!fn) { const e = new Error('unknown_provider:' + (provider && provider.id)); e.status = 500; throw e; }
  return fn;
}
