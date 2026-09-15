import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const script = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');
const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  async json() { return body; }
});
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitFor(predicate, timeout = 1000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error('Timed out waiting for UI state.');
}
const bytes = (...values) => Uint8Array.of(...values).buffer;
const challenge = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function setup({ methods = {}, signed = false, passkeyCredentials = null, backupInteraction = null, pageUrl = 'https://admissionhub.pages.dev/' } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: pageUrl,
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const calls = [];
  let googleCallback = null;
  let tokenCallback = null;
  dom.window.google = {
    accounts: {
      id: {
        initialize(options) { googleCallback = options.callback; },
        renderButton(host) {
          const button = dom.window.document.createElement('button');
          button.type = 'button';
          button.textContent = 'Continue with Google';
          host.append(button);
        }
      },
      oauth2: {
        initTokenClient(options) {
          tokenCallback = options.callback;
          return { requestAccessToken() { tokenCallback({ access_token: `google-access-${'a'.repeat(32)}` }); } };
        }
      }
    }
  };
  if (passkeyCredentials) {
    Object.defineProperty(dom.window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(dom.window, 'PublicKeyCredential', { value: function PublicKeyCredential() {}, configurable: true });
    Object.defineProperty(dom.window.navigator, 'credentials', { value: passkeyCredentials, configurable: true });
  }
  dom.window.fetch = async (url, options = {}) => {
    const path = String(url);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method || 'GET', body });
    if (path.includes('/config')) return reply(200, {
      auth: {
        available: true,
        methods: {
          google: { available: false, ...methods.google },
          passkey: { available: false, ...methods.passkey },
          telegramVerification: { available: false, ...methods.telegramVerification },
          backup: { available: false, ...methods.backup },
          emailPassword: { available: true }
        },
        verificationEmail: { resendCooldownSeconds: 60 }
      }
    });
    if (path.includes('/session') && !path.includes('/session/') && (options.method || 'GET') === 'GET') {
      return signed
        ? reply(200, { authenticated: true, emailVerified: true, user: { id: 'usr-ui', emailMasked: 'u***@example.com' } })
        : reply(401, { error: { code: 'SESSION_INVALID', message: 'সেশন নেই।' } });
    }
    if (path.endsWith('/google/link')) return reply(200, { authenticated: true, emailVerified: true, user: { id: 'usr-ui', emailMasked: 'u***@example.com' } });
    if (path.endsWith('/google')) return reply(200, { authenticated: true, emailVerified: true, user: { id: 'usr-ui', emailMasked: 'u***@example.com' } });
    if (path.endsWith('/passkey/authentication/begin')) return reply(200, {
      challengeId: 'passkey-challenge-login',
      options: { challenge, rpId: 'admissionhub.pages.dev', timeout: 120000, userVerification: 'required', allowCredentials: [] }
    });
    if (path.endsWith('/passkey/authentication/finish')) return reply(200, { authenticated: true, emailVerified: true, user: { id: 'usr-ui', emailMasked: 'u***@example.com' } });
    if (path.endsWith('/passkey/registration/begin')) return reply(200, {
      challengeId: 'passkey-challenge-register',
      options: {
        challenge,
        rp: { id: 'admissionhub.pages.dev', name: 'Admission Hub' },
        user: { id: challenge, name: 'u***@example.com', displayName: 'শিক্ষার্থী' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        excludeCredentials: []
      }
    });
    if (path.endsWith('/passkey/registration/finish')) return reply(200, { registered: true, credentialCount: 1 });
    if (path.endsWith('/passkey/status')) return reply(200, { count: 1, credentials: [{ id: 'credential-ui', createdAt: Date.now(), synced: false }] });
    if (path.endsWith('/passkey/remove')) return reply(200, { removed: true, credentialCount: 0 });
    if (path.includes('/backup/request')) return reply(202, {
      accepted: true,
      attemptId: 'backup-attempt-123456789012345',
      expiresAt: Date.now() + 300000,
      ...(backupInteraction ? { interaction: backupInteraction } : {})
    });
    if (path.includes('/backup/verify')) return reply(200, { verified: true, purpose: 'account-backup', userId: 'usr-ui' });
    return reply(404, { error: { message: 'not found' } });
  };
  dom.window.eval(script);
  return { dom, window: dom.window, document: dom.window.document, calls, googleCredential: token => googleCallback?.({ credential: token }) };
}

test('Google is capability-gated, uses Firebase endpoint, and keeps tokens out of browser storage', async () => {
  const clientId = '123456789012-exampleclientidentifier.apps.googleusercontent.com';
  const app = setup({ methods: { google: { available: true, clientId } } });
  await waitFor(() => app.document.querySelector('[data-role="google-button"] button'));
  app.window.AdmissionAccount.open();
  const idToken = `google-id-${'x'.repeat(32)}`;
  app.googleCredential(idToken);
  await waitFor(() => app.calls.some(call => call.path.endsWith('/google')));
  await waitFor(() => app.document.querySelector('[data-view="signed"]').hidden === false);
  const call = app.calls.find(item => item.path.endsWith('/google'));
  assert.deepEqual(call.body, { idToken });
  assert.equal(app.window.AdmissionAccount.isVerified(), true);
  assert.equal('localStorage' in call, false);
  assert.equal(app.window.localStorage.length, 0);
  assert.equal(app.window.sessionStorage.length, 0);
  app.dom.window.close();
});

test('Google canary requests the explicit server-authorized config only from the opt-in URL', async () => {
  const clientId = '123456789012-exampleclientidentifier.apps.googleusercontent.com';
  const app = setup({
    pageUrl: 'https://admissionhub.pages.dev/?googleCanary=1',
    methods: { google: { available: true, clientId } }
  });
  await waitFor(() => app.calls.some(call => call.path.endsWith('/config?googleCanary=1')));
  await waitFor(() => app.document.querySelector('[data-role="google-button"] button'));
  assert.equal(app.document.querySelector('[data-role="preferred-methods"]').hidden, false);
  assert.equal(app.window.localStorage.length, 0);
  assert.equal(app.window.sessionStorage.length, 0);
  app.dom.window.close();
});

test('Passkey canary requests the explicit server-authorized config only from the opt-in URL', async () => {
  const app = setup({
    pageUrl: 'https://admissionhub.pages.dev/?passkeyCanary=1',
    methods: { passkey: { available: true } },
    passkeyCredentials: {
      async get() { throw new Error('not used'); },
      async create() { throw new Error('not used'); }
    }
  });
  await waitFor(() => app.calls.some(call => call.path.endsWith('/config?passkeyCanary=1')));
  assert.equal(app.document.querySelector('[data-role="passkey-login"]').hidden, false);
  assert.equal(app.window.localStorage.length, 0);
  assert.equal(app.window.sessionStorage.length, 0);
  app.dom.window.close();
});

test('Telegram canary forwards the exact opt-in query to config, request, and verification only', async () => {
  const interaction = {
    type: 'telegram-link',
    url: `https://t.me/AdmissionHubCanaryBot?start=${'T'.repeat(43)}`,
    proof: 'local-code-required',
    identityKind: 'telegram-account',
    phoneOwnership: false
  };
  const app = setup({
    signed: true,
    pageUrl: 'https://admissionhub.pages.dev/?telegramCanary=1',
    methods: { backup: { available: true, genericFlow: true, contactInput: 'none' } },
    backupInteraction: interaction
  });
  await waitFor(() => app.calls.some(call => call.path.endsWith('/config?telegramCanary=1')));
  await waitFor(() => app.document.querySelector('[data-role="backup-start"]')?.hidden === false);
  app.window.AdmissionAccount.open();
  app.document.querySelector('[data-role="backup-start"]').click();
  await waitFor(() => app.calls.some(call => call.path.endsWith('/backup/request?telegramCanary=1')));
  await waitFor(() => app.document.querySelector('[data-view="backup"]').hidden === false);
  app.document.querySelector('#ah-backup-code').value = '654321';
  app.document.querySelector('[data-view="backup"]').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => app.calls.some(call => call.path.endsWith('/backup/verify?telegramCanary=1')));
  assert.equal(app.window.localStorage.length, 0);
  assert.equal(app.window.sessionStorage.length, 0);
  app.dom.window.close();
});

test('Passkey login converts WebAuthn binary fields and authenticates only after server finish', async () => {
  let requestedOptions = null;
  const assertion = {
    rawId: bytes(1, 2, 3),
    response: {
      clientDataJSON: bytes(4, 5, 6),
      authenticatorData: bytes(7, 8, 9),
      signature: bytes(10, 11, 12),
      userHandle: bytes(13, 14)
    }
  };
  const app = setup({
    methods: { passkey: { available: true } },
    passkeyCredentials: {
      async get(options) { requestedOptions = options; return assertion; },
      async create() { throw new Error('not used'); }
    }
  });
  await waitFor(() => app.document.querySelector('[data-role="passkey-login"]')?.hidden === false);
  app.window.AdmissionAccount.open();
  app.document.querySelector('[data-role="passkey-login"]').click();
  await waitFor(() => app.calls.some(call => call.path.endsWith('/passkey/authentication/finish')));
  assert.equal(requestedOptions.publicKey.challenge.byteLength, 32);
  const finish = app.calls.find(call => call.path.endsWith('/passkey/authentication/finish'));
  assert.equal(finish.body.challengeId, 'passkey-challenge-login');
  assert.equal(finish.body.response.rawId, 'AQID');
  assert.equal(finish.body.response.signature, 'CgsM');
  assert.equal(app.window.AdmissionAccount.isVerified(), true);
  app.dom.window.close();
});

test('signed user can enroll and remove an optional Passkey without changing Firebase UID', async () => {
  const registration = {
    rawId: bytes(21, 22),
    response: {
      clientDataJSON: bytes(23, 24),
      attestationObject: bytes(25, 26),
      getTransports: () => ['internal']
    }
  };
  const app = setup({
    signed: true,
    methods: { passkey: { available: true } },
    passkeyCredentials: {
      async get() { throw new Error('not used'); },
      async create() { return registration; }
    }
  });
  await waitFor(() => app.calls.some(call => call.path.endsWith('/passkey/status')));
  app.window.AdmissionAccount.open();
  await waitFor(() => app.document.querySelector('[data-role="passkey-add"]')?.hidden === false);
  app.document.querySelector('[data-role="passkey-add"]').click();
  await waitFor(() => app.calls.some(call => call.path.endsWith('/passkey/registration/finish')));
  const finish = app.calls.find(call => call.path.endsWith('/passkey/registration/finish'));
  assert.equal(finish.body.response.rawId, 'FRY');
  assert.deepEqual(finish.body.response.transports, ['internal']);
  assert.equal(app.window.AdmissionAccount.getSession().user.id, 'usr-ui');
  app.dom.window.close();
});

test('successful verification offers optional Passkey setup and Skip never blocks the account', async () => {
  const clientId = '123456789012-exampleclientidentifier.apps.googleusercontent.com';
  const registration = {
    rawId: bytes(31, 32),
    response: {
      clientDataJSON: bytes(33, 34),
      attestationObject: bytes(35, 36),
      getTransports: () => ['internal']
    }
  };
  const app = setup({
    methods: { google: { available: true, clientId }, passkey: { available: true } },
    passkeyCredentials: {
      async get() { throw new Error('not used'); },
      async create() { return registration; }
    }
  });
  await waitFor(() => app.document.querySelector('[data-role="google-button"] button'));
  app.window.AdmissionAccount.open();
  app.googleCredential(`google-id-${'p'.repeat(32)}`);
  await waitFor(() => app.document.querySelector('[data-view="security-setup"]').hidden === false);
  assert.match(app.document.querySelector('[data-view="security-setup"]').textContent, /Create Passkey/);
  assert.match(app.document.querySelector('[data-role="setup-skip"]').textContent, /পরে করব/);
  app.document.querySelector('[data-role="setup-passkey"]').click();
  await waitFor(() => app.calls.some(call => call.path.endsWith('/passkey/registration/finish')));
  await waitFor(() => app.document.querySelector('[data-view="signed"]').hidden === false);
  assert.equal(app.window.AdmissionAccount.isVerified(), true);
  app.dom.window.close();

  const skipped = setup({
    methods: { google: { available: true, clientId }, passkey: { available: true } },
    passkeyCredentials: {
      async get() { throw new Error('not used'); },
      async create() { throw new Error('must not be called'); }
    }
  });
  await waitFor(() => skipped.document.querySelector('[data-role="google-button"] button'));
  skipped.window.AdmissionAccount.open();
  skipped.googleCredential(`google-id-${'s'.repeat(32)}`);
  await waitFor(() => skipped.document.querySelector('[data-view="security-setup"]').hidden === false);
  skipped.document.querySelector('[data-role="setup-skip"]').click();
  assert.equal(skipped.document.querySelector('[data-view="signed"]').hidden, false);
  assert.equal(skipped.calls.some(call => call.path.endsWith('/passkey/registration/begin')), false);
  skipped.dom.window.close();
});

test('generic backup UX is hidden when unavailable and contains no provider-specific branching', async () => {
  const disabled = setup({ signed: true });
  await waitFor(() => disabled.document.querySelector('[data-role="backup-start"]'));
  assert.equal(disabled.document.querySelector('[data-role="backup-start"]').hidden, true);
  disabled.dom.window.close();

  const enabled = setup({ signed: true, methods: { backup: { available: true, genericFlow: true } } });
  await waitFor(() => enabled.document.querySelector('[data-role="backup-start"]')?.hidden === false);
  enabled.window.AdmissionAccount.open();
  enabled.document.querySelector('[data-role="backup-start"]').click();
  await waitFor(() => enabled.document.querySelector('[data-view="backup"]').hidden === false);
  enabled.document.querySelector('#ah-backup-code').value = '123456';
  enabled.document.querySelector('[data-view="backup"]').dispatchEvent(new enabled.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => enabled.calls.some(call => call.path.endsWith('/backup/verify')));
  const requestCall = enabled.calls.find(call => call.path.endsWith('/backup/request'));
  const verifyCall = enabled.calls.find(call => call.path.endsWith('/backup/verify'));
  assert.deepEqual(requestCall.body, { purpose: 'account-backup' });
  assert.equal(verifyCall.body.code, '123456');
  assert.doesNotMatch(script, /otp-a|otp-b|otp-c|mailjet|brevo|sendgrid/i);
  enabled.dom.window.close();
});

test('generic backup accepts a server-requested phone input without exposing an internal provider name', async () => {
  const app = setup({ signed: true, methods: { backup: { available: true, genericFlow: true, contactInput: 'required' } } });
  await waitFor(() => app.document.querySelector('[data-role="backup-start"]')?.hidden === false);
  app.window.AdmissionAccount.open();
  app.document.querySelector('[data-role="backup-start"]').click();
  await waitFor(() => app.document.querySelector('[data-view="backup-prepare"]').hidden === false);
  app.document.querySelector('#ah-backup-contact').value = '+8801700000000';
  app.document.querySelector('[data-view="backup-prepare"]').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => app.calls.some(call => call.path.endsWith('/backup/request')));
  assert.deepEqual(app.calls.find(call => call.path.endsWith('/backup/request')).body, {
    purpose: 'account-backup', contact: '+8801700000000'
  });
  assert.doesNotMatch(app.document.querySelector('[data-view="backup-prepare"]').textContent, /otp-a|mailjet|brevo|sendgrid|whatsapp/i);
  app.dom.window.close();
});

test('Telegram interaction requires the bot OTP and sends no link token back for verification', async () => {
  const linkToken = 'T'.repeat(43);
  const interaction = {
    type: 'telegram-link',
    url: `https://t.me/AdmissionHubVerifyBot?start=${linkToken}`,
    proof: 'local-code-required',
    identityKind: 'telegram-account',
    phoneOwnership: false
  };
  const app = setup({ signed: true, methods: { backup: { available: true, genericFlow: true } }, backupInteraction: interaction });
  await waitFor(() => app.document.querySelector('[data-role="backup-start"]')?.hidden === false);
  app.window.AdmissionAccount.open();
  app.document.querySelector('[data-role="backup-start"]').click();
  await waitFor(() => app.document.querySelector('[data-view="backup"]').hidden === false);
  assert.equal(app.document.querySelector('[data-role="backup-link"]').href, interaction.url);
  assert.match(app.document.querySelector('[data-role="backup-interaction"]').textContent, /খোলা সফল যাচাই নয়/);
  assert.match(app.document.querySelector('[data-role="backup-interaction"]').textContent, /Email মালিকানার প্রমাণও নয়/);
  app.document.querySelector('#ah-backup-code').value = '654321';
  app.document.querySelector('[data-view="backup"]').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => app.calls.some(call => call.path.endsWith('/backup/verify')));
  const body = app.calls.find(call => call.path.endsWith('/backup/verify')).body;
  assert.deepEqual(body, {
    attemptId: 'backup-attempt-123456789012345',
    purpose: 'account-backup',
    code: '654321'
  });
  assert.equal(JSON.stringify(body).includes(linkToken), false);
  app.dom.window.close();
});
