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
  '/voice-worker.js', '/notification-worker.js', '/fcm-notification.mjs',
  '/wrangler.toml', '/package.json', '/package-lock.json'
]);
const SERVER_ONLY_PREFIXES = ['/auth/', '/auth-native/', '/email-gateway/', '/docs/', '/AGENT_RESUME/', '/.github/'];
const isRetiredAsset = pathname => RETIRED_ASSETS.has(pathname) ||
  RETIRED_ASSET_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'));
const isServerOnlyAsset = pathname => SERVER_ONLY_ASSETS.has(pathname) ||
  SERVER_ONLY_PREFIXES.some(prefix => pathname.startsWith(prefix));

/* SEO — the SPA is hash-routed, so only these pathnames are real public URLs.
   Anything else must answer 404 instead of a 200 copy of index.html, otherwise
   crawlers index unlimited duplicate pages. */
const PUBLIC_ROUTES = new Set([
  '/', '/index.html',
  '/splash-preview', '/splash-preview.html',
  '/verification-control-center', '/verification-control-center.html',
  '/ai-performance-analysis-live', '/ai-performance-analysis-live.html'
]);
const PUBLIC_FILES = new Set([
  '/robots.txt', '/sitemap.xml', '/favicon.ico', '/og-image.png',
  '/apple-touch-icon.png', '/manifest.json', '/manifest.webmanifest', '/sw.js'
]);
const PUBLIC_PREFIXES = ['/icons/', '/course-assets/'];
const COURSE_SLUGS = new Set(['prottoy', 'prottoy-master', 'sandhi', 'somas']);
const PROFILE_PATH = /^\/AH-[A-Z2-9]{6}\/?$/i;
const ASSET_EXT = /\.(css|js|mjs|json|webmanifest|png|jpe?g|webp|avif|gif|svg|ico|pdf|woff2?|ttf|otf|eot|mp3|mp4|webm|txt|xml|map)$/i;

const isAssetPath = pathname => ASSET_EXT.test(pathname);
const isCoursePath = pathname => {
  const m = pathname.match(/^\/courses\/([^/]+)(?:\/(?:index\.html)?)?\/?$/);
  return !!m && COURSE_SLUGS.has(m[1]);
};
const isPublicPath = pathname => PUBLIC_ROUTES.has(pathname) ||
  PUBLIC_FILES.has(pathname) ||
  PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix)) ||
  PROFILE_PATH.test(pathname) ||
  isCoursePath(pathname);

const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="bn" dir="ltr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, follow">
<title>পেজটি পাওয়া যায়নি — Admission Hub</title>
<style>
body{margin:0;min-height:100dvh;display:grid;place-content:center;justify-items:center;gap:10px;
padding:32px 24px;background:#faf9f6;color:#1a1d1b;text-align:center;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans Bengali",sans-serif}
.mark{display:grid;place-items:center;width:52px;height:52px;border-radius:16px;background:#0f6b4f;
color:#fff;font-size:26px;box-shadow:0 10px 24px rgba(15,107,79,.18)}
h1{margin:6px 0 0;font-size:19px}
p{margin:0;max-width:34ch;color:#6b7370;font-size:14px;line-height:1.6}
a{margin-top:8px;display:inline-block;padding:11px 20px;border-radius:12px;background:#0f6b4f;color:#fff;
text-decoration:none;font-weight:600;font-size:14px}
</style>
</head>
<body>
<div class="mark">✦</div>
<h1>পেজটি পাওয়া যায়নি</h1>
<p>আপনি যে লিংকে এসেছেন সেটি নেই বা সরিয়ে ফেলা হয়েছে।</p>
<a href="/">হোমে ফিরে যান</a>
</body>
</html>`;

const notFound = () => new Response(NOT_FOUND_HTML, {
  status: 404,
  headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, follow',
    'X-Content-Type-Options': 'nosniff'
  }
});

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
      const response = await env.ASSETS.fetch(request);
      // Pages answers 200 + index.html for any unknown path. A real asset never
      // comes back as HTML, so an HTML response to an asset-looking path means
      // the file is missing and must 404.
      const servedHtml = response.status === 200 &&
        (response.headers.get('content-type') || '').includes('text/html');
      if (servedHtml && (isAssetPath(url.pathname) || !isPublicPath(url.pathname))) {
        return notFound();
      }
      return response;
    } catch (_) {
      return notFound();
    }
  }
};
