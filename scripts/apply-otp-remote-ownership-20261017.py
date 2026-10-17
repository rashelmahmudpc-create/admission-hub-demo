#!/usr/bin/env python3
"""OTP fixes, owner 2026-10-17 (screenshots: Logto code said "already used",
Logto went before Brevo on a Gmail address, admin save reset every timeout).

1. Logto / Appwrite / Ory / Hanko (provider-evidence slots): a correct code now
   proves email ownership exactly like a Brevo code. completeRemoteChallenge
   records auth_email_ownership_links and returns emailOwnershipProven, so the
   login completes on the first try instead of "code wrong" then "already used".
2. Slot order: the operator priority (plus the deliberate recipient bias and the
   resend demotion) decides the order. Health signals (failure ratio, latency)
   and a half-open circuit only break ties between equal scores, so a fresh
   Logto (15) can no longer jump ahead of a slightly slow Brevo (10).
3. Admin config save: the control center posts only enabled/priority/dailyQuota,
   so every save reset each slot's timeoutMs to 8s and dropped allowedDomains.
   The handler now forwards the raw config and the orchestrator keeps any value
   the panel did not send. adminStatus also reports timeoutMs.

Idempotent. Run from the repo root, then `npm run build:worker`.
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

def edit(rel, pairs):
    path = ROOT / rel
    text = path.read_text(encoding='utf-8')
    for old, new in pairs:
        if new in text:
            continue
        if text.count(old) != 1:
            sys.exit(f'{rel}: anchor not found exactly once: {old[:80]!r}')
        text = text.replace(old, new)
    path.write_text(text, encoding='utf-8')

def append_once(rel, marker, block):
    path = ROOT / rel
    text = path.read_text(encoding='utf-8')
    if marker in text:
        return
    path.write_text(text.rstrip('\n') + '\n' + block, encoding='utf-8')

# ---------------------------------------------------------------- 1. sqlite repo
SQLITE_OLD = """  async completeRemoteChallenge(input) {
    return this.#transaction(() => {
      const selected = this.#challenge(input);
      if (selected.error) return selected;
      const row = selected.challenge;
      this.sql.exec(
        "UPDATE auth_verification_challenges SET state='verified',code_mac='',code_cipher='',link_token_mac='',link_cipher='',verified_at=? WHERE attempt_id=? AND state='sent'",
        input.now, input.attemptId
      );
      this.#event({ ...row, now: input.now, outcome: 'verified', reason: 'provider_evidence' });
      return { verified: true, userId: row.userId, purpose: row.purpose };
    });
  }
"""
SQLITE_NEW = """  async completeRemoteChallenge(input) {
    return this.#transaction(() => {
      const selected = this.#challenge(input);
      if (selected.error) return selected;
      const row = selected.challenge;
      // Owner 2026-10-17: a code checked by Logto/Appwrite/Ory/Hanko proves the
      // address exactly like a locally checked one. Without the ownership link the
      // worker refused the right code and the burned challenge then said "used".
      // The conflict check runs before the challenge is spent.
      const ownership = row.purpose === 'email-ownership';
      if (ownership) {
        const existing = this.#one(
          'SELECT email_ref AS emailRef,subject_ref AS subjectRef,status FROM auth_email_ownership_links WHERE user_id=?',
          row.userId
        );
        if (existing && (existing.subjectRef !== row.subjectRef || existing.emailRef !== row.emailRef)) {
          return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
        }
      }
      this.sql.exec(
        "UPDATE auth_verification_challenges SET state='verified',code_mac='',code_cipher='',link_token_mac='',link_cipher='',verified_at=? WHERE attempt_id=? AND state='sent'",
        input.now, input.attemptId
      );
      if (ownership) {
        this.sql.exec(
          `INSERT INTO auth_email_ownership_links(
            user_id,subject_ref,email_ref,provider_id,method,status,proven_at,last_verified_at,revoked_at
          ) VALUES(?,?,?,?,'email-otp','active',?,?,NULL)
          ON CONFLICT(user_id) DO UPDATE SET
            status='active',provider_id=excluded.provider_id,last_verified_at=excluded.last_verified_at,revoked_at=NULL`,
          row.userId, row.subjectRef, row.emailRef, row.providerId || 'otp', input.now, input.now
        );
      }
      this.#event({ ...row, now: input.now, outcome: 'verified', reason: 'provider_evidence' });
      return {
        verified: true,
        userId: row.userId,
        purpose: row.purpose,
        ...(ownership ? { emailOwnershipProven: true, emailVerified: false } : {})
      };
    });
  }
"""
edit('auth-native/verification/sqlite-verification-repository.mjs', [(SQLITE_OLD, SQLITE_NEW)])

# ---------------------------------------------------------------- 1b. memory repo
MEM_OLD = """  async completeRemoteChallenge(input) {
    const selected = await this.getChallenge(input);
    if (selected.error) return selected;
    const row = this.challenges.get(input.attemptId);
    row.state = 'verified';
"""
MEM_NEW = """  async completeRemoteChallenge(input) {
    const selected = await this.getChallenge(input);
    if (selected.error) return selected;
    const row = this.challenges.get(input.attemptId);
    // Owner 2026-10-17: provider-evidence codes prove ownership too (see sqlite).
    const ownership = row.purpose === 'email-ownership';
    const existingOwnership = ownership ? this.emailOwnership.get(row.userId) : null;
    if (existingOwnership && (existingOwnership.subjectRef !== row.subjectRef || existingOwnership.emailRef !== row.emailRef)) {
      return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
    }
    if (ownership) {
      this.emailOwnership.set(row.userId, {
        userId: row.userId,
        subjectRef: row.subjectRef,
        emailRef: row.emailRef,
        providerId: row.providerId || 'otp',
        method: 'email-otp',
        status: 'active',
        provenAt: existingOwnership?.provenAt || input.now,
        lastVerifiedAt: input.now,
        revokedAt: null
      });
    }
    row.state = 'verified';
"""
MEM_RET_OLD = """    this.#event({ ...row, now: input.now, outcome: 'verified', reason: 'provider_evidence' });
    return { verified: true, userId: row.userId, purpose: row.purpose };
  }
"""
MEM_RET_NEW = """    this.#event({ ...row, now: input.now, outcome: 'verified', reason: 'provider_evidence' });
    return {
      verified: true,
      userId: row.userId,
      purpose: row.purpose,
      ...(ownership ? { emailOwnershipProven: true, emailVerified: false } : {})
    };
  }
"""
edit('auth-native/verification/memory-verification-repository.mjs', [(MEM_OLD, MEM_NEW), (MEM_RET_OLD, MEM_RET_NEW)])

# ---------------------------------------------------------------- 2. order + 3. config merge
ORCH = 'auth-native/verification/orchestrator.mjs'
SCORE_OLD = """          probe: state.circuit === 'half-open',
          score: entry.priority + lowPenalty + failurePenalty + latencyPenalty + recipientBias(entry.id, destinations.otp) + (identity.previousProviderId && identity.previousProviderId === entry.id ? 25 : 0)
        };"""
SCORE_NEW = """          probe: state.circuit === 'half-open',
          // Owner 2026-10-17: Brevo (10) must go before Logto (15) on Gmail. The
          // soft health penalties reach 10, more than that gap, so a fresh Logto
          // jumped ahead. They now only break ties; the order is the operator's
          // priority plus the deliberate recipient bias and resend demotion.
          score: entry.priority + lowPenalty + recipientBias(entry.id, destinations.otp) + (identity.previousProviderId && identity.previousProviderId === entry.id ? 25 : 0),
          health: failurePenalty + latencyPenalty
        };"""
SORT_OLD = "    return rows.filter(Boolean).sort((left, right) => (Number(right.probe) - Number(left.probe)) || left.score - right.score || left.entry.priority - right.entry.priority);"
SORT_NEW = "    return rows.filter(Boolean).sort((left, right) => left.score - right.score || (Number(right.probe) - Number(left.probe)) || left.health - right.health || left.entry.priority - right.entry.priority);"
MERGE_ANCHOR = """function recipientBias(providerId, email) {"""
MERGE_NEW = """// Owner 2026-10-17: the control center posts only enabled/priority/dailyQuota per
// slot and no allowedDomains, so every save reset each timeoutMs to 8s (Logto,
// Apps Script and Telegram need longer). Keep whatever the panel did not send.
function mergeRuntimeConfig(input, current) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const prior = new Map((current?.providers || []).map(row => [row.id, row]));
  const providers = Array.isArray(raw.providers) ? raw.providers.map(row => {
    const known = row && typeof row === 'object' ? prior.get(String(row.id || '')) : null;
    if (!known) return row;
    return { ...row, timeoutMs: row.timeoutMs ?? known.timeoutMs, label: row.label ?? known.label };
  }) : raw.providers;
  const keepDomains = !Array.isArray(raw.allowedDomains) && Array.isArray(current?.allowedDomains);
  return { ...raw, providers, ...(keepDomains ? { allowedDomains: [...current.allowedDomains] } : {}) };
}

function recipientBias(providerId, email) {"""
UPD_OLD = """  async updateConfig(input) {
    const next = verificationConfig(input);"""
UPD_NEW = """  async updateConfig(input) {
    const next = verificationConfig(mergeRuntimeConfig(input, this.config));"""
STATUS_OLD = """        priority: entry.priority,
        availability: availability?.available === true,"""
STATUS_NEW = """        priority: entry.priority,
        timeoutMs: entry.timeoutMs,
        availability: availability?.available === true,"""
edit(ORCH, [(SCORE_OLD, SCORE_NEW), (SORT_OLD, SORT_NEW), (MERGE_ANCHOR, MERGE_NEW), (UPD_OLD, UPD_NEW), (STATUS_OLD, STATUS_NEW)])

HANDLER_OLD = "        const result = await callAuthority(env, '/internal/verification/admin/config', { config: verificationConfig(body.config) });"
HANDLER_NEW = ("        // Allow-listed raw config: the orchestrator normalizes it after keeping the\n"
               "        // values the panel does not send (timeoutMs, allowedDomains).\n"
               "        const result = await callAuthority(env, '/internal/verification/admin/config', { config: adminVerificationConfigInput(body.config) });")
SANITIZE_ANCHOR = "const adminAuthorized = (request, env) => {"
SANITIZE_NEW = """// Owner 2026-10-17: forward only known, non-secret fields, and only the ones the
// admin actually sent. Normalizing here (verificationConfig) filled every missing
// timeoutMs with 8s before the orchestrator could keep the current value.
const ADMIN_POLICY_KEYS = Object.freeze(['codeTtlSeconds', 'maxAttempts', 'resendCooldownSeconds', 'lockoutSeconds', 'maxProviderRetries', 'circuitFailureThreshold', 'circuitCooldownSeconds', 'lowQuotaRatio']);
const ADMIN_PROVIDER_KEYS = Object.freeze(['id', 'enabled', 'priority', 'dailyQuota', 'timeoutMs', 'label']);
const pickKeys = (source, keys) => Object.fromEntries(keys
  .filter(key => Object.prototype.hasOwnProperty.call(source, key))
  .filter(key => ['string', 'number', 'boolean'].includes(typeof source[key]))
  .map(key => [key, source[key]]));
const adminVerificationConfigInput = raw => {
  const sent = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  if (typeof sent.enabled === 'boolean') out.enabled = sent.enabled;
  if (sent.policy && typeof sent.policy === 'object' && !Array.isArray(sent.policy)) out.policy = pickKeys(sent.policy, ADMIN_POLICY_KEYS);
  if (Array.isArray(sent.providers)) {
    out.providers = sent.providers.slice(0, 64)
      .filter(row => row && typeof row === 'object' && !Array.isArray(row))
      .map(row => pickKeys(row, ADMIN_PROVIDER_KEYS));
  }
  if (Array.isArray(sent.allowedDomains)) out.allowedDomains = sent.allowedDomains.filter(value => typeof value === 'string').slice(0, 200);
  return out;
};
const adminAuthorized = (request, env) => {"""
edit('auth-native/worker/public-auth-handler.mjs', [(HANDLER_OLD, HANDLER_NEW), (SANITIZE_ANCHOR, SANITIZE_NEW)])

# ---------------------------------------------------------------- tests
ORCH_TESTS = r"""
// Owner 2026-10-17 (screenshots): Logto code "already used", Logto before Brevo on Gmail.
test('owner 2026-10-17: a correct Logto code proves email ownership on the first try', async () => {
  const logto = new MockProvider({ id: 'otp-h', verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE });
  const app = setup({ providers: [logto], config: allowConfig([logto], ['gmail.com']) });
  const who = ownershipIdentity('student@gmail.com');
  const sent = await app.orchestrator.requestVerification(who, context);
  const verified = await app.orchestrator.verify({ ...who, attemptId: sent.attemptId, code: '325916' }, context);
  assert.equal(verified.verified, true);
  assert.equal(verified.emailOwnershipProven, true, 'the worker gate needs this flag');
  const proven = await app.repository.isEmailOwnershipProven({ userId: who.trustedIdentity.userId, subjectRef: who.trustedIdentity.subjectRef });
  assert.equal(proven.proven, true);
});

test('owner 2026-10-17: Brevo goes before a fresh Logto on Gmail even with a latency and failure history', async () => {
  const brevo = new MockProvider({ id: 'otp-a' });
  const logto = new MockProvider({ id: 'otp-h', verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE });
  const base = allowConfig([brevo, logto], ['gmail.com']);
  const config = { ...base, providers: base.providers.map(row => ({ ...row, priority: row.id === 'otp-a' ? 10 : 15 })) };
  const app = setup({ providers: [brevo, logto], config });
  for (let i = 0; i < 13; i += 1) {
    await app.repository.recordProviderResult({ providerId: 'otp-a', channel: 'otp', success: false, failureClass: VERIFICATION_FAILURE_CLASS.TEMPORARY, reason: 'TIMEOUT', latencyMs: 5000, failureThreshold: 100, cooldownMs: 1000, now: app.now() });
  }
  await app.repository.recordProviderResult({ providerId: 'otp-a', channel: 'otp', success: true, reason: 'ACCEPTED', latencyMs: 2800, failureThreshold: 100, cooldownMs: 1000, now: app.now() });
  await app.orchestrator.requestVerification(ownershipIdentity('student@gmail.com'), context);
  assert.equal(brevo.sends.length, 1, 'Brevo carries the Gmail send');
  assert.equal(logto.sends.length, 0);
});

test('owner 2026-10-17: an admin save without timeoutMs keeps each slot timeout', async () => {
  const brevo = new MockProvider({ id: 'otp-a' });
  const logto = new MockProvider({ id: 'otp-h', verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE });
  const base = rawConfig([brevo, logto]);
  const config = { ...base, allowedDomains: ['gmail.com', 'example.com'], providers: base.providers.map(row => ({ ...row, timeoutMs: row.id === 'otp-h' ? 12000 : 8000 })) };
  const app = setup({ providers: [brevo, logto], config });
  const status = await app.orchestrator.updateConfig({
    enabled: true,
    policy: { codeTtlSeconds: 600 },
    providers: [{ id: 'otp-a', enabled: true, priority: 10, dailyQuota: 300 }, { id: 'otp-h', enabled: true, priority: 15, dailyQuota: 5000 }]
  });
  assert.equal(status.providers.find(row => row.id === 'otp-h').timeoutMs, 12000);
  assert.equal(status.providers.find(row => row.id === 'otp-a').timeoutMs, 8000);
  assert.equal(status.policy.codeTtlSeconds, 600);
  assert.deepEqual([...app.orchestrator.config.allowedDomains], ['gmail.com', 'example.com']);
});
"""
append_once('verification-orchestrator.test.mjs', "owner 2026-10-17: a correct Logto code proves email ownership", ORCH_TESTS)

SQLITE_TESTS = r"""
test('owner 2026-10-17: SQLite records email ownership when Logto checked the code', async t => {
  const fixture = storageFixture();
  t.after(() => fixture.database.close());
  const authRepository = new SqliteAuthRepository(fixture.storage);
  authRepository.migrate();
  const verificationRepository = new SqliteVerificationRepository(fixture.storage);
  verificationRepository.migrate();
  let now = START;
  const engine = new CloudflareNativeAuthEngine({ repository: authRepository, hmacSecret: SECRET, now: () => now });
  const session = await engine.establishFirebaseSession({ email: 'logto.owner@gmail.com', subject: 'firebase-logto-owner' }, CONTEXT);
  const logto = {
    id: 'otp-h', channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE,
    async checkAvailability() { return { available: true, code: 'READY' }; },
    async getRemainingQuota() { return { remaining: 10, limit: 10, resetAt: now + 86_400_000 }; },
    async getProviderStatus() { return { status: 'healthy', configured: true }; },
    async sendVerification() { return { accepted: true }; },
    async verifyCode() { return { verified: true }; }
  };
  const orchestrator = new VerificationOrchestrator({
    repository: verificationRepository, hmacSecret: SECRET, providers: [logto], activated: true, now: () => now,
    config: { enabled: true, providers: [{ id: 'otp-h', enabled: true, priority: 15, dailyQuota: 10, timeoutMs: 12000 }] }
  });
  const who = {
    purpose: 'email-ownership',
    trustedIdentity: { userId: session.user.id, sessionRef: 'a'.repeat(64), subjectRef: 'b'.repeat(64), emailRef: 'c'.repeat(64), email: 'logto.owner@gmail.com' }
  };
  const sent = await orchestrator.requestVerification(who, CONTEXT);
  const verified = await orchestrator.verify({ ...who, attemptId: sent.attemptId, code: '325916' }, CONTEXT);
  assert.equal(verified.emailOwnershipProven, true);
  assert.equal((await verificationRepository.isEmailOwnershipProven({ userId: session.user.id, subjectRef: 'b'.repeat(64) })).proven, true);
});
"""
append_once('sqlite-auth-runtime.test.mjs', "owner 2026-10-17: SQLite records email ownership when Logto", SQLITE_TESTS)

print('otp remote ownership + order + admin merge applied')
