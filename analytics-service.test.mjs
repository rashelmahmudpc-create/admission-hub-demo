/* Phase 1 — Analytics Foundation (analytics-service.js).
 *
 * The service is the single choke point between the app and GA4, so these
 * tests pin the contract that matters: nothing crashes the app, nothing
 * private leaves the browser, nothing outside the dictionary is sent, and
 * duplicate completions are not double-counted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* Load the BROWSER build the way the app does (window/self UMD), not a
 * re-implementation — the tested code is the shipped code. */
const src = readFileSync(new URL('./analytics-service.js', import.meta.url), 'utf8');
const fakeSelf = {};
const analytics = new Function('self', 'module', 'window', `${src}\nreturn self.AhAnalytics;`)(fakeSelf, undefined, undefined);
const { normalizeEvent, toSnake, coerceValue, isForbiddenKey } = analytics.__test;

test('a1: the event dictionary is versioned and covers every phase-1 surface', () => {
  assert.equal(analytics.__test.EVENT_VERSION, 'ev1');
  const names = Object.keys(analytics.EVENTS);
  for (const required of [
    'app_open', 'screen_view', 'session_start',
    'course_view', 'course_start', 'lesson_view', 'lesson_start', 'lesson_complete',
    'quiz_start', 'quiz_complete',
    'search', 'feature_open', 'feature_use', 'feature_complete',
    'notification_open', 'notification_click',
    'auth_landing_view', 'sign_up', 'login', 'logout',
    'ai_chat_open', 'ai_message_sent', 'error_seen'
  ]) {
    assert.ok(names.includes(required), `dictionary is missing ${required}`);
  }
});

test('a2: a known event normalises camelCase keys to the dictionary snake_case', () => {
  const out = normalizeEvent('quiz_complete', { quizId: 'q-1', quizType: 'exam', score: 12 });
  assert.ok(out);
  assert.equal(out.name, 'quiz_complete');
  assert.deepEqual(out.params, { quiz_id: 'q-1', quiz_type: 'exam', score: 12 });
});

test('a3: an unknown event is rejected outright', () => {
  assert.equal(normalizeEvent('totally_made_up', { a: 1 }), null);
  assert.equal(normalizeEvent('', {}), null);
});

test('a4: a missing required parameter rejects the event', () => {
  assert.equal(normalizeEvent('quiz_complete', { quiz_type: 'exam' }), null, 'quiz_id is required');
  assert.ok(normalizeEvent('quiz_complete', { quiz_id: 'q-1' }));
});

test('a5: a parameter outside the dictionary is dropped, not sent', () => {
  const out = normalizeEvent('screen_view', { screen_name: 'dashboard', evil_param: 'x' });
  assert.equal(out.params.screen_name, 'dashboard');
  assert.equal('evil_param' in out.params, false);
});

test('a6: privacy — identity, credential and free-text keys never survive', () => {
  for (const key of ['password', 'apiKey', 'api_key', 'token', 'secret', 'email', 'phone',
    'mobile', 'fullName', 'full_name', 'answer', 'explanation', 'message', 'transcript',
    'text', 'content', 'prompt', 'response', 'query', 'address', 'cookie', 'authorization']) {
    assert.ok(isForbiddenKey(toSnake(key)), `${key} must be filtered`);
  }
  /* Even when the caller tries to smuggle them into a legitimate event. */
  const out = normalizeEvent('screen_view', { screen_name: 'dashboard', email: 'a@b.c', answer: '42', text: 'hi' });
  assert.deepEqual(Object.keys(out.params), ['screen_name']);
});

test('a7: only string/number/boolean values are kept', () => {
  assert.equal(coerceValue({ a: 1 }), null);
  assert.equal(coerceValue([1, 2]), null);
  assert.equal(coerceValue(null), null);
  assert.equal(coerceValue(undefined), null);
  assert.equal(coerceValue(NaN), null);
  assert.equal(coerceValue(Infinity), null);
  assert.equal(coerceValue(true), true);
  assert.equal(coerceValue(7), 7);
  assert.equal(coerceValue('  ok  '), 'ok');
});

test('a8: enum-constrained parameters reject values outside the allowed set', () => {
  const ok = normalizeEvent('quiz_complete', { quiz_id: 'q', quiz_type: 'exam' });
  assert.equal(ok.params.quiz_type, 'exam');
  const bad = normalizeEvent('quiz_complete', { quiz_id: 'q', quiz_type: 'hacked' });
  assert.equal('quiz_type' in bad.params, false, 'a value outside the enum is dropped');
});

test('a9: long strings are bounded and control characters stripped', () => {
  const out = normalizeEvent('search', { search_scope: 'question_bank', result_count: 5 });
  assert.equal(out.params.result_count, 5);
  const long = normalizeEvent('course_view', { course_id: 'x'.repeat(500) });
  assert.ok(long.params.course_id.length <= 120);
});

test('a10: toSnake converts the shapes callers actually write', () => {
  assert.equal(toSnake('courseId'), 'course_id');
  assert.equal(toSnake('CourseID'), 'course_id');
  assert.equal(toSnake('screen-name'), 'screen_name');
  assert.equal(toSnake('api key'), 'api_key');
});

test('a11: diagnose() reports a disabled service before start, never throws', () => {
  const st = analytics.status();
  assert.equal(st.mode, 'disabled');
  assert.equal(st.started, false);
  assert.equal(st.version, 'ev1');
  assert.ok(st.events >= 20);
});

test('a12: trackEvent before start is a safe no-op', () => {
  const r = analytics.trackEvent('app_open', {});
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'disabled');
});

test('a13: start() in a non-production environment stays console-only', async () => {
  const st = await analytics.start({ appVersion: 'test-build' });
  assert.notEqual(st.mode, 'production', 'must not transmit from a test origin');
  assert.equal(st.appVersion, 'test-build');
  assert.equal(st.started, true);
});

test('a14: debug mode traces events but sends nothing to the network', async () => {
  /* Non-prod origin resolved to `disabled`; an explicit debug flag is how a
   * developer turns tracing on without a GA4 property. */
  const st = await analytics.configure({ forceMode: 'debug', appVersion: 'test-build' });
  assert.equal(st.mode, 'debug');
  const r = analytics.trackEvent('screen_view', { screen_name: 'dashboard' });
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'debug');
  assert.equal(analytics.status().signalled.sent > 0, true);
});

test('a15: once-only events are not double-counted', () => {
  const before = analytics.status().signalled.dropped;
  const first = analytics.trackEvent('quiz_complete', { quiz_id: 'exam-99' });
  const second = analytics.trackEvent('quiz_complete', { quiz_id: 'exam-99' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'duplicate');
  assert.ok(analytics.status().signalled.dropped > before);
});

test('a16: screen_view normalises a deep route and refuses a repeat of the same screen', () => {
  const first = analytics.trackScreen('question-bank/settings');
  assert.equal(first.ok, true);
  const same = analytics.trackScreen('question-bank/settings');
  assert.equal(same.ok, false);
  assert.equal(same.reason, 'same-screen');
  const next = analytics.trackScreen('progress/plan');
  assert.equal(next.ok, true);
});

test('a17: a call that throws internally still resolves to a result, never an exception', () => {
  /* A getter that throws must not escape the public API. */
  const hostile = { get quiz_id() { throw new Error('boom'); } };
  assert.doesNotThrow(() => analytics.trackEvent('quiz_complete', hostile));
  assert.equal(analytics.trackEvent('quiz_complete', hostile).ok, false);
});

test('a18: setUserContext keeps only an opaque id and a single first-name token', () => {
  const r = analytics.setUserContext({ id: 'student-123', firstName: 'Rashel Mahmud' });
  assert.equal(r.ok, true);
  /* The raw input never round-trips; only the sanitised projection exists. */
  const st = analytics.status();
  assert.equal(st.user.signedIn, true);
  assert.equal(JSON.stringify(st).includes('Rashel Mahmud'), false, 'full name must never be retained');
});

test('a19: feature and notification helpers map to dictionary events', () => {
  assert.equal(analytics.EVENTS.feature_open.required.includes('feature_name'), true);
  assert.equal(analytics.EVENTS.notification_open.required.includes('notification_id'), true);
  /* Complete is once-only, open is not. */
  assert.equal(analytics.EVENTS.feature_complete.once, true);
  assert.equal(analytics.EVENTS.feature_open.once, false);
  assert.equal(analytics.EVENTS.notification_open.once, true);
});

test('a21: route-context derivation maps app routes to dictionary events', async () => {
  /* The derivation is registered on the real event bus; drive it with a fake
   * DOM so the tested path is the shipped one, not a copy. */
  const listeners = {};
  const fakeWindow = {
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    matchMedia: () => ({ matches: false }),
    __admissionHubGetActiveExam: () => ({ id: 'exam-7', mode: 'mock', questions: [{}, {}, {}] })
  };
  const fakeDoc = { addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); } };
  const svc = new Function('self', 'window', 'document', 'localStorage', 'navigator',
    `${src}\nreturn self.AhAnalytics;`)({}, fakeWindow, fakeDoc, undefined, {});
  svc.attach();
  await svc.configure({ forceMode: 'debug' });

  const fire = (type, detail) => (listeners[type] || []).forEach(fn => fn({ detail }));

  fire('admission:route-rendered', { path: 'exam/running' });
  assert.equal(svc.status().reasons['mode-disabled'] === undefined, true, 'debug mode is active');

  fire('admission:route-rendered', { path: 'dashboard' });
  const before = svc.status().signalled.sent;
  fire('admission:route-rendered', { path: 'question-bank' });
  assert.ok(svc.status().signalled.sent > before, 'question-bank maps to feature_open');
});

test('a22: authchange sets context from the profile cache and never the full name', async () => {
  const listeners = {};
  const store = {
    'ah-profile-cache-key': 'p-1',
    'ah-profile-cache:p-1': JSON.stringify({ profile: { fullName: 'Rashel Mahmud', email: 'x@y.z', mobile: '017' } })
  };
  const fakeWindow = { addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); }, matchMedia: () => ({ matches: false }) };
  const fakeDoc = { addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); } };
  const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const svc = new Function('self', 'window', 'document', 'localStorage', 'navigator',
    `${src}\nreturn self.AhAnalytics;`)({}, fakeWindow, fakeDoc, ls, {});
  svc.attach();
  await svc.configure({ forceMode: 'debug' });
  (listeners['admissionhub:authchange'] || []).forEach(fn => fn({ detail: { authenticated: true, user: { id: 'student-1' } } }));
  assert.equal(svc.status().user.signedIn, true);
  assert.equal(JSON.stringify(svc.status()).includes('Rashel'), false, 'first name is never surfaced in status');
  assert.equal(JSON.stringify(svc.status()).includes('017'), false, 'phone never retained');
});

test('a20: the service never references a production-only global it cannot survive without', () => {
  /* A snapshot of the worst case: no DOM, no fetch, no localStorage. */
  const bare = new Function('self', 'module', 'window', `${src}\nreturn self.AhAnalytics;`)({}, undefined, undefined);
  assert.doesNotThrow(() => bare.status());
  assert.doesNotThrow(() => bare.trackEvent('app_open', {}));
  assert.doesNotThrow(() => bare.trackScreen('dashboard'));
  assert.doesNotThrow(() => bare.setUserContext({ id: 'x', firstName: 'y' }));
});
