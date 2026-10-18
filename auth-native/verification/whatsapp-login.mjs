// "Continue with WhatsApp" login (owner request 2026-10-18).
//
// Free-tier design: the STUDENT sends the first message, so every message in
// this flow is a free "service" message on the WhatsApp Cloud API (no paid
// authentication template is ever sent).
//
//   1. POST /whatsapp/start returns a wa.me link with a pre-filled, signed,
//      15-minute start code (stateless, HMAC with AUTH_HMAC_SECRET).
//   2. The student presses Send. Meta calls POST /whatsapp/webhook with an
//      X-Hub-Signature-256 header (HMAC of the raw body with the App Secret).
//   3. For a valid start code the Worker replies, in the same private chat,
//      with a 10-minute signed login link  <origin>/?waLogin=<token>.
//   4. The app posts that token to POST /whatsapp/login, which maps the phone
//      number to ONE stable Firebase email/password account (same model as
//      telegram-login.mjs). The phone number itself is never written into the
//      Firebase email: only an HMAC reference plus a self-check tag is.
//
// The login link only ever lands in the chat of the phone that sent the code,
// so a third party who starts the flow cannot receive somebody else's link.
import { constantTimeEqual } from '../core/crypto.mjs';

export const WHATSAPP_LOGIN_DOMAIN = 'whatsapp.admissionsky.pages.dev';
export const WHATSAPP_LOGIN_QUERY_KEY = 'waLogin';
export const WHATSAPP_START_TTL_SECONDS = 15 * 60;
export const WHATSAPP_LINK_TTL_SECONDS = 10 * 60;
const DEFAULT_ORIGIN = 'https://admissionhub.pages.dev';
const DEFAULT_GRAPH_VERSION = 'v21.0';
const LOGIN_EMAIL_PATTERN = /^wa\.([0-9a-f]{24})\.([0-9a-f]{16})@whatsapp\.admissionsky\.pages\.dev$/;
const START_CODE_PATTERN = /\bAH-([0-9a-z]{6,10})-([0-9a-f]{16})\b/i;
const TOKEN_PATTERN = /^([A-Za-z0-9_-]{16,600})\.([0-9a-f]{32})$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
const hmacHex = async (keyText, text, cryptoImpl = globalThis.crypto) => {
  const key = await cryptoImpl.subtle.importKey('raw', encoder.encode(keyText), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await cryptoImpl.subtle.sign('HMAC', key, encoder.encode(text)));
};
const rootSecret = env => {
  const value = String(env?.AUTH_HMAC_SECRET || '');
  return value.length >= 32 && value.length <= 4096 ? value : '';
};
const digits = (value, min, max) => {
  const text = String(value ?? '').trim().replace(/^\+/, '');
  return text.length >= min && text.length <= max && /^\d+$/.test(text) ? text : '';
};
const bounded = (value, min, max) => {
  const text = String(value ?? '').trim();
  return text.length >= min && text.length <= max ? text : '';
};
const cleanName = value => String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
const nowSeconds = now => Math.floor(Number(now) / 1000);
const toBase64Url = text => {
  let binary = '';
  for (const byte of encoder.encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = value => {
  let raw = String(value).replace(/-/g, '+').replace(/_/g, '/');
  while (raw.length % 4) raw += '=';
  return decoder.decode(Uint8Array.from(atob(raw), c => c.charCodeAt(0)));
};

export class WhatsAppLoginError extends Error {
  constructor(reason) { super(reason); this.name = 'WhatsAppLoginError'; this.reason = reason; }
}

export const whatsappLoginSettings = env => {
  const graphVersion = String(env?.WHATSAPP_GRAPH_VERSION || DEFAULT_GRAPH_VERSION).trim();
  const origin = String(env?.WHATSAPP_LOGIN_RETURN_ORIGIN || DEFAULT_ORIGIN).trim().replace(/\/+$/, '');
  return Object.freeze({
    number: digits(env?.WHATSAPP_LOGIN_NUMBER, 8, 15),
    phoneNumberId: digits(env?.WHATSAPP_PHONE_NUMBER_ID, 6, 32),
    accessToken: bounded(env?.WHATSAPP_ACCESS_TOKEN, 20, 2048),
    appSecret: bounded(env?.WHATSAPP_APP_SECRET, 16, 256),
    verifyToken: bounded(env?.WHATSAPP_VERIFY_TOKEN, 16, 256),
    graphVersion: /^v\d{1,2}\.\d$/.test(graphVersion) ? graphVersion : DEFAULT_GRAPH_VERSION,
    origin: /^https:\/\/[a-z0-9.-]+(:\d{2,5})?$/i.test(origin) ? origin : DEFAULT_ORIGIN
  });
};

// Off until EVERY secret is present, so merging this code changes nothing live.
export const whatsappLoginReady = env => {
  const s = whatsappLoginSettings(env);
  return Boolean(s.number && s.phoneNumberId && s.accessToken && s.appSecret && s.verifyToken && rootSecret(env)
    && String(env?.WHATSAPP_LOGIN_ACTIVATION || 'enabled') !== 'disabled');
};

export const reservedWhatsAppLoginEmail = email => String(email || '').trim().toLowerCase().endsWith(`@${WHATSAPP_LOGIN_DOMAIN}`);

const sign = (env, purpose, text, cryptoImpl) => hmacHex(rootSecret(env), `admission-hub-whatsapp-${purpose}-v1:${text}`, cryptoImpl);

export async function createWhatsAppStart(env, { now = Date.now(), cryptoImpl = globalThis.crypto } = {}) {
  if (!whatsappLoginReady(env)) throw new WhatsAppLoginError('WHATSAPP_LOGIN_UNAVAILABLE');
  const expires = (nowSeconds(now) + WHATSAPP_START_TTL_SECONDS).toString(36);
  const tag = (await sign(env, 'start', expires, cryptoImpl)).slice(0, 16);
  const code = `AH-${expires}-${tag}`;
  const text = `Admission Hub লগইন কোড: ${code}\n(শুধু Send চাপুন — লগইন লিংক এই চ্যাটেই চলে আসবে)`;
  return Object.freeze({ code, text, url: `https://wa.me/${whatsappLoginSettings(env).number}?text=${encodeURIComponent(text)}` });
}

export async function readWhatsAppStartCode(text, env, { now = Date.now(), cryptoImpl = globalThis.crypto } = {}) {
  const match = START_CODE_PATTERN.exec(String(text || '').slice(0, 1024));
  if (!match || !rootSecret(env)) return false;
  const expires = match[1].toLowerCase();
  const expected = (await sign(env, 'start', expires, cryptoImpl)).slice(0, 16);
  if (!constantTimeEqual(expected, match[2].toLowerCase())) return false;
  const exp = parseInt(expires, 36);
  const current = nowSeconds(now);
  return Number.isFinite(exp) && exp >= current && exp <= current + WHATSAPP_START_TTL_SECONDS + 60;
}

export async function issueWhatsAppLoginToken(phone, env, { name = '', now = Date.now(), cryptoImpl = globalThis.crypto } = {}) {
  const p = digits(phone, 8, 15);
  if (!p || !rootSecret(env)) throw new WhatsAppLoginError('WHATSAPP_LOGIN_UNAVAILABLE');
  const nonce = hex(cryptoImpl.getRandomValues(new Uint8Array(8)));
  const body = toBase64Url(JSON.stringify({ p, n: cleanName(name), e: nowSeconds(now) + WHATSAPP_LINK_TTL_SECONDS, r: nonce }));
  const tag = (await sign(env, 'link', body, cryptoImpl)).slice(0, 32);
  return `${body}.${tag}`;
}

export async function verifyWhatsAppLoginToken(token, env, { now = Date.now(), cryptoImpl = globalThis.crypto } = {}) {
  if (!rootSecret(env)) throw new WhatsAppLoginError('WHATSAPP_LOGIN_UNAVAILABLE');
  const match = TOKEN_PATTERN.exec(String(token || ''));
  if (!match) throw new WhatsAppLoginError('WHATSAPP_LOGIN_INVALID');
  const expected = (await sign(env, 'link', match[1], cryptoImpl)).slice(0, 32);
  if (!constantTimeEqual(expected, match[2])) throw new WhatsAppLoginError('WHATSAPP_LOGIN_INVALID');
  let data;
  try { data = JSON.parse(fromBase64Url(match[1])); } catch { throw new WhatsAppLoginError('WHATSAPP_LOGIN_INVALID'); }
  const p = digits(data?.p, 8, 15);
  const current = nowSeconds(now);
  if (!p || !Number.isFinite(data?.e)) throw new WhatsAppLoginError('WHATSAPP_LOGIN_INVALID');
  if (data.e < current) throw new WhatsAppLoginError('WHATSAPP_LOGIN_EXPIRED');
  if (data.e > current + WHATSAPP_LINK_TTL_SECONDS + 60) throw new WhatsAppLoginError('WHATSAPP_LOGIN_INVALID');
  return Object.freeze({ phone: p, displayName: cleanName(data.n) });
}

export async function whatsappLoginCredentials(phone, env, cryptoImpl = globalThis.crypto) {
  const root = rootSecret(env);
  const p = digits(phone, 8, 15);
  if (!root || !p) throw new WhatsAppLoginError('WHATSAPP_LOGIN_UNAVAILABLE');
  const ref = (await hmacHex(root, `admission-hub-whatsapp-login-ref-v1:${p}`, cryptoImpl)).slice(0, 24);
  const [check, password] = await Promise.all([
    hmacHex(root, `admission-hub-whatsapp-login-check-v1:${ref}`, cryptoImpl),
    hmacHex(root, `admission-hub-whatsapp-login-password-v1:${p}`, cryptoImpl)
  ]);
  return Object.freeze({ email: `wa.${ref}.${check.slice(0, 16)}@${WHATSAPP_LOGIN_DOMAIN}`, password: `Wa-${password.slice(0, 44)}` });
}

export async function isWhatsAppLoginEmail(email, env, cryptoImpl = globalThis.crypto) {
  const match = LOGIN_EMAIL_PATTERN.exec(String(email || '').trim().toLowerCase());
  const root = rootSecret(env);
  if (!match || !root) return false;
  try {
    const check = await hmacHex(root, `admission-hub-whatsapp-login-check-v1:${match[1]}`, cryptoImpl);
    return constantTimeEqual(check.slice(0, 16), match[2]);
  } catch { return false; }
}

export async function verifyWhatsAppWebhookSignature(rawBody, header, env, cryptoImpl = globalThis.crypto) {
  const { appSecret } = whatsappLoginSettings(env);
  const supplied = String(header || '').trim().toLowerCase();
  if (!appSecret || !/^sha256=[0-9a-f]{64}$/.test(supplied)) return false;
  return constantTimeEqual(`sha256=${await hmacHex(appSecret, String(rawBody ?? ''), cryptoImpl)}`, supplied);
}

// GET /whatsapp/webhook — Meta's one-time "Verify and save" handshake.
export const whatsappVerifyChallenge = (url, env) => {
  const { verifyToken } = whatsappLoginSettings(env);
  const params = url?.searchParams;
  const supplied = String(params?.get('hub.verify_token') || '');
  const challenge = String(params?.get('hub.challenge') || '');
  if (!verifyToken || params?.get('hub.mode') !== 'subscribe' || !/^[A-Za-z0-9_-]{1,128}$/.test(challenge)) return null;
  return supplied.length === verifyToken.length && constantTimeEqual(supplied, verifyToken) ? challenge : null;
};

export function whatsappIncomingMessages(payload) {
  const out = [];
  const list = (value, max = 10) => (Array.isArray(value) ? value.slice(0, max) : []);
  for (const entry of list(payload?.entry)) {
    for (const change of list(entry?.changes)) {
      const value = change?.value;
      if (change?.field !== 'messages' || !value || typeof value !== 'object') continue;
      const names = new Map(list(value.contacts).map(c => [String(c?.wa_id || ''), String(c?.profile?.name || '')]));
      for (const message of list(value.messages)) {
        const from = digits(message?.from, 8, 15);
        if (!from || message?.type !== 'text' || typeof message?.text?.body !== 'string') continue;
        out.push(Object.freeze({ from, text: message.text.body.slice(0, 1024), name: cleanName(names.get(from)) }));
      }
    }
  }
  return out.slice(0, 10);
}

export async function sendWhatsAppText(env, to, body, fetchImpl = globalThis.fetch) {
  const s = whatsappLoginSettings(env);
  if (!s.accessToken || !s.phoneNumberId || !digits(to, 8, 15)) throw new WhatsAppLoginError('WHATSAPP_LOGIN_UNAVAILABLE');
  const response = await fetchImpl(`https://graph.facebook.com/${s.graphVersion}/${s.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body } })
  });
  if (!response?.ok) throw new WhatsAppLoginError('WHATSAPP_SEND_FAILED');
  return true;
}

export const whatsappLoginReplyText = link => `Admission Hub-এ লগইন করতে এই লিংকে চাপুন (১০ মিনিট কাজ করবে):\n${link}\n\nএই লিংক কাউকে দেবেন না।`;

// Always answer Meta quickly; one failed reply never blocks the rest.
export async function handleWhatsAppWebhook(rawBody, signature, env, { now = Date.now(), fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto } = {}) {
  if (!whatsappLoginReady(env)) return Object.freeze({ ready: false, forbidden: false, sent: 0 });
  if (!await verifyWhatsAppWebhookSignature(rawBody, signature, env, cryptoImpl)) return Object.freeze({ ready: true, forbidden: true, sent: 0 });
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return Object.freeze({ ready: true, forbidden: false, sent: 0 }); }
  const { origin } = whatsappLoginSettings(env);
  let sent = 0;
  for (const message of whatsappIncomingMessages(payload)) {
    if (!await readWhatsAppStartCode(message.text, env, { now, cryptoImpl })) continue;
    try {
      const token = await issueWhatsAppLoginToken(message.from, env, { name: message.name, now, cryptoImpl });
      await sendWhatsAppText(env, message.from, whatsappLoginReplyText(`${origin}/?${WHATSAPP_LOGIN_QUERY_KEY}=${token}`), fetchImpl);
      sent += 1;
    } catch { /* keep going */ }
  }
  return Object.freeze({ ready: true, forbidden: false, sent });
}
