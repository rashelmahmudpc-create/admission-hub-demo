#!/usr/bin/env python3
"""Owner 2026-10-18: "Continue with WhatsApp" login, free-tier design.

The student sends a pre-filled, signed start code to our WhatsApp number; the
Meta webhook replies (free service message) with a 10-minute login link; the
app posts that link token to POST /api/auth/v1/whatsapp/login. Everything is
OFF until all WHATSAPP_* secrets exist (see whatsapp-login.mjs), so applying
this patch changes nothing live by itself.

Idempotent. Run from the repo root, then `npm run build:worker` and
`npm run sw:manifest`.
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
            sys.exit(f'{rel}: anchor not found exactly once: {old[:90]!r}')
        text = text.replace(old, new)
    path.write_text(text, encoding='utf-8')


def before(anchor, insert):
    return (anchor, insert + anchor)


def after(anchor, insert):
    return (anchor, anchor + insert)


# ------------------------------------------------------------------ server
TG_IMPORT = "import { isTelegramLoginEmail, reservedTelegramLoginEmail, telegramLoginBotId, telegramLoginCredentials, telegramLoginReady, verifyTelegramLogin } from '../verification/telegram-login.mjs';\n"
WA_IMPORT = ("import { createWhatsAppStart, handleWhatsAppWebhook, isWhatsAppLoginEmail, reservedWhatsAppLoginEmail, "
             "verifyWhatsAppLoginToken, whatsappLoginCredentials, whatsappLoginReady, whatsappVerifyChallenge } "
             "from '../verification/whatsapp-login.mjs';\n")

WA_WEBHOOK = r"""      // Owner 2026-10-18: "Continue with WhatsApp" — Meta Cloud API webhook.
      // GET = Meta's "Verify and save" handshake; POST = signed inbound messages.
      if (url.pathname === `${AUTH_API_PREFIX}/whatsapp/webhook` && (request.method === 'GET' || request.method === 'POST')) {
        if (!whatsappLoginReady(env)) return json(request, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'পাওয়া যায়নি।' } });
        if (request.method === 'GET') {
          const challenge = whatsappVerifyChallenge(url, env);
          if (!challenge) return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
          return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
        }
        const declared = Number(request.headers.get('Content-Length') || 0);
        if (declared > 256 * 1024) return json(request, 413, { ok: false });
        const raw = await request.text();
        if (raw.length > 256 * 1024) return json(request, 413, { ok: false });
        const outcome = await handleWhatsAppWebhook(raw, request.headers.get('X-Hub-Signature-256'), env, { fetchImpl });
        if (outcome.forbidden) return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
        return json(request, 200, { ok: true });
      }

"""

WA_ROUTES = r"""      // Owner 2026-10-18: "Continue with WhatsApp" — start link + login link.
      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/whatsapp/start`) {
        if (!provider.configured || !whatsappLoginReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.WHATSAPP_LOGIN_UNAVAILABLE);
        await readJson(request);
        authStage = 'RATE_CHECK';
        await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'whatsapp-login' }, context });
        const start = await createWhatsAppStart(env);
        return json(request, 200, { ok: true, url: start.url });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/whatsapp/login`) {
        if (!provider.configured || !whatsappLoginReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.WHATSAPP_LOGIN_UNAVAILABLE);
        authStage = 'CREDENTIAL_INPUT';
        let whatsappUser;
        try { whatsappUser = await verifyWhatsAppLoginToken((await readJson(request))?.token, env); }
        catch { throw new NativeAuthError(AUTH_ERROR_CODES.WHATSAPP_LOGIN_INVALID); }
        authStage = 'RATE_CHECK';
        await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'whatsapp-login' }, context });
        const credentials = await whatsappLoginCredentials(whatsappUser.phone, env);
        authStage = 'FIREBASE_EXCHANGE';
        let signed;
        try { signed = await provider.signIn(credentials.email, credentials.password); }
        catch (signInCause) {
          try { signed = await provider.signUp(credentials.email, credentials.password); }
          catch (cause) {
            if (String(cause?.reason || '').startsWith('EMAIL_EXISTS')) throw providerError(signInCause, 'whatsapp-signin');
            throw providerError(cause, 'whatsapp-signup');
          }
        }
        authStage = 'IDENTITY_LOOKUP';
        let user;
        try { user = await provider.lookup(signed.idToken); } catch (cause) { throw providerError(cause, 'whatsapp-lookup'); }
        assertProviderUser(signed, user);
        authStage = 'ACCOUNT_SESSION';
        const established = await callAuthority(env, '/internal/firebase/session/create', {
          input: { email: user.email, subject: user.subject, verified: true },
          context
        });
        // WhatsApp profile name -> auto profile name (best effort, never blocks the login).
        const enrichment = seedGoogleProfile(env, context, established, { ...user, displayName: whatsappUser.displayName, photoUrl: '' }).catch(() => {});
        if (typeof executionContext?.waitUntil === 'function') executionContext.waitUntil(enrichment);
        else await enrichment;
        // A messenger-proven account: reported like Telegram so session refresh
        // (isWhatsAppLoginEmail below) and the client treat it the same way.
        const result = authSuccess(request, established, signed.refreshToken, context, { emailVerified: false, telegramVerified: true });
        result.headers.set('X-AH-Auth-Stage', 'SESSION_CREATED');
        return result;
      }

"""

edit('auth-native/worker/public-auth-handler.mjs', [
    after(TG_IMPORT, WA_IMPORT),
    ("  const telegramLoginAccount = !user.emailVerified && !ownershipProven && await isTelegramLoginEmail(user.email, env);\n",
     "  // \"Continue with WhatsApp\" accounts (owner 2026-10-18) are proven the same way.\n"
     "  const telegramLoginAccount = !user.emailVerified && !ownershipProven\n"
     "    && (await isTelegramLoginEmail(user.email, env) || await isWhatsAppLoginEmail(user.email, env));\n"),
    after("      `${AUTH_API_PREFIX}/telegram/webhook`,\n      `${AUTH_API_PREFIX}/telegram/canary/activate`,\n",
          "      `${AUTH_API_PREFIX}/whatsapp/webhook`,\n"),
    before("      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/telegram/webhook`) {\n", WA_WEBHOOK),
    before("              telegramLogin: available && telegramLoginReady(env)\n",
           "              whatsappLogin: available && whatsappLoginReady(env) ? { available: true } : { available: false },\n"),
    after("        if (reservedTelegramLoginEmail(input.email)) throw new NativeAuthError(AUTH_ERROR_CODES.DISPOSABLE_EMAIL);\n",
          "        if (reservedWhatsAppLoginEmail(input.email)) throw new NativeAuthError(AUTH_ERROR_CODES.DISPOSABLE_EMAIL);\n"),
    before('      // Owner 2026-10-18: "Continue with Telegram" login.\n', WA_ROUTES),
])

edit('auth-native/core/auth-engine.mjs', [
    before("  // POST /telegram/login (owner 2026-10-18) asks for its own slot.\n",
           "  // POST /whatsapp/start + /whatsapp/login (owner 2026-10-18) share one slot.\n"
           "  'whatsapp-login': Object.freeze([\n"
           "    Object.freeze({ scope: 'firebase-whatsapp-ip-15m', source: 'ip', limit: 60, windowMs: 15 * 60 * 1000 }),\n"
           "    Object.freeze({ scope: 'firebase-whatsapp-device-15m', source: 'device', limit: 30, windowMs: 15 * 60 * 1000 }),\n"
           "    Object.freeze({ scope: 'firebase-whatsapp-global-minute', source: 'global', limit: 180, windowMs: 60 * 1000 })\n"
           "  ]),\n"),
])

edit('auth-native/core/errors.mjs', [
    after("  TELEGRAM_VERIFICATION_INVALID: 'TELEGRAM_VERIFICATION_INVALID',\n",
          "  WHATSAPP_LOGIN_UNAVAILABLE: 'WHATSAPP_LOGIN_UNAVAILABLE',\n"
          "  WHATSAPP_LOGIN_INVALID: 'WHATSAPP_LOGIN_INVALID',\n"),
    before("  [AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE]: Object.freeze(",
           "  [AUTH_ERROR_CODES.WHATSAPP_LOGIN_UNAVAILABLE]: Object.freeze({ status: 503, message: 'WhatsApp দিয়ে প্রবেশ এখন পাওয়া যাচ্ছে না—অন্য পদ্ধতি ব্যবহার করুন।' }),\n"
           "  [AUTH_ERROR_CODES.WHATSAPP_LOGIN_INVALID]: Object.freeze({ status: 401, message: 'WhatsApp লগইন লিংকটি সঠিক নয় বা ১০ মিনিট পেরিয়ে গেছে—আবার \"Continue with WhatsApp\" চাপুন।' }),\n"),
])

# ------------------------------------------------------------------ client
CLIENT_FNS = r"""  /* Owner 2026-10-18: "Continue with WhatsApp". The student sends the
   * pre-filled code from WhatsApp; our reply carries /?waLogin=<token>. */
  const finishWhatsAppLogin = async () => {
    const token = new URLSearchParams(location.search).get('waLogin');
    if (!token) return;
    try {
      const url = new URL(location.href);
      url.searchParams.delete('waLogin');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    } catch (_) {}
    if (accountVerified(state.session)) return;
    setBusy(true);
    try {
      const result = await api('/whatsapp/login', { method: 'POST', body: { token } });
      await establishSession(result, 'Signed in with WhatsApp.');
      landOnDashboard();
    } catch (error) {
      open();
      message(error?.code ? friendlyError(error) : 'WhatsApp login failed. Please try again.', 'error');
    } finally { setBusy(false); }
  };
  const signInWithWhatsApp = async () => {
    if (state.busy || !state.capabilities.whatsappLogin?.available) return false;
    const result = await api('/whatsapp/start', { method: 'POST', body: {} });
    const target = String(result?.url || '');
    if (!/^https:\/\/wa\.me\/\d{8,15}\?text=/.test(target)) return false;
    location.assign(target);
    return true;
  };
"""

edit('account-access.js', [
    before("    state.capabilities.emailOwnership = { available: methods.emailOwnership?.available === true };\n",
           "    state.capabilities.whatsappLogin = { available: methods.whatsappLogin?.available === true };\n"),
    before("  const signInWithTelegram = () => {\n", CLIENT_FNS),
    after("      await finishTelegramLogin();\n", "      await finishWhatsAppLogin();\n"),
    after("      telegramLogin: Boolean(state.capabilities.telegramLogin?.available),\n",
          "      whatsappLogin: Boolean(state.capabilities.whatsappLogin?.available),\n"),
    after("    telegram: async () => signInWithTelegram(),\n", "    whatsapp: async () => signInWithWhatsApp(),\n"),
])

# Welcome Story (first screen): a hidden WhatsApp button under Google | Telegram,
# shown only when the server reports whatsappLogin.available.
WA_SVG = ('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#25D366"/>'
          '<path fill="#fff" d="M16.6 13.9c-.2-.1-1.4-.7-1.6-.8-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1-.7-.3-1.4-.7-2-1.3-.5-.5-1-1.1-1.3-1.7-.1-.2 0-.4.1-.5l.4-.4.2-.4v-.4l-.7-1.7c-.2-.4-.4-.4-.5-.4h-.4c-.2 0-.4.1-.6.3-.6.6-.8 1.3-.8 2.1.1.9.4 1.7.9 2.4 1 1.5 2.3 2.7 3.9 3.4.4.2.9.3 1.3.4.5.1 1 .1 1.4 0 .6-.1 1.1-.5 1.4-1 .1-.3.2-.6.1-.9-.1 0-.3-.1-.5-.2z"/></svg>')
WA_BUTTON = f'<button class="b" type="button" data-wa-login style="display:none;grid-column:1/-1;flex-basis:100%"><i>{WA_SVG}</i>WhatsApp</button>'
WA_STORY_JS = ("\n{const wa=so.querySelector('[data-wa-login]');if(wa){"
               "wa.addEventListener('click',async()=>{const b=bridge();if(!b)return flash('প্রিভিউ — পরের ধাপে যুক্ত হবে');"
               "try{const ok=b.whatsapp?await b.whatsapp():false;if(!ok)flash('WhatsApp এখন প্রস্তুত নয়')}catch(_){flash('WhatsApp দিয়ে প্রবেশ করা গেল না')}});"
               "let tries=0;const reveal=async()=>{const b=bridge();if(b&&b.capabilities){try{const c=await b.capabilities();"
               "if(c&&c.whatsappLogin){wa.style.display='';return}}catch(_){}}if(++tries<20)setTimeout(reveal,1500)};reveal()}}")

edit('welcome-story.js', [
    ("</i>Telegram</button></div>", f"</i>Telegram</button>{WA_BUTTON}</div>"),
    before("\n$('auth').querySelector('.b.g').addEventListener('click'", WA_STORY_JS),
])
print('whatsapp login patch applied')
