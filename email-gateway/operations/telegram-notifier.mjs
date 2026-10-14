const TOKEN_PATTERN = /^[0-9]{6,15}:[A-Za-z0-9_-]{30,100}$/;
const CHAT_PATTERN = /^(?:-?[0-9]{5,24}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const ALLOWED_STATUSES = new Set(['IMPLEMENTED', 'TESTED', 'BLOCKED', 'DEPLOYED', 'VERIFIED', 'COMPLETED']);

export class TelegramNotificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TelegramNotificationError';
    this.code = code;
  }
}

const clean = (value, maxLength) => String(value || '').replace(CONTROL_CHARS, '').trim().slice(0, maxLength);

export function createTelegramCompletionMessage({ status, summary, details = [], timestamp = new Date().toISOString() }) {
  const normalizedStatus = String(status || '').toUpperCase();
  if (!ALLOWED_STATUSES.has(normalizedStatus)) throw new TelegramNotificationError('INVALID_NOTIFICATION', 'Notification status is invalid.');
  const safeSummary = clean(summary, 1500);
  if (!safeSummary) throw new TelegramNotificationError('INVALID_NOTIFICATION', 'Notification summary is required.');
  if (!Array.isArray(details) || details.length > 12) throw new TelegramNotificationError('INVALID_NOTIFICATION', 'Notification details are invalid.');
  const lines = ['🔥 AdmissionSky', `Status: ${normalizedStatus}`, safeSummary];
  for (const item of details) {
    const value = clean(item, 240);
    if (value) lines.push(`• ${value}`);
  }
  lines.push(`Time: ${clean(timestamp, 40)}`);
  const text = lines.join('\n');
  if (text.length > 4096) throw new TelegramNotificationError('INVALID_NOTIFICATION', 'Notification is too large.');
  return text;
}

async function readBoundedJson(response, maximumBytes = 16384) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (text.length > maximumBytes) throw new TelegramNotificationError('INVALID_RESPONSE', 'Notification provider response is invalid.');
    try { return JSON.parse(text); } catch (_) { throw new TelegramNotificationError('INVALID_RESPONSE', 'Notification provider response is invalid.'); }
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      try { await reader.cancel(); } catch (_) {}
      throw new TelegramNotificationError('INVALID_RESPONSE', 'Notification provider response is invalid.');
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try { return JSON.parse(text); } catch (_) { throw new TelegramNotificationError('INVALID_RESPONSE', 'Notification provider response is invalid.'); }
}

export async function sendTelegramNotification({ token, chatId, message, fetchImpl = globalThis.fetch, timeoutMs = 5000 }) {
  const safeToken = String(token || '').trim();
  const safeChatId = String(chatId || '').trim();
  if (!TOKEN_PATTERN.test(safeToken) || !CHAT_PATTERN.test(safeChatId)) {
    throw new TelegramNotificationError('REQUIRED_SECRET_NOT_CONFIGURED', 'Telegram notification configuration is unavailable.');
  }
  if (typeof fetchImpl !== 'function') throw new TelegramNotificationError('NOTIFIER_UNAVAILABLE', 'Telegram notification transport is unavailable.');
  const text = typeof message === 'string' ? clean(message, 4096) : createTelegramCompletionMessage(message);
  if (!text) throw new TelegramNotificationError('INVALID_NOTIFICATION', 'Notification message is required.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('telegram-notification-timeout'), Math.max(250, Math.min(15000, Number(timeoutMs || 5000))));
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${safeToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ chat_id: safeChatId, text, disable_web_page_preview: true, protect_content: true }),
      signal: controller.signal
    });
    if (!response.ok) throw new TelegramNotificationError('PROVIDER_REJECTED', 'Telegram notification was rejected.');
    const data = await readBoundedJson(response);
    const messageId = data?.ok === true && Number.isFinite(Number(data?.result?.message_id)) ? Number(data.result.message_id) : null;
    if (messageId === null) throw new TelegramNotificationError('INVALID_RESPONSE', 'Telegram notification acceptance evidence is missing.');
    return Object.freeze({ sent: true, messageId });
  } catch (error) {
    if (error instanceof TelegramNotificationError) throw error;
    if (error?.name === 'AbortError') throw new TelegramNotificationError('TIMEOUT', 'Telegram notification timed out.');
    throw new TelegramNotificationError('TRANSPORT_ERROR', 'Telegram notification transport failed.');
  } finally {
    clearTimeout(timer);
  }
}

export function notifyTelegramFromEnvironment({ env = globalThis.process?.env || {}, notification, fetchImpl, timeoutMs } = {}) {
  return sendTelegramNotification({
    token: env.TELEGRAM_BOT_TOKEN || env.TG_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID || env.TG_CHAT_ID,
    message: notification,
    fetchImpl,
    timeoutMs
  });
}
