#!/usr/bin/env python3
"""Google/Facebook redirect: never lose the sign-in on the way back (owner 2026-10-17).

Symptom: "Continue with Google" -> Google account chosen -> back on the site,
but the Welcome screen shows again, no error, no Dashboard.

Cause: the "a redirect is coming back" marks (ours: ah-google-redirect, and
Firebase's own firebase:pendingRedirect:<key>:<app>) live only in
sessionStorage. When the return lands in another browsing context (installed
app / PWA -> Google opens outside the app, Android Chrome tab handover, a
restored tab) sessionStorage is empty, so finishOAuthRedirect() returns
silently and the boot shows Welcome.

Fix:
* beginOAuthRedirect() also puts a marker (?ahAuthReturn=g|f) into the URL
  Firebase returns to, so the return survives any storage loss (no
  localStorage: the native-auth-protection guard forbids it). The marker is
  removed again if the redirect cannot start.
* finishOAuthRedirect() falls back to that marker, restores Firebase's
  pendingRedirect key BEFORE the auth instance starts, removes the marker from
  the address bar, and if Google still gives nothing it shows an error with the
  code [storage-lost] instead of a silent Welcome screen.

Idempotent. Run from the repo root, then `npm run sw:manifest`.
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MARKER = "const OAUTH_RETURN_PARAM = 'ahAuthReturn';"


def edit(rel, pairs, marker):
    path = ROOT / rel
    text = path.read_text(encoding='utf-8')
    if marker in text:
        print(f'{rel}: already applied, skip')
        return
    for old, new in pairs:
        if text.count(old) != 1:
            sys.exit(f'{rel}: anchor not found exactly once: {old[:80]!r}')
        text = text.replace(old, new)
    path.write_text(text, encoding='utf-8')
    print(f'{rel}: applied')


BEGIN_OLD = """  const beginOAuthRedirect = async (auth, provider, google = false) => {
    try {
      if (google) sessionStorage.setItem(GOOGLE_REDIRECT_FLAG, '1');
      else sessionStorage.setItem(OAUTH_REDIRECT_FLAG, '1');
    } catch (_) {}
    await auth.signInWithRedirect(provider);
    return OAUTH_REDIRECT;
  };
"""

BEGIN_NEW = """  /* Owner 2026-10-17: after Google the Welcome screen came back with no error.
   * Tab storage (our flag + Firebase's pendingRedirect) is empty when the
   * return lands in another browsing context (installed app, tab handover), so
   * the return was never noticed. A marker on the URL Firebase returns to
   * survives that; finishOAuthRedirect() uses it as a fallback. Non-secret. */
  const OAUTH_RETURN_PARAM = 'ahAuthReturn';
  const stripOAuthReturnParam = () => {
    let marker = '';
    try {
      const here = new URL(location.href);
      marker = String(here.searchParams.get(OAUTH_RETURN_PARAM) || '');
      if (marker) {
        here.searchParams.delete(OAUTH_RETURN_PARAM);
        history.replaceState(history.state, '', here.pathname + here.search + here.hash);
      }
    } catch (_) {}
    return marker;
  };
  /* Firebase only asks for a redirect result when its own pending mark is in
   * tab storage; put that fixed, non-secret mark back after a lost tab. */
  const restoreFirebasePendingRedirect = appName => {
    const pendingKey = `firebase:pendingRedirect:${GOOGLE_AUTH_API_KEY}:${appName}`;
    try {
      if (!sessionStorage.getItem(pendingKey)) sessionStorage.setItem(pendingKey, '"true"');
    } catch (_) {}
  };
  const beginOAuthRedirect = async (auth, provider, google = false) => {
    try {
      if (google) sessionStorage.setItem(GOOGLE_REDIRECT_FLAG, '1');
      else sessionStorage.setItem(OAUTH_REDIRECT_FLAG, '1');
    } catch (_) {}
    try {
      const here = new URL(location.href);
      here.searchParams.set(OAUTH_RETURN_PARAM, google ? 'g' : 'f');
      history.replaceState(history.state, '', here.pathname + here.search + here.hash);
    } catch (_) {}
    try {
      await auth.signInWithRedirect(provider);
    } catch (error) {
      stripOAuthReturnParam();
      throw error;
    }
    return OAUTH_REDIRECT;
  };
"""

FINISH_OLD = """    } catch (_) {}
    if (!facebookPending && !googlePending) return;
    const auth = await (googlePending ? loadGoogleAuth() : loadFirebaseAuth()).catch(() => null);
"""

FINISH_NEW = """    } catch (_) {}
    // Fallback when tab storage was lost on the way back (see OAUTH_RETURN_PARAM).
    const returnMarker = stripOAuthReturnParam();
    let recovered = false;
    if (!facebookPending && !googlePending) {
      if (returnMarker === 'g') googlePending = true;
      else if (returnMarker === 'f') facebookPending = true;
      recovered = googlePending || facebookPending;
    }
    if (!facebookPending && !googlePending) return;
    // Must happen before the auth instance starts (it reads the mark at init).
    if (recovered) restoreFirebasePendingRedirect(googlePending ? GOOGLE_SKY_APP : 'ah-google');
    const auth = await (googlePending ? loadGoogleAuth() : loadFirebaseAuth()).catch(() => null);
"""

CODE_OLD = """      const code = String(redirectError?.code || '');
      const text = code === 'auth/account-exists-with-different-credential'"""
CODE_NEW = """      const code = String(redirectError?.code || (recovered ? 'storage-lost' : ''));
      const text = code === 'auth/account-exists-with-different-credential'"""

edit('account-access.js', [(BEGIN_OLD, BEGIN_NEW), (FINISH_OLD, FINISH_NEW), (CODE_OLD, CODE_NEW)], MARKER)

# The return marker now rides on the URL while the redirect starts, so the
# ?ahGoogle=1 hand-off test checks that ahGoogle is gone, not that search is ''.
T_OLD = """  await waitFor(() => app.record.redirect === 1, 2500);
  assert.equal(app.w.location.search, '');
"""
T_NEW = """  await waitFor(() => app.record.redirect === 1, 2500);
  assert.equal(new URL(app.w.location.href).searchParams.get('ahGoogle'), null);
  assert.equal(new URL(app.w.location.href).searchParams.get('ahAuthReturn'), 'g', 'return marker rides on the redirect URL');
"""
edit('google-redirect-login.test.mjs', [(T_OLD, T_NEW)], "searchParams.get('ahAuthReturn'), 'g', 'return marker rides")

# native-auth-protection guard: allow exactly the two Firebase pending-mark calls.
G_OLD = """  assert.equal(storageCalls.length, 6, 'only the six OAuth boolean flag accesses (Facebook + Google redirect) are permitted');
  for (const [, method, args] of storageCalls) {
    const permitted = method === 'setItem'
      ? /^(?:OAUTH_REDIRECT_FLAG|GOOGLE_REDIRECT_FLAG),\\s*'1'$/
      : /^(?:OAUTH_REDIRECT_FLAG|GOOGLE_REDIRECT_FLAG)$/;
"""
G_NEW = """  // +2: the fixed Firebase pendingRedirect mark restored after a lost tab
  // (apply-google-return-recovery-20261017). Still never a token or profile.
  assert.equal(storageCalls.length, 8, 'only the six OAuth boolean flag accesses plus the two Firebase pending-mark calls are permitted');
  assert.match(client, /const pendingKey = `firebase:pendingRedirect:\\$\\{GOOGLE_AUTH_API_KEY\\}:\\$\\{appName\\}`;/);
  for (const [, method, args] of storageCalls) {
    const permitted = method === 'setItem'
      ? /^(?:(?:OAUTH_REDIRECT_FLAG|GOOGLE_REDIRECT_FLAG),\\s*'1'|pendingKey,\\s*'"true"')$/
      : /^(?:OAUTH_REDIRECT_FLAG|GOOGLE_REDIRECT_FLAG|pendingKey)$/;
"""
edit('native-auth-protection.test.mjs', [(G_OLD, G_NEW)], "plus the two Firebase pending-mark calls")
