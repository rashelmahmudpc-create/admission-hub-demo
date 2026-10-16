#!/usr/bin/env python3
"""OTP send: a PROVIDER_TIMEOUT fails over to the next slot at once instead of
retrying the same hung provider, and each slot's timeoutMs matches its real speed
(owner 2026-10-16). 429/5xx keep their single retry; verify() is untouched.

Idempotent. Run from the repo root, then `npm run build:worker`.
"""
import pathlib, re, sys

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

# 1. orchestrator send loop: timeout -> next candidate, no same-provider retry.
SEND_ANCHOR = (
    "          if (failure.failureClass === VERIFICATION_FAILURE_CLASS.HARD || providerState.circuit === 'open') break;\n"
    "        }\n"
    "      }\n"
    "    }\n"
    "    await this.repository.failChallenge({ attemptId, reason: 'all_providers_unavailable', now });\n"
)
SEND_NEW = (
    "          if (failure.failureClass === VERIFICATION_FAILURE_CLASS.HARD || providerState.circuit === 'open') break;\n"
    "          // Owner 2026-10-16: a hung provider already burned its whole timeoutMs, so a\n"
    "          // second wait on it only doubles the delay. Move to the next slot at once;\n"
    "          // 429/5xx (also TEMPORARY) keep the single same-provider retry.\n"
    "          if (failure.code === 'PROVIDER_TIMEOUT') break;\n"
    "        }\n"
    "      }\n"
    "    }\n"
    "    await this.repository.failChallenge({ attemptId, reason: 'all_providers_unavailable', now });\n"
)
edit('auth-native/verification/orchestrator.mjs', [(SEND_ANCHOR, SEND_NEW)])

# 2. wrangler.toml: only timeoutMs per slot, plus one comment line.
TIMEOUTS = {
    'otp-a': 8000, 'otp-d': 8000, 'otp-e': 8000, 'otp-f': 8000, 'otp-g': 8000, 'otp-c': 8000,
    'otp-h': 12000, 'otp-i': 12000, 'otp-j': 12000, 'otp-k': 12000,
    'otp-b': 20000, 'telegram': 20000,
}
path = ROOT / 'wrangler.toml'
toml = path.read_text(encoding='utf-8')
lines = toml.split('\n')
idx = [i for i, l in enumerate(lines) if l.startswith("VERIFICATION_ORCHESTRATOR_CONFIG = '")]
if len(idx) != 1:
    sys.exit('wrangler.toml: VERIFICATION_ORCHESTRATOR_CONFIG not found exactly once')
line = lines[idx[0]]
for pid, ms in TIMEOUTS.items():
    rx = re.compile(r'(\{"id":"' + re.escape(pid) + r'",[^}]*?"timeoutMs":)\d+')
    if len(rx.findall(line)) != 1:
        sys.exit(f'wrangler.toml: row {pid} not found exactly once')
    line = rx.sub(lambda m: m.group(1) + str(ms), line)
lines[idx[0]] = line
toml = '\n'.join(lines)
COMMENT_ANCHOR = "# (shared inbox domain) — it is kept only as a final channel, never a primary.\n"
COMMENT = ("# timeoutMs (owner 2026-10-16): a timeout fails over at once (no same-slot retry), so each slot gets its real speed: mailers 8s, Logto/Appwrite/Ory/Hanko 12s, Apps Script otp-b 20s (cold start ~11s), Telegram 20s.\n")
if COMMENT not in toml:
    if toml.count(COMMENT_ANCHOR) != 1:
        sys.exit('wrangler.toml: comment anchor not found exactly once')
    toml = toml.replace(COMMENT_ANCHOR, COMMENT_ANCHOR + COMMENT)
path.write_text(toml, encoding='utf-8')

# 3. orchestrator tests.
TESTS = r'''
test('owner 2026-10-16 (timeout failover): a hung provider is tried once, then the next slot accepts', async () => {
  const hung = new MockProvider({ id: 'otp-a' });
  hung.sendVerification = async input => {
    hung.sends.push(input);
    return new Promise(() => {});
  };
  const next = new MockProvider({ id: 'otp-b' });
  const app = setup({ providers: [hung, next] });
  const started = Date.now();
  const result = await app.orchestrator.requestVerification(identity, context);
  assert.equal(result.accepted, true);
  assert.equal(hung.sends.length, 1, 'no second wait on the hung provider');
  assert.equal(next.sends.length, 1, 'the next slot carries the send');
  assert.ok(Date.now() - started < 1900, 'only one timeoutMs was spent');
});

test('owner 2026-10-16 (timeout failover): a 503 still retries the same provider once', async () => {
  const flaky = new MockProvider({ id: 'otp-a' });
  flaky.sendVerification = async input => {
    flaky.sends.push(input);
    throw new VerificationProviderError('PROVIDER_HTTP_503', VERIFICATION_FAILURE_CLASS.TEMPORARY);
  };
  const next = new MockProvider({ id: 'otp-b' });
  const app = setup({ providers: [flaky, next] });
  const result = await app.orchestrator.requestVerification(identity, context);
  assert.equal(result.accepted, true);
  assert.equal(flaky.sends.length, 2, '503 keeps the single retry');
  assert.equal(next.sends.length, 1);
});

test('wrangler.toml timeoutMs matches each slot speed (owner 2026-10-16)', async () => {
  const { readFile } = await import('node:fs/promises');
  const toml = await readFile(new URL('./wrangler.toml', import.meta.url), 'utf8');
  const rows = JSON.parse(toml.match(/VERIFICATION_ORCHESTRATOR_CONFIG = '(.*)'/)[1]).providers;
  const got = Object.fromEntries(rows.map(row => [row.id, row.timeoutMs]));
  assert.deepEqual(got, {
    'otp-a': 8000, 'otp-h': 12000, 'otp-i': 12000, 'otp-j': 12000, 'otp-k': 12000, 'otp-b': 20000,
    'otp-d': 8000, 'otp-e': 8000, 'otp-f': 8000, 'otp-g': 8000, 'otp-c': 8000, telegram: 20000
  });
});
'''
rel = 'verification-orchestrator.test.mjs'
tpath = ROOT / rel
text = tpath.read_text(encoding='utf-8')
if "test('owner 2026-10-16 (timeout failover): a hung provider" not in text:
    text = text.rstrip('\n') + '\n' + TESTS
    tpath.write_text(text, encoding='utf-8')
print('otp timeout failover applied')
