#!/usr/bin/env python3
"""Owner-approved Google login completion fix; guarded source edits, no data mutation."""
from pathlib import Path
import re
import sys

if "// Optional enrichment must never hold the session cookies hostage." in Path("auth-native/worker/public-auth-handler.mjs").read_text() and "let parsed = false;" in Path("account-access.js").read_text():
    print("Google login completion patch already applied.")
    sys.exit(0)

def replace_once(text, old, new):
    if old == new or old not in text:
        if new in text: return text
        raise SystemExit('Expected source anchor missing: ' + old[:90])
    if text.count(old) != 1: raise SystemExit('Ambiguous source anchor: ' + old[:90])
    return text.replace(old, new, 1)

p = Path('account-access.js'); s = p.read_text()
s = replace_once(s, '    const ceiling = slowSend ? 45000 : 18000;', "    const socialSignIn = /^\\/(google|facebook)(\\/link)?(\\?|$)/.test(String(path || ''));\n    const ceiling = slowSend || socialSignIn ? 45000 : 18000;")
s = replace_once(s, '    let data = {};  \n    try { data = await response.json(); } catch (_) {}', '    let data = {};\n    let parsed = false;\n    try { data = await response.json(); parsed = Boolean(data && typeof data === \'object\'); } catch (_) {}')
s = replace_once(s, "      error.status = response.status;  \n      error.code =", "      error.status = response.status;\n      error.authStage = String(response.headers.get('X-AH-Auth-Stage') || '').replace(/[^A-Z0-9_]/g, '').slice(0, 40);\n      error.diagnostic = String(response.headers.get('X-AH-Auth-Diagnostic') || '').replace(/[^A-Z0-9_]/g, '').slice(0, 80);\n      error.code =")
old = "      if (error?.code === 'ACCOUNT_LINK_REQUIRED') showView('google-link');\n      message(error?.code ? friendlyError(error) : googleMessage(error), 'error');"
new = "      if (error?.code === 'ACCOUNT_LINK_REQUIRED') showView('google-link');\n      const detail = error?.diagnostic || error?.authStage || '';\n      const text = error?.code ? friendlyError(error) : googleMessage(error);\n      message(detail ? `${text} [${detail}]` : text, 'error');"
s = replace_once(s, old, new); p.write_text(s)

p = Path('auth-native/worker/public-auth-handler.mjs'); s = p.read_text()
s = replace_once(s, 'return async function handleNativeAuthRequest(request, env) {', 'return async function handleNativeAuthRequest(request, env, executionContext) {')
s = replace_once(s, "    const context = clientContext(request, jar[AUTH_DEVICE_COOKIE]);\n\n    try {", "    const context = clientContext(request, jar[AUTH_DEVICE_COOKIE]);\n    const googleRequest = request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/google`;\n    let authStage = 'PROVIDER_CONFIG';\n\n    try {")
start = s.index("      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/google`) {")
end = s.index("      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/google/link`) {", start)
g = s[start:end]
g = replace_once(g, '        const credential = googleCredential(await readJson(request));', "        authStage = 'CREDENTIAL_INPUT';\n        const credential = googleCredential(await readJson(request));\n        authStage = 'RATE_CHECK';")
g = replace_once(g, '        try { signed = await provider.signInWithGoogle(credential); }', "        authStage = 'FIREBASE_EXCHANGE';\n        try { signed = await provider.signInWithGoogle(credential); }")
g = replace_once(g, '        try { user = await provider.lookup(signed.idToken); }', "        authStage = 'IDENTITY_LOOKUP';\n        try { user = await provider.lookup(signed.idToken); }")
g = replace_once(g, '        let established;\n        try {', "        authStage = 'ACCOUNT_SESSION';\n        let established;\n        try {")
old = '''        try {
          const establishedBody = established?.result || established;
          await seedGoogleProfile(env, context, establishedBody, user);
        } catch { /* best-effort by design */ }
        return authSuccess(request, established, signed.refreshToken, context);'''
new = '''        // Optional enrichment must never hold the session cookies hostage.
        const enrichment = seedGoogleProfile(env, context, established, user).catch(() => {});
        if (typeof executionContext?.waitUntil === 'function') executionContext.waitUntil(enrichment);
        else await enrichment; // non-Worker adapters and existing unit tests
        const result = authSuccess(request, established, signed.refreshToken, context);
        result.headers.set('X-AH-Auth-Stage', 'SESSION_CREATED');
        return result;'''
g = replace_once(g, old, new); s = s[:start] + g + s[end:]
s = replace_once(s, "        ...(providerDiagnosticCode ? { 'X-AH-Auth-Diagnostic': providerDiagnosticCode } : {}),", "        ...(providerDiagnosticCode ? { 'X-AH-Auth-Diagnostic': providerDiagnosticCode } : {}),\n        ...(googleRequest ? { 'X-AH-Auth-Stage': authStage } : {}),")
p.write_text(s)

build_to = 'v347-google-login-complete'
ui_to = '20261015-login-complete-v1'
build_from = re.search(r"const BUILD_ID = '([^']+)'", Path('sw.js').read_text()).group(1)
ui_from = re.search(r'account-access\.js\?v=([A-Za-z0-9_-]+)', Path('index.html').read_text()).group(1)
for p in [Path('index.html'), Path('sw.js'), *Path('.').glob('*.test.mjs')]:
    s = p.read_text()
    if p.name in ['index.html', 'sw.js']:
        s = s.replace(build_from, build_to)
        s = re.sub(r'account-access\.(?:js|css)\?v=[A-Za-z0-9_-]+', lambda m: m.group(0).split('?')[0] + '?v=' + ui_to, s)
    else:
        s = s.replace(build_from, build_to)
        s = s.replace("const UI_VERSION = '" + ui_from + "'", "const UI_VERSION = '" + ui_to + "'")
        s = s.replace('account-access.js?v=' + ui_from, 'account-access.js?v=' + ui_to)
        s = s.replace('account-access.css?v=' + ui_from, 'account-access.css?v=' + ui_to)
    p.write_text(s)
print('Google login completion patch applied; regenerate Worker bundle and SW manifest before publication.')
