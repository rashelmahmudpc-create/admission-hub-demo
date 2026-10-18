#!/usr/bin/env python3
# Owner order 2026-10-18: ONLY gmail.com, yahoo.com, icloud.com, outlook.com.
# Every other address is refused at the email field (Next never advances) and by
# the Worker (signup, login, password-reset, OTP). No institutional exception.
import re, subprocess, sys
MSG = 'শুধু Gmail, Yahoo, iCloud বা Outlook ইমেইল দিয়ে এগোনো যাবে। অন্য কোনো ইমেইল গ্রহণ করা হয় না।'
ALLOWED = "['gmail.com', 'yahoo.com', 'icloud.com', 'outlook.com']"
def rd(p): return open(p, encoding='utf-8').read()
def wr(p, s): open(p, 'w', encoding='utf-8').write(s)
def once(s, old, new, p):
    n = s.count(old)
    if n != 1: sys.exit(f'{p}: anchor count {n}: {old[:70]!r}')
    return s.replace(old, new)
def resub(s, pat, rep, p):
    out, n = re.subn(pat, rep, s, flags=re.S)
    if n != 1: sys.exit(f'{p}: regex count {n}: {pat[:60]!r}')
    return out

p = 'email-policy.js'; s = rd(p)
s = once(s, '// True when the address belongs to a disposable or unverifiable provider.',
  "// Owner order 2026-10-18: the ONLY accepted mail providers. Exact domain match.\n"
  "export const ALLOWED_EMAIL_DOMAINS = Object.freeze(" + ALLOWED + ");\n"
  "export const ALLOWED_EMAIL_DOMAINS_LIST = ALLOWED_EMAIL_DOMAINS;\n\n"
  "// True when the address is NOT gmail/yahoo/icloud/outlook (name kept so every\n"
  "// existing gate - signup, login, reset, client fields - enforces the allowlist).", p)
s = once(s, "  return DISPOSABLE_DOMAINS.some(blocked => domain === blocked || domain.endsWith(`.${blocked}`));",
  "  return !ALLOWED_EMAIL_DOMAINS.includes(domain);", p)
s = resub(s, r"(export const DISPOSABLE_EMAIL_MESSAGE =\s*)'[^']*';", lambda m: m.group(1) + "'" + MSG + "';", p)
wr(p, s)

p = 'email-policy-client.js'; s = rd(p)
s = once(s, '  window.ADMISSION_HUB_DISPOSABLE_EMAIL_MESSAGE =',
  "  window.ADMISSION_HUB_ALLOWED_EMAIL_DOMAINS = Object.freeze(" + ALLOWED + ");\n  window.ADMISSION_HUB_DISPOSABLE_EMAIL_MESSAGE =", p)
s = resub(s, r"return window\.ADMISSION_HUB_DISPOSABLE_EMAILS\.some\(\s*blocked => domain === blocked \|\| domain\.endsWith\(`\.\$\{blocked\}`\)\s*\);",
  lambda m: 'return !window.ADMISSION_HUB_ALLOWED_EMAIL_DOMAINS.includes(domain);', p)
s = resub(s, r"(window\.ADMISSION_HUB_DISPOSABLE_EMAIL_MESSAGE =\s*)'[^']*';", lambda m: m.group(1) + "'" + MSG + "';", p)
wr(p, s)

p = 'sky-onboarding.js'; s = rd(p)
s = once(s, "  : () => false);", "  : value => !/@(gmail|yahoo|icloud|outlook)\\.com$/i.test(String(value || '').trim()));", p)
wr(p, s)

p = 'account-access.js'; s = rd(p)
guard = "\n      if (window.ADMISSION_HUB_isDisposableEmail?.(email)) return message(window.ADMISSION_HUB_DISPOSABLE_EMAIL_MESSAGE, 'error');"
for a in ["if (!email || !$('#ah-login-email').checkValidity()) return message('সঠিক ইমেইল ঠিকানা লিখুন।', 'error');",
          "if (!email || !$('#ah-forgot-email').checkValidity()) return message('সঠিক Email address লিখো।', 'error');"]:
    s = once(s, a, a + guard, p)
s = resub(s, r"(DISPOSABLE_EMAIL: )'[^']*'", lambda m: m.group(1) + "'" + MSG + "'", p)
wr(p, s)

p = 'auth-native/worker/public-auth-handler.mjs'; s = rd(p)
def chk(v): return "if (isDisposableEmail(" + v + ")) throw new NativeAuthError(AUTH_ERROR_CODES.DISPOSABLE_EMAIL);\n        "
a = "const prepared = await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'login', email: input.email }, context });"
s = once(s, a, chk('input.email') + a, p)
a = "const prepared = await callAuthority(env, '/internal/firebase/rate', {\n          input: { operation: 'password-reset', email }"
s = once(s, a, chk('email') + a, p)
wr(p, s)

p = 'auth-native/verification/orchestrator.mjs'; s = rd(p)
s = once(s, "if (matchesDomain(domain, allow) || matchesDomain(domain, INSTITUTIONAL_SUFFIXES)) return;",
  "if (matchesDomain(domain, allow)) return; // owner 2026-10-18: no institutional exception", p)
wr(p, s)

p = 'verification-orchestrator.test.mjs'; s = rd(p)
s = once(s, "test('email-ownership accepts an approved consumer domain and a Bangladesh college suffix', async () => {",
  "test('email-ownership accepts an approved consumer domain and refuses a Bangladesh college suffix (owner 2026-10-18)', async () => {", p)
s = once(s, "  const college = await app.orchestrator.requestVerification(\n    { ...collegeIdentity, trustedIdentity: { ...collegeIdentity.trustedIdentity, emailRef: 'd'.repeat(64) } },\n    context\n  );\n  assert.equal(college.accepted, true);\n  assert.equal(provider.sends.length, 2);",
  "  await expectCode(() => app.orchestrator.requestVerification(\n    { ...collegeIdentity, trustedIdentity: { ...collegeIdentity.trustedIdentity, emailRef: 'd'.repeat(64) } },\n    context\n  ), AUTH_ERROR_CODES.INVALID_INPUT);\n  assert.equal(provider.sends.length, 1);", p)
wr(p, s)

for old, new in [('account-access.js?v=20261018-magiclink-v1', 'account-access.js?v=20261018-email-allow-v1'),
                 ('email-policy-client.js?v=20261016-disposable-email-v1', 'email-policy-client.js?v=20261018-email-allow-v1'),
                 ('sky-onboarding.js?v=sky-flow-20261017-v9', 'sky-onboarding.js?v=sky-flow-20261018-v10')]:
    files = subprocess.run(['git', 'grep', '-lF', old], capture_output=True, text=True).stdout.split()
    files = [f for f in files if f != 'worker-bundle.mjs' and not f.startswith(('.github/', 'scripts/email-allowlist'))]
    if not files: sys.exit('version key not found: ' + old)
    for f in files: wr(f, rd(f).replace(old, new))
    print('bumped', old, '->', files)
print('patch applied')
