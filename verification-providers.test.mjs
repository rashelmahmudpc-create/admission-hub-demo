import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  AppsScriptOtpVerificationProvider,
  BridgeOtpVerificationProvider,
  createConfiguredVerificationProviders,
  OfficialWhatsAppVerificationProvider,
  TelegramLinkVerificationProvider
} from './auth-native/verification/providers.mjs';
import { VERIFICATION_FAILURE_CLASS } from './auth-native/verification/provider-contract.mjs';

const json = (body, status = 200) => Response.json(body, { status });
const KEY = `provider-key-${'k'.repeat(32)}`;
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/exec';
const APPS_SCRIPT_SECRET = `apps-script-${'s'.repeat(32)}`;
// Mirrors apps-script/Code.gs signatureFor_: same field order, same base64url.
const expectedSignature = (secret, action, timestamp, nonce, destination = '', code = '') =>
  createHmac('sha256', secret)
    .update([action, timestamp, nonce, destination, code].join('\n'))
    .digest('base64url');

test('three OTP bridge slots implement the shared contract and fail closed when not securely configured', async () => {
  const providers = createConfiguredVerificationProviders({});
  assert.deepEqual(providers.map(row => row.id), ['otp-a', 'otp-b', 'otp-c', 'whatsapp', 'telegram']);
  for (const provider of providers) {
    assert.equal((await provider.checkAvailability()).available, false);
    assert.equal((await provider.getRemainingQuota()).remaining, 0);
    assert.equal((await provider.getProviderStatus()).configured, false);
    await assert.rejects(
      () => provider.sendVerification({}),
      error => error?.failureClass === VERIFICATION_FAILURE_CLASS.HARD
    );
  }
});

test('Apps Script OTP adapter signs every call, follows Google\'s 302, and tracks the mail quota', async () => {
  const calls = [];
  const provider = new AppsScriptOtpVerificationProvider({
    id: 'otp-a',
    webAppUrl: APPS_SCRIPT_URL,
    sharedSecret: APPS_SCRIPT_SECRET,
    declaredDailyQuota: 100,
    now: () => 1_800_000_000_000,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (init.method === 'POST') {
        const body = JSON.parse(String(init.body));
        assert.equal(body.signature, expectedSignature(APPS_SCRIPT_SECRET, 'send', body.timestamp, body.nonce, body.destination, body.code));
        return json({ ok: true, accepted: true, messageRef: 'gmail-message-reference-1234567890' });
      }
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      assert.equal(
        parsed.searchParams.get('signature'),
        expectedSignature(APPS_SCRIPT_SECRET, action, parsed.searchParams.get('timestamp'), parsed.searchParams.get('nonce'))
      );
      if (action === 'quota') return json({ ok: true, remaining: 97, limit: 100, resetAt: 1_800_086_400_000 });
      return json({ ok: true, ready: true });
    }
  });

  assert.equal(provider.configured, true);
  assert.deepEqual(await provider.checkAvailability(), { available: true, code: 'READY' });
  assert.deepEqual(await provider.getRemainingQuota(), {
    remaining: 97, limit: 100, resetAt: 1_800_086_400_000, source: 'apps-script-mail-quota'
  });
  assert.deepEqual(
    await provider.sendVerification({ destination: 'student@example.com', code: '654321' }),
    { accepted: true }
  );

  // Apps Script answers with a 302 to googleusercontent.com, so this adapter must
  // opt into redirect following; the OTP bridge deliberately does the opposite.
  assert.equal(calls.every(call => call.init.redirect === 'follow'), true);
  const send = calls.find(call => call.init.method === 'POST');
  assert.equal(send.url, APPS_SCRIPT_URL);
  const health = calls.find(call => call.url.includes('action=health'));
  assert.ok(health);
  assert.equal(provider.verificationMode, 'local-code');
  await assert.rejects(
    () => provider.verifyCode({}),
    error => error?.code === 'LOCAL_VERIFICATION_ONLY' && error?.failureClass === VERIFICATION_FAILURE_CLASS.USER
  );
});

test('Apps Script adapter fails closed on bad input, unusable quota responses, and non-Google origins', async () => {
  const rejected = new AppsScriptOtpVerificationProvider({
    id: 'otp-a',
    webAppUrl: APPS_SCRIPT_URL,
    sharedSecret: APPS_SCRIPT_SECRET,
    declaredDailyQuota: 100,
    fetchImpl: async url => (String(url).includes('action=quota')
      ? json({ ok: true, remaining: 5, limit: 100, resetAt: 0 })
      : json({ ok: true, ready: true }))
  });
  await assert.rejects(
    () => rejected.getRemainingQuota(),
    error => error?.code === 'INVALID_QUOTA_RESPONSE' && error?.failureClass === VERIFICATION_FAILURE_CLASS.HARD
  );

  const unconfigured = new AppsScriptOtpVerificationProvider({
    id: 'otp-a',
    webAppUrl: 'https://evil.example/macros/s/AKfycbxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/exec',
    sharedSecret: APPS_SCRIPT_SECRET,
    declaredDailyQuota: 100
  });
  assert.equal(unconfigured.configured, false);
  assert.deepEqual(await unconfigured.checkAvailability(), { available: false, code: 'NOT_CONFIGURED' });
  await assert.rejects(
    () => unconfigured.sendVerification({ destination: 'student@example.com', code: '654321' }),
    error => error?.failureClass === VERIFICATION_FAILURE_CLASS.HARD
  );
  assert.equal((await unconfigured.getProviderStatus()).configured, false);
});

test('otp-a prefers the Apps Script mailer when configured and otherwise falls back to the bridge', () => {
  const appsScript = createConfiguredVerificationProviders({
    OTP_A_PROVIDER_APPS_SCRIPT_URL: APPS_SCRIPT_URL,
    OTP_A_PROVIDER_SHARED_SECRET: APPS_SCRIPT_SECRET,
    OTP_A_DAILY_QUOTA: '100',
    OTP_A_PROVIDER_ORIGIN: 'https://otp-bridge.example',
    OTP_A_PROVIDER_KEY: KEY
  })[0];
  assert.equal(appsScript instanceof AppsScriptOtpVerificationProvider, true);
  assert.equal(appsScript.id, 'otp-a');
  assert.equal(appsScript.channel, 'otp');

  const fallback = createConfiguredVerificationProviders({
    OTP_A_PROVIDER_ORIGIN: 'https://otp-bridge.example',
    OTP_A_PROVIDER_KEY: KEY,
    OTP_A_DAILY_QUOTA: '100'
  })[0];
  assert.equal(fallback instanceof BridgeOtpVerificationProvider, true);
  assert.equal(fallback.id, 'otp-a');
});

test('OTP bridge uses bounded HTTPS server calls for health, exact quota, and delivery', async () => {
  const calls = [];
  const provider = new BridgeOtpVerificationProvider({
    id: 'otp-a',
    origin: 'https://otp-bridge.example',
    apiKey: KEY,
    declaredDailyQuota: 250,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/health')) return json({ ok: true, ready: true });
      if (String(url).endsWith('/quota')) return json({ remaining: 88, limit: 100, resetAt: 1_900_000_000_000 });
      return json({ accepted: true, messageRef: 'message-reference-1234567890' });
    }
  });
  assert.deepEqual(await provider.checkAvailability(), { available: true, code: 'READY' });
  assert.deepEqual(await provider.getRemainingQuota(), { remaining: 88, limit: 100, resetAt: 1_900_000_000_000, source: 'provider-api' });
  assert.deepEqual(await provider.sendVerification({
    attemptId: 'attempt-12345678901234567890',
    destination: 'student@example.com',
    code: '123456',
    purpose: 'account-backup',
    expiresAt: 1_800_000_300_000
  }), { accepted: true });
  const send = calls.find(call => call.url.endsWith('/send'));
  assert.equal(calls.every(call => call.init.redirect === 'manual'), true);
  assert.equal(send.init.headers['X-Verification-Key'], KEY);
  const body = JSON.parse(send.init.body);
  assert.equal(body.code, '123456');
  assert.equal(body.destination, 'student@example.com');
});

test('OTP bridge classifies user, hard, and temporary provider failures for safe retry decisions', async () => {
  for (const row of [
    { status: 400, expected: VERIFICATION_FAILURE_CLASS.USER },
    { status: 401, expected: VERIFICATION_FAILURE_CLASS.HARD },
    { status: 503, expected: VERIFICATION_FAILURE_CLASS.TEMPORARY }
  ]) {
    const provider = new BridgeOtpVerificationProvider({
      id: 'otp-a', origin: 'https://otp-bridge.example', apiKey: KEY, declaredDailyQuota: 10,
      fetchImpl: async () => json({ error: { code: `REMOTE_MUST_NOT_LEAK_${KEY}` } }, row.status)
    });
    await assert.rejects(
      () => provider.sendVerification({ destination: 'student@example.com', code: '123456' }),
      error => error?.failureClass === row.expected && error?.code === `PROVIDER_HTTP_${row.status}`
    );
  }
});

test('WhatsApp adapter calls only the official Graph API with an approved template and locally verified code', async () => {
  const calls = [];
  const provider = new OfficialWhatsAppVerificationProvider({
    graphVersion: 'v99.0',
    phoneNumberId: '123456789012345',
    accessToken: `meta-token-${'m'.repeat(40)}`,
    templateName: 'admission_hub_verification',
    templateLanguage: 'bn_BD',
    declaredDailyQuota: 100,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return init.method === 'GET'
        ? json({ id: '123456789012345' })
        : json({ messages: [{ id: 'wamid-message-reference-1234567890' }] });
    }
  });
  assert.equal((await provider.checkAvailability()).available, true);
  await provider.sendVerification({ destination: '+8801700000000', code: '654321' });
  const send = calls.find(call => call.init.method === 'POST');
  assert.match(send.url, /^https:\/\/graph\.facebook\.com\/v99\.0\/123456789012345\/messages$/);
  assert.match(send.init.headers.Authorization, /^Bearer /);
  const body = JSON.parse(send.init.body);
  assert.equal(body.messaging_product, 'whatsapp');
  assert.equal(body.type, 'template');
  assert.equal(body.template.name, 'admission_hub_verification');
  assert.equal(body.template.components[0].parameters[0].text, '654321');
  assert.equal(provider.verificationMode, 'local-code');
});

test('Telegram adapter creates a one-time bot link and sends a protected OTP only after START', async () => {
  let getMeCalls = 0;
  let telegramMessage = null;
  const provider = new TelegramLinkVerificationProvider({
    botUsername: 'AdmissionHubVerifyBot',
    botToken: `123456:${'t'.repeat(35)}`,
    webhookSecret: `webhook-${'w'.repeat(32)}`,
    webhookUrl: 'https://admission-gk.admissionhub.workers.dev/api/auth/v1/telegram/webhook',
    declaredDailyQuota: 100,
    fetchImpl: async (url, init = {}) => {
      getMeCalls += 1;
      assert.match(String(url), /^https:\/\/api\.telegram\.org\/bot/);
      if (String(url).endsWith('/getWebhookInfo')) {
        return json({ ok: true, result: { url: 'https://admission-gk.admissionhub.workers.dev/api/auth/v1/telegram/webhook', allowed_updates: ['message'] } });
      }
      if (String(url).endsWith('/sendMessage')) {
        telegramMessage = JSON.parse(init.body);
        return json({ ok: true, result: { message_id: 77 } });
      }
      return json({ ok: true, result: { id: 123456, is_bot: true, username: 'AdmissionHubVerifyBot' } });
    }
  });
  assert.equal((await provider.checkAvailability()).available, true);
  const linkToken = 'A'.repeat(43);
  const sent = await provider.sendVerification({ linkToken });
  assert.equal(sent.accepted, true);
  const link = new URL(sent.interaction.url);
  assert.equal(link.origin, 'https://t.me');
  assert.equal(link.searchParams.get('start'), linkToken);
  assert.equal(getMeCalls, 2);
  assert.equal(provider.verificationMode, 'local-code');
  assert.deepEqual(await provider.sendTelegramCode({ chatId: '123456789', code: '654321', expiresInSeconds: 300 }), { accepted: true });
  assert.equal(getMeCalls, 3);
  assert.equal(telegramMessage.chat_id, '123456789');
  assert.equal(telegramMessage.protect_content, true);
  assert.equal(telegramMessage.disable_web_page_preview, true);
  assert.match(telegramMessage.text, /Admission Hub Verification/);
  assert.match(telegramMessage.text, /654321/);
  assert.match(telegramMessage.text, /5 মিনিট/);
  assert.doesNotMatch(telegramMessage.text, /API key|secret|Gmail password/i);
  await assert.rejects(() => provider.verifyCode({ code: '654321' }), error => error?.code === 'LOCAL_VERIFICATION_ONLY');
});

test('Telegram canary derives a separate webhook secret, validates the token identity, and configures only an empty webhook slot', async () => {
  const webhookUrl = 'https://admission-gk.admissionhub.workers.dev/api/auth/v1/telegram/webhook';
  const rootSecret = `root-auth-secret-${'r'.repeat(40)}`;
  let activeWebhook = '';
  let activationSecret = '';
  const calls = [];
  const provider = new TelegramLinkVerificationProvider({
    botToken: `654321:${'z'.repeat(35)}`,
    webhookSecretSource: rootSecret,
    webhookUrl,
    declaredDailyQuota: 172800,
    fetchImpl: async (url, init = {}) => {
      const target = String(url);
      calls.push({ target, method: init.method || 'GET' });
      if (target.endsWith('/getMe')) return json({ ok: true, result: { id: 654321, is_bot: true, username: 'AdmissionHubCanaryBot' } });
      if (target.endsWith('/getWebhookInfo')) return json({ ok: true, result: { url: activeWebhook, allowed_updates: activeWebhook ? ['message'] : [] } });
      if (target.endsWith('/setWebhook')) {
        const body = JSON.parse(init.body);
        assert.equal(body.url, webhookUrl);
        assert.deepEqual(body.allowed_updates, ['message']);
        assert.equal(body.drop_pending_updates, false);
        assert.match(body.secret_token, /^[A-Za-z0-9_-]{20,256}$/);
        assert.notEqual(body.secret_token, rootSecret);
        activationSecret = body.secret_token;
        activeWebhook = body.url;
        return json({ ok: true, result: true });
      }
      if (target === webhookUrl) {
        assert.equal(init.headers['X-Telegram-Bot-Api-Secret-Token'], activationSecret);
        return json({ ok: true });
      }
      throw new Error('unexpected request');
    }
  });
  const activated = await provider.configureWebhook();
  assert.deepEqual(activated, {
    ready: true,
    identityReady: true,
    webhookReady: true,
    endpointAccepted: true,
    webhookChanged: true
  });
  assert.deepEqual(await provider.checkAvailability(), { available: true, code: 'READY' });
  const sent = await provider.sendVerification({ linkToken: 'D'.repeat(43) });
  assert.equal(new URL(sent.interaction.url).hostname, 't.me');
  assert.equal(calls.some(call => call.target.includes(rootSecret)), false);
});

test('Telegram canary refuses to overwrite another webhook integration', async () => {
  let mutationCalls = 0;
  const provider = new TelegramLinkVerificationProvider({
    botToken: `777777:${'q'.repeat(35)}`,
    webhookSecret: `safe-webhook-${'s'.repeat(32)}`,
    webhookUrl: 'https://admission-gk.admissionhub.workers.dev/api/auth/v1/telegram/webhook',
    declaredDailyQuota: 10,
    fetchImpl: async (url, init = {}) => {
      if (String(url).endsWith('/getMe')) return json({ ok: true, result: { id: 777777, is_bot: true, username: 'AdmissionHubConflictBot' } });
      if (String(url).endsWith('/getWebhookInfo')) return json({ ok: true, result: { url: 'https://another.example/webhook' } });
      if (init.method === 'POST') mutationCalls += 1;
      return json({ ok: true, result: true });
    }
  });
  await assert.rejects(() => provider.configureWebhook(), error => error?.code === 'WEBHOOK_CONFLICT');
  assert.equal(mutationCalls, 0);
});

test('Telegram Auth reuses the existing server-only bot binding without copying or exposing its value', async () => {
  const providers = createConfiguredVerificationProviders({
    TG_BOT_TOKEN: `888888:${'v'.repeat(35)}`,
    AUTH_HMAC_SECRET: `auth-root-${'a'.repeat(48)}`,
    TELEGRAM_AUTH_WEBHOOK_URL: 'https://admission-gk.admissionhub.workers.dev/api/auth/v1/telegram/webhook',
    TELEGRAM_AUTH_DAILY_QUOTA: '172800'
  }, { fetchImpl: async () => json({ ok: false }, 503) });
  const telegram = providers.find(provider => provider.id === 'telegram');
  assert.equal((await telegram.getProviderStatus()).configured, true);
  assert.equal((await telegram.getRemainingQuota()).source, 'internal-safety-cap');
  assert.equal('TG_BOT_TOKEN' in telegram, false);
});
