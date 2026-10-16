#!/usr/bin/env python3
"""Add otp-i: Appwrite Cloud Email OTP as a provider-evidence slot (owner 2026-10-16).

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
            sys.exit(f'{rel}: anchor not found exactly once: {old[:60]!r}')
        text = text.replace(old, new)
    path.write_text(text, encoding='utf-8')

PROVIDER_CLASS = r'''// Slot `otp-i` is Appwrite Cloud's built-in Email OTP (project 6ad1e9280025bf4464ee,
// Frankfurt region). Appwrite creates, mails and checks the 6-digit code itself, so
// like otp-h this slot is provider-evidence. It drives the public Account API
// (POST /account/tokens/email, then POST /account/sessions/token) with only the
// public project id, so no secret is required. The temporary Appwrite session
// that a successful check creates is deleted straight away; we only need the
// yes/no answer. An optional APPWRITE_API_KEY secret (scope sessions.write) lifts
// Appwrite's per-IP abuse limits, but binding it costs one of the 64 Worker vars.
const APPWRITE_STATE_TTL_SECONDS = 900;
// Public, non-secret values live in code for the same 64-variable reason as Logto.
const APPWRITE_PUBLIC_DEFAULTS = Object.freeze({
  endpoint: 'https://fra.cloud.appwrite.io/v1',
  projectId: '6ad1e9280025bf4464ee'
});
function slotFromConfig(raw, id) {
  try {
    const text = String(raw || '');
    if (!text || text.length > 16_384) return null;
    const config = JSON.parse(text);
    if (config?.enabled !== true) return null;
    const rows = config.providers;
    const row = Array.isArray(rows) ? rows.find(item => item?.id === id) : null;
    return row && row.enabled === true ? row : null;
  } catch { return null; }
}
const validAppwriteProjectId = value => /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/.test(String(value || ''));
const validAppwriteUserId = value => /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/.test(String(value || ''));
function appwriteEndpoint(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
    const path = url.pathname.replace(/\/+$/, '');
    if (path !== '/v1') return '';
    return `${url.origin}/v1`;
  } catch { return ''; }
}

export class AppwriteOtpVerificationProvider {
  constructor({ id = 'otp-i', endpoint, projectId, apiKey, declaredDailyQuota, kv = null, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.PROVIDER_EVIDENCE;
    this.endpoint = appwriteEndpoint(endpoint);
    this.projectId = validAppwriteProjectId(projectId) ? String(projectId) : '';
    this.apiKey = validSecret(apiKey) ? apiKey : '';
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.kv = kv && typeof kv.get === 'function' && typeof kv.put === 'function' ? kv : null;
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.memory = new Map();
    this.configured = Boolean(this.endpoint && this.projectId && this.declaredDailyQuota && this.fetch);
  }

  #headers(extra = {}) {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Appwrite-Project': this.projectId,
      'X-Appwrite-Response-Format': '1.6.0',
      ...(this.apiKey ? { 'X-Appwrite-Key': this.apiKey } : {}),
      ...extra
    };
  }

  async #call(path, { method = 'POST', body, headers = {} } = {}) {
    let response;
    try {
      response = await this.fetch(`${this.endpoint}${path}`, {
        method,
        redirect: 'manual',
        headers: this.#headers(headers),
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(12_000)
      });
    } catch { throw new VerificationProviderError('NETWORK_ERROR', VERIFICATION_FAILURE_CLASS.TEMPORARY); }
    const payload = response.status === 204 ? {} : await boundedJson(response);
    return { response, payload };
  }

  async #saveState(attemptId, state) {
    const expires = Number(this.now()) + APPWRITE_STATE_TTL_SECONDS * 1000;
    this.memory.set(attemptId, { ...state, expires });
    for (const [key, row] of this.memory) if (row.expires < Number(this.now())) this.memory.delete(key);
    if (this.kv) {
      try { await this.kv.put(`appwrite-otp:${attemptId}`, JSON.stringify(state), { expirationTtl: APPWRITE_STATE_TTL_SECONDS }); } catch {}
    }
  }

  async #loadState(attemptId) {
    const row = this.memory.get(attemptId);
    if (row && row.expires >= Number(this.now())) return row;
    if (!this.kv) return null;
    try {
      const raw = await this.kv.get(`appwrite-otp:${attemptId}`);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  async #dropState(attemptId) {
    this.memory.delete(attemptId);
    if (this.kv && typeof this.kv.delete === 'function') { try { await this.kv.delete(`appwrite-otp:${attemptId}`); } catch {} }
  }

  // Best effort: the session only proves the code was right, so it is removed.
  async #discardSession(response, payload, userId) {
    try {
      const sessionId = String(payload?.$id || '');
      if (this.apiKey && validAppwriteUserId(sessionId)) {
        await this.#call(`/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
        return;
      }
      const jar = cookiePairs(response, {});
      const fallback = String(response?.headers?.get?.('X-Fallback-Cookies') || '');
      const headers = {};
      if (Object.keys(jar).length) headers.Cookie = cookieHeader(jar);
      if (fallback && fallback.length <= 4096) headers['X-Fallback-Cookies'] = fallback;
      if (!headers.Cookie && !headers['X-Fallback-Cookies']) return;
      await this.#call('/account/sessions/current', { method: 'DELETE', headers });
    } catch {}
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
    if (!validEmailAddress(destination) || !/^[A-Za-z0-9_-]{24,96}$/.test(attemptId)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    // 'unique()' lets Appwrite reuse the existing user for a known email or create one.
    const sent = await this.#call('/account/tokens/email', { body: { userId: 'unique()', email: destination, phrase: false } });
    if (!sent.response.ok) {
      // 501 = Email OTP is switched off in the Appwrite console: a config fault, not an outage.
      if (Number(sent.response.status) === 501) throw new VerificationProviderError('PROVIDER_HTTP_501', VERIFICATION_FAILURE_CLASS.HARD);
      throw httpFailure(sent.response, sent.payload, { userStatuses: [] });
    }
    const userId = String(sent.payload?.userId || '');
    if (!validAppwriteUserId(userId)) throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    await this.#saveState(attemptId, { userId, email: destination });
    return { accepted: true };
  }

  async verifyCode(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const attemptId = String(input.attemptId || '');
    const code = String(input.evidence || '').trim();
    if (!/^\d{6}$/.test(code)) return { verified: false };
    const state = await this.#loadState(attemptId);
    if (!state?.userId) throw new VerificationProviderError('CHALLENGE_EXPIRED', VERIFICATION_FAILURE_CLASS.USER);
    const result = await this.#call('/account/sessions/token', { body: { userId: state.userId, secret: code } });
    if (result.response.ok && String(result.payload?.userId || '') === state.userId) {
      await this.#dropState(attemptId);
      await this.#discardSession(result.response, result.payload, state.userId);
      return { verified: true };
    }
    if ([400, 401, 404].includes(Number(result.response.status))) return { verified: false };
    throw httpFailure(result.response, result.payload, { userStatuses: [] });
  }

  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: 'appwrite' };
  }
}
'''

ANCHOR = 'export class TelegramLinkVerificationProvider {'
providers = (ROOT / 'auth-native/verification/providers.mjs').read_text(encoding='utf-8')
if 'class AppwriteOtpVerificationProvider' not in providers:
    edit('auth-native/verification/providers.mjs', [(ANCHOR, PROVIDER_CLASS + '\n' + ANCHOR)])

edit('auth-native/verification/providers.mjs', [
    ("""    kv: env.GK_KV || null,
    fetchImpl
  });
  return [
""", """    kv: env.GK_KV || null,
    fetchImpl
  });
  const appwriteSlot = slotFromConfig(env.VERIFICATION_ORCHESTRATOR_CONFIG, 'otp-i');
  const appwriteOtpI = new AppwriteOtpVerificationProvider({
    id: 'otp-i',
    endpoint: env.APPWRITE_ENDPOINT || (appwriteSlot ? APPWRITE_PUBLIC_DEFAULTS.endpoint : ''),
    projectId: env.APPWRITE_PROJECT_ID || (appwriteSlot ? APPWRITE_PUBLIC_DEFAULTS.projectId : ''),
    apiKey: env.APPWRITE_API_KEY,
    declaredDailyQuota: env.OTP_I_DAILY_QUOTA || (appwriteSlot ? appwriteSlot.dailyQuota : ''),
    kv: env.GK_KV || null,
    fetchImpl
  });
  return [
"""),
    ("    logtoOtpH,\n    new OfficialWhatsApp", "    logtoOtpH,\n    appwriteOtpI,\n    new OfficialWhatsApp"),
])

OTP_B = "  'otp-b': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 20 }),"
edit('auth-native/verification/config.mjs', [
    (OTP_B, "  'otp-i': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.PROVIDER_EVIDENCE, priority: 17 }),\n" + OTP_B),
])

SLOT_B = '{"id":"otp-b","enabled":true,"priority":20'
QUOTA_A = 'OTP_A_DAILY_QUOTA = "300"'
edit('wrangler.toml', [
    (SLOT_B, '{"id":"otp-i","enabled":true,"priority":17,"dailyQuota":300,"timeoutMs":20000,"label":"secure backup"},' + SLOT_B),
    (QUOTA_A, """# otp-i is Appwrite Cloud Email OTP (project 6ad1e9280025bf4464ee, fra region), added
# 2026-10-16 right after Logto. Endpoint and project id are public and live in
# providers.mjs (APPWRITE_PUBLIC_DEFAULTS) to stay under the 64-variable ceiling;
# dailyQuota 300 above is our own safety cap. Optional secret APPWRITE_API_KEY.
""" + QUOTA_A),
])

LIST = "'otp-g', 'otp-h', 'whatsapp', 'telegram'"
tests = ROOT / 'verification-providers.test.mjs'
text = tests.read_text(encoding='utf-8')
text = text.replace(LIST, "'otp-g', 'otp-h', 'otp-i', 'whatsapp', 'telegram'")
TESTS = r'''

test('otp-i Appwrite uses its public defaults only when the owner enabled the slot', async () => {
  const off = createConfiguredVerificationProviders({}).find(row => row.id === 'otp-i');
  assert.equal(off.configured, false);
  const disabled = createConfiguredVerificationProviders({
    VERIFICATION_ORCHESTRATOR_CONFIG: JSON.stringify({ enabled: true, providers: [{ id: 'otp-i', enabled: false, dailyQuota: 300 }] })
  }).find(row => row.id === 'otp-i');
  assert.equal(disabled.configured, false);
  const on = createConfiguredVerificationProviders({
    VERIFICATION_ORCHESTRATOR_CONFIG: JSON.stringify({ enabled: true, providers: [{ id: 'otp-i', enabled: true, dailyQuota: 300 }] })
  }).find(row => row.id === 'otp-i');
  assert.equal(on.configured, true);
  assert.equal(on.verificationMode, 'provider-evidence');
  assert.equal(on.endpoint, 'https://fra.cloud.appwrite.io/v1');
  assert.equal(on.projectId, '6ad1e9280025bf4464ee');
  assert.equal((await on.getRemainingQuota()).limit, 300);
  const broken = createConfiguredVerificationProviders({ VERIFICATION_ORCHESTRATOR_CONFIG: '{not json' }).find(row => row.id === 'otp-i');
  assert.equal(broken.configured, false);
});

test('otp-i Appwrite sends through the Email OTP API and checks the code at Appwrite', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/account/tokens/email')) return json({ $id: 'tok', userId: 'user123', secret: '' }, 201);
    if (url.endsWith('/account/sessions/token')) {
      if (JSON.parse(init.body).secret === '123456') {
        return new Response(JSON.stringify({ $id: 'sess1', userId: 'user123' }), { status: 201, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'a_session_6ad1e9280025bf4464ee=abc; Path=/' } });
      }
      return json({ message: 'Invalid token', code: 401, type: 'user_invalid_token' }, 401);
    }
    if (url.endsWith('/account/sessions/current')) return new Response(null, { status: 204 });
    return json({}, 404);
  };
  const provider = createConfiguredVerificationProviders({
    VERIFICATION_ORCHESTRATOR_CONFIG: JSON.stringify({ enabled: true, providers: [{ id: 'otp-i', enabled: true, dailyQuota: 300 }] })
  }, { fetchImpl }).find(row => row.id === 'otp-i');
  const attemptId = 'a'.repeat(32);
  assert.deepEqual(await provider.sendVerification({ destination: 'Student@Gmail.com', attemptId }), { accepted: true });
  assert.equal(calls[0].url, 'https://fra.cloud.appwrite.io/v1/account/tokens/email');
  assert.equal(calls[0].headers['X-Appwrite-Project'], '6ad1e9280025bf4464ee');
  assert.equal(calls[0].headers['X-Appwrite-Key'], undefined);
  assert.deepEqual(calls[0].body, { userId: 'unique()', email: 'student@gmail.com', phrase: false });
  assert.deepEqual(await provider.verifyCode({ attemptId, evidence: '000000' }), { verified: false });
  assert.deepEqual(await provider.verifyCode({ attemptId, evidence: '12345' }), { verified: false });
  assert.deepEqual(await provider.verifyCode({ attemptId, evidence: '123456' }), { verified: true });
  const discard = calls.find(row => row.url.endsWith('/account/sessions/current'));
  assert.equal(discard.method, 'DELETE');
  assert.match(discard.headers.Cookie, /a_session_6ad1e9280025bf4464ee=abc/);
  await assert.rejects(provider.verifyCode({ attemptId, evidence: '123456' }), error => error.code === 'CHALLENGE_EXPIRED');
});

test('otp-i Appwrite classifies provider failures', async () => {
  const make = status => createConfiguredVerificationProviders({
    VERIFICATION_ORCHESTRATOR_CONFIG: JSON.stringify({ enabled: true, providers: [{ id: 'otp-i', enabled: true, dailyQuota: 300 }] })
  }, { fetchImpl: async () => json({ code: status }, status) }).find(row => row.id === 'otp-i');
  const attemptId = 'b'.repeat(32);
  await assert.rejects(make(501).sendVerification({ destination: 'x@gmail.com', attemptId }), error => error.failureClass === VERIFICATION_FAILURE_CLASS.HARD);
  await assert.rejects(make(429).sendVerification({ destination: 'x@gmail.com', attemptId }), error => error.failureClass === VERIFICATION_FAILURE_CLASS.TEMPORARY);
  await assert.rejects(make(401).sendVerification({ destination: 'x@gmail.com', attemptId }), error => error.failureClass === VERIFICATION_FAILURE_CLASS.HARD);
  await assert.rejects(make(200).sendVerification({ destination: 'not-an-email', attemptId }), error => error.code === 'INVALID_DESTINATION');
});

test('wrangler.toml stays off the Appwrite vars so the 64-variable ceiling holds', async () => {
  const { readFile } = await import('node:fs/promises');
  const toml = await readFile(new URL('./wrangler.toml', import.meta.url), 'utf8');
  for (const name of ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'OTP_I_DAILY_QUOTA']) {
    assert.equal(new RegExp(`^${name}\\s*=`, 'm').test(toml), false, name);
  }
  assert.match(toml, /"id":"otp-i","enabled":true/);
});
'''
if "test('otp-i Appwrite uses its public" not in text:
    text += TESTS
tests.write_text(text, encoding='utf-8')
print('otp-i Appwrite patch applied')
