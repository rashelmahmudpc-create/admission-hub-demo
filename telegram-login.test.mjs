import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import {
  isTelegramLoginEmail, reservedTelegramLoginEmail, telegramLoginBotId, telegramLoginCredentials,
  telegramLoginReady, verifyTelegramLogin
} from './auth-native/verification/telegram-login.mjs';

const env = { TG_BOT_TOKEN: '1234567:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', AUTH_HMAC_SECRET: 'x'.repeat(48) };
const sign = (data, token = env.TG_BOT_TOKEN) => {
  const check = Object.keys(data).sort().map(k => `${k}=${data[k]}`).join('\n');
  const secret = createHash('sha256').update(token).digest();
  return { ...data, hash: createHmac('sha256', secret).update(check).digest('hex') };
};
const now = 1_800_000_000_000;
const fresh = { id: 42, first_name: 'Rahim', username: 'rahim', auth_date: Math.floor(now / 1000) - 5 };

test('a payload signed for the bot is accepted', async () => {
  const user = await verifyTelegramLogin(sign(fresh), env, { now });
  assert.equal(user.id, '42');
  assert.equal(user.displayName, 'Rahim');
});

test('tampered, foreign-bot and expired payloads are refused', async () => {
  await assert.rejects(verifyTelegramLogin({ ...sign(fresh), id: 43 }, env, { now }));
  await assert.rejects(verifyTelegramLogin(sign(fresh, '7654321:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'), env, { now }));
  await assert.rejects(verifyTelegramLogin(sign({ ...fresh, auth_date: Math.floor(now / 1000) - 3600 }), env, { now }));
  await assert.rejects(verifyTelegramLogin({ id: 42 }, env, { now }));
});

test('one stable, unguessable Firebase account per Telegram user', async () => {
  const a = await telegramLoginCredentials('42', env);
  const b = await telegramLoginCredentials('42', env);
  const c = await telegramLoginCredentials('43', env);
  assert.deepEqual(a, b);
  assert.notEqual(a.email, c.email);
  assert.ok(reservedTelegramLoginEmail(a.email));
  assert.equal(await isTelegramLoginEmail(a.email, env), true);
  assert.equal(await isTelegramLoginEmail(a.email.replace(/\.[0-9a-f]{4}/, '.0000'), env), false);
  assert.equal(await isTelegramLoginEmail('student@gmail.com', env), false);
});

test('readiness needs the bot token and the HMAC root secret', () => {
  assert.equal(telegramLoginReady(env), true);
  assert.equal(telegramLoginBotId(env), '1234567');
  assert.equal(telegramLoginReady({ AUTH_HMAC_SECRET: env.AUTH_HMAC_SECRET }), false);
  assert.equal(telegramLoginReady({ ...env, TELEGRAM_LOGIN_ACTIVATION: 'disabled' }), false);
});

test('UI: Telegram replaces Facebook and the Telegram verification choice is gone', () => {
  const account = readFileSync('account-access.js', 'utf8');
  assert.match(account, /data-role="welcome-telegram-button"/);
  assert.doesNotMatch(account, /data-role="welcome-facebook-button"/);
  assert.match(account, /state\.capabilities\.telegram = \{ available: false \};/);
  assert.match(account, /oauth\.telegram\.org\/auth/);
  assert.match(account, /await finishTelegramLogin\(\);/);
  const story = readFileSync('welcome-story.js', 'utf8');
  assert.match(story, /<\/i>Telegram<\/button>/);
  assert.doesNotMatch(story, /<\/i>Facebook<\/button>/);
  const sky = readFileSync('sky-onboarding.js', 'utf8');
  assert.match(sky, /data-m="telegram" type="button" hidden/);
  assert.match(sky, /api\.telegram/);
  const server = readFileSync('auth-native/worker/public-auth-handler.mjs', 'utf8');
  assert.match(server, /\/telegram\/login`\)/);
  assert.match(server, /reservedTelegramLoginEmail\(input\.email\)/);
});
