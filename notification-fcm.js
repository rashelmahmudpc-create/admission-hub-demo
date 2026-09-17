/* v1 — Admission Hub FCM client (Phase 1, FCM-NOTIFICATION-BLUEPRINT.md).
 *
 * Layers FCM web push on top of the existing notification-hub.js (which keeps
 * the legacy Telegram + admission-notify VAPID path). Golden rules:
 *  - The Firebase SDK is NEVER loaded on app boot — only when the user taps
 *    "Enable", or in the background (idle) for already-registered users.
 *  - Every remote request is bounded (timeout + try/catch); failure never
 *    breaks the app (spec §46).
 *  - Credentials live only server-side; the browser sees public web config.
 */
(() => {
  'use strict';

  const API = '/api/notifications';
  const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.12.2';
  const SDK_LOCAL = './sdk'; /* self-hosted copy on our own domain (Cloudflare stack); gstatic is the fallback */
  const LS_STATE = 'ahFcmState';
  const SDK_TIMEOUT_MS = 25000;

  let sdkPromise = null;
  let configCache = null;
  let onMessageAttached = false;

  const stateGet = () => {
    try { return JSON.parse(localStorage.getItem(LS_STATE) || '{}') || {}; } catch (_) { return {}; }
  };
  const stateSet = (patch) => {
    try { localStorage.setItem(LS_STATE, JSON.stringify({ ...stateGet(), ...patch })); } catch (_) {}
  };

  const boundedFetch = async (path, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SDK_TIMEOUT_MS);
    try {
      const res = await fetch(API + path, { credentials: 'include', ...init, signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    } catch (_) {
      return { ok: false, status: 0, data: {} };
    } finally {
      clearTimeout(timer);
    }
  };

  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.defer = true;
    const timer = setTimeout(() => { s.remove(); reject(new Error('sdk-timeout')); }, SDK_TIMEOUT_MS);
    s.onload = () => { clearTimeout(timer); resolve(); };
    s.onerror = () => { clearTimeout(timer); s.remove(); reject(new Error('sdk-load-failed')); };
    document.head.appendChild(s);
  });

  /* Lazy Firebase SDK (compat build) — loaded at most once, only on demand.
   * Self-hosted copy on our own domain first (owner's whole-stack-on-Cloudflare
   * rule + faster than gstatic on mobile); gstatic is the fallback. */
  const tryLoadSdk = async (base) => {
    if (typeof firebase !== 'undefined' && firebase.messaging) return window.firebase;
    await loadScript(`${base}/firebase-app-compat.js`);
    await loadScript(`${base}/firebase-messaging-compat.js`);
    return window.firebase;
  };
  const loadSdk = () => {
    if (!sdkPromise) {
      sdkPromise = (async () => {
        try { return await tryLoadSdk(SDK_LOCAL); }
        catch (_) { return await tryLoadSdk(SDK_BASE); }
      })();
      sdkPromise.catch(() => { sdkPromise = null; });
    }
    return sdkPromise;
  };

  /* Returns null when the config fetch itself failed (network) so callers
   * can distinguish "server unreachable" from "FCM not configured". */
  const getConfig = async () => {
    if (configCache) return configCache;
    const out = await boundedFetch('/config');
    if (out.ok && out.data.ok) { configCache = out.data; return configCache; }
    return null;
  };

  /* Last enable() outcome — surfaced in the UI so the owner can report the
   * exact failure code instead of a vague "try again" (2026-09-17).
   * `detail` carries the raw browser/SDK message: without it every distinct
   * failure (SW race, permission, VAPID, network) collapses into one
   * unactionable code. */
  const setErr = (code, detail) => {
    try {
      if (code == null) localStorage.removeItem('ahFcmLastErr');
      else localStorage.setItem('ahFcmLastErr', JSON.stringify({
        code: String(code), at: Date.now(),
        detail: detail ? String(detail).slice(0, 200) : undefined
      }));
    } catch (_) {}
  };
  const errText = (e) => (e && (e.message || e.code || String(e))) || 'unknown';
  const lastErr = () => {
    try { return JSON.parse(localStorage.getItem('ahFcmLastErr') || 'null'); } catch (_) { return null; }
  };

  /* Firebase registers /firebase-messaging-sw.js itself, but subscribes without
   * waiting for it to activate — on a cold first enable that loses the race and
   * pushManager.subscribe() throws "no active Service Worker" (error 20), so no
   * device ever gets a token. Register here and wait until it is active, then
   * hand the ready registration to getToken().
   * A registration that never reaches `active` must fail loudly: silently
   * returning null would let the SDK re-register at its own default scope and
   * reintroduce the same race. */
  const SW_URL = './firebase-messaging-sw.js';
  const SW_SCOPE = '/firebase-cloud-messaging-push-scope';
  const readySw = async () => {
    if (!('serviceWorker' in navigator)) throw new Error('sw-unsupported');
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
    for (let i = 0; i < 100 && !reg.active; i++) await new Promise((r) => setTimeout(r, 100));
    if (!reg.active) throw new Error('sw-not-active');
    return reg;
  };

  /* The VAPID public key must be handed to getToken(). The compat SDK exposes
   * no useVapidKey()/useVapidKeyIfAvailable() method at all (verified against
   * firebase-messaging-compat 10.12.2), so the old branch was dead code and the
   * configured key was never applied. */
  const getTokenWith = async (messaging, reg, cfg) => {
    const options = {};
    if (reg) options.serviceWorkerRegistration = reg;
    if (cfg && cfg.vapidKey) options.vapidKey = cfg.vapidKey;
    return messaging.getToken(options);
  };

  const initMessaging = async (cfg) => {
    const fb = await loadSdk();
    if (!fb || typeof fb.initializeApp !== 'function') throw new Error('sdk-missing');
    const app = (fb.apps && fb.apps.length) ? fb.apps[0] : fb.initializeApp(cfg);
    const messaging = fb.messaging(app);
    /* A foreground message is delivered to the page only through this callback.
     * Without it the SDK has nowhere to hand the payload and the toast never
     * appears, even though the push arrived. Attach once — enable/disable/
     * refresh all call this. */
    if (!onMessageAttached) {
      onMessageAttached = true;
      try {
        messaging.onMessage((payload) => {
          const n = (payload && payload.notification) || {};
          const d = (payload && payload.data) || {};
          const title = n.title || 'Admission Hub';
          const body = n.body || '';
          try { window.toast?.(`${title} — ${body}`.slice(0, 240)); } catch (_) {}
          try { window.AhFcmInbox?.onForeground?.(d); } catch (_) {}
        });
      } catch (_) { onMessageAttached = false; }
    }
    return messaging;
  };

  const permission = () => (typeof Notification !== 'undefined' && Notification.permission) || 'unsupported';

  const browserInfo = () => {
    const ua = navigator.userAgent || '';
    let platform = 'web';
    if (/Android/i.test(ua)) platform = 'android';
    else if (/iPhone|iPad|iPod/i.test(ua)) platform = 'ios';
    else if (/Windows/i.test(ua)) platform = 'windows';
    else if (/Macintosh|Mac OS/i.test(ua)) platform = 'macos';
    else if (/Linux/i.test(ua)) platform = 'linux';
    let browser = 'unknown';
    if (/Edg\//.test(ua)) browser = 'edge';
    else if (/Chrome\//.test(ua)) browser = 'chrome';
    else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'safari';
    else if (/Firefox\//.test(ua)) browser = 'firefox';
    return { platform, browser };
  };

  const registerToken = async (token) => {
    const { platform, browser } = browserInfo();
    const out = await boundedFetch('/register-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, platform, browser, deviceInfo: `${navigator.language || ''}`.slice(0, 12) })
    });
    return out;
  };

  /* Self-service test push to the user's OWN devices — no admin token
   * (owner: টোকেনের ঝামেলা চাই না). Server rate-limits 3/hour. */
  const selfTest = async () => {
    const out = await boundedFetch('/self-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    return out;
  };

  /* User taps Enable → browser permission → FCM token → register on server.
   * Returns: 'granted' | 'denied' | 'unsupported' | 'not-configured' | 'error' */
  /* Returns: 'granted' | 'denied' | 'unsupported' | 'config-failed' |
   * 'not-configured' | 'sdk-failed' | 'token-failed' | 'register-<http>' | 'error' */
  const enable = async () => {
    /* iOS Safari: requestPermission() must run while the tap's transient
     * activation is still live — BEFORE any network await (owner bug
     * 2026-09-17: prompt silently never appeared). */
    try {
      if (permission() === 'default') {
        const ask = await Notification.requestPermission();
        if (ask !== 'granted') return ask;
      }
    } catch (e) { setErr('prompt-error', errText(e)); return 'error'; }
    const cfg = await getConfig();
    if (!cfg) { setErr('config-failed', 'config request failed'); return 'config-failed'; }
    if (!cfg.fcmConfigured || !cfg.webConfig) { setErr('not-configured', 'server has no FCM web config'); return 'not-configured'; }
    try {
      if (permission() !== 'granted') {
        const p = permission();
        if (p === 'denied') return 'denied';
        setErr(p); return 'unsupported';
      }
      let messaging;
      try { messaging = await initMessaging(cfg.webConfig); }
      catch (e) { setErr('sdk-failed', errText(e)); return 'sdk-failed'; }
      let token;
      try {
        const reg = await readySw();
        token = await getTokenWith(messaging, reg, cfg.webConfig);
      }
      catch (e) { setErr('token-failed', errText(e)); return 'token-failed'; }
      if (!token) { setErr('token-empty', 'getToken returned an empty value'); return 'token-failed'; }
      const out = await registerToken(token);
      if (out.ok) { setErr(null); stateSet({ enabled: true, at: Date.now() }); return 'granted'; }
      setErr('register-' + out.status, 'server rejected the token registration');
      return 'register-' + out.status;
    } catch (e) {
      setErr('error', errText(e));
      return 'error';
    }
  };

  /* User turns push OFF → stop the FCM subscription + deactivate server-side. */
  const disable = async () => {
    stateSet({ enabled: false, at: Date.now() });
    try {
      const cfg = await getConfig();
      if (cfg && cfg.fcmConfigured && cfg.webConfig) {
        const messaging = await initMessaging(cfg.webConfig);
        const reg = await readySw();
        const token = await getTokenWith(messaging, reg, cfg.webConfig);
        if (token) {
          await boundedFetch('/unregister-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
          });
          await messaging.deleteToken().catch(() => {});
        }
      }
    } catch (_) { /* best effort — state already flipped */ }
    return true;
  };

  /* §6 Token refresh: app start → check token → changed? update : continue.
   * Idempotent server upsert, so running this on every start is safe and also
   * keeps last_seen fresh. Runs in the background, never blocks boot. */
  const refreshIfEnabled = async () => {
    const st = stateGet();
    if (!st.enabled) return;
    const cfg = await getConfig();
    if (!cfg || !cfg.fcmConfigured || !cfg.webConfig) { stateSet({ enabled: false }); return; }
    try {
      const messaging = await initMessaging(cfg.webConfig);
      if (permission() !== 'granted') { stateSet({ enabled: false }); return; }
      const reg = await readySw();
      const token = await getTokenWith(messaging, reg, cfg.webConfig);
      if (token) await registerToken(token);
    } catch (e) { setErr('refresh-failed', errText(e)); }
  };

  /* Foreground FCM delivery — the SW postMessages focused clients.
   * The push arrives on the push-scope registration (firebase-messaging-sw.js),
   * NOT on navigator.serviceWorker.ready (which resolves to the shell worker),
   * so listening only on `ready` silently dropped every foreground message. */
  const watchForeground = () => {
    if (!('serviceWorker' in navigator)) return;
    const onMsg = (event) => {
      const msg = event.data;
      if (!msg || msg.ah !== 'fcm') return;
      try {
        window.toast?.(`${msg.title} — ${msg.body}`.slice(0, 240));
      } catch (_) {}
    };
    navigator.serviceWorker.addEventListener?.('message', onMsg);
    navigator.serviceWorker.getRegistrations?.().then((regs) => {
      regs.forEach((reg) => reg.addEventListener?.('message', onMsg));
    }).catch(() => {});
  };

  const status = async () => {
    const cfg = await getConfig();
    const st = stateGet();
    let devices = 0;
    if (cfg && cfg.fcmConfigured) {
      const out = await boundedFetch('/status');
      if (out.ok && out.data.ok) devices = Number(out.data.devices || 0);
    }
    return {
      fcmConfigured: Boolean(cfg && cfg.fcmConfigured),
      permission: permission(),
      registered: Boolean(st.enabled),
      devices
    };
  };

  /* Row injected into the notification-hub settings modal (extends, no fork).
   * Round 8 (owner directive 2026-09-17): no device/token jargon, no success
   * toasts — enablement routes to the premium centered allow dialog. */
  const settingsRow = async () => {
    const s = await status();
    const pad = 'padding:10px 0;border-bottom:1px solid var(--line);';
    const L = (() => { try { return window.AhI18n ? window.AhI18n.get() : 'bn'; } catch (_) { return 'bn'; } })();
    const st = (bn, en) => (L === 'en' ? en : bn);
    if (!s.fcmConfigured) {
      return `<div style="${pad}font-size:12px;color:var(--sub)"><span>📡 FCM Push</span> <span style="opacity:.7">${st('সংযোগ হচ্ছে না — configuration আসার অপেক্ষায়', 'Connecting — waiting for server settings')}</span></div>`;
    }
    if (s.permission === 'denied') {
      return `<div style="${pad}font-size:12px;color:var(--red)">📡 FCM Push — ${st('browser-এ অনুমতি বন্ধ আছে (Settings → Site settings → Notifications থেকে খুলতে হবে)', 'permission is blocked (enable in Settings → Site settings → Notifications)')}</div>`;
    }
    if (s.registered) {
      return `<div style="${pad}display:flex;align-items:center;gap:10px"><span style="flex:1;font-size:12px">📡 FCM Push <b style="color:var(--green)">✓ ${st('চলছে', 'Active')}</b></span><button class="btn ghost sm" onclick="AhFcm.disable().then(()=>NotificationHub.openSettings())">${st('বন্ধ করুন', 'Turn off')}</button></div>`;
    }
    return `<div style="${pad}display:flex;align-items:center;gap:10px"><span style="flex:1;font-size:12px">📡 FCM Push</span><button class="btn sm" onclick="closeModal();NotificationHub.openAllowDialog()">${st('চালু করুন', 'Turn on')}</button></div>`;
  };

  /* Dev test center (§18) — hidden route #notif-dev. Admin Bearer token is
   * entered per call and never stored. */
  const devPanel = () => {
    const open = async () => {
      const s = await status();
      const cfgOut = await boundedFetch('/config');
      const html = `
        <h3>🛠️ FCM Test Center</h3>
        <p style="font-size:12px;margin-top:4px;line-height:1.7">
          FCM: <b id="ahFcmDevStatus">${s.fcmConfigured ? '🟢 Configured' : '🔴 Not configured'}</b><br>
          Device: ${s.registered ? `🟢 Registered (${s.devices})` : '🔴 Not registered'} · Permission: ${s.permission}<br>
          Web config: ${cfgOut.data.webConfig ? '🟢 present' : '🔴 missing'}
        </p>
        ${s.fcmConfigured && s.registered ? `
        <label class="flabel" style="margin-top:10px">Admin token (Bearer — store করা হয় না)</label>
        <input id="ahFcmDevToken" type="password" placeholder="ADMIN_TOKEN" style="width:100%;box-sizing:border-box">
        <label class="flabel" style="margin-top:8px">Test message</label>
        <input id="ahFcmDevBody" type="text" value="🔔 Admission Hub — FCM test successful" style="width:100%;box-sizing:border-box">
        <button class="btn sm" style="margin-top:10px" id="ahFcmDevSend"> Send Test</button>
        <pre id="ahFcmDevOut" style="font-size:11px;white-space:pre-wrap;margin-top:10px;color:var(--sub)"></pre>` : ''}
        <button class="btn ghost sm" style="margin-top:14px" onclick="closeModal()">Close</button>`;
      const { openModal } = window;
      if (typeof openModal !== 'function') { window.toast?.('Test center: modal unavailable'); return; }
      openModal(html);
      const send = document.getElementById('ahFcmDevSend');
      const out = document.getElementById('ahFcmDevOut');
      if (send && out) {
        send.addEventListener('click', async () => {
          const token = document.getElementById('ahFcmDevToken')?.value?.trim() || '';
          const body = document.getElementById('ahFcmDevBody')?.value?.trim() || '';
          out.textContent = 'Sending…';
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 15000);
          try {
            const res = await fetch(API + '/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              credentials: 'include',
              body: JSON.stringify({ body, link: 'dashboard' }),
              signal: controller.signal
            });
            out.textContent = JSON.stringify(await res.json().catch(() => ({})), null, 2);
          } catch (_) {
            out.textContent = 'Send failed (network/timeout)';
          } finally {
            clearTimeout(timer);
          }
        });
      }
    };
    return open;
  };

  const boot = () => {
    if (typeof document === 'undefined') return;
    watchForeground();
    // Hidden dev route.
    const checkDev = () => { if (location.hash === '#notif-dev') devPanel(); };
    document.addEventListener?.('hashchange', checkDev);
    // Background token refresh for registered users — after the app has
    // settled, never on the critical boot path.
    const later = () => {
      if (document.visibilityState !== 'visible') return;
      refreshIfEnabled().catch(() => {});
    };
    if ('requestIdleCallback' in window) requestIdleCallback(later, { timeout: 20000 });
    else setTimeout(later, 6000);
    document.addEventListener?.('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshIfEnabled().catch(() => {});
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.AhFcm = {
    status, enable, disable, refresh: refreshIfEnabled,
    settingsRow, devPanel,
    _state: stateGet, _config: getConfig, lastErr, selfTest
  };
})();
