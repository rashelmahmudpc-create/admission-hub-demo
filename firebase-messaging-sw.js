/* firebase-messaging-sw.js — FCM background message handler.
 *
 * Firebase's web SDK registers THIS exact path itself (/firebase-messaging-sw.js,
 * scope /firebase-cloud-messaging-push-scope) unless a serviceWorkerRegistration
 * is passed to getToken(). Its absence made getToken() reject with
 * "failed-service-worker-registration" on every device — push never enabled.
 *
 * Coexists with sw.js (the precache/shell layer): different scope, no overlap.
 * Config is hardcoded because a static SW cannot read runtime config; these are
 * the public web config values the worker already returns from /config.
 */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDOcARNpuV0BizWVlOmNSMexnVOzZV31Hc',
  projectId: 'admission-hub-fcm',
  messagingSenderId: '298090335130',
  appId: '1:298090335130:web:8ff32d5fa70f2037e68823'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const n = (payload && payload.notification) || {};
  const d = (payload && payload.data) || {};
  self.registration.showNotification(String(n.title || 'Admission Hub'), {
    body: String(n.body || ''),
    tag: 'ah-fcm',
    renotify: true,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { src: 'fcm', link: String(d.link || 'dashboard') }
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const nd = event.notification.data || {};
  const route = String(nd.link || 'dashboard').replace(/^#?\/?/, '');
  const url = nd.src === 'fcm' ? `./#${route}` : (nd.url || './');
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const client of list) { if ('focus' in client) { try { client.navigate(url); } catch (_) {} return client.focus(); } }
    return self.clients.openWindow(url);
  }));
});
