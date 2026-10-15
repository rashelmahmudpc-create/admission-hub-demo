#!/usr/bin/env python3
"""Owner-approved 2026-10-17: iOS Home-Screen (PWA) shell fix.

Applies one reviewed patch on top of main (93c5ccd):
- Welcome / Sign Up / Sign In pinned to the real screen edges (no vh units);
  the welcome view no longer collapses, so Get Started and the guest button fit.
- html/body overscroll forced off (android-runtime-fix.js re-enabled it with
  !important); outer page cannot bounce or pull-refresh, inner scrollers still scroll.
- Status-bar strip matches the screen below it (main app scrim, auth screens paint
  their own inset).
- Logout: the previous screen is hidden while the Sky flow loads (spinner instead).
- Asset versions bumped via scripts/cache-bump.mjs; .github/workflows untouched.

The patch is downloaded and verified by SHA-256 before it is applied. Idempotent.
"""
import hashlib
import subprocess
import sys
import urllib.request

URL = 'https://backend.composio.dev/api/v3/sl/JMU7OlN8mO'
SHA256 = 'c07192953af49172a9e61924503bfac59de769916a079c554a87b66bf87e15a8'
PATCH = '/tmp/ios-shell-v2.patch'

req = urllib.request.Request(URL, headers={'User-Agent': 'admission-hub-applier'})
data = urllib.request.urlopen(req, timeout=60).read()
digest = hashlib.sha256(data).hexdigest()
if digest != SHA256:
    sys.exit(f'patch digest mismatch: {digest}')
with open(PATCH, 'wb') as handle:
    handle.write(data)

if subprocess.run(['git', 'apply', '--reverse', '--check', PATCH], capture_output=True).returncode == 0:
    print('iOS shell patch already applied; nothing to do.')
    sys.exit(0)
subprocess.run(['git', 'apply', '--whitespace=nowarn', PATCH], check=True)
print('iOS shell patch applied.')
