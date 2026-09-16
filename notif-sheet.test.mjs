/* Compact notification sheet (owner bug-fix 2026-09-16) — source contract.
 * 1) Dashboard bell must open the sheet, never navigate to history.
 * 2) The sheet is compact: FCM + master + close; official concise FCM copy
 *    in BOTH languages (bn + en) for the dual-language rule. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HUB = readFileSync('notification-hub.js', 'utf8');
const DASH = readFileSync('dashboard-v2.js', 'utf8');

test('dashboard bell opens the notification sheet (not history)', () => {
  assert.match(DASH, /dv2-bell[^>]*onclick="NotificationHub\.openSheet\(\)"/);
  assert.ok(!/dv2-bell[^>]*navigate\('history'\)/.test(DASH), 'bell must not navigate to history');
});

test('dashboard card gear opens the sheet', () => {
  assert.match(HUB, /onclick="NotificationHub\.openSheet\(\)">⚙️<\/button>/);
});

test('sheet exists with close affordances', () => {
  assert.match(HUB, /const openSheet = async/);
  assert.match(HUB, /onclick="closeModal\(\)"[^>]*>✕<\/button>/, 'header close button');
  assert.match(HUB, /class="btn" style="width:100%[^"]*" onclick="closeModal\(\)"/, 'bottom close button');
  assert.ok(HUB.includes('toggleMasterSheet'), 'master toggle re-renders the sheet');
});

test('official concise FCM copy exists in BOTH languages', () => {
  assert.ok(HUB.includes('bn: \'আপনার ফোনে নোটিফিকেশন চালু করুন\''), 'bn official copy');
  assert.ok(HUB.includes("en: 'Turn on notifications on your phone'"), 'en official copy');
  assert.ok(HUB.includes("bn: 'নোটিফিকেশন'") && HUB.includes("en: 'Notifications'"), 'title dual language');
  assert.ok(HUB.includes("bn: 'বন্ধ করুন'") && HUB.includes("en: 'Close'"), 'close dual language');
});

test('dual language rendered via AhI18n (never both at once)', () => {
  assert.match(HUB, /AhI18n\.get\(\)/, 'sheet picks the active language');
  assert.match(HUB, /AhI18n\.apply\(document\.getElementById\('modalRoot'\)\)/, 'applies engine to the rendered sheet');
});

test('sheet options are minimal (categories/quiet-hours/cap not in the sheet)', () => {
  const sheet = HUB.slice(HUB.indexOf('const openSheet'), HUB.indexOf('const toggleMasterSheet'));
  assert.ok(!sheet.includes('CAT_LABEL'), 'no 8-category list in the compact sheet');
  assert.ok(!sheet.includes('setQuiet'), 'no quiet-hours editor in the compact sheet');
  assert.ok(!sheet.includes('setCap'), 'no daily-cap editor in the compact sheet');
});
