import re, pathlib
ALLOW = ['gmail.com', 'yahoo.com', 'icloud.com', 'hotmail.com', 'outlook.com']
MSG = 'এই ইমেইলে কোড পাঠানো সম্ভব না। শুধু Gmail, Yahoo, iCloud, Hotmail বা Outlook ইমেইল ব্যবহার করো।'
def sub(path, old, new, count=1):
    p = pathlib.Path(path); s = p.read_text()
    if new in s: return
    assert s.count(old) == count, (path, old[:60], s.count(old))
    p.write_text(s.replace(old, new))

# 1) email-policy.js: allowlist is authoritative
p = pathlib.Path('email-policy.js'); s = p.read_text()
if 'ALLOWED_EMAIL_DOMAINS' not in s:
    s = s.replace('''// True when the address belongs to a disposable or unverifiable provider.
export function isDisposableEmail(email) {
  const domain = emailDomain(email);
  if (!domain) return false;
  return DISPOSABLE_DOMAINS.some(blocked => domain === blocked || domain.endsWith(`.${blocked}`));
}''', '''// Owner order 2026-10-18 (final): ONLY these five mailbox domains may sign up or
// receive any code/link. Exact match: no subdomains, no school/college/edu, no
// temp mail. Every other domain is refused at the field AND by the Worker.
export const ALLOWED_EMAIL_DOMAINS = Object.freeze(%s);

export function isAllowedEmailDomain(email) {
  const domain = emailDomain(email);
  return Boolean(domain) && ALLOWED_EMAIL_DOMAINS.includes(domain);
}

// True when the address must be refused: any well-formed address outside the
// five allowed domains (the old denylist is kept only as documentation).
export function isDisposableEmail(email) {
  const domain = emailDomain(email);
  if (!domain) return false;
  return !ALLOWED_EMAIL_DOMAINS.includes(domain);
}''' % repr(ALLOW).replace('"', "'"))
    s = re.sub(r"export const DISPOSABLE_EMAIL_MESSAGE =\n  '[^']*';", "export const DISPOSABLE_EMAIL_MESSAGE =\n  '%s';" % MSG, s)
    assert 'ALLOWED_EMAIL_DOMAINS' in s and MSG in s
    p.write_text(s)

# 2) browser mirror
p = pathlib.Path('email-policy-client.js'); s = p.read_text()
if 'ADMISSION_HUB_ALLOWED_EMAIL_DOMAINS' not in s:
    s = re.sub(r"  window.ADMISSION_HUB_DISPOSABLE_EMAIL_MESSAGE =\n    '[^']*';", "  window.ADMISSION_HUB_ALLOWED_EMAIL_DOMAINS = Object.freeze(%s);\n  window.ADMISSION_HUB_DISPOSABLE_EMAIL_MESSAGE =\n    '%s';" % (repr(ALLOW), MSG), s)
    s = s.replace('''    return window.ADMISSION_HUB_DISPOSABLE_EMAILS.some(
      blocked => domain === blocked || domain.endsWith(`.${blocked}`)
    );''', '''    // Owner 2026-10-18: only the five allowed domains pass; everything else is refused.
    return !window.ADMISSION_HUB_ALLOWED_EMAIL_DOMAINS.includes(domain);''')
    assert 'ADMISSION_HUB_ALLOWED_EMAIL_DOMAINS.includes' in s
    p.write_text(s)

# 3) orchestrator: no institutional bypass
sub('auth-native/verification/orchestrator.mjs', "const INSTITUTIONAL_SUFFIXES = Object.freeze(['.ac.bd', '.edu.bd']);",
    "// Owner 2026-10-18: no school/college/edu bypass any more.\nconst INSTITUTIONAL_SUFFIXES = Object.freeze([]);")
# 4) config default list
sub('auth-native/verification/config.mjs', "export const OWNER_ALLOWED_DOMAINS = Object.freeze(['gmail.com', 'yahoo.com', 'icloud.com', 'outlook.com']);",
    "export const OWNER_ALLOWED_DOMAINS = Object.freeze(%s);" % repr(ALLOW))
# 5) Worker: password-reset refuses other domains too
sub('auth-native/worker/public-auth-handler.mjs', '''        const email = normalizeAuthEmail(body?.email);
        const prepared = await callAuthority(env, '/internal/firebase/rate', {
          input: { operation: 'password-reset', email }, context''', '''        const email = normalizeAuthEmail(body?.email);
        if (isDisposableEmail(email)) throw new NativeAuthError(AUTH_ERROR_CODES.DISPOSABLE_EMAIL);
        const prepared = await callAuthority(env, '/internal/firebase/rate', {
          input: { operation: 'password-reset', email }, context''')
# 6) error text
p = pathlib.Path('auth-native/core/errors.mjs'); s = p.read_text()
s2 = re.sub(r"(\[AUTH_ERROR_CODES\.DISPOSABLE_EMAIL\]: Object\.freeze\(\{ status: 400, message: )'[^']*'", lambda m: m.group(1) + "'" + MSG + "'", s)
p.write_text(s2)
p = pathlib.Path('account-access.js'); s = p.read_text()
s2 = re.sub(r"(      DISPOSABLE_EMAIL: )'[^']*'", lambda m: m.group(1) + "'" + MSG + "'", s, count=1)
p.write_text(s2)
# 7) cache-bust the client script
import subprocess
build = re.search(r"^const BUILD_ID = '([^']+)'", pathlib.Path('sw.js').read_text(), re.M).group(1)
p = pathlib.Path('scripts/cache-bump.mjs'); s = p.read_text()
s = re.sub(r"const UI_VERSION_FROM = '[^']*';", "const UI_VERSION_FROM = '20261016-disposable-email-v1';", s)
s = re.sub(r"const UI_VERSION_TO = '[^']*';", "const UI_VERSION_TO = '20261018-allowlist-v1';", s)
s = re.sub(r"const SW_BUILD_FROM = '[^']*';", "const SW_BUILD_FROM = '%s';" % build, s)
s = re.sub(r"const SW_BUILD_TO = '[^']*';", "const SW_BUILD_TO = 'v357-email-allowlist';", s)
p.write_text(s)
if build != 'v357-email-allowlist':
    subprocess.run(['node', 'scripts/cache-bump.mjs'], check=True)
print('patched')

# 8) orchestrator: hard allowlist regardless of runtime config (admin panel cannot widen it)
sub('auth-native/verification/orchestrator.mjs', "import { verificationConfig } from './config.mjs';",
    "import { verificationConfig } from './config.mjs';\nimport { isDisposableEmail } from '../../email-policy.js';")
sub('auth-native/verification/orchestrator.mjs', '''    if (!email) return;
    const allow = this.config.allowedDomains;''', '''    if (!email) return;
    // Owner 2026-10-18: only the five allowed domains, always (config cannot widen it).
    if (isDisposableEmail(email)) failAuth(AUTH_ERROR_CODES.INVALID_INPUT);
    const allow = this.config.allowedDomains;''')

# 9) tests follow the new owner rule
sub('email-policy.test.mjs', "import { DISPOSABLE_DOMAINS_LIST, isDisposableEmail, emailDomain } from './email-policy.js';",
    "import { ALLOWED_EMAIL_DOMAINS, DISPOSABLE_DOMAINS_LIST, isDisposableEmail, emailDomain } from './email-policy.js';")
sub('email-policy.test.mjs', '''test('a genuine address is never refused, including a school or work domain', () => {
  for (const email of [
    'student@gmail.com', 'student@yahoo.com', 'student@icloud.com',
    'student@outlook.com', 'student@protonmail.com',
    'student@school.edu.bd', 'student@university.ac.bd', 'student@college.gov.bd',
    'student@notmailinator.com.evil.com'
  ]) {
    assert.equal(isDisposableEmail(email), false, `${email} should be allowed`);
  }
});''', '''test('only the five owner domains are allowed', () => {
  assert.deepEqual([...ALLOWED_EMAIL_DOMAINS], ['gmail.com', 'yahoo.com', 'icloud.com', 'hotmail.com', 'outlook.com']);
  for (const email of ['student@gmail.com', 'Student@Yahoo.com', 'student@icloud.com', 'student@hotmail.com', 'student@outlook.com']) {
    assert.equal(isDisposableEmail(email), false, `${email} should be allowed`);
  }
});

test('every other domain is refused, including school, college and work mail', () => {
  for (const email of [
    'student@protonmail.com', 'student@school.edu.bd', 'student@university.ac.bd',
    'student@college.gov.bd', 'student@notmailinator.com.evil.com', 'student@sub.gmail.com',
    'student@gmail.co', 'student@googlemail.com', 'student@randomtemp.xyz'
  ]) {
    assert.equal(isDisposableEmail(email), true, `${email} should be refused`);
  }
});''')
sub('email-policy.test.mjs', '''  assert.deepEqual([...mirrored].sort(), [...DISPOSABLE_DOMAINS_LIST].sort());
});''', '''  assert.deepEqual([...mirrored].sort(), [...DISPOSABLE_DOMAINS_LIST].sort());
  const allowStart = clientSource.indexOf('ADMISSION_HUB_ALLOWED_EMAIL_DOMAINS = Object.freeze(');
  const allowed = JSON.parse(clientSource.slice(clientSource.indexOf('[', allowStart), clientSource.indexOf(']', allowStart) + 1).replace(/'/g, '"'));
  assert.deepEqual(allowed, [...ALLOWED_EMAIL_DOMAINS]);
});''')
sub('verification-orchestrator.test.mjs', '''test('email-ownership accepts an approved consumer domain and a Bangladesh college suffix', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider], config: allowConfig([provider], ['gmail.com', 'outlook.com']) });
  const gmail = await app.orchestrator.requestVerification(ownershipIdentity('student@gmail.com'), context);
  assert.equal(gmail.accepted, true);
  app.advance(61_000);
  const collegeIdentity = ownershipIdentity('student@college.ac.bd');
  const college = await app.orchestrator.requestVerification(
    { ...collegeIdentity, trustedIdentity: { ...collegeIdentity.trustedIdentity, emailRef: 'd'.repeat(64) } },
    context
  );
  assert.equal(college.accepted, true);
  assert.equal(provider.sends.length, 2);
});

test('an explicit empty allowlist opts out and stays unrestricted', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider], config: allowConfig([provider], []) });
  const requested = await app.orchestrator.requestVerification(ownershipIdentity('anything@example.com'), context);
  assert.equal(requested.accepted, true);
});''', '''test('email-ownership accepts an owner domain but refuses a Bangladesh college suffix', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider], config: allowConfig([provider], ['gmail.com', 'outlook.com']) });
  const gmail = await app.orchestrator.requestVerification(ownershipIdentity('student@gmail.com'), context);
  assert.equal(gmail.accepted, true);
  app.advance(61_000);
  const collegeIdentity = ownershipIdentity('student@college.ac.bd');
  await expectCode(() => app.orchestrator.requestVerification(
    { ...collegeIdentity, trustedIdentity: { ...collegeIdentity.trustedIdentity, emailRef: 'd'.repeat(64) } },
    context
  ), AUTH_ERROR_CODES.INVALID_INPUT);
  assert.equal(provider.sends.length, 1);
});

test('an explicit empty allowlist can no longer widen the owner list', async () => {
  const provider = new MockProvider({ id: 'otp-a' });
  const app = setup({ providers: [provider], config: allowConfig([provider], []) });
  await expectCode(() => app.orchestrator.requestVerification(ownershipIdentity('anything@example.com'), context), AUTH_ERROR_CODES.INVALID_INPUT);
  assert.equal(provider.sends.length, 0);
});''')
print('patched2')

# 10) native-auth fixtures use an allowed domain
for f in ['native-auth.test.mjs', 'telegram-otp-auth.test.mjs']:
    p = pathlib.Path(f); s = p.read_text()
    p.write_text(s.replace('@example.com', '@gmail.com'))
print('patched3')
