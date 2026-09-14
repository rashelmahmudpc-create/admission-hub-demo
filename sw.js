const CACHE_PREFIX = 'admission-hub-shell-';
const BUILD_ID = 'v249-scroll-safe-20260914';
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const VERSION_HEADER = 'X-Admission-Hub-Build';
const DOCUMENT_NETWORK_TIMEOUT_MS = 2500;
const isCurrentBuild = response => response && response.headers && response.headers.get(VERSION_HEADER) === BUILD_ID;
function markBuild(response) {
  if (!response || !response.ok) return response;
  const headers = new Headers(response.headers);
  headers.set(VERSION_HEADER, BUILD_ID);
  return response.clone().blob().then(blob => new Response(blob, {status: response.status, statusText: response.statusText, headers}));
}
const APP_SHELL = [
  './index.html',
  './manifest.json',
  './manifest.webmanifest',
  './dashboard-v2.css?v=dash2f9',
  './3d-loader.css?v=3d-v1',
  './session-persist.js?v=session-v1',
  './account-access.css?v=20260914-scroll-safe-v1',
  './institutions-bd.js?v=bd-institutions-v1',
  './account-access.js?v=20260914-scroll-safe-v1',
  './data-protection.js?v=dp-v3-fastboot',
  './dashboard-v2.js?v=dash2f10-main-ai',
  './ai-agent-chat.js?v=agent-f1-ui-chatv15-identity',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

const isDocumentRequest = request => request.mode === 'navigate' || request.destination === 'document';

async function cacheNetworkResponse(request, response) {
  if (!response || !response.ok) return response;
  try {
    const cache = await caches.open(CACHE_NAME);
    const versioned = await markBuild(response);
    await cache.put(request, versioned.clone());
  } catch (_) {
    // Cache failures must never block the fresh network response.
  }
  return response;
}

async function offlineFallback(request) {
  const cached = await caches.match(request);
  if (cached && isCurrentBuild(cached)) return cached;

  if (isDocumentRequest(request)) {
    const shell = await caches.match('./index.html');
    if (shell && isCurrentBuild(shell)) return shell;
    const shellUrl = new URL('./index.html', self.location.href).href;
    const fallback = await caches.match(shellUrl);
    return fallback && isCurrentBuild(fallback) ? fallback : Response.error();
  }

  return Response.error();
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async asset => {
      try {
        const url = new URL(asset, self.location.href).href;
        const request = new Request(url, {cache: 'reload'});
        const response = await fetch(request, {cache: 'no-store'});
        if (response.ok) await cacheNetworkResponse(request, response);
      } catch (_) {
        // The worker can still activate if an optional shell asset is unavailable.
      }
    }));

    // Activate this worker immediately; do not wait for old tabs to close.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
    );

    // Take control without navigating/reloading open iOS clients. Forced client
    // navigation during activation could restart boot and appear as a loader loop.
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (event.data && event.data.type === 'VERSION_CHECK') {
    event.ports?.[0]?.postMessage({type:'VERSION_CHECK_RESULT', buildId:BUILD_ID, cacheName:CACHE_NAME});
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  // The privileged control page is network-only and must never be replaced by or
  // written into the offline application shell.
  if (requestUrl.pathname === '/verification-control-center' || requestUrl.pathname === '/verification-control-center.html') {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => new Response('Control Center requires an internet connection.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    })));
    return;
  }

  // Authentication responses are always live and are never written to the PWA cache.
  if (requestUrl.pathname.startsWith('/api/auth/')) {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => new Response(JSON.stringify({
      ok: false, error: { code: 'OFFLINE', message: 'অ্যাকাউন্ট সেবার জন্য ইন্টারনেট সংযোগ প্রয়োজন।' }
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    })));
    return;
  }

  event.respondWith((async () => {
    // Documents are bounded network-first. This prevents a healthy online browser
    // from being trapped forever on an old Auth UI while retaining a fast offline
    // shell fallback well inside the five-second startup budget.
    if (isDocumentRequest(request)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DOCUMENT_NETWORK_TIMEOUT_MS);
      try {
        const response = await fetch(request, { cache: 'no-store', signal: controller.signal });
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok || !contentType.includes('text/html')) throw new Error('DOCUMENT_UNAVAILABLE');
        return await cacheNetworkResponse(request, response);
      } catch (_) {
        return offlineFallback(request);
      } finally {
        clearTimeout(timeout);
      }
    }

    const staticAsset = request.destination === 'script' || request.destination === 'style' || request.destination === 'image' || request.destination === 'font' || /\.(?:js|css|json|png|jpg|jpeg|webp|svg|ico|woff2?)(?:$|\?)/i.test(requestUrl.pathname + requestUrl.search);
    if (staticAsset) {
      const cached = await caches.match(request);
      if (cached && isCurrentBuild(cached)) return cached;
      try {
        return await cacheNetworkResponse(request, await fetch(request));
      } catch (_) {
        return offlineFallback(request);
      }
    }
    try {
      // Dynamic same-origin GET requests remain network-first.
      const response = await fetch(request, {cache: 'no-store'});
      const contentType = response.headers.get('content-type') || '';
      if (isDocumentRequest(request) && !contentType.includes('text/html')) return offlineFallback(request);
      return cacheNetworkResponse(request, response);
    } catch (_) {
      return offlineFallback(request);
    }
  })());
});

// v107 — Web Push display + notification click routing
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); } catch (_) {}
  event.waitUntil(self.registration.showNotification(String(data.title || 'Admission Hub 🔔'), {
    body: String(data.body || ''), tag: String(data.tag || 'admission-hub'), renotify: true, data: { url: data.url || './' }
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const client of list) { if ('focus' in client) { try { client.navigate(url); } catch (_) {} return client.focus(); } }
    return self.clients.openWindow(url);
  }));
});
