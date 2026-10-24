/* F0.1 step 4a / DV-01 (Sky AI blueprint) - allowlist-gated proxy from
 * admission-gk to the sky-ai Worker over the SKY_AI service binding.
 *
 * SKY_AI_ROUTES is EMPTY on purpose: shipping this file changes nothing for
 * students. A route moves to sky-ai only after sky-ai really serves it, by
 * adding "METHOD /path" here. Rollback = remove it again.
 *
 * Safety: returns null (= caller keeps using the local handler) when the
 * binding is missing, the route is not listed, sky-ai answers 404 or 5xx, or
 * the call throws. The original request is cloned, so its body is still
 * readable by the local fallback. A client-supplied x-sky-uid is stripped so
 * nobody can impersonate a student through this hop.
 */

export const SKY_AI_ROUTES = Object.freeze([]);

export function routeKey(request) {
  return request.method + ' ' + new URL(request.url).pathname;
}

export function shouldRouteToSkyAi(request, env, routes = SKY_AI_ROUTES) {
  if (!env || !env.SKY_AI || typeof env.SKY_AI.fetch !== 'function') return false;
  return Array.isArray(routes) && routes.includes(routeKey(request));
}

export async function tryRouteToSkyAi(request, env, routes = SKY_AI_ROUTES) {
  if (!shouldRouteToSkyAi(request, env, routes)) return null;
  try {
    const copy = request.clone();
    const headers = new Headers(copy.headers);
    headers.delete('x-sky-uid');
    headers.set('x-sky-ai-caller', 'admission-gk');
    const hasBody = !['GET', 'HEAD'].includes(copy.method);
    const res = await env.SKY_AI.fetch(new Request(copy.url, {
      method: copy.method,
      headers,
      body: hasBody ? await copy.arrayBuffer() : undefined
    }));
    if (!res || res.status === 404 || res.status >= 500) return null;
    return res;
  } catch (_) {
    return null;
  }
}

/* F0.1 step 4b: routes that need the student's identity. admission-gk first
 * resolves the uid itself, then forwards it with a shared internal key read
 * from PUB_KV ("secret:sky-internal", created once by the owner). EMPTY on
 * purpose; add 'GET /api/ai/prefs' only after sky-ai is deployed with PUB_KV
 * and the key exists. Missing key / any sky-ai error -> null (local handler). */
export const SKY_AI_IDENTITY_ROUTES = Object.freeze([
  'GET /api/ai/prefs',
  'GET /api/ai/actions/audit',
  /* F0.2 / DV-02: evaluated flags for ONE student, so sky-ai needs the uid
   * admission-gk verified. A guest stays anonymous and keeps the defaults
   * (the local fallback in public-worker.js answers all-off). */
  'GET /api/ai/sky-flags'
]);
export const SKY_INTERNAL_KEY_NAME = 'secret:sky-internal';

export async function forwardWithIdentity(request, env, uid, routes = SKY_AI_IDENTITY_ROUTES) {
  if (!uid || request.method !== 'GET') return null;
  if (!shouldRouteToSkyAi(request, env, routes) || !env.PUB_KV) return null;
  try {
    const key = await env.PUB_KV.get(SKY_INTERNAL_KEY_NAME);
    if (!key) return null;
    const res = await env.SKY_AI.fetch(new Request(request.url, {
      method: 'GET',
      headers: { 'x-sky-ai-caller': 'admission-gk', 'x-sky-uid': String(uid), 'x-sky-internal': key }
    }));
    if (!res || res.status === 404 || res.status >= 500) return null;
    return res;
  } catch (_) {
    return null;
  }
}
