import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Locked 2026-10-14: the free Gmail/Apps Script backup mailer (otp-b) is bound in
// the production Worker and live-verified. These assertions exist so a later edit
// that quietly unhooks the slot — the wiring, the quota, the enabled flag, or the
// Apps Script template — fails CI instead of silently dropping 100 OTP/day.

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('otp-b wiring is present in the provider chain', () => {
  const src = read('./auth-native/verification/providers.mjs');
  assert.match(src, /env\.OTP_B_PROVIDER_APPS_SCRIPT_URL/);
  assert.match(src, /env\.OTP_B_PROVIDER_SHARED_SECRET/);
  assert.match(src, /id: 'otp-b'/);
});

test('otp-b is enabled with its slot priority', () => {
  const src = read('./auth-native/verification/config.mjs');
  assert.match(src, /'otp-b':\s*Object\.freeze\(\{[^}]*priority:\s*20/);
});

test('otp-b daily quota is declared in wrangler.toml', () => {
  const src = read('./wrangler.toml');
  assert.match(src, /^OTP_B_DAILY_QUOTA\s*=\s*"100"\s*$/m);
});

test('the compiled Worker bundle carries both otp-b bindings', () => {
  const src = read('./worker-bundle.mjs');
  assert.match(src, /env\.OTP_B_PROVIDER_APPS_SCRIPT_URL/);
  assert.match(src, /env\.OTP_B_PROVIDER_SHARED_SECRET/);
});

test('the Apps Script mailer still authenticates with an HMAC signature', () => {
  const src = read('./apps-script/Code.gs');
  assert.match(src, /SHARED_SECRET/);
  assert.match(src, /signature/i);
});
