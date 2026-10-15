#!/usr/bin/env python3
"""Owner-approved 2026-10-16 auth + onboarding UX fix. Idempotent.
1 old onboarding retired (every entry view opens the Sky flow)  2 existing-email
signup message + timeouts  3 Facebook/Google errors visible in Sky  4 direct Google
(GSI) with Firebase fallback  5 OTP: non-Gmail recipients prefer the real-Gmail /
AgentMail senders, resend rotates provider  6 welcome layout clip  7 iOS top-colour
sync + zoom lock  8 privacy / data-deletion pages  9 asset version bump."""
import pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent

def rd(p): return (ROOT / p).read_text(encoding='utf-8')
def wr(p, s): (ROOT / p).write_text(s, encoding='utf-8')
def rep(p, old, new, marker, count=1):
    s = rd(p)
    if marker in s: return
    n = s.count(old)
    if n != count: sys.exit(f'ANCHOR NOT FOUND in {p} (found {n}, want {count}): {old[:90]!r}')
    wr(p, s.replace(old, new))

AA = 'account-access.js'
# 1. retire legacy entry views
rep(AA, "  const showView = (name, keepMessage = false) => {\n    state.currentView = name;", r"""  let skyRouteHook = null;
  const SKY_ROUTED_VIEWS = new Set(['login', 'signup', 'forgot', 'verify', 'telegram', 'email-ownership', 'email-intro', 'telegram-intro', 'created', 'google-link', 'whatsapp-info']);
  /* Owner 2026-10-16: the old sign-in / sign-up screens are retired. Every entry
   * view opens the Admission Sky flow; renderView only draws them in the bare
   * test harness, where sky-onboarding.js is not on the page. */
  const showView = (name, keepMessage = false) => {
    if (SKY_ROUTED_VIEWS.has(name) && skyRouteHook && skyRouteHook(name)) return;
    return renderView(name, keepMessage);
  };
  const renderView = (name, keepMessage = false) => {
    state.currentView = name;""", 'SKY_ROUTED_VIEWS')

rep(AA, """  const showLegacyEntry = mode => {
    const welcome = pageHost.querySelector('.ah-welcome-view');
    if (welcome) welcome.classList.add('ah-welcome-live');
    if (mode === 'signup') {
      state.signupJourney = true;
      state.signupStep = 'personal';
      showView('signup');
    } else {
      state.signupJourney = false;
      state.pendingProfile = null;
      state.profileBound = false;
      showView('login');
    }
  };""", """  const showLegacyEntry = mode => {
    if (skyScriptLinked()) {
      showWelcome();
      message('নতুন সাইন-ইন পেজটি লোড হয়নি—পেজটি একবার refresh করো।', 'error');
      return;
    }
    const welcome = pageHost.querySelector('.ah-welcome-view');
    if (welcome) welcome.classList.add('ah-welcome-live');
    if (mode === 'signup') {
      state.signupJourney = true;
      state.signupStep = 'personal';
      renderView('signup');
    } else {
      state.signupJourney = false;
      state.pendingProfile = null;
      state.profileBound = false;
      renderView('login');
    }
  };""", "নতুন সাইন-ইন পেজটি লোড হয়নি")

rep(AA, "window.AdmissionSkyFlow.open(mode))", "window.AdmissionSkyFlow.open(mode, takeSkyEntry()))", 'takeSkyEntry()))')

rep(AA, "  const open = options => {\n    const forceWelcome = options?.forceWelcome === true;", r"""  const takeSkyEntry = () => { const entry = state.skyEntry || {}; state.skyEntry = null; return entry; };
  skyRouteHook = name => {
    if (!skyScriptLinked()) return false;
    const mode = name === 'signup' ? 'signup' : 'login';
    const resume = ['verify', 'telegram', 'email-ownership', 'email-intro', 'telegram-intro', 'created'].includes(name) ? 'verify' : '';
    state.skyEntry = { resume, email: String(state.verification?.email || '') };
    state.currentView = 'sky';
    pageHost.dataset.currentView = 'sky';
    setAccountPageActive(true);
    openSky(mode);
    return true;
  };
  const open = options => {
    const forceWelcome = options?.forceWelcome === true;""", 'skyRouteHook = name =>')

rep(AA, "  const message = (text = '', kind = 'info') => {\n    const node = $('[data-role=\"message\"]');", r"""  const message = (text = '', kind = 'info') => {
    if (text && (state.currentView === 'sky' || document.getElementById('ah-account-page')?.dataset.skyFlow === 'on')) {
      state.skyPendingNotice = { text, kind };
      try { window.AdmissionSkyFlow?.notice?.(text, kind); } catch (_) {}
    }
    const node = $('[data-role="message"]');""", 'state.skyPendingNotice = { text, kind }')

# 3. errors carry a user message
rep(AA, "  const friendlyError = error => {\n    const known = {", r"""  const friendlyError = error => {
    if (typeof error?.userMessage === 'string' && error.userMessage.trim()) return error.userMessage.trim();
    if (!error?.code && typeof error?.message === 'string' && /[\u0980-\u09FF]/.test(error.message)) return error.message;
    const known = {
      ACCOUNT_LINK_REQUIRED: 'এই ইমেইলে আগে ইমেইল-পাসওয়ার্ড দিয়ে অ্যাকাউন্ট খোলা হয়েছে—ইমেইল ও পাসওয়ার্ড দিয়ে সাইন ইন করো।',""", 'error.userMessage.trim()) return')

rep(AA, """      } catch (error) {
        message(facebookMessage(error), 'error');
        return false;
      }
      if (accessToken === OAUTH_REDIRECT) return true;
      const result = await skyApi('/facebook', { method: 'POST', body: { accessToken } });""", """      } catch (error) {
        const failure = new Error(error?.message || facebookMessage(error));
        failure.userMessage = error?.userMessage || error?.message || facebookMessage(error);
        throw failure;
      }
      if (accessToken === OAUTH_REDIRECT) return true;
      let result;
      try {
        result = await skyApi('/facebook', { method: 'POST', body: { accessToken } });
      } catch (error) {
        if (error?.code === 'EMAIL_NOT_VERIFIED') error.userMessage = 'তোমার Facebook অ্যাকাউন্টে নিশ্চিত করা কোনো ইমেইল নেই—ইমেইল দিয়ে সাইন আপ করো।';
        throw error;
      }""", 'failure.userMessage = error?.userMessage')

# 4. direct Google
rep(AA, "  const googleAccessToken = async () => {", r"""  /* Owner 2026-10-16: Google signs in DIRECTLY through Google Identity Services
   * on our own origin (the owner's OAuth client), so the consent screen no longer
   * shows the long Firebase authDomain. The Firebase path stays as the automatic
   * fallback: GSI missing, in-app browser, or the backend refusing the external
   * client's token until it is safelisted in Firebase. */
  const DIRECT_GOOGLE_CLIENT_ID = '203304845427-lpfj17ponue2bjapvt8mnl7tioupar27.apps.googleusercontent.com';
  const DIRECT_GOOGLE_OFF = 'ah-google-direct-off';
  let gsiTokenClient = null;
  let gsiPending = null;
  const directGoogleOff = () => { try { return sessionStorage.getItem(DIRECT_GOOGLE_OFF) === '1'; } catch (_) { return false; } };
  const prepareDirectGoogle = () => {
    if (gsiTokenClient || directGoogleOff()) return;
    loadScriptOnce('https://accounts.google.com/gsi/client').then(() => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (!oauth2 || gsiTokenClient) return;
      gsiTokenClient = oauth2.initTokenClient({
        client_id: DIRECT_GOOGLE_CLIENT_ID,
        scope: 'openid email profile',
        callback: reply => {
          const pending = gsiPending; gsiPending = null;
          if (!pending) return;
          if (reply?.access_token) pending.resolve(String(reply.access_token));
          else pending.reject(Object.assign(new Error('gsi-denied'), { gsiType: String(reply?.error || 'access_denied') }));
        },
        error_callback: failure => {
          const pending = gsiPending; gsiPending = null;
          if (pending) pending.reject(Object.assign(new Error('gsi-failed'), { gsiType: String(failure?.type || 'failed') }));
        }
      });
    }).catch(() => {});
  };
  const directGoogleToken = () => new Promise((resolve, reject) => {
    if (!gsiTokenClient) { reject(new Error('gsi-not-ready')); return; }
    gsiPending = { resolve, reject };
    try { gsiTokenClient.requestAccessToken(); } catch (error) { gsiPending = null; reject(error); }
  });
  const googleSignInRequest = async () => {
    if (gsiTokenClient && !directGoogleOff() && oauthPopupSupported()) {
      let token = '';
      try { token = await directGoogleToken(); } catch (error) {
        if (error?.gsiType === 'popup_closed' || error?.gsiType === 'access_denied') {
          const text = googleMessage({ code: 'auth/popup-closed-by-user' });
          throw Object.assign(new Error(text), { userMessage: text });
        }
      }
      if (token.length >= 20) {
        try { return await api('/google', { method: 'POST', body: { accessToken: token } }); } catch (error) {
          if (!['GOOGLE_UNAVAILABLE', 'INVALID_INPUT', 'AUTH_PROVIDER_UNAVAILABLE', 'INVALID_PROVIDER_RESPONSE'].includes(String(error?.code || ''))) throw error;
          try { sessionStorage.setItem(DIRECT_GOOGLE_OFF, '1'); } catch (_) {}
        }
      }
    }
    const accessToken = await googleAccessToken();
    if (accessToken === OAUTH_REDIRECT) return OAUTH_REDIRECT;
    return api('/google', { method: 'POST', body: { accessToken } });
  };

  const googleAccessToken = async () => {""", 'DIRECT_GOOGLE_CLIENT_ID')

rep(AA, """      const accessToken = await googleAccessToken();
      if (accessToken === OAUTH_REDIRECT) return;
      const result = await api('/google', { method: 'POST', body: { accessToken } });""", """      const result = await googleSignInRequest();
      if (result === OAUTH_REDIRECT) return;""", "if (result === OAUTH_REDIRECT) return;")

rep(AA, "    if (state.googlePromise) return state.googlePromise;\n    if (clientId) state.googleClientId = clientId;",
    "    prepareDirectGoogle();\n    if (state.googlePromise) return state.googlePromise;\n    if (clientId) state.googleClientId = clientId;", "    prepareDirectGoogle();\n")

rep(AA, """    google: async () => {
      const accessToken = await googleAccessToken();
      if (accessToken === OAUTH_REDIRECT) return true;
      const result = await skyApi('/google', { method: 'POST', body: { accessToken } });""", """    google: async () => {
      const result = await googleSignInRequest();
      if (result === OAUTH_REDIRECT) return true;""", "      const result = await googleSignInRequest();\n      if (result === OAUTH_REDIRECT) return true;")

rep(AA, "    friendly: friendlyError,\n    mount: skyMount,", "    friendly: friendlyError,\n    takeNotice() { const pending = state.skyPendingNotice; state.skyPendingNotice = null; return pending || null; },\n    mount: skyMount,", 'takeNotice()')

# 2. Sky flow
SK = 'sky-onboarding.js'
rep(SK, "const bridge = () => window.AdmissionSkyBridge || null;", r"""const bridge = () => window.AdmissionSkyBridge || null;
const within = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => {
  const error = new Error('সংযোগ খুব ধীর—আবার চেষ্টা করো।');
  error.userMessage = error.message;
  reject(error);
}, ms))]);""", 'const within = ')
rep(SK, "const fail = text => {\n  const hint = $('sky-ot-h');", "const fail = text => {\n  const hint = (host() && host().querySelector('.scr.on .hint')) || $('sky-ot-h');", ".scr.on .hint')) || $('sky-ot-h')")
rep(SK, r"""    const result = await api.signup(state.email, state.pw, {
      fullName: state.name.trim().replace(/\s+/g, ' '),
      dob: dobValue(),
      school: state.inst.school,
      higherInstitution: state.inst.college
    });""", r"""    const result = await within(api.signup(state.email, state.pw, {
      fullName: state.name.trim().replace(/\s+/g, ' '),
      dob: dobValue(),
      school: state.inst.school,
      higherInstitution: state.inst.college
    }), 30000);""", 'await within(api.signup(')
rep(SK, """  } catch (error) {
    if (button) button.classList.remove('busy');
    setBusy(false);
    fail(api.friendly ? api.friendly(error) : 'অ্যাকাউন্ট তৈরি করা যায়নি—আবার চেষ্টা করো।');
  }""", """  } catch (error) {
    if (button) button.classList.remove('busy');
    setBusy(false);
    if (error && error.code === 'EMAIL_ALREADY_IN_USE') {
      const existing = state.email;
      go(3);
      setTimeout(() => {
        const hint = $('sky-em-h');
        if (!hint) return;
        hint.className = 'hint err';
        hint.textContent = 'এই ইমেইলে আগে থেকেই অ্যাকাউন্ট আছে। ';
        const link = document.createElement('button');
        link.type = 'button';
        link.textContent = 'সাইন ইন করো →';
        link.style.cssText = 'border:0;background:none;color:var(--p);font-weight:700;padding:0;text-decoration:underline';
        link.addEventListener('click', () => open('login', { email: existing }));
        hint.append(link);
      }, 60);
      talk('এই ইমেইলে আগে থেকেই অ্যাকাউন্ট আছে!');
      mood('sad'); kick('shake');
      setTimeout(() => mood(''), 1200);
      return;
    }
    fail(api.friendly ? api.friendly(error) : 'অ্যাকাউন্ট তৈরি করা যায়নি—আবার চেষ্টা করো।');
  }""", "error.code === 'EMAIL_ALREADY_IN_USE'")
rep(SK, "    const result = await api.login(state.email, state.pw);", "    const result = await within(api.login(state.email, state.pw), 30000);", 'within(api.login(')
rep(SK, "state.method === 'telegram' ? await api.startTelegram() : await api.startEmail()",
    "await within(state.method === 'telegram' ? api.startTelegram() : api.startEmail(), 60000)", "api.startEmail(), 60000)", count=2)
rep(SK, "const open = async mode => {", "const open = async (mode, opts = {}) => {", 'const open = async (mode, opts = {})')
rep(SK, """  built = false;
  state.method = 'email';
  api.reveal(root);
  build();
  markMethod();
  go(0);
  return true;
};""", """  built = false;
  state.method = 'email';
  api.reveal(root);
  build();
  markMethod();
  const presetEmail = String((opts && opts.email) || '');
  if (presetEmail) {
    const field = $(state.mode === 'login' ? 'sky-lin-em' : 'sky-in-em');
    if (field) { field.value = presetEmail; field.dispatchEvent(new Event('input')); }
    state.email = presetEmail;
  }
  go(state.mode === 'login' && opts && opts.resume === 'verify' ? 2 : 0);
  const pending = api.takeNotice ? api.takeNotice() : null;
  if (pending && pending.text) notice(pending.text, pending.kind);
  return true;
};

const notice = (text, kind) => {
  if (!text) return;
  const hint = host() && host().querySelector('.scr.on .hint');
  if (hint) { hint.className = kind === 'error' ? 'hint err' : 'hint ok'; hint.textContent = text; }
  else talk(text);
};""", 'const presetEmail')
rep(SK, "window.AdmissionSkyFlow = Object.freeze({ open, close,", "window.AdmissionSkyFlow = Object.freeze({ open, close, notice,", '{ open, close, notice,')

# 5. OTP routing
OR = 'auth-native/verification/orchestrator.mjs'
rep(OR, "const PROBE_TIMEOUT_MS = 5000;", """const PROBE_TIMEOUT_MS = 5000;

// Owner 2026-10-16: iCloud / Yahoo / Outlook mailboxes did not receive codes that
// Brevo (top slot) accepted. For those recipients prefer otp-b (Apps Script,
// sends from the real Gmail account) then otp-e (AgentMail, own signed domain).
// Gmail recipients keep the operator order. A resend demotes the slot that
// carried the previous code so each retry goes out through a different sender.
const NON_GMAIL_FREEMAIL = new Set(['icloud.com', 'me.com', 'mac.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'ymail.com', 'rocketmail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'aol.com']);
const NON_GMAIL_PREFERENCE = Object.freeze({ 'otp-b': -15, 'otp-e': -30 });
function recipientBias(providerId, email) {
  const domain = String(email || '').trim().toLowerCase().split('@').pop();
  return NON_GMAIL_FREEMAIL.has(domain) ? (NON_GMAIL_PREFERENCE[providerId] || 0) : 0;
}""", 'function recipientBias')
rep(OR, "score: entry.priority + lowPenalty + failurePenalty + latencyPenalty",
    "score: entry.priority + lowPenalty + failurePenalty + latencyPenalty + recipientBias(entry.id, destinations.otp) + (identity.previousProviderId && identity.previousProviderId === entry.id ? 25 : 0)", 'recipientBias(entry.id, destinations.otp)')
rep(OR, "    const destinations = identity.destinations;\n    const candidates = await this.#candidateRows({ ...identity, attemptId }, destinations, now);", """    let previousProviderId = '';
    try {
      const prior = await this.repository.getPendingChallenge({
        userId: identity.userId, sessionRef: identity.sessionRef, subjectRef: identity.subjectRef,
        emailRef: identity.emailRef, deviceRef: identity.deviceRef, purpose: identity.purpose, now
      });
      previousProviderId = String(prior?.challenge?.providerId || '');
    } catch {}
    const destinations = identity.destinations;
    const candidates = await this.#candidateRows({ ...identity, attemptId, previousProviderId }, destinations, now);""", 'let previousProviderId')

# 6. welcome layout: story never spills over the CTA / top bar
rep('welcome-story.js', "Math.min(r.width/390,r.height/640)", "Math.min(r.width/390,r.height/668)", 'r.height/668')
s = rd('welcome-story.css')
if 'owner-2026-10-16-clip' not in s:
    wr('welcome-story.css', s + "\n/* owner-2026-10-16-clip: zoomed scenes, the tab bar and captions overflowed .fit\n   and slid under Get Started on small phones. Clip to the band, fade the edges. */\n#ah-welcome-story .band{overflow:hidden;-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 10px,#000 calc(100% - 14px),transparent 100%);mask-image:linear-gradient(180deg,transparent 0,#000 10px,#000 calc(100% - 14px),transparent 100%)}\n")

# 7. iOS chrome colour + zoom lock
(ROOT / 'ios-chrome.js').write_text(r"""/* Owner 2026-10-16: keep the phone's status-bar / notch area the same colour as
 * whatever screen is on top, and stop pinch / double-tap zoom and sideways drag
 * (iOS ignores user-scalable=no). */
(() => {
  'use strict';
  const css = document.createElement('style');
  css.id = 'ah-ios-chrome';
  css.textContent = 'html{touch-action:manipulation;overflow-x:hidden}body{touch-action:manipulation;overflow-x:clip;overscroll-behavior:none;max-width:100%}';
  document.head.append(css);
  const stop = event => event.preventDefault();
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(type => document.addEventListener(type, stop, { passive: false }));
  document.addEventListener('touchmove', event => { if (event.touches && event.touches.length > 1) event.preventDefault(); }, { passive: false });
  const opaque = colour => colour && colour !== 'transparent' && !/rgba\([^)]*,\s*0(\.0+)?\)$/.test(colour);
  const hex = colour => {
    const parts = String(colour).match(/[\d.]+/g);
    if (!parts || parts.length < 3) return '';
    return '#' + parts.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(+v))).toString(16).padStart(2, '0')).join('');
  };
  const topColour = () => {
    let el = document.elementFromPoint(Math.round(innerWidth / 2), 2);
    while (el && el !== document.documentElement) {
      const bg = getComputedStyle(el).backgroundColor;
      if (opaque(bg)) return bg;
      el = el.parentElement;
    }
    return document.body ? getComputedStyle(document.body).backgroundColor : '';
  };
  let last = '';
  const sync = () => {
    try {
      const value = hex(topColour());
      if (!value || value === last) return;
      last = value;
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.append(meta); }
      meta.setAttribute('content', value);
      document.documentElement.style.backgroundColor = value;
      if (document.body) document.body.style.backgroundColor = value;
    } catch (_) {}
  };
  ['load', 'resize', 'hashchange', 'popstate', 'pageshow', 'orientationchange'].forEach(type => addEventListener(type, () => setTimeout(sync, 60)));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  setInterval(sync, 700);
  sync();
})();
""", encoding='utf-8')
rep('index.html', '<script defer src="./account-access.js?v=20261015-safearea1"></script>',
    '<script defer src="./account-access.js?v=20261015-safearea1"></script>\n<script defer src="./ios-chrome.js?v=1"></script>', 'ios-chrome.js?v=1')

# 8. legal pages for the Facebook app review
PAGE = """<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{t} — Admission Hub</title><style>body{{font-family:system-ui,'Noto Sans Bengali',sans-serif;max-width:760px;margin:0 auto;padding:24px 18px 60px;line-height:1.7;color:#0B1B3A}}h1{{font-size:24px}}h2{{font-size:18px;margin-top:26px}}</style></head><body><h1>{t}</h1><p>সর্বশেষ হালনাগাদ: ১৬ অক্টোবর ২০২৬ · Last updated: 16 October 2026</p>{b}<p>যোগাযোগ / Contact: <a href="mailto:rashelmahmudpc@gmail.com">rashelmahmudpc@gmail.com</a></p></body></html>"""
(ROOT / 'privacy.html').write_text(PAGE.format(t='Privacy Policy · গোপনীয়তা নীতি', b="""<h2>আমরা কী তথ্য নিই</h2><p>অ্যাকাউন্ট খুলতে তোমার নাম, ইমেইল, জন্মতারিখ, স্কুল/কলেজ এবং পড়ার অগ্রগতি। Google বা Facebook দিয়ে ঢুকলে শুধু নাম, ইমেইল ও প্রোফাইল ছবি (public_profile, email)। আমরা পাসওয়ার্ড দেখি না; তা Firebase Authentication নিরাপদে রাখে।</p><h2>কেন নিই</h2><p>লগইন, অ্যাকাউন্ট যাচাই (OTP), তোমার পড়ার তথ্য সংরক্ষণ ও নোটিফিকেশনের জন্য। আমরা তথ্য বিক্রি করি না, বিজ্ঞাপনে ব্যবহার করি না।</p><h2>কোথায় থাকে</h2><p>Google Firebase ও Cloudflare-এর সার্ভারে। যাচাইয়ের ইমেইল পাঠাতে ইমেইল সেবাদাতা (যেমন Brevo, Gmail) শুধু তোমার ইমেইল ঠিকানা পায়।</p><h2>তোমার অধিকার</h2><p>যেকোনো সময় তথ্য দেখতে, ঠিক করতে বা মুছতে পারো — <a href="/data-deletion.html">ডেটা মুছে ফেলার নির্দেশনা</a>।</p><h2>English summary</h2><p>Admission Hub collects your name, email, date of birth, institution and study progress to run your account. With Google/Facebook login we receive only your name, email and profile picture. Data is stored with Google Firebase and Cloudflare, never sold or used for advertising. You can request deletion at any time (see the data deletion page).</p>"""), encoding='utf-8')
(ROOT / 'data-deletion.html').write_text(PAGE.format(t='Data Deletion · ডেটা মুছে ফেলা', b="""<h2>কীভাবে ডেটা মুছবে</h2><ol><li>অ্যাপে প্রোফাইল → সেটিংস → অ্যাকাউন্ট থেকে অ্যাকাউন্ট মুছে ফেলো, অথবা</li><li>তোমার অ্যাকাউন্টের ইমেইল থেকে নিচের ঠিকানায় "Delete my Admission Hub account" লিখে মেইল করো।</li></ol><p>৭ দিনের মধ্যে তোমার অ্যাকাউন্ট, প্রোফাইল ও পড়ার সব তথ্য স্থায়ীভাবে মুছে ফেলা হবে এবং ইমেইলে নিশ্চিত করা হবে। Facebook দিয়ে ঢুকে থাকলে Facebook → Settings → Apps and Websites থেকে Admission Hub সরিয়ে দিতে পারো।</p><h2>English</h2><p>To delete your data, delete the account from Profile → Settings → Account in the app, or email us from your account address with "Delete my Admission Hub account". All account, profile and study data is permanently erased within 7 days and you get a confirmation email. Facebook users can also remove Admission Hub under Facebook → Settings → Apps and Websites.</p>"""), encoding='utf-8')

# 9. asset version bump (immutable ?v= cache)
VERS = {'20261015-safearea1': '20261016-authux1', 'sky-flow-20261013-v5': 'sky-flow-20261016-v6', 'welcome-story-20261013-v1': 'welcome-story-20261016-v2'}
for path in ROOT.rglob('*'):
    if not path.is_file() or path.suffix not in ('.html', '.js', '.mjs', '.yml', '.yaml', '.json'): continue
    if any(part in ('node_modules', '.git', 'docs', 'AGENT_RESUME', 'dist') for part in path.parts): continue
    try: s = path.read_text(encoding='utf-8')
    except UnicodeDecodeError: continue
    t = s
    for a, b in VERS.items(): t = t.replace(a, b)
    if t != s: path.write_text(t, encoding='utf-8')
# Resend intentionally rotates away from the recovered previous sender.
rep('verification-orchestrator.test.mjs', '  assert.equal(first.sends.length, 3);', '  assert.equal(first.sends.length, 2); // authux-resend-rotation', 'authux-resend-rotation')
rep('facebook-login-guard.test.mjs', "  const outcome = await app.window.AdmissionSkyBridge.facebook();\n  assert.equal(outcome, false, 'a failed popup must resolve false, not reject');", "  await assert.rejects(app.window.AdmissionSkyBridge.facebook(), error => typeof error.userMessage === 'string' && error.userMessage.length > 0); // authux-visible-facebook-error", 'authux-visible-facebook-error')
print('auth-ux-fix-20261016 applied')
