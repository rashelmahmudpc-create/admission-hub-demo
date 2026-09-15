// Admission Hub — Public Product Worker (account system retired, v221)
// Active routes: public content · Firebase-account/ephemeral-guest AI · content admin.
// The former login/profile/onboarding/session/state APIs are intentionally absent.
import { agentChat, agentStatus, sanitizeAiPrefs, AI_PREFS_DEFAULT } from './ai-agent.js';

const JSONH = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-ah-app,x-ah-guest',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSONH });
const onlyRows = rows => (Array.isArray(rows) ? rows : []).filter(row => row && row.id).map(row => {
  const clean = { ...row };
  for (const key of ['imageDataUrl', 'image', 'thumbnail']) {
    if (typeof clean[key] === 'string' && clean[key].startsWith('data:') && clean[key].length > 900000) delete clean[key];
  }
  return clean;
});
const fingerprintGlobal = doc => {
  const questions = doc.questions || [];
  return [
    (doc.subjects || []).length,
    (doc.topics || []).length,
    questions.length,
    (doc.vocabulary || []).length,
    (doc.vocabularyMaster || []).length,
    questions.reduce((total, row) => total + String(row.question || row.q || '').length, 0)
  ].join(':');
};
const countsOf = doc => ({
  subjects: (doc.subjects || []).length,
  topics: (doc.topics || []).length,
  questions: (doc.questions || []).length,
  vocabulary: (doc.vocabulary || []).length,
  vocabularyMaster: (doc.vocabularyMaster || []).length
});
const paginateContent = (doc, limit, offset) => {
  if (!doc || typeof doc !== 'object') return doc;
  const rawLimit = Number(limit);
  const pageLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(500, rawLimit) : 0;
  const pageOffset = Math.max(0, Number(offset) || 0);
  if (!pageLimit) return doc;
  const out = { ...doc };
  for (const key of ['questions', 'vocabulary', 'vocabularyMaster', 'subjects', 'topics', 'exams']) {
    if (Array.isArray(doc[key])) out[key] = doc[key].slice(pageOffset, pageOffset + pageLimit);
  }
  out.total = Array.isArray(doc.questions) ? doc.questions.length : 0;
  out.page = { limit: pageLimit, offset: pageOffset };
  return out;
};
const sha256 = async value => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};
const dayKey = () => new Date().toISOString().slice(0, 10);
const readGuestHeader = request => {
  const value = String(request.headers.get('X-AH-Guest') || '').trim();
  return /^[A-Za-z0-9_-]{16,96}$/.test(value) ? value : '';
};
const readCookie = (request, name) => {
  const header = String(request.headers.get('Cookie') || '');
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1 || part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch (_) { return ''; }
  }
  return '';
};
async function authenticatedAiIdentity(request, env) {
  const sessionToken = readCookie(request, '__Host-ah_session');
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(sessionToken) || !env?.AUTH_AUTHORITY) return null;
  try {
    const id = env.AUTH_AUTHORITY.idFromName('admission-hub-global-auth-v1');
    const stub = env.AUTH_AUTHORITY.get(id);
    const response = await stub.fetch('https://auth.internal/internal/session/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken })
    });
    const payload = await response.json().catch(() => null);
    const userId = String(payload?.result?.user?.id || '');
    if (!response.ok || payload?.ok !== true || !/^[A-Za-z0-9_-]{8,128}$/.test(userId)) return null;
    return `account-${(await sha256(userId)).slice(0, 40)}`;
  } catch (_) { return null; }
}
async function anonymousAiIdentity(request, env, countUsage = true) {
  const supplied = readGuestHeader(request);
  const userAgent = String(request.headers.get('User-Agent') || '').slice(0, 180);
  const network = String(request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown').split(',')[0].trim();
  const deviceHash = await sha256(supplied || `${network}|${userAgent}`);
  const networkHash = await sha256(network === 'unknown' ? `${network}|${userAgent}` : network);

  // Public AI remains usable without recreating a login system. A network-level
  // ceiling complements the per-anonymous-device cap inside agentChat.
  if (countUsage && env.PUB_KV) {
    const key = `aipub:${networkHash.slice(0, 24)}:${dayKey()}`;
    let count = 0;
    try { count = Number((await env.PUB_KV.get(key)) || 0); } catch (_) {}
    const cap = Math.max(40, Math.min(800, Number(env.AGENT_PUBLIC_DAILY_CAP || 240)));
    if (count >= cap) throw Object.assign(new Error('আজকের public AI সীমা শেষ — কাল আবার চেষ্টা করো।'), { status: 429 });
    try { await env.PUB_KV.put(key, String(count + 1), { expirationTtl: 172800 }); } catch (_) {}
  }
  return `guest-${deviceHash.slice(0, 40)}`;
}
async function aiRequestIdentity(request, env, countUsage = true) {
  const accountUid = await authenticatedAiIdentity(request, env);
  if (accountUid) return { uid: accountUid, persistMemory: true, authenticated: true };
  const uid = await anonymousAiIdentity(request, env, countUsage);
  return { uid, persistMemory: false, authenticated: false };
}

export const publishGlobal = async (env, full) => {
  if (!env || !env.PUB_KV) return { error: 'no-pub-kv' };
  const source = full && typeof full === 'object' ? full : {};
  const subjects = onlyRows(source.subjects);
  const topics = onlyRows(source.topics);
  const questions = onlyRows(source.questions);
  const vocabulary = onlyRows(source.vocabulary);
  const vocabularyMaster = onlyRows(source.vocabularyMaster);
  if (!questions.length && !vocabularyMaster.length) return { error: 'empty' };

  const sig = fingerprintGlobal({ subjects, topics, questions, vocabulary, vocabularyMaster });
  let previousMeta = { v: 0 };
  try { previousMeta = JSON.parse((await env.PUB_KV.get('pubContentMeta')) || '{"v":0}'); } catch (_) {}
  if (previousMeta.sig === sig && previousMeta.v) {
    return { published: false, unchanged: true, v: previousMeta.v, counts: previousMeta.counts || countsOf({ subjects, topics, questions, vocabulary, vocabularyMaster }) };
  }

  let exams = [{ id: 'mock1', title: 'মক পরীক্ষা ১', mins: 15, n: Math.min(15, questions.length || 1), published: true, desc: 'সব বিষয় মিশিয়ে' }];
  try {
    const previous = JSON.parse((await env.PUB_KV.get('pubContent')) || '{}');
    if (Array.isArray(previous.exams) && previous.exams.length) exams = previous.exams;
  } catch (_) {}

  const doc = { v: (Number(previousMeta.v) || 0) + 1, at: Date.now(), sig, subjects, topics, questions, vocabulary, vocabularyMaster, exams };
  let raw = JSON.stringify(doc);
  if (raw.length > 24 * 1024 * 1024) {
    doc.vocabularyMaster = (doc.vocabularyMaster || []).map(row => {
      const clean = { ...row };
      delete clean.imageDataUrl;
      delete clean.image;
      return clean;
    });
    raw = JSON.stringify(doc);
  }
  await env.PUB_KV.put('pubContent', raw.slice(0, 24 * 1024 * 1024));
  const meta = { v: doc.v, at: doc.at, sig: doc.sig, counts: countsOf(doc) };
  await env.PUB_KV.put('pubContentMeta', JSON.stringify(meta));
  return { published: true, v: doc.v, counts: meta.counts };
};

const admin = async (request, env, path) => {
  const token = String(request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return json({ error: 'forbidden' }, 403);
  if (path === '/api/admin/content' && request.method === 'GET') {
    const raw = await env.PUB_KV.get('pubContent');
    return json(raw ? JSON.parse(raw) : { v: 0, questions: [], vocabulary: [], exams: [] });
  }
  if (path === '/api/admin/publish' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    let full = body.full && typeof body.full === 'object' ? body.full : null;
    if (body.pull) {
      const raw = env.OLD_KV ? await env.OLD_KV.get('userBank') : null;
      const bank = raw ? JSON.parse(raw) : {};
      if (bank.full && typeof bank.full === 'object') full = bank.full;
    }
    if (!full && Array.isArray(body.subjects) && Array.isArray(body.questions)) {
      full = { subjects: body.subjects, topics: body.topics, questions: body.questions, vocabulary: body.vocabulary, vocabularyMaster: body.vocabularyMaster };
    }
    if (full && Array.isArray(full.questions) && full.questions.some(row => row && row.id)) {
      const result = await publishGlobal(env, full);
      return result.error === 'empty' ? json({ error: 'প্রশ্ন খালি' }, 400) : json(result);
    }
    return json({ error: 'প্রশ্ন খালি' }, 400);
  }
  return json({ error: 'not-found' }, 404);
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSONH });
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/api/health') return json({ ok: true, accountSystem: 'retired', legacyAccountSystem: 'retired', nativeAuth: 'cloudflare-native-v1', identity: 'firebase-account-or-ephemeral-guest', at: Date.now() });
      if (path === '/api/content/meta' && request.method === 'GET') {
        const raw = await env.PUB_KV.get('pubContentMeta');
        if (raw) return json(JSON.parse(raw));
        const full = await env.PUB_KV.get('pubContent');
        const doc = full ? JSON.parse(full) : { v: 0, at: 0, questions: [] };
        return json({ v: doc.v || 0, at: doc.at || 0, sig: doc.sig || '', counts: countsOf(doc) });
      }
      if (path === '/api/content' && request.method === 'GET') {
        const raw = await env.PUB_KV.get('pubContent');
        return json(paginateContent(raw ? JSON.parse(raw) : { v: 0, at: 0, questions: [], vocabulary: [], exams: [] }, url.searchParams.get('limit'), url.searchParams.get('offset')));
      }
      if (path.startsWith('/api/admin/')) return admin(request, env, path);
      if (path === '/api/ai/status' && request.method === 'GET') {
        const identity = await aiRequestIdentity(request, env, false);
        return agentStatus(request, env, identity.uid);
      }
      if (path === '/api/ai/prefs' && request.method === 'GET') {
        const identity = await aiRequestIdentity(request, env, false);
        let prefs = null;
        try {
          const raw = await env.PUB_KV.get('aiprefs:' + identity.uid);
          prefs = raw ? sanitizeAiPrefs(JSON.parse(raw)) : null;
        } catch (_) { prefs = null; }
        return json({ prefs: prefs || AI_PREFS_DEFAULT });
      }
      if (path === '/api/ai/prefs' && request.method === 'POST') {
        const identity = await aiRequestIdentity(request, env, false);
        // Personalization is saved per ACCOUNT (guest uids are ephemeral by design).
        if (!identity.authenticated) return json({ error: 'sign_in_required', message: 'AI Personalization save-এর জন্য login দরকার।' }, 401);
        const body = await request.json().catch(() => null);
        const prefs = sanitizeAiPrefs(body);
        if (!prefs) return json({ error: 'invalid_prefs', message: 'সঠিক preference দাও।' }, 400);
        try {
          await env.PUB_KV.put('aiprefs:' + identity.uid, JSON.stringify(prefs));
        } catch (_) {
          return json({ error: 'save_failed', message: 'এখন save করা গেল না — আবার চেষ্টা করো।' }, 500);
        }
        return json({ ok: true, prefs });
      }
      if (path === '/api/ai/chat' && request.method === 'POST') {
        const identity = await aiRequestIdentity(request, env);
        return await agentChat(request, env, identity.uid, { persistMemory: identity.persistMemory });
      }
      if (path === '/api/ai' && request.method === 'POST') {
        const identity = await aiRequestIdentity(request, env);
        return await agentChat(request, env, identity.uid, { stream: false, persistMemory: identity.persistMemory });
      }
      return json({ error: 'not-found' }, 404);
    } catch (error) {
      return json({ error: String(error?.message || error).slice(0, 180) }, error?.status || 500);
    }
  }
};
