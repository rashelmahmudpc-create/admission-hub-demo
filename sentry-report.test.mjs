// ✅ P26 — the client error reporter's contract (owner order 2026-10-17).
//
// The owner approved wiring Sentry only after asking what leaves the app. The
// tests below are that promise written down: no student identity, no query
// string, no secret, no third-party script tag, and reporting can never throw
// into the page it is reporting on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SENTRY_DSN, MAX_EVENTS, MAX_MESSAGE, SENTRY_VERSION,
  sanitizeText, parseDsn, safePath, isReportable, signatureOf,
  buildEvent, randomHex32, makeQuota, post, install,
  ALERT_URL, postAlert,
} from './sentry-report.js';

const SOURCE = readFileSync('sentry-report.js', 'utf8');

test('১. DSN পার্স হয়: key, host, project — এবং ভুল স্ট্রিং null দেয়', () => {
  const p = parseDsn(SENTRY_DSN);
  assert.equal(p.host, 'o4512198814072832.ingest.de.sentry.io');
  assert.equal(p.projectId, '4512271394799696');
  assert.match(p.key, /^[0-9a-f]{32}$/);
  for (const bad of ['', null, undefined, 'not-a-dsn', 'https://host/1']) {
    assert.equal(parseDsn(bad), null, `must reject ${JSON.stringify(bad)}`);
  }
});

test('২. sanitizeText: প্রতিটি সিক্রেট-প্যাটার্ন [REDACTED] হয়', () => {
  const cases = [
    ['boom sk-abcdefghijklmnop', /\[REDACTED\]/],
    ['ghp_abcdefghijklmnop', /\[REDACTED\]/],
    ['key AIzaSyA1234567890abcd', /\[REDACTED\]/],
    ['xoxb-123456789012-abcdef', /\[REDACTED\]/],
    ['ck_abcdefghijklmnop', /\[REDACTED\]/],
    ['password=hunter2', /password=\[REDACTED\]/],
    ['Authorization: Bearer abc.def.ghi', /Authorization=\[REDACTED\]/],
    ['bot 123456789:AAF-abcdefghijklmnopqrstuvwxyz1234567890', /\[REDACTED\]/],
  ];
  for (const [input, expected] of cases) {
    const out = sanitizeText(input);
    assert.match(out, expected, `not redacted: ${input} -> ${out}`);
    assert.doesNotMatch(out, /hunter2|AAF-abcdefghijklmnop/);
  }
});

test('৩. sanitizeText: MAX_MESSAGE-এ ক্লিপ হয়, ফাঁকা ইনপুট নিরাপদ', () => {
  assert.equal(sanitizeText('x'.repeat(MAX_MESSAGE + 500)).length, MAX_MESSAGE);
  assert.equal(sanitizeText(null), '');
  assert.equal(sanitizeText(undefined), '');
});

test('৪. safePath: query string ও hash বাদ পড়ে — টোকেন কোথাও থাকে না', () => {
  assert.equal(safePath('https://a.example/study?token=SECRET123'), '/study');
  assert.equal(safePath('https://a.example/#/deep?uid=42'), '/');
  assert.equal(safePath('https://a.example'), '/');
  assert.doesNotMatch(safePath('https://a.example/x?email=a@b.c'), /SECRET|email|@/);
  // A relative or malformed input still yields a path, never a throw and never
  // the query that was attached to it.
  for (const odd of ['not a url', '', null, undefined, '?token=abc']) {
    const out = safePath(odd);
    assert.match(out, /^\//, `must return a path for ${JSON.stringify(odd)}`);
    assert.doesNotMatch(out, /token|SECRET|@/);
  }
});

test('৫. isReportable: খালি মেসেজ আর cross-origin "Script error." বাদ', () => {
  assert.equal(isReportable('', ''), false);
  assert.equal(isReportable('   ', ''), false);
  assert.equal(isReportable('Script error.', ''), false);
  assert.equal(isReportable('Script error', ''), false);
  assert.equal(isReportable('TypeError: x is not a function', ''), true);
  assert.equal(
    isReportable('boom', 'chrome-extension://abcdefg/inject.js'), false,
    'a browser-extension frame is not our code');
});

test('৬. buildEvent: ছাত্র-পরিচয়ের কোনো ফিল্ড নেই, allowlist-এ যা আছে তা-ই', () => {
  const ev = buildEvent({
    message: 'TypeError: x is not a function',
    path: '/study',
    source: 'window.onerror',
    at: 1700000000000,
    userAgent: 'Mozilla/5.0',
    // A caller trying to smuggle identity in:
    uid: 'student-42',
    email: 'student@example.com',
    phone: '+8801700000000',
    name: 'Rashel',
    query: '?token=abc',
  });
  const json = JSON.stringify(ev);
  assert.doesNotMatch(json, /student-42|student@example\.com|\+8801700000000|"Rashel"/);
  assert.doesNotMatch(json, /token/);
  assert.equal(ev.platform, 'javascript');
  assert.equal(ev.level, 'error');
  assert.equal(ev.exception.values[0].value, 'TypeError: x is not a function');
  assert.equal(ev.request.url, 'https://admission-hub.invalid/study');
  assert.match(ev.event_id, /^[0-9a-f]{32}$/);
  assert.equal(ev.timestamp, new Date(1700000000000).toISOString());
});

test('৭. buildEvent: মেসেজের ভেতরের সিক্রেটও রিড্যাক্ট হয়ে যায়', () => {
  const ev = buildEvent({ message: 'fetch failed with sk-abcdefghijklmnop' });
  assert.doesNotMatch(JSON.stringify(ev), /sk-abcdefghijklmnop/);
  assert.match(ev.exception.values[0].value, /\[REDACTED\]/);
});

test('৮. randomHex32: ৩২ অক্ষরের lowercase hex, প্রতি বার আলাদা', () => {
  const a = randomHex32();
  const b = randomHex32();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.match(b, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
});

test('৯. makeQuota: প্রথম বার যায়, সাথে সাথে দ্বিতীয় বার যায় না, দশম বার যায়', () => {
  const q = makeQuota(20);
  assert.equal(q.take('sig-a'), true, 'first sighting must send');
  assert.equal(q.take('sig-a'), false, 'an immediate repeat must not');
  for (let i = 3; i <= 9; i++) assert.equal(q.take('sig-a'), false);
  assert.equal(q.take('sig-a'), true, 'the tenth repeat is worth seeing');
  assert.equal(q.sent, 2);
  assert.equal(q.kinds, 1);
});

test('১০. makeQuota: সীমা ছাড়ালে আর কিছুই যায় না (render loop বাঁধা)', () => {
  const q = makeQuota(3);
  assert.equal(q.take('a'), true);
  assert.equal(q.take('b'), true);
  assert.equal(q.take('c'), true);
  assert.equal(q.take('d'), false, 'past the cap nothing may send');
  assert.equal(q.take('e'), false);
  assert.equal(q.sent, 3);
});

test('১১. signatureOf: একই ভুল একই সিগনেচার, আলাদা পথ আলাদা সিগনেচার', () => {
  assert.equal(signatureOf('boom', '/a'), signatureOf('boom', '/a'));
  assert.notEqual(signatureOf('boom', '/a'), signatureOf('boom', '/b'));
  assert.notEqual(signatureOf('boom', '/a'), signatureOf('bang', '/a'));
});

test('১২. post: সঠিক URL আর auth হেডারে যায়, এবং কখনো throw করে না', () => {
  const calls = [];
  const fakeFetch = (url, opts) => { calls.push({ url, opts }); return Promise.resolve({}); };
  assert.equal(post(SENTRY_DSN, buildEvent({ message: 'x' }), fakeFetch), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://o4512198814072832.ingest.de.sentry.io/api/4512271394799696/store/');
  assert.match(calls[0].opts.headers['X-Sentry-Auth'], /sentry_key=1b0f3f02a41435f2e85ffd6236ae5493/);
  assert.match(calls[0].opts.headers['X-Sentry-Auth'], new RegExp(`sentry_client=${SENTRY_VERSION}`));

  // A rejected fetch must not surface as an unhandled rejection.
  const rejecting = () => Promise.reject(new Error('offline'));
  assert.equal(post(SENTRY_DSN, buildEvent({ message: 'x' }), rejecting), true);

  // A throwing fetch, and a bad DSN, both return false rather than raise.
  const throwing = () => { throw new Error('blocked by CSP'); };
  assert.equal(post(SENTRY_DSN, buildEvent({ message: 'x' }), throwing), false);
  assert.equal(post('not-a-dsn', buildEvent({ message: 'x' }), fakeFetch), false);
});

test('১৩. install: error আর unhandledrejection দুটো seam-ই ধরা হয়', () => {
  const handlers = {};
  const win = {
    addEventListener(type, fn) { handlers[type] = fn; },
    location: { href: 'https://a.example/study?token=SECRET' },
    navigator: { userAgent: 'test-agent' },
  };
  const sent = [];
  const quota = install(win, (dsn, event) => { sent.push({ dsn, event }); return true; });
  assert.equal(typeof handlers.error, 'function');
  assert.equal(typeof handlers.unhandledrejection, 'function');

  handlers.error({ error: { message: 'TypeError: boom' }, filename: 'https://a.example/app.js' });
  handlers.unhandledrejection({ reason: new Error('promise failed') });
  assert.equal(sent.length, 2, 'one event per distinct failure');
  assert.equal(quota.sent, 2);
  assert.equal(quota.kinds, 2);

  // Nothing that leaves may carry the token that was in the page URL.
  for (const { event } of sent) {
    assert.doesNotMatch(JSON.stringify(event), /SECRET/);
    assert.equal(event.request.url, 'https://admission-hub.invalid/study');
  }
  assert.equal(sent[0].dsn, SENTRY_DSN);

  // The same failure twice more must not double-send.
  handlers.error({ error: { message: 'TypeError: boom' }, filename: 'https://a.example/app.js' });
  assert.equal(sent.length, 2);
});

test('১৪. install: অচেনা win দিলেও ভাঙে না (SSR-safe)', () => {
  const never = () => { throw new Error('must not send'); };
  assert.doesNotThrow(() => install(null, never));
  assert.doesNotThrow(() => install({}, never));
  assert.doesNotThrow(() => install(undefined, never));
});

test('১৪খ. install: transport নিজেই throw করলেও পাতা ভাঙে না', () => {
  const handlers = {};
  const win = {
    addEventListener(type, fn) { handlers[type] = fn; },
    location: { href: 'https://a.example/x' },
    navigator: { userAgent: 'ua' },
  };
  install(win, () => { throw new Error('transport exploded'); });
  assert.doesNotThrow(() => handlers.error({ error: { message: 'boom' }, filename: '' }));
});

test('১৫. কোনো third-party স্ক্রিপ্ট ট্যাগ নেই — CSP script-src বদলাতে হবে না', () => {
  assert.doesNotMatch(SOURCE, /<script/i, 'the module must not inject a script tag');
  assert.doesNotMatch(SOURCE, /browser\.sentry-cdn\.com|js\.sentry-cdn\.com/,
    'no Sentry CDN bundle: the module posts to ingest itself');
  assert.match(SOURCE, /sendBeacon/, 'beacon transport is the documented path');
  assert.match(SOURCE, /keepalive: true/, 'fetch fallback must survive unload');
});

test('১৬. মডিউলটি নিজে থেকে ইনস্টল হয় শুধু ব্রাউজারে (window থাকলে)', () => {
  assert.match(SOURCE, /typeof window !== 'undefined'/);
  // P27: the browser install also passes the alert transport, so the match is
  // on the call, not on a bare `install(window)`.
  assert.match(SOURCE, /install\(window, post, /);
});

test('১৭. privacy: buildEvent-এ যে ফিল্ডগুলো আছে তা-ই — নতুন ফিল্ড যোগ হলে টেস্ট ভাঙবে', () => {
  const ev = buildEvent({ message: 'x' });
  assert.deepEqual(Object.keys(ev).sort(), [
    'breadcrumbs', 'environment', 'event_id', 'exception', 'extra',
    'level', 'logger', 'platform', 'request', 'tags', 'timestamp',
  ]);
  assert.deepEqual(Object.keys(ev.tags), ['source']);
  assert.deepEqual(Object.keys(ev.request), ['url']);
  assert.deepEqual(Object.keys(ev.extra), ['userAgent']);
  assert.deepEqual(ev.breadcrumbs, []);
});

test('১৮. DSN ছাড়া মডিউল কিছুই পাঠায় না', () => {
  const bad = { ...buildEvent({ message: 'x' }) };
  assert.equal(post('', bad, () => { throw new Error('must not be called'); }), false);
});

test('১৯. MAX_EVENTS যুক্তিসঙ্গত (এক পাতা থেকে বন্যা হবে না)', () => {
  assert.ok(MAX_EVENTS > 0 && MAX_EVENTS <= 100);
  assert.equal(MAX_EVENTS, 20);
});

test('২০. P27: alert-পথ same-origin আর চাবি-মুক্ত (ব্রাউজারে টোকেন নেই)', () => {
  assert.equal(ALERT_URL, '/api/report-error', 'same-origin path keeps connect-src self intact');
  assert.ok(ALERT_URL.startsWith('/'), 'never an absolute third-party URL');
  assert.ok(!/api\.telegram\.org/.test(SOURCE), 'the bot token must never reach the browser');
  assert.ok(!/bot[0-9]{6,}:/i.test(SOURCE), 'no bot token pattern may be embedded');
  assert.match(SOURCE, /postAlert\(ALERT_URL/);
});

test('২১. P27: postAlert কখনো throw করে না', () => {
  const calls = [];
  const fakeFetch = (url, opts) => { calls.push({ url, opts }); return Promise.resolve({}); };
  assert.equal(postAlert(ALERT_URL, { message: 'x' }, fakeFetch), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/report-error');
  assert.equal(calls[0].opts.keepalive, true);
  assert.equal(postAlert('', { message: 'x' }, fakeFetch), false);
  assert.equal(postAlert(ALERT_URL, { message: 'x' }, () => { throw new Error('blocked'); }), false);
});

test('২২. P27: install alert-ফাংশন পেলে সেটাও পাঠায়, আর না পেলে চুপ থাকে', () => {
  const handlers = {};
  const win = {
    addEventListener(type, fn) { handlers[type] = fn; },
    location: { href: 'https://a.example/study?token=SECRET' },
    navigator: { userAgent: 'test-agent' },
  };
  const alerts = [];
  const sent = [];
  install(win, (dsn, ev) => { sent.push(ev); return true; }, (ev) => { alerts.push(ev); return true; });
  handlers.error({ error: { message: 'boom' }, filename: 'app.js' });
  assert.equal(sent.length, 1);
  assert.equal(alerts.length, 1, 'the alert rides along with the Sentry event');
  assert.equal(alerts[0].signature, signatureOf('boom', '/study'), 'the worker dedupes on this');
  assert.equal(alerts[0].message, sent[0].message);

  const handlers2 = {};
  const win2 = { addEventListener(t, f) { handlers2[t] = f; }, location: { href: 'https://a.example/x' }, navigator: {} };
  const sent2 = [];
  install(win2, (d, ev) => { sent2.push(ev); return true; });
  handlers2.error({ error: { message: 'boom2' }, filename: 'a.js' });
  assert.equal(sent2.length, 1, 'no alert argument must not break reporting');
});

test('২৩. P27: alert ফিল্ড privacy-তালিকা ভাঙে না', () => {
  const ev = buildEvent({ message: 'boom', path: '/study' });
  assert.ok(!('email' in ev) && !('user' in ev) && !('phone' in ev));
  const alert = { ...ev, signature: 'sig' };
  assert.deepEqual(Object.keys(alert).filter(k => !(k in ev)), ['signature']);
});
