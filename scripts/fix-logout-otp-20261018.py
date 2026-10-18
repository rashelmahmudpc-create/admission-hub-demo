#!/usr/bin/env python3
# 2026-10-18 fix: (1) welcome auth buttons invisible under Reduce Motion,
# (2) Profile v2 logout was a "(ডেমো)" toast, (3) verified users re-prompted for OTP.
import re, subprocess
def rd(p): return open(p, encoding='utf-8').read()
def wr(p, s): open(p, 'w', encoding='utf-8').write(s)
def rep(p, a, b):
    s = rd(p); n = s.count(a)
    if n != 1: raise SystemExit(f'{p}: expected 1 match, got {n}: {a[:70]!r}')
    wr(p, s.replace(a, b))

s = rd('welcome-story.css').rstrip('\n')
s += ("\n/* 2026-10-18: Reduce Motion (iOS) disables every animation inside the account\n"
      "   shell, so the auth buttons (shown only by the `up` animation) stayed at\n"
      "   opacity:0 and the entry page looked empty. Show them statically. */\n"
      "@media (prefers-reduced-motion: reduce){#ah-welcome-story .auth .rv{opacity:1!important;translate:none!important;animation:none!important}}\n")
wr('welcome-story.css', s)

rep('welcome-story.js', "meta.setAttribute('content','#E6F0FF');app.classList.add('open')});",
    "meta.setAttribute('content','#E6F0FF');app.classList.add('open');setTimeout(()=>{if(!open)return;auth.querySelectorAll('.rv').forEach(e=>{if(getComputedStyle(e).opacity==='0'){e.style.animation='none';e.style.opacity='1';e.style.translate='0 0'}})},2600)});")

A = 'account-access.js'
s = rd(A)
m = re.search(r"    \$\('\[data-role=\"logout\"\]'\)\.addEventListener\('click', async \(\) => \{\n.*?\n    \}\);\n", s, re.S)
if not m or "api('/session/logout'" not in m.group(0): raise SystemExit('logout handler not found')
s = s[:m.start()] + "    $('[data-role=\"logout\"]').addEventListener('click', () => { void performLogout(); });\n" + s[m.end():]
wr(A, s)
anchor = "  const performLogoutAll = async () => {"
rep(A, anchor, """  // Single logout path for the account card AND the Profile v2 frame (which
  // calls AdmissionAccount.logout()). Before 2026-10-18 the profile button only
  // showed a "(demo)" toast and never ended the session.
  const performLogout = async () => {
    if (state.busy) return false;
    setBusy(true);
    setSessionState('LOGGING_OUT');
    try {
      // Flush in-memory signup details while the session is still valid.
      try { await syncPendingProfile({ pending: true }); } catch (_) {}
      try {
        await api('/session/logout', { method: 'POST', body: {} });
      } catch (error) {
        // An already-ended session has the same end state: signed out.
        if (!(error && (error.status === 401 || error.status === 403))) throw error;
      }
      clearAuthLocalState();
      setSessionState('UNAUTHENTICATED');
      broadcastAuthEvent('logout');
      updateLauncher(); showView('login'); message('নিরাপদভাবে লগ আউট হয়েছে।', 'success');
      return true;
    } catch (error) { setSessionState('ERROR'); message(friendlyError(error), 'error'); return false; }
    finally { setBusy(false); }
  };

""" + anchor)
rep(A, "    terminateAllSessions: () => performLogoutAll(),",
    "    logout: async () => { setAccountPageActive(true); return performLogout(); },\n"
    "    terminateAllSessions: async () => { setAccountPageActive(true); return performLogoutAll(); },")

for p in ['profile-v2.html', 'design/profile-v2-source.html']:
    rep(p, "act('auth.logout');toast('Log Out হচ্ছে (ডেমো)')", "act('auth.logout');toast('Log Out হচ্ছে…')")
    rep(p, "act('auth.logoutAll');toast('সব ডিভাইস থেকে Log Out (ডেমো)')", "act('auth.logoutAll');toast('সব ডিভাইস থেকে Log Out হচ্ছে…')")
old_bridge = "        try { window.AdmissionAccount && window.AdmissionAccount.open && window.AdmissionAccount.open(); } catch (_) {}"
new_bridge = """        /* The profile runs inside an iframe: the account module lives on the
           parent document (same origin), so reach it there. */
        try {
          var acc = (window.parent && window.parent !== window && window.parent.AdmissionAccount) || window.AdmissionAccount;
          if (acc) {
            if (a === 'auth.logout' && acc.logout) acc.logout();
            else if (a === 'auth.logoutAll' && acc.terminateAllSessions) acc.terminateAllSessions();
            else if (acc.open) acc.open();
          }
        } catch (_) {}"""
for p in ['profile-v2.html', 'scripts/build-profile-v2.mjs']:
    rep(p, old_bridge, new_bridge)

rep('auth-native/storage/sqlite-auth-repository.mjs',
    "if (row.purpose === 'new-device' && input.trust && Number(input.trust.ttlMs) > 0) {",
    "// 2026-10-18: the first (signup) verification is also a consent moment;\n"
    "      // without this the very device that verified kept getting OTP prompts.\n"
    "      if (input.trust && Number(input.trust.ttlMs) > 0) {")

rep('auth-native/core/auth-engine.mjs', """      const failSafe = resolveFailSafe('sensitive', config);
      return Object.freeze({""", """      // 2026-10-18: a verified account on a device whose cookie is already known
      // is a normal login; a risk-store outage must not turn it into an OTP.
      if (verified === true && newDevice !== true) {
        return Object.freeze({
          level: 'NORMAL',
          trusted: false,
          challenge: null,
          block: false,
          sessionTtlMs: config.riskSessionPolicy.NORMAL?.sessionTtlMs ?? null,
          trustOffer: false,
          policyVersion: config.policyVersion
        });
      }
      const failSafe = resolveFailSafe('sensitive', config);
      return Object.freeze({""")

reps = [('v354-profile-cache-stable', 'v355-logout-otp-fix'), ('welcome-story-20261016-v2', 'welcome-story-20261018-v3'),
        ("profile-v2-5'", "profile-v2-6'"), ('?v=profile-v2-5', '?v=profile-v2-6'), ('?v=profile-v2-4', '?v=profile-v2-6'),
        ('20261018-magiclink-v1', '20261018-logout-otp-v1')]
for f in subprocess.check_output(['git', 'ls-files']).decode().split('\n'):
    if not f or f.startswith('tools/') or not re.search(r'\.(js|mjs|html)$', f): continue
    try: s = rd(f)
    except Exception: continue
    t = s
    for a, b in reps: t = t.replace(a, b)
    if t != s: wr(f, t)
print('fix applied')
