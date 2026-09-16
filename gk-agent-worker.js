// v133b: public-product module
import pubHandler, { publishGlobal } from './public-worker.js';
import { handleInternalEmailRequest } from './email-gateway/worker/handler.mjs';
import { createNativeAuthHandler } from './auth-native/worker/public-auth-handler.mjs';
import { handleFcmNotificationRequest } from './fcm-notification.mjs';
export { EmailGatewayCoordinator } from './email-gateway/worker/email-coordinator.mjs';
export { AdmissionAuthAuthority } from './auth-native/worker/auth-authority-do.mjs';

const nativeAuthHandler = createNativeAuthHandler();
/**
 * 🤖 ADMISSION HUB — Daily GK Agent Worker
 * v111 · Browser Use cloud (৩ key failover) → দিনে মাত্র ১ রান → GK MCQ + verified admission news
 *
 * Secrets:
 *   BROWSER_USE_API_KEYS — কমা-দিয়ে আলাদা করা ৩টা Browser Use cloud key (একাউন্ট ১,২,৩)
 *   TG_BOT_TOKEN, TG_CHAT_ID — রান শেষে Telegram খবর
 * KV: GK_KV (namespace admission-gk-kv)
 * Cron: 30 18 * * * (UTC) = রাত ০০:৩০ ঢাকা — অ্যাপ না খুললেও দিনে ১ বার
 *
 * নীতি: প্রতিদিন ঠিক ১টা run (KV date-guard)। key শেষ/না-চলা (401/402/429) হলে
 * স্বয়ংক্রিয়ভাবে পরের key — সেদিনের জন্য ও key আর চেষ্টা হয় না।
 */

const APP_HEADER = 'admission-hub';
const BU_BASE = 'https://api.browser-use.com/api/v2';
const POLL_EVERY_MS = 30000;
const POLL_MAX_MS = 15 * 60000;

const GK_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          answer: { type: 'string' },
          explain: { type: 'string' },
          source: { type: 'string' }
        },
        required: ['q', 'options', 'answer']
      }
    }
  },
  required: ['questions']
};
const NEWS_SCHEMA = {
  type: 'object',
  properties: {
    news: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          date: { type: 'string' },
          summary: { type: 'string' },
          source: { type: 'string' },
          url: { type: 'string' }
        },
        required: ['title', 'summary']
      }
    }
  },
  required: ['news']
};

const cors = request => {
  const origin = request.headers.get('Origin') || '';
  const ok = /^https:\/\/([a-z0-9-]+\.)?github\.io$/.test(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || /^https:\/\/[a-z0-9-]+\.e2b\.app$/.test(origin); // e2b = workspace-প্রিভিউ
  const headers = { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-AH-App', 'Access-Control-Max-Age': '86400' };
  if (ok) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
};
const json = (request, obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(request) } });
const dhakaToday = () => new Date(Date.now() + 6 * 3600000).toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const keys = env => String(env.BROWSER_USE_API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);

const badKeysToday = async (env, date, ns = 'gk') => {
  try { return JSON.parse(await env.GK_KV.get(`badKeys:${date}:${ns}`) || '[]'); } catch (_) { return []; }
};
const markBad = async (env, date, index, ns = 'gk') => {
  try {
    const bad = await badKeysToday(env, date);
    if (!bad.includes(index)) { bad.push(index); await env.GK_KV.put(`badKeys:${date}:${ns}`, JSON.stringify(bad)); }
  } catch (_) {}
};

// একটা key দিয়ে task তৈরি; 401/402 → dead, 429 → busy
const tryCreate = async (key, body) => {
  try {
    const resp = await fetch(`${BU_BASE}/tasks`, {
      method: 'POST',
      headers: { 'X-Browser-Use-API-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (resp.status === 401 || resp.status === 402) return { dead: true };
    if (resp.status === 429) return { busy: true };
    if (!resp.ok) return { error: 'http-' + resp.status };
    const data = await resp.json();
    return data?.id ? { id: data.id } : { error: 'no-id' };
  } catch (_) { return { error: 'network' }; }
};

const createWithFailover = async (env, date, body, shift = 0, forceKeys = null) => {
  const all = forceKeys || keys(env);
  if (!all.length) return null;
  const ns = forceKeys ? 'ask' : 'gk'; // forceKeys-এর index আলাদা নেমস্পেসে — GK-পুল অক্ষত
  const bad = await badKeysToday(env, date, ns); // 401/402 — সেদিনের জন্য মৃত
  // দৈনিক রোটেশন: প্রতিদিন ভিন্ন key দিয়ে শুরু — কোটা সব key-এ সমান ভাগে খরচ হয়
  const dayIndex = Math.floor(Date.parse(date + 'T00:00:00+06:00') / 86400000);
  const offset = ((((dayIndex % all.length) + all.length) % all.length) + shift) % all.length;
  const busy = new Set(); // 429/নেটওয়ার্ক — শুধু এই রানে স্কিপ, key বাতিল নয়
  for (let i = 0; i < all.length; i++) {
    const idx = (offset + i) % all.length;
    if (bad.includes(idx) || busy.has(idx)) continue;
    const result = await tryCreate(all[idx], body);
    if (result.id) return { id: result.id, keyIndex: idx };
    if (result.dead) { await markBad(env, date, idx, ns); continue; }
    busy.add(idx);
  }
  return null;
};

const GK_PROMPT = date => `Today's date is ${date} (Bangladesh, Asia/Dhaka). You are preparing daily current-affairs GK practice for Bangladeshi university admission candidates.
Browse credible Bangladeshi and international sources today — e.g. prothomalo.com, bangla.bdnews24.com, jagonews24.com, kalerkantho.com, ittefaq.com.bd, bbc.com/bengali, samakal.com, and any reliable reference pages needed for verification.
Collect 15-25 multiple-choice current-affairs/GK questions useful for university admission tests. CORRECTNESS IS THE #1 PRIORITY — a single wrong fact is a critical failure. Rules:
- Double-source rule: every question's fact MUST be verified during this session by actually OPENING at least 2 independent credible pages (e.g. a news site + a second outlet or an official/reference page). One search-result snippet is NOT enough.
- If you cannot confirm a fact from 2 sources, DROP that question. Skip anything uncertain, ambiguous or time-sensitive-until-confirmed.
- Prefer the last ~30 days: national BD news, international, sports, science-tech, awards, economy, and important anniversaries.
- Write the question in Bangla (short), options in Bangla (exactly 4, one clearly correct), "answer" must exactly match one option, "explain" is one short Bangla line, "source" is the site name or URL you verified from.
- No duplicates, no opinion-based questions, no placeholder text.
- STRICT FORBIDDEN: do NOT use your memory/training knowledge alone for any fact — everything must come from pages you opened today. Do not guess dates, numbers, names or award winners.`;

const NEWS_PROMPT = date => `Today's date is ${date} (Bangladesh, Asia/Dhaka). You are a news researcher for Bangladeshi university-admission candidates. Find the LATEST verified admission news (last 2-3 days, today first).
Categories: application circular openings & deadlines, exam dates, seat plans, admit cards, results, admission requirements/fees — for DU, BUET, CU, JU, RU, RUET, CUET, SUST, GST/GUST cluster, agricultural universities and major private universities.
You MUST actually OPEN and read at least 6-8 of these verified sources before concluding (visit several, not just one):
- National dailies & TV: prothomalo.com, bangla.bdnews24.com, kalerkantho.com, ittefaq.com.bd, samakal.com, jagonews24.com, banglatribune.com, bbc.com/bengali, somoynews.tv, channelsonline.com
- Discovery: also search Google News (news.google.com) for "admission circular", "admission test date" etc. and follow only credible/official links.
- University official sites when a circular is mentioned: du.ac.bd, buet.ac.bd, cu.ac.bd, ju.edu.bd? (verify via search), ru.ac.bd, gstadmission.ac.bd, rsu? — official .ac.bd / .edu domains only.
Rules: ONLY items you verified on a page you actually opened this session. For each: title in Bangla, date (YYYY-MM-DD), 1-2 line Bangla summary, source domain, full URL. If after checking multiple sources nothing verified exists, return an empty news array — do NOT invent or reuse old news.`;

const parseOutput = task => {
  if (!task) return null;
  if (task.status !== 'finished') return null;
  const raw = task.output ?? task.result ?? task.data ?? task.finalResult;
  if (raw == null) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw.replace(/^```json\s*|```$/g, '').trim()) : raw;
    return parsed;
  } catch (_) { return null; }
};

const getTask = async (key, id) => {
  try {
    const resp = await fetch(`${BU_BASE}/tasks/${id}`, { headers: { 'X-Browser-Use-API-Key': key } });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (_) { return null; }
};

// সব টাস্ক শেষ হলে ডেটা KV-তে + Telegram খবর
const newsTaskBody = (env, date) => ({ task: NEWS_PROMPT(date), llm: env.BU_LLM_NEWS || 'browser-use-2.0', maxSteps: 30, structuredOutput: JSON.stringify(NEWS_SCHEMA), flashMode: false });

const runBackground = async (env, date, jobs) => {
  const all = keys(env);
  const deadline = Date.now() + POLL_MAX_MS;
  const results = { gk: null, news: null };
  while (Date.now() < deadline) {
    await sleep(POLL_EVERY_MS);
    for (const job of jobs) {
      if (results[job.kind]) continue;
      const task = await getTask(all[job.keyIndex] || all[0], job.id);
      if (!task) continue;
      if (task.status === 'failed') results[job.kind] = { error: 'agent-failed' };
      else results[job.kind] = parseOutput(task);
    }
    if (results.gk && results.news) break;
  }
  await finalizeResults(env, date, results);
};

// ফলাফল ফিল্টার → KV-সেভ → Telegram খবর (runBackground + healTasks দুই জায়গায় ব্যবহৃত)
const finalizeResults = async (env, date, results) => {
  let prev = null;
  try { const saved = await env.GK_KV.get(`gkData:${date}`); if (saved) prev = JSON.parse(saved); } catch (_) {}
  const sameDay = prev && prev.date === date;
  const gkRes = results.gk || (sameDay && Array.isArray(prev.questions) ? { questions: prev.questions, reused: true } : null);
  const newsRes = results.news || (sameDay && Array.isArray(prev.news) ? { news: prev.news, reused: true } : null);
  const questions = Array.isArray(gkRes?.questions) ? gkRes.questions.filter(q => q?.q && Array.isArray(q.options) && q.options.length >= 2).slice(0, 40) : [];
  const news = Array.isArray(newsRes?.news) ? newsRes.news.filter(n => n?.title && n?.summary).slice(0, 8) : [];
  const payload = { date, count: questions.length, newsCount: news.length, questions, news, finishedAt: Date.now(), partial: !results.gk || !results.news };
  try { await env.GK_KV.put(`gkData:${date}`, JSON.stringify(payload)); await env.GK_KV.put('latest', JSON.stringify(payload)); } catch (_) {}
  try {
    if (env.TG_BOT_TOKEN && env.TG_CHAT_ID) {
      const msg = results.gk
        ? (questions.length
          ? `🤖 আজকের GK এসেছে!\n\n📚 ${questions.length}টি নতুন MCQ${news.length ? `\n📰 ${news.length}টি verified admission news` : '\n📰 আজ কোনো verified news নেই'}\n\nঅ্যাপে Dashboard → 🤖 ডেইলি GK এজেন্ট খোলো!`
          : '🤖 আজ GK এজেন্ট যথেষ্ট verified প্রশ্ন জোগাড় করতে পারেনি — কাল আবার চেষ্টা হবে।')
        : (news.length ? `📰 আজকের admission নিউজ এসেছে!\n\n${news.length}টি verified খবর — অ্যাপে Dashboard → 🤖 ডেইলি GK এজেন্ট → নিউজ ট্যাব` : null);
      if (!msg) return payload;
      await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text: msg }) }).catch(() => {});
    }
  } catch (_) {}
  return payload;
};

// ── Study-AI: ব্রাউজার-এজেন্ট চ্যাট (দ্রুত ইঞ্জিন অ্যাপে, ওয়েব-মোড এখানে) ──
const ASK_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    sources: { type: 'array', items: { type: 'string' } }
  },
  required: ['answer']
};

const ASK_PROMPT = (question, context, bankBlock, histBlock) => `You are "স্টাডি বন্ধু" — a warm, friendly Bangla study-helper for a Bangladeshi university-admission candidate. Today: ${dhakaToday()} (Asia/Dhaka).
User's question: """${question}"""
${context ? `User's study context (use silently, never dump raw): ${context}` : ''}${bankBlock || ''}${histBlock || ''}
Rules: Reply in simple warm Bangla (তুমি-ফর্ম), 2-6 short lines, light emoji ok.${bankBlock ? ' When the bank block is present, base your answer primarily on it (it is the student\'s own verified bank) and mention you answered from their question bank.' : ''} FRESHNESS RULE (critical): for ANY factual, current-affairs, date/number/name, exam-deadline or "এখন/আজ/সর্বশেষ"-type question you MUST browse the live web RIGHT NOW and verify from at least one credible page you actually open before answering — Google-overview-level freshness is the minimum bar. NEVER answer such questions from memory/training data; a stale or outdated fact is a critical failure. If today's verified info cannot be found, say clearly what could not be verified instead of guessing. Always include source domains in sources. Never invent facts. End with a tiny nudge to keep studying.`;

// ── ইউজারের প্রশ্নব্যাংক-মেমোরি: অ্যাপ থেকে আসা সব প্রশ্ন+ইতিহাস KV-তে ──
const normalizeBank = (questions, stats) => {
  const qs = (Array.isArray(questions) ? questions : []).slice(0, 3000).map(q => {
    const o = (Array.isArray(q && (q.o ?? q.options)) ? (q.o ?? q.options) : []).slice(0, 6).map(x => String(x).slice(0, 90));
    const ai = Number(q && (q.answerIndex ?? q.correctAnswerIndex));
    const a = String((q && (q.a ?? q.answer)) ?? (Number.isFinite(ai) && o[ai] != null ? o[ai] : '')).slice(0, 120);
    return {
    q: String((q && (q.q ?? q.question)) ?? '').slice(0, 260),
    o,
    a,
    e: String((q && (q.e ?? q.explain)) ?? '').slice(0, 260),
    s: String((q && (q.s ?? q.subject)) ?? '').slice(0, 70),
    t: String((q && (q.t ?? q.topic)) ?? '').slice(0, 70)
    };
  }).filter(x => x.q && x.o.length >= 2);
  const st = (stats && typeof stats === 'object') ? stats : {};
  return { qs, stats: { count: Number(st.count) || qs.length, exams: Number(st.exams) || 0, avgAcc: st.avgAcc ?? null, weak: Array.isArray(st.weak) ? st.weak.slice(0, 8).map(x => String(x).slice(0, 60)) : [] } };
};

const bankUpload = async (request, env) => {
  try {
    let body = {}; try { body = await request.json(); } catch (_) {}
    const bank = normalizeBank(body.questions, body.stats);
    if (!bank.qs.length) return json(request, { error: 'empty-bank' }, 400);
    await env.GK_KV.put('userBank', JSON.stringify({ ...bank, history: Array.isArray(body.history) ? body.history.slice(0, 500) : [], mistakes: Array.isArray(body.mistakes) ? body.mistakes.slice(0, 400) : [], vocabulary: Array.isArray(body.vocabulary) ? body.vocabulary.slice(0, 1500) : [], activity: body.activity && typeof body.activity === 'object' ? body.activity : {}, ...(body.full && typeof body.full === 'object' ? { full: body.full } : {}), savedAt: Date.now() }));
    if (body.full && typeof body.full === 'object' && env.PUB_KV) {
      try { await publishGlobal(env, body.full); } catch (_) {}
    }
    return json(request, { saved: true, count: bank.qs.length });
  } catch (_) { return json(request, { error: 'bank-failed' }, 500); }
};

const bankInfo = async (request, env) => {
  try {
    const raw = await env.GK_KV.get('userBank');
    if (!raw) return json(request, { saved: false });
    // v133: full=1 → পুরো ব্যাংক (প্রশ্ন+ভুল+শব্দ+ইতিহাস) — public-প্রোডাক্ট পাইপলাইনের সেতু (admin-only ব্যবহার)
    try { if (new URL(request.url).searchParams.get('full') === '1') return json(request, { saved: true, bank: JSON.parse(raw) }); } catch (_) {}
    const b = JSON.parse(raw);
    return json(request, { saved: true, count: b.qs.length, stats: b.stats, savedAt: b.savedAt, history: Array.isArray(b.history) ? b.history.length : 0, mistakes: Array.isArray(b.mistakes) ? b.mistakes.length : 0, vocabulary: Array.isArray(b.vocabulary) ? b.vocabulary.length : 0, activity: b.activity || {} });
  } catch (_) { return json(request, { saved: false }); }
};

// ইতিহাস+অ্যাক্টিভিটি → এজেন্ট-প্রম্পট ব্লক (সাইলেন্ট-ইউজ)
const histBlock = b => {
  try {
    const h = Array.isArray(b && b.history) ? b.history.slice(0, 10) : [];
    const a = (b && b.activity) || {};
    let out = '';
    if (h.length) out += '\nপরীক্ষার ইতিহাস (নতুন→পুরনো): ' + h.map(x => `${(x && x.d) || ''} — ${((x && x.s) || '?')}${x && x.m ? ' (' + x.m + ')' : ''}`).join(' | ');
    if (a && (a.exams || a.mistakes || a.vocab)) out += `\nঅ্যাক্টিভিটি: মোট পরীক্ষা ${a.exams || 0} · ভুল-নোট ${a.mistakes || 0} · শব্দ ${a.vocab || 0}`;
    const lt = (a && a.lifetime) || {};
    if (lt && (lt.answered || lt.daysActive)) out += `\nলাইফটাইম: উত্তর ${lt.answered || 0}টি · সঠিক ${lt.correct || 0}${lt.acc != null ? ' (' + lt.acc + '%)' : ''} · সক্রিয় দিন ${lt.daysActive || 0} · চ্যাট-ওপেন ${lt.opens || 0}`;
    if (a && a.coach && a.coach.total) out += `\nশেষ চ্যাট-পরীক্ষা (কোচ-নোট): ${a.coach.score || 0}/${a.coach.total}${Array.isArray(a.coach.weak) && a.coach.weak.length ? ' — দুর্বল: ' + a.coach.weak.slice(0, 4).join(', ') : ''}`;
    const ms2 = Array.isArray(b && b.mistakes) ? b.mistakes.slice(0, 8) : [];
    if (ms2.length) out += '\nসাম্প্রতিক ভুল-প্রশ্ন (সঠিক-উত্তরসহ):\n' + ms2.map(x => `— ${String((x && x.q) || '').slice(0, 90)}${x && x.a ? ' ⇒ সঠিক: ' + String(x.a).slice(0, 40) : ''}`).join('\n');
    const vs2 = Array.isArray(b && b.vocabulary) ? b.vocabulary.slice(0, 12) : [];
    if (vs2.length) out += '\nশব্দ-সংগ্রহ: ' + vs2.map(x => `${String((x && x.w) || '').slice(0, 30)}${x && x.m ? '=' + String(x.m).slice(0, 30) : ''}`).join(', ');
    return out ? `\n(শিক্ষার্থীর পরীক্ষার ইতিহাস ও অ্যাক্টিভিটি — সাইলেন্টলি ব্যবহার করো, raw ডাম্প করো না)${out}` : '';
  } catch (_) { return ''; }
};

// ব্যাংক থেকে প্রশ্নের সাথে মিলিয়ে top-পিক (subject ফিল্টারসহ)
const bankPick = (bank, question, subject) => {
  const toks = String(question).toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(t => t.length > 2).slice(0, 20);
  let pool = bank.qs || [];
  if (subject) { const f = pool.filter(q => (q.s || '').includes(subject) || (q.t || '').includes(subject)); if (f.length) pool = f; }
  return pool.map(q => {
    const hay = (q.q + ' ' + (q.o || []).join(' ') + ' ' + (q.s || '') + ' ' + (q.t || '')).toLowerCase();
    let sc = 0; for (const t of toks) if (hay.includes(t)) sc++;
    return { q, sc };
  }).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 12).map(x => x.q);
};

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'ask-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));

const createAsk = async (request, env, ctx) => {
  const date = dhakaToday();
  try {
    let body = {};
    try { body = await request.json(); } catch (_) {}
    const question = String(body.question || '').trim().slice(0, 600);
    const context = String(body.context || '').trim().slice(0, 1200);
    if (!question) return json(request, { error: 'empty-question' }, 400);
    if (!keys(env).length) return json(request, { error: 'keys-not-configured' }, 503);
    const id = newId();
    const source = String(body.source || 'auto').slice(0, 60);
    let bankBlock = '';
    let histB = '';
    {
      const raw = await env.GK_KV.get('userBank');
      if (raw) {
        const bank = JSON.parse(raw);
        histB = histBlock(bank);
        if (source.startsWith('bank')) {
          const subject = source.startsWith('bank:') ? decodeURIComponent(source.slice(5)) : '';
          const picks = bankPick(bank, question, subject);
          bankBlock = picks.length
            ? `\nশিক্ষার্থীর নিজের প্রশ্নব্যাংক থেকে মিলে-যাওয়া প্রশ্ন-উত্তর (উত্তরের প্রধান ভিত্তি এগুলো):\n${picks.map((q, i) => `${i + 1}) প্র: ${q.q}\n${(q.o || []).map((o, oi) => `   ${'কখগঘঙ'[oi] || oi + 1}) ${o}`).join('\n')}\n   উত্তর: ${q.a}${q.e ? ` — ${q.e}` : ''}`).join('\n')}\n`
            : `\n(শিক্ষার্থীর প্রশ্নব্যাংকে এই বিষয়ে সরাসরি মিল পাওয়া যায়নি — তার অবস্থা মাথায় রেখে সাবধানে উত্তর দাও।)\n`;
        }
      }
    }
    const askBody = { task: ASK_PROMPT(question, context, bankBlock, histB), llm: env.BU_LLM || 'browser-use-2.0', maxSteps: 14, structuredOutput: JSON.stringify(ASK_SCHEMA), flashMode: false };
    const askKey = String(env.ASK_API_KEY || '').trim();
    if (!askKey) return json(request, { error: 'ask-key-not-configured' }, 503);
    let job = await createWithFailover(env, date, askBody, 0, [askKey]); // dedicated চ্যাট-key
    let dedicated = !!job;
    if (!job) job = await createWithFailover(env, date, askBody, Math.floor(Date.now() / 60000)); // মরে গেলে GK-পুল ফলব্যাক
    if (!job) return json(request, { error: 'all-keys-exhausted' }, 429);
    await env.GK_KV.put(`ask:${id}`, JSON.stringify({ id, jobId: job.id, keyIndex: job.keyIndex, dedicated, date, status: 'running', createdAt: Date.now() }), { expirationTtl: 86400 * 3 });
    return json(request, { id, started: true });
  } catch (_) { return json(request, { error: 'ask-failed' }, 500); }
};

const askStatus = async (request, env, id) => {
  try {
    if (!/^[a-f0-9-]{8,40}$/i.test(id)) return json(request, { error: 'bad-id' }, 400);
    const rec = await env.GK_KV.get(`ask:${id}`);
    if (!rec) return json(request, { error: 'not-found' }, 404);
    const ask = JSON.parse(rec);
    if (ask.status !== 'running') return json(request, ask);
    const all = keys(env);
    const key = ask.dedicated ? (String(env.ASK_API_KEY || '').trim() || all[0]) : (all[ask.keyIndex] || all[0]);
    let task = await getTask(key, ask.jobId).catch(() => null);
    if (!task && String(env.ASK_API_KEY || '').trim() && key !== String(env.ASK_API_KEY).trim()) task = await getTask(String(env.ASK_API_KEY).trim(), ask.jobId).catch(() => null); // legacy-shim
    if (!task) return json(request, { status: 'running' });
    if (task.status === 'failed') { ask.status = 'failed'; await env.GK_KV.put(`ask:${id}`, JSON.stringify(ask)); return json(request, { status: 'failed' }); }
    const out = parseOutput(task);
    if (out && typeof out.answer === 'string' && out.answer.trim()) {
      ask.status = 'finished';
      ask.answer = String(out.answer).slice(0, 4000);
      ask.sources = Array.isArray(out.sources) ? out.sources.map(x => String(x).slice(0, 120)).slice(0, 6) : [];
      await env.GK_KV.put(`ask:${id}`, JSON.stringify(ask));
      return json(request, { status: 'finished', answer: ask.answer, sources: ask.sources });
    }
    return json(request, { status: task.status === 'finished' ? 'failed' : 'running' });
  } catch (_) { return json(request, { error: 'status-failed' }, 500); }
};

// self-heal: ব্যাকগ্রাউন্ড-পোল শেষ হয়ে গেলেও /api/gk/today GET-ই BU-তে finished টাস্ক এনে সেভ করে
const healTasks = async (env, date) => {
  try {
    const rec = await env.GK_KV.get(`gkTasks:${date}`);
    if (!rec) return null;
    const { jobs = [] } = JSON.parse(rec);
    if (!jobs.length) return null;
    const all = keys(env);
    const results = { gk: null, news: null };
    let pending = false;
    for (const job of jobs) {
      const task = await getTask(all[job.keyIndex] || all[0], job.id).catch(() => null);
      if (!task || (task.status !== 'finished' && task.status !== 'failed')) { pending = true; continue; }
      results[job.kind] = task.status === 'failed' ? { error: 'agent-failed' } : parseOutput(task);
    }
    if (pending && !results.gk && !results.news) return null; // এখনো চলছে
    return await finalizeResults(env, date, results);
  } catch (_) { return null; }
};

// নিউজ-আলাদা রি-রান: আজকের GK প্রশ্ন অক্ষত রেখে শুধু news টাস্ক নতুন করে চলে
const startNewsOnly = async (request, env, ctx, date) => {
  try {
    if (!keys(env).length) return json(request, { error: 'keys-not-configured' }, 503);
    const newsJob = await createWithFailover(env, date, newsTaskBody(env, date), 1);
    if (!newsJob) return json(request, { error: 'all-keys-exhausted' }, 429);
    const job = { kind: 'news', id: newsJob.id, keyIndex: newsJob.keyIndex };
    const rec = await env.GK_KV.get(`gkTasks:${date}`);
    const tasksRec = rec ? JSON.parse(rec) : { jobs: [], startedAt: Date.now() };
    tasksRec.jobs = tasksRec.jobs.filter(j => j.kind !== 'news').concat([job]);
    await env.GK_KV.put(`gkTasks:${date}`, JSON.stringify(tasksRec));
    if (ctx && ctx.waitUntil) ctx.waitUntil(runBackground(env, date, [job]));
    else runBackground(env, date, [job]);
    return json(request, { started: true, kind: 'news' });
  } catch (_) { return json(request, { error: 'run-failed' }, 500); }
};

const maybeStart = async (request, env, ctx) => {
  const date = dhakaToday();
  try {
    if (new URL(request.url).searchParams.get('kind') === 'news') return await startNewsOnly(request, env, ctx, date);
    const lastDay = await env.GK_KV.get('gkDay');
    if (lastDay === date) {
      const stored = await env.GK_KV.get(`gkData:${date}`);
      return json(request, stored ? { already: true, ready: true } : { already: true, ready: false });
    }
    if (!keys(env).length) return json(request, { error: 'keys-not-configured' }, 503);
    await env.GK_KV.put('gkDay', date); // দিনে ১ run — এখনই গার্ড বসে
    const gkJob = await createWithFailover(env, date, { task: GK_PROMPT(date), llm: env.BU_LLM || 'browser-use-2.0', maxSteps: 45, structuredOutput: JSON.stringify(GK_SCHEMA), flashMode: false });
    const newsJob = await createWithFailover(env, date, newsTaskBody(env, date), 1); // shift+1: GK ও news ভিন্ন key-এ; শক্ত মডেল + ধীর ব্রাউজিং
    const jobs = [
      gkJob ? { kind: 'gk', id: gkJob.id, keyIndex: gkJob.keyIndex } : null,
      newsJob ? { kind: 'news', id: newsJob.id, keyIndex: newsJob.keyIndex } : null
    ].filter(Boolean);
    await env.GK_KV.put(`gkTasks:${date}`, JSON.stringify({ jobs, startedAt: Date.now() }));
    if (!jobs.length) return json(request, { error: 'all-keys-exhausted' }, 429);
    if (ctx && ctx.waitUntil) ctx.waitUntil(runBackground(env, date, jobs));
    else runBackground(env, date, jobs);
    return json(request, { started: true, tasks: jobs.length });
  } catch (error) {
    return json(request, { error: 'run-failed' }, 500);
  }
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const authResponse = await nativeAuthHandler(request, env, ctx);
    if (authResponse) return authResponse;
    const emailResponse = await handleInternalEmailRequest(request, env, ctx);
    if (emailResponse) return emailResponse;
    // Phase 1 — FCM notification foundation (owns /api/notifications/* + /internal/notifications/health).
    const fcmResponse = await handleFcmNotificationRequest(request, env, ctx);
    if (fcmResponse) return fcmResponse;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });

    // Public product API: content, Firebase-session-aware or ephemeral-guest AI,
    // and content admin only. Retired legacy identity routes are not forwarded.
    if (url.pathname.startsWith('/pub/') || url.pathname.startsWith('/api/')) {
      const gatedApi = url.pathname === '/api/ask' || url.pathname.startsWith('/api/ask/') || url.pathname === '/api/bank' || url.pathname.startsWith('/api/gk/') || url.pathname === '/api/cloud/publish';
      const u2p = new URL(request.url); u2p.pathname = url.pathname.replace(/^\/pub\//, '/api/');
      if (url.pathname.startsWith('/pub/') || !gatedApi) {
        const envPub = {
          PUB_KV: env.PUB_KV,
          AUTH_AUTHORITY: env.AUTH_AUTHORITY,
          OLD_KV: env.OLD_KV || env.GK_KV,
          ADMIN_TOKEN: env.ADMIN_TOKEN,
          GEMINI_KEYS: env.GEMINI_KEYS,
          GROQ_API_KEY: env.GROQ_API_KEY,
          AGENT_DAILY_CAP: env.AGENT_DAILY_CAP,
          AGENT_PUBLIC_DAILY_CAP: env.AGENT_PUBLIC_DAILY_CAP,
          AGENT_GEMINI_MODELS: env.AGENT_GEMINI_MODELS
        };
        return pubHandler.fetch(new Request(u2p.href, request), envPub, ctx);
      }
    }

    if (url.pathname === '/health') {
      return json(request, { ok: true, keys: keys(env).length, askKey: !!env.ASK_API_KEY, kv: !!env.GK_KV, tg: !!env.TG_BOT_TOKEN, agent: 'agent-f1', gemini: !!env.GEMINI_KEYS, groq: !!env.GROQ_API_KEY, lastDay: env.GK_KV ? await env.GK_KV.get('gkDay') : null });
    }

    const isApp = request.headers.get('X-AH-App') === APP_HEADER;
    // sendBeacon-ফলব্যাক: হেডার ছাড়া এলে শুধু অ্যাপের নিজের Origin হলে /api/bank POST গ্রহণযোগ্য
    const beaconOk = !isApp && request.method === 'POST' && url.pathname === '/api/bank' && request.headers.get('Origin') === 'https://sheikhrashel47-stack.github.io';
    if (!isApp && !beaconOk) return json(request, { error: 'forbidden' }, 403);
    if (request.method === 'POST' && url.pathname === '/api/ask') return await createAsk(request, env, ctx);
    if (request.method === 'POST' && url.pathname === '/api/bank') return await bankUpload(request, env);
    if (request.method === 'GET' && url.pathname === '/api/bank') return await bankInfo(request, env);
    if (request.method === 'POST' && url.pathname === '/api/cloud/publish') {
      let body = {};
      try { body = await request.json(); } catch (_) {}
      const result = await publishGlobal(env, body);
      if (result.error === 'empty') return json(request, { error: 'empty-global' }, 400);
      if (result.error) return json(request, result, 500);
      return json(request, result);
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/ask/')) return await askStatus(request, env, url.pathname.split('/').pop() || '');

    if (request.method === 'POST' && url.pathname === '/api/gk/run') return maybeStart(request, env, ctx);

    if (request.method === 'GET' && url.pathname === '/api/gk/today') {
      const date = dhakaToday();
      try {
        const tasks = await env.GK_KV.get(`gkTasks:${date}`);
        if (tasks) { // টাস্ক আছে → আগে heal: finished টাস্ক এনে merge-করে সেভ করে
          const healed = await healTasks(env, date);
          if (healed) return json(request, { ready: true, date, payload: healed });
        }
        const stored = await env.GK_KV.get(`gkData:${date}`);
        if (stored) return json(request, { ready: true, date, payload: JSON.parse(stored) });
        return json(request, { ready: false, date, running: !!tasks });
      } catch (_) { return json(request, { ready: false, date, running: false }); }
    }

    return json(request, { error: 'not_found' }, 404);
  },

  async scheduled(event, env, ctx) {
    if (!env.GK_KV || !keys(env).length) return;
    const date = dhakaToday();
    try { if ((await env.GK_KV.get('gkDay')) === date) return; } catch (_) {}
    const fakeRequest = new Request('https://cron/api/gk/run', { method: 'POST', headers: { 'X-AH-App': APP_HEADER } });
    await maybeStart(fakeRequest, env, ctx);
  }
};

export const __test = { tryCreate, createWithFailover, parseOutput, dhakaToday, keys, GK_PROMPT, GK_SCHEMA, NEWS_SCHEMA, finalizeResults, normalizeBank, bankPick, bankUpload, bankInfo, ASK_PROMPT, histBlock };
