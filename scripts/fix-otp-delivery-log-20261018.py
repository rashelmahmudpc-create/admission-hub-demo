#!/usr/bin/env python3
"""AUTH-ROADMAP step 0 (2/3): one structured log line per OTP provider try.

Adds `otp_delivery` (per provider try) and `otp_request` (per request) JSON
lines to auth-native/verification/orchestrator.mjs. No email, code, link token
or full attempt id is logged: only provider id, purpose, outcome, reason and
timing, so Workers Logs can answer "which provider sent it and how long it took".
"""
import pathlib, sys

PATH = pathlib.Path('auth-native/verification/orchestrator.mjs')
src = PATH.read_text(encoding='utf-8')
if 'otp_delivery' in src:
    print('already applied'); sys.exit(0)

def sub(old, new, count=1):
    global src
    n = src.count(old)
    if n != count:
        sys.exit(f'anchor matched {n} times (expected {count}): {old[:80]!r}')
    src = src.replace(old, new)

# 1) constructor accepts an injected sink; auth-native itself never logs
#    (native-auth-protection.test.mjs forbids console.* under auth-native/).
sub("""  constructor({ repository, hmacSecret, config, providers = [], activated = false, now = Date.now, cryptoImpl = globalThis.crypto } = {}) {""",
"""  constructor({ repository, hmacSecret, config, providers = [], activated = false, now = Date.now, cryptoImpl = globalThis.crypto, onDeliveryEvent = null } = {}) {""")
sub("""    this.capabilityCache = null;
    const supplied =""",
"""    this.capabilityCache = null;
    // AUTH-ROADMAP step 0 (owner 2026-10-18): optional sink for one event per provider
    // try and one per request (provider id, outcome, reason, timing only). The worker
    // wires observability/otp-delivery-log.mjs here; tests leave it null (silent).
    this.onDeliveryEvent = typeof onDeliveryEvent === 'function' ? onDeliveryEvent : null;
    const supplied =""")


sub('''    const candidates = await this.#candidateRows({ ...identity, attemptId, previousProviderId, deliveryMethod }, destinations, now);
    for (const candidate of candidates) {
      const { entry, provider } = candidate;''',
'''    const candidates = await this.#candidateRows({ ...identity, attemptId, previousProviderId, deliveryMethod }, destinations, now);
    const requestStarted = Date.now();
    const attemptRef = String(attemptId).slice(0, 8);
    const tried = [];
    const logBase = { attempt: attemptRef, purpose: identity.purpose, method: deliveryMethod || 'code', candidates: candidates.length };
    const emit = (evt, fields) => { try { this.onDeliveryEvent?.({ evt, ...fields }); } catch {} };
    const logDelivery = fields => emit('otp_delivery', fields);
    const logRequest = fields => emit('otp_request', fields);
    let rank = 0;
    for (const candidate of candidates) {
      const { entry, provider } = candidate;
      rank += 1;''')

sub('''        if (quota.exhausted) break;
        const started = Date.now();
        let providerAccepted = false;''',
'''        if (quota.exhausted) {
          tried.push(`${entry.id}:quota`);
          logDelivery({ ...logBase, provider: entry.id, rank, try: currentTry + 1, outcome: 'quota_exhausted' });
          break;
        }
        const started = Date.now();
        let providerAccepted = false;''')

sub('''          await this.#record(entry, { attemptId, userId: identity.userId, subjectRef: identity.subjectRef, success: true, reason: 'accepted', latencyMs, now });''',
'''          tried.push(`${entry.id}:ok`);
          logDelivery({ ...logBase, provider: entry.id, label: entry.label, rank, try: currentTry + 1, outcome: 'accepted', latencyMs });
          logRequest({ ...logBase, outcome: 'sent', provider: entry.id, totalMs: Date.now() - requestStarted, tried: tried.join(',') });
          await this.#record(entry, { attemptId, userId: identity.userId, subjectRef: identity.subjectRef, success: true, reason: 'accepted', latencyMs, now });''')

sub('''          const failure = providerFailure(cause);
          const providerState = await this.#record(entry, {''',
'''          const failure = providerFailure(cause);
          tried.push(`${entry.id}:${failure.code}`);
          logDelivery({
            ...logBase, provider: entry.id, label: entry.label, rank, try: currentTry + 1, outcome: 'failed',
            reason: failure.code, failureClass: failure.failureClass, latencyMs: Date.now() - started
          });
          const providerState = await this.#record(entry, {''')

sub('''              await this.repository.failChallenge({ attemptId, reason: failure.code, now });
              throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);''',
'''              await this.repository.failChallenge({ attemptId, reason: failure.code, now });
              logRequest({ ...logBase, outcome: 'invalid_destination', totalMs: Date.now() - requestStarted, tried: tried.join(',') });
              throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);''')

sub('''    await this.repository.failChallenge({ attemptId, reason: 'all_providers_unavailable', now });
    throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);''',
'''    logRequest({ ...logBase, outcome: 'all_failed', totalMs: Date.now() - requestStarted, tried: tried.join(',') });
    await this.repository.failChallenge({ attemptId, reason: 'all_providers_unavailable', now });
    throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);''')

PATH.write_text(src, encoding='utf-8')
print('patched', PATH)

# 2) the Durable Object wires the sink that lives OUTSIDE auth-native.
DO = pathlib.Path('auth-native/worker/auth-authority-do.mjs')
do = DO.read_text(encoding='utf-8')
old_imp = "import { VerificationOrchestrator } from '../verification/orchestrator.mjs';\n"
old_ctor = "        activated: ['canary', 'enabled'].includes(String(env.VERIFICATION_AUTH_ACTIVATION || ''))\n      });"
for old in (old_imp, old_ctor):
    if do.count(old) != 1: sys.exit(f'DO anchor matched {do.count(old)}: {old[:60]!r}')
do = do.replace(old_imp, old_imp + "import { emitOtpDeliveryEvent } from '../../observability/otp-delivery-log.mjs';\n")
do = do.replace(old_ctor, "        activated: ['canary', 'enabled'].includes(String(env.VERIFICATION_AUTH_ACTIVATION || '')),\n        onDeliveryEvent: emitOtpDeliveryEvent\n      });")
DO.write_text(do, encoding='utf-8')
print('patched', DO)
