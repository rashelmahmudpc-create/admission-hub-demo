/* Sky AI Worker — F0.1 / DV-01 (blueprint v1.0, 2026-10-19).
 *
 * The new home for every /api/ai/* route. Step 1 (this file) is a skeleton
 * only: it answers a health check and nothing else, so deploying it changes
 * nothing for students. admission-gk keeps serving all AI traffic until a
 * later step adds the SKY_AI service binding and forwards routes behind a
 * feature flag, one route at a time.
 *
 * Why a separate Worker: admission-gk sits on the Workers Free ceiling of 64
 * variables (BUG-DV-001). sky-ai starts with zero, so new AI keys/config can
 * live here.
 */

import { loadFlags, evaluateAll } from './flags.mjs';
import { handlePrefsGet } from './prefs.mjs';

export const SKY_AI_VERSION = 'sky-ai-f0.1-4b-prefs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-sky-ai': SKY_AI_VERSION
    }
  });
}

export async function handle(request, env = {}) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'GET' && (path === '/health' || path === '/api/ai/sky-health')) {
    return json({
      ok: true,
      service: 'sky-ai',
      version: SKY_AI_VERSION,
      /* Shows whether the call came through admission-gk's service binding
       * (internal header set by the caller) or straight from the internet. */
      via: request.headers.get('x-sky-ai-caller') === 'admission-gk' ? 'service-binding' : 'direct'
    });
  }

  /* F0.2 / DV-02: evaluated flags for one student. The uid is trusted only
   * when admission-gk (which verified the session) sets it on the internal
   * service-binding call; a direct internet caller is always anonymous. */
  if (request.method === 'GET' && path === '/api/ai/sky-flags') {
    const trusted = request.headers.get('x-sky-ai-caller') === 'admission-gk';
    const uid = trusted ? (request.headers.get('x-sky-uid') || '') : '';
    const flags = await loadFlags(env);
    return json({ ok: true, version: SKY_AI_VERSION, flags: evaluateAll(flags, uid || null) });
  }

  /* F0.1 step 4b: GET /api/ai/prefs (internal-key protected, see prefs.mjs). */
  if (request.method === 'GET' && path === '/api/ai/prefs') {
    const res = await handlePrefsGet(request, env);
    if (res) return res;
  }

  /* Nothing else is served yet. A clear 404 (not a silent fallback) makes a
   * mis-routed request obvious in logs instead of looking like an AI error. */
  return json({ ok: false, error: 'not-implemented-in-sky-ai', path }, 404);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env);
    } catch (_) {
      return json({ ok: false, error: 'sky-ai-internal' }, 500);
    }
  }
};
