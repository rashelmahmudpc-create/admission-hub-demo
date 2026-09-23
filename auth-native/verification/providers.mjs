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

// Mailjet runs EU and US hosts; a US account only authenticates against the US host,
// so the base is validated rather than guessed.
const MAILJET_API_BASES = new Set(['https://api.mailjet.com', 'https://api.us.mailjet.com']);

const base64UrlBytes = bytes => {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// Standard base64 with padding intact — Basic auth needs the '=' characters that
// base64UrlBytes deliberately strips, so the two transforms stay separate.
const base64Bytes = value => btoa(String(value));

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

// Lock glyph inlined as an SVG data URI. An <img> data URI renders in Gmail,
// Apple Mail, and Outlook; a character icon would depend on a font the client
// does not ship. Declared here because it needs to stay on one encoded line.
const OTP_EMAIL_LOCK_SVG = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM2YjdiNzciIHN0cm9rZS13aWR0aD0iMS44IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHg9IjQuNSIgeT0iMTAuNCIgd2lkdGg9IjE1IiBoZWlnaHQ9IjkuNiIgcng9IjIuMiIvPjxwYXRoIGQ9Ik04IDEwLjRWNy44YTQgNCAwIDAgMSA4IDB2Mi42Ii8+PHBhdGggZD0iTTEyIDE0LjN2Mi40Ii8+PC9zdmc+';

const OTP_EMAIL_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const OTP_EMAIL_MONO = "'SF Mono','Roboto Mono','DejaVu Sans Mono',Menlo,Consolas,'Courier New',monospace";
const OTP_EMAIL_BRAND = '#12a876';
const OTP_EMAIL_INK = '#101c19';
const OTP_EMAIL_MUTED = '#6b7b77';

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
  /* Fluid on every screen: the shell fills whatever width the client gives it and
     the card centres itself, so mobile Gmail does not frame it as a narrow box. */
  .ah-shell { width: 100% !important; }
  .ah-card { width: 100% !important; max-width: 600px !important; margin: 0 auto !important; }
  @media (max-width: 620px) {
    .ah-pad { padding-left: 20px !important; padding-right: 20px !important; }
    .ah-otp { font-size: 30px !important; letter-spacing: 4px !important; text-indent: 4px !important; }
  }
  /* Gmail mobile dark mode paints its own chrome around the message. If the body
     and the shell keep their light colour while the card turns dark, the card
     reads as a floating box. All three surfaces therefore move together, and the
     card drops its border and shadow so nothing outlines it. */
  @media (prefers-color-scheme: dark) {
    .ah-body { background-color: #1f1f1f !important; }
    .ah-shell { background-color: #1f1f1f !important; }
    .ah-card { background-color: #1f1f1f !important; border-color: #1f1f1f !important; box-shadow: none !important; }
    .ah-divider { background-color: #3a3a3a !important; }
    .ah-otp { color: #7ad9b8 !important; }
    .ah-foot { border-top-color: #3a3a3a !important; }
    .ah-heading { color: #f4f8f7 !important; }
    .ah-body-text { color: #c8d2cf !important; }
    .ah-muted { color: #a4b0ad !important; }
    .ah-faint { color: #8d9995 !important; }
    .ah-foot-title { color: #dfe8e5 !important; }
  }
</style>
</head>
<body class="ah-body" style="margin:0;padding:0;width:100%;background-color:#ffffff;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#ffffff;font-size:1px;line-height:1px;">আপনার Admission Hub যাচাইকরণ কোড: ${safeCode} — ${safeMinutes} মিনিটের জন্য কার্যকর।&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ah-shell" bgcolor="#ffffff" style="width:100%;background-color:#ffffff;font-family:${OTP_EMAIL_FONT};">
<tr><td align="center" class="ah-pad" style="padding:28px 12px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ah-card" bgcolor="#ffffff" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:16px;overflow:hidden;">

<tr><td class="ah-head" bgcolor="#0f8f68" style="padding:22px 28px;background-color:#0f8f68;background-image:linear-gradient(135deg,#12a876 0%,#0f8f68 58%,#0d7f5e 100%);">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="width:38px;padding-right:12px;vertical-align:middle;">
<img src="${OTP_EMAIL_LOGO_URL}" width="38" height="38" alt="Admission Hub" style="display:block;width:38px;height:38px;border:0;border-radius:10px;outline:none;text-decoration:none;">
</td>
<td style="vertical-align:middle;">
<span style="display:block;font-family:${OTP_EMAIL_FONT};font-size:16px;line-height:1.3;font-weight:600;letter-spacing:-0.2px;color:#ffffff;">Admission Hub</span>
<span style="display:block;margin-top:2px;font-family:${OTP_EMAIL_FONT};font-size:12px;line-height:1.4;font-weight:400;color:#d8f2e8;">ইমেইল যাচাইকরণ</span>
</td>
</tr></table>
</td>
</tr></table>
</td></tr>

<tr><td class="ah-pad" style="padding:34px 28px 0;">
<p class="ah-heading" style="margin:0;font-family:${OTP_EMAIL_FONT};font-size:20px;line-height:1.45;font-weight:600;letter-spacing:-0.2px;color:${OTP_EMAIL_INK};">${greeting}</p>
<p class="ah-body-text" style="margin:10px 0 0;font-family:${OTP_EMAIL_FONT};font-size:15px;line-height:1.7;font-weight:400;color:#48534f;">আপনার ইমেইল ঠিকানাটি যাচাই করতে নিচের কোডটি ব্যবহার করুন।</p>
</td></tr>

<tr><td class="ah-pad" align="center" style="padding:30px 28px 0;">
<p class="ah-label" style="margin:0 0 14px;font-family:${OTP_EMAIL_FONT};font-size:11px;line-height:1;font-weight:600;letter-spacing:1px;color:${OTP_EMAIL_MUTED};text-transform:uppercase;">যাচাইকরণ কোড</p>
<p class="ah-otp" style="margin:0;font-family:${OTP_EMAIL_MONO};font-size:40px;line-height:1.1;font-weight:700;letter-spacing:6px;text-indent:6px;color:${OTP_EMAIL_INK};">${safeCode}</p>
<p class="ah-muted" style="margin:16px 0 0;font-family:${OTP_EMAIL_FONT};font-size:13px;line-height:1.6;font-weight:400;color:${OTP_EMAIL_MUTED};">এই কোডটি ${safeMinutes} মিনিট পর্যন্ত কার্যকর থাকবে।</p>
</td></tr>

<tr><td class="ah-pad" style="padding:30px 28px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="ah-divider" style="height:1px;background-color:#eaecec;font-size:0;line-height:0;">&nbsp;</td></tr></table>
</td></tr>

<tr><td class="ah-pad" style="padding:24px 28px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
<td width="26" valign="top" style="width:26px;padding:2px 0 0;">
<img src="${OTP_EMAIL_LOCK_SVG}" width="16" height="16" alt="" style="display:block;width:16px;height:16px;border:0;outline:none;text-decoration:none;">
</td>
<td valign="top">
<p class="ah-muted" style="margin:0;font-family:${OTP_EMAIL_FONT};font-size:12.5px;line-height:1.65;font-weight:400;color:${OTP_EMAIL_MUTED};">এই কোডটি কারও সঙ্গে শেয়ার করবেন না। Admission Hub-এর কোনো কর্মী আপনার OTP চাইবে না।</p>
</td>
</tr></table>
</td></tr>

<tr><td class="ah-pad" style="padding:16px 28px 0;">
<p class="ah-muted" style="margin:0;font-family:${OTP_EMAIL_FONT};font-size:12.5px;line-height:1.65;font-weight:400;color:${OTP_EMAIL_MUTED};">আপনি যদি এই যাচাইকরণ কোডের জন্য অনুরোধ না করে থাকেন, তাহলে এই ইমেইলটি উপেক্ষা করতে পারেন।</p>
</td></tr>

<tr><td class="ah-pad" style="padding:28px 28px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="ah-divider" style="height:1px;background-color:#eaecec;font-size:0;line-height:0;">&nbsp;</td></tr></table>
</td></tr>

<tr><td class="ah-pad" style="padding:20px 28px 30px;">
<p class="ah-muted" style="margin:0;font-family:${OTP_EMAIL_FONT};font-size:12.5px;line-height:1.65;font-weight:400;color:${OTP_EMAIL_MUTED};">শুভেচ্ছান্তে,<br><strong style="display:inline-block;margin-top:3px;font-size:13.5px;font-weight:600;color:${OTP_EMAIL_INK};">Admission Hub Team</strong></p>
</td></tr>

<tr><td class="ah-foot" style="padding:18px 28px 26px;border-top:1px solid #eff2f1;">
<p class="ah-foot-title" style="margin:0;font-family:${OTP_EMAIL_FONT};font-size:12px;line-height:1.5;font-weight:600;color:#3f4a47;">Admission Hub</p>
<p class="ah-muted" style="margin:3px 0 0;font-family:${OTP_EMAIL_FONT};font-size:11px;line-height:1.5;font-weight:400;color:#8b9491;">${OTP_EMAIL_TAGLINE}</p>
<p class="ah-faint" style="margin:12px 0 0;font-family:${OTP_EMAIL_FONT};font-size:11px;line-height:1.6;font-weight:400;color:#9aa3a0;">এটি একটি স্বয়ংক্রিয় বার্তা। এই ইমেইলে উত্তর দেওয়ার প্রয়োজন নেই।</p>
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

export class ResendOtpVerificationProvider {
  constructor({ id = 'otp-d', apiKey, fromAddress, fromName = 'Admission Hub', declaredDailyQuota, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
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
      Authorization: `Bearer ${this.apiKey}`,
      ...(content ? { 'Content-Type': 'application/json' } : {})
    };
  }

  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    const senderDomain = this.fromAddress.split('@').pop()?.toLowerCase();
    const payload = await fetchJson(this.fetch, 'https://api.resend.com/domains', { method: 'GET', headers: this.#headers() });
    const domains = Array.isArray(payload?.data) ? payload.data : [];
    const ready = domains.some(domain =>
      String(domain?.name || '').toLowerCase() === senderDomain
      && domain.status === 'verified'
      && domain.capabilities?.sending !== 'disabled');
    return { available: ready, code: ready ? 'READY' : 'SENDER_NOT_VERIFIED' };
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    const limit = this.declaredDailyQuota;
    return { remaining: limit, limit, resetAt: nextUtcMidnight(this.now()), source: 'resend-declared-daily-quota' };
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
    const payload = await fetchJson(this.fetch, 'https://api.resend.com/emails', {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify({
        from: `${this.fromName} <${this.fromAddress}>`,
        to: [destination],
        subject: 'Admission Hub — আপনার যাচাইকরণ কোড',
        html,
        text
      })
    });
    if (typeof payload?.id !== 'string' || !payload.id) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return { accepted: true };
  }

  async verifyCode() { throw new VerificationProviderError('LOCAL_VERIFICATION_ONLY', VERIFICATION_FAILURE_CLASS.USER); }
  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: 'resend' };
  }
}

export class AgentMailOtpVerificationProvider {
  constructor({ id = 'otp-e', apiKey, inboxId, declaredDailyQuota, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.apiKey = String(apiKey || '');
    this.inboxId = validEmailAddress(inboxId) ? String(inboxId) : '';
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.configured = Boolean(validSecret(this.apiKey) && this.inboxId && this.declaredDailyQuota && this.fetch);
  }

  // AgentMail signs the sender with the inbox the message is sent from, so there is
  // no separate from-address to verify. A read of the inbox is the cheapest proof
  // that the key is live and scoped to an inbox this worker may send from.
  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    const payload = await fetchJson(this.fetch, `https://api.agentmail.to/inboxes/${encodeURIComponent(this.inboxId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store', Authorization: `Bearer ${this.apiKey}` }
    });
    const ready = String(payload?.inbox_id || payload?.inboxId || '') === this.inboxId;
    return { available: ready, code: ready ? 'READY' : 'INBOX_NOT_AVAILABLE' };
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    const limit = this.declaredDailyQuota;
    return { remaining: limit, limit, resetAt: nextUtcMidnight(this.now()), source: 'agentmail-declared-daily-quota' };
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
    const payload = await fetchJson(this.fetch, `https://api.agentmail.to/inboxes/${encodeURIComponent(this.inboxId)}/messages/send`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        to: destination,
        subject: 'Admission Hub — আপনার যাচাইকরণ কোড',
        html,
        text
      })
    });
    const reference = payload?.message_id || payload?.messageId || payload?.id;
    if (typeof reference !== 'string' || !reference) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return { accepted: true };
  }

  async verifyCode() { throw new VerificationProviderError('LOCAL_VERIFICATION_ONLY', VERIFICATION_FAILURE_CLASS.USER); }
  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: 'agentmail' };
  }
}

export class MailjetOtpVerificationProvider {
  constructor({ id = 'mailjet', apiKey, secretKey, apiBase = 'https://api.mailjet.com', fromAddress, fromName = 'Admission Hub', declaredDailyQuota, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.id = String(id || '');
    this.channel = VERIFICATION_CHANNELS.OTP;
    this.verificationMode = VERIFICATION_MODES.LOCAL_CODE;
    this.apiKey = String(apiKey || '');
    this.secretKey = String(secretKey || '');
    // An unrecognized base is not silently rewritten: a US account sent to the EU
    // host authenticates against the wrong region, so fail closed instead.
    this.apiBase = MAILJET_API_BASES.has(String(apiBase || '').trim()) ? String(apiBase).trim() : '';
    this.fromAddress = validEmailAddress(fromAddress) ? String(fromAddress) : '';
    this.fromName = String(fromName || 'Admission Hub').slice(0, 64);
    this.declaredDailyQuota = safeInteger(declaredDailyQuota, 1, 10_000_000);
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.configured = Boolean(validSecret(this.apiKey) && validSecret(this.secretKey) && this.apiBase && this.fromAddress && this.declaredDailyQuota && this.fetch);
  }

  #headers(content = false) {
    return {
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      Authorization: `Basic ${base64Bytes(`${this.apiKey}:${this.secretKey}`)}`,
      ...(content ? { 'Content-Type': 'application/json' } : {})
    };
  }

  // A sender registered under a Mailjet subaccount is absent from /sender and only
  // listed by /metasender, so both endpoints are probed. Probing one would report a
  // working sender as SENDER_NOT_VERIFIED and silently drop the slot.
  async checkAvailability() {
    if (!this.configured) return { available: false, code: 'NOT_CONFIGURED' };
    const senderCheck = this.#probeSender();
    const metaCheck = this.#probeMetaSender();
    const results = await Promise.allSettled([senderCheck, metaCheck]);
    const verified = results.find(result => result.status === 'fulfilled' && result.value === true);
    if (verified) return { available: true, code: 'READY' };
    // A rejected probe is an outage, not a missing sender: only a clean false from
    // both endpoints proves the address is unconfirmed.
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    return { available: false, code: 'SENDER_NOT_VERIFIED' };
  }

  async #probeSender() {
    const payload = await fetchJson(this.fetch, `${this.apiBase}/v3/REST/sender?SenderEmail=${encodeURIComponent(this.fromAddress)}`, { method: 'GET', headers: this.#headers() });
    const rows = Array.isArray(payload?.Data) ? payload.Data : [];
    const sender = rows.find(item => String(item?.Email || item?.SenderEmail || '').toLowerCase() === this.fromAddress.toLowerCase());
    return Boolean(sender && ['active', 'validated'].includes(String(sender?.Status || '').toLowerCase()));
  }

  async #probeMetaSender() {
    const payload = await fetchJson(this.fetch, `${this.apiBase}/v3/REST/metasender?Limit=100`, { method: 'GET', headers: this.#headers() });
    const rows = Array.isArray(payload?.Data) ? payload.Data : [];
    const sender = rows.find(item => String(item?.Email || '').toLowerCase() === this.fromAddress.toLowerCase());
    return Boolean(sender && (sender?.IsEnabled === true || sender?.IsEnabled === 1 || String(sender?.IsEnabled || '').toLowerCase() === 'true'));
  }

  async getRemainingQuota() {
    if (!this.configured) return { remaining: 0, limit: 0, resetAt: 0, source: 'not-configured' };
    const limit = this.declaredDailyQuota;
    return { remaining: limit, limit, resetAt: nextUtcMidnight(this.now()), source: 'mailjet-declared-daily-quota' };
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
    const payload = await fetchJson(this.fetch, `${this.apiBase}/v3.1/send`, {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify({
        Messages: [{
          From: { Email: this.fromAddress, Name: this.fromName },
          To: [{ Email: destination }],
          Subject: 'Admission Hub — আপনার যাচাইকরণ কোড',
          HTMLPart: html,
          TextPart: text,
          CustomID: 'admission-hub-transactional'
        }]
      })
    });
    const messageRef = payload?.Messages?.[0]?.To?.[0]?.MessageUUID;
    if (typeof messageRef !== 'string' || !messageRef) {
      throw new VerificationProviderError('INVALID_PROVIDER_RESPONSE', VERIFICATION_FAILURE_CLASS.HARD);
    }
    return { accepted: true };
  }

  async verifyCode() { throw new VerificationProviderError('LOCAL_VERIFICATION_ONLY', VERIFICATION_FAILURE_CLASS.USER); }
  async getProviderStatus() {
    return { status: this.configured ? 'configured' : 'disabled', configured: this.configured, officialApi: true, mailer: 'mailjet' };
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
  const mailjetOtpC = new MailjetOtpVerificationProvider({
    id: 'otp-c',
    apiKey: env.MAILJET_API_KEY,
    secretKey: env.MAILJET_SECRET_KEY,
    apiBase: env.MAILJET_API_BASE,
    fromAddress: env.MAILJET_FROM_ADDRESS,
    fromName: env.MAILJET_FROM_NAME,
    declaredDailyQuota: env.OTP_C_DAILY_QUOTA,
    fetchImpl
  });
  const bridgeOtpC = new BridgeOtpVerificationProvider({ id: 'otp-c', origin: env.OTP_C_PROVIDER_ORIGIN, apiKey: env.OTP_C_PROVIDER_KEY, declaredDailyQuota: env.OTP_C_DAILY_QUOTA, fetchImpl });
  // Slot `otp-d` is Resend. It sits behind the three mailers the owner already
  // trusted, so a failing Resend account can never starve the earlier slots.
  const resendOtpD = new ResendOtpVerificationProvider({
    id: 'otp-d',
    apiKey: env.RESEND_API_KEY,
    fromAddress: env.RESEND_FROM_ADDRESS,
    fromName: env.RESEND_FROM_NAME,
    declaredDailyQuota: env.OTP_D_DAILY_QUOTA,
    fetchImpl
  });
  const bridgeOtpD = new BridgeOtpVerificationProvider({ id: 'otp-d', origin: env.OTP_D_PROVIDER_ORIGIN, apiKey: env.OTP_D_PROVIDER_KEY, declaredDailyQuota: env.OTP_D_DAILY_QUOTA, fetchImpl });
  // Slot `otp-e` is AgentMail. It needs no verified domain and no from-address —
  // the inbox it sends from is the sender — so it is the only slot that can carry
  // real recipients without the owner buying a domain.
  const agentMailOtpE = new AgentMailOtpVerificationProvider({
    id: 'otp-e',
    apiKey: env.AGENTMAIL_API_KEY,
    inboxId: env.AGENTMAIL_INBOX_ID,
    declaredDailyQuota: env.OTP_E_DAILY_QUOTA,
    fetchImpl
  });
  const bridgeOtpE = new BridgeOtpVerificationProvider({ id: 'otp-e', origin: env.OTP_E_PROVIDER_ORIGIN, apiKey: env.OTP_E_PROVIDER_KEY, declaredDailyQuota: env.OTP_E_DAILY_QUOTA, fetchImpl });
  return [
    brevoOtpA.configured ? brevoOtpA : bridgeOtpA,
    appsScriptOtpB.configured ? appsScriptOtpB : bridgeOtpB,
    mailjetOtpC.configured ? mailjetOtpC : bridgeOtpC,
    resendOtpD.configured ? resendOtpD : bridgeOtpD,
    agentMailOtpE.configured ? agentMailOtpE : bridgeOtpE,
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
