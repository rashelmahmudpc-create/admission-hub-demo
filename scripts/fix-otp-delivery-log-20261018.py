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

HELPER = '''
// AUTH-ROADMAP step 0 (owner 2026-10-18): one JSON line per provider try and one per
// request, so Workers Logs shows which provider carried an OTP, how long it took and
// why a slot failed. Never logs the address, code, link token or full attempt id.
const PROVIDER_NAMES = Object.freeze({
  'otp-a': 'Brevo', 'otp-b': 'AppsScript', 'otp-c': 'Mailjet', 'otp-d': 'Resend',
  'otp-e': 'AgentMail', 'otp-f': 'MailerSend', 'otp-g': 'DeadSimple', 'otp-h': 'Logto',
  'otp-i': 'Appwrite', 'otp-j': 'Ory', 'otp-k': 'Hanko', 'otp-l': 'Descope-OTP',
  'otp-m': 'Descope-MagicLink', telegram: 'Telegram'
});
function logDelivery(fields) {
  try { console.log(JSON.stringify({ evt: 'otp_delivery', name: PROVIDER_NAMES[fields.provider] || fields.provider, ...fields })); } catch {}
}
function logRequest(fields) {
  try { console.log(JSON.stringify({ evt: 'otp_request', ...(fields.provider ? { name: PROVIDER_NAMES[fields.provider] || fields.provider } : {}), ...fields })); } catch {}
}

async function bounded(action, milliseconds) {'''
sub('\nasync function bounded(action, milliseconds) {', HELPER)

sub('''    const candidates = await this.#candidateRows({ ...identity, attemptId, previousProviderId, deliveryMethod }, destinations, now);
    for (const candidate of candidates) {
      const { entry, provider } = candidate;''',
'''    const candidates = await this.#candidateRows({ ...identity, attemptId, previousProviderId, deliveryMethod }, destinations, now);
    const requestStarted = Date.now();
    const attemptRef = String(attemptId).slice(0, 8);
    const tried = [];
    const logBase = { attempt: attemptRef, purpose: identity.purpose, method: deliveryMethod || 'code', candidates: candidates.length };
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
