import { AUTH_NATIVE_VERSION, FIREBASE_VERIFICATION_RESEND_COOLDOWN_MS } from '../core/auth-engine.mjs';
import { constantTimeEqual, normalizeAuthEmail, randomToken } from '../core/crypto.mjs';
import { AUTH_ERROR_CODES, asNativeAuthError, NativeAuthError } from '../core/errors.mjs';
import { FirebaseEmailPasswordProvider, FirebaseRequestError } from '../providers/firebase-auth.mjs';
import { verificationConfig } from '../verification/config.mjs';
import { resolveTelegramWebhookSecret, validTelegramWebhookSecret } from '../verification/telegram-security.mjs';

export const AUTH_API_PREFIX = '/api/auth/v1';
export const AUTH_SESSION_COOKIE = '__Host-ah_session';
export const AUTH_FIREBASE_COOKIE = '__Host-ah_firebase';
export const AUTH_DEVICE_COOKIE = '__Host-ah_device';
export const AUTH_VERIFICATION_COOKIE = '__Host-ah_verification';
const AUTHORITY_NAME = 'admission-hub-global-auth-v1';
const MAX_BODY_BYTES = 24 * 1024;
const YEAR_SECONDS = 365 * 24 * 60 * 60;
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const AUTH_UI_VERSION = 'auth-premium-v6';
const FIREBASE_VERIFICATION_RESEND_SECONDS = Math.floor(FIREBASE_VERIFICATION_RESEND_COOLDOWN_MS / 1000);

const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-site',
  Vary: 'Origin'
});

const allowedOrigin = origin => {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) return true;
    if (url.protocol !== 'https:') return false;
    return url.hostname === 'admissionhub.pages.dev'
      || /^[a-z0-9-]+\.admissionhub\.pages\.dev$/i.test(url.hostname)
      || url.hostname === 'admission-gk.admissionhub.workers.dev';
  } catch { return false; }
};

const corsHeaders = request => {
  const origin = request.headers.get('Origin') || '';
  return origin && allowedOrigin(origin) ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true'
  } : {};
};

const json = (request, status, body, extraHeaders = {}) => {
  const headers = new Headers({ ...JSON_HEADERS, ...corsHeaders(request) });
  for (const [name, value] of Object.entries(extraHeaders || {})) {
    if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
    else headers.set(name, value);
  }
  return new Response(JSON.stringify(body), { status, headers });
};

const cookies = request => Object.fromEntries(
  String(request.headers.get('Cookie') || '').split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('=');
    if (index < 1) return ['', ''];
    const value = part.slice(index + 1);
    try { return [part.slice(0, index), decodeURIComponent(value)]; } catch { return [part.slice(0, index), '']; }
  }).filter(([key]) => key)
);

const secureCookie = (name, token, maxAge) => `${name}=${encodeURIComponent(String(token || ''))}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAge))}; HttpOnly; Secure; SameSite=Strict`;
const sessionCookie = (token, maxAge) => secureCookie(AUTH_SESSION_COOKIE, token, maxAge);
const firebaseCookie = (token, maxAge) => secureCookie(AUTH_FIREBASE_COOKIE, token, maxAge);
const deviceCookie = token => `${AUTH_DEVICE_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${YEAR_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
const verificationCookie = (token, maxAge = 15 * 60) => secureCookie(AUTH_VERIFICATION_COOKIE, token, maxAge);
const clearAuthCookies = () => [sessionCookie('', 0), firebaseCookie('', 0), verificationCookie('', 0)];

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  if (!String(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
    throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  }
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > maxBytes || !request.body) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
    }
    raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();
  if (!raw) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  try { return JSON.parse(raw); } catch { throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT); }
}

const clientContext = (request, existingDeviceId = '') => {
  const deviceId = /^[A-Za-z0-9_-]{20,96}$/.test(existingDeviceId) ? existingDeviceId : randomToken(24);
  return Object.freeze({
    deviceId,
    isNewDevice: deviceId !== existingDeviceId,
    ip: String(request.headers.get('CF-Connecting-IP') || 'unknown').slice(0, 96),
    userAgent: String(request.headers.get('User-Agent') || '').slice(0, 300),
    origin: String(request.headers.get('Origin') || new URL(request.url).origin).slice(0, 256)
  });
};

const credentials = body => {
  const email = String(body?.email || '').trim();
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX || /[\r\n\u0000]/.test(password)) {
    throw new NativeAuthError(password && password.length < PASSWORD_MIN ? AUTH_ERROR_CODES.WEAK_PASSWORD : AUTH_ERROR_CODES.INVALID_INPUT);
  }
  // "Remember me" (Phase 5): explicit false shortens the established session
  // to REMEMBER_OFF_TTL_MS; absent/true keeps the standard SESSION_TTL_MS.
  const remember = body?.remember !== false;
  return Object.freeze({ email, password, remember });
};

const telegramWebhookInput = body => {
  const message = body?.message;
  const telegramUserId = String(message?.from?.id || '');
  const chatId = String(message?.chat?.id || '');
  const text = String(message?.text || '');
  const match = text.match(/^\/start(?:@[A-Za-z0-9_]{5,32})? ([A-Za-z0-9_-]{32,64})$/);
  if (!Number.isSafeInteger(body?.update_id) || message?.chat?.type !== 'private' || message?.from?.is_bot === true || telegramUserId !== chatId || !/^[1-9]\d{0,19}$/.test(telegramUserId) || !match) {
    throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  }
  return Object.freeze({ linkToken: match[1], telegramUserId, chatId });
};

const googleCredential = body => {
  const accessToken = String(body?.accessToken || '').trim();
  const idToken = String(body?.idToken || '').trim();
  if (Boolean(accessToken) === Boolean(idToken)) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  const value = accessToken || idToken;
  if (value.length < 20 || value.length > 4096 || /[\r\n\u0000;]/.test(value)) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  return Object.freeze(accessToken ? { accessToken } : { idToken });
};

async function callAuthority(env, path, body, method = 'POST') {
  if (!env?.AUTH_AUTHORITY || typeof env.AUTH_AUTHORITY.idFromName !== 'function') {
    throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
  }
  let response;
  try {
    const id = env.AUTH_AUTHORITY.idFromName(AUTHORITY_NAME);
    const stub = env.AUTH_AUTHORITY.get(id, { locationHint: 'apac' });
    response = await stub.fetch(`https://auth.internal${path}`, method === 'GET' ? { method } : {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  } catch {
    throw new NativeAuthError(AUTH_ERROR_CODES.STORAGE_UNAVAILABLE);
  }
  let data;
  try { data = await response.json(); } catch { throw new NativeAuthError(AUTH_ERROR_CODES.STORAGE_UNAVAILABLE); }
  if (!response.ok || !data?.ok) {
    throw new NativeAuthError(data?.error?.code || AUTH_ERROR_CODES.STORAGE_UNAVAILABLE, {
      retryAfter: data?.error?.retryAfter || response.headers.get('Retry-After')
    });
  }
  return data.result || data;
}

function providerAvailabilityFailure(cause) {
  if (!(cause instanceof FirebaseRequestError)) return Object.freeze({ code: 'PROVIDER_CHECK_FAILED', providerStatus: 0 });
  const reason = String(cause.reason || '');
  const providerStatus = Number.isInteger(cause.status) && cause.status >= 100 && cause.status <= 599 ? cause.status : 0;
  if (reason === 'NETWORK_ERROR') return Object.freeze({ code: 'PROVIDER_NETWORK_ERROR', providerStatus });
  if (/REFERER|REFERRER/.test(reason)) return Object.freeze({ code: 'API_KEY_REFERRER_RESTRICTED', providerStatus });
  if (/ACCESS_NOT_CONFIGURED|SERVICE_DISABLED|API_NOT_ACTIVATED/.test(reason)) return Object.freeze({ code: 'IDENTITY_TOOLKIT_DISABLED', providerStatus });
  if (/API_KEY/.test(reason)) return Object.freeze({ code: 'API_KEY_REJECTED', providerStatus });
  if (reason === 'PROJECT_NOT_FOUND') return Object.freeze({ code: 'PROJECT_NOT_FOUND', providerStatus });
  if (reason === 'OPERATION_NOT_ALLOWED') return Object.freeze({ code: 'PROVIDER_DISABLED', providerStatus });
  return Object.freeze({ code: providerStatus ? `PROVIDER_HTTP_${providerStatus}` : 'PROVIDER_CHECK_FAILED', providerStatus });
}

const PROVIDER_DIAGNOSTIC_REASONS = new Set([
  'NETWORK_ERROR', 'INVALID_PROVIDER_RESPONSE', 'INVALID_IDP_RESPONSE', 'NOT_CONFIGURED', 'API_KEY_INVALID',
  'PROJECT_NOT_FOUND', 'OPERATION_NOT_ALLOWED', 'INVALID_EMAIL', 'MISSING_EMAIL',
  'MISSING_PASSWORD', 'EMAIL_EXISTS', 'WEAK_PASSWORD', 'INVALID_LOGIN_CREDENTIALS',
  'EMAIL_NOT_FOUND', 'INVALID_PASSWORD', 'USER_DISABLED', 'TOO_MANY_ATTEMPTS_TRY_LATER',
  'TOO_MANY_ATTEMPTS', 'IP_BLOCKED', 'QUOTA_EXCEEDED', 'INVALID_CONTINUE_URI',
  'UNAUTHORIZED_DOMAIN', 'INVALID_REFRESH_TOKEN', 'TOKEN_EXPIRED', 'INVALID_ID_TOKEN',
  'USER_NOT_FOUND', 'FEDERATED_USER_ID_ALREADY_LINKED', 'MISSING_RECAPTCHA_TOKEN',
  'INVALID_RECAPTCHA_TOKEN', 'CAPTCHA_CHECK_FAILED', 'RECAPTCHA_CHECK_FAILED'
]);

function providerDiagnostic(cause, stage) {
  const operation = String(stage || 'auth').toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 24) || 'AUTH';
  if (!(cause instanceof FirebaseRequestError)) return `${operation}_UNEXPECTED`;
  const reason = PROVIDER_DIAGNOSTIC_REASONS.has(cause.reason)
    ? cause.reason
    : cause.status >= 100 && cause.status <= 599 ? `HTTP_${cause.status}` : 'UNKNOWN';
  return `${operation}_${reason}`;
}

function providerError(cause, stage = 'auth') {
  const tagged = error => {
    error.providerDiagnostic = providerDiagnostic(cause, stage);
    return error;
  };
  if (!(cause instanceof FirebaseRequestError)) return tagged(new NativeAuthError(AUTH_ERROR_CODES.AUTH_PROVIDER_UNAVAILABLE));
  const reason = cause.reason;
  if (reason === 'NOT_CONFIGURED' || ['API_KEY_INVALID', 'PROJECT_NOT_FOUND', 'OPERATION_NOT_ALLOWED'].includes(reason)) {
    return tagged(new NativeAuthError(stage.startsWith('google') ? AUTH_ERROR_CODES.GOOGLE_UNAVAILABLE : AUTH_ERROR_CODES.NOT_CONFIGURED));
  }
  if (['INVALID_EMAIL', 'MISSING_EMAIL', 'MISSING_PASSWORD', 'INVALID_IDP_RESPONSE'].includes(reason)) return tagged(new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT));
  if (reason === 'EMAIL_EXISTS' && stage.startsWith('google')) return tagged(new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_LINK_REQUIRED));
  if (reason === 'EMAIL_EXISTS') return tagged(new NativeAuthError(AUTH_ERROR_CODES.EMAIL_ALREADY_IN_USE));
  if (reason === 'FEDERATED_USER_ID_ALREADY_LINKED') return tagged(new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT));
  if (reason === 'WEAK_PASSWORD') return tagged(new NativeAuthError(AUTH_ERROR_CODES.WEAK_PASSWORD));
  if (['INVALID_LOGIN_CREDENTIALS', 'EMAIL_NOT_FOUND', 'INVALID_PASSWORD'].includes(reason)) return tagged(new NativeAuthError(AUTH_ERROR_CODES.INVALID_CREDENTIALS));
  if (reason === 'USER_DISABLED') return tagged(new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_DISABLED));
  if (['TOO_MANY_ATTEMPTS_TRY_LATER', 'TOO_MANY_ATTEMPTS', 'IP_BLOCKED'].includes(reason)) {
    return tagged(new NativeAuthError(AUTH_ERROR_CODES.RATE_LIMITED, { retryAfter: 60 }));
  }
  if (stage === 'verification' && ['QUOTA_EXCEEDED', 'INVALID_CONTINUE_URI', 'UNAUTHORIZED_DOMAIN', 'NETWORK_ERROR', 'INVALID_PROVIDER_RESPONSE'].includes(reason)) {
    return tagged(new NativeAuthError(AUTH_ERROR_CODES.VERIFICATION_UNAVAILABLE));
  }
  if (['refresh', 'lookup-session', 'passkey-refresh'].includes(stage) && ['INVALID_REFRESH_TOKEN', 'TOKEN_EXPIRED', 'INVALID_ID_TOKEN', 'USER_NOT_FOUND'].includes(reason)) {
    return tagged(new NativeAuthError(AUTH_ERROR_CODES.SESSION_INVALID));
  }
  return tagged(new NativeAuthError(stage.startsWith('google') ? AUTH_ERROR_CODES.GOOGLE_UNAVAILABLE : AUTH_ERROR_CODES.AUTH_PROVIDER_UNAVAILABLE));
}

const assertProviderUser = (signed, user) => {
  if (signed.subject !== user.subject) throw new NativeAuthError(AUTH_ERROR_CODES.AUTH_PROVIDER_UNAVAILABLE);
  if (user.disabled) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_DISABLED);
};

const telegramVerificationStatus = async ({ env, user, context, allowed }) => {
  if (!allowed) return false;
  try {
    const result = await callAuthority(env, '/internal/verification/telegram/status', {
      input: { email: user.email, subject: user.subject },
      context
    });
    return result?.linked === true;
  } catch { return false; }
};

const telegramVerificationAvailable = async (env, allowed) => {
  if (!allowed) return false;
  try {
    const result = await callAuthority(env, '/internal/verification/capabilities', {});
    return result?.telegramAvailable === true;
  } catch { return false; }
};

const firebaseReadySession = async ({ provider, jar, env, context, allowTelegram = false, trackRefresh = false }) => {
  const sessionToken = jar[AUTH_SESSION_COOKIE];
  const refreshToken = jar[AUTH_FIREBASE_COOKIE];
  if (!sessionToken || !refreshToken) throw new NativeAuthError(AUTH_ERROR_CODES.SESSION_INVALID);
  let refreshed;
  let user;
  try { refreshed = await provider.refresh(refreshToken); } catch (cause) { throw providerError(cause, 'refresh'); }
  try { user = await provider.lookup(refreshed.idToken); } catch (cause) { throw providerError(cause, 'lookup-session'); }
  assertProviderUser(refreshed, user);
  const telegramVerified = !user.emailVerified && await telegramVerificationStatus({ env, user, context, allowed: allowTelegram });
  if (!user.emailVerified && !telegramVerified) throw new NativeAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
  const session = await callAuthority(env, '/internal/firebase/session/get', {
    sessionToken,
    input: { email: user.email, subject: user.subject, ...(trackRefresh ? { trackRefresh: true } : {}) }
  });
  return Object.freeze({ sessionToken, refreshed, user, session, telegramVerified });
};

const sessionCookies = (established, refreshToken, context) => {
  const maxAge = Math.max(1, Math.min(SESSION_SECONDS, Math.floor((Number(established.sessionExpiresAt || established.expiresAt) - Date.now()) / 1000)));
  const values = [];
  if (established.sessionToken) values.push(sessionCookie(established.sessionToken, maxAge));
  values.push(firebaseCookie(refreshToken, maxAge));
  if (context.isNewDevice) values.push(deviceCookie(context.deviceId));
  return values;
};

const authSuccess = (request, established, refreshToken, context, verification = {}, extraCookies = []) => {
  const emailVerified = verification.emailVerified !== false;
  const telegramVerified = verification.telegramVerified === true;
  return json(request, 200, {
    ok: true,
    authenticated: true,
    accountVerified: emailVerified || telegramVerified,
    emailVerified,
    telegramVerified,
    created: Boolean(established.created),
    user: established.user,
    // Phase 6 — security decision travels with the session: trustOffer drives
    // the "trust this device 30 days" prompt (Chunk 3 client); HIGH risk
    // shortens expiresAt server-side.
    session: { expiresAt: established.sessionExpiresAt, security: established.security || null }
  }, { 'Set-Cookie': [...sessionCookies(established, refreshToken, context), ...extraCookies] });
};

const googleEndpointReady = env => ['canary', 'enabled'].includes(String(env?.GOOGLE_AUTH_ACTIVATION || ''));
const googlePublished = env => env?.GOOGLE_AUTH_ACTIVATION === 'enabled';
const googleCanaryRequested = (env, url) =>
  env?.GOOGLE_AUTH_ACTIVATION === 'canary' && url.searchParams.get('googleCanary') === '1';
const verificationEndpointReady = env => ['canary', 'enabled'].includes(String(env?.VERIFICATION_AUTH_ACTIVATION || ''));
const verificationPublished = env => env?.VERIFICATION_AUTH_ACTIVATION === 'enabled';
const telegramCanaryRequested = (env, url) =>
  verificationEndpointReady(env) && url.searchParams.get('telegramCanary') === '1';
const telegramVerificationRequested = (env, url) => verificationPublished(env) || telegramCanaryRequested(env, url);
const currentAuthUi = request => request.headers.get('X-AH-Auth-UI') === AUTH_UI_VERSION;
const telegramActivationAuthorized = (request, env) => {
  const expected = String(env?.TELEGRAM_CANARY_ACTIVATION_SECRET || '');
  const supplied = String(request.headers.get('X-AH-Telegram-Activation') || '');
  return /^[A-Za-z0-9_-]{32,128}$/.test(expected)
    && supplied.length === expected.length
    && constantTimeEqual(supplied, expected);
};
const adminAuthorized = (request, env) => {
  const expected = String(env?.ADMIN_TOKEN || '');
  const supplied = String(request.headers.get('X-AH-Admin-Token') || '');
  return expected.length >= 20 && supplied.length === expected.length && constantTimeEqual(supplied, expected);
};
const passkeyEndpointReady = env => ['canary', 'enabled'].includes(String(env?.PASSKEY_AUTH_ACTIVATION || ''));
const passkeyPublished = env => env?.PASSKEY_AUTH_ACTIVATION === 'enabled';
const passkeyCanaryRequested = (env, url) =>
  env?.PASSKEY_AUTH_ACTIVATION === 'canary' && url.searchParams.get('passkeyCanary') === '1';

export function createNativeAuthHandler({ fetchImpl = globalThis.fetch } = {}) {
  const publicConfigCache = new WeakMap();
  return async function handleNativeAuthRequest(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${AUTH_API_PREFIX}/`) && url.pathname !== AUTH_API_PREFIX) return null;
    const origin = request.headers.get('Origin') || '';
    const telegramOperation = request.method === 'POST' && [
      `${AUTH_API_PREFIX}/telegram/webhook`,
      `${AUTH_API_PREFIX}/telegram/canary/activate`,
      `${AUTH_API_PREFIX}/telegram/canary/deactivate`
    ].includes(url.pathname);
    const originOptional = request.method === 'GET' || telegramOperation;
    if ((!origin && !originOptional) || (origin && !allowedOrigin(origin))) {
      return json(request, 403, { ok: false, error: { code: 'ORIGIN_FORBIDDEN', message: 'অনুমোদিত উৎস নয়।' } });
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...JSON_HEADERS,
          ...corsHeaders(request),
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'content-type, x-ah-admin-token, x-ah-auth-ui',
          'Access-Control-Max-Age': '600'
        }
      });
    }

    const provider = new FirebaseEmailPasswordProvider({
      apiKey: env?.FIREBASE_WEB_API_KEY,
      continueUrl: env?.FIREBASE_CONTINUE_URL,
      fetchImpl
    });
    const jar = cookies(request);
    const context = clientContext(request, jar[AUTH_DEVICE_COOKIE]);

    try {
      if (request.method === 'POST' && [
        `${AUTH_API_PREFIX}/telegram/canary/activate`,
        `${AUTH_API_PREFIX}/telegram/canary/deactivate`
      ].includes(url.pathname)) {
        if (url.hostname !== 'admission-gk.admissionhub.workers.dev'
          || !['canary', 'enabled'].includes(env?.VERIFICATION_AUTH_ACTIVATION)
          || !telegramActivationAuthorized(request, env)) {
          return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
        }
        await readJson(request);
        const action = url.pathname.endsWith('/deactivate') ? 'deactivate' : 'activate';
        const result = await callAuthority(env, `/internal/verification/telegram/${action}`, {});
        return json(request, 200, {
          ok: true,
          ...(action === 'activate' ? {
            ready: result?.ready === true,
            identityReady: result?.identityReady === true,
            webhookReady: result?.webhookReady === true,
            endpointAccepted: result?.endpointAccepted === true,
            webhookChanged: result?.webhookChanged === true
          } : { removed: result?.removed === true })
        });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/telegram/webhook`) {
        const expected = await resolveTelegramWebhookSecret(env);
        const supplied = String(request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '');
        if (!validTelegramWebhookSecret(expected) || supplied.length !== expected.length || !constantTimeEqual(supplied, expected)) {
          return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
        }
        const payload = await readJson(request);
        let input;
        try { input = telegramWebhookInput(payload); }
        catch { return json(request, 200, { ok: true }); }
        try { await callAuthority(env, '/internal/verification/telegram/webhook', { input }); }
        catch (cause) {
          if (cause?.code !== AUTH_ERROR_CODES.OTP_INVALID) throw cause;
        }
        return json(request, 200, { ok: true });
      }

      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/config`) {
        const googleCanary = googleCanaryRequested(env, url);
        const passkeyCanary = passkeyCanaryRequested(env, url);
        const telegramCanary = telegramCanaryRequested(env, url);
        const cacheVariant = `${googleCanary ? 'google-canary' : 'public'}:${passkeyCanary ? 'passkey-canary' : 'public'}:${telegramCanary ? 'telegram-canary' : 'public'}`;
        const cache = publicConfigCache.get(env);
        const cached = cache?.get(cacheVariant);
        if (cached && cached.expiresAt > Date.now()) return json(request, 200, cached.body);
        const health = await callAuthority(env, '/internal/ping', null, 'GET');
        let firebaseReady = false;
        let project = null;
        let availability = Object.freeze({ code: provider.configured ? 'PROJECT_CHECK_FAILED' : 'CREDENTIAL_MISSING', providerStatus: 0 });
        if (provider.configured) {
          try {
            project = await provider.inspectProject();
            firebaseReady = project.projectIdentified && project.continueDomainAuthorized;
            availability = Object.freeze({
              code: !project.projectIdentified ? 'PROJECT_NOT_IDENTIFIED' : !project.continueDomainAuthorized ? 'PAGES_DOMAIN_NOT_AUTHORIZED' : 'READY',
              providerStatus: 0
            });
          } catch (cause) { availability = providerAvailabilityFailure(cause); }
        }
        const available = firebaseReady && health.ok === true;
        const googleRequested = googlePublished(env) || googleCanary;
        let google = {
          available: false,
          availabilityCode: googleRequested ? 'PROVIDER_CHECK_FAILED' : googleEndpointReady(env) ? 'LIVE_E2E_PENDING' : 'LIVE_E2E_NOT_APPROVED'
        };
        if (available && googleRequested) {
          try {
            const discovered = project?.google?.enabled && project.google.clientId
              ? { available: true, clientId: project.google.clientId }
              : await provider.inspectGoogleProvider();
            google = { available: discovered.available === true, availabilityCode: 'READY', clientId: discovered.clientId };
          } catch (cause) {
            const failure = providerAvailabilityFailure(cause);
            google = { available: false, availabilityCode: failure.code };
          }
        }
        const verificationRequested = verificationPublished(env) || telegramCanary;
        let telegramAvailable = false;
        let backup = {
          available: false,
          availabilityCode: verificationRequested
            ? 'STATUS_UNAVAILABLE'
            : verificationEndpointReady(env) ? 'LIVE_E2E_PENDING' : 'NOT_ACTIVATED',
          genericFlow: true,
          providerNamesExposed: false
        };
        if (available && verificationRequested) {
          try {
            const capabilities = await callAuthority(env, '/internal/verification/capabilities', {});
            telegramAvailable = capabilities?.telegramAvailable === true;
            backup = {
              available: capabilities?.available === true,
              availabilityCode: String(capabilities?.availabilityCode || 'STATUS_UNAVAILABLE'),
              genericFlow: true,
              providerNamesExposed: false,
              contactInput: ['none', 'optional', 'required'].includes(capabilities?.contactInput) ? capabilities.contactInput : 'none',
              maxAttempts: Number(capabilities?.maxAttempts || 5),
              expiresInSeconds: Number(capabilities?.expiresInSeconds || 300)
            };
          } catch { backup = { available: false, availabilityCode: 'STATUS_UNAVAILABLE', genericFlow: true, providerNamesExposed: false }; }
        }
        const telegramVerification = {
          available: verificationRequested && telegramAvailable,
          availabilityCode: verificationRequested ? String(backup?.availabilityCode || 'STATUS_UNAVAILABLE') : verificationEndpointReady(env) ? 'LIVE_E2E_PENDING' : 'NOT_ACTIVATED',
          optional: true,
          codeLength: 6,
          expiresInSeconds: Number(backup?.expiresInSeconds || 300),
          maxAttempts: Number(backup?.maxAttempts || 5),
          verifiesEmailOwnership: false,
          canonicalIdentity: 'firebase-uid'
        };
        const passkeyAvailable = available && health.schema >= 3 && (passkeyPublished(env) || passkeyCanary);
        const passkeyEnrollmentAvailable = available && health.schema >= 3 && passkeyEndpointReady(env);
        const publicBackup = telegramCanary ? backup : {
          available: false,
          availabilityCode: 'LIVE_E2E_PENDING',
          genericFlow: true,
          providerNamesExposed: false
        };
        const body = {
          ok: true,
          auth: {
            version: AUTH_NATIVE_VERSION,
            uiContract: AUTH_UI_VERSION,
            onboarding: {
              version: 'premium-onboarding-v1',
              firstEntryRemembered: true,
              guestAllowed: true,
              profileVersion: 1
            },
            mode: 'firebase-canonical-multi-method',
            provider: 'firebase',
            available,
            availabilityCode: available ? 'READY' : availability.code,
            providerStatus: availability.providerStatus,
            storage: health.storage,
            accountVerificationRequired: true,
            emailVerifiedRequired: !telegramVerification.available,
            emailOwnershipProof: 'firebase-email-verification-only',
            methods: {
              google,
              passkey: {
                available: passkeyAvailable,
                enrollmentAvailable: passkeyEnrollmentAvailable,
                availabilityCode: passkeyAvailable ? 'READY' : passkeyEndpointReady(env) ? 'LIVE_E2E_PENDING' : 'NOT_ACTIVATED',
                requiresEnrollment: true,
                neverMandatory: true
              },
              emailPassword: { available, availabilityCode: available ? 'READY' : availability.code },
              passwordReset: { available, availabilityCode: available ? 'READY' : availability.code },
              profile: { available, version: 1, accountScoped: true, pendingTicketScoped: true },
              telegramVerification,
              backup: publicBackup
            },
            verificationEmail: {
              kind: 'address-verification',
              dailyCapacity: 1000,
              resendCooldownSeconds: FIREBASE_VERIFICATION_RESEND_SECONDS,
              statusCheckAvailable: true
            },
            registeredAccountLimit: 'unlimited',
            session: { transport: 'secure-http-only-cookie', maxAge: SESSION_SECONDS }
          }
        };
        const nextCache = cache || new Map();
        nextCache.set(cacheVariant, { body, expiresAt: Date.now() + 30_000 });
        if (!cache) publicConfigCache.set(env, nextCache);
        return json(request, 200, body);
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/signup`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const telegramRequested = telegramVerificationRequested(env, url);
        if (telegramRequested && !currentAuthUi(request)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.CLIENT_UPDATE_REQUIRED);
        }
        const input = credentials(await readJson(request));
        const prepared = await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'signup', email: input.email }, context });
        let signed;
        try { signed = await provider.signUp(prepared.email, input.password); } catch (cause) { throw providerError(cause, 'signup'); }

        const telegramAvailable = await telegramVerificationAvailable(env, telegramRequested);
        if (telegramRequested) {
          try {
            const temporaryRefreshMaterial = signed.refreshToken;
            const ticket = await callAuthority(env, '/internal/firebase/account-verification/begin', {
              input: {
                email: prepared.email,
                subject: signed.subject,
                refreshToken: temporaryRefreshMaterial
              },
              context
            });
            return json(request, 202, {
              ok: true,
              accountCreated: true,
              authenticated: false,
              verification: {
                sent: false,
                selectionRequired: true,
                emailMasked: prepared.emailMask,
                requiredBeforeLogin: true,
                options: {
                  email: { available: true, verifiesEmailOwnership: true },
                  telegram: { available: telegramAvailable, verifiesEmailOwnership: false }
                }
              }
            }, {
              'Set-Cookie': [
                ...(context.isNewDevice ? [deviceCookie(context.deviceId)] : []),
                verificationCookie(ticket.verificationTicket)
              ]
            });
          } catch {
            // Public dual-choice signup must never silently fall back to sending
            // Email. Keep the canonical Firebase subject recoverable by password
            // login, but fail closed with an explicit no-delivery message.
            throw new NativeAuthError(AUTH_ERROR_CODES.VERIFICATION_UNAVAILABLE, {
              message: 'অ্যাকাউন্ট তৈরি হয়েছে, কিন্তু যাচাইয়ের পদ্ধতি এখন প্রস্তুত করা যাচ্ছে না—কিছু পাঠানো হয়নি। একটু পরে এই ইমেইল দিয়ে লগইন করুন।'
            });
          }
        }

        try {
          await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'verification-send', email: prepared.email }, context });
          await provider.sendVerificationEmail(signed.idToken, prepared.email);
        } catch (cause) {
          try { await provider.deleteAccount(signed.idToken); } catch {}
          throw cause instanceof NativeAuthError ? cause : providerError(cause, 'verification');
        }
        return json(request, 202, {
          ok: true,
          accountCreated: true,
          authenticated: false,
          verification: {
            sent: true,
            selectionRequired: false,
            emailMasked: prepared.emailMask,
            requiredBeforeLogin: true,
            dailyCapacity: 1000,
            resendAfter: FIREBASE_VERIFICATION_RESEND_SECONDS
          }
        }, context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/password-reset`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const body = await readJson(request);
        const email = normalizeAuthEmail(body?.email);
        const prepared = await callAuthority(env, '/internal/firebase/rate', {
          input: { operation: 'password-reset', email }, context
        });
        try {
          await provider.sendPasswordResetEmail(prepared.email);
        } catch (cause) {
          // Account existence, disabled state, and provider-side address normalization must look identical.
          const privateAccountResult = cause instanceof FirebaseRequestError
            && ['EMAIL_NOT_FOUND', 'USER_DISABLED', 'INVALID_EMAIL', 'MISSING_EMAIL'].includes(cause.reason);
          if (!privateAccountResult) throw providerError(cause, 'password-reset');
        }
        return json(request, 202, {
          ok: true,
          accepted: true,
          deliveryDisclosed: false,
          resendAfter: FIREBASE_VERIFICATION_RESEND_SECONDS
        }, context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/verification/resend`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const input = credentials(await readJson(request));
        const prepared = await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'verification-resend', email: input.email }, context });
        let signed;
        let user;
        try { signed = await provider.signIn(prepared.email, input.password); } catch (cause) { throw providerError(cause, 'signin'); }
        try { user = await provider.lookup(signed.idToken); } catch (cause) { throw providerError(cause, 'lookup'); }
        assertProviderUser(signed, user);
        if (user.emailVerified) return json(request, 200, { ok: true, alreadyVerified: true, authenticated: false });
        await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'verification-send', email: user.email }, context });
        try { await provider.sendVerificationEmail(signed.idToken, user.email); } catch (cause) { throw providerError(cause, 'verification'); }
        return json(request, 202, {
          ok: true,
          authenticated: false,
          verification: { sent: true, emailMasked: prepared.emailMask, dailyCapacity: 1000, resendAfter: FIREBASE_VERIFICATION_RESEND_SECONDS }
        }, context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/login`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const input = credentials(await readJson(request));
        const prepared = await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'login', email: input.email }, context });
        // Phase 6 — escalating cooldown after repeated failed logins (§14):
        // the DO counts recorded failures and asks us to delay this attempt.
        // A delay, never a lockout: the cooldown always expires.
        if (Number(prepared?.retryAfter) > 0) {
          return json(request, 429, { ok: false, error: { code: 'RATE_LIMITED', message: 'অনেকবার চেষ্টা হয়েছে—একটু পরে আবার চেষ্টা করুন।' } }, { 'Retry-After': String(prepared.retryAfter) });
        }
        let signed;
        let user;
        let failureRetryAfter = 0;
        try {
          signed = await provider.signIn(prepared.email, input.password);
        } catch (cause) {
          if (cause instanceof FirebaseRequestError && ['INVALID_LOGIN_CREDENTIALS', 'EMAIL_NOT_FOUND', 'INVALID_PASSWORD'].includes(cause.reason)) {
            try {
              const recorded = await callAuthority(env, '/internal/firebase/login/failure', { input: { email: prepared.email }, context });
              failureRetryAfter = Number(recorded?.retryAfter || 0);
            } catch {}
          }
          const error = providerError(cause, 'signin');
          if (failureRetryAfter > 0) error.retryAfter = Math.max(Number(error.retryAfter || 0), failureRetryAfter);
          throw error;
        }
        try { user = await provider.lookup(signed.idToken); } catch (cause) { throw providerError(cause, 'lookup'); }
        assertProviderUser(signed, user);
        const telegramRequested = telegramVerificationRequested(env, url);
        const telegramVerified = !user.emailVerified && await telegramVerificationStatus({
          env,
          user,
          context,
          allowed: telegramRequested
        });
        if (!user.emailVerified && !telegramVerified && telegramRequested && !currentAuthUi(request)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.CLIENT_UPDATE_REQUIRED);
        }
        const telegramAvailable = await telegramVerificationAvailable(env, telegramRequested);
        if (!user.emailVerified && !telegramVerified && telegramRequested) {
          try {
            const temporaryRefreshMaterial = signed.refreshToken;
            const ticket = await callAuthority(env, '/internal/firebase/account-verification/begin', {
              input: {
                email: user.email,
                subject: user.subject,
                refreshToken: temporaryRefreshMaterial
              },
              context
            });
            return json(request, 202, {
              ok: true,
              authenticated: false,
              accountVerified: false,
              verification: {
                sent: false,
                selectionRequired: true,
                emailMasked: prepared.emailMask,
                options: {
                  email: { available: true, verifiesEmailOwnership: true },
                  telegram: { available: telegramAvailable, verifiesEmailOwnership: false }
                }
              }
            }, {
              'Set-Cookie': [
                ...(context.isNewDevice ? [deviceCookie(context.deviceId)] : []),
                verificationCookie(ticket.verificationTicket)
              ]
            });
          } catch {}
        }
        if (!user.emailVerified && !telegramVerified) throw new NativeAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
        const established = await callAuthority(env, '/internal/firebase/session/create', {
          input: {
            email: user.email,
            subject: user.subject,
            remember: input.remember,
            verified: user.emailVerified === true || telegramVerified === true,
            newDevice: context.isNewDevice === true,
            securityChallenge: true
          },
          context
        });
        // Phase 6 — new device (or elevated risk) on a verified account:
        // challenge-first-then-proceed, reusing the existing verification
        // selection UI. Completing it issues the session AND earns 30-day
        // device trust (single consent moment, no TOTP in v1).
        if (established.challenge) {
          let ticket;
          try {
            const temporaryRefreshMaterial = signed.refreshToken;
            ticket = await callAuthority(env, '/internal/firebase/account-verification/begin', {
              input: {
                email: user.email,
                subject: user.subject,
                refreshToken: temporaryRefreshMaterial,
                purpose: 'new-device'
              },
              context
            });
          } catch {
            // Fail closed: a risk decision can never be silently bypassed.
            throw new NativeAuthError(AUTH_ERROR_CODES.VERIFICATION_UNAVAILABLE, {
              message: 'নিরাপত্তার জন্য এই ডিভাইসটি এখন যাচাই করা যাচ্ছে না—একটু পরে আবার চেষ্টা করুন।'
            });
          }
          return json(request, 202, {
            ok: true,
            authenticated: false,
            accountVerified: true,
            verification: {
              sent: false,
              selectionRequired: true,
              emailMasked: prepared.emailMask,
              reason: 'new-device',
              options: {
                email: { available: true, verifiesEmailOwnership: true },
                telegram: { available: telegramAvailable, verifiesEmailOwnership: false }
              }
            },
            security: {
              challenge: established.challenge.type,
              level: established.challenge.level,
              policyVersion: established.challenge.policyVersion
            }
          }, {
            'Set-Cookie': [
              ...(context.isNewDevice ? [deviceCookie(context.deviceId)] : []),
              verificationCookie(ticket.verificationTicket)
            ]
          });
        }
        return authSuccess(request, established, signed.refreshToken, context, {
          emailVerified: user.emailVerified === true,
          telegramVerified
        });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/google`) {
        if (!provider.configured || !googleEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.GOOGLE_UNAVAILABLE);
        try { await provider.inspectGoogleProvider(); } catch (cause) { throw providerError(cause, 'google-config'); }
        const credential = googleCredential(await readJson(request));
        await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'google' }, context });
        let signed;
        let user;
        try { signed = await provider.signInWithGoogle(credential); } catch (cause) { throw providerError(cause, 'google-signin'); }
        try { user = await provider.lookup(signed.idToken); } catch (cause) { throw providerError(cause, 'google-lookup'); }
        assertProviderUser(signed, user);
        if (!user.providers.includes('google.com')) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
        if (!user.emailVerified) throw new NativeAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
        let established;
        try {
          established = await callAuthority(env, '/internal/firebase/session/create', { input: { email: user.email, subject: user.subject }, context });
        } catch (cause) {
          if (cause?.code === AUTH_ERROR_CODES.ACCOUNT_CONFLICT && signed.isNewUser) {
            let deleted = false;
            try { deleted = (await provider.deleteAccount(signed.idToken))?.deleted === true; } catch {}
            if (!deleted) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
            throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_LINK_REQUIRED);
          }
          throw cause;
        }
        return authSuccess(request, established, signed.refreshToken, context);
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/google/link`) {
        if (!provider.configured || !googleEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.GOOGLE_UNAVAILABLE);
        const body = await readJson(request);
        const input = credentials(body);
        const credential = googleCredential(body);
        if (!credential.accessToken) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
        const email = normalizeAuthEmail(input.email);
        let googleIdentity;
        try { googleIdentity = await provider.googleIdentity(credential.accessToken); } catch (cause) { throw providerError(cause, 'google-identity'); }
        if (normalizeAuthEmail(googleIdentity.email) !== email) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
        const prepared = await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'login', email }, context });
        let passwordSession;
        let passwordUser;
        try { passwordSession = await provider.signIn(prepared.email, input.password); } catch (cause) { throw providerError(cause, 'signin'); }
        try { passwordUser = await provider.lookup(passwordSession.idToken); } catch (cause) { throw providerError(cause, 'lookup'); }
        assertProviderUser(passwordSession, passwordUser);
        const passwordTelegramVerified = !passwordUser.emailVerified && await telegramVerificationStatus({
          env,
          user: passwordUser,
          context,
          allowed: telegramVerificationRequested(env, url)
        });
        if (!passwordUser.emailVerified && !passwordTelegramVerified) throw new NativeAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
        let linked;
        let user;
        try { linked = await provider.linkGoogle(passwordSession.idToken, credential); } catch (cause) { throw providerError(cause, 'google-link'); }
        if (linked.subject !== passwordSession.subject) throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
        try { user = await provider.lookup(linked.idToken); } catch (cause) { throw providerError(cause, 'google-lookup'); }
        assertProviderUser(linked, user);
        if (!user.providers.includes('google.com') || !user.googleSubjects.includes(googleIdentity.subject)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.ACCOUNT_CONFLICT);
        }
        const established = await callAuthority(env, '/internal/firebase/session/create', { input: { email: user.email, subject: user.subject }, context });
        return authSuccess(request, established, linked.refreshToken, context, {
          emailVerified: user.emailVerified === true,
          telegramVerified: user.emailVerified !== true && passwordTelegramVerified
        });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/account-verification/email/start`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        await readJson(request);
        const material = await callAuthority(env, '/internal/firebase/account-verification/material', {
          verificationTicket,
          context
        });
        let refreshed;
        let user;
        try { refreshed = await provider.refresh(material.refreshToken); } catch (cause) { throw providerError(cause, 'refresh'); }
        try { user = await provider.lookup(refreshed.idToken); } catch (cause) { throw providerError(cause, 'lookup-session'); }
        assertProviderUser(refreshed, user);
        if (user.emailVerified) {
          return json(request, 200, { ok: true, alreadyVerified: true, authenticated: false });
        }
        await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'verification-send', email: user.email }, context });
        try { await provider.sendVerificationEmail(refreshed.idToken, user.email); } catch (cause) { throw providerError(cause, 'verification'); }
        return json(request, 202, {
          ok: true,
          authenticated: false,
          verification: {
            sent: true,
            emailMasked: material.user?.emailMasked || 'আপনার ইমেইলে',
            dailyCapacity: 1000,
            resendAfter: FIREBASE_VERIFICATION_RESEND_SECONDS
          }
        }, context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/account-verification/email/status`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        await readJson(request);
        await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'verification-status' }, context });
        const material = await callAuthority(env, '/internal/firebase/account-verification/material', {
          verificationTicket,
          context
        });
        let refreshed;
        let user;
        try { refreshed = await provider.refresh(material.refreshToken); } catch (cause) { throw providerError(cause, 'refresh'); }
        try { user = await provider.lookup(refreshed.idToken); } catch (cause) { throw providerError(cause, 'lookup-session'); }
        assertProviderUser(refreshed, user);
        if (user.emailVerified !== true) {
          return json(request, 200, {
            ok: true,
            authenticated: false,
            emailVerified: false,
            emailMasked: material.user?.emailMasked || 'তোমার Email-এ'
          }, context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
        }
        const established = await callAuthority(env, '/internal/firebase/account-verification/complete', {
          input: {
            verificationTicket,
            email: user.email,
            subject: user.subject
          },
          context
        });
        return authSuccess(request, established, refreshed.refreshToken, context, {
          emailVerified: true,
          telegramVerified: false
        }, [verificationCookie('', 0)]);
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/telegram/verification/start`) {
        if (!provider.configured || !telegramVerificationRequested(env, url)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_UNAVAILABLE);
        }
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        await readJson(request);
        const result = await callAuthority(env, '/internal/verification/preauth/request', {
          input: { verificationTicket },
          context
        });
        return json(request, 202, { ok: true, ...result }, context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
      }

      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/telegram/verification/pending`) {
        if (!provider.configured || !telegramVerificationRequested(env, url)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_UNAVAILABLE);
        }
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        const [material, result] = await Promise.all([
          callAuthority(env, '/internal/firebase/account-verification/material', { verificationTicket, context }),
          callAuthority(env, '/internal/verification/preauth/pending', {
            input: { verificationTicket },
            context
          })
        ]);
        return json(request, 200, {
          ok: true,
          ...result,
          ...(!result?.pending ? {
            selectionRequired: true,
            emailMasked: material.user?.emailMasked || 'আপনার ইমেইলে',
            options: {
              email: { available: true, verifiesEmailOwnership: true },
              telegram: { available: true, verifiesEmailOwnership: false }
            }
          } : {})
        }, context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/telegram/verification/resend`) {
        if (!provider.configured || !telegramVerificationRequested(env, url)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_UNAVAILABLE);
        }
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        await readJson(request);
        const result = await callAuthority(env, '/internal/verification/preauth/request', {
          input: { verificationTicket },
          context
        });
        return json(request, 202, { ok: true, ...result }, context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/telegram/verification/verify`) {
        if (!provider.configured || !telegramVerificationRequested(env, url)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_UNAVAILABLE);
        }
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        const body = await readJson(request);
        const code = String(body.code || '').trim();
        const attemptId = String(body.attemptId || '').trim();
        if (!/^\d{6}$/.test(code) || !/^[A-Za-z0-9_-]{24,96}$/.test(attemptId)) {
          throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
        }
        const material = await callAuthority(env, '/internal/firebase/account-verification/material', {
          verificationTicket,
          context
        });
        let refreshed;
        let user;
        try { refreshed = await provider.refresh(material.refreshToken); } catch (cause) { throw providerError(cause, 'refresh'); }
        try { user = await provider.lookup(refreshed.idToken); } catch (cause) { throw providerError(cause, 'lookup-session'); }
        assertProviderUser(refreshed, user);
        const verified = await callAuthority(env, '/internal/verification/preauth/verify', {
          input: {
            verificationTicket,
            email: user.email,
            subject: user.subject,
            attemptId,
            code
          },
          context
        });
        if (verified?.verified !== true || verified?.telegramLinked !== true) {
          throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        }
        const established = await callAuthority(env, '/internal/firebase/account-verification/complete', {
          input: {
            verificationTicket,
            email: user.email,
            subject: user.subject
          },
          context
        });
        return authSuccess(request, established, refreshed.refreshToken, context, {
          emailVerified: user.emailVerified === true,
          telegramVerified: true
        }, [verificationCookie('', 0)]);
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/profile/pending`) {
        const verificationTicket = jar[AUTH_VERIFICATION_COOKIE];
        if (!verificationTicket) throw new NativeAuthError(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
        const profile = await readJson(request);
        await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'pending-profile-write' }, context });
        const result = await callAuthority(env, '/internal/profile/save-pending', {
          verificationTicket,
          input: profile,
          context
        });
        return json(request, 200, { ok: true, saved: result?.saved === true },
          context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/profile`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const profile = await readJson(request);
        const current = await firebaseReadySession({
          provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url)
        });
        await callAuthority(env, '/internal/firebase/rate', {
          input: { operation: 'profile-write', email: current.user.email }, context
        });
        const result = await callAuthority(env, '/internal/profile/save', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            profile
          },
          context
        });
        return json(request, 200, { ok: true, saved: result?.saved === true, profile: result?.profile || null }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      // Phase 7 — profile response is additive: `profile` keeps the legacy
      // shape; publicId/completion/avatar/context are new read-only fields.
      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/profile`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const current = await firebaseReadySession({
          provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url)
        });
        const result = await callAuthority(env, '/internal/profile/get-v2', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject
          },
          context
        });
        return json(request, 200, {
          ok: true,
          profile: result?.profile || null,
          publicId: result?.publicId || null,
          completion: Number(result?.completion || 0),
          avatar: result?.avatar || { present: false },
          avatarUrl: result?.avatarUrl || null,
          joinedYear: result?.joinedYear || null,
          context: result?.context || null
        }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/profile/patch`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const body = await readJson(request);
        const current = await firebaseReadySession({
          provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url)
        });
        await callAuthority(env, '/internal/firebase/rate', {
          input: { operation: 'profile-patch', email: current.user.email }, context
        });
        const result = await callAuthority(env, '/internal/profile/patch', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            fields: body?.fields,
            expectVersion: body?.expectVersion
          },
          context
        });
        return json(request, 200, { ok: true, saved: result?.saved === true, profile: result?.profile || null }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      // Phase 7 — avatar upload (base64 JSON; server validates MIME +
      // magic bytes + size; client filename is never trusted).
      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/profile/avatar`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const body = await readJson(request, 3_500_000);
        const current = await firebaseReadySession({
          provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url)
        });
        await callAuthority(env, '/internal/firebase/rate', {
          input: { operation: 'avatar-write', email: current.user.email }, context
        });
        const result = await callAuthority(env, '/internal/avatar/save', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            data: body?.data,
            mime: body?.mime
          },
          context
        });
        return json(request, 200, { ok: true, saved: result?.saved === true }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      if (request.method === 'DELETE' && url.pathname === `${AUTH_API_PREFIX}/profile/avatar`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const current = await firebaseReadySession({
          provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url)
        });
        await callAuthority(env, '/internal/firebase/rate', {
          input: { operation: 'avatar-write', email: current.user.email }, context
        });
        const result = await callAuthority(env, '/internal/avatar/delete', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject
          },
          context
        });
        return json(request, 200, { ok: true, deleted: result?.deleted === true }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/profile/avatar`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const current = await firebaseReadySession({
          provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url)
        });
        const result = await callAuthority(env, '/internal/avatar/get', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject
          },
          context
        });
        if (!result?.present) return json(request, 404, { ok: false, error: { code: 'AVATAR_NOT_FOUND' } });
        const bytes = Uint8Array.from(atob(result.data), char => char.charCodeAt(0));
        return new Response(bytes, {
          status: 200,
          headers: new Headers({
            'Content-Type': result.mime,
            'Content-Length': String(bytes.byteLength),
            'Cache-Control': 'private, max-age=3600, no-store=0',
            ...corsHeaders(request)
          })
        });
      }

      // Phase 7 — public-safe profile projection (unauthenticated,
      // rate-limited). Private profiles never surface.
      if (request.method === 'GET' && url.pathname.startsWith('/api/public/profile/')) {
        const suffix = decodeURIComponent(url.pathname.slice('/api/public/profile/'.length));
        const isAvatar = suffix.endsWith('/avatar');
        const publicId = isAvatar ? suffix.slice(0, -'/avatar'.length) : suffix;
        await callAuthority(env, '/internal/firebase/rate', {
          input: { operation: 'public-profile-read' }, context
        });
        if (isAvatar) {
          const result = await callAuthority(env, '/internal/public-profile/avatar', {
            input: { publicId }
          });
          if (!result?.present) return json(request, 404, { ok: false, error: { code: 'AVATAR_NOT_FOUND' } });
          const bytes = Uint8Array.from(atob(result.data), char => char.charCodeAt(0));
          return new Response(bytes, {
            status: 200,
            headers: new Headers({
              'Content-Type': result.mime,
              'Content-Length': String(bytes.byteLength),
              'Cache-Control': 'public, max-age=3600',
              'Cross-Origin-Resource-Policy': 'cross-site',
              ...corsHeaders(request)
            })
          });
        }
        const result = await callAuthority(env, '/internal/public-profile/get', {
          input: { publicId }
        });
        return json(request, 200, { ok: true, profile: result?.profile || null });
      }
      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/account`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const current = await firebaseReadySession({
          provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url)
        });
        const result = await callAuthority(env, '/internal/account/state', {
          sessionToken: current.sessionToken,
          input: { email: current.user.email, subject: current.user.subject },
          context
        });
        return json(request, 200, { ok: true, account: result?.account || null }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/identities`) {
        if (!provider.configured) throw new NativeAuthError(AUTH_ERROR_CODES.NOT_CONFIGURED);
        const current = await firebaseReadySession({
          provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url)
        });
        const result = await callAuthority(env, '/internal/account/identities', {
          sessionToken: current.sessionToken,
          input: { email: current.user.email, subject: current.user.subject },
          context
        });
        return json(request, 200, { ok: true, identities: result?.identities || [] }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/admin/identity/health`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
        const result = await callAuthority(env, '/internal/identity/health', {});
        return json(request, 200, { ok: true, health: result?.health || null });
      }
      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/admin/account/state`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
        const body = await readJson(request);
        const result = await callAuthority(env, '/internal/account/state/set', {
          userId: String(body?.userId || '').slice(0, 256),
          status: String(body?.status || '')
        });
        return json(request, 200, { ok: true, account: result?.account || null });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/passkey/registration/begin`) {
        if (!provider.configured || !passkeyEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/passkey/registration/begin', {
          input: {
            sessionToken: current.sessionToken,
            refreshToken: current.refreshed.refreshToken,
            email: current.user.email,
            subject: current.user.subject
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/passkey/registration/finish`) {
        if (!provider.configured || !passkeyEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/passkey/registration/finish', {
          input: {
            challengeId: body.challengeId,
            response: body.response,
            sessionToken: current.sessionToken,
            refreshToken: current.refreshed.refreshToken,
            email: current.user.email,
            subject: current.user.subject
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/passkey/authentication/begin`) {
        if (!provider.configured || !passkeyEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
        const result = await callAuthority(env, '/internal/passkey/authentication/begin', { context });
        return json(request, 200, { ok: true, ...result }, context.isNewDevice ? { 'Set-Cookie': deviceCookie(context.deviceId) } : {});
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/passkey/authentication/finish`) {
        if (!provider.configured || !passkeyEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
        const body = await readJson(request);
        const assertion = await callAuthority(env, '/internal/passkey/authentication/finish', {
          input: { challengeId: body.challengeId, response: body.response },
          context
        });
        let refreshed;
        let user;
        try { refreshed = await provider.refresh(assertion.refreshToken); } catch (cause) { throw providerError(cause, 'passkey-refresh'); }
        try { user = await provider.lookup(refreshed.idToken); } catch (cause) { throw providerError(cause, 'lookup-session'); }
        assertProviderUser(refreshed, user);
        const passkeyTelegramVerified = !user.emailVerified && await telegramVerificationStatus({
          env,
          user,
          context,
          allowed: telegramVerificationRequested(env, url)
        });
        if (!user.emailVerified && !passkeyTelegramVerified) throw new NativeAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
        const established = await callAuthority(env, '/internal/passkey/session/complete', {
          input: {
            loginTicket: assertion.loginTicket,
            refreshToken: refreshed.refreshToken,
            email: user.email,
            subject: user.subject
          },
          context
        });
        return authSuccess(request, established, refreshed.refreshToken, context, {
          emailVerified: user.emailVerified === true,
          telegramVerified: passkeyTelegramVerified
        });
      }

      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/passkey/status`) {
        if (!provider.configured || !passkeyEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/passkey/status', {
          input: { sessionToken: current.sessionToken, email: current.user.email, subject: current.user.subject },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/passkey/remove`) {
        if (!provider.configured || !passkeyEndpointReady(env)) throw new NativeAuthError(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/passkey/remove', {
          input: {
            credentialId: body.credentialId,
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/backup/request`) {
        if (!provider.configured || !(verificationPublished(env) || telegramCanaryRequested(env, url))) {
          throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
        }
        const body = await readJson(request);
        const contact = String(body.contact || '').trim();
        if (contact && !/^\+[1-9]\d{7,14}$/.test(contact)) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/verification/request', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            purpose: body.purpose === 'sensitive-action' ? 'sensitive-action' : 'account-backup',
            contact,
            allowTelegramLink: true
          },
          context
        });
        return json(request, 202, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/backup/verify`) {
        if (!provider.configured || !(verificationPublished(env) || telegramCanaryRequested(env, url))) {
          throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
        }
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/verification/verify', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            purpose: body.purpose === 'sensitive-action' ? 'sensitive-action' : 'account-backup',
            attemptId: body.attemptId,
            code: body.code,
            evidence: body.evidence
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }

      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/admin/verification/status`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
        const result = await callAuthority(env, '/internal/verification/admin/status', {});
        return json(request, 200, { ok: true, ...result });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/admin/verification/config`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
        const body = await readJson(request);
        const result = await callAuthority(env, '/internal/verification/admin/config', { config: verificationConfig(body.config) });
        publicConfigCache.delete(env);
        return json(request, 200, { ok: true, ...result });
      }

      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/session`) {
        // Explicit session bootstrap: the single tracked refresh/revalidation
        // path (telemetry: 'session-refreshed'). No extra DO round-trip.
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url), trackRefresh: true });
        const maxAge = Math.max(1, Math.min(SESSION_SECONDS, Math.floor((Number(current.session.expiresAt) - Date.now()) / 1000)));
        return json(request, 200, {
          ok: true,
          authenticated: true,
          accountVerified: true,
          emailVerified: current.user.emailVerified === true,
          telegramVerified: current.telegramVerified === true,
          ...current.session
        }, {
          'Set-Cookie': [firebaseCookie(current.refreshed.refreshToken, maxAge), ...(context.isNewDevice ? [deviceCookie(context.deviceId)] : [])]
        });
      }

      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/session/logout`) {
        const sessionToken = jar[AUTH_SESSION_COOKIE];
        if (sessionToken) await callAuthority(env, '/internal/session/revoke', { sessionToken });
        return json(request, 200, { ok: true, authenticated: false }, { 'Set-Cookie': clearAuthCookies() });
      }
      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/session/logout-all`) {
        // Phase 5 §12: revoke every session for the current user on every
        // device. Phase 6 §12: step-up gated — a verified step-up challenge
        // (stepUpToken) is required once the session is no longer recent or
        // current risk reaches ELEVATED. A STEP_UP_REQUIRED error keeps the
        // session alive so the client can run the challenge and retry.
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/session/revoke-all', {
          sessionToken: current.sessionToken,
          input: { email: current.user.email, subject: current.user.subject, stepUpToken: String(body?.stepUpToken || '') },
          context
        });
        return json(request, 200, { ok: true, authenticated: false, revoked: Number(result?.revoked || 0) }, { 'Set-Cookie': clearAuthCookies() });
      }

      // Phase 6 — purpose-bound security challenges (§11-§12). Session
      // required; codes are delivered by the existing verification pipeline
      // (email/Telegram). A verified challenge returns a one-time
      // stepUpToken bound to this user+device.
      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/security/challenge/request`) {
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/security/challenge/request', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            purpose: String(body?.purpose || ''),
            method: String(body?.method || 'email')
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/security/challenge/verify`) {
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/security/challenge/verify', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            challengeRef: String(body?.challengeRef || ''),
            purpose: String(body?.purpose || ''),
            code: String(body?.code || '')
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/security/challenge/cancel`) {
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/security/challenge/cancel', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            challengeRef: String(body?.challengeRef || ''),
            purpose: String(body?.purpose || '')
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      // Phase 6 — explicit "trust this device" (the 30-day consent).
      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/security/device/trust`) {
        await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/security/device/trust', {
          input: { sessionToken: current.sessionToken, email: current.user.email, subject: current.user.subject },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      // Phase 6 Chunk 4 — signed-in security state (device list, trust, status).
      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/security/state`) {
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/security/state', {
          input: { sessionToken: current.sessionToken, email: current.user.email, subject: current.user.subject },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      // Phase 6 Chunk 4 — recent login history (privacy boundary: method,
      // coarse browser class and time only; no IP, no location, ever).
      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/security/history`) {
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/security/history', {
          input: { sessionToken: current.sessionToken, email: current.user.email, subject: current.user.subject },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      // Phase 6 Chunk 4 — step-up-gated trusted-device revocation.
      if (request.method === 'POST' && url.pathname === `${AUTH_API_PREFIX}/security/devices/revoke`) {
        const body = await readJson(request);
        const current = await firebaseReadySession({ provider, jar, env, context, allowTelegram: telegramVerificationRequested(env, url) });
        const result = await callAuthority(env, '/internal/security/device/revoke', {
          input: {
            sessionToken: current.sessionToken,
            email: current.user.email,
            subject: current.user.subject,
            scope: String(body?.scope || 'current'),
            deviceRef: String(body?.deviceRef || ''),
            stepUpToken: String(body?.stepUpToken || '')
          },
          context
        });
        return json(request, 200, { ok: true, ...result }, {
          'Set-Cookie': sessionCookies(current.session, current.refreshed.refreshToken, context)
        });
      }
      // Phase 6 Chunk 4 — admin security surface (token-gated, refs only).
      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/admin/security/health`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
        const result = await callAuthority(env, '/internal/admin/security/health', {});
        return json(request, 200, { ok: true, result });
      }
      if (request.method === 'GET' && url.pathname === `${AUTH_API_PREFIX}/admin/security/events`) {
        if (!adminAuthorized(request, env)) return json(request, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'অনুমতি নেই।' } });
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
        const before = url.searchParams.get('before') ? Number(url.searchParams.get('before')) : null;
        const result = await callAuthority(env, '/internal/admin/security/events', { input: { limit, before } });
        return json(request, 200, { ok: true, ...result });
      }

      return json(request, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Endpoint পাওয়া যায়নি।' } });
    } catch (cause) {
      const error = asNativeAuthError(cause);
      const clearSession = Boolean(jar[AUTH_SESSION_COOKIE])
        && [AUTH_ERROR_CODES.SESSION_INVALID, AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED, AUTH_ERROR_CODES.ACCOUNT_DISABLED].includes(error.code);
      if (clearSession && jar[AUTH_SESSION_COOKIE]) {
        try { await callAuthority(env, '/internal/session/revoke', { sessionToken: jar[AUTH_SESSION_COOKIE] }); } catch {}
      }
      const providerDiagnosticCode = /^[A-Z0-9_]{1,80}$/.test(String(error.providerDiagnostic || '')) ? String(error.providerDiagnostic) : '';
      return json(request, error.status, { ok: false, error: error.toPublic() }, {
        ...(error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {}),
        ...(providerDiagnosticCode ? { 'X-AH-Auth-Diagnostic': providerDiagnosticCode } : {}),
        ...(clearSession ? { 'Set-Cookie': clearAuthCookies() } : {})
      });
    }
  };
}

export const __publicAuthTest = Object.freeze({
  allowedOrigin,
  providerError,
  googleEndpointReady,
  googlePublished,
  googleCanaryRequested,
  verificationEndpointReady,
  verificationPublished,
  telegramCanaryRequested,
  telegramActivationAuthorized,
  adminAuthorized,
  passkeyEndpointReady,
  passkeyPublished
});
