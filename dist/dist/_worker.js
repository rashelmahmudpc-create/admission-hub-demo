/* Cloudflare Pages advanced-mode worker.
   Same-origin /api/* requests are proxied to the production Workers; all other
   requests are served from Pages assets. No client or service credential is
   stored here. */
const ORIGIN = 'https://admission-gk.admissionhub.workers.dev';
const VOICE_ORIGIN = 'https://admission-voice.admissionhub.workers.dev';
const RETIRED_ASSETS = new Set([
  '/premium-auth.js', '/premium-auth.css', '/auth-svg.js', '/user-account.js',
  '/onboarding.js', '/onboarding.css', '/curriculum-config.js', '/preview-onboarding.html',
  '/email-preview-otp.html', '/otp-gmail.gs'
]);
const RETIRED_ASSET_PREFIXES = ['/auth-art', '/auth-screens'];
const SERVER_ONLY_ASSETS = new Set([
  '/gk-agent-worker.js', '/public-worker.js', '/ai-agent.js', '/worker-bundle.mjs',
  '/voice-worker.js', '/notification-worker.js', '/wrangler.toml', '/package.json', '/package-lock.json'
]);
const SERVER_ONLY_PREFIXES = ['/auth/', '/auth-native/', '/email-gateway/', '/docs/', '/AGENT_RESUME/', '/.github/'];
const isRetiredAsset = pathname => RETIRED_ASSETS.has(pathname) ||
  RETIRED_ASSET_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'));
const isServerOnlyAsset = pathname => SERVER_ONLY_ASSETS.has(pathname) ||
  SERVER_ONLY_PREFIXES.some(prefix => pathname.startsWith(prefix));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (isRetiredAsset(url.pathname)) {
      return new Response('Retired', {
        status: 410,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
      });
    }

    if (isServerOnlyAsset(url.pathname)) {
      return new Response('Not found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
      });
    }

    // Internal service endpoints must never be proxied or exposed through Pages.
    if (url.pathname.startsWith('/internal/')) {
      return new Response('Not found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
      });
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        const base = url.pathname.startsWith('/api/voice') ? VOICE_ORIGIN : ORIGIN;
        const target = new URL(base + url.pathname + url.search);
        const headers = new Headers(request.headers);
        headers.delete('host');
        headers.set('x-ah-pages-proxy', '1');
        const init = { method: request.method, headers, redirect: 'manual' };
        if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) init.body = request.body;
        const response = await fetch(target, init);
        return new Response(response.body, response);
      } catch (_) {
        return new Response(JSON.stringify({ error: 'api-unavailable', at: Date.now() }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    try {
      return await env.ASSETS.fetch(request);
    } catch (_) {
      return new Response('Not found', { status: 404 });
    }
  }
};
