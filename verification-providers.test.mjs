import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  AppsScriptOtpVerificationProvider,
  BrevoOtpVerificationProvider,
  BridgeOtpVerificationProvider,
  createConfiguredVerificationProviders,
  OfficialWhatsAppVerificationProvider,
  TelegramLinkVerificationProvider
} from './auth-native/verification/providers.mjs';
import { VERIFICATION_FAILURE_CLASS } from './auth-native/verification/provider-contract.mjs';
import { __verificationProvidersTest } from './auth-native/verification/providers.mjs';
const { otpEmailBody } = __verificationProvidersTest;

const json = (body, status = 200) => Response.json(body, { status });
const KEY = `provider-key-${'k'.repeat(32)}`;

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

test('Brevo OTP provider sends through the Brevo API and derives quota from account credits', async () => {
  const calls = [];
  const provider = new BrevoOtpVerificationProvider({
    id: 'otp-a',
    apiKey: KEY,
    fromAddress: 'sender@example.com',
    declaredDailyQuota: 300,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/v3/senders')) return json({ senders: [{ email: 'sender@example.com', active: true }] });
      if (String(url).endsWith('/v3/account')) return json({ plan: [{ type: 'free', credits: 299, creditsType: 'sendLimit' }] });
      return json({ messageId: '<202609171120.63980787322@smtp-relay.mailin.fr>' }, 201);
    }
  });

  assert.equal((await provider.checkAvailability()).available, true);
  const quota = await provider.getRemainingQuota();
  assert.equal(quota.remaining, 299);
  assert.equal(quota.limit, 300);
  assert.equal(quota.source, 'brevo-account-credits');
  assert.ok(quota.resetAt > Date.now());

  await provider.sendVerification({ destination: 'user@example.com', code: '123456', expiresAt: Date.now() + 300_000 });
  const send = calls.find(call => call.url.endsWith('/v3/smtp/email'));
  const body = JSON.parse(send.init.body);
  assert.equal(send.init.headers['api-key'], KEY);
  assert.equal(body.sender.email, 'sender@example.com');
  assert.deepEqual(body.to, [{ email: 'user@example.com' }]);
  assert.match(body.textContent, /123456/);
  assert.match(body.htmlContent, /123456/);
  assert.match(body.subject, /যাচাইকরণ কোড/);
  assert.match(body.htmlContent, /email-logo\.png/);
  assert.equal(calls.every(call => call.init.redirect === 'manual'), true);
});

test('Backup OTP email carries the branded layout, a prominent code, and dark-mode styles', () => {
  const { text, html } = otpEmailBody('123456', 10, 'মাহমুদ রাসেল');

  assert.equal(html.includes('<script'), false);
  assert.match(html, /color-scheme" content="light dark"/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /email-logo\.png/);
  assert.match(html, /Admission Hub/);
  assert.match(html, /আপনার প্রস্তুতি, আরও গুছিয়ে।/);
  assert.match(html, /ইমেইল যাচাইকরণ/);
  assert.match(html, /প্রিয় মাহমুদ রাসেল,/);
  assert.match(html, /10 মিনিট/);
  assert.match(html, /Admission Hub-এর কোনো কর্মী আপনার OTP চাইবে না।/);
  assert.match(html, /উপেক্ষা করতে পারেন/);
  assert.match(html, /Admission Hub Team/);
  assert.match(text, /মাহমুদ রাসেল/);
  assert.match(text, /123456/);

  // Design contract: one container card, no nested boxes, no emoji/font icons.
  assert.equal(/border[^;"]*dashed/.test(html), false);
  assert.equal(/border[^;"]*dotted/.test(html), false);
  assert.match(html, /linear-gradient\(135deg,#12a876/);
  assert.match(html, /background-color:#0f8f68/);
  assert.match(html, /'SF Mono','Roboto Mono'/);
  assert.match(html, /letter-spacing:6px/);
  assert.match(html, /data:image\/svg\+xml;base64,/);
  assert.match(html, /-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif/);
  assert.equal(/#fff2d9|#e4a620|#856221/i.test(html), false);
  assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html), false);
  assert.equal(/❓|🔒|✅|⚠/.test(html), false);

  // Exactly one bordered+rounded container: the outer card. Inner sections are
  // separated by spacing and 1px dividers only.
  const roundedBoxes = html.match(/border-radius:(\d+)px/g) || [];
  assert.deepEqual(roundedBoxes, ['border-radius:16px', 'border-radius:10px']);
  // Only these may set a background: the page shell, the banner, the card, and
  // the 1px dividers. Anything else would be an inner box.
  const bgColors = [...new Set(html.match(/background-color:#[0-9a-f]{6}/gi) || [])].sort();
  assert.deepEqual(bgColors, ['background-color:#0f8f68', 'background-color:#eaecec', 'background-color:#f7f8f8', 'background-color:#ffffff']);
  // Dividers are hairlines, not tinted blocks.
  for (const m of html.matchAll(/height:1px;background-color:#eaecec/g)) assert.ok(m);
  assert.equal((html.match(/background-color:#eaecec/g) || []).length, (html.match(/height:1px;background-color:#eaecec/g) || []).length);

  const layoutTables = html.match(/<table/g) || [];
  const presentational = html.match(/<table role="presentation"/g) || [];
  assert.equal(layoutTables.length, presentational.length);
});

test('Backup OTP email escapes a hostile recipient name and falls back when absent', () => {
  const hostile = otpEmailBody('123456', 10, '<img src=x onerror=alert(1)>');
  assert.equal(hostile.html.includes('<img src=x'), false);
  assert.match(hostile.html, /&lt;img src=x/);
  assert.match(hostile.text, /প্রিয় <img src=x onerror=alert\(1\)>,/);

  const anonymous = otpEmailBody('123456', 10, '');
  assert.match(anonymous.html, /প্রিয় ব্যবহারকারী,/);
  assert.equal(anonymous.html.includes('প্রিয় ,'), false);
});

test('Brevo OTP provider fails closed when unconfigured and refuses a non-email destination', async () => {
  const unconfigured = new BrevoOtpVerificationProvider({ id: 'otp-a', declaredDailyQuota: 300 });
  assert.equal(unconfigured.configured, false);
  assert.equal((await unconfigured.checkAvailability()).code, 'NOT_CONFIGURED');
  assert.equal((await unconfigured.getRemainingQuota()).remaining, 0);
  await assert.rejects(() => unconfigured.sendVerification({ destination: 'user@example.com', code: '123456' }),
    error => error?.failureClass === VERIFICATION_FAILURE_CLASS.HARD);

  const provider = new BrevoOtpVerificationProvider({
    id: 'otp-a', apiKey: KEY, fromAddress: 'sender@example.com', declaredDailyQuota: 300,
    fetchImpl: async () => json({ messageId: 'x' }, 201)
  });
  await assert.rejects(() => provider.sendVerification({ destination: '+8801700000000', code: '123456' }),
    error => error?.failureClass === VERIFICATION_FAILURE_CLASS.USER);
  await assert.rejects(() => provider.sendVerification({ destination: 'user@example.com', code: '12345' }),
    error => error?.failureClass === VERIFICATION_FAILURE_CLASS.USER);
});

test('Brevo reports a sender that is not active instead of claiming readiness', async () => {
  const provider = new BrevoOtpVerificationProvider({
    id: 'otp-a', apiKey: KEY, fromAddress: 'sender@example.com', declaredDailyQuota: 300,
    fetchImpl: async () => json({ senders: [{ email: 'sender@example.com', active: false }] })
  });
  const availability = await provider.checkAvailability();
  assert.equal(availability.available, false);
  assert.equal(availability.code, 'SENDER_NOT_VERIFIED');
});

test('Apps Script OTP provider signs its calls and follows the Apps Script redirect', async () => {
  const calls = [];
  const secret = 'shared-secret-' + 's'.repeat(32);
  const provider = new AppsScriptOtpVerificationProvider({
    id: 'otp-b',
    webAppUrl: 'https://script.google.com/macros/s/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/exec',
    sharedSecret: secret,
    declaredDailyQuota: 100,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      const action = init.method === 'POST' ? JSON.parse(init.body).action : new URL(String(url)).searchParams.get('action');
      if (action === 'health') return json({ ok: true, ready: true });
      if (action === 'quota') return json({ ok: true, limit: 100, remaining: 97, resetAt: 1_900_000_000_000 });
      return json({ ok: true, accepted: true, messageRef: 'gmail-message-ref-1234567890' });
    }
  });

  assert.equal(provider.configured, true);
  assert.equal((await provider.checkAvailability()).code, 'READY');
  assert.equal((await provider.getRemainingQuota()).source, 'apps-script-mail-quota');

  await provider.sendVerification({ destination: 'user@example.com', code: '654321' });
  const send = calls.find(call => call.init.method === 'POST');
  const posted = JSON.parse(send.init.body);
  assert.equal(posted.action, 'send');
  assert.equal(posted.destination, 'user@example.com');
  assert.equal(posted.code, '654321');
  const expected = createHmac('sha256', secret)
    .update(['send', posted.timestamp, posted.nonce, posted.destination, posted.code].join('\n'))
    .digest('base64url');
  assert.equal(posted.signature, expected);
  assert.equal(calls.every(call => call.init.redirect === 'follow'), true);
});

test('Apps Script OTP provider rejects non-Google web app URLs and weak secrets', () => {
  const base = { id: 'otp-b', declaredDailyQuota: 100 };
  for (const webAppUrl of [
    'https://evil.example/macros/s/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/exec',
    'https://script.google.com/macros/s/short/exec',
    'http://script.google.com/macros/s/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/exec',
    'https://script.google.com/macros/s/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/exec?x=1'
  ]) {
    assert.equal(new AppsScriptOtpVerificationProvider({ ...base, webAppUrl, sharedSecret: 's'.repeat(40) }).configured, false, webAppUrl);
  }
  const validUrl = 'https://script.google.com/macros/s/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/exec';
  assert.equal(new AppsScriptOtpVerificationProvider({ ...base, webAppUrl: validUrl, sharedSecret: 'short' }).configured, false);
});

test('OTP slots prefer Brevo and Apps Script and fall back to bridge bindings', async () => {
  const scriptsUrl = 'https://script.google.com/macros/s/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/exec';
  const preferred = createConfiguredVerificationProviders({
    BREVO_API_KEY: KEY,
    BREVO_FROM_ADDRESS: 'sender@example.com',
    OTP_A_DAILY_QUOTA: '300',
    OTP_B_PROVIDER_APPS_SCRIPT_URL: scriptsUrl,
    OTP_B_PROVIDER_SHARED_SECRET: 'shared-secret-' + 's'.repeat(32),
    OTP_B_DAILY_QUOTA: '100'
  });
  assert.equal(preferred[0] instanceof BrevoOtpVerificationProvider, true);
  assert.equal(preferred[0].id, 'otp-a');
  assert.equal(preferred[1] instanceof AppsScriptOtpVerificationProvider, true);
  assert.equal(preferred[1].id, 'otp-b');

  const bridged = createConfiguredVerificationProviders({
    OTP_A_PROVIDER_ORIGIN: 'https://otp-bridge.example',
    OTP_A_PROVIDER_KEY: KEY,
    OTP_A_DAILY_QUOTA: '200',
    OTP_B_PROVIDER_ORIGIN: 'https://otp-bridge-two.example',
    OTP_B_PROVIDER_KEY: KEY,
    OTP_B_DAILY_QUOTA: '200'
  });
  assert.equal(bridged[0].getProviderStatus ? true : false, true);
  assert.equal(bridged[0].constructor.name, 'BridgeOtpVerificationProvider');
  assert.equal(bridged[1].constructor.name, 'BridgeOtpVerificationProvider');

  const empty = createConfiguredVerificationProviders({});
  assert.deepEqual(empty.map(row => row.id), ['otp-a', 'otp-b', 'otp-c', 'whatsapp', 'telegram']);
  for (const provider of empty) assert.equal((await provider.getProviderStatus()).configured, false);
});
