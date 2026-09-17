import {
  VERIFICATION_CHANNELS,
  VERIFICATION_FAILURE_CLASS,
  VERIFICATION_MODES,
  VerificationProviderError
} from './provider-contract.mjs';
import { deriveTelegramWebhookSecret, validTelegramWebhookSecret } from './telegram-security.mjs';

const safeInteger = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : 0;
};
const validSecret = value => typeof value === 'string' && value.length >= 20 && value.length <= 4096 && !/[\r\n\u0000]/.test(value);
const validTelegramBotToken = value => /^[1-9]\d{5,19}:[A-Za-z0-9_-]{30,100}$/.test(String(value || ''));
const validTelegramBotUsername = value => /^(?=.{5,32}$)[A-Za-z][A-Za-z0-9_]*bot$/i.test(String(value || ''));

function httpsOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return '';
    return url.origin;
  } catch { return ''; }
}

function telegramWebhookEndpoint(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/api/auth/v1/telegram/webhook') return '';
    if (!['admissionhub.pages.dev', 'admission-gk.admissionhub.workers.dev'].includes(url.hostname)) return '';
    return url.href;
  } catch { return ''; }
}

async function boundedJson(response, maximum = 32 * 1024) {
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (!total) return {};
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD); }
}

function httpFailure(response, _payload, { userStatuses = [400, 404, 422] } = {}) {
  const status = Number(response?.status || 0);
  const code = status >= 100 && status <= 599 ? `PROVIDER_HTTP_${status}` : 'PROVIDER_FAILURE';
  if (userStatuses.includes(status)) return new VerificationProviderError(code, VERIFICATION_FAILURE_CLASS.USER);
  if ([401, 403].includes(status)) return new VerificationProviderError(code, VERIFICATION_FAILURE_CLASS.HARD);
  if (status === 429 || status >= 500 || status === 0) return new VerificationProviderError(code, VERIFICATION_FAILURE_CLASS.TEMPORARY, { retryAfter: 60 });
  return new VerificationProviderError(code, VERIFICATION_FAILURE_CLASS.HARD);
}

async function fetchJson(fetchImpl, url, init = {}, { redirect = 'manual', timeoutMs = 12_000 } = {}) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, redirect, signal: init.signal || AbortSignal.timeout(timeoutMs) });
  } catch { throw new VerificationProviderError('NETWORK_ERROR', VERIFICATION_FAILURE_CLASS.TEMPORARY); }
  const payload = await boundedJson(response);
  if (!response.ok) throw httpFailure(response, payload);
  return payload;
}

const base64UrlBytes = bytes => {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// Script IDs are ~57 chars; the bound keeps a hostile value from becoming a
// huge URL without rejecting legitimate ids.
function appsScriptWebAppUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
    if (url.hostname !== 'script.google.com') return '';
    if (!/^\/macros\/s\/[A-Za-z0-9_-]{20,80}\/exec$/.test(url.pathname)) return '';
    return url.href;
  } catch { return ''; }
}

const validEmailAddress = value => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '')) && String(value).length <= 254;

const OTP_EMAIL_FONT = "'Hind Siliguri','Noto Sans Bengali','SolaimanLipi','Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Mail clients need an absolute URL, so the logo is served from the public Pages
// site rather than embedded.
const OTP_EMAIL_LOGO_URL = 'https://admissionhub.pages.dev/icons/email-logo.png';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
));

// A recipient-supplied display name is untrusted: it is escaped for HTML above and
// stripped of control characters here so it cannot break the greeting line.
const cleanDisplayName = value => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 60);

const OTP_EMAIL_TAGLINE = 'আপনার প্রস্তুতি, আরও গুছিয়ে।';

const otpEmailBody = (code, minutes, recipientName = '') => {
  const safeCode = escapeHtml(code);
  const safeMinutes = escapeHtml(minutes);
  const displayName = cleanDisplayName(recipientName);
  const greeting = displayName ? `প্রিয় ${escapeHtml(displayName)},` : 'প্রিয় ব্যবহারকারী,';
  const plainGreeting = displayName ? `প্রিয় ${displayName},` : 'প্রিয় ব্যবহারকারী,';

  const text = [
    plainGreeting,
    '',
    'আপনার ইমেইল ঠিকানাটি যাচাই করতে নিচের OTP কোডটি ব্যবহার করুন।',
    '',
    `    ${code}`,
    '',
    `এই কোডটি ${minutes} মিনিট পর্যন্ত কার্যকর থাকবে।`,
    '',
    'নিরাপত্তা নির্দেশনা',
    'এই কোডটি কারও সঙ্গে শেয়ার করবেন না। Admission Hub-এর কোনো কর্মী আপনার OTP চাইবে না।',
    '',
    'আপনি যদি এই যাচাইকরণ কোডের জন্য অনুরোধ না করে থাকেন, তাহলে এই ইমেইলটি উপেক্ষা করতে পারেন।',
    '',
    'শুভেচ্ছান্তে,',
    'Admission Hub Team',
    '',
    '--',
    'Admission Hub',
    OTP_EMAIL_TAGLINE,
    'এটি একটি স্বয়ংক্রিয় বার্তা। এই ইমেইলে উত্তর দেওয়ার প্রয়োজন নেই।'
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Admission Hub — ইমেইল যাচাইকরণ</title>
<style>
  /* Progressive enhancement only: every rule below duplicates an inline value, so
     clients that strip <style> (or the whole head) still render the light design. */
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  a { text-decoration: none; }
  @media (max-width: 620px) {
    .ah-pad { padding-left: 20px !important; padding-right: 20px !important; }
    .ah-otp { font-size: 32px !important; letter-spacing: 7px !important; }
    .ah-greeting { font-size: 24px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .ah-shell { background-color: #0b1512 !important; }
    .ah-card { background-color: #121d1a !important; border-color: #26403a !important; }
    .ah-head { background-color: #121d1a !important; border-bottom-color: #26403a !important; }
    .ah-otpcard { background-color: #0e2620 !important; border-color: #2c5a4a !important; }
    .ah-otp { color: #6fd8b4 !important; }
    .ah-secbox { background-color: #161f1c !important; border-color: #26403a !important; }
    .ah-foot { background-color: #0e1815 !important; border-top-color: #26403a !important; }
    .ah-title { color: #eaf4f0 !important; }
    .ah-body { color: #c3d3ce !important; }
    .ah-greeting { color: #ffffff !important; }
    .ah-muted { color: #93a8a2 !important; }
    .ah-faint { color: #7d918b !important; }
    .ah-rule { background-color: #26403a !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#f3f7f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f3f7f6;font-size:1px;line-height:1px;">আপনার Admission Hub যাচাইকরণ কোড: ${safeCode} — ${safeMinutes} মিনিটের জন্য কার্যকর।&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ah-shell" style="width:100%;background-color:#f3f7f6;font-family:${OTP_EMAIL_FONT};">
<tr><td align="center" class="ah-pad" style="padding:32px 12px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ah-card" style="width:100%;max-width:620px;background-color:#ffffff;border:1px solid #e2eee9;border-radius:24px;overflow:hidden;box-shadow:0 10px 35px rgba(20,70,55,0.08);">

<tr><td class="ah-head" style="padding:26px 32px 22px;background-color:#f7fbfa;border-bottom:1px solid #e5efeb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="width:46px;padding-right:12px;vertical-align:middle;">
<img src="${OTP_EMAIL_LOGO_URL}" width="46" height="46" alt="Admission Hub" style="display:block;width:46px;height:46px;border:0;border-radius:14px;outline:none;text-decoration:none;">
</td>
<td style="vertical-align:middle;">
<span class="ah-title" style="display:block;font-family:${OTP_EMAIL_FONT};font-size:22px;line-height:1.2;font-weight:700;letter-spacing:-0.3px;color:#172b3a;">Admission Hub</span>
<span class="ah-muted" style="display:block;margin-top:4px;font-family:${OTP_EMAIL_FONT};font-size:12px;line-height:1.5;color:#70817d;">${OTP_EMAIL_TAGLINE}</span>
</td>
</tr></table>
</td>
<td align="right" style="vertical-align:middle;white-space:nowrap;">
<span style="display:inline-block;padding:7px 13px;background-color:#e9faf4;border-radius:999px;font-family:${OTP_EMAIL_FONT};font-size:11.5px;line-height:1;font-weight:700;color:#078c68;">ইমেইল যাচাইকরণ</span>
</td>
</tr></table>
</td></tr>

<tr><td style="height:4px;background-color:#12a876;background-image:linear-gradient(90deg,#12a876 0%,#0b9a70 55%,#0f8a63 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

<tr><td class="ah-pad" style="padding:36px 32px 0;">
<p class="ah-greeting" style="margin:0;font-family:${OTP_EMAIL_FONT};font-size:27px;line-height:1.4;font-weight:700;color:#172b3a;">${greeting}</p>
<p class="ah-body" style="margin:12px 0 0;font-family:${OTP_EMAIL_FONT};font-size:16.5px;line-height:1.8;color:#566b72;">আপনার ইমেইল ঠিকানাটি যাচাই করতে নিচের OTP কোডটি ব্যবহার করুন।</p>
</td></tr>

<tr><td class="ah-pad" style="padding:28px 32px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ah-otpcard" style="width:100%;background-color:#f2fdf9;background-image:linear-gradient(135deg,#effcf8 0%,#f7fffc 100%);border:1px solid #c7eee1;border-radius:20px;">
<tr><td align="center" style="padding:24px 16px 26px;">
<span class="ah-muted" style="display:block;margin-bottom:14px;font-family:${OTP_EMAIL_FONT};font-size:11.5px;line-height:1;font-weight:700;letter-spacing:1.6px;color:#0a9b72;text-transform:uppercase;">যাচাইকরণ কোড</span>
<span class="ah-otp" style="display:block;font-family:'Courier New',Courier,monospace;font-size:38px;line-height:1;font-weight:800;letter-spacing:9px;text-indent:9px;color:#075f49;">${safeCode}</span>
</td></tr>
</table>
</td></tr>

<tr><td class="ah-pad" align="center" style="padding:18px 32px 0;">
<p class="ah-muted" style="margin:0;font-family:${OTP_EMAIL_FONT};font-size:14px;line-height:1.7;color:#687b7d;">এই কোডটি <strong style="color:#07966e;font-weight:700;">${safeMinutes} মিনিট</strong> পর্যন্ত কার্যকর থাকবে।</p>
</td></tr>

<tr><td class="ah-pad" style="padding:28px 32px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ah-secbox" style="width:100%;background-color:#f7faf9;border:1px solid #e3ece9;border-radius:16px;">
<tr><td style="padding:18px 20px;">
<p class="ah-body" style="margin:0;font-family:${OTP_EMAIL_FONT};font-size:13.5px;line-height:1.8;color:#53666a;"><strong style="color:#087d5d;font-weight:700;">নিরাপত্তা নির্দেশনা</strong><br>এই কোডটি কারও সঙ্গে শেয়ার করবেন না। Admission Hub-এর কোনো কর্মী আপনার OTP চাইবে না।</p>
</td></tr>
</table>
</td></tr>

<tr><td class="ah-pad" style="padding:24px 32px 0;">
<p class="ah-body" style="margin:0;font-family:${OTP_EMAIL_FONT};font-size:14px;line-height:1.8;color:#708083;">আপনি যদি এই যাচাইকরণ কোডের জন্য অনুরোধ না করে থাকেন, তাহলে এই ইমেইলটি উপেক্ষা করতে পারেন।</p>
</td></tr>

<tr><td class="ah-pad" style="padding:28px 32px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="ah-rule" style="height:1px;background-color:#e6eeeb;font-size:0;line-height:0;">&nbsp;</td></tr></table>
</td></tr>

<tr><td class="ah-pad" style="padding:24px 32px 32px;">
<p class="ah-body" style="margin:0;font-family:${OTP_EMAIL_FONT};font-size:14px;line-height:1.8;color:#708083;">শুভেচ্ছান্তে,<br><strong style="display:inline-block;margin-top:4px;font-size:17px;font-weight:700;color:#07966e;">Admission Hub Team</strong></p>
</td></tr>

<tr><td class="ah-foot" style="padding:22px 32px;background-color:#f7faf9;border-top:1px solid #e6eeeb;">
<p style="margin:0;font-family:${OTP_EMAIL_FONT};font-size:13px;line-height:1.5;font-weight:700;color:#176d59;">Admission Hub</p>
<p class="ah-muted" style="margin:5px 0 0;font-family:${OTP_EMAIL_FONT};font-size:12px;line-height:1.6;color:#81908f;">${OTP_EMAIL_TAGLINE}</p>
<p class="ah-faint" style="margin:14px 0 0;font-family:${OTP_EMAIL_FONT};font-size:11px;line-height:1.6;color:#9aa6a5;">এটি একটি স্বয়ংক্রিয় বার্তা। এই ইমেইলে উত্তর দেওয়ার প্রয়োজন নেই।</p>
<p class="ah-faint" style="margin:8px 0 0;font-family:${OTP_EMAIL_FONT};font-size:11px;line-height:1.6;color:#a2adab;">&copy; Admission Hub</p>
</td></tr>

</table>

</td></tr>
</table>
</body>
</html>`;

  return { text, html };
};

const nextUtcMidnight = now => (Math.floor(Number(now) / 86_400_000) + 1) * 86_400_000;

export class BrevoOtpVerificationProvider {
  constructor({ id = 'otp-a', apiKey, fromAddress, fromName = 'Admission Hub', declaredDailyQuota, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.apiKey = String(apiKey || '');
    this.fromAddress = validEmailAddress(fromAddress) ? String(fromAddress) : '';
    this.fromName = String(fromName || 'Admission Hub').slice(0, 64);
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.configured = Boolean(validSecret(this.apiKey) && this.fromAddress && this.declaredDailyQuota && this.fetch);
  }

  #headers(content = false) {
    return {
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      'api-key': this.apiKey,
      ...(content ? { 'Content-Type': 'application/json' } : {})
    };
  }

  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    const payload = await fetchJson(this.fetch, 'https://api.brevo.com/v3/senders', { method: 'GET', headers: this.#headers() });
    const sender = Array.isArray(payload?.senders)
      ? payload.senders.find(item => String(item?.email || '').toLowerCase() === this.fromAddress.toLowerCase())
      : null;
    const ready = sender?.active === true;
    return { available: ready, code: ready ? 'READY' : 'SENDER_NOT_VERIFIED' };
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    const payload = await fetchJson(this.fetch, 'https://api.brevo.com/v3/account', { method: 'GET', headers: this.#headers() });
    const plans = Array.isArray(payload?.plan) ? payload.plan : [];
    const sendLimit = plans.find(plan => String(plan?.creditsType || '') === 'sendLimit');
    const credits = safeInteger(sendLimit?.credits, 0, 10_000_000);
    const limit = this.declaredDailyQuota;
    return {
      remaining: Math.min(credits, limit),
      limit,
      resetAt: nextUtcMidnight(this.now()),
      source: 'brevo-account-credits'
    };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '');
    const code = String(input.code || '');
    if (!validEmailAddress(destination) || !/^\d{6}$/.test(code)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    const expiresAt = Number(input.expiresAt || 0);
    const minutes = expiresAt > 0 ? Math.max(1, Math.round((expiresAt - Number(this.now())) / 60_000)) : 5;
    const { text, html } = otpEmailBody(code, minutes, input.recipientName);
    const payload = await fetchJson(this.fetch, 'https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify({
        sender: { email: this.fromAddress, name: this.fromName },
        to: [{ email: destination }],
        subject: 'Admission Hub — আপনার যাচাইকরণ কোড',
        htmlContent: html,
        textContent: text,
        tags: ['admission-hub-transactional']
      })
    });
    if (typeof payload?.messageId !== 'string' || !payload.messageId) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return { accepted: true };
  }

  async verifyCode() { throw new VerificationProviderError('LOCAL_VERIFICATION_ONLY', VERIFICATION_FAILURE_CLASS.USER); }
  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: 'brevo' };
  }
}

export class AppsScriptOtpVerificationProvider {
  constructor({ id = 'otp-b', webAppUrl, sharedSecret, declaredDailyQuota, fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto, now = Date.now } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.webAppUrl = appsScriptWebAppUrl(webAppUrl);
    this.sharedSecret = validSecret(sharedSecret) ? String(sharedSecret) : '';
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.crypto = cryptoImpl?.subtle && typeof cryptoImpl.getRandomValues === 'function' ? cryptoImpl : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.keyPromise = null;
    this.configured = Boolean(this.webAppUrl && this.sharedSecret && this.declaredDailyQuota && this.fetch && this.crypto);
  }

  async #signature(canonical) {
    if (!this.keyPromise) {
      this.keyPromise = this.crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(this.sharedSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
    }
    const key = await this.keyPromise;
    const signature = await this.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical));
    return base64UrlBytes(signature);
  }

  // The Apps Script web app answers on a googleusercontent.com redirect, so these
  // calls must follow redirects instead of the manual default.
  async #call(action, { destination = '', code = '' } = {}) {
    const timestamp = String(Math.floor(Number(this.now()) / 1000));
    const nonceBytes = new Uint8Array(18);
    this.crypto.getRandomValues(nonceBytes);
    const nonce = base64UrlBytes(nonceBytes);
    const signature = await this.#signature([action, timestamp, nonce, destination, code].join('\n'));
    const options = { redirect: 'follow', timeoutMs: 15_000 };
    if (action === 'send') {
      return fetchJson(this.fetch, this.webAppUrl, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ action, timestamp, nonce, destination, code, signature })
      }, options);
    }
    const url = new URL(this.webAppUrl);
    url.searchParams.set('action', action);
    url.searchParams.set('timestamp', timestamp);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('signature', signature);
    return fetchJson(this.fetch, url.href, {
      method: 'GET',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store' }
    }, options);
  }

  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    const payload = await this.#call('health');
    const ready = payload?.ok === true && payload?.ready === true;
    return { available: ready, code: ready ? 'READY' : 'NOT_READY' };
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    const payload = await this.#call('quota');
    const limit = safeInteger(payload?.limit, 1, this.declaredDailyQuota) || this.declaredDailyQuota;
    const remaining = Math.min(limit, safeInteger(payload?.remaining, 0, limit));
    const resetAt = safeInteger(payload?.resetAt, 0, 9_000_000_000_000);
    if (!resetAt) throw new VerificationProviderError('INVALID_QUOTA_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    return { remaining, limit, resetAt, source: 'apps-script-mail-quota' };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '');
    const code = String(input.code || '');
    if (!validEmailAddress(destination) || !/^\d{6}$/.test(code)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    const payload = await this.#call('send', { destination, code });
    if (payload?.accepted !== true || !/^[A-Za-z0-9_-]{6,128}$/.test(String(payload?.messageRef || ''))) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return { accepted: true };
  }

  async verifyCode() { throw new VerificationProviderError('LOCAL_VERIFICATION_ONLY', VERIFICATION_FAILURE_CLASS.USER); }
  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: false, mailer: 'google-apps-script' };
  }
}

export class BridgeOtpVerificationProvider {
  constructor({ id, origin, apiKey, declaredDailyQuota, fetchImpl = globalThis.fetch } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.origin = httpsOrigin(origin);
    this.apiKey = String(apiKey || '');
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.configured = Boolean(this.origin && validSecret(this.apiKey) && this.declaredDailyQuota && this.fetch);
  }

  #headers(content = false) {
    return {
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      'X-Verification-Key': this.apiKey,
      ...(content ? { 'Content-Type': 'application/json' } : {})
    };
  }

  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    try {
      const payload = await fetchJson(this.fetch, `${this.origin}/v1/verification/health`, { method: 'GET', headers: this.#headers() });
      return { available: payload?.ok === true && payload?.ready === true, code: payload?.ready === true ? 'READY' : 'NOT_READY' };
    } catch (error) { throw error; }
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    const payload = await fetchJson(this.fetch, `${this.origin}/v1/verification/quota`, { method: 'GET', headers: this.#headers() });
    const limit = safeInteger(payload?.limit, 1, this.declaredDailyQuota) || this.declaredDailyQuota;
    const remaining = Math.min(limit, safeInteger(payload?.remaining, 0, limit));
    const resetAt = safeInteger(payload?.resetAt, 0, 9_000_000_000_000);
    if (!resetAt) throw new VerificationProviderError('INVALID_QUOTA_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    return { remaining, limit, resetAt, source: 'provider-api' };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    if (!/^\d{6}$/.test(String(input.code || '')) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.destination || ''))) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    const payload = await fetchJson(this.fetch, `${this.origin}/v1/verification/send`, {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify({
        attemptId: input.attemptId,
        destination: input.destination,
        code: input.code,
        purpose: input.purpose,
        expiresAt: input.expiresAt
      })
    });
    if (payload?.accepted !== true || !/^[A-Za-z0-9_-]{6,128}$/.test(String(payload?.messageRef || ''))) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return { accepted: true };
  }

  async verifyCode() { throw new VerificationProviderError('LOCAL_VERIFICATION_ONLY', VERIFICATION_FAILURE_CLASS.USER); }
  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured };
  }
}

export class OfficialWhatsAppVerificationProvider {
  constructor({ graphVersion, phoneNumberId, accessToken, templateName, templateLanguage = 'en_US', declaredDailyQuota, fetchImpl = globalThis.fetch } = {}) {
    this.id = 'whatsapp';
    this.channel = VERIFICATION_CHANNELS.WHATSAPP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.graphVersion = /^v\d{1,2}\.\d$/.test(String(graphVersion || '')) ? String(graphVersion) : '';
    this.phoneNumberId = /^\d{6,32}$/.test(String(phoneNumberId || '')) ? String(phoneNumberId) : '';
    this.accessToken = String(accessToken || '');
    this.templateName = /^[a-z0-9_]{3,128}$/.test(String(templateName || '')) ? String(templateName) : '';
    this.templateLanguage = /^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(String(templateLanguage || '')) ? String(templateLanguage) : '';
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.configured = Boolean(this.graphVersion && this.phoneNumberId && validSecret(this.accessToken) && this.templateName && this.templateLanguage && this.declaredDailyQuota && this.fetch);
  }

  #url(suffix = '') { return `https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}${suffix}`; }
  #headers(content = false) {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${this.accessToken}`,
      'Cache-Control': 'no-store',
      ...(content ? { 'Content-Type': 'application/json' } : {})
    };
  }

  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    const payload = await fetchJson(this.fetch, `${this.#url()}?fields=id`, { method: 'GET', headers: this.#headers() });
    return { available: String(payload?.id || '') === this.phoneNumberId, code: String(payload?.id || '') === this.phoneNumberId ? 'READY' : 'PHONE_ID_MISMATCH' };
  }

  async getRemainingQuota({ now = Date.now() } = {}) {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    const resetAt = (Math.floor(Number(now) / 86_400_000) + 1) * 86_400_000;
    return { remaining: this.declaredDailyQuota, limit: this.declaredDailyQuota, resetAt, source: 'operator-declared-cap' };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const destination = String(input.destination || '');
    const code = String(input.code || '');
    if (!/^\+[1-9]\d{7,14}$/.test(destination) || !/^\d{6}$/.test(code)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    const payload = await fetchJson(this.fetch, this.#url('/messages'), {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: destination.slice(1),
        type: 'template',
        template: {
          name: this.templateName,
          language: { code: this.templateLanguage },
          components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }]
        }
      })
    });
    if (!validSecret(String(payload?.messages?.[0]?.id || ''))) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return { accepted: true };
  }

  async verifyCode() { throw new VerificationProviderError('LOCAL_VERIFICATION_ONLY', VERIFICATION_FAILURE_CLASS.USER); }
  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true };
  }
}

export class TelegramLinkVerificationProvider {
  constructor({ botUsername, botToken, webhookSecret, webhookSecretSource, webhookUrl, declaredDailyQuota, fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto } = {}) {
    this.id = 'telegram';
    this.channel = VERIFICATION_CHANNELS.TELEGRAM;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.botUsername = validTelegramBotUsername(botUsername) ? String(botUsername) : '';
    this.botToken = validTelegramBotToken(botToken) ? String(botToken) : '';
    this.botId = this.botToken ? this.botToken.split(':', 1)[0] : '';
    this.webhookSecret = validTelegramWebhookSecret(webhookSecret) ? String(webhookSecret) : '';
    this.webhookSecretSource = validSecret(webhookSecretSource) ? String(webhookSecretSource) : '';
    this.webhookUrl = telegramWebhookEndpoint(webhookUrl);
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.crypto = cryptoImpl;
    this.resolvedBotUsername = '';
    this.configured = Boolean(
      this.botToken && (this.webhookSecret || this.webhookSecretSource)
      && this.webhookUrl && this.declaredDailyQuota && this.fetch
    );
  }

  #base(method) { return `https://api.telegram.org/bot${this.botToken}/${method}`; }
  #headers(content = false) {
    return {
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      ...(content ? { 'Content-Type': 'application/json' } : {})
    };
  }

  async #resolvedWebhookSecret() {
    if (this.webhookSecret) return this.webhookSecret;
    const derived = await deriveTelegramWebhookSecret(this.webhookSecretSource, this.crypto);
    if (!derived) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    return derived;
  }

  async #identity() {
    const identity = await fetchJson(this.fetch, this.#base('getMe'), { method: 'GET', headers: this.#headers() });
    const username = String(identity?.result?.username || '');
    const providerId = String(identity?.result?.id || '');
    const ready = identity?.ok === true
      && identity?.result?.is_bot === true
      && providerId === this.botId
      && validTelegramBotUsername(username)
      && (!this.botUsername || username.toLowerCase() === this.botUsername.toLowerCase());
    if (ready) this.resolvedBotUsername = username;
    return { ready, username };
  }

  async #webhookInfo() {
    return fetchJson(this.fetch, this.#base('getWebhookInfo'), { method: 'GET', headers: this.#headers() });
  }

  async #deleteWebhook() {
    const payload = await fetchJson(this.fetch, this.#base('deleteWebhook'), {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify({ drop_pending_updates: false })
    });
    if (payload?.ok !== true || payload?.result !== true) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
  }

  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    const [identity, webhook] = await Promise.all([this.#identity(), this.#webhookInfo()]);
    const currentUrl = String(webhook?.result?.url || '');
    const webhookReady = webhook?.ok === true && currentUrl === this.webhookUrl;
    const updates = webhook?.result?.allowed_updates;
    const updateScopeReady = !Array.isArray(updates) || (updates.length === 1 && updates[0] === 'message');
    return {
      available: identity.ready && webhookReady && updateScopeReady,
      code: !identity.ready ? 'BOT_IDENTITY_MISMATCH' : !webhookReady ? 'WEBHOOK_NOT_READY' : !updateScopeReady ? 'WEBHOOK_SCOPE_MISMATCH' : 'READY'
    };
  }

  async configureWebhook() {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const identity = await this.#identity();
    if (!identity.ready) throw new VerificationProviderError('BOT_IDENTITY_MISMATCH', VERIFICATION_FAILURE_CLASS.HARD);
    const before = await this.#webhookInfo();
    const previousUrl = String(before?.result?.url || '');
    if (previousUrl && previousUrl !== this.webhookUrl) {
      throw new VerificationProviderError('WEBHOOK_CONFLICT', VERIFICATION_FAILURE_CLASS.HARD);
    }
    const changed = !previousUrl;
    try {
      const secret = await this.#resolvedWebhookSecret();
      const configured = await fetchJson(this.fetch, this.#base('setWebhook'), {
        method: 'POST',
        headers: this.#headers(true),
        body: JSON.stringify({
          url: this.webhookUrl,
          secret_token: secret,
          allowed_updates: ['message'],
          drop_pending_updates: false
        })
      });
      if (configured?.ok !== true || configured?.result !== true) {
        throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
      }
      const after = await this.#webhookInfo();
      const scope = after?.result?.allowed_updates;
      const webhookReady = after?.ok === true
        && String(after?.result?.url || '') === this.webhookUrl
        && (!Array.isArray(scope) || (scope.length === 1 && scope[0] === 'message'));
      if (!webhookReady) throw new VerificationProviderError('WEBHOOK_NOT_READY', VERIFICATION_FAILURE_CLASS.HARD);
      const probe = await fetchJson(this.fetch, this.webhookUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': secret
        },
        body: JSON.stringify({ update_id: 0 })
      });
      if (probe?.ok !== true) throw new VerificationProviderError('WEBHOOK_ENDPOINT_REJECTED', VERIFICATION_FAILURE_CLASS.HARD);
      return Object.freeze({ ready: true, identityReady: true, webhookReady: true, endpointAccepted: true, webhookChanged: changed });
    } catch (cause) {
      if (changed) await this.#deleteWebhook().catch(() => {});
      throw cause;
    }
  }

  async removeConfiguredWebhook() {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const current = await this.#webhookInfo();
    if (String(current?.result?.url || '') !== this.webhookUrl) return Object.freeze({ removed: false });
    await this.#deleteWebhook();
    return Object.freeze({ removed: true });
  }

  async getRemainingQuota({ now = Date.now() } = {}) {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    return {
      remaining: this.declaredDailyQuota,
      limit: this.declaredDailyQuota,
      resetAt: (Math.floor(Number(now) / 86_400_000) + 1) * 86_400_000,
      source: 'internal-safety-cap'
    };
  }

  async sendVerification(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    if (!/^[A-Za-z0-9_-]{32,64}$/.test(String(input.linkToken || ''))) {
      throw new VerificationProviderError('INVALID_LINK_TOKEN', VERIFICATION_FAILURE_CLASS.HARD);
    }
    if (!this.resolvedBotUsername) {
      const identity = await this.#identity();
      if (!identity.ready) throw new VerificationProviderError('BOT_IDENTITY_MISMATCH', VERIFICATION_FAILURE_CLASS.HARD);
    }
    const link = new URL(`https://t.me/${this.resolvedBotUsername}`);
    link.searchParams.set('start', input.linkToken);
    return { accepted: true, interaction: { type: 'telegram-link', url: link.href } };
  }

  async sendTelegramCode(input = {}) {
    if (!this.configured) throw new VerificationProviderError('NOT_CONFIGURED', VERIFICATION_FAILURE_CLASS.HARD);
    const chatId = String(input.chatId || '');
    const code = String(input.code || '');
    if (!/^[1-9]\d{0,19}$/.test(chatId) || !/^\d{6}$/.test(code)) {
      throw new VerificationProviderError('INVALID_DESTINATION', VERIFICATION_FAILURE_CLASS.USER);
    }
    const minutes = Math.max(1, Math.min(10, Math.ceil(safeInteger(input.expiresInSeconds, 60, 600) / 60)));
    const text = [
      '🔐 Admission Hub Verification',
      'আপনার verification code:',
      code,
      'এই code-টি Admission Hub app-এর verification box-এ দিন।',
      `⏱️ Code-এর মেয়াদ ${minutes} মিনিট।`,
      'কাউকে এই code বা আপনার password দেবেন না।'
    ].join('\n');
    const payload = await fetchJson(this.fetch, this.#base('sendMessage'), {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify({
        chat_id: chatId,
        text,
        protect_content: true,
        disable_web_page_preview: true
      })
    });
    if (payload?.ok !== true || !Number.isSafeInteger(Number(payload?.result?.message_id))) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return { accepted: true };
  }

  async verifyCode() {
    throw new VerificationProviderError('LOCAL_VERIFICATION_ONLY', VERIFICATION_FAILURE_CLASS.USER);
  }

  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, identityKind: 'telegram-account', phoneOwnership: false };
  }
}

export function createConfiguredVerificationProviders(env = {}, { fetchImpl = globalThis.fetch } = {}) {
  // Slot `otp-a` prefers the direct Brevo API and falls back to the external OTP
  // bridge when Brevo is not bound. Slot `otp-b` prefers the free Google Apps
  // Script mailer and otherwise falls back to a bridge. The orchestrator still
  // sees two ordinary OTP providers and rotates on declared quota.
  const brevoOtpA = new BrevoOtpVerificationProvider({
    id: 'otp-a',
    apiKey: env.BREVO_API_KEY,
    fromAddress: env.BREVO_FROM_ADDRESS,
    fromName: env.BREVO_FROM_NAME,
    declaredDailyQuota: env.OTP_A_DAILY_QUOTA,
    fetchImpl
  });
  const bridgeOtpA = new BridgeOtpVerificationProvider({ id: 'otp-a', origin: env.OTP_A_PROVIDER_ORIGIN, apiKey: env.OTP_A_PROVIDER_KEY, declaredDailyQuota: env.OTP_A_DAILY_QUOTA, fetchImpl });
  const appsScriptOtpB = new AppsScriptOtpVerificationProvider({
    id: 'otp-b',
    webAppUrl: env.OTP_B_PROVIDER_APPS_SCRIPT_URL,
    sharedSecret: env.OTP_B_PROVIDER_SHARED_SECRET,
    declaredDailyQuota: env.OTP_B_DAILY_QUOTA,
    fetchImpl
  });
  const bridgeOtpB = new BridgeOtpVerificationProvider({ id: 'otp-b', origin: env.OTP_B_PROVIDER_ORIGIN, apiKey: env.OTP_B_PROVIDER_KEY, declaredDailyQuota: env.OTP_B_DAILY_QUOTA, fetchImpl });
  return [
    brevoOtpA.configured ? brevoOtpA : bridgeOtpA,
    appsScriptOtpB.configured ? appsScriptOtpB : bridgeOtpB,
    new BridgeOtpVerificationProvider({ id: 'otp-c', origin: env.OTP_C_PROVIDER_ORIGIN, apiKey: env.OTP_C_PROVIDER_KEY, declaredDailyQuota: env.OTP_C_DAILY_QUOTA, fetchImpl }),
    new OfficialWhatsAppVerificationProvider({
      graphVersion: env.WHATSAPP_GRAPH_VERSION,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      templateName: env.WHATSAPP_TEMPLATE_NAME,
      templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE,
      declaredDailyQuota: env.WHATSAPP_DAILY_QUOTA,
      fetchImpl
    }),
    new TelegramLinkVerificationProvider({
      botUsername: env.TELEGRAM_AUTH_BOT_USERNAME,
      botToken: env.TELEGRAM_AUTH_BOT_TOKEN || env.TG_BOT_TOKEN,
      webhookSecret: env.TELEGRAM_AUTH_WEBHOOK_SECRET,
      webhookSecretSource: env.AUTH_HMAC_SECRET,
      webhookUrl: env.TELEGRAM_AUTH_WEBHOOK_URL,
      declaredDailyQuota: env.TELEGRAM_AUTH_DAILY_QUOTA,
      fetchImpl
    })
  ];
}

export const __verificationProvidersTest = Object.freeze({ httpsOrigin, boundedJson, httpFailure, appsScriptWebAppUrl, otpEmailBody });
