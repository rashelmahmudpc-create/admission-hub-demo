#!/usr/bin/env python3
"""Continue with Google = full-page redirect straight to accounts.google.com
(owner 2026-10-17). No popup, no direct GSI, no Firebase page in between.

* Google gets its own Firebase app 'ah-google-sky' with authDomain
  admissionsky.pages.dev (/__/auth/* is proxied by _worker.js), so Google shows
  "continue to admissionsky.pages.dev" and the result returns first-party.
* Facebook keeps the old 'ah-google' app on the firebaseapp.com authDomain.
* Any other host hands off to https://admissionsky.pages.dev/?ahGoogle=1.
* In-app browsers (Facebook, Messenger, Instagram, TikTok, WebView...) never
  start Google: an "open in Chrome" panel with a copy-link option is shown.
* Errors show the real error code.

Idempotent. Run from the repo root, then `npm run sw:manifest`.
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def edit(rel, pairs):
    path = ROOT / rel
    text = path.read_text(encoding='utf-8')
    for old, new in pairs:
        if new in text:
            continue
        if text.count(old) != 1:
            sys.exit(f'{rel}: anchor not found exactly once: {old[:70]!r}')
        text = text.replace(old, new)
    path.write_text(text, encoding='utf-8')


def region(rel, start, end, new, marker):
    path = ROOT / rel
    text = path.read_text(encoding='utf-8')
    if marker in text:
        return
    if text.count(start) != 1 or text.count(end) != 1:
        sys.exit(f'{rel}: region anchors not found exactly once')
    a = text.index(start)
    b = text.index(end) + len(end)
    if b <= a:
        sys.exit(f'{rel}: region anchors out of order')
    path.write_text(text[:a] + new + text[b:], encoding='utf-8')


# ---------------------------------------------------------------- account-access.js
REGION_START = "  /* Google sign-in runs through Firebase's own authDomain rather than through\n"
REGION_END = "  const loadGoogle = clientId => {\n    prepareDirectGoogle();\n"
MARKER = "const GOOGLE_SKY_APP = 'ah-google-sky';"

REGION_NEW = r'''  /* Owner 2026-10-17: "Continue with Google" is a full-page redirect straight to
   * Google's own sign-in page (accounts.google.com) -- no popup, no direct GSI
   * popup, no Firebase page in between. Google runs on its own Firebase app whose
   * authDomain is THIS site: _worker.js proxies /__/auth/* to Firebase and the
   * OAuth client authorises https://admissionsky.pages.dev/__/auth/handler, so
   * Google says "continue to admissionsky.pages.dev" and the redirect result is
   * kept in first-party storage (nothing lost to partitioning on phones/PWAs).
   * Facebook stays on the old 'ah-google' app with the firebaseapp.com authDomain:
   * its Facebook app only knows that redirect URI. POST /google is unchanged. */
  const GOOGLE_AUTH_DOMAIN = 'admissionsky-997d2.firebaseapp.com';
  const GOOGLE_SKY_HOST = 'admissionsky.pages.dev';
  const GOOGLE_SKY_APP = 'ah-google-sky';
  const GOOGLE_AUTH_PROJECT = 'admissionsky-997d2';
  /* Public Firebase Web API key of the auth project. Not a confidential secret:
   * the same value is inlined in .github/workflows/deploy-pages-worker.yml. */
  const GOOGLE_AUTH_API_KEY = 'AIzaSyCMYPy-qANPN1pPPI1B957wwKezmotK_NI';
  const FIREBASE_SDK_VERSION = '10.12.2';

  const loadScriptOnce = src => new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-ah-src="${src}"]`);
    if (existing) {
      if (existing.dataset.ahLoaded === '1') return resolve(true);
      existing.addEventListener('load', () => resolve(true), { once: true });
      existing.addEventListener('error', () => reject(new Error(`load failed: ${src}`)), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.ahSrc = src;
    script.onload = () => { script.dataset.ahLoaded = '1'; resolve(true); };
    script.onerror = () => reject(new Error(`load failed: ${src}`));
    document.head.append(script);
  });

  const loadFirebaseSdk = async () => {
    /* app-compat is usually already on the page (the app preloads it for
     * analytics), so only fetch what is actually missing. A host or test that
     * injects firebase.auth is used as-is. */
    if (!window.firebase) {
      /* Self-hosted copy first (works offline and needs no third-party origin);
       * gstatic is the fallback. */
      let base = './sdk';
      try { await loadScriptOnce(`${base}/firebase-app-compat.js`); }
      catch (_) {
        base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
        await loadScriptOnce(`${base}/firebase-app-compat.js`);
      }
    }
    if (!(window.firebase && typeof window.firebase.auth === 'function')) {
      await loadScriptOnce('./sdk/firebase-auth-compat.js');
    }
    if (!window.firebase || typeof window.firebase.auth !== 'function') throw new Error('Firebase Auth unavailable');
    return window.firebase;
  };

  const firebaseAuthFor = async (name, authDomain) => {
    const firebase = await loadFirebaseSdk();
    const named = (firebase.apps || []).find(app => app.name === name);
    const app = named || firebase.initializeApp({ apiKey: GOOGLE_AUTH_API_KEY, authDomain, projectId: GOOGLE_AUTH_PROJECT }, name);
    return firebase.auth(app);
  };

  /* Facebook only: the original app, authDomain firebaseapp.com. */
  const loadFirebaseAuth = () => {
    if (!state.firebaseAuthPromise) {
      state.firebaseAuthPromise = firebaseAuthFor('ah-google', GOOGLE_AUTH_DOMAIN);
      state.firebaseAuthPromise.catch(() => { state.firebaseAuthPromise = null; });
    }
    return state.firebaseAuthPromise;
  };

  /* Google only: authDomain is our own site. */
  const loadGoogleAuth = () => {
    if (!state.googleAuthPromise) {
      state.googleAuthPromise = firebaseAuthFor(GOOGLE_SKY_APP, GOOGLE_SKY_HOST);
      state.googleAuthPromise.catch(() => { state.googleAuthPromise = null; });
    }
    return state.googleAuthPromise;
  };

  /* Facebook only (unchanged): the Firebase OAuth popup completes through a
   * hidden relay on the authDomain. A mobile WebView, an in-app browser and an
   * installed PWA run that relay with no shared storage, so the handshake never
   * returns. On those surfaces Facebook signs in by full-page redirect instead;
   * desktop keeps the popup, and a dead popup still falls back (popupDead). */
  const oauthPopupSupported = () => {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return false;
    } catch (_) {}
    const ua = String((navigator && navigator.userAgent) || '');
    if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Twitter|TikTok|SnapChat|Pinterest/i.test(ua)) return false;
    return true;
  };

  /* A popup that is blocked, unsupported, or killed by the missing shared
   * storage all land in the same dead end on a phone; the redirect works there,
   * so fall back to it rather than reporting the failure. A user who closed the
   * popup deliberately is NOT one of these -- that intent is respected. */
  const popupDead = error => ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment',
    'auth/web-storage-unsupported', 'auth/internal-error'].includes(String(error?.code || ''));

  const OAUTH_REDIRECT = 'oauth-redirect';
  const OAUTH_REDIRECT_FLAG = 'ah-oauth-redirect';
  const GOOGLE_REDIRECT_FLAG = 'ah-google-redirect';

  const beginOAuthRedirect = async (auth, provider, google = false) => {
    try {
      if (google) sessionStorage.setItem(GOOGLE_REDIRECT_FLAG, '1');
      else sessionStorage.setItem(OAUTH_REDIRECT_FLAG, '1');
    } catch (_) {}
    await auth.signInWithRedirect(provider);
    return OAUTH_REDIRECT;
  };

  /* Google refuses in-app browsers and WebViews (403 disallowed_useragent), so
   * Google is never started there -- the visitor is sent to Chrome instead. */
  const IN_APP_BROWSER_UA = /FBAN|FBAV|FB_IAB|FB4A|FBIOS|FBSS|Messenger|Instagram|Line\/|MicroMessenger|Twitter|TikTok|musical_ly|BytedanceWebview|SnapChat|Pinterest|LinkedInApp|; wv\)/i;
  const userAgentText = () => String((navigator && navigator.userAgent) || '');
  const inAppBrowser = () => IN_APP_BROWSER_UA.test(userAgentText());
  const GOOGLE_SKY_URL = `https://${GOOGLE_SKY_HOST}/?ahGoogle=1`;
  const GOOGLE_CHROME_INTENT = `intent://${GOOGLE_SKY_HOST}/?ahGoogle=1#Intent;scheme=https;package=com.android.chrome;end`;

  const googleMessage = error => {
    const code = String(error?.code || '');
    let text = 'Google লগইন এই মুহূর্তে খুলছে না—আবার চেষ্টা করো বা ইমেইল দিয়ে ঢুকো।';
    if (code === 'in-app-browser') text = 'এই app-এর ভেতরের browser-এ Google লগইন হয় না—Chrome-এ খুলে চেষ্টা করো।';
    else if (code === 'auth/network-request-failed') text = 'ইন্টারনেট সংযোগ পাওয়া যায়নি—নেট চালু করে আবার চেষ্টা করো।';
    else if (code === 'auth/web-storage-unsupported' || code === 'auth/operation-not-supported-in-this-environment') text = 'এই browser-এ Google লগইন হয় না—Chrome বা Safari-এ সাইটটি খুলে চেষ্টা করো।';
    else if (code === 'auth/unauthorized-domain') text = 'এই ঠিকানা থেকে Google লগইন চালু নেই—admissionsky.pages.dev থেকে চেষ্টা করো।';
    else if (code === 'auth/user-disabled') text = 'এই Google account বন্ধ করা আছে—অন্য পদ্ধতিতে ঢুকো।';
    else if (code === 'auth/account-exists-with-different-credential') text = 'এই Email অন্য পদ্ধতিতে খোলা আছে—আগের পদ্ধতি দিয়ে ঢুকো।';
    return code ? `${text} [${code}]` : text;
  };
  const GOOGLE_LOCAL_CODES = new Set(['in-app-browser', 'firebase-sdk-unavailable']);
  const googleErrorText = error => {
    const code = String(error?.code || '');
    if (!code || code.startsWith('auth/') || GOOGLE_LOCAL_CODES.has(code)) return googleMessage(error);
    const detail = String(error?.diagnostic || error?.authStage || '');
    return `${friendlyError(error)} [${[code, detail].filter(Boolean).join(' · ')}]`;
  };

  const showGoogleInAppHelp = () => {
    let panel = document.getElementById('ah-google-inapp');
    if (!panel) {
      const android = /Android/i.test(userAgentText());
      panel = document.createElement('div');
      panel.id = 'ah-google-inapp';
      panel.dataset.role = 'google-inapp';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.6)';
      const card = document.createElement('div');
      card.style.cssText = 'width:100%;max-width:380px;background:#fff;color:#0f172a;border-radius:16px;padding:20px;font:15px/1.55 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.35)';
      const title = document.createElement('h3');
      title.style.cssText = 'margin:0 0 8px;font-size:18px';
      title.textContent = 'Chrome-এ খুলে Google দিয়ে ঢুকো';
      const text = document.createElement('p');
      text.style.cssText = 'margin:0 0 14px';
      text.textContent = android
        ? 'Facebook/Messenger-এর মতো app-এর ভেতরের browser-এ Google লগইন করতে দেয় না। নিচের বাটন চাপলে সাইটটি Chrome-এ খুলবে, সেখানে Google দিয়ে ঢুকো।'
        : 'Facebook/Messenger-এর মতো app-এর ভেতরের browser-এ Google লগইন করতে দেয় না। উপরের ⋯ মেনু থেকে "Open in browser" চাপো, অথবা লিংক কপি করে Safari বা Chrome-এ খোলো।';
      const style = primary => `display:block;box-sizing:border-box;width:100%;margin:0 0 10px;padding:12px;border-radius:12px;font:600 15px system-ui,sans-serif;text-align:center;text-decoration:none;cursor:pointer;${primary ? 'background:#2563eb;color:#fff;border:0' : 'background:#fff;color:#1e293b;border:1px solid #cbd5e1'}`;
      card.append(title, text);
      if (android) {
        const chrome = document.createElement('a');
        chrome.href = GOOGLE_CHROME_INTENT;
        chrome.dataset.role = 'google-open-chrome';
        chrome.textContent = 'Chrome-এ খুলুন';
        chrome.style.cssText = style(true);
        card.append(chrome);
      }
      const field = document.createElement('input');
      field.type = 'text';
      field.readOnly = true;
      field.value = GOOGLE_SKY_URL;
      field.dataset.role = 'google-link-field';
      field.style.cssText = 'display:none;box-sizing:border-box;width:100%;margin:0 0 10px;padding:10px;border:1px solid #cbd5e1;border-radius:10px;font:14px system-ui,sans-serif';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.dataset.role = 'google-copy-link';
      copy.textContent = 'লিংক কপি করুন';
      copy.style.cssText = style(!android);
      copy.addEventListener('click', () => {
        const done = () => { copy.textContent = 'লিংক কপি হয়েছে ✓'; };
        const manual = () => {
          field.style.display = 'block';
          field.focus();
          field.select();
          try { if (document.execCommand && document.execCommand('copy')) done(); } catch (_) {}
        };
        try { navigator.clipboard.writeText(GOOGLE_SKY_URL).then(done, manual); } catch (_) { manual(); }
      });
      const close = document.createElement('button');
      close.type = 'button';
      close.dataset.role = 'google-inapp-close';
      close.textContent = 'বন্ধ করুন';
      close.style.cssText = style(false);
      close.addEventListener('click', () => { panel.style.display = 'none'; });
      const code = document.createElement('p');
      code.style.cssText = 'margin:4px 0 0;font-size:12px;color:#64748b;text-align:center';
      code.textContent = 'কোড: in-app-browser';
      card.append(copy, field, close, code);
      panel.append(card);
      document.body.append(panel);
    }
    panel.style.display = 'flex';
    return panel;
  };

  /* The only way Google starts. Never a popup: either the whole page goes to
   * Google, or (wrong host) to admissionsky.pages.dev first, or (in-app
   * browser) the "open in Chrome" panel. */
  const startGoogleRedirect = async () => {
    if (inAppBrowser()) {
      showGoogleInAppHelp();
      throw Object.assign(new Error('in-app-browser'), { code: 'in-app-browser' });
    }
    if (String(location.hostname || '') !== GOOGLE_SKY_HOST) {
      location.assign(GOOGLE_SKY_URL);
      return new Promise(() => {});
    }
    let auth;
    try { auth = await loadGoogleAuth(); } catch (error) {
      throw Object.assign(new Error('Firebase Auth unavailable'), { code: String(error?.code || 'firebase-sdk-unavailable') });
    }
    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('profile');
    if (typeof provider.setCustomParameters === 'function') provider.setCustomParameters({ prompt: 'select_account' });
    return beginOAuthRedirect(auth, provider, true);
  };

  /* Runs once at boot, and only when a redirect we started is coming back, so
   * an ordinary load never pays for the getRedirectResult round-trip. */
  const finishOAuthRedirect = async () => {
    let facebookPending = false;
    let googlePending = false;
    try {
      facebookPending = sessionStorage.getItem(OAUTH_REDIRECT_FLAG) === '1';
      googlePending = sessionStorage.getItem(GOOGLE_REDIRECT_FLAG) === '1';
      if (facebookPending) sessionStorage.removeItem(OAUTH_REDIRECT_FLAG);
      if (googlePending) sessionStorage.removeItem(GOOGLE_REDIRECT_FLAG);
    } catch (_) {}
    if (!facebookPending && !googlePending) return;
    const auth = await (googlePending ? loadGoogleAuth() : loadFirebaseAuth()).catch(() => null);
    if (!auth || typeof auth.getRedirectResult !== 'function') {
      if (googlePending) {
        open();
        showView('login');
        message(googleMessage({ code: 'firebase-sdk-unavailable' }), 'error');
      }
      return;
    }
    let result = null;
    let redirectError = null;
    try { result = await auth.getRedirectResult(); } catch (error) { redirectError = error; }
    const accessToken = String(result?.credential?.accessToken || '');
    if (!result?.user || accessToken.length < 20) {
      /* The redirect came back empty: the user backed out, or the browser
       * dropped the result. Say so (with the real code) instead of silently
       * leaving them on the same page. */
      open();
      showView('login');
      const code = String(redirectError?.code || '');
      const text = code === 'auth/account-exists-with-different-credential'
        ? 'এই Email অন্য পদ্ধতিতে খোলা আছে—আগের পদ্ধতি দিয়ে ঢুকো।'
        : 'লগইন সম্পন্ন হয়নি—আবার চেষ্টা করো। বারবার হলে Chrome/Safari-এ সাইটটি খুলে চেষ্টা করো বা Email দিয়ে ঢুকো।';
      message(code ? `${text} [${code}]` : text, 'error');
      return;
    }
    const providerId = googlePending ? 'google.com' : String(result.credential?.providerId || result.user.providerId || '');
    try {
      if (providerId === 'facebook.com') {
        open();
        const r = await api('/facebook', { method: 'POST', body: { accessToken } });
        await establishSession(r, 'Facebook \u09a6\u09bf\u09af\u09bc\u09c7 \u09a4\u09cb\u09ae\u09be\u09b0 account-\u098f \u09aa\u09cd\u09b0\u09ac\u09c7\u09b6 \u09b9\u09af\u09bc\u09c7\u099b\u09c7\u0964');
      } else if (providerId === 'google.com') {
        open();
        state.googleLinkToken = '';
        const r = await api('/google', { method: 'POST', body: { accessToken } });
        await establishSession(r, 'Google \u09a6\u09bf\u09af\u09bc\u09c7 \u09a4\u09cb\u09ae\u09be\u09b0 account-\u098f \u09aa\u09cd\u09b0\u09ac\u09c7\u09b6 \u09b9\u09af\u09bc\u09c7\u099b\u09c7\u0964');
      }
    } catch (error) {
      if (providerId === 'google.com') {
        /* Keep the fresh Google token in memory only, so the "link to your
         * existing account" form can finish without a second trip to Google. */
        if (error?.code === 'ACCOUNT_LINK_REQUIRED') {
          state.googleLinkToken = accessToken;
          showView('google-link');
        }
        message(googleErrorText(error), 'error');
        return;
      }
      message(error?.code ? friendlyError(error) : '\u09b2\u0997\u0987\u09a8 \u09b8\u09ae\u09cd\u09aa\u09a8\u09cd\u09a8 \u09b9\u09af\u09bc\u09a8\u09bf\u2014\u0986\u09ac\u09be\u09b0 \u099a\u09c7\u09b7\u09cd\u099f\u09be \u0995\u09b0\u09cb\u0964', 'error');
    }
  };

  const signInWithGoogle = async () => {
    if (state.busy) return;
    setBusy(true);
    try {
      await startGoogleRedirect();
    } catch (error) {
      message(googleErrorText(error), 'error');
    } finally { setBusy(false); }
  };

  const loadGoogle = clientId => {
'''

region('account-access.js', REGION_START, REGION_END, REGION_NEW, MARKER)

LINK_START = (
    "  const linkGoogle = async (email, password) => {\n"
    "    const accessToken = await googleAccessToken().catch(error => {\n"
)
LINK_END = (
    "    return api('/google/link', { method: 'POST', body: { email, password, accessToken } });\n"
    "  };\n"
)
LINK_NEW = (
    "  const linkGoogle = async (email, password) => {\n"
    "    // The Google token from the redirect that just came back (memory only).\n"
    "    const accessToken = String(state.googleLinkToken || '');\n"
    "    if (accessToken.length < 20) {\n"
    "      throw Object.assign(new Error('google-token-missing'), { userMessage: 'আগে আবার \"Continue with Google\" চাপো, ফিরে এসে এখানে ইমেইল ও পাসওয়ার্ড দাও। [google-token-missing]' });\n"
    "    }\n"
    "    const result = await api('/google/link', { method: 'POST', body: { email, password, accessToken } });\n"
    "    state.googleLinkToken = '';\n"
    "    return result;\n"
    "  };\n"
)
BRIDGE_OLD = (
    "    google: async () => {\n"
    "      const result = await googleSignInRequest();\n"
    "      if (result === OAUTH_REDIRECT) return true;\n"
    "      await establishSession(result, 'Google দিয়ে তোমার account-এ প্রবেশ হয়েছে।');\n"
    "      return true;\n"
    "    },\n"
)
BRIDGE_NEW = (
    "    google: async () => {\n"
    "      // Full-page redirect only: the page leaves for Google and the sign-in\n"
    "      // finishes in finishOAuthRedirect() when it comes back.\n"
    "      try { await startGoogleRedirect(); } catch (error) {\n"
    "        const text = googleErrorText(error);\n"
    "        throw Object.assign(new Error(text), { userMessage: text });\n"
    "      }\n"
    "      return true;\n"
    "    },\n"
)
BOOT1_OLD = (
    "    let returnedFromPasswordReset = false;\n"
    "    try {\n"
    "      const current = new URL(location.href);\n"
)
BOOT1_NEW = (
    "    let returnedFromPasswordReset = false;\n"
    "    let googleHandoff = false;\n"
    "    try {\n"
    "      const current = new URL(location.href);\n"
    "      // ?ahGoogle=1: another host (or Chrome opened from an in-app browser)\n"
    "      // handed the Google sign-in over to admissionsky.pages.dev.\n"
    "      googleHandoff = current.searchParams.get('ahGoogle') === '1';\n"
    "      if (googleHandoff) {\n"
    "        current.searchParams.delete('ahGoogle');\n"
    "        history.replaceState(null, '', current.pathname + current.search + current.hash);\n"
    "      }\n"
)
BOOT2_OLD = (
    "      await finishOAuthRedirect();\n"
    "      if (accountVerified(state.session)) return;\n"
)
BOOT2_NEW = (
    "      await finishOAuthRedirect();\n"
    "      if (accountVerified(state.session)) return;\n"
    "      if (googleHandoff) { signInWithGoogle(); return; }\n"
)
region('account-access.js', LINK_START, LINK_END, LINK_NEW, "state.googleLinkToken = '';\n    return result;")
edit('account-access.js', [(BRIDGE_OLD, BRIDGE_NEW), (BOOT1_OLD, BOOT1_NEW), (BOOT2_OLD, BOOT2_NEW)])

src = (ROOT / 'account-access.js').read_text(encoding='utf-8')
for gone in ('DIRECT_GOOGLE', 'initTokenClient', 'googleSignInRequest', 'googleAccessToken', 'prepareDirectGoogle', 'accounts.google.com/gsi'):
    if gone in src:
        sys.exit(f'account-access.js: leftover {gone}')

# ---------------------------------------------------------------- tests
edit('native-auth-protection.test.mjs', [(
    "  assert.match(client, /const DIRECT_GOOGLE_OFF = 'ah-google-direct-off'/);\n",
    "  assert.match(client, /const GOOGLE_REDIRECT_FLAG = 'ah-google-redirect'/);\n"
    "  assert.doesNotMatch(client, /DIRECT_GOOGLE|initTokenClient/);\n",
), (
    "  assert.equal(storageCalls.length, 5, 'only the five existing OAuth boolean flag accesses are permitted');\n",
    "  assert.equal(storageCalls.length, 6, 'only the six OAuth boolean flag accesses (Facebook + Google redirect) are permitted');\n",
), (
    "      ? /^(?:OAUTH_REDIRECT_FLAG|DIRECT_GOOGLE_OFF),\\s*'1'$/\n"
    "      : /^(?:OAUTH_REDIRECT_FLAG|DIRECT_GOOGLE_OFF)$/;\n",
    "      ? /^(?:OAUTH_REDIRECT_FLAG|GOOGLE_REDIRECT_FLAG),\\s*'1'$/\n"
    "      : /^(?:OAUTH_REDIRECT_FLAG|GOOGLE_REDIRECT_FLAG)$/;\n",
)])

MM = 'multimethod-auth-ui.test.mjs'
edit(MM, [(
    "function setup({ methods = {}, signed = false, passkeyCredentials = null, backupInteraction = null, pageUrl = 'https://admissionhub.pages.dev/', accountCreated = true, existingPasskeys = 0 } = {}) {\n"
    "  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {\n"
    "    url: pageUrl,\n",
    "function setup({ methods = {}, signed = false, passkeyCredentials = null, backupInteraction = null, pageUrl = '', accountCreated = true, existingPasskeys = 0, googleReturn = false } = {}) {\n"
    "  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {\n"
    "    url: pageUrl || (googleReturn ? 'https://admissionsky.pages.dev/' : 'https://admissionhub.pages.dev/'),\n",
), (
    "  /* Google sign-in now runs through Firebase's authDomain, not GSI on our own\n"
    "   * origin, so the mock provides firebase.auth().signInWithPopup and returns a\n"
    "   * Google access token, which is what POST /google accepts. */\n",
    "  /* Google sign-in is a full-page redirect (owner 2026-10-17). A test that\n"
    "   * needs a signed-in Google user starts as a page coming BACK from Google\n"
    "   * (googleReturn): the redirect flag is set and getRedirectResult waits until\n"
    "   * the test calls googleCredential(token), then returns that access token. */\n"
    "  let releaseGoogleReturn = null;\n"
    "  const googleReturnGate = googleReturn ? new Promise(resolve => { releaseGoogleReturn = resolve; }) : null;\n"
    "  if (googleReturn) dom.window.sessionStorage.setItem('ah-google-redirect', '1');\n",
), (
    "        async getRedirectResult() { return null; }\n",
    "        async getRedirectResult() {\n"
    "          if (!googleReturnGate || app?.name !== 'ah-google-sky') return null;\n"
    "          const token = await googleReturnGate;\n"
    "          return { user: { uid: 'google-user' }, credential: { providerId: 'google.com', accessToken: token } };\n"
    "        }\n",
), (
    "  const googleCredential = token => {\n"
    "    dom.window.__googleAccessToken = token;\n",
    "  const googleCredential = token => {\n"
    "    if (releaseGoogleReturn) { releaseGoogleReturn(token); return; }\n"
    "    dom.window.__googleAccessToken = token;\n",
)])

mm = (ROOT / MM).read_text(encoding='utf-8')
OLD_BLOCK_START = "test('Google is capability-gated, uses Firebase endpoint, and keeps tokens out of browser storage', async () => {\n"
OLD_BLOCK_END = "test('Google canary requests the explicit server-authorized config only from the opt-in URL', async () => {\n"
NEW_BLOCK = (
    "test('Google is capability-gated, returns from the redirect through POST /google, and keeps tokens out of browser storage', async () => {\n"
    "  const clientId = '123456789012-exampleclientidentifier.apps.googleusercontent.com';\n"
    "  const app = setup({ methods: { google: { available: true, clientId } }, googleReturn: true });\n"
    "  await waitFor(() => app.document.querySelector('[data-role=\"google-button\"] button'));\n"
    "  app.window.AdmissionAccount.open();\n"
    "  const accessToken = `google-access-${'x'.repeat(32)}`;\n"
    "  app.googleCredential(accessToken);\n"
    "  await waitFor(() => app.calls.some(call => call.path.endsWith('/google')));\n"
    "  await waitFor(() => app.document.querySelector('[data-view=\"signed\"]').hidden === false);\n"
    "  const call = app.calls.find(item => item.path.endsWith('/google'));\n"
    "  assert.deepEqual(call.body, { accessToken });\n"
    "  assert.equal(app.window.AdmissionAccount.isVerified(), true);\n"
    "  assert.equal('localStorage' in call, false);\n"
    "  assert.equal(app.window.localStorage.length, 0);\n"
    "  assert.equal(app.window.sessionStorage.length, 0);\n"
    "  app.dom.window.close();\n"
    "});\n"
    "\n"
    "test('Google never opens a popup: the button sends the whole page to Google', async () => {\n"
    "  const clientId = '123456789012-exampleclientidentifier.apps.googleusercontent.com';\n"
    "  const app = setup({ methods: { google: { available: true, clientId } }, pageUrl: 'https://admissionsky.pages.dev/' });\n"
    "  await waitFor(() => app.document.querySelector('[data-role=\"google-button\"] button'));\n"
    "  let popupCalled = 0;\n"
    "  let redirectCalled = 0;\n"
    "  app.window.__googlePopupFailure = () => { popupCalled += 1; return Promise.reject(new Error('popup must not be used')); };\n"
    "  app.window.__googleRedirect = () => { redirectCalled += 1; };\n"
    "  const settled = await Promise.race([\n"
    "    app.window.AdmissionSkyBridge.google().then(() => 'resolved', error => `rejected:${error.message}`),\n"
    "    sleep(1500).then(() => 'hung')\n"
    "  ]);\n"
    "  assert.equal(settled, 'resolved');\n"
    "  assert.equal(redirectCalled, 1, 'Google must use signInWithRedirect');\n"
    "  assert.equal(popupCalled, 0, 'Google must never use signInWithPopup');\n"
    "  assert.equal(app.window.sessionStorage.getItem('ah-google-redirect'), '1');\n"
    "  assert.equal(app.calls.some(call => call.path.endsWith('/google')), false);\n"
    "  app.dom.window.close();\n"
    "});\n"
    "\n"
)
if "test('Google never opens a popup: the button sends the whole page to Google'" not in mm:
    if mm.count(OLD_BLOCK_START) != 1 or mm.count(OLD_BLOCK_END) != 1:
        sys.exit(f'{MM}: Google block anchors not found exactly once')
    a = mm.index(OLD_BLOCK_START)
    b = mm.index(OLD_BLOCK_END)
    mm = mm[:a] + NEW_BLOCK + mm[b:]
# Tests that only need a signed-in Google user start as a page returning from Google.
mm = mm.replace(
    "    methods: { google: { available: true, clientId }, passkey: { available: true } },\n",
    "    methods: { google: { available: true, clientId }, passkey: { available: true } },\n    googleReturn: true,\n",
) if "    googleReturn: true,\n" not in mm else mm
(ROOT / MM).write_text(mm, encoding='utf-8')

# New behaviour tests (own file, so a pre-existing file-level failure elsewhere
# cannot hide them).
NEW_TEST = ROOT / 'google-redirect-login.test.mjs'
NEW_TEST_SRC = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// Owner 2026-10-17: "Continue with Google" is a full-page redirect straight to
// accounts.google.com on admissionsky.pages.dev. No popup, no direct GSI, no
// Firebase page in between; in-app browsers are sent to Chrome instead.
const script = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, async json() { return body; } });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, timeout = 1500) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (predicate()) return; await sleep(5); }
  throw new Error('Timed out waiting for UI state.');
}
const SKY = 'https://admissionsky.pages.dev/';
const ANDROID_FB = 'Mozilla/5.0 (Linux; Android 13; SM-A135F Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]';
const IOS_MESSENGER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/470.0;FBBV/1;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.6;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/5]';

function setup({ url = SKY, ua = '', redirectFlag = false, redirectResult = null, redirectError = null, googleReply = null } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url, runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  if (ua) Object.defineProperty(w.navigator, 'userAgent', { value: ua, configurable: true });
  if (redirectFlag) w.sessionStorage.setItem('ah-google-redirect', '1');
  const record = { apps: [], popup: 0, redirect: 0, providers: [], calls: [] };
  w.firebase = {
    apps: [],
    initializeApp(options, name) { const app = { name, options }; this.apps.push(app); record.apps.push(app); return app; },
    auth(app) {
      return {
        app,
        async signInWithPopup() { record.popup += 1; throw new Error('popup must not be used'); },
        async signInWithRedirect(provider) { record.redirect += 1; record.providers.push({ app: app?.name, provider }); },
        async getRedirectResult() {
          if (redirectError) throw redirectError;
          return app?.name === 'ah-google-sky' ? redirectResult : null;
        }
      };
    }
  };
  w.firebase.auth.GoogleAuthProvider = function GoogleAuthProvider() {
    this.scopes = [];
    this.addScope = scope => { this.scopes.push(scope); return this; };
    this.setCustomParameters = params => { this.params = params; return this; };
  };
  w.fetch = async (input, options = {}) => {
    const path = String(input);
    const body = options.body ? JSON.parse(options.body) : null;
    record.calls.push({ path, method: options.method || 'GET', body });
    if (path.includes('/config')) return reply(200, { auth: { available: true, methods: {
      google: { available: true, clientId: '123456789012-exampleclientidentifier.apps.googleusercontent.com' },
      passkey: { available: false }, telegramVerification: { available: false }, backup: { available: false }, emailPassword: { available: true }
    }, verificationEmail: { resendCooldownSeconds: 60 } } });
    if (path.includes('/session') && !path.includes('/session/') && (options.method || 'GET') === 'GET') return reply(401, { error: { code: 'SESSION_INVALID', message: 'সেশন নেই।' } });
    const signedBody = { authenticated: true, created: false, emailVerified: true, user: { id: 'usr-g', emailMasked: 'u***@example.com' } };
    if (path.endsWith('/google')) return googleReply ? googleReply() : reply(200, signedBody);
    if (path.endsWith('/google/link')) return reply(200, signedBody);
    if (path.endsWith('/passkey/status')) return reply(200, { count: 0, credentials: [] });
    return reply(404, { error: { message: 'not found' } });
  };
  w.eval(script);
  const button = () => w.document.querySelector('[data-role="google-button"] button') || w.document.querySelector('[data-role="welcome-google-button"] button');
  const messageText = () => w.document.querySelector('[data-role="message"]')?.textContent || '';
  return { dom, w, document: w.document, record, button, messageText };
}

const TOKEN = `google-access-${'z'.repeat(32)}`;

test('Google uses its own Firebase app on admissionsky.pages.dev and a full-page redirect, never a popup', async () => {
  const app = setup();
  await waitFor(() => app.button());
  app.button().click();
  await waitFor(() => app.record.redirect === 1);
  const sky = app.record.apps.find(item => item.name === 'ah-google-sky');
  assert.ok(sky, 'Google must use the ah-google-sky app');
  assert.equal(sky.options.authDomain, 'admissionsky.pages.dev');
  assert.equal(sky.options.projectId, 'admissionsky-997d2');
  assert.equal(app.record.providers[0].app, 'ah-google-sky');
  assert.deepEqual(app.record.providers[0].provider.scopes, ['email', 'profile']);
  assert.equal(app.record.popup, 0);
  assert.equal(app.record.apps.some(item => item.name === 'ah-google'), false, 'Google must not touch the Facebook app');
  assert.equal(app.w.sessionStorage.getItem('ah-google-redirect'), '1');
  assert.equal(app.document.querySelector('script[src*="accounts.google.com/gsi"]'), null, 'no GSI script');
  app.dom.window.close();
});

test('source: no popup or GSI path for Google; Facebook keeps the firebaseapp.com authDomain', () => {
  assert.doesNotMatch(script, /DIRECT_GOOGLE|initTokenClient|requestAccessToken|accounts\.google\.com\/gsi/);
  assert.match(script, /const GOOGLE_AUTH_DOMAIN = 'admissionsky-997d2\.firebaseapp\.com';/);
  assert.match(script, /firebaseAuthFor\('ah-google', GOOGLE_AUTH_DOMAIN\)/);
  assert.match(script, /firebaseAuthFor\(GOOGLE_SKY_APP, GOOGLE_SKY_HOST\)/);
  assert.match(script, /const GOOGLE_SKY_HOST = 'admissionsky\.pages\.dev';/);
  const google = script.slice(script.indexOf('const startGoogleRedirect'), script.indexOf('const finishOAuthRedirect'));
  assert.doesNotMatch(google, /signInWithPopup/);
  assert.match(google, /beginOAuthRedirect\(auth, provider, true\)/);
});

test('any other host hands Google off to admissionsky.pages.dev with the start flag', async () => {
  const app = setup({ url: 'https://admissionhub.pages.dev/' });
  await waitFor(() => app.button());
  app.button().click();
  await sleep(150);
  assert.equal(app.record.redirect, 0, 'no Firebase redirect from the old host');
  assert.equal(app.record.apps.some(item => item.name === 'ah-google-sky'), false);
  assert.match(script, /const GOOGLE_SKY_URL = `https:\/\/\$\{GOOGLE_SKY_HOST\}\/\?ahGoogle=1`;/);
  assert.match(script, /location\.assign\(GOOGLE_SKY_URL\)/);
  app.dom.window.close();
});

test('?ahGoogle=1 on admissionsky.pages.dev starts the Google redirect and cleans the URL', async () => {
  const app = setup({ url: `${SKY}?ahGoogle=1` });
  await waitFor(() => app.record.redirect === 1, 2500);
  assert.equal(app.w.location.search, '');
  assert.equal(app.record.providers[0].app, 'ah-google-sky');
  app.dom.window.close();
});

test('Android in-app browser never starts Google and offers "Chrome-এ খুলুন" plus copy link', async () => {
  const app = setup({ ua: ANDROID_FB });
  await waitFor(() => app.button());
  app.button().click();
  await waitFor(() => app.document.getElementById('ah-google-inapp'));
  assert.equal(app.record.redirect, 0);
  assert.equal(app.record.popup, 0);
  const chrome = app.document.querySelector('[data-role="google-open-chrome"]');
  assert.ok(chrome);
  assert.equal(chrome.getAttribute('href'), 'intent://admissionsky.pages.dev/?ahGoogle=1#Intent;scheme=https;package=com.android.chrome;end');
  assert.match(chrome.textContent, /Chrome-এ খুলুন/);
  assert.ok(app.document.querySelector('[data-role="google-copy-link"]'));
  await waitFor(() => /\[in-app-browser\]/.test(app.messageText()));
  app.document.querySelector('[data-role="google-inapp-close"]').click();
  assert.equal(app.document.getElementById('ah-google-inapp').style.display, 'none');
  app.dom.window.close();
});

test('iPhone Messenger gets the copy-link help, no Android intent, and the bridge reports the code', async () => {
  const app = setup({ ua: IOS_MESSENGER });
  await waitFor(() => app.w.AdmissionSkyBridge);
  const outcome = await app.w.AdmissionSkyBridge.google().then(() => 'resolved', error => error.userMessage || error.message);
  assert.match(outcome, /\[in-app-browser\]/);
  assert.ok(app.document.querySelector('[data-role="google-copy-link"]'));
  assert.equal(app.document.querySelector('[data-role="google-open-chrome"]'), null);
  assert.equal(app.record.redirect, 0);
  await waitFor(() => app.button());
  await sleep(100);
  app.dom.window.close();
});

test('coming back from Google signs in through POST /google and clears the flag', async () => {
  const app = setup({ redirectFlag: true, redirectResult: { user: { uid: 'g' }, credential: { providerId: 'google.com', accessToken: TOKEN } } });
  await waitFor(() => app.record.calls.some(call => call.path.endsWith('/google')), 2500);
  const call = app.record.calls.find(item => item.path.endsWith('/google'));
  assert.deepEqual(call.body, { accessToken: TOKEN });
  await waitFor(() => app.w.AdmissionAccount.isVerified() === true);
  assert.equal(app.w.sessionStorage.getItem('ah-google-redirect'), null);
  assert.equal(app.w.localStorage.length, 0);
  await sleep(100);
  app.dom.window.close();
});

test('ACCOUNT_LINK_REQUIRED after the redirect opens google-link and reuses the same token', async () => {
  const app = setup({
    redirectFlag: true,
    redirectResult: { user: { uid: 'g' }, credential: { providerId: 'google.com', accessToken: TOKEN } },
    googleReply: () => reply(409, { error: { code: 'ACCOUNT_LINK_REQUIRED', message: 'link' } })
  });
  await waitFor(() => app.document.querySelector('[data-view="google-link"]')?.hidden === false, 2500);
  assert.match(app.messageText(), /\[ACCOUNT_LINK_REQUIRED\]/);
  app.document.querySelector('#ah-link-email').value = 'student@example.com';
  app.document.querySelector('#ah-link-password').value = 'password-123';
  app.document.querySelector('[data-view="google-link"]').dispatchEvent(new app.w.Event('submit', { cancelable: true }));
  await waitFor(() => app.record.calls.some(call => call.path.endsWith('/google/link')));
  const link = app.record.calls.find(item => item.path.endsWith('/google/link'));
  assert.deepEqual(link.body, { email: 'student@example.com', password: 'password-123', accessToken: TOKEN });
  assert.equal(app.record.redirect, 0, 'linking must not need a second trip to Google');
  await waitFor(() => app.w.AdmissionAccount.isVerified() === true);
  await sleep(100);
  app.dom.window.close();
});

test('a failed redirect shows the real error code', async () => {
  const app = setup({ redirectFlag: true, redirectError: Object.assign(new Error('net'), { code: 'auth/network-request-failed' }) });
  await waitFor(() => /\[auth\/network-request-failed\]/.test(app.messageText()), 2500);
  await sleep(100);
  app.dom.window.close();
});
'''
if not NEW_TEST.exists() or NEW_TEST.read_text(encoding='utf-8') != NEW_TEST_SRC:
    NEW_TEST.write_text(NEW_TEST_SRC, encoding='utf-8')

edit('package.json', [(
    "facebook-login-guard.test.mjs firebase-google-auth.test.mjs",
    "facebook-login-guard.test.mjs google-redirect-login.test.mjs firebase-google-auth.test.mjs",
)])

print('google redirect patch applied')
