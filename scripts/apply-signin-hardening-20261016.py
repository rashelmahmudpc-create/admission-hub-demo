"""Owner order 2026-10-16: make signup/sign-in OTP reliable without the admin panel.

Code-level rules that win over the persisted admin-panel config:
 1. otp-f (MailerSend, 0% success, HTTP 422) is disabled in code.
 2. codeTtlSeconds is at least 600 (late Appwrite/Logto mails still verify).
 3. A provider timeout fails over to the next slot at once (no same-slot retry);
    otp-a (Brevo, one HTTP call) is capped at 8s so Gmail users do not wait 30s.
 4. hotmail/live/msn/ymail/rocketmail/yahoo.co.in/yahoo.co.uk/me/mac are always
    allowed whenever an allowlist is active (an empty list still means open).
 5. Slots missing from a persisted panel config (e.g. new otp-j/otp-k) inherit
    their wrangler row instead of silently getting dailyQuota 0.
 6. wrangler: comment no longer names a secret; otp-f off, otp-i quota 1000.
Idempotent. Never touches otp-g/otp-c order.
"""
import json, re

def edit(path, pairs):
    s = open(path, encoding='utf-8').read()
    for old, new, done in pairs:
        if done in s:
            continue
        assert s.count(old) == 1, f'{path}: anchor not found once: {old[:70]!r}'
        s = s.replace(old, new)
    open(path, 'w', encoding='utf-8').write(s)

edit('auth-native/verification/config.mjs', [
    ("export function verificationConfig(raw) {",
     "// Owner 2026-10-16 (code-enforced; wins over the persisted admin-panel config).\n"
     "// otp-f MailerSend never delivered (HTTP 422), so it is off in code.\n"
     "const CODE_DISABLED_SLOTS = new Set(['otp-f']);\n"
     "// Brevo is a single HTTP call; a slow reply must hand over to the next mailer fast.\n"
     "const SLOT_TIMEOUT_CAP_MS = Object.freeze({ 'otp-a': 8_000 });\n"
     "// Late provider mail (Appwrite/Logto) must still verify.\n"
     "const MIN_CODE_TTL_SECONDS = 600;\n"
     "// Common Bangladeshi student mailboxes, always allowed whenever an allowlist is active.\n"
     "export const ALWAYS_ALLOWED_DOMAINS = Object.freeze(['hotmail.com', 'live.com', 'msn.com', 'ymail.com', 'rocketmail.com', 'yahoo.co.in', 'yahoo.co.uk', 'me.com', 'mac.com']);\n"
     "const withAlwaysAllowed = list => (list.length ? [...list, ...ALWAYS_ALLOWED_DOMAINS] : list);\n\n"
     "// A persisted panel config saved before a slot existed has no row for it, which\n"
     "// would leave that slot at dailyQuota 0 forever. Inherit the deployment row instead.\n"
     "export function withMissingSlotsFrom(primary, fallbackRaw) {\n"
     "  if (!primary || typeof primary !== 'object' || !Array.isArray(primary.providers)) return primary;\n"
     "  const fallback = typeof fallbackRaw === 'string' ? safeJson(fallbackRaw) : (fallbackRaw && typeof fallbackRaw === 'object' ? fallbackRaw : {});\n"
     "  const have = new Set(primary.providers.map(row => String(row?.id || '')));\n"
     "  const extra = (Array.isArray(fallback.providers) ? fallback.providers : []).filter(row => row && !have.has(String(row.id || '')));\n"
     "  return extra.length ? { ...primary, providers: [...primary.providers, ...extra] } : primary;\n"
     "}\n\n"
     "export function verificationConfig(raw) {",
     "const CODE_DISABLED_SLOTS"),
    ("    codeTtlSeconds: int(policyInput.codeTtlSeconds, DEFAULT_POLICY.codeTtlSeconds, 60, 600),",
     "    codeTtlSeconds: Math.max(MIN_CODE_TTL_SECONDS, int(policyInput.codeTtlSeconds, DEFAULT_POLICY.codeTtlSeconds, 60, 600)),",
     "Math.max(MIN_CODE_TTL_SECONDS"),
    ("      enabled: bool(row.enabled),",
     "      enabled: bool(row.enabled) && !CODE_DISABLED_SLOTS.has(id),",
     "!CODE_DISABLED_SLOTS.has(id)"),
    ("      timeoutMs: int(row.timeoutMs, 8_000, 1_000, 20_000),",
     "      timeoutMs: Math.min(int(row.timeoutMs, 8_000, 1_000, 20_000), SLOT_TIMEOUT_CAP_MS[id] || 20_000),",
     "SLOT_TIMEOUT_CAP_MS[id]"),
    ("  const allowedDomains = Object.freeze((Array.isArray(input.allowedDomains) ? input.allowedDomains : OWNER_ALLOWED_DOMAINS)\n",
     "  const allowedDomains = Object.freeze([...new Set(withAlwaysAllowed(Array.isArray(input.allowedDomains) ? input.allowedDomains : OWNER_ALLOWED_DOMAINS)\n",
     "withAlwaysAllowed(Array.isArray"),
])
# close the Set(...) spread opened above
p = 'auth-native/verification/config.mjs'
s = open(p, encoding='utf-8').read()
old = "    .filter(value => /^[a-z0-9.-]+$/.test(value) && value.length <= 253)\n    .slice(0, 200));"
new = "    .filter(value => /^[a-z0-9.-]+$/.test(value) && value.length <= 253))]\n    .slice(0, 200));"
if new not in s:
    assert s.count(old) == 1, 'allowlist tail anchor'
    s = s.replace(old, new)
open(p, 'w', encoding='utf-8').write(s)

edit('auth-native/verification/orchestrator.mjs', [
    ("          if (failure.failureClass === VERIFICATION_FAILURE_CLASS.HARD || providerState.circuit === 'open') break;\n",
     "          // Owner 2026-10-16: a timed-out mailer is not retried; the next slot sends at once.\n"
     "          if (failure.code === 'PROVIDER_TIMEOUT') break;\n"
     "          if (failure.failureClass === VERIFICATION_FAILURE_CLASS.HARD || providerState.circuit === 'open') break;\n",
     "if (failure.code === 'PROVIDER_TIMEOUT') break;"),
])

edit('auth-native/worker/auth-authority-do.mjs', [
    ("import { createConfiguredVerificationProviders } from '../verification/providers.mjs';\n",
     "import { createConfiguredVerificationProviders } from '../verification/providers.mjs';\n"
     "import { withMissingSlotsFrom } from '../verification/config.mjs';\n",
     "import { withMissingSlotsFrom }"),
    ("        config: persistedVerificationConfig || env.VERIFICATION_ORCHESTRATOR_CONFIG,\n",
     "        config: withMissingSlotsFrom(persistedVerificationConfig, env.VERIFICATION_ORCHESTRATOR_CONFIG) || env.VERIFICATION_ORCHESTRATOR_CONFIG,\n",
     "withMissingSlotsFrom(persistedVerificationConfig"),
])

# wrangler.toml: no secret name in comments; mirror the panel (otp-f off, otp-i 1000)
w = 'wrangler.toml'
t = open(w, encoding='utf-8').read()
t = t.replace('Optional secret APPWRITE_API_KEY.', 'An optional Appwrite server key may be bound as a Worker secret.')
m = re.search(r"^VERIFICATION_ORCHESTRATOR_CONFIG = '(.*)'$", t, re.M)
assert m, 'orchestrator config line'
cfg = json.loads(m.group(1))
for row in cfg['providers']:
    if row['id'] == 'otp-f':
        row['enabled'] = False
    if row['id'] == 'otp-i':
        row['dailyQuota'] = max(int(row.get('dailyQuota') or 0), 1000)
line = "VERIFICATION_ORCHESTRATOR_CONFIG = '" + json.dumps(cfg, separators=(',', ':'), ensure_ascii=False) + "'"
t = t[:m.start()] + line + t[m.end():]
open(w, 'w', encoding='utf-8').write(t)

# tests
tp = 'verification-orchestrator.test.mjs'
x = open(tp, encoding='utf-8').read()
x = x.replace("assert.equal(updated.policy.codeTtlSeconds, 240);", "assert.equal(updated.policy.codeTtlSeconds, 600, 'code TTL never drops below 10 minutes');")
x = x.replace("new MockProvider({ id: 'otp-f' });\n    mailersend.sendVerification", "new MockProvider({ id: 'otp-d' });\n    mailersend.sendVerification")
x = x.replace("const first = new MockProvider({ id: 'otp-f', sendPlan: ['user'] });", "const first = new MockProvider({ id: 'otp-d', sendPlan: ['user'] });")
marker = 'owner 2026-10-16 (signin hardening)'
if marker not in x:
    x = x.rstrip('\n') + '\n' + r'''
test('owner 2026-10-16 (signin hardening): MailerSend otp-f stays off even when the panel enables it', async () => {
  const mailersend = new MockProvider({ id: 'otp-f' });
  const next = new MockProvider({ id: 'otp-g' });
  const app = setup({ providers: [mailersend, next] });
  await app.orchestrator.requestVerification(identity, context);
  assert.equal(mailersend.sends.length, 0, 'otp-f is disabled in code');
  assert.equal(next.sends.length, 1);
});

test('owner 2026-10-16 (signin hardening): a provider timeout hands over to the next slot without a retry', async () => {
  const slow = new MockProvider({ id: 'otp-a' });
  slow.sendVerification = async input => {
    slow.sends.push(input);
    throw new VerificationProviderError('PROVIDER_TIMEOUT', VERIFICATION_FAILURE_CLASS.TEMPORARY);
  };
  const next = new MockProvider({ id: 'otp-b' });
  const app = setup({ providers: [slow, next] });
  const result = await app.orchestrator.requestVerification(identity, context);
  assert.equal(result.accepted, true);
  assert.equal(slow.sends.length, 1, 'no second wait on the same slow mailer');
  assert.equal(next.sends.length, 1);
});

test('owner 2026-10-16 (signin hardening): hotmail and ymail students can take an email-ownership OTP', async () => {
  for (const email of ['student@hotmail.com', 'student@ymail.com', 'student@yahoo.co.in']) {
    const provider = new MockProvider({ id: 'otp-a' });
    const app = setup({ providers: [provider], config: allowConfig([provider], ['gmail.com', 'yahoo.com', 'icloud.com', 'outlook.com']) });
    const result = await app.orchestrator.requestVerification(ownershipIdentity(email), context);
    assert.equal(result.accepted, true, email);
  }
});
'''
open(tp, 'w', encoding='utf-8').write(x)

cp = 'verification-config-hardening.test.mjs'
open(cp, 'w', encoding='utf-8').write(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { verificationConfig, withMissingSlotsFrom } from './auth-native/verification/config.mjs';

test('owner 2026-10-16: panel config cannot shorten the code below 10 minutes', () => {
  assert.equal(verificationConfig({ policy: { codeTtlSeconds: 300 } }).policy.codeTtlSeconds, 600);
  assert.equal(verificationConfig({}).policy.codeTtlSeconds, 600);
});

test('owner 2026-10-16: otp-f is off and Brevo waits at most 8s', () => {
  const cfg = verificationConfig({ providers: [{ id: 'otp-f', enabled: true, dailyQuota: 100 }, { id: 'otp-a', enabled: true, dailyQuota: 300, timeoutMs: 15000 }] });
  assert.equal(cfg.providers.find(row => row.id === 'otp-f').enabled, false);
  assert.equal(cfg.providers.find(row => row.id === 'otp-a').timeoutMs, 8000);
});

test('owner 2026-10-16: common student mailboxes are always allowed; an empty list stays open', () => {
  const cfg = verificationConfig({ allowedDomains: ['gmail.com'] });
  for (const domain of ['gmail.com', 'hotmail.com', 'live.com', 'ymail.com', 'yahoo.co.in']) assert.ok(cfg.allowedDomains.includes(domain), domain);
  assert.equal(new Set(cfg.allowedDomains).size, cfg.allowedDomains.length, 'no duplicates');
  assert.deepEqual(verificationConfig({ allowedDomains: [] }).allowedDomains, []);
});

test('owner 2026-10-16: slots missing from a saved panel config inherit the deployment row', () => {
  const saved = { enabled: true, providers: [{ id: 'otp-a', enabled: true, dailyQuota: 300 }] };
  const env = JSON.stringify({ enabled: true, providers: [{ id: 'otp-a', enabled: false, dailyQuota: 1 }, { id: 'otp-h', enabled: true, priority: 15, dailyQuota: 5000 }] });
  const merged = withMissingSlotsFrom(saved, env);
  assert.equal(merged.providers.find(row => row.id === 'otp-a').dailyQuota, 300, 'panel row wins');
  assert.equal(merged.providers.find(row => row.id === 'otp-h').dailyQuota, 5000, 'missing slot inherited');
  assert.equal(withMissingSlotsFrom(null, env), null);
});
''')
print('applied')
