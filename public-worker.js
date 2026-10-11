// Admission Hub — Public Product Worker (account system retired, v221)
// Active routes: public content · Firebase-account/ephemeral-guest AI · content admin.
// The former login/profile/onboarding/session/state APIs are intentionally absent.
import { agentChat, agentStatus, sanitizeAiPrefs, AI_PREFS_DEFAULT } from './ai-agent.js';
import {
  authorizeAction, makeProposal, confirmProposal, proposalSummary,
  makeAuditRecord, parseAudit, appendAudit, STATUS, actionsEnabled
} from './action-engine.js';
import { checkAbuse, isGuarded } from './p14-abuse-guard.mjs';

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
/* A cheap, deterministic string hash (FNV-1a). The signature must change when a
   word's meaning, synonym/antonym gloss or tips change — a length-only
   fingerprint does not, so a corrected gloss would never leave the KV blob: the
   D1 read path would keep serving the stale copy forever. */
const hashText = text => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
};
const fingerprintGlobal = doc => {
  const questions = doc.questions || [];
  const vocabularyMaster = doc.vocabularyMaster || [];
  const vocabulary = doc.vocabulary || [];
  // Per-word content hash, order-independent, so an edit changes the signature
  // without the cost of hashing the whole multi-megabyte document.
  let vmHash = 0;
  for (const row of vocabularyMaster) {
    const text = `${row.word}|${row.meaning}|${row.tips || ''}|` +
      (row.synonyms || []).map(r => `${r.word}=${r.meaning}`).join(',') + '|' +
      (row.antonyms || []).map(r => `${r.word}=${r.meaning}`).join(',');
    vmHash = (vmHash + parseInt(hashText(text), 36)) % 0xffffffff;
  }
  let vHash = 0;
  for (const row of vocabulary) {
    vHash = (vHash + parseInt(hashText(`${row.word}|${row.meaning}`), 36)) % 0xffffffff;
  }
  return [
    (doc.subjects || []).length,
    (doc.topics || []).length,
    questions.length,
    vocabulary.length,
    vocabularyMaster.length,
    questions.reduce((total, row) => total + String(row.question || row.q || '').length, 0),
    vmHash.toString(36),
    vHash.toString(36)
  ].join(':');
};
const countsOf = doc => ({
  subjects: (doc.subjects || []).length,
  topics: (doc.topics || []).length,
  questions: (doc.questions || []).length,
  vocabulary: (doc.vocabulary || []).length,
  vocabularyMaster: (doc.vocabularyMaster || []).length
});
/* Per-category totals ride in the meta (tiny, 26 keys) so the A–Z grid can show
   real numbers on a first-ever open, before the bank itself is written to the
   device. Kept out of countsOf on purpose: that object is compared byte-for-byte
   by verifyIntegrity, so widening it would flag every already-stored meta. */
const categoryCountsOf = doc => {
  const out = {};
  for (const row of (doc.vocabularyMaster || [])) {
    const key = row && row.category;
    if (key) out[key] = (out[key] || 0) + 1;
  }
  return out;
};
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
    /* The body is unchanged, but a meta written before `categories` existed has
       no per-category totals — backfill them once so the A–Z grid can show real
       numbers on a first-ever open without a content re-publish. */
    const counts = previousMeta.counts || countsOf({ subjects, topics, questions, vocabulary, vocabularyMaster });
    if (!previousMeta.categories) {
      const categories = categoryCountsOf({ vocabularyMaster });
      try { await env.PUB_KV.put('pubContentMeta', JSON.stringify({ ...previousMeta, counts, categories })); } catch (_) {}
      return { published: false, unchanged: true, v: previousMeta.v, counts, categories };
    }
    return { published: false, unchanged: true, v: previousMeta.v, counts, categories: previousMeta.categories };
  }

  let exams = [{ id: 'mock1', title: 'মক পরীক্ষা ১', mins: 15, n: Math.min(15, questions.length || 1), published: true, desc: 'সব বিষয় মিশিয়ে' }];
  try {
    const previous = JSON.parse((await env.PUB_KV.get('pubContent')) || '{}');
    if (Array.isArray(previous.exams) && previous.exams.length) exams = previous.exams;
  } catch (_) {}

  const doc = { v: (Number(previousMeta.v) || 0) + 1, at: Date.now(), sig, subjects, topics, questions, vocabulary, vocabularyMaster, exams };
  const cap = Number(env.PUB_CONTENT_MAX_BYTES) > 0 ? Number(env.PUB_CONTENT_MAX_BYTES) : 24 * 1024 * 1024;
  let raw = JSON.stringify(doc);
  if (raw.length > cap) {
    doc.vocabularyMaster = (doc.vocabularyMaster || []).map(row => {
      const clean = { ...row };
      delete clean.imageDataUrl;
      delete clean.image;
      return clean;
    });
    raw = JSON.stringify(doc);
  }
  /* P14 integrity pre-check: never publish a blob that is oversized (the old
     `.slice(cap)` wrote truncated, unparseable JSON straight into KV) or whose
     round-trip fingerprint no longer matches what was signed. A refused publish
     leaves the previous good version serving. */
  if (raw.length > cap) return { error: 'too-large' };
  let roundTrip;
  try {
    roundTrip = JSON.parse(raw);
  } catch (_) {
    return { error: 'integrity' };
  }
  if (fingerprintGlobal(roundTrip) !== sig) return { error: 'integrity' };
  await env.PUB_KV.put('pubContent', raw);
  const meta = { v: doc.v, at: doc.at, sig: doc.sig, counts: countsOf(doc), categories: categoryCountsOf(doc) };
  await env.PUB_KV.put('pubContentMeta', JSON.stringify(meta));
  return { published: true, v: doc.v, counts: meta.counts };
};

/* P14 — content integrity. The published doc carries `sig`, a fingerprint of
   the live shapes, and `counts`. This recomputes both from the stored doc and
   reports any drift, so a publication that was silently mangled (or a tampered
   KV value) is visible from an admin check instead of surfacing as a user bug. */
export const verifyIntegrity = doc => {
  const source = doc && typeof doc === 'object' ? doc : {};
  const expected = fingerprintGlobal({
    subjects: onlyRows(source.subjects), topics: onlyRows(source.topics),
    questions: onlyRows(source.questions), vocabulary: onlyRows(source.vocabulary),
    vocabularyMaster: onlyRows(source.vocabularyMaster)
  });
  const counts = countsOf(source);
  const mismatches = [];
  if (source.sig && source.sig !== expected) mismatches.push('sig');
  if (source.counts && JSON.stringify(source.counts) !== JSON.stringify(counts)) mismatches.push('counts');
  return { ok: mismatches.length === 0, v: source.v || 0, sig: source.sig || '', expectedSig: expected, counts, mismatches };
};

const readAudit = async (env, uid) => {
  try {
    const raw = await env.PUB_KV.get('actaudit:' + uid);
    return parseAudit(raw, uid);
  } catch (_) { return []; }
};

const writeAudit = async (env, uid, records) => {
  await env.PUB_KV.put('actaudit:' + uid, JSON.stringify(records));
};

const admin = async (request, env, path) => {
  const token = String(request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return json({ error: 'forbidden' }, 403);
  if (path === '/api/admin/content' && request.method === 'GET') {
    const raw = await env.PUB_KV.get('pubContent');
    return json(raw ? JSON.parse(raw) : { v: 0, questions: [], vocabulary: [], exams: [] });
  }
  if (path === '/api/admin/verify' && request.method === 'GET') {
    const raw = await env.PUB_KV.get('pubContent');
    const doc = raw ? JSON.parse(raw) : {};
    const report = verifyIntegrity(doc);
    return json(report, report.ok ? 200 : 409);
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
      if (result.error === 'empty') return json({ error: 'প্রশ্ন খালি' }, 400);
      if (result.error === 'too-large') return json({ error: 'কনটেন্ট আকারসীমার বেশি — কমানো ছবি বাদ দিয়ে আবার চেষ্টা করো', code: 'too-large' }, 413);
      if (result.error === 'integrity') return json({ error: 'কনটেন্ট যাচাইয়ে ব্যর্থ — আগের সংস্করণই থাকল', code: 'integrity' }, 409);
      return json(result);
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
      /* P14 — public-API abuse ceiling. Counted per network, before any route
         work, so a scripted flood of AI/write calls is stopped at the edge
         rather than reaching the model or KV. Content GETs are excluded. */
      if (isGuarded(request, path)) {
        const guard = await checkAbuse(request, env, { salt: env.PUBLIC_RATE_SALT || '' });
        if (!guard.allowed) {
          return json({ error: 'rate_limited', message: 'একটু বেশি অনুরোধ এসেছে — কিছুক্ষণ পরে আবার চেষ্টা করো।', retryAfter: guard.retryAfter }, 429);
        }
      }
      if (path === '/api/health') return json({ ok: true, accountSystem: 'retired', legacyAccountSystem: 'retired', nativeAuth: 'cloudflare-native-v1', identity: 'firebase-account-or-ephemeral-guest', at: Date.now() });
      if (path === '/api/content/meta' && request.method === 'GET') {
        const raw = await env.PUB_KV.get('pubContentMeta');
        if (raw) return json(JSON.parse(raw));
        const full = await env.PUB_KV.get('pubContent');
        const doc = full ? JSON.parse(full) : { v: 0, at: 0, questions: [] };
        return json({ v: doc.v || 0, at: doc.at || 0, sig: doc.sig || '', counts: countsOf(doc), categories: categoryCountsOf(doc) });
      }
      if (path === '/api/content' && request.method === 'GET') {
        /* P13 — optional D1 fast path. Enabled by a flag row in content_meta
           (set by the p13-d1-backfill workflow), not by a Worker variable, so
           the Free-plan 64-variable cap is not touched. The D1 copy is served
           only when its stored sig matches /api/content/meta's live sig; the
           whole document is assembled from D1. Any mismatch or error falls back
           to the KV blob untouched. */
        if (env.PROFILE_DB) {
          try {
            const { createD1Reader } = await import('./p13-d1-read.mjs');
            const reader = createD1Reader(env.PROFILE_DB);
            if ((await reader.meta('mode')) === 'd1') {
              const rawMeta = await env.PUB_KV.get('pubContentMeta');
              const meta = rawMeta ? JSON.parse(rawMeta) : null;
              if (meta && meta.sig && (await reader.sig()) === String(meta.sig)) {
                const limit = Number(url.searchParams.get('limit'));
                if (Number.isFinite(limit) && limit > 0) {
                  /* P13 — paged read. Pull one bounded page from D1 (keyset on
                     the indexed key), never the whole table: a full scan of a
                     large `questions` table is what blew the Worker CPU budget
                     and returned `1102`. The small mirrored lists ride along. */
                  const pageLimit = Math.min(500, limit);
                  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
                  // Never fetch an unbounded window: offset+limit is capped so a
                  // crafted `offset` cannot force a full-table read again.
                  const window = Math.min(pageLimit + offset, 1000);
                  const paged = await reader.page({ limit: window });
                  if (paged && paged.items) {
                    const slice = offset < window ? paged.items.slice(offset, offset + pageLimit) : [];
                    const lists = (await reader.lists()) || {};
                    return json({
                      v: meta.v || 0, at: meta.at || 0, sig: meta.sig,
                      ...lists, questions: slice,
                      total: meta.counts && meta.counts.questions,
                      page: { limit: pageLimit, offset },
                      source: 'd1'
                    });
                  }
                }
                const document = await reader.document();
                if (document) return json({ v: meta.v || 0, at: meta.at || 0, sig: meta.sig, ...document, source: 'd1' });
              }
            }
          } catch (_) { /* fall through to KV */ }
        }
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
      /* M9: write/execute actions. The layer is OFF by default (action-engine
         `ENABLED`), so both routes refuse with `layer-disabled` until the owner
         turns it on. Confirmation is mandatory and single-use. */
      if (path === '/api/ai/actions/propose' && request.method === 'POST') {
        const identity = await aiRequestIdentity(request, env, false);
        if (!identity.authenticated) return json({ error: 'sign_in_required', message: 'AI action ব্যবহার করতে লগইন করো।' }, 401);
        const body = await request.json().catch(() => null);
        const name = String(body?.action || '');
        const auth = authorizeAction(name, { uid: identity.uid, args: body?.args, enabled: actionsEnabled(env) });
        if (!auth.allowed) return json({ error: 'action_denied', reason: auth.reason }, 403);
        const proposal = makeProposal(name, { uid: identity.uid, args: auth.args, id: crypto.randomUUID(), enabled: actionsEnabled(env) });
        if (!proposal) return json({ error: 'action_denied', reason: 'no-proposal' }, 403);
        try {
          await env.PUB_KV.put('actprop:' + identity.uid, JSON.stringify(proposal), { expirationTtl: Math.ceil((proposal.expiresAt - Date.now()) / 1000) });
          const audit = await readAudit(env, identity.uid);
          await writeAudit(env, identity.uid, appendAudit(audit, makeAuditRecord({ proposal, status: STATUS.PROPOSED, uid: identity.uid }), identity.uid));
        } catch (_) {
          return json({ error: 'propose_failed', message: 'এখন proposal তৈরি করা গেল না — আবার চেষ্টা করো।' }, 500);
        }
        return json({ ok: true, proposal: { id: proposal.id, action: proposal.action, permission: proposal.permission, riskLevel: proposal.riskLevel, summary: proposal.summary, expiresAt: proposal.expiresAt } });
      }
      if (path === '/api/ai/actions/confirm' && request.method === 'POST') {
        const identity = await aiRequestIdentity(request, env, false);
        if (!identity.authenticated) return json({ error: 'sign_in_required', message: 'AI action ব্যবহার করতে লগইন করো।' }, 401);
        const body = await request.json().catch(() => null);
        const token = String(body?.token || '');
        let stored = null;
        try {
          const raw = await env.PUB_KV.get('actprop:' + identity.uid);
          stored = raw ? JSON.parse(raw) : null;
        } catch (_) { stored = null; }
        const decision = confirmProposal(stored, token, identity.uid, { enabled: actionsEnabled(env) });
        if (!decision.ok) {
          const audit = await readAudit(env, identity.uid);
          if (stored) await writeAudit(env, identity.uid, appendAudit(audit, makeAuditRecord({ proposal: stored, status: decision.status, uid: identity.uid, detail: decision.reason }), identity.uid));
          return json({ error: 'confirm_denied', reason: decision.reason }, 403);
        }
        // Single-use: consume the proposal before the write so a replay finds nothing.
        try {
          await env.PUB_KV.delete('actprop:' + identity.uid);
          if (decision.action === 'prefs.write') {
            const prefs = sanitizeAiPrefs(decision.args);
            await env.PUB_KV.put('aiprefs:' + identity.uid, JSON.stringify(prefs));
          }
        } catch (_) {
          const audit = await readAudit(env, identity.uid);
          await writeAudit(env, identity.uid, appendAudit(audit, makeAuditRecord({ proposal: stored, status: STATUS.FAILED, uid: identity.uid, detail: 'write-failed' }), identity.uid));
          return json({ error: 'action_failed', message: 'কাজটা সম্পন্ন করা গেল না — আবার চেষ্টা করো।' }, 500);
        }
        const audit = await readAudit(env, identity.uid);
        const record = makeAuditRecord({ proposal: stored, status: STATUS.CONFIRMED, uid: identity.uid });
        await writeAudit(env, identity.uid, appendAudit(audit, record, identity.uid));
        return json({ ok: true, action: decision.action, status: STATUS.CONFIRMED });
      }
      if (path === '/api/ai/actions/audit' && request.method === 'GET') {
        const identity = await aiRequestIdentity(request, env, false);
        if (!identity.authenticated) return json({ error: 'sign_in_required', message: 'AI action ব্যবহার করতে লগইন করো।' }, 401);
        return json({ ok: true, actionsEnabled: actionsEnabled(env), audit: await readAudit(env, identity.uid) });
      }
      if (path === '/api/ai/chat' && request.method === 'POST') {
        const identity = await aiRequestIdentity(request, env, false);
        /* M7: AI chat is signed-in only. Refuse the guest here, before the
           public rate-limit counter or any KV write, so a guest leaves no trace. */
        if (!identity.authenticated) return json({ error: 'sign_in_required', message: 'AI চ্যাট ব্যবহার করতে লগইন করো।' }, 401);
        return await agentChat(request, env, identity.uid, { persistMemory: identity.persistMemory });
      }
      if (path === '/api/ai' && request.method === 'POST') {
        const identity = await aiRequestIdentity(request, env, false);
        if (!identity.authenticated) return json({ error: 'sign_in_required', message: 'AI চ্যাট ব্যবহার করতে লগইন করো।' }, 401);
        return await agentChat(request, env, identity.uid, { stream: false, persistMemory: identity.persistMemory });
      }
      return json({ error: 'not-found' }, 404);
    } catch (error) {
      return json({ error: String(error?.message || error).slice(0, 180) }, error?.status || 500);
    }
  }
};
