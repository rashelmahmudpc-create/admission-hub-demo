#!/usr/bin/env python3
"""Auth fixes 2026-10-15 (owner-approved): OTP timeout, Google/Facebook landing,
Facebook email verification, redirect fallback message, login back button,
same-origin Firebase auth helper proxy. Idempotent: skips when already applied."""
import sys

MARK = 'slowSend'


def patch(path, pairs):
    s = open(path, encoding='utf-8').read()
    for old, new in pairs:
        if s.count(old) != 1:
            sys.exit(f'{path}: anchor not found exactly once: {old[:70]!r}')
        s = s.replace(old, new)
    open(path, 'w', encoding='utf-8').write(s)


def patch_after(path, after, old, new):
    s = open(path, encoding='utf-8').read()
    i = s.find(after)
    if i < 0 or s.count(after) != 1:
        sys.exit(f'{path}: start anchor missing: {after!r}')
    j = s.find(old, i)
    if j < 0:
        sys.exit(f'{path}: anchor not found after {after!r}')
    s = s[:j] + new + s[j + len(old):]
    open(path, 'w', encoding='utf-8').write(s)


def preflight():
    checks = {
        'account-access.js': ["Math.min(18000, Math.max(2000, Number(options.timeoutMs) || 18000));", "    } else if (showSetup) showView('security-setup');", "try { result = await auth.getRedirectResult(); } catch (_) { return; }", "    if (/Android|iPhone|iPad|iPod/i.test(ua)) return false;", 'data-role="forgot-back"]\').addEventListener'],
        'auth-native/worker/public-auth-handler.mjs': ["if (!user.emailVerified) throw new NativeAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);"],
        'auth-native/verification/orchestrator.mjs': ['async function bounded('],
        'auth-native/providers/firebase-auth.mjs': ['async #facebookSignIn(input'],
        '_worker.js': ['    const url = new URL(request.url);'],
    }
    for path, needles in checks.items():
        text = open(path, encoding='utf-8').read()
        for needle in needles:
            if needle not in text:
                sys.exit(f'preflight: {path} missing {needle[:60]!r}')


if MARK in open('account-access.js', encoding='utf-8').read():
    print('already applied')
    sys.exit(0)
preflight()

patch('account-access.js', [
("""    const timeoutMs = Math.min(18000, Math.max(2000, Number(options.timeoutMs) || 18000));""",
"""    /* OTP / verification sends walk the provider chain on the server (a cold
     * Apps Script mailer alone can take ~11s), so an 18s ceiling aborted sends
     * that the server then completed: the "sometimes the OTP never comes" bug.
     * Those paths get a 45s ceiling; everything else keeps 18s. */
    const slowSend = /\\/(email-ownership|telegram\\/verification|account-verification\\/email|backup)\\/(start|resend)(\\?|$)/.test(String(path || ''));
    const ceiling = slowSend ? 45000 : 18000;
    const timeoutMs = Math.min(ceiling, Math.max(2000, Number(options.timeoutMs) || ceiling));"""),
("""    } else if (showSetup) showView('security-setup');
    else {
      showView('signed');
      updateTrustPrompt();
    }""",
"""    } else if (showSetup) showView('security-setup');
    else {
      showView('signed');
      updateTrustPrompt();
      /* A finished login (Google, Facebook, Email, Passkey) must land on the
       * Dashboard, not on the account card (owner report 2026-10-15: "after
       * Continue with Google it stays on the same page"). A saved return
       * destination is handled by restoreReturnDestination() below. */
      if (!state.returnDestination) {
        try { close(); } catch (_) {}
      }
    }"""),
("""    let result = null;
    try { result = await auth.getRedirectResult(); } catch (_) { return; }
    const accessToken = String(result?.credential?.accessToken || '');
    if (!result?.user || accessToken.length < 20) return;""",
"""    let result = null;
    let redirectError = null;
    try { result = await auth.getRedirectResult(); } catch (error) { redirectError = error; }
    const accessToken = String(result?.credential?.accessToken || '');
    if (!result?.user || accessToken.length < 20) {
      /* The redirect came back empty: the browser blocked the authDomain's
       * storage (Safari / Chrome third-party storage partitioning) or the user
       * backed out. Say so instead of silently leaving them on the same page. */
      open();
      showView('login');
      message(redirectError?.code === 'auth/account-exists-with-different-credential'
        ? 'এই Email অন্য পদ্ধতিতে খোলা আছে—আগের পদ্ধতি দিয়ে ঢুকো।'
        : 'লগইন সম্পন্ন হয়নি—আবার চেষ্টা করো। বারবার হলে Chrome/Safari-এ সাইটটি খুলে চেষ্টা করো বা Email দিয়ে ঢুকো।', 'error');
      return;
    }"""),
("""    if (/Android|iPhone|iPad|iPod/i.test(ua)) return false;
    return true;""",
"""    /* Ordinary mobile Chrome/Safari keep the popup: with the authDomain on
     * firebaseapp.com, a redirect's result is lost to third-party storage
     * partitioning, while the popup returns through postMessage. Only in-app
     * browsers and installed PWAs take the redirect, and a dead popup still
     * falls back to it (popupDead). */
    return true;"""),
("""<p class="ah-login-sub">তোমার preparation যেখানে থেমেছিল, সেখান থেকেই শুরু করো।</p>""",
"""<p class="ah-login-sub">তোমার preparation যেখানে থেমেছিল, সেখান থেকেই শুরু করো।</p><button class="ah-account-link ah-calm-back" type="button" data-role="login-back">← পেছনে</button>"""),
("""    $('[data-role="forgot-back"]').addEventListener('click', () => { prefillLogin($('#ah-forgot-email').value); showView('login'); });""",
"""    $('[data-role="forgot-back"]').addEventListener('click', () => { prefillLogin($('#ah-forgot-email').value); showView('login'); });
    $('[data-role="login-back"]')?.addEventListener('click', () => { if (state.busy) return; message(); showWelcome(); });"""),
])

patch_after('auth-native/providers/firebase-auth.mjs', 'async #facebookSignIn(input',
"""    if (!validToken(payload?.idToken) || !validToken(payload?.refreshToken) || !validSubject(payload?.localId) || typeof payload?.email !== 'string' || payload?.emailVerified !== true) {
      throw new FirebaseRequestError('INVALID_PROVIDER_RESPONSE');
    }
    return Object.freeze({
      idToken: payload.idToken,
      refreshToken: payload.refreshToken,
      subject: payload.localId,
      email: payload.email,
      emailVerified: true,""",
"""    // Firebase never marks a facebook.com email as verified (Facebook is not an
    // email-trusted IdP), so requiring emailVerified here rejected EVERY
    // Facebook login. The /facebook route proves the address through the Graph
    // API instead, which only returns an email Facebook has confirmed.
    if (!validToken(payload?.idToken) || !validToken(payload?.refreshToken) || !validSubject(payload?.localId) || typeof payload?.email !== 'string' || !payload.email) {
      throw new FirebaseRequestError('INVALID_PROVIDER_RESPONSE');
    }
    return Object.freeze({
      idToken: payload.idToken,
      refreshToken: payload.refreshToken,
      subject: payload.localId,
      email: payload.email,
      emailVerified: payload.emailVerified === true,""")

patch('auth-native/worker/public-auth-handler.mjs', [
("""        if (!user.providers.includes('facebook.com')) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
        if (!user.emailVerified) throw new NativeAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);""",
"""        if (!user.providers.includes('facebook.com')) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
        if (!user.emailVerified) {
          // Firebase leaves facebook.com emails unverified by design. Accept the
          // address only when Facebook itself returns the same confirmed email
          // for this access token (Graph /me only exposes confirmed emails).
          let facebookUser = null;
          try { facebookUser = await provider.facebookIdentity(credential.accessToken); } catch {}
          if (!facebookUser || normalizeAuthEmail(facebookUser.email) !== normalizeAuthEmail(user.email)) {
            throw new NativeAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
          }
        }"""),
])

patch('auth-native/verification/orchestrator.mjs', [
("""async function bounded(""", """const PROBE_TIMEOUT_MS = 5000;

async function bounded("""),
("""          bounded(() => provider.checkAvailability({ purpose: identity.purpose }), entry.timeoutMs),
          bounded(() => provider.getRemainingQuota({ now }), entry.timeoutMs),""",
"""          // Readiness probes run for every slot before a single send, so a slow
          // probe delayed the whole OTP past the browser's patience. Probes get
          // a short ceiling; the send itself keeps the slot's full timeoutMs.
          bounded(() => provider.checkAvailability({ purpose: identity.purpose }), Math.min(entry.timeoutMs, PROBE_TIMEOUT_MS)),
          bounded(() => provider.getRemainingQuota({ now }), Math.min(entry.timeoutMs, PROBE_TIMEOUT_MS)),"""),
])

patch('_worker.js', [
("""    const url = new URL(request.url);
""",
"""    const url = new URL(request.url);

    /* Firebase Auth helper (/__/auth/handler, /__/auth/iframe, init.json) served
     * same-origin, so the authDomain can become this site once
     * https://admissionsky.pages.dev/__/auth/handler is an authorised redirect
     * URI for the Google and Facebook OAuth clients. */
    if (url.pathname.startsWith('/__/auth/') || url.pathname === '/__/firebase/init.json') {
      const upstream = new URL(url.pathname + url.search, 'https://admissionsky-997d2.firebaseapp.com');
      const init = { method: request.method, headers: request.headers, redirect: 'manual' };
      if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
      return fetch(upstream, init);
    }
"""),
])
print('applied')
