#!/usr/bin/env python3
"""Owner 2026-10-18: "Continue with Telegram" replaces the non-working
"Continue with Facebook" button, and the post-signup Telegram *verification*
choice is removed. Telegram becomes a LOGIN method (oauth.telegram.org signed
payload -> POST /api/auth/v1/telegram/login -> one stable Firebase account per
Telegram user, see auth-native/verification/telegram-login.mjs).

Idempotent. Run from the repo root, then `npm run build:worker` and
`npm run sw:manifest`.
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

TG_SVG = ('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#29A9EB"/>'
          '<path fill="#fff" d="M5.4 11.8l11.6-4.5c.5-.2 1 .1.8.9l-2 9.3c-.1.6-.5.8-1.1.5l-3-2.2-1.4 1.4c-.2.2-.3.3-.6.3l.2-3.1 '
          '5.6-5.1c.2-.2 0-.3-.4-.1l-6.9 4.4-3-.9c-.6-.2-.6-.6.2-.9z"/></svg>')


def edit(rel, pairs, regex=()):
    path = ROOT / rel
    text = path.read_text(encoding='utf-8')
    for old, new in pairs:
        if new in text:
            continue
        if text.count(old) != 1:
            sys.exit(f'{rel}: anchor not found exactly once: {old[:80]!r}')
        text = text.replace(old, new)
    for pattern, new, done_marker in regex:
        if done_marker in text:
            continue
        found = re.findall(pattern, text, flags=re.S)
        if len(found) != 1:
            sys.exit(f'{rel}: pattern not found exactly once: {pattern[:80]!r}')
        text = re.sub(pattern, lambda _m: new, text, count=1, flags=re.S)
    path.write_text(text, encoding='utf-8')


# ---------------------------------------------------------------- server
edit('auth-native/worker/public-auth-handler.mjs', [
    ("import { resolveTelegramWebhookSecret, validTelegramWebhookSecret } from '../verification/telegram-security.mjs';\n",
     "import { resolveTelegramWebhookSecret, validTelegramWebhookSecret } from '../verification/telegram-security.mjs';\n"
     "import { isTelegramLoginEmail, reservedTelegramLoginEmail, telegramLoginBotId, telegramLoginCredentials, telegramLoginReady, verifyTelegramLogin } from '../verification/telegram-login.mjs';\n"),
    ("  const telegramVerified = !user.emailVerified && !ownershipProven\n    && await telegramVerificationStatus({ env, user, context, allowed: allowTelegram });\n",
     "  // A \"Continue with Telegram\" account is proven by Telegram's signature at\n"
     "  // login; its derived address can never receive mail, so it counts as verified.\n"
     "  const telegramLoginAccount = !user.emailVerified && !ownershipProven && await isTelegramLoginEmail(user.email, env);\n"
     "  const telegramVerified = telegramLoginAccount || (!user.emailVerified && !ownershipProven\n"
     "    && await telegramVerificationStatus({ env, user, context, allowed: allowTelegram }));\n"),
    ("        if (isDisposableEmail(input.email)) throw new NativeAuthError(AUTH_ERROR_CODES.DISPOSABLE_EMAIL);\n",
     "        if (isDisposableEmail(input.email)) throw new NativeAuthError(AUTH_ERROR_CODES.DISPOSABLE_EMAIL);\n"
     "        if (reservedTelegramLoginEmail(input.email)) throw new NativeAuthError(AUTH_ERROR_CODES.DISPOSABLE_EMAIL);\n"),
    ("              facebook,\n",
     "              facebook,\n"
     "              telegramLogin: available && telegramLoginReady(env)\n"
     "                ? { available: true, botId: telegramLoginBotId(env) }\n"
     "                : { available: false },\n"),
    ("      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/facebook`) {\n",
     "      // Owner 2026-10-18: \"Continue with Telegram\" login.\n"
     "      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/telegram/login`) {\n"
     "        if (!provider.configured || !telegramLoginReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_UNAVAILABLE);\n"
     "        authStage = 'CREDENTIAL_INPUT';\n"
     "        let telegramUser;\n"
     "        try { telegramUser = await verifyTelegramLogin(await readJson(request), env); }\n"
     "        catch { throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID); }\n"
     "        authStage = 'RATE_CHECK';\n"
     "        await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'telegram-login' }, context });\n"
     "        const credentials = await telegramLoginCredentials(telegramUser.id, env);\n"
     "        authStage = 'FIREBASE_EXCHANGE';\n"
     "        let signed;\n"
     "        try { signed = await provider.signIn(credentials.email, credentials.password); }\n"
     "        catch (signInCause) {\n"
     "          try { signed = await provider.signUp(credentials.email, credentials.password); }\n"
     "          catch (cause) {\n"
     "            if (String(cause?.reason || '').startsWith('EMAIL_EXISTS')) throw providerError(signInCause, 'telegram-signin');\n"
     "            throw providerError(cause, 'telegram-signup');\n"
     "          }\n"
     "        }\n"
     "        authStage = 'IDENTITY_LOOKUP';\n"
     "        let user;\n"
     "        try { user = await provider.lookup(signed.idToken); } catch (cause) { throw providerError(cause, 'telegram-lookup'); }\n"
     "        assertProviderUser(signed, user);\n"
     "        authStage = 'ACCOUNT_SESSION';\n"
     "        const established = await callAuthority(env, '/internal/firebase/session/create', {\n"
     "          input: { email: user.email, subject: user.subject, verified: true },\n"
     "          context\n"
     "        });\n"
     "        // Telegram -> auto profile name (best effort, never blocks the login).\n"
     "        const enrichment = seedGoogleProfile(env, context, established, { ...user, displayName: telegramUser.displayName, photoUrl: '' }).catch(() => {});\n"
     "        if (typeof executionContext?.waitUntil === 'function') executionContext.waitUntil(enrichment);\n"
     "        else await enrichment;\n"
     "        const result = authSuccess(request, established, signed.refreshToken, context, { emailVerified: false, telegramVerified: true });\n"
     "        result.headers.set('X-AH-Auth-Stage', 'SESSION_CREATED');\n"
     "        return result;\n"
     "      }\n\n"
     "      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/facebook`) {\n"),
])

edit('auth-native/core/auth-engine.mjs', [
    ("  'password-reset': Object.freeze([\n",
     "  // POST /telegram/login (owner 2026-10-18) asks for its own slot.\n"
     "  'telegram-login': Object.freeze([\n"
     "    Object.freeze({ scope: 'firebase-telegram-ip-15m', source: 'ip', limit: 60, windowMs: 15 * 60 * 1000 }),\n"
     "    Object.freeze({ scope: 'firebase-telegram-device-15m', source: 'device', limit: 30, windowMs: 15 * 60 * 1000 }),\n"
     "    Object.freeze({ scope: 'firebase-telegram-global-minute', source: 'global', limit: 180, windowMs: 60 * 1000 })\n"
     "  ]),\n"
     "  'password-reset': Object.freeze([\n"),
])

# ---------------------------------------------------------------- client
TG_DIV = ('<div class="ah-account-telegram ah-welcome-telegram" data-role="welcome-telegram-button" hidden>'
          '<button class="ah-account-secondary" type="button" aria-label="Continue with Telegram">'
          f'<span class="ah-telegram-logo" aria-hidden="true">{TG_SVG}</span><span>Continue with Telegram</span>'
          '<b aria-hidden="true">→</b></button></div>')

CLIENT_FNS = r"""  /* Owner 2026-10-18: "Continue with Telegram" (replaces Facebook). The
   * browser goes to oauth.telegram.org for the official bot and comes back to
   * /?tgLogin=1 with Telegram's signed payload; the Worker checks the signature. */
  const TELEGRAM_LOGIN_FLAG = 'ah-telegram-login-pending';
  const TELEGRAM_LOGIN_KEYS = ['tgLogin', 'id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date', 'hash'];
  const telegramLoginPayload = () => {
    let payload = null;
    const fragment = String(location.hash || '');
    const marker = fragment.indexOf('tgAuthResult=');
    if (marker !== -1) {
      try {
        let raw = decodeURIComponent(fragment.slice(marker + 13).split('&')[0]).replace(/-/g, '+').replace(/_/g, '/');
        while (raw.length % 4) raw += '=';
        const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
        payload = JSON.parse(new TextDecoder().decode(bytes));
      } catch (_) { payload = null; }
    }
    const query = new URLSearchParams(location.search);
    if (!payload && query.get('id') && query.get('hash')) {
      payload = {};
      for (const key of TELEGRAM_LOGIN_KEYS.slice(1)) if (query.has(key)) payload[key] = query.get(key);
    }
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  };
  const finishTelegramLogin = async () => {
    let pending = false;
    try { pending = sessionStorage.getItem(TELEGRAM_LOGIN_FLAG) === '1'; sessionStorage.removeItem(TELEGRAM_LOGIN_FLAG); } catch (_) {}
    const returned = new URLSearchParams(location.search).get('tgLogin') === '1' || String(location.hash || '').includes('tgAuthResult=');
    if (!returned) return;
    const payload = telegramLoginPayload();
    try {
      const url = new URL(location.href);
      for (const key of TELEGRAM_LOGIN_KEYS) url.searchParams.delete(key);
      history.replaceState(history.state, '', url.pathname + url.search);
    } catch (_) {}
    if (accountVerified(state.session)) return;
    if (!payload) {
      if (pending) { open(); message('Telegram login was not completed. Please try again.', 'error'); }
      return;
    }
    setBusy(true);
    try {
      const result = await api('/telegram/login', { method: 'POST', body: payload });
      await establishSession(result, 'Signed in with Telegram.');
      landOnDashboard();
    } catch (error) {
      open();
      message(error?.code ? friendlyError(error) : 'Telegram login failed. Please try again.', 'error');
    } finally { setBusy(false); }
  };
  const signInWithTelegram = () => {
    const botId = String(state.capabilities.telegramLogin?.botId || '');
    if (state.busy || !state.capabilities.telegramLogin?.available || !/^\d{5,15}$/.test(botId)) return false;
    const origin = location.origin;
    try { sessionStorage.setItem(TELEGRAM_LOGIN_FLAG, '1'); } catch (_) {}
    const params = new URLSearchParams({ bot_id: botId, origin, embed: '0', request_access: 'write', return_to: `${origin}/?tgLogin=1` });
    location.assign(`https://oauth.telegram.org/auth?${params.toString()}`);
    return true;
  };

  const linkGoogle = async (email, password) => {
"""

edit('account-access.js', [
    ("    state.capabilities.telegram = { available: methods.telegramVerification?.available === true };\n",
     "    /* Owner 2026-10-18: Telegram is a LOGIN method now; the post-signup\n"
     "     * Telegram verification choice is removed. */\n"
     "    state.capabilities.telegram = { available: false };\n"
     "    state.capabilities.telegramLogin = {\n"
     "      available: methods.telegramLogin?.available === true && /^\\d{5,15}$/.test(String(methods.telegramLogin?.botId || '')),\n"
     "      botId: String(methods.telegramLogin?.botId || '')\n"
     "    };\n"),
    ("    const facebookHost = $('[data-role=\"welcome-facebook-button\"]');\n    if (facebookHost) {\n      facebookHost.hidden = !state.capabilities.facebook.available;\n    }\n",
     "    const telegramHost = $('[data-role=\"welcome-telegram-button\"]');\n    if (telegramHost) {\n      telegramHost.hidden = !state.capabilities.telegramLogin.available;\n    }\n"),
    ("    $('[data-role=\"welcome-facebook-button\"] button')?.addEventListener('click', () => signInWithFacebook());\n",
     "    $('[data-role=\"welcome-telegram-button\"] button')?.addEventListener('click', () => signInWithTelegram());\n"),
    ("  const linkGoogle = async (email, password) => {\n", CLIENT_FNS),
    ("      await finishOAuthRedirect();\n      if (accountVerified(state.session)) return;\n",
     "      await finishOAuthRedirect();\n      await finishTelegramLogin();\n      if (accountVerified(state.session)) return;\n"),
    ("      facebook: Boolean(state.capabilities.facebook?.available),\n",
     "      facebook: Boolean(state.capabilities.facebook?.available),\n"
     "      telegramLogin: Boolean(state.capabilities.telegramLogin?.available),\n"),
    ("    passkey: async () => {\n      if (!passkeyBrowserReady()) return false;\n",
     "    telegram: async () => signInWithTelegram(),\n"
     "    passkey: async () => {\n      if (!passkeyBrowserReady()) return false;\n"),
], regex=[
    (r'<div class="ah-account-facebook ah-welcome-facebook" data-role="welcome-facebook-button" hidden>.*?</button></div>',
     TG_DIV, 'data-role="welcome-telegram-button" hidden>'),
])

edit('account-access.css', [], regex=[])
css = ROOT / 'account-access.css'
css_text = css.read_text(encoding='utf-8')
if '.ah-welcome-telegram{' not in css_text:
    css_text = css_text.rstrip('\n') + '\n' + (
        '/* Owner 2026-10-18: Continue with Telegram (replaces Facebook). */\n'
        '.ah-welcome-telegram{position:relative;z-index:3;width:min(calc(100% - 32px),760px);margin:10px auto 0;box-sizing:border-box}\n'
        '.ah-welcome-telegram .ah-account-secondary{min-height:56px;width:100%;display:grid;grid-template-columns:34px 1fr 25px;align-items:center;gap:6px;margin:0;padding:0 16px;border:1px solid #dbe5e1;border-radius:17px;background:var(--ah-surface);color:var(--ah-ink-mid);box-shadow:0 8px 20px rgba(26,68,57,.06);font-family:inherit;font-size:14px;font-weight:850;cursor:pointer}\n'
        '.ah-welcome-telegram .ah-account-secondary>b{font-size:21px;font-weight:500;text-align:right}\n'
        '.ah-telegram-logo{width:30px;display:grid;place-items:center}.ah-telegram-logo svg{width:24px;height:24px;display:block}\n')
    css.write_text(css_text, encoding='utf-8')

# Welcome Story (the first screen): Google | Telegram.
edit('welcome-story.js', [
    ("so.children[1].addEventListener('click',async()=>{const b=bridge();if(!b)return flash('প্রিভিউ — পরের ধাপে যুক্ত হবে');try{const ok=await b.facebook();if(!ok)flash('Facebook এখন প্রস্তুত নয়')}catch(_){flash('Facebook দিয়ে প্রবেশ করা গেল না')}});",
     "so.children[1].addEventListener('click',async()=>{const b=bridge();if(!b)return flash('প্রিভিউ — পরের ধাপে যুক্ত হবে');try{const ok=b.telegram?await b.telegram():false;if(!ok)flash('Telegram এখন প্রস্তুত নয়')}catch(_){flash('Telegram দিয়ে প্রবেশ করা গেল না')}});"),
], regex=[
    (r'<button class="b" type="button"><i><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#1877F2"/>.*?</svg></i>Facebook</button>',
     f'<button class="b" type="button"><i>{TG_SVG}</i>Telegram</button>', '</i>Telegram</button>'),
])

# Sky flow: Facebook tile -> Telegram tile; Telegram verification choice removed.
edit('sky-onboarding.js', [
    ("  $('sky-b-fb').addEventListener('click', () => provider('Facebook', 'ফেসবুকের সাথে যুক্ত হচ্ছি…', api => api.facebook()));",
     "  $('sky-b-fb').addEventListener('click', () => provider('Telegram', 'টেলিগ্রামে যাচ্ছি…', api => (api.telegram ? api.telegram() : false)));"),
    ('<button class="mc" data-m="telegram" type="button">',
     '<button class="mc" data-m="telegram" type="button" hidden style="display:none">'),
], regex=[
    (r'<button class="tile" id="sky-b-fb" type="button"><svg viewBox="0 0 24 24">\s*<circle cx="12" cy="12" r="11" fill="#1877F2"/>.*?<span>Facebook</span></button>',
     f'<button class="tile" id="sky-b-fb" type="button">{TG_SVG}<span>Telegram</span></button>', '<span>Telegram</span></button>'),
])
print('telegram login patch applied')
