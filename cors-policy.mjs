/* Shared CORS policy for the admission API.
 *
 * Why this exists: six handlers used to build CORS headers by echoing whatever
 * Origin the caller sent and pairing it with Allow-Credentials: true. That lets
 * any site on the internet make credentialed cross-origin calls and read the
 * response, which turns a logged-in student's browser into an open proxy for
 * their results, profile, notifications and analytics.
 *
 * The allowlist below is the one auth-native/worker/public-auth-handler.mjs
 * already used for its own routes; it lives here so every handler shares a
 * single definition instead of six copies drifting apart.
 *
 * Contract: return the CORS headers only for an allowed Origin. For anything
 * else return an empty object, so no Access-Control-Allow-Origin is emitted at
 * all -- a wildcard is not a fallback, because with credentials enabled it
 * would be the vulnerability this module exists to close.
 */

export const allowedOrigin = origin => {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) return true;
    if (url.protocol !== 'https:') return false;
    return url.hostname === 'admissionhub.pages.dev'
      || url.hostname === 'admissionsky.pages.dev'
      || /^[a-z0-9-]+\.admissionhub\.pages\.dev$/i.test(url.hostname)
      || url.hostname === 'admission-gk.admissionhub.workers.dev';
  } catch { return false; }
};

/* Returns { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' }
 * for an allowed Origin, otherwise {}. Spread into a response's headers object.
 * Vary: Origin is always set so a shared cache never reuses one origin's
 * response for another. */
export const corsHeaders = request => {
  const origin = (request && request.headers && request.headers.get('Origin')) || '';
  if (!origin || !allowedOrigin(origin)) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin'
  };
};
