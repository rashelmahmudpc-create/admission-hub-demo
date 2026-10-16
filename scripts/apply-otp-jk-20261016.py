#!/usr/bin/env python3
"""Add otp-j (Ory Network one-time code) and otp-k (Hanko Cloud passcode) as
provider-evidence OTP slots at priority 38 (owner 2026-10-16).

Idempotent. Run from the repo root, then `npm run build:worker`.
"""
import json, pathlib, re, sys

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

PROVIDERS = r'''// Shared KV/memory store for provider-evidence slots that must remember a
// provider-side flow between send and verify (otp-j Ory, otp-k Hanko).
function evidenceStateStore(prefix, ttlSeconds, kv, now) {
  const memory = new Map();
  const key = attemptId => `${prefix}:${attemptId}`;
  return {
    async save(attemptId, state) {
      const expires = Number(now()) + ttlSeconds * 1000;
      memory.set(attemptId, { ...state, expires });
      for (const [id, row] of memory) if (row.expires < Number(now())) memory.delete(id);
      if (kv) { try { await kv.put(key(attemptId), JSON.stringify(state), { expirationTtl: ttlSeconds }); } catch {} }
    },
    async load(attemptId) {
      const row = memory.get(attemptId);
      if (row && row.expires >= Number(now())) return row;
      if (!kv) return null;
      try { const raw = await kv.get(key(attemptId)); return raw ? JSON.parse(raw) : null; } catch { return null; }
    },
    async drop(attemptId) {
      memory.delete(attemptId);
      if (kv && typeof kv.delete === 'function') { try { await kv.delete(key(attemptId)); } catch {} }
    }
  };
}
const validOtpAttemptId = value => /^[A-Za-z0-9_-]{24,96}$/.test(String(value || ''));

// Slot `otp-j` is Ory Network's built-in one-time code (project "Admission Sky",
// free Developer plan). Ory creates, mails (its own SMTP, sender
// "Admission Sky via Ory") and checks the code, so the slot is provider-evidence.
// It drives the public native self-service API with no secret:
//   GET  /self-service/login/api                -> flow id
//   POST /self-service/login?flow=<id>           {"method":"code","identifier":email}
// and, when Ory answers 4000035 (no such account), the registration flow with
// traits.email instead. Verify posts the code to the same flow; the session that a
// correct code yields is revoked straight away via DELETE /self-service/logout/api.
// Probed live 2026-10-16 (login + registration, both mailboxes, logout -> 401).
const ORY_STATE_TTL_SECONDS = 900;
// Public, non-secret values live in code for the 64-variable reason (see Logto).
const ORY_PUBLIC_DEFAULTS = Object.freeze({
  endpoint: 'https://ecstatic-torvalds-2tcj5aljui.projects.oryapis.com'
});
const ORY_ACCOUNT_UNKNOWN = 4000035;
function oryEndpoint(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port) return '';
    if (url.pathname.replace(/\/+$/, '') !== '') return '';
    if (!/^[a-z0-9][a-z0-9-]{2,80}\.projects\.oryapis\.com$/.test(url.hostname)) return '';
    return url.origin;
  } catch { return ''; }
}
const validOryFlowId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
const oryMessageIds = payload => (Array.isArray(payload?.ui?.messages) ? payload.ui.messages : []).map(row => Number(row?.id));
const orySentEmail = result => [200, 400].includes(Number(result.response.status)) && result.payload?.state === 'sent_email';

export class OryOtpVerificationProvider {
  constructor({ id = 'otp-j', endpoint, declaredDailyQuota, kv = null, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.PROVIDER_EVIDENCE;
    this.endpoint = oryEndpoint(endpoint);
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.kv = kv && typeof kv.get === 'function' && typeof kv.put === 'function' ? kv : null;
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.state = evidenceStateStore('ory-otp', ORY_STATE_TTL_SECONDS, this.kv, this.now);
    this.configured = Boolean(this.endpoint && this.declaredDailyQuota && this.fetch);
  }

  async #call(path, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await this.fetch(`${this.endpoint}${path}`, {
        method,
        redirect: 'manual',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-store', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(8_000)
      });
    } catch { throw new VerificationProviderError('NETWORK_ERROR', VERIFICATION_FAILURE_CLASS.TEMPORARY); }
    const payload = response.status === 204 ? {} : await boundedJson(response);
    return { response, payload };
  }

  async #flow(kind) {
    const result = await this.#call(`/self-service/${kind}/api`);
    if (!result.response.ok) throw httpFailure(result.response, result.payload, { userStatuses: [] });
    const flowId = String(result.payload?.id || '');
    if (!validOryFlowId(flowId)) throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    return flowId;
  }

  #submit(kind, flowId, body) {
    return this.#call(`/self-service/${kind}?flow=${encodeURIComponent(flowId)}`, { method: 'POST', body });
  }

  // 400 without `sent_email` means the project refused (e.g. code method off): a
  // config fault, so the orchestrator moves on instead of blaming the student.
  #failure(result) {
    const status = Number(result.response.status);
    if (status === 400 || result.response.ok) return new VerificationProviderError('PROVIDER_REJECTED', VERIFICATION_FAILURE_CLASS.HARD);
    if (status === 410) return new VerificationProviderError('PROVIDER_HTTP_410', VERIFICATION_FAILURE_CLASS.TEMPORARY, { retryAfter: 5 });
    return httpFailure(result.response, result.payload, { userStatuses: [] });
  }

  async #discardSession(sessionToken) {
    try { await this.#call('/self-service/logout/api', { method: 'DELETE', body: { session_token: sessionToken } }); } catch {}
  }

  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    return { available: true, code: 'READY' };
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    return { remaining: this.declaredDailyQuota, limit: this.declaredDailyQuota, resetAt: nextUtcMidnight(this.now()), source: 'declared' };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '').trim().toLowerCase();
    const attemptId = String(input.attemptId || '');
    if (!validEmailAddress(destination) || !validOtpAttemptId(attemptId)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    const loginFlow = await this.#flow('login');
    const login = await this.#submit('login', loginFlow, { method: 'code', identifier: destination });
    if (orySentEmail(login)) {
      await this.state.save(attemptId, { kind: 'login', flowId: loginFlow, email: destination });
      return { accepted: true };
    }
    if (!(Number(login.response.status) === 400 && oryMessageIds(login.payload).includes(ORY_ACCOUNT_UNKNOWN))) throw this.#failure(login);
    const registrationFlow = await this.#flow('registration');
    const registration = await this.#submit('registration', registrationFlow, { method: 'code', traits: { email: destination } });
    if (!orySentEmail(registration)) throw this.#failure(registration);
    await this.state.save(attemptId, { kind: 'registration', flowId: registrationFlow, email: destination });
    return { accepted: true };
  }

  async verifyCode(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const attemptId = String(input.attemptId || '');
    const code = String(input.evidence || '').trim();
    if (!/^\d{6}$/.test(code)) return { verified: false };
    const state = await this.state.load(attemptId);
    if (!state?.flowId || !['login', 'registration'].includes(state.kind)) throw new VerificationProviderError('CHALLENGE_EXPIRED', VERIFICATION_FAILURE_CLASS.USER);
    const body = state.kind === 'registration'
      ? { method: 'code', code, traits: { email: state.email } }
      : { method: 'code', code, identifier: state.email };
    const result = await this.#submit(state.kind, state.flowId, body);
    const status = Number(result.response.status);
    const sessionToken = String(result.payload?.session_token || '');
    if (result.response.ok && sessionToken) {
      const identity = result.payload?.session?.identity || result.payload?.identity || {};
      const email = String(identity?.traits?.email || '').trim().toLowerCase();
      await this.state.drop(attemptId);
      await this.#discardSession(sessionToken);
      if (email !== state.email) throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
      return { verified: true };
    }
    if (status === 400) return { verified: false };
    if (status === 410 || status === 403) {
      await this.state.drop(attemptId);
      throw new VerificationProviderError('CHALLENGE_EXPIRED', VERIFICATION_FAILURE_CLASS.USER);
    }
    throw httpFailure(result.response, result.payload, { userStatuses: [] });
  }

  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: 'ory' };
  }
}

// Slot `otp-k` is Hanko Cloud's email passcode (free plan, 10,000 MAU, Hanko's
// own mailer). Hanko creates, mails and checks the code, so the slot is
// provider-evidence. It drives the public Flow API (POST /registration, /login,
// /profile) with no secret; every step returns the next action href + csrf token,
// and no cookie is needed. Project settings this relies on (owner 2026-10-16):
// passwords OFF, account deletion ON.
// Hanko hides whether an address exists: a login for an unknown address and a
// registration for a known one both look accepted but mail a notice instead of a
// code. So every verified address is deleted from Hanko straight after the check
// (profile flow `account_delete`), which keeps every next send a fresh
// registration. Only if that deletion fails is a hashed "known" marker kept in KV
// so the next send uses the login flow instead.
const HANKO_STATE_TTL_SECONDS = 900;
const HANKO_KNOWN_TTL_SECONDS = 31_536_000;
const HANKO_PUBLIC_DEFAULTS = Object.freeze({
  endpoint: 'https://9b4c7063-c179-4586-8481-a415631a710a.hanko.io'
});
const HANKO_SKIPPABLE = new Set(['mfa_method_chooser', 'passkey_onboarding', 'credential_onboarding_chooser']);
function hankoEndpoint(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port) return '';
    if (url.pathname.replace(/\/+$/, '') !== '') return '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.hanko\.io$/.test(url.hostname)) return '';
    return url.origin;
  } catch { return ''; }
}
const validHankoHref = value => typeof value === 'string' && /^\/[A-Za-z0-9_\-/?=&%@.~]{1,511}$/.test(value) && !value.startsWith('//');

export class HankoOtpVerificationProvider {
  constructor({ id = 'otp-k', endpoint, declaredDailyQuota, kv = null, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.PROVIDER_EVIDENCE;
    this.endpoint = hankoEndpoint(endpoint);
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.kv = kv && typeof kv.get === 'function' && typeof kv.put === 'function' ? kv : null;
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.state = evidenceStateStore('hanko-otp', HANKO_STATE_TTL_SECONDS, this.kv, this.now);
    this.knownMemory = new Set();
    this.configured = Boolean(this.endpoint && this.declaredDailyQuota && this.fetch);
  }

  async #call(path, { body = {}, token = '' } = {}) {
    let response;
    try {
      response = await this.fetch(`${this.endpoint}${path}`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8_000)
      });
    } catch { throw new VerificationProviderError('NETWORK_ERROR', VERIFICATION_FAILURE_CLASS.TEMPORARY); }
    const payload = response.status === 204 ? {} : await boundedJson(response);
    return { response, payload };
  }

  #act(payload, name, inputData = {}, token = '') {
    const href = payload?.actions?.[name]?.href;
    if (!validHankoHref(href)) throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    return this.#call(href, { body: { input_data: inputData, csrf_token: String(payload?.csrf_token || '') }, token });
  }

  #ok(result) {
    if (!result.response.ok) throw httpFailure(result.response, result.payload, { userStatuses: [] });
    return result.payload;
  }

  async #start(path, token = '') {
    let payload = this.#ok(await this.#call(path, { token }));
    if (payload?.name === 'preflight') payload = this.#ok(await this.#act(payload, 'register_client_capabilities', { webauthn_available: false }, token));
    return payload;
  }

  async #knownKey(email) { return `hanko-known:${await sha256Base64Url(email)}`; }
  async #isKnown(email) {
    if (this.knownMemory.has(email)) return true;
    if (!this.kv) return false;
    try { return Boolean(await this.kv.get(await this.#knownKey(email))); } catch { return false; }
  }
  async #setKnown(email, known) {
    if (known) this.knownMemory.add(email); else this.knownMemory.delete(email);
    if (!this.kv) return;
    try {
      const key = await this.#knownKey(email);
      if (known) await this.kv.put(key, '1', { expirationTtl: HANKO_KNOWN_TTL_SECONDS });
      else if (typeof this.kv.delete === 'function') await this.kv.delete(key);
    } catch {}
  }

  // The session only proves the code was right: delete the Hanko account it
  // belongs to; fall back to logout and remember the address as known.
  async #discardAccount(token, email) {
    try {
      const profile = await this.#start('/profile', token);
      if (profile?.actions?.account_delete) {
        const deleted = await this.#act(profile, 'account_delete', {}, token);
        if (deleted.response.ok && deleted.payload?.name === 'account_deleted') { await this.#setKnown(email, false); return; }
      }
    } catch {}
    await this.#setKnown(email, true);
    try { await this.#call('/logout', { token }); } catch {}
  }

  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    return { available: true, code: 'READY' };
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    return { remaining: this.declaredDailyQuota, limit: this.declaredDailyQuota, resetAt: nextUtcMidnight(this.now()), source: 'declared' };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '').trim().toLowerCase();
    const attemptId = String(input.attemptId || '');
    if (!validEmailAddress(destination) || !validOtpAttemptId(attemptId)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    let payload;
    if (await this.#isKnown(destination)) {
      payload = await this.#start('/login');
      payload = this.#ok(await this.#act(payload, 'continue_with_login_identifier', { email: destination }));
      if (payload?.name === 'login_method_chooser') payload = this.#ok(await this.#act(payload, 'continue_to_passcode_confirmation'));
    } else {
      payload = await this.#start('/registration');
      payload = this.#ok(await this.#act(payload, 'register_login_identifier', { email: destination }));
    }
    const href = payload?.actions?.verify_passcode?.href;
    if (payload?.name !== 'passcode_confirmation' || !validHankoHref(href)) throw new VerificationProviderError('PROVIDER_REJECTED', VERIFICATION_FAILURE_CLASS.HARD);
    await this.state.save(attemptId, { email: destination, href, csrf: String(payload.csrf_token || '') });
    return { accepted: true };
  }

  async verifyCode(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const attemptId = String(input.attemptId || '');
    const code = String(input.evidence || '').trim();
    if (!/^\d{6}$/.test(code)) return { verified: false };
    const state = await this.state.load(attemptId);
    if (!state?.href || !validHankoHref(state.href)) throw new VerificationProviderError('CHALLENGE_EXPIRED', VERIFICATION_FAILURE_CLASS.USER);
    let result = await this.#act({ csrf_token: state.csrf, actions: { verify_passcode: { href: state.href } } }, 'verify_passcode', { code });
    let payload = result.payload;
    if (!result.response.ok || payload?.name === 'passcode_confirmation') {
      const status = Number(result.response.status);
      if (status === 429 || status >= 500 || status === 0) throw httpFailure(result.response, payload, { userStatuses: [] });
      const next = payload?.actions?.verify_passcode?.href;
      if (payload?.name === 'passcode_confirmation' && validHankoHref(next)) {
        // Each Hanko step issues a fresh href + csrf token; the next try must use them.
        await this.state.save(attemptId, { email: state.email, href: next, csrf: String(payload.csrf_token || '') });
        return { verified: false };
      }
      await this.state.drop(attemptId);
      throw new VerificationProviderError('CHALLENGE_EXPIRED', VERIFICATION_FAILURE_CLASS.USER);
    }
    for (let step = 0; step < 3 && HANKO_SKIPPABLE.has(payload?.name) && payload?.actions?.skip; step += 1) {
      result = await this.#act(payload, 'skip');
      payload = this.#ok(result);
    }
    if (payload?.name !== 'success') {
      await this.state.drop(attemptId);
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    await this.state.drop(attemptId);
    const token = String(result.response?.headers?.get?.('X-Auth-Token') || '');
    if (token && token.length <= 4096 && !/[\r\n\s]/.test(token)) await this.#discardAccount(token, state.email);
    else await this.#setKnown(state.email, true);
    return { verified: true };
  }

  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: 'hanko' };
  }
}

'''

FACTORY_OLD = '''  return [
    brevoOtpA.configured ? brevoOtpA : bridgeOtpA,'''
FACTORY_NEW = '''  const orySlot = slotFromConfig(env.VERIFICATION_ORCHESTRATOR_CONFIG, 'otp-j');
  const oryOtpJ = new OryOtpVerificationProvider({
    id: 'otp-j',
    endpoint: orySlot ? ORY_PUBLIC_DEFAULTS.endpoint : '',
    declaredDailyQuota: orySlot ? orySlot.dailyQuota : '',
    kv: env.GK_KV || null,
    fetchImpl
  });
  const hankoSlot = slotFromConfig(env.VERIFICATION_ORCHESTRATOR_CONFIG, 'otp-k');
  const hankoOtpK = new HankoOtpVerificationProvider({
    id: 'otp-k',
    endpoint: hankoSlot ? HANKO_PUBLIC_DEFAULTS.endpoint : '',
    declaredDailyQuota: hankoSlot ? hankoSlot.dailyQuota : '',
    kv: env.GK_KV || null,
    fetchImpl
  });
  return [
    brevoOtpA.configured ? brevoOtpA : bridgeOtpA,'''

edit('auth-native/verification/providers.mjs', [
    ('export class TelegramLinkVerificationProvider {', PROVIDERS + 'export class TelegramLinkVerificationProvider {'),
    (FACTORY_OLD, FACTORY_NEW),
    ('    appwriteOtpI,\n    new OfficialWhatsAppVerificationProvider({', '    appwriteOtpI,\n    oryOtpJ,\n    hankoOtpK,\n    new OfficialWhatsAppVerificationProvider({'),
])

I_LINE = "  'otp-i': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),\n"
JK = ("  'otp-j': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),\n"
      "  'otp-k': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 38 }),\n")
edit('auth-native/verification/config.mjs', [(I_LINE, I_LINE + JK)])

I_ROW = '{"id":"otp-i","enabled":true,"priority":38,"dailyQuota":300,"timeoutMs":20000,"label":"secure backup"},'
JK_ROWS = ('{"id":"otp-j","enabled":true,"priority":38,"dailyQuota":300,"timeoutMs":20000,"label":"secure backup"},'
           '{"id":"otp-k","enabled":true,"priority":38,"dailyQuota":300,"timeoutMs":20000,"label":"secure backup"},')
I_NOTE = '# dailyQuota 300 above is our own safety cap. Optional secret APPWRITE_API_KEY.\n'
JK_NOTE = (I_NOTE +
    '# otp-j is Ory Network one-time code (project "Admission Sky", free Developer plan),\n'
    '# added 2026-10-16. Ory mails the code from its own SMTP (sender "Admission Sky via\n'
    '# Ory"; subject/body are Ory\'s default and stay so: changing them needs own SMTP).\n'
    '# Public native self-service API, no secret; the session a correct code yields is\n'
    '# revoked at once. Endpoint lives in providers.mjs (ORY_PUBLIC_DEFAULTS).\n'
    '# otp-k is Hanko Cloud passcode (free, 10,000 MAU; Hanko\'s own mailer), added\n'
    '# 2026-10-16. Public Flow API, no secret. Needs passwords OFF and account deletion\n'
    '# ON in the Hanko console: each verified address is deleted from Hanko right after\n'
    '# the check. Endpoint lives in providers.mjs (HANKO_PUBLIC_DEFAULTS).\n'
    '# Both sit at priority 38 like otp-i (ties sort by id: f, i, j, k), after every\n'
    '# branded mailer and before the locked last-resort pair; dailyQuota 300 is our\n'
    '# own cap. No new vars or secrets (64-variable ceiling).\n')
edit('wrangler.toml', [(I_ROW, I_ROW + JK_ROWS), (I_NOTE, JK_NOTE)])

toml = (ROOT / 'wrangler.toml').read_text(encoding='utf-8')
rows = json.loads(re.search(r"VERIFICATION_ORCHESTRATOR_CONFIG = '(.*)'", toml).group(1))['providers']
order = [r['id'] for r in sorted(rows, key=lambda r: (r['priority'], r['id']))]
print(order)
assert order.index('otp-f') < order.index('otp-i') < order.index('otp-j') < order.index('otp-k') < order.index('otp-g') < order.index('otp-c') < order.index('telegram'), order
for name in ('ORY_', 'HANKO_', 'OTP_J_', 'OTP_K_'):
    assert not re.search(rf'^{name}\w*\s*=', toml, re.M), name

OLD_IDS = "['otp-a', 'otp-b', 'otp-c', 'otp-d', 'otp-e', 'otp-f', 'otp-g', 'otp-h', 'otp-i', 'whatsapp', 'telegram']"
NEW_IDS = "['otp-a', 'otp-b', 'otp-c', 'otp-d', 'otp-e', 'otp-f', 'otp-g', 'otp-h', 'otp-i', 'otp-j', 'otp-k', 'whatsapp', 'telegram']"
TESTS = r'''

const JK_CONFIG = JSON.stringify({ enabled: true, providers: [{ id: 'otp-j', enabled: true, dailyQuota: 300 }, { id: 'otp-k', enabled: true, dailyQuota: 300 }] });
const ORY = 'https://ecstatic-torvalds-2tcj5aljui.projects.oryapis.com';
const HANKO = 'https://9b4c7063-c179-4586-8481-a415631a710a.hanko.io';
const ORY_FLOW = '11111111-2222-4333-8444-555555555555';

test('otp-j Ory and otp-k Hanko use their public defaults only when the owner enabled the slot', async () => {
  for (const id of ['otp-j', 'otp-k']) {
    assert.equal(createConfiguredVerificationProviders({}).find(row => row.id === id).configured, false, id);
    const disabled = createConfiguredVerificationProviders({
      VERIFICATION_ORCHESTRATOR_CONFIG: JSON.stringify({ enabled: true, providers: [{ id, enabled: false, dailyQuota: 300 }] })
    }).find(row => row.id === id);
    assert.equal(disabled.configured, false, id);
    const off = createConfiguredVerificationProviders({
      VERIFICATION_ORCHESTRATOR_CONFIG: JSON.stringify({ enabled: false, providers: [{ id, enabled: true, dailyQuota: 300 }] })
    }).find(row => row.id === id);
    assert.equal(off.configured, false, id);
    assert.equal(createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: '{not json' }).find(row => row.id === id).configured, false, id);
    const on = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JK_CONFIG }).find(row => row.id === id);
    assert.equal(on.configured, true, id);
    assert.equal(on.verificationMode, 'provider-evidence');
    assert.equal((await on.getRemainingQuota()).limit, 300);
    assert.equal((await on.checkAvailability()).available, true);
  }
  const providers = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JK_CONFIG });
  assert.equal(providers.find(row => row.id === 'otp-j').endpoint, ORY);
  assert.equal(providers.find(row => row.id === 'otp-k').endpoint, HANKO);
  assert.equal(new OryOtpVerificationProvider({ endpoint: 'https://evil.example', declaredDailyQuota: 5 }).configured, false);
  assert.equal(new OryOtpVerificationProvider({ endpoint: `${ORY}/path`, declaredDailyQuota: 5 }).configured, false);
  assert.equal(new HankoOtpVerificationProvider({ endpoint: 'http://9b4c7063-c179-4586-8481-a415631a710a.hanko.io', declaredDailyQuota: 5 }).configured, false);
  assert.equal(new HankoOtpVerificationProvider({ endpoint: 'https://x.hanko.io.evil.example', declaredDailyQuota: 5 }).configured, false);
});

function oryFake({ accountExists = false, code = '123456' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init.method, body });
    const path = url.slice(ORY.length);
    if (init.method === 'GET' && /^\/self-service\/(login|registration)\/api$/.test(path)) return json({ id: ORY_FLOW, type: 'api', ui: { nodes: [] } });
    if (path === `/self-service/login?flow=${ORY_FLOW}`) {
      if (!accountExists) return json({ id: ORY_FLOW, state: 'choose_method', ui: { messages: [{ id: 4000035, text: 'This account does not exist or has not setup sign in with code.' }] } }, 400);
      if (!body.code) return json({ id: ORY_FLOW, state: 'sent_email', ui: { messages: [{ id: 1010014 }] } }, 400);
      if (body.code === code) return json({ session_token: 'ory_st_secret', session: { active: true, identity: { traits: { email: body.identifier } } } });
      return json({ id: ORY_FLOW, state: 'sent_email', ui: { messages: [{ id: 4010008 }] } }, 400);
    }
    if (path === `/self-service/registration?flow=${ORY_FLOW}`) {
      if (!body.code) return json({ id: ORY_FLOW, state: 'sent_email', ui: { messages: [{ id: 1040005 }] } }, 400);
      if (body.code === code) return json({ session_token: 'ory_st_secret', identity: { traits: { email: body.traits.email } }, session: { active: true } });
      return json({ id: ORY_FLOW, state: 'sent_email', ui: { messages: [{ id: 4040003 }] } }, 400);
    }
    if (path === '/self-service/logout/api' && init.method === 'DELETE') return new Response(null, { status: 204 });
    return json({}, 404);
  };
  return { calls, fetchImpl };
}

test('otp-j Ory sends a one-time code (registration for a new address) and checks it at Ory', async () => {
  const { calls, fetchImpl } = oryFake();
  const provider = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JK_CONFIG }, { fetchImpl }).find(row => row.id === 'otp-j');
  const attemptId = 'j'.repeat(32);
  assert.deepEqual(await provider.sendVerification({ destination: 'Student@Gmail.com', attemptId }), { accepted: true });
  assert.deepEqual(calls.map(row => `${row.method} ${row.url.slice(ORY.length)}`), [
    'GET /self-service/login/api', `POST /self-service/login?flow=${ORY_FLOW}`,
    'GET /self-service/registration/api', `POST /self-service/registration?flow=${ORY_FLOW}`
  ]);
  assert.deepEqual(calls[1].body, { method: 'code', identifier: 'student@gmail.com' });
  assert.deepEqual(calls[3].body, { method: 'code', traits: { email: 'student@gmail.com' } });
  assert.deepEqual(await provider.verifyCode({ attemptId, evidence: '000000' }), { verified: false });
  assert.deepEqual(await provider.verifyCode({ attemptId, evidence: '12345' }), { verified: false });
  assert.deepEqual(await provider.verifyCode({ attemptId, evidence: '123456' }), { verified: true });
  const logout = calls.find(row => row.url.endsWith('/self-service/logout/api'));
  assert.equal(logout.method, 'DELETE');
  assert.deepEqual(logout.body, { session_token: 'ory_st_secret' });
  await assert.rejects(provider.verifyCode({ attemptId, evidence: '123456' }), error => error.code === 'CHALLENGE_EXPIRED');
});

test('otp-j Ory uses the login flow for a known address', async () => {
  const { calls, fetchImpl } = oryFake({ accountExists: true });
  const provider = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JK_CONFIG }, { fetchImpl }).find(row => row.id === 'otp-j');
  const attemptId = 'k'.repeat(32);
  assert.deepEqual(await provider.sendVerification({ destination: 'known@icloud.com', attemptId }), { accepted: true });
  assert.equal(calls.some(row => row.url.includes('/registration')), false);
  assert.deepEqual(await provider.verifyCode({ attemptId, evidence: '123456' }), { verified: true });
  assert.deepEqual(calls.find(row => row.body?.code === '123456').body, { method: 'code', code: '123456', identifier: 'known@icloud.com' });
});

test('otp-j Ory classifies provider failures', async () => {
  const make = (status, payload = {}) => createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JK_CONFIG }, {
    fetchImpl: async (url, init) => (init.method === 'GET' && status < 400 ? json({ id: ORY_FLOW }) : json(payload, status))
  }).find(row => row.id === 'otp-j');
  const attemptId = 'l'.repeat(32);
  for (const [status, failureClass] of [[404, VERIFICATION_FAILURE_CLASS.HARD], [401, VERIFICATION_FAILURE_CLASS.HARD], [429, VERIFICATION_FAILURE_CLASS.TEMPORARY], [503, VERIFICATION_FAILURE_CLASS.TEMPORARY]]) {
    await assert.rejects(make(status).sendVerification({ destination: 'x@gmail.com', attemptId }), error => error.failureClass === failureClass, String(status));
  }
  // Code method switched off in the console: the login submit is refused without 4000035.
  const refused = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JK_CONFIG }, {
    fetchImpl: async (url, init) => (init.method === 'GET' ? json({ id: ORY_FLOW }) : json({ ui: { messages: [{ id: 4000001 }] } }, 400))
  }).find(row => row.id === 'otp-j');
  await assert.rejects(refused.sendVerification({ destination: 'x@gmail.com', attemptId }), error => error.code === 'PROVIDER_REJECTED' && error.failureClass === VERIFICATION_FAILURE_CLASS.HARD);
  await assert.rejects(make(200).sendVerification({ destination: 'not-an-email', attemptId }), error => error.code === 'INVALID_DESTINATION');
  await assert.rejects(make(200).verifyCode({ attemptId: 'm'.repeat(32), evidence: '123456' }), error => error.code === 'CHALLENGE_EXPIRED');
});

function hankoFake({ code = '123456', deletion = true } = {}) {
  const calls = [];
  let step = 0;
  const next = (name, actions, status = 200, extra = {}) => {
    step += 1;
    const csrf = `csrf-${step}`;
    const out = { name, status, csrf_token: csrf, payload: {}, actions: Object.fromEntries(actions.map(a => [a, { href: `/flow?action=${a}%40f${step}`, action: a }])), ...extra };
    return new Response(JSON.stringify(out), { status, headers: { 'Content-Type': 'application/json', ...(name === 'success' ? { 'X-Auth-Token': 'hanko.jwt.token' } : {}) } });
  };
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body || '{}');
    const path = url.slice(HANKO.length);
    calls.push({ path, body, auth: init.headers.Authorization || '' });
    const action = (path.match(/action=([a-z_]+)/) || [])[1] || '';
    if (path === '/registration' || path === '/login' || path === '/profile') return next('preflight', ['register_client_capabilities'], 200, { flow: path });
    if (action === 'register_client_capabilities') {
      if (calls.some(row => row.path === '/profile') && init.headers.Authorization) return next('profile_init', deletion ? ['account_delete', 'email_create'] : ['email_create']);
      return calls.some(row => row.path === '/login') ? next('login_init', ['continue_with_login_identifier']) : next('registration_init', ['register_login_identifier']);
    }
    if (action === 'register_login_identifier' || action === 'continue_with_login_identifier') return next('passcode_confirmation', ['back', 'resend_passcode', 'verify_passcode']);
    if (action === 'verify_passcode') {
      if (body.input_data.code !== code) return next('passcode_confirmation', ['back', 'resend_passcode', 'verify_passcode'], 400, { error: { code: 'form_data_invalid_error' } });
      return next('mfa_method_chooser', ['continue_to_otp_secret_creation', 'skip']);
    }
    if (action === 'skip') return next('success', []);
    if (action === 'account_delete') return next('account_deleted', []);
    if (path === '/logout') return new Response(null, { status: 204 });
    return json({ code: 404 }, 404);
  };
  return { calls, fetchImpl };
}

test('otp-k Hanko sends a passcode through the Flow API, checks it at Hanko and deletes the account', async () => {
  const { calls, fetchImpl } = hankoFake();
  const provider = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JK_CONFIG }, { fetchImpl }).find(row => row.id === 'otp-k');
  const attemptId = 'n'.repeat(32);
  assert.deepEqual(await provider.sendVerification({ destination: 'Student@Gmail.com', attemptId }), { accepted: true });
  assert.equal(calls[0].path, '/registration');
  assert.deepEqual(calls[1].body, { input_data: { webauthn_available: false }, csrf_token: 'csrf-1' });
  assert.deepEqual(calls[2].body, { input_data: { email: 'student@gmail.com' }, csrf_token: 'csrf-2' });
  assert.equal(calls.every(row => row.auth === ''), true);
  assert.deepEqual(await provider.verifyCode({ attemptId, evidence: '000000' }), { verified: false });
  assert.deepEqual(await provider.verifyCode({ attemptId, evidence: 'abc' }), { verified: false });
  // A wrong code makes Hanko issue a fresh href + csrf; the next try must use them.
  assert.deepEqual(await provider.verifyCode({ attemptId, evidence: '123456' }), { verified: true });
  const verifies = calls.filter(row => row.path.includes('action=verify_passcode'));
  assert.equal(verifies.length, 2);
  assert.equal(verifies[1].body.csrf_token, 'csrf-4');
  assert.match(verifies[1].path, /%40f4$/);
  const deleted = calls.find(row => row.path.includes('action=account_delete'));
  assert.equal(deleted.auth, 'Bearer hanko.jwt.token');
  await assert.rejects(provider.verifyCode({ attemptId, evidence: '123456' }), error => error.code === 'CHALLENGE_EXPIRED');
  // Deleted at Hanko, so the next send is a fresh registration again.
  calls.length = 0;
  await provider.sendVerification({ destination: 'student@gmail.com', attemptId: 'o'.repeat(32) });
  assert.equal(calls[0].path, '/registration');
});

test('otp-k Hanko falls back to the login flow when the account could not be deleted', async () => {
  const { calls, fetchImpl } = hankoFake({ deletion: false });
  const provider = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JK_CONFIG }, { fetchImpl }).find(row => row.id === 'otp-k');
  await provider.sendVerification({ destination: 'kept@icloud.com', attemptId: 'p'.repeat(32) });
  assert.deepEqual(await provider.verifyCode({ attemptId: 'p'.repeat(32), evidence: '123456' }), { verified: true });
  assert.ok(calls.some(row => row.path === '/logout' && row.auth === 'Bearer hanko.jwt.token'));
  calls.length = 0;
  await provider.sendVerification({ destination: 'kept@icloud.com', attemptId: 'q'.repeat(32) });
  assert.equal(calls[0].path, '/login');
});

test('otp-k Hanko classifies provider failures', async () => {
  const make = status => createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JK_CONFIG }, {
    fetchImpl: async () => json({ code: status }, status)
  }).find(row => row.id === 'otp-k');
  const attemptId = 'r'.repeat(32);
  await assert.rejects(make(404).sendVerification({ destination: 'x@gmail.com', attemptId }), error => error.failureClass === VERIFICATION_FAILURE_CLASS.HARD);
  await assert.rejects(make(429).sendVerification({ destination: 'x@gmail.com', attemptId }), error => error.failureClass === VERIFICATION_FAILURE_CLASS.TEMPORARY);
  await assert.rejects(make(500).sendVerification({ destination: 'x@gmail.com', attemptId }), error => error.failureClass === VERIFICATION_FAILURE_CLASS.TEMPORARY);
  await assert.rejects(make(200).sendVerification({ destination: 'not-an-email', attemptId }), error => error.code === 'INVALID_DESTINATION');
  // Hanko hands back an absolute or protocol-relative href: refuse to follow it.
  const hostile = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: JK_CONFIG }, {
    fetchImpl: async () => json({ name: 'preflight', csrf_token: 'c', actions: { register_client_capabilities: { href: '//evil.example/x' } } })
  }).find(row => row.id === 'otp-k');
  await assert.rejects(hostile.sendVerification({ destination: 'x@gmail.com', attemptId }), error => error.code === 'INVALID_PROVIDER_RESPONSE');
  await assert.rejects(make(200).verifyCode({ attemptId: 's'.repeat(32), evidence: '123456' }), error => error.code === 'CHALLENGE_EXPIRED');
});

test('wrangler.toml enables otp-j and otp-k at 38 without new vars, ahead of the last-resort pair', async () => {
  const { readFile } = await import('node:fs/promises');
  const toml = await readFile(new URL('./wrangler.toml', import.meta.url), 'utf8');
  for (const name of ['ORY_ENDPOINT', 'ORY_PROJECT_URL', 'HANKO_ENDPOINT', 'HANKO_API_URL', 'OTP_J_DAILY_QUOTA', 'OTP_K_DAILY_QUOTA']) {
    assert.equal(new RegExp(`^${name}\\s*=`, 'm').test(toml), false, name);
  }
  assert.match(toml, /\{"id":"otp-j","enabled":true,"priority":38,"dailyQuota":300/);
  assert.match(toml, /\{"id":"otp-k","enabled":true,"priority":38,"dailyQuota":300/);
  const rows = JSON.parse(toml.match(/VERIFICATION_ORCHESTRATOR_CONFIG = '(.*)'/)[1]).providers;
  const order = rows.slice().sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)).map(row => row.id);
  assert.deepEqual(order.slice(order.indexOf('otp-f')), ['otp-f', 'otp-i', 'otp-j', 'otp-k', 'otp-g', 'otp-c', 'telegram']);
});
'''

def edit_tests():
    rel = 'verification-providers.test.mjs'
    path = ROOT / rel
    text = path.read_text(encoding='utf-8')
    if text.count(OLD_IDS) == 2:
        text = text.replace(OLD_IDS, NEW_IDS)
    elif text.count(NEW_IDS) != 2:
        sys.exit(f'{rel}: slot id list not found twice')
    imp = '  DeadSimpleEmailOtpVerificationProvider,\n'
    if 'HankoOtpVerificationProvider,' not in text:
        assert text.count(imp) == 1
        text = text.replace(imp, imp + '  HankoOtpVerificationProvider,\n')
    imp2 = '  OfficialWhatsAppVerificationProvider,\n'
    if '  OryOtpVerificationProvider,\n' not in text:
        assert text.count(imp2) == 1
        text = text.replace(imp2, imp2 + '  OryOtpVerificationProvider,\n')
    if "test('otp-j Ory and otp-k Hanko use their public defaults" not in text:
        text = text.rstrip('\n') + '\n' + TESTS
    path.write_text(text, encoding='utf-8')

edit_tests()
print('otp-j/otp-k applied')

# compact-auth-config.test.mjs still demanded OTP_G_DAILY_QUOTA, a var that commit
# 32b914f removed on purpose (64-variable ceiling; native-auth-protection asserts it
# is absent). Check otp-g's cap in the authoritative orchestrator row instead.
edit('compact-auth-config.test.mjs', [(
    "  for (const [name, quota] of Object.entries({ A: 300, B: 100, C: 200, D: 100, E: 100, F: 100, G: 150 })) {\n"
    "    assert.match(text, new RegExp(`^OTP_${name}_DAILY_QUOTA = \"${quota}\"$`, 'm'));\n"
    "  }\n",
    "  for (const [name, quota] of Object.entries({ A: 300, B: 100, C: 200, D: 100, E: 100, F: 100 })) {\n"
    "    assert.match(text, new RegExp(`^OTP_${name}_DAILY_QUOTA = \"${quota}\"$`, 'm'));\n"
    "  }\n"
    "  // otp-g's cap lives in the orchestrator row since its var was dropped (64-var ceiling).\n"
    "  assert.equal(JSON.parse(packed).providers.find(row => row.id === 'otp-g').dailyQuota, 150);\n"
    "  assert.doesNotMatch(text, /^OTP_G_DAILY_QUOTA\\s*=/m);\n"
)])
print('compact-auth-config test realigned')
