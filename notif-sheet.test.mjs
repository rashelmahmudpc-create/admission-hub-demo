/* Compact notification sheet (owner bug-fix 2026-09-16) — source contract.
 * 1) Dashboard bell must open the sheet, never navigate to history.
 * 2) The sheet is compact: FCM + master + close; official concise FCM copy
 *    in BOTH languages (bn + en) for the dual-language rule. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HUB = readFileSync('notification-hub.js', 'utf8');
const DASH = readFileSync('dashboard-v2.js', 'utf8');

test('dashboard bell: bellTap (inbox/one-time sheet), never history', () => {
  assert.match(DASH, /dv2-bell[^>]*onclick="NotificationHub\.bellTap\(\)"/, 'bell → bellTap (round 2)');
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

/* ── Round 2 (owner directive 2026-09-17): full-screen inbox + one-time prompt + iOS fix ── */

const INBOX = readFileSync('notification-inbox.js', 'utf8');
const WORKER_SRC = readFileSync('fcm-notification.mjs', 'utf8');
const PROFILE = readFileSync('profile-ui.js', 'utf8');
const INDEX = readFileSync('index.html', 'utf8');
const SW = readFileSync('sw.js', 'utf8');
const FCM = readFileSync('notification-fcm.js', 'utf8');

test('bell uses bellTap: registered→inbox, else one-time sheet, then inbox', () => {
  assert.match(DASH, /dv2-bell[^>]*onclick="NotificationHub\.bellTap\(\)"/, 'bell → NotificationHub.bellTap()');
  assert.match(HUB, /const bellTap = async/);
  assert.match(HUB, /location\.hash = 'notifications'/, 'goInbox navigates to #notifications');
  assert.match(HUB, /ahNotifPromptShown/, 'prompt-once flag');
  const bell = HUB.slice(HUB.indexOf('const bellTap'), HUB.indexOf('const markOneRead'));
  assert.ok(bell.includes("localStorage.getItem('ahNotifPromptShown')"), 'reads the one-time flag');
  assert.ok(bell.includes("localStorage.setItem('ahNotifPromptShown', '1')"), 'marks the flag when shown');
  assert.ok(bell.includes('openSheet()'), 'shows the sheet on first tap only');
});

test('inbox: full-screen page, All/Unread tabs, back to dashboard, dual language, real data', () => {
  assert.match(INBOX, /window\.renderNotificationsInbox = function renderNotificationsInbox/);
  assert.match(INBOX, /location\.hash='dashboard'/, 'back button returns to dashboard');
  assert.match(INBOX, /nif-tab[^>]*onclick="window\.__nifTab\('all'\)"/, 'All tab');
  assert.match(INBOX, /nif-tab[^>]*onclick="window\.__nifTab\('unread'\)"/, 'Unread tab');
  assert.match(INBOX, /app\.classList\.add\('no-nav'\)/, 'full-screen (nav hidden)');
  assert.ok(INBOX.includes("bn: 'সব'") && INBOX.includes("en: 'All'"), 'All tab dual language');
  assert.ok(INBOX.includes("bn: 'অপঠিত'") && INBOX.includes("en: 'Unread'"), 'Unread tab dual language');
  assert.ok(INBOX.includes("bn: 'নোটিফিকেশন'") && INBOX.includes("en: 'Notifications'"), 'title dual language');
  assert.match(INBOX, /hub\._log\(\)/, 'data from the hub log (real data only)');
  assert.match(INBOX, /hub\.markOneRead\(id\)/, 'tap marks a row read');
  assert.match(INBOX, /inboxPushToggle\(\)/, 'push-off banner uses the gesture-safe toggle');
});

test('router: #notifications route + script tag + SW pin', () => {
  assert.match(INDEX, /p==='notifications' && window\.renderNotificationsInbox/);
  assert.match(INDEX, /notification-inbox\.js\?v=notif-inbox-v3/);
  assert.match(INDEX, /notification-hub\.js\?v=notify-v117/);
  assert.match(INDEX, /notification-fcm\.js\?v=fcm-p1-v7/);
  assert.match(INDEX, /profile-ui\.js\?v=profile-v15-nonotif/);
  assert.match(SW, /notification-inbox\.js\?v=notif-inbox-v3/);
  assert.match(SW, /dashboard-v2\.js\?v=dash2f15-inbox/);
});

test('iOS fix: permission ask runs before any network await (hub + fcm)', () => {
  const toggle = HUB.slice(HUB.indexOf('const doPushToggle'), HUB.indexOf('const fcmSheetToggle'));
  const ask = toggle.indexOf('Notification.requestPermission()');
  const status = toggle.indexOf('await window.AhFcm.status()');
  assert.ok(ask !== -1 && status !== -1, 'both calls present in doPushToggle');
  assert.ok(ask < status, 'requestPermission() BEFORE the status() network await');
  const enable = FCM.slice(FCM.indexOf('const enable'), FCM.indexOf('const disable'));
  const fcmAsk = enable.indexOf('Notification.requestPermission()');
  const fcmCfg = enable.indexOf('await getConfig()');
  assert.ok(fcmAsk !== -1 && fcmCfg !== -1, 'both calls present in enable()');
  assert.ok(fcmAsk < fcmCfg, 'requestPermission() BEFORE getConfig() in AhFcm.enable()');
});

test('profile: Notifications row removed from Preferences (owner: সরিয়ে নাও)', () => {
  assert.ok(!PROFILE.includes("row('🔔', 'Notifications'"), 'no Notifications row in profile');
  assert.ok(!PROFILE.includes('pref-notifications') || !/row\('🔔'/.test(PROFILE), 'no row with pref-notifications role');
});

test('enable() failures are specific, not a vague "try again" (2026-09-17)', () => {
  assert.match(FCM, /setErr\('config-failed', 'config request failed'\); return 'config-failed'/);
  assert.match(FCM, /setErr\('sdk-failed', errText\(e\)\); return 'sdk-failed'/);
  assert.match(FCM, /setErr\('token-failed', errText\(e\)\); return 'token-failed'/);
  assert.match(FCM, /setErr\('register-' \+ out\.status/);
  assert.match(FCM, /_state: stateGet, _config: getConfig, lastErr/, 'lastErr exported for UI');
  assert.match(FCM, /detail: detail \? String\(detail\)\.slice\(0, 200\) : undefined/, 'raw failure reason is retained');
  assert.match(HUB, /r === 'config-failed'\) toastShort\(sheetT\('errConfig'\)\)/);
  assert.match(HUB, /r === 'sdk-failed'\) toastShort\(sheetT\('errSdk'\)\)/);
  assert.match(HUB, /String\(r\)\.startsWith\('register-'\)/);
  assert.ok(HUB.includes("bn: 'সর্বশেষ সমস্যা'") && HUB.includes("en: 'Last error'"), 'sheet shows last error code');
});

test('self-service test push: no admin token, user-facing button (owner: ঝামেলা না)', () => {
  assert.match(FCM, /const selfTest = async/, 'AhFcm.selfTest client');
  assert.match(FCM, /_state: stateGet, _config: getConfig, lastErr, selfTest/);
  assert.match(HUB, /const sendSelfTest = async/);
  assert.match(HUB, /NotificationHub\.sendSelfTest\(\)/, 'sheet test button');
  assert.match(INBOX, /__nifTest\(\)/, 'inbox test button');
  assert.match(INBOX, /nif-statusbar/, 'registered status bar in inbox');
  assert.ok(HUB.includes("bn: 'টেস্ট push পাঠানো হয়েছে ✓'") && HUB.includes("en: 'Test push sent ✓'"), 'result toast dual language');
  assert.match(WORKER_SRC, /'\/api\/notifications\/self-test'/, 'worker endpoint');
  assert.match(WORKER_SRC, /FCM_WELCOME_PUSH !== 'off'/, 'welcome push on registration');
});

test('Firebase SDK self-hosted (Cloudflare stack) with gstatic fallback', () => {
  assert.match(FCM, /const SDK_LOCAL = '.\/sdk'/);
  assert.match(FCM, /try \{ return await tryLoadSdk\(SDK_LOCAL\); \}/);
  assert.match(FCM, /catch \(_\) \{ return await tryLoadSdk\(SDK_BASE\); \}/);
  assert.ok(HUB.includes("bn: 'বেশিবার চেষ্টা হয়েছে — ১ ঘণ্টা পর আবার চেষ্টা করুন'"), '429 toast bn');
  assert.ok(HUB.includes("bn: 'Login session সমস্যা — আবার login করে চেষ্টা করুন'"), '401 toast bn');
  assert.match(HUB, /r === 'register-429'\) toastShort\(sheetT\('errRate'\)/);
  assert.match(HUB, /r === 'register-401'\) toastShort\(sheetT\('errLogin'\)/);
});

test('iOS Home-Screen guidance (Apple: Push API only in installed PWA)', () => {
  assert.match(HUB, /const isIOS = \(\) =>/, 'hub detects iOS');
  assert.match(HUB, /iosInstallBody/, 'sheet has the Home-Screen instructions');
  assert.ok(HUB.includes("bn: 'iPhone-এ ওয়েব পুশ শুধু Home Screen-এ"), 'bn instruction');
  assert.ok(HUB.includes("en: 'On iPhone, web push works only when the app is on your Home Screen."), 'en instruction');
  assert.match(HUB, /toastShort\(isIOS\(\) \? sheetT\('iosToast'\) : sheetT\('blocked'\)\)/, 'unsupported-on-iOS → helpful toast, not "blocked"');
  assert.match(HUB, /s\.permission === 'unsupported'/, 'sheet row handles the unsupported state');
  assert.match(INBOX, /isIOSDevice\(\)/, 'inbox detects iOS');
  assert.match(INBOX, /nif-pushbar-ios/, 'inbox shows the iOS install banner');
  assert.ok(INBOX.includes("en: '📱 On iPhone, push needs the app on your Home Screen:"), 'inbox banner en');
  assert.ok(INBOX.includes("bn: '📱 iPhone-এ push পেতে:"), 'inbox banner bn');
});
