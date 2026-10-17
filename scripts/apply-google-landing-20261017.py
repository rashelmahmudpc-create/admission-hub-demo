#!/usr/bin/env python3
"""After a Google/Facebook redirect sign-in, land on the Dashboard (owner
2026-10-17: "Continue with Google" signed in, but the page stayed on the Sky
signup/onboarding flow).

Cause: on the return trip finishOAuthRedirect() called open() BEFORE the
sign-in, which routes to the Sky flow; the Sky script loads late on a cold page
and its reveal() re-opened the account page after the session was already
established. Nothing closed the Sky flow (the popup path used to call
AdmissionSkyBridge.finish()).

Fix: no open() before a successful sign-in; after it, landOnDashboard() cancels
pending Sky launches, hides the flow, ends any pending signup journey and closes
the account page; a late Sky reveal() is ignored once a redirect sign-in landed.
Errors still open the page and show the message with its code.

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


JS = 'account-access.js'
edit(JS, [
    # 1. success path: no open() before the sign-in (it routes to the Sky flow).
    ("      if (providerId === 'facebook.com') {\n        open();\n        const r = await api('/facebook'",
     "      if (providerId === 'facebook.com') {\n        const r = await api('/facebook'"),
    ("      } else if (providerId === 'google.com') {\n        open();\n        state.googleLinkToken = '';\n",
     "      } else if (providerId === 'google.com') {\n        state.googleLinkToken = '';\n"),
    # 2. ...and land on the Dashboard once the session is established.
    ("');\n      }\n    } catch (error) {\n      if (providerId === 'google.com') {\n",
     "');\n      }\n      landOnDashboard();\n    } catch (error) {\n      open();\n      if (providerId === 'google.com') {\n"),
    # 3. the helper.
    ("  const dismiss = () => {\n",
     "  /* Owner 2026-10-17: a finished Google/Facebook redirect sign-in must land on\n"
     "   * the Dashboard, not stay on the Sky signup flow. Cancels a Sky launch still\n"
     "   * waiting for its script, hides the flow, ends a pending signup journey and\n"
     "   * closes the account page; reveal() ignores a late Sky open afterwards. */\n"
     "  const landOnDashboard = () => {\n"
     "    if (!accountVerified(state.session)) return;\n"
     "    state.oauthLanded = true;\n"
     "    skyWaitToken += 1;\n"
     "    state.signupJourney = false;\n"
     "    rememberPendingSignup(false);\n"
     "    const mount = document.getElementById('ah-sky-flow');\n"
     "    if (mount) mount.hidden = true;\n"
     "    delete pageHost.dataset.skyFlow;\n"
     "    close();\n"
     "    try { notify(); } catch (_) {}\n"
     "  };\n"
     "  const dismiss = () => {\n"),
    # 4. a late Sky reveal() must not cover the Dashboard after the landing.
    ("    reveal(node) {\n      const mount = skyMount();\n",
     "    reveal(node) {\n"
     "      if (state.oauthLanded && accountVerified(state.session)) return;\n"
     "      const mount = skyMount();\n"),
])

TEST = 'google-redirect-login.test.mjs'
edit(TEST, [
    ("function setup({ url = SKY, ua = '', redirectFlag = false, redirectResult = null, redirectError = null, googleReply = null } = {}) {\n"
     "  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url, runScripts: 'dangerously', pretendToBeVisual: true });\n"
     "  const w = dom.window;\n",
     "function setup({ url = SKY, ua = '', redirectFlag = false, redirectResult = null, redirectError = null, googleReply = null, cookie = '' } = {}) {\n"
     "  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url, runScripts: 'dangerously', pretendToBeVisual: true });\n"
     "  const w = dom.window;\n"
     "  if (cookie) w.document.cookie = cookie;\n"),
])
NEW_TEST = r'''
test('a Google redirect sign-in lands on the Dashboard even from the signup flow, and a late Sky open is ignored', async () => {
  const app = setup({
    cookie: 'ah_signup_pending_v1=select; Path=/',
    redirectFlag: true,
    redirectResult: { user: { uid: 'g' }, credential: { providerId: 'google.com', accessToken: TOKEN } }
  });
  await waitFor(() => app.w.AdmissionAccount.isVerified() === true, 2500);
  await waitFor(() => !app.document.body.classList.contains('ah-account-page-active'), 2500);
  assert.doesNotMatch(app.document.cookie, /ah_signup_pending_v1=select/, 'the pending signup journey must end');
  // sky-onboarding.js loads late on a cold page; its reveal() must not cover the Dashboard.
  app.w.AdmissionSkyBridge.reveal();
  assert.equal(app.document.body.classList.contains('ah-account-page-active'), false);
  const mount = app.document.getElementById('ah-sky-flow');
  assert.ok(!mount || mount.hidden === true);
  await sleep(100);
  app.dom.window.close();
});
'''
path = ROOT / TEST
text = path.read_text(encoding='utf-8')
if 'lands on the Dashboard even from the signup flow' not in text:
    path.write_text(text.rstrip('\n') + '\n' + NEW_TEST, encoding='utf-8')

print('google landing patch applied')
