#!/usr/bin/env python3
"""Continue with Google took 1-2 minutes before Google's page appeared
(owner 2026-10-22). Server side is fast (<0.5s per request); the wait is in
the browser:

* Firebase Auth was only loaded AFTER the click, and on mobile/Safari it waits
  for the hidden /__/auth/iframe + gapi handshake (long timeouts) before it
  redirects.
* sw.js handled /__/auth/* like app pages (shell / shell cache / timeouts).

Fix:
* sw.js: /__/auth/* and /__/firebase/* go straight to the network.
* account-access.js: warm Firebase Auth while the Google button is shown, so
  the click redirects immediately.

Idempotent. Run from the repo root, then `npm run sw:manifest`.
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def edit(rel, old, new, marker):
    path = ROOT / rel
    text = path.read_text(encoding='utf-8')
    if marker in text:
        return
    if text.count(old) != 1:
        sys.exit(f'{rel}: anchor not found exactly once: {old[:70]!r}')
    path.write_text(text.replace(old, new), encoding='utf-8')


SW_OLD = "  if (requestUrl.origin !== self.location.origin) return;\n"
SW_MARK = "requestUrl.pathname.startsWith('/__/auth/')"
SW_NEW = SW_OLD + (
    "  // Firebase Auth helper pages (handler/iframe, proxied by _worker.js) must go\n"
    "  // straight to the network: never the app shell, never the shell cache.\n"
    "  if (requestUrl.pathname.startsWith('/__/auth/') || requestUrl.pathname.startsWith('/__/firebase/')) return;\n"
)
edit('sw.js', SW_OLD, SW_NEW, SW_MARK)

AA_OLD = "      state.googleReady = true;\n      return true;\n    });\n    return state.googlePromise;"
AA_MARK = 'warm Firebase Auth (SDK + hidden /__/auth/iframe)'
AA_NEW = '''      state.googleReady = true;
      /* 2026-10-22: warm Firebase Auth (SDK + hidden /__/auth/iframe) while the
       * visitor is still reading the screen, so "Continue with Google" redirects
       * at once instead of waiting on the mobile iframe/gapi handshake. */
      if (hosts.length && !inAppBrowser() && String(location.hostname || '') === GOOGLE_SKY_HOST) {
        (window.requestIdleCallback || (fn => setTimeout(fn, 300)))(() => { loadGoogleAuth().catch(() => {}); });
      }
      return true;
    });
    return state.googlePromise;'''
edit('account-access.js', AA_OLD, AA_NEW, AA_MARK)
print('applied')
