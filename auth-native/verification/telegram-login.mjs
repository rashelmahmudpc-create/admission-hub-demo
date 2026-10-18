// "Continue with Telegram" login (owner request 2026-10-18).
// Verifies the signed payload that oauth.telegram.org returns for the
// configured bot (https://core.telegram.org/widgets/login#checking-authorization)
// and maps a Telegram user to ONE stable Firebase email/password account whose
// address and password are derived from AUTH_HMAC_SECRET. Nobody can type that
// password, and the reserved domain is refused by the public Sign Up route, so
// the account is reachable only through a valid Telegram signature.
import { constantTimeEqual } from '../core/crypto.mjs';

export const TELEGRAM_LOGIN_DOMAIN = 'telegram.admissionsky.pages.dev';
const MAX_AGE_SECONDS = 600;
const BOT_TOKEN_PATTERN = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;
const LOGIN_EMAIL_PATTERN = /^tg(\d{1,20})\.([0-9a-f]{20})@telegram\.admissionsky\.pages\.dev$/;
const encoder = new TextEncoder();

const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
const hmacHex = async (keyBytes, text, cryptoImpl) => {
  const key = await cryptoImpl.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await cryptoImpl.subtle.sign('HMAC', key, encoder.encode(text)));
};
const rootSecret = env => {
  const value = String(env?.AUTH_HMAC_SECRET || '');
  return value.length >= 32 && value.length <= 4096 ? value : '';
};

export const telegramLoginBotToken = env => {
  const token = String(env?.TELEGRAM_AUTH_BOT_TOKEN || env?.TG_BOT_TOKEN || '').trim();
  return BOT_TOKEN_PATTERN.test(token) ? token : '';
};
export const telegramLoginBotId = env => telegramLoginBotToken(env).split(':')[0] || '';
export const telegramLoginReady = env => Boolean(
  telegramLoginBotToken(env) && rootSecret(env) && String(env?.TELEGRAM_LOGIN_ACTIVATION || 'enabled') !== 'disabled'
);
export const reservedTelegramLoginEmail = email => String(email || '').trim().toLowerCase().endsWith(`@${TELEGRAM_LOGIN_DOMAIN}`);

export class TelegramLoginError extends Error {
  constructor(reason) { super(reason); this.name = 'TelegramLoginError'; this.reason = reason; }
}

export async function verifyTelegramLogin(input, env, { now = Date.now(), cryptoImpl = globalThis.crypto } = {}) {
  const token = telegramLoginBotToken(env);
  if (!token || !cryptoImpl?.subtle) throw new TelegramLoginError('TELEGRAM_LOGIN_UNAVAILABLE');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TelegramLoginError('TELEGRAM_LOGIN_INVALID');
  const hash = String(input.hash || '').toLowerCase();
  const data = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'hash' || value === undefined || value === null) continue;
    if (!/^[a-z_]{1,32}$/.test(key) || !['string', 'number', 'boolean'].includes(typeof value)) throw new TelegramLoginError('TELEGRAM_LOGIN_INVALID');
    data[key] = String(value);
  }
  if (Object.keys(data).length > 16 || !/^[0-9a-f]{64}$/.test(hash) || !/^\d{1,20}$/.test(data.id || '') || !/^\d{9,12}$/.test(data.auth_date || '')) {
    throw new TelegramLoginError('TELEGRAM_LOGIN_INVALID');
  }
  const checkString = Object.keys(data).sort().map(key => `${key}=${data[key]}`).join('\n');
  const secret = await cryptoImpl.subtle.digest('SHA-256', encoder.encode(token));
  const expected = await hmacHex(secret, checkString, cryptoImpl);
  if (!constantTimeEqual(expected, hash)) throw new TelegramLoginError('TELEGRAM_LOGIN_INVALID');
  const age = Math.floor(Number(now) / 1000) - Number(data.auth_date);
  if (age > MAX_AGE_SECONDS || age < -60) throw new TelegramLoginError('TELEGRAM_LOGIN_EXPIRED');
  const clean = value => String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64);
  return Object.freeze({
    id: data.id,
    displayName: [clean(data.first_name), clean(data.last_name)].filter(Boolean).join(' ').slice(0, 80),
    username: clean(data.username)
  });
}

export async function telegramLoginCredentials(telegramId, env, cryptoImpl = globalThis.crypto) {
  const root = rootSecret(env);
  const id = String(telegramId || '');
  if (!root || !/^\d{1,20}$/.test(id)) throw new TelegramLoginError('TELEGRAM_LOGIN_UNAVAILABLE');
  const key = encoder.encode(root);
  const [tag, password] = await Promise.all([
    hmacHex(key, `admission-hub-telegram-login-email-v1:${id}`, cryptoImpl),
    hmacHex(key, `admission-hub-telegram-login-password-v1:${id}`, cryptoImpl)
  ]);
  return Object.freeze({ email: `tg${id}.${tag.slice(0, 20)}@${TELEGRAM_LOGIN_DOMAIN}`, password: `Tg-${password.slice(0, 44)}` });
}

export async function isTelegramLoginEmail(email, env, cryptoImpl = globalThis.crypto) {
  const match = LOGIN_EMAIL_PATTERN.exec(String(email || '').trim().toLowerCase());
  if (!match || !rootSecret(env)) return false;
  try {
    const expected = await telegramLoginCredentials(match[1], env, cryptoImpl);
    return constantTimeEqual(expected.email, `tg${match[1]}.${match[2]}@${TELEGRAM_LOGIN_DOMAIN}`);
  } catch { return false; }
}
