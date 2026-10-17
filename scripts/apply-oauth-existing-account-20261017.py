#!/usr/bin/env python3
"""Google/Facebook sign-in for an email that already has an Email+Password
account (owner 2026-10-17, screenshot: [ACCOUNT_CONFLICT · ACCOUNT_SESSION]).

Cause: the browser's redirect sign-in (getRedirectResult) creates a NEW Firebase
user for the Google identity before POST /google runs. The server then finds the
email already bound to the older Firebase UID and refuses the session
(ACCOUNT_CONFLICT). Because the Firebase user was not new by the time the server
saw it (signed.isNewUser === false), the throwaway duplicate was never deleted,
and the page fell back to the Welcome screen with the message hidden.

Fix:
 1. Server: a duplicate that has exactly one social provider and was created in
    the last 15 minutes is treated like a new duplicate: deleted, then
    ACCOUNT_LINK_REQUIRED. Older accounts stay a hard ACCOUNT_CONFLICT.
 2. Client: ACCOUNT_LINK_REQUIRED / ACCOUNT_CONFLICT after the redirect opens the
    Login page with the email filled in and one short official message.
 3. Client: the next password login on that page links Google to the existing
    account (POST /google/link), so Google works next time; if linking is not
    possible, it falls back to the normal password login.

Idempotent. Run from the repo root, then `npm run sw:manifest` and
`npm run build:worker`.
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def edit(rel, pairs):
    path = ROOT / rel
    text = path.read_text(encoding='utf-8')
    for old, new, count in pairs:
        if new in text:
            continue
        if text.count(old) != count:
            sys.exit(f'{rel}: anchor found {text.count(old)}x, expected {count}: {old[:70]!r}')
        text = text.replace(old, new)
    path.write_text(text, encoding='utf-8')


MSG = 'এই ইমেইল দিয়ে আগেই একটি অ্যাকাউন্ট খোলা আছে। অনুগ্রহ করে ইমেইল ও পাসওয়ার্ড দিয়ে লগ ইন করুন।'

# ---------------------------------------------------------------- provider
edit('auth-native/providers/firebase-auth.mjs', [
    ("      disabled: user.disabled === true,\n",
     "      disabled: user.disabled === true,\n"
     "      createdAt: Number(user.createdAt) || 0,\n", 1),
])

# ---------------------------------------------------------------- worker
edit('auth-native/worker/public-auth-handler.mjs', [
    ("const googleEndpointReady = env =>",
     "// Owner 2026-10-17: the browser's redirect sign-in creates the Firebase user\n"
     "// before POST /google (or /facebook) runs, so signed.isNewUser is false here.\n"
     "// A single-social-provider account created in the last 15 minutes that our\n"
     "// account store refuses is that same throwaway duplicate.\n"
     "const FRESH_DUPLICATE_MS = 15 * 60 * 1000;\n"
     "const freshSocialDuplicate = (user, now = Date.now()) => {\n"
     "  const providers = Array.isArray(user?.providers) ? user.providers : [];\n"
     "  const age = now - Number(user?.createdAt || 0);\n"
     "  return providers.length === 1 && ['google.com', 'facebook.com'].includes(providers[0])\n"
     "    && Number(user?.createdAt) > 0 && age > -60_000 && age < FRESH_DUPLICATE_MS;\n"
     "};\n"
     "const googleEndpointReady = env =>", 1),
    ("if (cause?.code === AUTH_ERROR_CODES.ACCOUNT_CONFLICT && signed.isNewUser) {",
     "if (cause?.code === AUTH_ERROR_CODES.ACCOUNT_CONFLICT && (signed.isNewUser || freshSocialDuplicate(user))) {", 2),
])

# ---------------------------------------------------------------- client
JS = 'account-access.js'
edit(JS, [
    # 1. after the redirect: an existing account goes to the Login page.
    ("    } catch (error) {\n      open();\n      if (providerId === 'google.com') {\n",
     "    } catch (error) {\n"
     "      if (EXISTING_ACCOUNT_CODES.has(String(error?.code || ''))) {\n"
     "        showExistingAccountLogin(String(result.user?.email || ''),\n"
     "          providerId === 'google.com' && error.code === 'ACCOUNT_LINK_REQUIRED' ? accessToken : '');\n"
     "        return;\n"
     "      }\n"
     "      open();\n"
     "      if (providerId === 'google.com') {\n", 1),
    # 2. the helper.
    ("  const signInWithGoogle = async () => {\n",
     "  /* Owner 2026-10-17: Google/Facebook for an email that already has an\n"
     "   * Email+Password account lands on the Login page with the email filled in\n"
     "   * and one short official line -- never the Welcome screen. The Google token\n"
     "   * stays in memory only, so the next password login also links Google. */\n"
     "  const EXISTING_ACCOUNT_CODES = new Set(['ACCOUNT_LINK_REQUIRED', 'ACCOUNT_CONFLICT']);\n"
     f"  const EXISTING_ACCOUNT_TEXT = '{MSG}';\n"
     "  const showExistingAccountLogin = (email, linkToken = '') => {\n"
     "    state.googleLinkToken = linkToken;\n"
     "    state.oauthLoginEmail = email;\n"
     "    state.signupJourney = false;\n"
     "    rememberPendingSignup(false);\n"
     "    open();\n"
     "    showView('login');\n"
     "    prefillLogin(email);\n"
     "    message(EXISTING_ACCOUNT_TEXT, 'error');\n"
     "  };\n\n"
     "  const signInWithGoogle = async () => {\n", 1),
    # 3. the Sky login screen gets that email.
    ("state.skyEntry = { resume, email: String(state.verification?.email || '') };",
     "state.skyEntry = { resume, email: String(state.verification?.email || state.oauthLoginEmail || '') };", 1),
    # 4. password login on that page links Google first.
    ("    login: async (email, password) => {\n",
     "    login: async (email, password) => {\n"
     "      if (String(state.googleLinkToken || '').length >= 20) {\n"
     "        try {\n"
     "          const linked = await linkGoogle(email, password);\n"
     "          state.oauthLoginEmail = '';\n"
     "          await establishSession(linked, 'তোমার account-এ প্রবেশ হয়েছে। এখন থেকে Google দিয়েও লগ ইন করা যাবে।');\n"
     "          return linked;\n"
     "        } catch (error) {\n"
     "          if (['INVALID_CREDENTIALS', 'RATE_LIMITED', 'ACCOUNT_DISABLED'].includes(String(error?.code || ''))) throw error;\n"
     "          state.googleLinkToken = '';\n"
     "        }\n"
     "      }\n", 1),
])
# ---------------------------------------------------------------- tests
T1 = 'google-redirect-login.test.mjs'
edit(T1, [('test(\'ACCOUNT_LINK_REQUIRED after the redirect opens google-link and reuses the same token\', async () => {\n  const app = setup({\n    redirectFlag: true,\n    redirectResult: { user: { uid: \'g\' }, credential: { providerId: \'google.com\', accessToken: TOKEN } },\n    googleReply: () => reply(409, { error: { code: \'ACCOUNT_LINK_REQUIRED\', message: \'link\' } })\n  });\n  await waitFor(() => app.document.querySelector(\'[data-view="google-link"]\')?.hidden === false, 2500);\n  assert.match(app.messageText(), /\\[ACCOUNT_LINK_REQUIRED\\]/);\n  app.document.querySelector(\'#ah-link-email\').value = \'student@example.com\';\n  app.document.querySelector(\'#ah-link-password\').value = \'password-123\';\n  app.document.querySelector(\'[data-view="google-link"]\').dispatchEvent(new app.w.Event(\'submit\', { cancelable: true }));\n  await waitFor(() => app.record.calls.some(call => call.path.endsWith(\'/google/link\')));\n  const link = app.record.calls.find(item => item.path.endsWith(\'/google/link\'));\n  assert.deepEqual(link.body, { email: \'student@example.com\', password: \'password-123\', accessToken: TOKEN });\n  assert.equal(app.record.redirect, 0, \'linking must not need a second trip to Google\');\n  await waitFor(() => app.w.AdmissionAccount.isVerified() === true);\n  await sleep(100);\n  app.dom.window.close();\n});\n\n', 'test(\'an existing Email+Password account: Login page, email filled, official message, password login links Google\', async () => {\n  const app = setup({\n    redirectFlag: true,\n    redirectResult: { user: { uid: \'g\', email: \'student@example.com\' }, credential: { providerId: \'google.com\', accessToken: TOKEN } },\n    googleReply: () => reply(409, { error: { code: \'ACCOUNT_LINK_REQUIRED\', message: \'link\' } })\n  });\n  await waitFor(() => app.document.querySelector(\'[data-view="login"]\')?.hidden === false, 2500);\n  assert.equal(app.document.body.classList.contains(\'ah-account-page-active\'), true);\n  assert.equal(app.document.querySelector(\'[data-view="welcome"]\')?.hidden !== false, true, \'never the Welcome screen\');\n  assert.equal(app.messageText(), \'এই ইমেইল দিয়ে আগেই একটি অ্যাকাউন্ট খোলা আছে। অনুগ্রহ করে ইমেইল ও পাসওয়ার্ড দিয়ে লগ ইন করুন।\');\n  assert.doesNotMatch(app.messageText(), /\\[|ACCOUNT_/);\n  assert.equal(app.document.querySelector(\'#ah-login-email\').value, \'student@example.com\');\n  await app.w.AdmissionSkyBridge.login(\'student@example.com\', \'password-123\');\n  const link = app.record.calls.find(item => item.path.endsWith(\'/google/link\'));\n  assert.deepEqual(link.body, { email: \'student@example.com\', password: \'password-123\', accessToken: TOKEN });\n  assert.equal(app.record.redirect, 0, \'linking must not need a second trip to Google\');\n  await waitFor(() => app.w.AdmissionAccount.isVerified() === true);\n  await sleep(100);\n  app.dom.window.close();\n});\n\ntest(\'ACCOUNT_CONFLICT after the redirect also lands on the Login page with the same message\', async () => {\n  const app = setup({\n    redirectFlag: true,\n    redirectResult: { user: { uid: \'g\', email: \'student@example.com\' }, credential: { providerId: \'google.com\', accessToken: TOKEN } },\n    googleReply: () => reply(409, { error: { code: \'ACCOUNT_CONFLICT\', message: \'conflict\' } })\n  });\n  await waitFor(() => app.document.querySelector(\'[data-view="login"]\')?.hidden === false, 2500);\n  assert.match(app.messageText(), /^এই ইমেইল দিয়ে আগেই একটি অ্যাকাউন্ট খোলা আছে।/);\n  assert.equal(app.document.querySelector(\'#ah-login-email\').value, \'student@example.com\');\n  await sleep(100);\n  app.dom.window.close();\n});\n\n', 1)])

T2 = 'firebase-google-auth.test.mjs'
edit(T2, [
    ("function googleFetch({ isNewUser = false, deleted = [], deleteFails = false, includeGoogle = true, displayName = undefined, photoUrl = undefined } = {}) {",
     "function googleFetch({ isNewUser = false, deleted = [], deleteFails = false, includeGoogle = true, displayName = undefined, photoUrl = undefined, createdAt = undefined } = {}) {", 1),
    ("        displayName,\n        photoUrl,\n        providerUserInfo: includeGoogle",
     "        displayName,\n        photoUrl,\n        createdAt,\n        providerUserInfo: includeGoogle", 1),
    ("test('duplicate Google cleanup failure stays a hard conflict",
     "test('a duplicate the browser already created (isNewUser false, created just now) is deleted and requires linking', async () => {\n"
     "  const deleted = [];\n"
     "  const authority = new AuthorityMock({ conflict: true });\n"
     "  const handler = createNativeAuthHandler({ fetchImpl: googleFetch({ isNewUser: false, deleted, createdAt: String(Date.now() - 5000) }) });\n"
     "  const result = await handler(request(`${AUTH_API_PREFIX}/google`, { idToken: TOKEN('google-id') }), {\n"
     "    AUTH_AUTHORITY: authority, FIREBASE_WEB_API_KEY: API_KEY, GOOGLE_AUTH_ACTIVATION: 'enabled'\n"
     "  });\n"
     "  assert.equal(result.status, 409);\n"
     "  assert.equal((await result.json()).error.code, AUTH_ERROR_CODES.ACCOUNT_LINK_REQUIRED);\n"
     "  assert.equal(deleted.length, 1);\n"
     "});\n\n"
     "test('an older Google-only account is never deleted and stays a hard conflict', async () => {\n"
     "  const deleted = [];\n"
     "  const authority = new AuthorityMock({ conflict: true });\n"
     "  const handler = createNativeAuthHandler({ fetchImpl: googleFetch({ isNewUser: false, deleted, createdAt: String(Date.now() - 60 * 60 * 1000) }) });\n"
     "  const result = await handler(request(`${AUTH_API_PREFIX}/google`, { idToken: TOKEN('google-id') }), {\n"
     "    AUTH_AUTHORITY: authority, FIREBASE_WEB_API_KEY: API_KEY, GOOGLE_AUTH_ACTIVATION: 'enabled'\n"
     "  });\n"
     "  assert.equal(result.status, 409);\n"
     "  assert.equal((await result.json()).error.code, AUTH_ERROR_CODES.ACCOUNT_CONFLICT);\n"
     "  assert.equal(deleted.length, 0);\n"
     "});\n\n"
     "test('duplicate Google cleanup failure stays a hard conflict", 1),
])
print('applied')
