import test from 'node:test';
import assert from 'node:assert/strict';
import {
  maskAlertEmail,
  renderSecurityAlert,
  sendSecurityAlert,
  sendSecurityAlertInBackground,
  SECURITY_ALERT_EVENTS
} from './auth-native/core/security-alerts.mjs';

const env = { TG_BOT_TOKEN: 'test-token-not-real', TG_CHAT_ID: '123456' };

test('an email is masked before it reaches the owner', () => {
  assert.equal(maskAlertEmail('student@example.com'), 's******@example.com');
  assert.equal(maskAlertEmail('a@example.com'), 'a***@example.com');
  assert.equal(maskAlertEmail('NOT-AN-EMAIL'), '');
  assert.equal(maskAlertEmail(''), '');
});

test('a canary alert names the event and the masked account', () => {
  const rendered = renderSecurityAlert({ event: SECURITY_ALERT_EVENTS.CANARY_HIT, email: 'admin@example.com' });
  assert.ok(rendered);
  assert.ok(rendered.text.includes('ক্যানারি'));
  assert.ok(rendered.text.includes('a****@example.com'));
  assert.ok(!rendered.text.includes('admin@example.com'), 'the raw address must never be in the message');
});

test('a shadow-ban alert carries the band and the reasons', () => {
  const rendered = renderSecurityAlert({
    event: SECURITY_ALERT_EVENTS.SHADOW_BAN,
    email: 'student@example.com',
    band: 'high',
    reasons: ['new-device', 'country-changed'],
    at: 1_700_000_000_000
  });
  assert.ok(rendered.text.includes('high'));
  assert.ok(rendered.text.includes('new-device, country-changed'));
  assert.ok(rendered.text.includes('2023-11-14'));
});

test('an unknown event renders nothing', () => {
  assert.equal(renderSecurityAlert({ event: 'made-up' }), null);
  assert.equal(renderSecurityAlert({}), null);
});

test('control characters are stripped from an attacker-controlled field', () => {
  const rendered = renderSecurityAlert({
    event: SECURITY_ALERT_EVENTS.NEW_DEVICE,
    email: 'student@example.com',
    country: 'BD\u0000\u001b[31mX'
  });
  assert.ok(!/[\u0000\u001b]/.test(rendered.text));
});

test('a long reason list is capped', () => {
  const rendered = renderSecurityAlert({
    event: SECURITY_ALERT_EVENTS.SHADOW_BAN,
    reasons: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  });
  assert.ok(rendered.text.includes('a, b, c, d, e'));
  assert.ok(!rendered.text.includes('f'));
});

test('a missing secret reports not-configured and never throws', async () => {
  assert.equal(await sendSecurityAlert({}, { event: SECURITY_ALERT_EVENTS.CANARY_HIT }), 'not-configured');
  assert.equal(await sendSecurityAlert({ TG_BOT_TOKEN: 'x' }, { event: SECURITY_ALERT_EVENTS.CANARY_HIT }), 'not-configured');
});

test('a sent alert reports sent', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, body: JSON.parse(init.body) };
    return { ok: true };
  };
  const result = await sendSecurityAlert(env, { event: SECURITY_ALERT_EVENTS.CANARY_HIT, email: 'a@b.com' }, { fetchImpl });
  assert.equal(result, 'sent');
  assert.ok(seen.url.startsWith('https://api.telegram.org/bot'));
  assert.equal(seen.body.chat_id, '123456');
  assert.ok(!seen.url.includes('undefined'));
});

test('a telegram failure is a value, not an exception', async () => {
  const throwing = async () => {
    throw new Error('network down');
  };
  assert.equal(await sendSecurityAlert(env, { event: SECURITY_ALERT_EVENTS.NEW_DEVICE }, { fetchImpl: throwing }), 'failed');
  const bad = async () => ({ ok: false, status: 500 });
  assert.equal(await sendSecurityAlert(env, { event: SECURITY_ALERT_EVENTS.NEW_DEVICE }, { fetchImpl: bad }), 'failed');
});

test('the background wrapper never rejects', async () => {
  const throwing = async () => {
    throw new Error('boom');
  };
  assert.equal(await sendSecurityAlertInBackground(env, { event: SECURITY_ALERT_EVENTS.NEW_DEVICE }, { fetchImpl: throwing }), 'failed');
});
