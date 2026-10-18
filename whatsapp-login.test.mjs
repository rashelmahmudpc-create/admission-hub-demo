import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import {
  createWhatsAppStart, handleWhatsAppWebhook, isWhatsAppLoginEmail, issueWhatsAppLoginToken, readWhatsAppStartCode,
  reservedWhatsAppLoginEmail, verifyWhatsAppLoginToken, verifyWhatsAppWebhookSignature, whatsappIncomingMessages,
  whatsappLoginCredentials, whatsappLoginReady, whatsappVerifyChallenge
} from './auth-native/verification/whatsapp-login.mjs';

const env = Object.freeze({
  AUTH_HMAC_SECRET: 'x'.repeat(48),
  WHATSAPP_LOGIN_NUMBER: '+8801700000000',
  WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
  WHATSAPP_ACCESS_TOKEN: 'EAAG' + 'a'.repeat(60),
  WHATSAPP_APP_SECRET: 'f'.repeat(32),
  WHATSAPP_VERIFY_TOKEN: 'verify-token-for-tests-123'
});
const now = 1_800_000_000_000;
const signBody = (raw, secret = env.WHATSAPP_APP_SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
const inbound = (text, from = '8801811111111', name = 'Rahim') => JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ field: 'messages', value: {
    contacts: [{ wa_id: from, profile: { name } }],
    messages: [{ from, id: 'wamid.1', type: 'text', text: { body: text } }]
  } }] }]
});
const fakeFetch = () => {
  const calls = [];
  const impl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return { ok: true }; };
  return { calls, impl };
};

test('off until every secret is present (merging changes nothing live)', () => {
  assert.equal(whatsappLoginReady(env), true);
  for (const key of Object.keys(env)) {
    const partial = { ...env }; delete partial[key];
    assert.equal(whatsappLoginReady(partial), false, `missing ${key}`);
  }
  assert.equal(whatsappLoginReady({ ...env, WHATSAPP_LOGIN_ACTIVATION: 'disabled' }), false);
});

test('start link is a wa.me deep link with a signed, expiring code', async () => {
  const start = await createWhatsAppStart(env, { now });
  assert.match(start.url, /^https:\/\/wa\.me\/8801700000000\?text=/);
  assert.equal(await readWhatsAppStartCode(start.text, env, { now }), true);
  assert.equal(await readWhatsAppStartCode(start.text, env, { now: now + 16 * 60 * 1000 }), false, 'expired');
  assert.equal(await readWhatsAppStartCode(start.text.replace(/-([0-9a-f])/, '-0'), env, { now }), false, 'tampered');
  assert.equal(await readWhatsAppStartCode('hello', env, { now }), false);
  assert.equal(await readWhatsAppStartCode(start.text, { ...env, AUTH_HMAC_SECRET: 'y'.repeat(48) }, { now }), false, 'other secret');
});

test('login token: valid, tampered, expired', async () => {
  const token = await issueWhatsAppLoginToken('8801811111111', env, { name: 'Rahim', now });
  const user = await verifyWhatsAppLoginToken(token, env, { now });
  assert.equal(user.phone, '8801811111111');
  assert.equal(user.displayName, 'Rahim');
  await assert.rejects(verifyWhatsAppLoginToken(token.slice(0, -1) + (token.endsWith('0') ? '1' : '0'), env, { now }));
  await assert.rejects(verifyWhatsAppLoginToken(token, env, { now: now + 11 * 60 * 1000 }), /EXPIRED/);
  await assert.rejects(verifyWhatsAppLoginToken('garbage', env, { now }));
  const forged = Buffer.from(JSON.stringify({ p: '8801999999999', e: now / 1000 + 60, n: '', r: '00' })).toString('base64url');
  await assert.rejects(verifyWhatsAppLoginToken(`${forged}.${'0'.repeat(32)}`, env, { now }));
});

test('one stable, unguessable Firebase account per phone; phone not in the email', async () => {
  const a = await whatsappLoginCredentials('8801811111111', env);
  const b = await whatsappLoginCredentials('+8801811111111', env);
  const c = await whatsappLoginCredentials('8801822222222', env);
  assert.deepEqual(a, b);
  assert.notEqual(a.email, c.email);
  assert.ok(!a.email.includes('8801811111111'));
  assert.ok(reservedWhatsAppLoginEmail(a.email));
  assert.equal(await isWhatsAppLoginEmail(a.email, env), true);
  assert.equal(await isWhatsAppLoginEmail(a.email.replace(/\.([0-9a-f]{4})/, '.0000'), env), false);
  assert.equal(await isWhatsAppLoginEmail('wa.' + '1'.repeat(24) + '.' + '2'.repeat(16) + '@whatsapp.admissionsky.pages.dev', env), false);
  assert.equal(await isWhatsAppLoginEmail('student@gmail.com', env), false);
});

test('webhook handshake only answers the right verify token', () => {
  const url = token => new URL(`https://x.dev/api/auth/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=12345`);
  assert.equal(whatsappVerifyChallenge(url(env.WHATSAPP_VERIFY_TOKEN), env), '12345');
  assert.equal(whatsappVerifyChallenge(url('wrong-token-wrong-token-12'), env), null);
});

test('webhook: signed START message gets a free reply with a working login link', async () => {
  const start = await createWhatsAppStart(env, { now });
  const raw = inbound(start.text);
  const { calls, impl } = fakeFetch();
  const result = await handleWhatsAppWebhook(raw, signBody(raw), env, { now, fetchImpl: impl });
  assert.equal(result.sent, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /graph\.facebook\.com\/v\d+\.\d\/123456789012345\/messages$/);
  assert.equal(calls[0].body.type, 'text', 'free-form reply, never a paid template');
  assert.equal(calls[0].body.to, '8801811111111');
  const link = /https:\/\/admissionhub\.pages\.dev\/\?waLogin=(\S+)/.exec(calls[0].body.text.body);
  assert.ok(link, 'reply contains the login link');
  const user = await verifyWhatsAppLoginToken(link[1], env, { now });
  assert.equal(user.phone, '8801811111111');
});

test('webhook: bad signature, foreign text and expired code send nothing', async () => {
  const start = await createWhatsAppStart(env, { now });
  const raw = inbound(start.text);
  const { calls, impl } = fakeFetch();
  assert.equal((await handleWhatsAppWebhook(raw, signBody(raw, 'e'.repeat(32)), env, { now, fetchImpl: impl })).forbidden, true);
  assert.equal((await handleWhatsAppWebhook(raw, '', env, { now, fetchImpl: impl })).forbidden, true);
  const hello = inbound('hello');
  assert.equal((await handleWhatsAppWebhook(hello, signBody(hello), env, { now, fetchImpl: impl })).sent, 0);
  assert.equal((await handleWhatsAppWebhook(raw, signBody(raw), env, { now: now + 20 * 60 * 1000, fetchImpl: impl })).sent, 0);
  assert.equal(calls.length, 0);
  assert.equal(await verifyWhatsAppWebhookSignature(raw, signBody(raw), env), true);
});

test('webhook parser ignores statuses and non-text messages', () => {
  const payload = { entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'x' }], messages: [{ from: '8801811111111', type: 'image' }] } }] }] };
  assert.deepEqual(whatsappIncomingMessages(payload), []);
  assert.deepEqual(whatsappIncomingMessages(null), []);
});

test('wiring: server routes, reserved domain, rate slot, UI bridge and Welcome button', () => {
  const server = readFileSync('auth-native/worker/public-auth-handler.mjs', 'utf8');
  assert.match(server, /\/whatsapp\/webhook`/);
  assert.match(server, /\/whatsapp\/start`\)/);
  assert.match(server, /\/whatsapp\/login`\)/);
  assert.match(server, /reservedWhatsAppLoginEmail\(input\.email\)/);
  assert.match(server, /isWhatsAppLoginEmail\(user\.email, env\)/);
  assert.match(server, /whatsappLogin: available && whatsappLoginReady\(env\)/);
  assert.match(readFileSync('auth-native/core/auth-engine.mjs', 'utf8'), /'whatsapp-login': Object\.freeze\(\[/);
  assert.match(readFileSync('auth-native/core/errors.mjs', 'utf8'), /WHATSAPP_LOGIN_INVALID: 'WHATSAPP_LOGIN_INVALID'/);
  const account = readFileSync('account-access.js', 'utf8');
  assert.match(account, /await finishWhatsAppLogin\(\);/);
  assert.match(account, /whatsapp: async \(\) => signInWithWhatsApp\(\),/);
  assert.match(account, /whatsappLogin: Boolean\(state\.capabilities\.whatsappLogin\?\.available\),/);
  const story = readFileSync('welcome-story.js', 'utf8');
  assert.match(story, /data-wa-login/);
  assert.match(story, /<\/i>Telegram<\/button>/, 'Telegram button stays');
});
