/* R2 file storage (owner approved 2026-09-18 — R2 activated on the account).
 *
 * Private objects in the `admission-hub` R2 bucket, served from OUR domain
 * (R2 = $0 egress, the point of the switch). Keys are server-generated
 * `<folder>/<userId>/<yyyy-mm-dd>/<rand>.<ext>` — user input can never
 * control the path (no traversal, no overwrite).
 *
 * Routes (worker; session = __Host-ah_session vs AUTH_AUTHORITY DO):
 *   POST /api/files/upload  — session; raw binary body + X-File-Ext / X-File-Folder
 *   GET  /api/files/...     — public read (unguessable keys), immutable cache
 *   POST /api/files/delete  — session; only the caller's own folder
 *
 * Limits: 5 MB, image types only (jpg/jpeg/png/webp/gif), 10 uploads/hour
 * per user (KV). Every limit is fail-soft — storage errors return 503,
 * they never crash the worker. */

const AUTHORITY_NAME = 'admission-hub-global-auth-v1';
const SESSION_COOKIE = '__Host-ah_session';
const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{40,96}$/;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; /* 5 MB */
const MAX_UPLOADS_PER_HOUR = 10;
const UPLOAD_TYPES = Object.freeze({
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', gif: 'image/gif'
});
const FOLDER_RE = /^[a-z][a-z0-9-]{0,31}$/;
/* User segment stays deliberately permissive (production user ids vary in
 * shape) — unguessability comes from the 12-char random key + date, not
 * from the id length. */
const KEY_RE = /^[a-z][a-z0-9-]{0,31}\/[A-Za-z0-9_-]{1,64}\/\d{4}-\d{2}-\d{2}\/[a-z0-9]{10,24}\.[a-z0-9]{2,4}$/;

const readSessionToken = request => {
  const cookie = String(request.headers.get('Cookie') || '');
  for (const part of cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === SESSION_COOKIE) return part.slice(idx + 1).trim();
  }
  return '';
};

async function sessionUser(env, request) {
  const token = readSessionToken(request);
  if (!SESSION_TOKEN_RE.test(token)) return null;
  try {
    const id = env.AUTH_AUTHORITY.idFromName(AUTHORITY_NAME);
    const stub = env.AUTH_AUTHORITY.get(id, { locationHint: 'apac' });
    const res = await stub.fetch('https://auth.internal/internal/session/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken: token })
    });
    const data = await res.json();
    if (!res.ok || !data?.ok || !data.result?.user?.id) return null;
    return data.result;
  } catch {
    return null;
  }
}

async function kvRateAllow(env, key, limit, ttlSeconds) {
  const kv = env?.GK_KV;
  if (!kv || typeof kv.get !== 'function') return true;
  try {
    const k = `fs:${key}`;
    const n = Number(await kv.get(k) || 0);
    if (n >= limit) return false;
    await kv.put(k, String(n + 1), { expirationTtl: ttlSeconds });
    return true;
  } catch {
    return true; /* rate limiting must never break the API */
  }
}

const jsonResponse = (request, obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
    'Access-Control-Allow-Credentials': 'true'
  }
});

const randKey = len => {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
};

const publicUrl = request => {
  const base = new URL(request.url);
  return base.origin;
};

export async function handleFilesStorageRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/files')) return null;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-File-Ext, X-File-Folder',
      'Access-Control-Max-Age': '86400'
    } });
  }

  const bucket = env?.FILE_BUCKET;
  const available = Boolean(bucket && typeof bucket.put === 'function');

  /* Public read (unguessable server-generated keys). */
  if (request.method === 'GET') {
    const key = path.slice('/api/files/'.length);
    if (!KEY_RE.test(key)) return jsonResponse(request, { error: 'not-found' }, 404);
    if (!available) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    let obj;
    try { obj = await bucket.get(key); } catch { obj = null; }
    if (!obj) return jsonResponse(request, { error: 'not-found' }, 404);
    const ext = key.split('.').pop().toLowerCase();
    const type = UPLOAD_TYPES[ext] || 'application/octet-stream';
    return new Response(obj.body, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Length': String(obj.size),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  /* Everything below requires an authenticated student. */
  const session = await sessionUser(env, request);
  if (!session) return jsonResponse(request, { error: 'auth-required' }, 401);
  const userId = String(session.user.id);

  if (request.method !== 'POST') return jsonResponse(request, { error: 'method-not-allowed' }, 405);

  if (path === '/api/files/upload') {
    if (!available) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    if (!(await kvRateAllow(env, `upload:${userId}`, MAX_UPLOADS_PER_HOUR, 3600))) {
      return jsonResponse(request, { error: 'rate-limited' }, 429);
    }
    const declared = Number(request.headers.get('Content-Length') || 0);
    if (!declared || declared > MAX_UPLOAD_BYTES) {
      return jsonResponse(request, { error: 'too-large' }, 413);
    }
    const ext = String(request.headers.get('X-File-Ext') || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const contentType = UPLOAD_TYPES[ext];
    if (!contentType) return jsonResponse(request, { error: 'invalid-type' }, 400);
    /* Validate the RAW folder — sanitize-then-validate would turn `../etc`
     * into the legal folder `etc`. */
    const folder = String(request.headers.get('X-File-Folder') || '').toLowerCase();
    if (!FOLDER_RE.test(folder)) return jsonResponse(request, { error: 'invalid-folder' }, 400);
    let bytes;
    try {
      bytes = new Uint8Array(await request.arrayBuffer());
    } catch {
      return jsonResponse(request, { error: 'read-failed' }, 400);
    }
    if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) {
      return jsonResponse(request, { error: 'too-large' }, 413);
    }
    const day = new Date().toISOString().slice(0, 10);
    const key = `${folder}/${userId}/${day}/${randKey(12)}.${ext}`;
    try {
      await bucket.put(key, bytes, { httpMetadata: { contentType } });
    } catch {
      return jsonResponse(request, { error: 'storage-error' }, 503);
    }
    const fileUrl = `/api/files/${key}`;
    return jsonResponse(request, { ok: true, url: fileUrl, publicUrl: `${publicUrl(request)}${fileUrl}`, key }, 201);
  }

  if (path === '/api/files/delete') {
    if (!available) return jsonResponse(request, { error: 'storage-unavailable' }, 503);
    let body = {};
    try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') return jsonResponse(request, { error: 'invalid-json' }, 400);
    const key = String(body.key || '');
    if (!KEY_RE.test(key)) return jsonResponse(request, { error: 'invalid-key' }, 400);
    /* Ownership: the key's user segment must be the caller's id. */
    if (key.split('/')[1] !== userId) return jsonResponse(request, { error: 'forbidden' }, 403);
    try {
      await bucket.delete(key);
    } catch {
      return jsonResponse(request, { error: 'storage-error' }, 503);
    }
    return jsonResponse(request, { ok: true, key });
  }

  return jsonResponse(request, { error: 'not-found' }, 404);
}

export const __filesStorageTest = Object.freeze({
  sessionUser,
  readSessionToken,
  kvRateAllow,
  KEY_RE,
  FOLDER_RE,
  UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOADS_PER_HOUR
});
