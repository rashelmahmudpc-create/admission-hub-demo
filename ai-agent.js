/**
 * 🤖 ADMISSION HUB AI — AGENT CORE v1 (Phase 1: AI Agent Foundation)
 * ====================================================================
 * মালিক-স্পেক (২০২৬-০৯-০৮): model-independent central AI brain.
 *   Chat UI → AI Gateway (public-worker: anonymous-device rate+validate) → Agent Core → Model Router
 *   → Provider Adapter (Gemini/Groq) → Response Stream
 *
 * নীতি:
 *  - uid কখনো prompt/body-থেকে নয় — Gateway validated/hashed device identity হিসেবে পাস করে।
 *  - কোনো client-সিক্রেট নেই (key শুধু server-env)।
 *  - Response সবসময় real context-ভিত্তিক; fabricate-সংখ্যা কঠোর-নিষিদ্ধ।
 *  - Mock-exam মোডে উত্তর/হিন্ট/ব্যাখ্যা hard-refuse (safety ↑)।
 *  - KV-রাইট-বাজেট: প্রতি চ্যাটে সর্বোচ্চ ২ রাইট (rate-counter + memory)।
 *
 * Test-যোগ্যতা: module-import-এ কোনো worker-API নেই — pure ফাংশন + handler,
 * env/fetch পরীক্ষায় mock করা যায় (ai-agent-f1.test.mjs)।
 */
import { buildContext, renderContext, describeContext, CONTEXT_VERSION } from './context-engine.js';
import { getPromptText, BASE_PROMPT_ID } from './prompt-registry.js';
import { listTools, TOOL_REGISTRY_VERSION } from './tool-registry.js';
import { extractMemoryCandidates, makeMemory, upsertMemory, parseMemory, renderMemory, resolveMemoryOwner, MEMORY_VERSION } from './memory-engine.js';
import { validateResponse, describeResponseValidation, RESPONSE_VALIDATION_VERSION } from './response-validator.js';
import { describeActions, ACTION_VERSION } from './action-engine.js';
import { makeTrace, makeRequestId, callerRef, quotaState, renderTrace, estimateTokens, FALLBACK, OBSERVABILITY_VERSION, describeObservability, parseTraces, appendTrace, addUsage, emptyUsage, estimateCost, validateObservability } from './observability.js';

export const AGENT_VERSION = 'agent-f1';
export const SYSTEM_PROMPT_V = 'sys-f1-3-ai-personalization';

/* ── M4 Context Engine feature flag (default off) ------------------------ */
export function contextEngineEnabled(env) {
  return String((env && env.USE_CONTEXT_ENGINE) || '').trim() === 'enabled';
}

export const INTENTS = {
  GENERAL_CHAT: 'GENERAL_CHAT',
  ACADEMIC_EXPLAIN: 'ACADEMIC_EXPLAIN',
  PERFORMANCE_REQUEST: 'PERFORMANCE_REQUEST',
  QUIZ_REQUEST: 'QUIZ_REQUEST',
  SEARCH_REQUEST: 'SEARCH_REQUEST',
  IMAGE_REQUEST: 'IMAGE_REQUEST'
};

const TIER = { FAST: 'FAST', SMART: 'SMART' };

/* ── Intent Engine v1: rule-based (Bangla+English+Banglish) ────────────── */
const RE = {
  quiz: /(\d+\s*(টা|টি)?\s*(mcq|প্রশ্ন)?|\bquiz\b|\bchallenge\b|মক|প্রশ্ন বানাও|প্রশ্ন তৈরি|make.*(mcq|question)|\bmcq\b)/i,
  perf: /(performance|প্রোগ্রেস|progress|কেমন আছি|কেমন চলছে|কেমন করছি|কতটা (ভালো|খারাপ)|রিপোর্ট|report|streak|accuracy|সঠিক|ভুল করেছি|কয়টা ঠিক|মার্কস|marks|score|স্কোর)/i,
  image: /(ছবি|স্ক্রিনশট|ফটো|পিকচার|হাতে লেখা|চিত্র|\bimage\b|\bscreenshot\b|\bphoto\b|handwritten|\bdiagram\b)/i,
  search: /(নিউজ|খবর|নোটিশ|তারিখ|সার্কুলার|আপডেট|ভর্তির ফল|কবে|\bnews\b|\bnotice\b|\bdate\b|deadline|\bcircular\b|\bupdate\b)/i,
  academic: /(বুঝাও|understand|explain|ব্যাখ্যা|কী |কি |কী\?|কি\?|what|why|how|কেন|define|সংজ্ঞা|পার্থক্য|difference|সূত্র|formula|theorem|উপপাদ্য|concept|ধারণা|system|সিস্টেম|photosynthesis|সালোকসংশ্লেষণ|newton|নিউটন|physics|পদার্থ|chemistry|রসায়ন|biology|জীববিজ্ঞান|math|গণিত|english|ইংরেজি|bangla|বাংলা|grammar|ব্যাকরণ)/i,
  greeting: /(আসসালামু|আসসালাম|সালাম|আলাইকুম|হ্যালো|হাই|নমস্কার|good morning|good evening|\bhi\b|\bhello\b)/i
};

function lower(s) {
  return String(s || '').toLowerCase();
}
export function classifyIntent(text) {
  const t = lower(text);
  if (!t.trim()) return { intent: INTENTS.GENERAL_CHAT, tier: TIER.FAST, confidence: 0.4 };
  if (RE.greeting.test(t)) return { intent: INTENTS.GENERAL_CHAT, tier: TIER.FAST, confidence: 0.85 };
  if (RE.image.test(t)) return { intent: INTENTS.IMAGE_REQUEST, tier: TIER.FAST, confidence: 0.75 };
  if (RE.quiz.test(t) && /(বানাও|তৈরি|create|generate|দাও|make|build|আমাকে|নাও)/i.test(text))
    return { intent: INTENTS.QUIZ_REQUEST, tier: TIER.FAST, confidence: 0.8 };
  if (RE.perf.test(t)) return { intent: INTENTS.PERFORMANCE_REQUEST, tier: TIER.SMART, confidence: 0.7 };
  if (RE.search.test(t)) return { intent: INTENTS.SEARCH_REQUEST, tier: TIER.FAST, confidence: 0.65 };
  if (RE.academic.test(t)) return { intent: INTENTS.ACADEMIC_EXPLAIN, tier: TIER.SMART, confidence: 0.7 };
  return { intent: INTENTS.GENERAL_CHAT, tier: TIER.FAST, confidence: 0.5 };
}

/* ── Request Validation (AI Gateway) ------------------------------------- */
export function validateChatReq(body) {
  if (!body || typeof body !== 'object') return { ok: false, code: 'invalid_request', message: 'অনুরোধ সঠিক নয়।' };
  const raw = Array.isArray(body.messages) ? body.messages : null;
  if (!raw || !raw.length) return { ok: false, code: 'empty_messages', message: 'কোনো বার্তা নেই।' };
  if (raw.length > 24) return { ok: false, code: 'too_many_messages', message: 'একবারে ২৪-এর বেশি বার্তা পাঠানো যাবে না।' };
  const msgs = [];
  let total = 0;
  for (const m of raw) {
    const role = m && m.role === 'assistant' ? 'assistant' : m && m.role === 'user' ? 'user' : null;
    const content = typeof (m && m.content) === 'string' ? m.content : typeof (m && m.text) === 'string' ? m.text : '';
    if (!role || !content.trim()) return { ok: false, code: 'invalid_message', message: 'বার্তার গঠন সঠিক নয়।' };
    if (content.length > 4000) return { ok: false, code: 'message_too_long', message: 'একটি বার্তা ৪০০০ অক্ষরের বেশি হতে পারবে না।' };
    const image = typeof (m && m.image) === 'string' ? m.image : '';
    if (image) {
      if (!/^data:image\/(jpeg|png|webp|gif);base64,/.test(image)) return { ok: false, code: 'invalid_image', message: 'ছবির ফরম্যাট সাপোর্টেড নয় (jpeg/png/webp/gif)।' };
      if (image.length > 4700000) return { ok: false, code: 'image_too_large', message: 'ছবি ৩.৫MB-এর বেশি হতে পারবে না।' };
    }
    total += content.length;
    msgs.push({ role, content: content.trim(), image });
  }
  if (total > 20000) return { ok: false, code: 'context_too_long', message: 'বার্তার মোট আকার খুব বড়।' };
  return { ok: true, messages: msgs, fresh: body.fresh === true };
}

const ONBOARDING_ACTIONS = new Set([
  'focus-name', 'focus-email', 'focus-dob', 'focus-school', 'focus-college',
  'open-signup', 'open-login', 'explain-email', 'explain-telegram'
]);
const oneOf = (value, allowed, fallback) => allowed.includes(String(value || '')) ? String(value) : fallback;

export function onboardingSecretDetected(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  const passwordWord = '(?:password|passcode|পাসওয়ার্ড|পাসওয়াৰ্ড|পাসওয়ার্ড)';
  if (/\b\d{6}\b/.test(text) || /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/.test(text)
    || /-----BEGIN [A-Z ]+PRIVATE KEY-----/.test(text)) return true;
  if (new RegExp(`(?:my|amar|আমার)\\s*${passwordWord}\\s*(?:is|হলো|:)?\\s*\\S{4,}`, 'i').test(text)) return true;
  if (new RegExp(`${passwordWord}\\s*(?:is|হলো|:|=|-)\\s*\\S{4,}`, 'i').test(text)) return true;
  if (new RegExp(`${passwordWord}\\s+(?=\\S{6,})(?=\\S*[0-9])\\S+`, 'i').test(text)) return true;
  if (/(?:passcode|pin|otp|one[ -]?time code|ওটিপি)\D{0,8}\d{4,8}\b/i.test(text)) return true;
  if (/(?:secret|api[ -]?key|token|গোপন)\s*(?:is|হলো|:|=)\s*\S{4,}/i.test(text)) return true;
  return text.split(/\s+/).some(part => part.length >= 8 && /[a-z]/.test(part) && /[A-Z]/.test(part) && /\d/.test(part) && /[^A-Za-z0-9]/.test(part));
}

export function sanitizeOnboardingContext(value) {
  if (!value || typeof value !== 'object' || value.surface !== 'premium-onboarding') return null;
  const validity = value.validity && typeof value.validity === 'object' ? value.validity : {};
  const cleanInstitution = text => String(text || '').normalize('NFKC').replace(/[\r\n\u0000<>]/g, '').trim().slice(0, 80);
  const institutionQuery = cleanInstitution(value.institutionQuery);
  const institutionSuggestions = Array.isArray(value.institutionSuggestions)
    ? value.institutionSuggestions.slice(0, 3).map(cleanInstitution).filter(Boolean) : [];
  return Object.freeze({
    surface: 'premium-onboarding',
    view: oneOf(value.view, ['welcome','login','forgot','signup','verify','telegram','security-setup','success','signed'], 'welcome'),
    step: oneOf(value.step, ['none','personal','education','security'], 'none'),
    field: oneOf(value.field, ['none','name','email','school','college','date-of-birth','sensitive-field'], 'none'),
    validity: Object.freeze({
      personal: validity.personal === true,
      education: validity.education === true,
      verificationAuthoritative: validity.verificationAuthoritative === true
    }),
    institutionQuery,
    institutionSuggestions: Object.freeze(institutionSuggestions),
    allowedActions: Object.freeze(Array.isArray(value.allowedActions)
      ? value.allowedActions.filter(action => ONBOARDING_ACTIONS.has(action)).slice(0, 12) : [])
  });
}

/* ── User-Context stats sanitize (শুধু প্রদত্ত সংখ্যা; কখনো বানানো নয়) --- */
export function capStats(stats) {
  if (!stats || typeof stats !== 'object') return null;
  const num = (v, min, max) => {
    const n = Number(v);
    if (!isFinite(n) || n < 0) return 0;
    return Math.min(max, Math.round(n));
  };
  const s = {};
  if (stats.exams != null) s.exams = num(stats.exams, 0, 100000);
  if (stats.questions != null) s.questions = num(stats.questions, 0, 1000000);
  if (stats.accuracy != null) s.accuracy = num(stats.accuracy, 0, 100);
  if (stats.streak != null) s.streak = num(stats.streak, 0, 3650);
  if (stats.mistakes != null) s.mistakes = num(stats.mistakes, 0, 100000);
  return Object.keys(s).length ? s : null;
}

/* ── AI Personalization (blueprint §19-20) — per-user, allowlisted, bounded ── */
export const AI_PREFS_DEFAULT = Object.freeze({ langStyle: "bn", tone: "friendly", responseLen: "balanced" });
export function sanitizeAiPrefs(value) {
  if (!value || typeof value !== "object") return null;
  const pick = (v, set, dflt) => (set.has(String(v)) ? String(v) : dflt);
  /* No `memory` field: M7 removed the toggle. Memory is automatic for a signed-in
     student and cannot be switched off from the client. */
  return {
    langStyle: pick(value.langStyle, new Set(["bn", "en", "mix"]), AI_PREFS_DEFAULT.langStyle),
    tone: pick(value.tone, new Set(["friendly", "professional", "simple", "motivating", "direct"]), AI_PREFS_DEFAULT.tone),
    responseLen: pick(value.responseLen, new Set(["short", "balanced", "detailed"]), AI_PREFS_DEFAULT.responseLen)
  };
}

/* ── Student profile context (academic structure only — never PII) ──────────
   Allowlist, not blocklist: any key not named here is dropped, so a hand-built
   request cannot smuggle an identity field into the model. The first name is
   always included for a signed-in student (no setup needed); only a single name
   token is kept, and no other identity field is ever read. */
const PROFILE_TEXT = (value, max) => String(value ?? '').normalize('NFKC').replace(/[\r\n\u0000<>]/g, '').trim().slice(0, max);
export function sanitizeProfileContext(value, opts = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};

  {
    const firstName = PROFILE_TEXT(value.firstName, 40);
    // A single name token only — never a full name, never any other identity field.
    if (firstName && !/\s/.test(firstName)) out.firstName = firstName;
  }
  const institutionName = PROFILE_TEXT(value.institutionName, 120);
  if (institutionName) out.institutionName = institutionName;
  const institutionType = pickInstitutionType(value.institutionType);
  if (institutionType) out.institutionType = institutionType;
  const district = PROFILE_TEXT(value.district, 60);
  if (district) out.district = district;
  const admissionSession = PROFILE_TEXT(value.admissionSession, 40);
  if (admissionSession) out.admissionSession = admissionSession;
  const academicGoal = PROFILE_TEXT(value.academicGoal, 80);
  if (academicGoal) out.academicGoal = academicGoal;
  if (Array.isArray(value.subjects)) {
    const subjects = value.subjects.slice(0, 10).map(s => PROFILE_TEXT(s, 40)).filter(Boolean);
    if (subjects.length) out.subjects = Array.from(new Set(subjects));
  }
  if (Array.isArray(value.targets) && value.targets.length) {
    const t = value.targets[0] || {};
    const name = PROFILE_TEXT(t.name, 120);
    if (name) out.targets = [{ name, unit: PROFILE_TEXT(t.unit, 40), year: PROFILE_TEXT(t.year, 40) }];
  }
  return Object.keys(out).length ? Object.freeze(out) : null;
}
const pickInstitutionType = value => {
  const v = String(value || '').trim().toLowerCase();
  return ['school', 'college', 'university', 'madrasa', 'other'].includes(v) ? v : '';
};

/* ── Master System Prompt (মালিক-স্পেক §9) ------------------------------- */
export function buildSystemPrompt(opts = {}) {
  const stats = capStats(opts.stats);
  const examMode = String(opts.examMode || '');
  /* The core prompt text lives in prompt-registry.js (M5) so its id/version are
     recorded and old revisions are never lost. The text is byte-identical to the
     previous inline literal; only its home changed. */
  let p = getPromptText(BASE_PROMPT_ID) || '';
  const onboarding = sanitizeOnboardingContext(opts.onboarding);
  if (onboarding) p += `\n\nONBOARDING ASSISTANT — STRICT MODE:
- Help only with the visible Admission Hub welcome, signup, login, institution search, and verification journey.
- The current structured context is ${JSON.stringify(onboarding)}.
- Never ask for, repeat, infer, transform, store, or validate a password, confirm-password value, OTP, session value, key, secret, or credential.
- Never claim signup, delivery, verification, Passkey creation, login, or profile saving succeeded. Only the application's confirmed state can show success.
- Respond with student-friendly Bengali and never expose technical infrastructure words such as backend, API, provider, token, webhook, SMTP, quota, or database.
- You return explanation text only. You cannot execute actions or emit JavaScript, selectors, commands, or tool calls. The interface alone may offer its predefined safe actions.
- Never submit forms or trigger signup, delivery, verification, login, profile-save, or security actions. Any critical action requires the student's explicit confirmation in the interface and the application's confirmed result.
- If field is sensitive-field, discuss only general safety and never ask what is typed there.
- Institution suggestions are advisory and limited to the exact supplied names; if no match, explain the manual-name option.`;
  if (examMode === 'mock-running') p += `\n\nEXAM INTEGRITY — ACTIVE (mock-running): answers, hints and explanations are REFUSED.`;
  if (opts.quiz) p += `\n\nQUIZ MODE — reply with ONLY a valid JSON object (no markdown fences, no text outside JSON):\n{"title":"<short topic title>","questions":[{"q":"<question>","options":["<A>","<B>","<C>","<D>"],"answer":0,"explanation":"<1-2 sentence Bangla explanation of the answer>"}]}\nRules: exactly 5 questions (or the count the user asked, 1-10); admission-level quality; answer is the 0-based index of the correct option; question/options/explanation in the user's language (Bangla unless the user wrote English); 4 options each.`;
  const prefs = sanitizeAiPrefs(opts.prefs);
  if (prefs) {
    const langLine = prefs.langStyle === "en"
      ? "Reply in English."
      : prefs.langStyle === "mix"
        ? "Reply in a natural mix of Bangla and English (code-mixing is fine)."
        : "Reply in Bangla (Bangla script).";
    const toneLine = {
      friendly: "Keep a warm, encouraging, friendly tone.",
      professional: "Keep a professional, precise tone.",
      simple: "Use the simplest possible words and short sentences.",
      motivating: "Keep an uplifting, motivating tone; encourage the student.",
      direct: "Be direct and to the point; no small talk."
    }[prefs.tone];
    const lenLine = prefs.responseLen === "short"
      ? "Keep answers short (2-4 sentences unless the student asks for more)."
      : prefs.responseLen === "detailed"
        ? "Give detailed, well-structured answers with examples when useful."
        : "Keep answers balanced: enough detail, no padding.";
    p += `\n\nSTUDENT PREFERENCES (এই ব্যবহারকারীর নিজস্ব পছন্দ — অন্য কারাংশে প্রয়োগ করো না): ${langLine} ${toneLine} ${lenLine}`;
  }
  if (stats) {
    const bits = [];
    if (stats.exams != null) bits.push(`মোট পরীক্ষা: ${stats.exams}`);
    if (stats.questions != null) bits.push(`মোট প্রশ্ন: ${stats.questions}`);
    if (stats.accuracy != null) bits.push(`একুরেসি: ${stats.accuracy}%`);
    if (stats.streak != null) bits.push(`স্ট্রিক: ${stats.streak} দিন`);
    if (stats.mistakes != null) bits.push(`ভুল-তালিকা: ${stats.mistakes}টা`);
    if (bits.length) p += `\n\nUSER STATS (শুধু এই প্রদত্ত সংখ্যা ব্যবহার করো — এগুলোর বাইরে কোনো সংখ্যা বানাবে না): ${bits.join(' · ')}.`;
  }
  return p;
}

/* ── Conversation Memory: summarize (short/session 2-layer) -------------- */
export function summarizeTo(messages, maxTurns = 6, maxChars = 900) {
  const msgs = Array.isArray(messages) ? messages.slice(0, -maxTurns) : [];
  // যারা 'অতিরিক্ত' (লেজ বাদ) — সেগুলোকে সংক্ষেপ
  if (!msgs.length) return '';
  let out = 'পূর্বের কথোপকথন (সংক্ষেপ):\n';
  for (const m of msgs) {
    const who = m.role === 'user' ? 'শিক্ষার্থী' : 'AI';
    const txt = String(m.content || '').replace(/\s+/g, ' ').trim().slice(0, 90);
    if (!txt) continue;
    out += `- ${who}: ${txt}\n`;
  }
  return out.length > maxChars ? out.slice(0, maxChars) + '…' : out;
}

/* ── Provider Adapters (model-independent interface) --------------------- */
export class ProviderError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.retryable = !!opts.retryable;
    this.bad = !!opts.bad; /* এই key/model আজ আর চেষ্টা করবে না (401/402/429/5xx) */
  }
}

const GEMINI_MODELS = {
  FAST: 'gemini-3.1-flash-lite',
  SMART: 'gemini-3-flash-preview'
};

export function sseParse(raw) {
  /* "data: {...}\n\n" → {...} | null */
  const out = [];
  for (const line of String(raw || '').split('\n')) {
    const s = line.trim();
    if (!s.startsWith('data:')) continue;
    const json = s.slice(5).trim();
    if (!json || json === '[DONE]') continue;
    try { out.push(JSON.parse(json)); } catch (_) { /* অবৈধ-টুকরা বাদ */ }
  }
  return out;
}

export function geminiTextFromChunk(chunk) {
  let t = '';
  for (const c of chunk.candidates || []) {
    for (const p of c.content && c.content.parts || []) {
      if (p.text) t += p.text;
      else if (p.inlineData) t += ' [image-data omitted]';
    }
  }
  return t;
}

export async function* geminiStream(key, model, payload, signal) {
  if (!key) throw new ProviderError('gemini-key-না', { retryable: false });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });
  if (!r.ok || !r.body) {
    const bad = r.status === 401 || r.status === 402 || r.status === 429 || r.status >= 500;
    throw new ProviderError(`Gemini HTTP ${r.status} (${model})`, { retryable: r.status >= 500 || r.status === 429, bad });
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split('\n\n');
    buf = chunks.pop() || '';
    for (const ch of chunks) {
      for (const j of sseParse(ch)) {
        const t = geminiTextFromChunk(j);
        if (t) yield t;
        if (j.candidates && j.candidates[0] && j.candidates[0].finishReason) return;
      }
    }
  }
  for (const j of sseParse(buf)) {
    const t = geminiTextFromChunk(j);
    if (t) yield t;
  }
}

export async function* groqStream(key, model, payload, signal) {
  if (!key) throw new ProviderError('groq-key-না', { retryable: false });
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ ...payload, model, stream: true }),
    signal
  });
  if (!r.ok || !r.body) {
    const bad = r.status === 401 || r.status === 402 || r.status === 429 || r.status >= 500;
    throw new ProviderError(`Groq HTTP ${r.status} (${model})`, { retryable: r.status >= 500 || r.status === 429, bad });
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const j = s.slice(5).trim();
      if (j === '[DONE]') return;
      try {
        const d = JSON.parse(j);
        const delta = d.choices && d.choices[0] && d.choices[0].delta && d.choices[0].delta.content;
        if (delta) yield delta;
      } catch (_) { /* অবৈধ-টুকরা বাদ */ }
    }
  }
}

/* ── Provider Adapters: normalized interface (Phase 9 §6, migration M2) ---
   Adapter contract:
     id           stable provider id, used in logs and bad-set keys
     matches(e)   can this adapter serve this chain entry?
     oneShot      true when a non-streaming completion path exists
     chatOnce(e,payload)    one-shot completion → text
     chatStream(e,payload)  async iterator of text deltas

   The orchestrator keeps owning the payload builders (it knows whether an
   image is attached, and Gemini/Groq need different shapes: native parts vs
   messages), and keeps owning the retry/bad-mark loop. Adapters only own the
   provider-specific call. URLs, headers, status handling and error wording are
   unchanged from before this step — structure only.
------------------------------------------------------------------------ */
function geminiEndpoint(model, action, key) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?key=${encodeURIComponent(key)}`;
}

function geminiFirstText(d) {
  return String(
    d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts &&
      d.candidates[0].content.parts.map(x => x.text || '').join('') || ''
  ).trim();
}

export const GEMINI_ADAPTER = {
  id: 'gemini',
  matches: (entry) => entry.provider === 'gemini',
  oneShot: true,
  async chatOnce(entry, payload) {
    const r = await fetch(geminiEndpoint(entry.model, 'generateContent', entry.key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      const bad = r.status === 401 || r.status === 402 || r.status === 429 || r.status >= 500;
      throw new ProviderError(`Gemini HTTP ${r.status} (${entry.model})`, { retryable: r.status >= 500 || r.status === 429, bad });
    }
    return geminiFirstText(await r.json().catch(() => ({})));
  },
  chatStream: (entry, payload) => geminiStream(entry.key, entry.model, payload)
};

export const GROQ_ADAPTER = {
  id: 'groq',
  matches: (entry) => entry.provider === 'groq',
  /* Groq is stream-only here: the non-stream route has always been Gemini-only,
     and adding a Groq one-shot path would change behaviour (M2 forbids that).
     Fail honestly instead of inventing a fallback. */
  oneShot: false,
  async chatOnce() {
    throw new ProviderError('groq-এ non-stream পথ এখনো নেই', { retryable: false, bad: false });
  },
  chatStream: (entry, payload) => groqStream(entry.key, entry.model, payload)
};

/* ── generic OpenAI-compatible streaming helper (Phase 9 M2.5) ------------
   Providers that speak the OpenAI chat-completions wire format (Cloudflare
   Workers AI, and later OpenRouter / GitHub Models / Mistral / Cerebras /
   NVIDIA) share one stream reader. Keeping it here means adding the next such
   provider is a URL + model list, not another copy-pasted reader.
------------------------------------------------------------------------ */
async function* openAiCompatStream({ url, key, model, payload, signal }) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
    body: JSON.stringify({ ...payload, model, stream: true }),
    signal
  });
  if (!r.ok || !r.body) {
    const bad = r.status === 401 || r.status === 402 || r.status === 403 || r.status === 429 || r.status >= 500;
    throw new ProviderError(`OpenAI-compat HTTP ${r.status} (${model})`, { retryable: r.status >= 500 || r.status === 429, bad });
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const j = s.slice(5).trim();
      if (j === '[DONE]') return;
      try {
        const d = JSON.parse(j);
        const delta = d.choices && d.choices[0] && d.choices[0].delta && d.choices[0].delta.content;
        if (delta) yield delta;
      } catch (_) { /* অবৈধ-টুকরা বাদ */ }
    }
  }
}

/* Cloudflare Workers AI — free 10,000 Neurons/day, runs on the same edge as the
   worker, so it is the cheapest backup to reach. It authenticates with
   account id + API token (the env.AI binding is not threaded through agentChat,
   so this stays a plain fetch adapter like the others). */
export const CLOUDFLARE_ADAPTER = {
  id: 'cloudflare',
  matches: (entry) => entry.provider === 'cloudflare',
  oneShot: false,
  async chatOnce() {
    throw new ProviderError('cloudflare-এ non-stream পথ এখনো নেই', { retryable: false, bad: false });
  },
  chatStream(entry, payload, env) {
    const account = String(env?.CLOUDFLARE_ACCOUNT_ID || '').trim();
    const key = entry.key || String(env?.CLOUDFLARE_AI_API_KEY || '').trim();
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/v1/chat/completions`;
    return openAiCompatStream({ url, key, model: entry.model, payload });
  }
};

export const PROVIDER_ADAPTERS = [GEMINI_ADAPTER, GROQ_ADAPTER, CLOUDFLARE_ADAPTER];

export function adapterFor(entry) {
  return PROVIDER_ADAPTERS.find(a => a.matches(entry)) || null;
}

/* Chain for the non-streaming route: the router chain restricted to adapters
   that actually have a one-shot path (Gemini today). Unknown providers are
   dropped rather than dispatched to a missing adapter. */
export function providerChain(env, tier = 'FAST', badSet = new Set()) {
  return routerChain(env, tier, badSet).filter(c => {
    const adapter = adapterFor(c);
    return Boolean(adapter) && adapter.oneShot === true;
  });
}

/* ── Model Router (basic): intent-tier → provider-chain ------------------ */
export function routerChain(env, tier, badSet = new Set()) {
  const geminiModels = String(env && env.AGENT_GEMINI_MODELS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const chain = [];
  const addGem = (m) => {
    if (!m) return;
    const k = (env.GEMINI_KEYS || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const key of k) {
      const sig = String(key).slice(0, 12) + ':' + m;
      if (badSet.has(sig)) continue;
      chain.push({ provider: 'gemini', key, model: m });
    }
  };
  if (geminiModels.length) geminiModels.forEach(addGem);
  else {
    const first = tier === TIER.SMART ? GEMINI_MODELS.SMART : GEMINI_MODELS.FAST;
    const second = tier === TIER.SMART ? GEMINI_MODELS.FAST : GEMINI_MODELS.SMART;
    addGem(first); addGem(second);
  }
  if (env && env.GROQ_API_KEY) {
    chain.push({ provider: 'groq', key: env.GROQ_API_KEY, model: 'llama-3.3-70b-versatile' });
    chain.push({ provider: 'groq', key: env.GROQ_API_KEY, model: 'llama-3.1-8b-instant' });
  }
  /* Cloudflare Workers AI backup (Phase 9 M2.5). Needs both the account id and
     an API token; either missing means the slot is simply absent, exactly like
     a missing GEMINI_KEYS/GROQ_API_KEY. Model list is overridable because
     Cloudflare rotates its catalogue. */
  if (env && env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_API_KEY) {
    const cfModels = String(env.AGENT_CLOUDFLARE_MODELS || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const list = cfModels.length ? cfModels : ['@cf/meta/llama-3.3-70b-instruct-fp8-fast'];
    for (const m of list) chain.push({ provider: 'cloudflare', key: env.CLOUDFLARE_AI_API_KEY, model: m });
  }
  return chain;
}

/* ── helpers: KV (best-effort) -------------------------------------------- */
const dayKey = () => new Date().toISOString().slice(0, 10);
const getKv = async (kv, key) => { try { return await kv.get(key); } catch (_) { return null; } };
const putKv = async (kv, key, val, ttl) => { try { await kv.put(key, val, ttl ? { expirationTtl: ttl } : undefined); } catch (_) {} };
const badKeyName = (key, model) => 'aibad:' + String(key).slice(0, 12) + ':' + model + ':' + dayKey();

/* ── নিরাপদ-টেক্সট আউটপুট: লজিক-গার্ড (safety) ---------------------------- */
export function safetyGate(intent, examMode) {
  if (examMode === 'mock-running' && (intent === INTENTS.ACADEMIC_EXPLAIN || intent === INTENTS.QUIZ_REQUEST)) {
    return { blocked: true, message: 'মক-পরীক্ষা চলছে — এখানে উত্তর বা হিন্ট দেওয়া হয় না। পরীক্ষা শেষ হলে সম্পূর্ণ বিশ্লেষণ পাবে।' };
  }
  return { blocked: false };
}

export function authVerificationGuidance(text) {
  const input = String(text || '').trim();
  const verificationTopic = /(telegram|টেলিগ্রাম|\botp\b|ওটিপি|one[ -]?time code|verification code|যাচাই(?:য়ের)? কোড)/i.test(input);
  const possibleBareOtp = /^\D*\d{6}\D*$/.test(input);
  if (!verificationTopic && !possibleBareOtp) return '';
  return 'Telegram যাচাই করতে Admission Hub-এ “Telegram দিয়ে যাচাই করুন” চাপুন, official bot খুলে START চাপুন, তারপর bot-এর পাঠানো কোডটি শুধু Admission Hub-এর verification box-এ লিখুন। আমি OTP তৈরি, অনুমান, দেখা, পুনরাবৃত্তি বা যাচাই করতে পারি না এবং verification সফলও ঘোষণা করতে পারি না—শুধু Admission Hub-এর নিশ্চিত ফলই চূড়ান্ত। Telegram যাচাই Gmail/ইমেইল মালিকানা প্রমাণ করে না।';
}

function guidanceResponse(text, stream) {
  if (!stream) return jsonResp({ text, intent: INTENTS.GENERAL_CHAT, pv: SYSTEM_PROMPT_V, agent: AGENT_VERSION, authoritative: false });
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
      controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ intent: INTENTS.GENERAL_CHAT, pv: SYSTEM_PROMPT_V, agent: AGENT_VERSION, authoritative: false })}\n\n`));
      controller.close();
    }
  }), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Access-Control-Allow-Origin': '*' }
  });
}

/* ── AI Gateway handler: POST /api/ai/chat (stream ফ্লো) ------------------ */
export async function agentChat(request, env, uid, opts = {}) {
  const stream = opts && opts.stream !== false;
  const persistMemory = opts?.persistMemory !== false;
  const startedAt = Date.now();
  const sendCtx = { uid: String(uid || ''), stream };
  /* M7: AI chat is for signed-in students only. A guest has no durable identity,
     so it can neither personalise nor be remembered — it is refused up front. */
  if (!sendCtx.uid.startsWith('account-')) {
    const msg = { error: 'sign_in_required', message: 'AI চ্যাট ব্যবহার করতে লগইন করো।' };
    return stream ? sseError(msg, 401) : jsonResp(msg, 401);
  }
  const body = await request.json().catch(() => null);
  const v = validateChatReq(body);
  if (!v.ok) return jsonResp({ error: v.code, message: v.message }, 400);
  const onboarding = sanitizeOnboardingContext(body?.context?.onboarding);
  if (onboarding && v.messages.some(message => message.role === 'user' && onboardingSecretDetected(message.content))) {
    return guidanceResponse('নিরাপত্তার জন্য Password, verification code বা গোপন তথ্য Assistant নেয় না। এমন কিছু লিখে থাকলে সেটি বদলে শুধু সাধারণ প্রশ্ন করো।', stream);
  }

  /* rate limit: প্রতি-user প্রতি-দিন cap (KV ১ রাইট/চ্যাট) */
  const cap = Math.max(10, Math.min(500, Number((env && env.AGENT_DAILY_CAP) || 80)));
  const rlKey = 'airl:' + sendCtx.uid + ':' + dayKey();
  let n = 0;
  try { n = Number((await getKv(env.PUB_KV, rlKey)) || 0); } catch (_) { n = 0; }
  const quota = quotaState({ used: n, cap });
  if (quota.exhausted) return jsonResp({ error: 'rate_limited', message: 'আজকের AI-চ্যাট সীমা শেষ — কাল আবার চেষ্টা করো।', cap, remaining: quota.remaining }, 429);
  await putKv(env.PUB_KV, rlKey, String(n + 1), 172800);

  const verificationGuidance = authVerificationGuidance(v.messages[v.messages.length - 1].content);
  if (verificationGuidance) return guidanceResponse(verificationGuidance, stream);

  const intentCls = classifyIntent(v.messages[v.messages.length - 1].content);
  const intent = intentCls.intent;
  const tier = intentCls.tier;
  const quizMode = intent === INTENTS.QUIZ_REQUEST;
  const examMode = body.context && body.context.examMode === 'mock-running' ? 'mock-running' : '';
  const stats = capStats(body.context && body.context.stats);
  const safety = safetyGate(intent, examMode);

  /* AI personalization (blueprint §19-20): per-user KV prefs, allowlisted.
     Keyed by identity uid — never shared/leaked between users. */
  let aiPrefs = null;
  try {
    const rawPrefs = await getKv(env.PUB_KV, 'aiprefs:' + sendCtx.uid);
    aiPrefs = rawPrefs ? sanitizeAiPrefs(JSON.parse(rawPrefs)) : null;
  } catch (_) { aiPrefs = null; }
  /* M7: long-term memory is automatic for a signed-in student — no toggle and no
     prompt. Guests never reach here (refused above), so persistMemory is true. */
  const memoryOn = persistMemory;

  /* conversation memory: পুরনো কনভো (KV) + সাম্প্রতিক message */
  let mem = [];
  if (memoryOn) {
    try {
      const rawMem = await getKv(env.PUB_KV, 'chatmem:' + sendCtx.uid);
      const parsedMem = JSON.parse(rawMem || '[]');
      mem = Array.isArray(parsedMem) ? parsedMem : [];
    } catch (_) { mem = []; }
  }
  /* A short thread is normally a continuation, so stored memory gets prepended.
     But "New Chat" opens an empty thread and its first message is short too —
     it matched that branch, so a greeting was answered with whatever topic the
     user had discussed days earlier. The client flags the first message of a
     fresh thread and that flag suppresses memory entirely. */
  const freshThread = v.fresh === true;
  let msgs = v.messages.slice();
  if (!freshThread && msgs.length < 3 && mem.length) msgs = mem.concat(msgs);
  if (msgs.length > 16) {
    const summary = summarizeTo(msgs);
    if (memoryOn) await putKv(env.PUB_KV, 'chatmemsum:' + sendCtx.uid, summary);
    msgs = msgs.slice(-12);
  }
  msgs = msgs.slice(-24);

  const systemPrompt = buildSystemPrompt({ stats, examMode, quiz: quizMode, onboarding, prefs: aiPrefs });
  /* M4 Context Engine (opt-in). When enabled, a typed permission-scoped bundle
     is rendered and appended; when disabled the prompt above is byte-identical
     to the pre-M4 output, so the legacy path stays intact.
     The student's academic profile is attached only for a signed-in account and
     only after server-side sanitization; the first name is included by default,
     with no setting to switch it on. */
  const profileCtx = sendCtx.uid.startsWith('account-')
    ? sanitizeProfileContext(body?.context?.profile)
    : null;
  const ctxBundle = contextEngineEnabled(env)
    ? buildContext({ uid: sendCtx.uid, prefs: aiPrefs, stats, onboarding, profile: profileCtx, memoryOn })
    : null;
  const ctxText = ctxBundle ? renderContext(ctxBundle) : '';
  /* The rolling summary carries older topics too, so it is suppressed with
     memory — otherwise the stale subject leaks back through the system prompt. */
  let summaryText = memoryOn && !freshThread ? await getKv(env.PUB_KV, 'chatmemsum:' + sendCtx.uid) : '';

  /* M7 long-term memory: read the caller's own records, render only the newest,
     most confident few. Storage is bounded by the engine and the owner is the
     server-validated account uid — a record for anyone else is dropped on parse. */
  let memRecords = [];
  if (memoryOn) {
    try {
      const rawLong = await getKv(env.PUB_KV, 'mem:' + MEMORY_VERSION + ':' + sendCtx.uid);
      memRecords = parseMemory(rawLong, sendCtx.uid);
    } catch (_) { memRecords = []; }
  }
  const memoryText = memoryOn ? renderMemory(memRecords, MEMORY_VERSION) : '';
  const sys = [systemPrompt, ctxText, memoryText, summaryText].filter(Boolean).join('\n\n');

  const hasImage = msgs.some(m => m.image);
  const partsOf = (m) => {
    const p = [{ text: m.content }];
    if (m.image) {
      const i = m.image.indexOf(',');
      const mt = String(m.image.slice(5, i) || 'image/jpeg').split(';')[0];
      p.push({ inline_data: { mime_type: mt, data: m.image.slice(i + 1) } });
    }
    return p;
  };
  const payloadG = () => ({
    system_instruction: { parts: [{ text: sys }] },
    contents: msgs.map(m => ({ role: m.role, parts: partsOf(m) }))
  });
  const payloadO = () => ({ messages: [{ role: 'system', content: sys }].concat(msgs.map(m => ({ role: m.role, content: m.content }))) });

  /* bad-set (আজ-মার্ক-করা key/model) */
  const badSet = new Set();
  for (const c of routerChain(env, tier, new Set())) {
    try { if (await getKv(env.PUB_KV, badKeyName(c.key, c.model))) badSet.add(String(c.key).slice(0, 12) + ':' + c.model); } catch (_) {}
  }
  let chain = routerChain(env, tier, badSet);
  if (hasImage) chain = chain.filter(c => c.provider === 'gemini');
  if (!chain.length) {
    const msg = { error: 'no_providers', message: 'AI-সেবা এখন কনফিগার করা নেই — দয়া করে মালিককে জানাও (GEMINI_KEYS)।' };
    return stream ? sseError(msg, 503) : jsonResp(msg, 503);
  }
  if (safety.blocked) {
    const msg = { error: 'mock_refused', message: safety.message };
    return stream ? sseError(msg, 403) : jsonResp(msg, 403);
  }

  const failures = [];
  /* M10: one trace per request, emitted to the Worker log sink. It carries ids,
     counts and durations only — never message text, prompt text or a raw uid —
     and it costs no KV write, so the chat path keeps its two-write budget. */
  const rid = makeRequestId(sendCtx.uid + ':' + startedAt);
  const traceCtx = {
    rid,
    callerRef: callerRef(sendCtx.uid),
    intent,
    tier,
    stream,
    promptVersion: SYSTEM_PROMPT_V,
    contextVersion: ctxBundle ? CONTEXT_VERSION : '',
    agentVersion: AGENT_VERSION
  };
  const emitTrace = (extra = {}) => {
    try {
      console.log(renderTrace(makeTrace({
        ...traceCtx,
        at: Date.now(),
        latencyMs: Date.now() - startedAt,
        tokensIn: estimateTokens(sys),
        tokensOut: estimateTokens(extra.text || ''),
        ...extra
      })));
    } catch (_) {}
  };
  /* M8: validate every model response before it is returned or stored. The
     context (intent, stats, quiz, exam mode) is what the checks compare against;
     nothing here reaches the model. */
  const validationCtx = {
    intent,
    intentConfidence: intentCls.confidence,
    stats,
    quiz: quizMode,
    examMode,
    blocked: safety.blocked
  };
  const finalize = async (model, provider, text) => {
    /* Guests are refused before this point; a signed-in student's memory is keyed
       only by the server-validated account identity and has no client UID. */
    if (!memoryOn) return text;
    /* M8: a response that failed validation is never written to conversation or
       long-term memory — an unsafe reply is not a memory. */
    if (!validateResponse(text, validationCtx).persistable) return text;
    try {
      const next = msgs.concat([{ role: 'user', content: v.messages[v.messages.length - 1].content }, { role: 'assistant', content: text }]).slice(-24).map(x => ({ role: x.role, content: x.content }));
      await putKv(env.PUB_KV, 'chatmem:' + sendCtx.uid, JSON.stringify(next));
    } catch (_) {}

    /* M7: both triggers the owner asked for — an explicit "মনে রাখো" and a
       study/preference/habit fact stated in passing — are extracted from the
       latest user turn. Each candidate must still clear makeMemory(), so a weak
       signal never stores, and no PII can enter a record. */
    try {
      const latest = String(v.messages[v.messages.length - 1].content || '');
      const candidates = extractMemoryCandidates(latest);
      if (candidates.length) {
        const key = 'mem:' + MEMORY_VERSION + ':' + sendCtx.uid;
        let list = parseMemory(await getKv(env.PUB_KV, key), sendCtx.uid);
        let changed = false;
        for (const candidate of candidates) {
          const record = makeMemory(candidate, sendCtx.uid);
          if (!record) continue;
          list = upsertMemory(list, record, sendCtx.uid);
          changed = true;
        }
        if (changed) await putKv(env.PUB_KV, key, JSON.stringify(list));
      }
    } catch (_) {}
  };

  if (!stream) {
    let lastErr = '';
    for (const c of providerChain(env, tier, badSet)) {
      try {
        const raw = await GEMINI_ADAPTER.chatOnce(c, payloadG());
        if (raw) {
          /* M8: the validated text is what the caller receives; the raw model
             output never leaves this function unchecked. */
          const check = validateResponse(raw, validationCtx);
          await finalize(c.model, c.provider, raw);
          emitTrace({ provider: c.provider, model: c.model, text: raw, responseType: check.structured?.type, validated: !check.enforced });
          return jsonResp({ text: check.text, structured: check.structured, model: c.model, intent, pv: SYSTEM_PROMPT_V, latencyMs: Date.now() - startedAt, agent: AGENT_VERSION });
        }
        lastErr = 'empty-' + c.model;
      } catch (e) {
        lastErr = String(e.message || e);
        if (e instanceof ProviderError && e.bad) await putKv(env.PUB_KV, badKeyName(c.key, c.model), '1', 86400);
      }
    }
    emitTrace({ fallbackReason: FALLBACK.PROVIDER_ERROR, validated: false });
    return jsonResp({ error: 'provider_failed', message: 'AI একটু ব্যস্ত — কয়েক সেকেন্ড পরে আবার চেষ্টা করো।', detail: lastErr, retryable: true }, 502);
  }

  /* ── STREAMING (SSE) ── */
  const encoder = new TextEncoder();
  const streamOut = new ReadableStream({
    async start(controller) {
      const push = (s) => { try { controller.enqueue(encoder.encode(s)); } catch (_) {} };
      try {
        let ok = false;
        let lastErr = '';
        for (const c of chain) {
          try {
            let full = '';
            const adapter = adapterFor(c);
            if (!adapter) throw new ProviderError('unknown-provider:' + c.provider, { retryable: false, bad: false });
            const payload = adapter.id === 'gemini' ? payloadG() : payloadO();
            for await (const t of adapter.chatStream(c, payload, env)) { full += t; push(`data: ${JSON.stringify({ text: t })}\n\n`); }
            if (full.trim()) {
              ok = true;
              await finalize(c.model, c.provider, full);
              /* M8: text already streamed, so a blocked response is corrected in
                 place — the client replaces what it rendered with the safe notice.
                 Only high-precision classes fire here, so a normal answer is never
                 rewritten mid-stream. */
              const check = validateResponse(full, validationCtx);
              if (check.enforced) push(`event: replace\ndata: ${JSON.stringify({ text: check.text })}\n\n`);
              emitTrace({ provider: c.provider, model: c.model, text: full, responseType: check.structured?.type, validated: !check.enforced });
              push(`event: done\ndata: ${JSON.stringify({ model: c.model, provider: c.provider, intent, quiz: quizMode, pv: SYSTEM_PROMPT_V, agent: AGENT_VERSION, latencyMs: Date.now() - startedAt, structured: check.structured })}\n\n`);
              break;
            }
            lastErr = 'empty-' + c.model;
          } catch (e) {
            if (e instanceof ProviderError) {
              lastErr = e.message;
              if (e.bad) await putKv(env.PUB_KV, badKeyName(c.key, c.model), '1', 86400);
            } else lastErr = String(e.message || e);
          }
        }
        if (!ok) {
          emitTrace({ fallbackReason: FALLBACK.PROVIDER_ERROR, validated: false });
          push(`event: error\ndata: ${JSON.stringify({ error: 'provider_failed', message: 'AI একটু ব্যস্ত — কয়েক সেকেন্ড পরে আবার চেষ্টা করো।', detail: lastErr, retryable: true })}\n\n`);
        }
      } catch (e) {
        push(`event: error\ndata: ${JSON.stringify({ error: 'stream_failed', message: 'যুক্তি-বিচ্ছেদ ঘটেছে।', detail: String(e.message || e), retryable: true })}\n\n`);
      } finally {
        try { controller.close(); } catch (_) {}
      }
    }
  });
  return new Response(streamOut, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

/* ── GET /api/ai/status ---------------------------------------------------- */
export async function agentStatus(request, env, uid) {
  const hasGemini = !!String(env.GEMINI_KEYS || '').trim();
  const hasGroq = !!String(env.GROQ_API_KEY || '').trim();
  const hasCloudflare = !!String(env.CLOUDFLARE_ACCOUNT_ID || '').trim() && !!String(env.CLOUDFLARE_AI_API_KEY || '').trim();
  const ctxOn = contextEngineEnabled(env);
  return jsonResp({
    ok: true, agent: AGENT_VERSION, pv: SYSTEM_PROMPT_V,
    providers: { gemini: hasGemini, groq: hasGroq, cloudflare: hasCloudflare },
    models: { fast: GEMINI_MODELS.FAST, smart: GEMINI_MODELS.SMART },
    limits: { perDay: Math.max(10, Math.min(500, Number(env.AGENT_DAILY_CAP || 80))) },
    streaming: true,
    tools: { version: TOOL_REGISTRY_VERSION, declared: listTools() },
    memory: { version: MEMORY_VERSION, mode: 'auto', scope: 'account-only' },
    response: describeResponseValidation(),
    actions: describeActions(env),
    observability: describeObservability(),
    context: ctxOn
      ? describeContext(buildContext({ uid, prefs: null, stats: null, onboarding: null, memoryOn: true }))
      : { enabled: false }
  });
}

function jsonResp(d, s = 200) {
  return new Response(JSON.stringify(d), {
    status: s,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-ah-guest', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }
  });
}
function sseError(msg, status) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify(msg)}\n\n`));
      controller.close();
    }
  }), { status, headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' } });
}

export const __test = {
  classifyIntent, validateChatReq, capStats, buildSystemPrompt, summarizeTo,
  safetyGate, authVerificationGuidance, routerChain, geminiTextFromChunk, sseParse, ProviderError,
  adapterFor, providerChain, PROVIDER_ADAPTERS, GEMINI_ADAPTER, GROQ_ADAPTER, CLOUDFLARE_ADAPTER,
  INTENTS, TIER, GEMINI_MODELS, AGENT_VERSION, SYSTEM_PROMPT_V,
  contextEngineEnabled, buildContext, renderContext, describeContext, CONTEXT_VERSION, sanitizeProfileContext,
  listTools, TOOL_REGISTRY_VERSION,
  extractMemoryCandidates, makeMemory, upsertMemory, parseMemory, renderMemory, MEMORY_VERSION,
  validateResponse, describeResponseValidation, RESPONSE_VALIDATION_VERSION,
  describeActions, ACTION_VERSION,
  makeTrace, makeRequestId, callerRef, estimateTokens, quotaState, renderTrace,
  parseTraces, appendTrace, addUsage, emptyUsage, estimateCost, describeObservability,
  validateObservability, OBSERVABILITY_VERSION, FALLBACK
};
