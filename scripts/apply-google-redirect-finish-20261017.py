#!/usr/bin/env python3
"""After the Google/Facebook full-page redirect comes back and POST /google
succeeds, finish the login exactly like the old popup path did through
AdmissionSkyBridge.finish(): hide the Sky flow, close the account page, fire
admissionhub:authchange (the dashboard loads the user's data on it) and forget
any half-finished signup, so the student lands on the Dashboard instead of
staying on the onboarding / account card (owner report 2026-10-17).

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


HELPER_OLD = (
    "  /* Runs once at boot, and only when a redirect we started is coming back, so\n"
    "   * an ordinary load never pays for the getRedirectResult round-trip. */\n"
    "  const finishOAuthRedirect = async () => {\n"
)
HELPER_NEW = (
    "  /* Owner 2026-10-17: a redirect login must end on the Dashboard. The popup\n"
    "   * path got there through AdmissionSkyBridge.finish() (Sky flow hidden, page\n"
    "   * closed, authchange fired); after a redirect the page is fresh and nothing\n"
    "   * called it, so the student stayed on the onboarding / account card and the\n"
    "   * Dashboard never loaded their data. Do the same here, and forget a\n"
    "   * half-finished signup so it cannot pull the next login back into it. */\n"
    "  const finishRedirectLogin = () => {\n"
    "    const mount = document.getElementById('ah-sky-flow');\n"
    "    if (mount) mount.hidden = true;\n"
    "    delete pageHost.dataset.skyFlow;\n"
    "    state.signupJourney = false;\n"
    "    rememberPendingSignup(false);\n"
    "    message();\n"
    "    close();\n"
    "    notify();\n"
    "  };\n"
    "\n"
    "  /* Runs once at boot, and only when a redirect we started is coming back, so\n"
    "   * an ordinary load never pays for the getRedirectResult round-trip. */\n"
    "  const finishOAuthRedirect = async () => {\n"
)
CALL_OLD = (
    "        const r = await api('/google', { method: 'POST', body: { accessToken } });\n"
    "        await establishSession(r, 'Google \\u09a6\\u09bf\\u09af\\u09bc\\u09c7 \\u09a4\\u09cb\\u09ae\\u09be\\u09b0 account-\\u098f \\u09aa\\u09cd\\u09b0\\u09ac\\u09c7\\u09b6 \\u09b9\\u09af\\u09bc\\u09c7\\u099b\\u09c7\\u0964');\n"
    "      }\n"
    "    } catch (error) {\n"
)
CALL_NEW = (
    "        const r = await api('/google', { method: 'POST', body: { accessToken } });\n"
    "        await establishSession(r, 'Google \\u09a6\\u09bf\\u09af\\u09bc\\u09c7 \\u09a4\\u09cb\\u09ae\\u09be\\u09b0 account-\\u098f \\u09aa\\u09cd\\u09b0\\u09ac\\u09c7\\u09b6 \\u09b9\\u09af\\u09bc\\u09c7\\u099b\\u09c7\\u0964');\n"
    "      }\n"
    "      if (accountVerified(state.session)) finishRedirectLogin();\n"
    "    } catch (error) {\n"
)
edit('account-access.js', [(HELPER_OLD, HELPER_NEW), (CALL_OLD, CALL_NEW)])

TEST = 'google-redirect-login.test.mjs'
T_OLD = (
    "  await waitFor(() => app.w.AdmissionAccount.isVerified() === true);\n"
    "  assert.equal(app.w.sessionStorage.getItem('ah-google-redirect'), null);\n"
)
T_NEW = (
    "  await waitFor(() => app.w.AdmissionAccount.isVerified() === true);\n"
    "  assert.equal(app.w.sessionStorage.getItem('ah-google-redirect'), null);\n"
    "  await waitFor(() => app.document.body.classList.contains('ah-account-page-active') === false);\n"
    "  assert.ok(authEvents(app).some(detail => detail.authenticated === true), 'the Dashboard must be told about the login');\n"
)
H_OLD = "const TOKEN = `google-access-${'z'.repeat(32)}`;\n"
H_NEW = (
    "const TOKEN = `google-access-${'z'.repeat(32)}`;\n"
    "const authEvents = app => app.w.__authEvents || [];\n"
)
S_OLD = "  if (redirectFlag) w.sessionStorage.setItem('ah-google-redirect', '1');\n"
S_NEW = (
    "  if (redirectFlag) w.sessionStorage.setItem('ah-google-redirect', '1');\n"
    "  w.__authEvents = [];\n"
    "  w.addEventListener('admissionhub:authchange', event => w.__authEvents.push(event.detail));\n"
)
P_OLD = "test('ACCOUNT_LINK_REQUIRED after the redirect opens google-link and reuses the same token', async () => {\n"
P_NEW = (
    "test('a half-finished signup does not trap a returning Google login on the onboarding screen', async () => {\n"
    "  const app = setup({ redirectFlag: true, pendingSignup: true, redirectResult: { user: { uid: 'g' }, credential: { providerId: 'google.com', accessToken: TOKEN } } });\n"
    "  await waitFor(() => app.w.AdmissionAccount.isVerified() === true, 2500);\n"
    "  await waitFor(() => app.document.body.classList.contains('ah-account-page-active') === false);\n"
    "  assert.equal(/ah_signup_pending_v1=[a-z]/.test(app.document.cookie), false);\n"
    "  assert.ok(authEvents(app).some(detail => detail.authenticated === true));\n"
    "  await sleep(100);\n"
    "  app.dom.window.close();\n"
    "});\n"
    "\n"
    + P_OLD
)
SIG_OLD = "function setup({ url = SKY, ua = '', redirectFlag = false, redirectResult = null, redirectError = null, googleReply = null } = {}) {\n"
SIG_NEW = "function setup({ url = SKY, ua = '', redirectFlag = false, redirectResult = null, redirectError = null, googleReply = null, pendingSignup = false } = {}) {\n"
C_OLD = "  if (ua) Object.defineProperty(w.navigator, 'userAgent', { value: ua, configurable: true });\n"
C_NEW = (
    "  if (ua) Object.defineProperty(w.navigator, 'userAgent', { value: ua, configurable: true });\n"
    "  if (pendingSignup) w.document.cookie = 'ah_signup_pending_v1=select; Path=/';\n"
)
edit(TEST, [(H_OLD, H_NEW), (S_OLD, S_NEW), (SIG_OLD, SIG_NEW), (C_OLD, C_NEW), (T_OLD, T_NEW), (P_OLD, P_NEW)])
print('google redirect finish patch applied')
