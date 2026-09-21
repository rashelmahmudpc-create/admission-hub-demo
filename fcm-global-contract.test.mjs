/* Phase 2 — Global Notification Engine wiring contract (source-level).
 * The engine tests (fcm-global.test.mjs) cover the worker API behavior;
 * this file covers the WIRING: cron trigger, client topic subscription,
 * inbox merge, badge, click logging, admin center, and pin consistency
 * across index.html / sw.js. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const WORKER = readFileSync('gk-agent-worker.js', 'utf8');
const FCM = readFileSync('fcm-notification.mjs', 'utf8');
const WRANGLER = readFileSync('wrangler.toml', 'utf8');
const CLIENT_FCM = readFileSync('notification-fcm.js', 'utf8');
const INBOX = readFileSync('notification-inbox.js', 'utf8');
const HUB = readFileSync('notification-hub.js', 'utf8');
const SW_MSG = readFileSync('firebase-messaging-sw.js', 'utf8');
const ADMIN = readFileSync('notification-admin.js', 'utf8');
const INDEX = readFileSync('index.html', 'utf8');
const SW = readFileSync('sw.js', 'utf8');

test('worker entry: cron calls the global scheduler (try/catch, before GK)', () => {
  assert.match(WORKER, /import \{ handleFcmNotificationRequest, runScheduledGlobalNotifications \} from '\.\/fcm-notification\.mjs';/);
  assert.match(WORKER, /try \{ await runScheduledGlobalNotifications\(env\); \} catch \(_\) \{\}/, 'scheduler runs on every cron tick, fail-soft');
  const schedIdx = WORKER.indexOf('async scheduled');
  const schedBody = WORKER.slice(schedIdx);
  assert.ok(schedBody.indexOf('runScheduledGlobalNotifications') < schedBody.indexOf("get('gkDay')"), 'global scheduler runs BEFORE the date-guarded GK check');
});

test('wrangler cron: every minute (GK stays date-guarded, spec: Cloudflare Cron replaces Vercel Cron)', () => {
  assert.match(WRANGLER, /crons = \["\* \* \* \* \*"\]/);
});

test('worker exposes all 10 Phase 2 routes', () => {
  for (const p of [
    '/api/notifications/global/send',
    '/api/notifications/global/schedule',
    '/api/notifications/global/cancel',
    '/api/notifications/history',
    '/api/notifications/templates',
    '/api/notifications/topics/subscribe',
    '/api/notifications/topics/unsubscribe',
    '/api/notifications/inbox',
    '/api/notifications/read',
    '/api/notifications/click'
  ]) assert.ok(FCM.includes(`path === '${p}'`), `route ${p}`);
});

test('worker: topic-first hybrid send (no per-user loop), 500-token chunks, caps', () => {
  assert.match(FCM, /const GLOBAL_DAILY_CAP = 10;/);
  assert.match(FCM, /i \+= 500/);
  assert.ok(FCM.includes('fcmSendToTopic'), 'topic sender exists');
  assert.ok(FCM.includes('activeDevicesMissingTopic'), 'fallback targets only non-topic devices');
  assert.ok(FCM.includes("status IN ('sent','scheduled')"), 'dedup window covers sent + scheduled');
});

test('client fcm: subscribes the device to all_students after register + on refresh', () => {
  assert.match(CLIENT_FCM, /const GLOBAL_TOPIC = 'all_students';/);
  assert.match(CLIENT_FCM, /await messaging\.subscribeToTopic\(GLOBAL_TOPIC\);/);
  assert.match(CLIENT_FCM, /'\/topics\/subscribe'/);
  assert.ok(CLIENT_FCM.indexOf('await ensureTopic(messaging, token); return \'granted\'') > -1, 'topic sub on first enable');
  assert.match(CLIENT_FCM, /if \(token\) \{ await registerToken\(token\); await ensureTopic\(messaging, token\); \}/, 'topic sub refreshed on app start');
  assert.match(CLIENT_FCM, /catch \(_\) \{ \/\* server fallback covers this device \*\/ \}/, 'best-effort — never breaks enablement');
});

test('inbox v6: merges the global feed, dedupes by id, taps log read + deep link', () => {
  assert.match(INBOX, /'\/api\/notifications\/inbox'/);
  assert.ok(INBOX.includes("source: 'global'"), 'global rows are tagged');
  assert.match(INBOX, /const seen = new Set\(global\.map\(r => r\.id\)\);\s*\n\s*return \[\.\.\.global, \.\.\.local\.filter\(r => !seen\.has\(r\.id\)\)\];/, 'dedup by id');
  assert.match(INBOX, /'\/api\/notifications\/read'/, 'tap marks the global read server-side');
  assert.match(INBOX, /location\.hash = targetUrl\.replace/, 'tap deep-links (spec: click → specific page)');
});

test('hub v119: bell badge includes global unread; click logging on boot', () => {
  assert.match(HUB, /const globalUnreadCount = async/);
  assert.match(HUB, /const unread = \(await unreadCount\(\)\) \+ \(await globalUnreadCount\(\)\);/, 'badge = local + global unread');
  assert.match(HUB, /localStorage\.getItem\('ahFcmClick'\)/, 'boot reads the stored click');
  assert.match(HUB, /'\/api\/notifications\/click'/, 'boot logs the click to the API');
  assert.match(HUB, /localStorage\.removeItem\('ahFcmClick'\)/, 'click logged once');
  assert.match(HUB, /globalUnreadCount, bellTap/, 'exported');
});

test('service worker: notificationclick stores {id: gid, link} for the app', () => {
  assert.match(SW_MSG, /if \(nd\.gid\) self\.localStorage\.setItem\('ahFcmClick', JSON\.stringify\(\{ id: String\(nd\.gid\), link: route, at: Date\.now\(\) \}\)\);/);
  assert.match(SW_MSG, /event\.notification\.close\(\);/, 'closes the notification (unchanged behavior)');
});

test('admin center: token gate (sessionStorage only), 6 types, 5 audiences, live preview, confirm + cancel', () => {
  assert.ok(ADMIN.includes("const LS_KEY = 'ahAdminTok'"), 'admin token stored');
  assert.match(ADMIN, /sessionStorage\.setItem\(LS_KEY, v\)/, 'sessionStorage — never localStorage/URL');
  assert.ok(!/localStorage\.[gs]etItem\('ahAdminTok'\)/.test(ADMIN), 'token never in localStorage');
  const types = ['new-content', 'announcement', 'new-feature', 'challenge', 'course', 'important'];
  for (const k of types) assert.ok(ADMIN.includes(`'${k}': {`), `type ${k}`);
  const audiences = ['all_students', 'beginner', 'intermediate', 'pro', 'course_subscribers'];
  for (const k of audiences) assert.ok(ADMIN.includes(`${k}: {`), `audience ${k}`);
  assert.match(ADMIN, /'\/api\/notifications\/templates'/, 'templates from the API');
  assert.match(ADMIN, /'\/api\/notifications\/global\/send'/);
  assert.match(ADMIN, /'\/api\/notifications\/global\/schedule'/);
  assert.match(ADMIN, /'\/api\/notifications\/global\/cancel'/);
  assert.match(ADMIN, /'\/api\/notifications\/history'/);
  assert.match(ADMIN, /Estimated reach|Estimated reach:|confirmReach/, 'confirm shows estimated reach');
  assert.match(ADMIN, /gn-center-confirm/, 'confirmation modal');
  assert.match(ADMIN, /Asia\/Dhaka/, 'schedule labelled Asia/Dhaka');
  assert.match(ADMIN, /Authorization: `Bearer \$\{tok\(\)\}`/, 'every admin call carries the Bearer token');
});

test('index.html: admin script tag + route dispatch (hidden route, not in nav)', () => {
  assert.match(INDEX, /<script defer src="\.\/notification-admin\.js\?v=admin-notif-v2"><\/script>/);
  assert.match(INDEX, /if\(p==='notif-admin' && window\.renderNotificationAdmin\) return window\.renderNotificationAdmin\(\);/);
});

test('pin consistency: index.html script pins match sw.js cache entries + digests', () => {
  const pins = {
    'notification-fcm.js': 'fcm-p1-v9',
    'notification-inbox.js': 'notif-inbox-v6',
    'notification-hub.js': 'notify-v119',
    'notification-admin.js': 'admin-notif-v2'
  };
  for (const [file, pin] of Object.entries(pins)) {
    assert.match(INDEX, new RegExp(`<script defer src="\\./${file}\\?v=${pin}">`), `${file} pin in index.html`);
  }
  /* shell-precached subset (the hub is not in APP_SHELL by design) */
  for (const file of ['notification-fcm.js', 'notification-inbox.js', 'notification-admin.js']) {
    assert.ok(SW.includes(`'./${file}?v=${pins[file]}'`), `${file} pin in sw.js APP_SHELL`);
  }
  /* digests must exist for the shell-cached files */
  for (const file of ['notification-fcm.js', 'notification-inbox.js', 'notification-admin.js']) {
    const pin = pins[file];
    assert.match(SW, new RegExp(`"./${file}\\?v=${pin}": "[0-9a-f]{64}"`), `digest for ${file}`);
  }
  /* shell canary bumped together in both files */
  assert.match(INDEX, /v281-auth-error-20260918/g);
  assert.match(SW, /const BUILD_ID = 'v281-auth-error-20260918';/);
  assert.ok((INDEX.match(/v281-auth-error-20260918/g) || []).length >= 3, 'canary pinned in index.html (register + SW check)');
});

test('sw-manifest digest of the admin file is correct', () => {
  const m = SW.match(/"\/?\.\/notification-admin\.js\?v=admin-notif-v2": "([0-9a-f]{64})"/);
  assert.ok(m, 'digest present');
  const actual = createHash('sha256').update(readFileSync('notification-admin.js')).digest('hex');
  assert.equal(m[1], actual, 'digest matches the file on disk');
});
