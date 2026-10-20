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

export const SKY_AI_VERSION = 'sky-ai-f0.1-skeleton';

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
