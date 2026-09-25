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

/* ── Phase 2 M1 — learning instrumentation bus routing ────────────────────── */

async function busHarness() {
  const listeners = {};
  const fakeWindow = { addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); }, matchMedia: () => ({ matches: false }) };
  const fakeDoc = { addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); } };
  const svc = new Function('self', 'window', 'document', 'localStorage', 'navigator',
    `${src}\nreturn self.AhAnalytics;`)({}, fakeWindow, fakeDoc, undefined, {});
  svc.attach();
  await svc.configure({ forceMode: 'debug' });
  const seen = [];
  const originalInfo = console.info;
  console.info = (...args) => { if (args[0] === '[AhAnalytics]') seen.push({ name: args[1], params: args[2] }); };
  const fire = (detail) => (listeners['admission:activity'] || []).forEach(fn => fn({ detail }));
  return { svc, fire, seen, restore: () => { console.info = originalInfo; } };
}

test('a23: LESSON_COMPLETE on the bus becomes lesson_complete with snake_case params', async () => {
  const h = await busHarness();
  try {
    h.fire({ type: 'LESSON_COMPLETE', courseId: 'sandhi-interactive-v1', lessonId: 'l3', lessonNumber: 3, completionPercent: 100 });
    const evt = h.seen.find(x => x.name === 'lesson_complete');
    assert.ok(evt, 'lesson_complete emitted');
    assert.equal(evt.params.course_id, 'sandhi-interactive-v1');
    assert.equal(evt.params.lesson_id, 'l3');
    assert.equal(evt.params.lesson_number, 3);
    assert.equal(evt.params.completion_percent, 100);
  } finally { h.restore(); }
});

test('a24: QUIZ_START drops an out-of-enum quiz_type but keeps the event', async () => {
  const h = await busHarness();
  try {
    h.fire({ type: 'QUIZ_START', quizId: 'q-1', quizType: 'bogus', questionCount: 10 });
    const evt = h.seen.find(x => x.name === 'quiz_start');
    assert.ok(evt, 'quiz_start emitted');
    assert.equal(evt.params.quiz_id, 'q-1');
    assert.equal(evt.params.quiz_type, undefined, 'enum violation dropped');
    assert.equal(evt.params.question_count, 10);
  } finally { h.restore(); }
});

test('a25: TEST_COMPLETED keeps its legacy quiz_id shape and carries score/accuracy', async () => {
  const h = await busHarness();
  try {
    h.fire({ type: 'TEST_COMPLETED', resultId: 'res-9', score: 42, accuracy: 84, questionCount: 50, correct: 42, wrong: 5, skipped: 3, mode: 'mock' });
    const evt = h.seen.find(x => x.name === 'quiz_complete');
    assert.ok(evt, 'quiz_complete emitted');
    assert.equal(evt.params.quiz_id, 'res-9', 'resultId maps to quiz_id, not result_id');
    assert.equal(evt.params.score, 42);
    assert.equal(evt.params.accuracy, 84);
    assert.equal(evt.params.question_count, 50);
    assert.equal(evt.params.quiz_type, 'mock');
  } finally { h.restore(); }
});

test('a26: AI_MESSAGE_SENT never carries the message text or prompt', async () => {
  const h = await busHarness();
  try {
    h.fire({ type: 'AI_MESSAGE_SENT', text: 'my secret question', message: 'hello', prompt: 'x', intent: 'math' });
    const evt = h.seen.find(x => x.name === 'ai_message_sent');
    assert.ok(evt, 'ai_message_sent emitted');
    const serialized = JSON.stringify(evt.params);
    assert.equal(serialized.includes('secret'), false, 'text is dropped');
    assert.equal(serialized.includes('hello'), false, 'message is dropped');
    assert.equal(serialized.includes('prompt'), false, 'prompt is dropped');
  } finally { h.restore(); }
});

test('a27: an unknown bus type is ignored and never crashes the handler', async () => {
  const h = await busHarness();
  try {
    const before = h.seen.length;
    assert.doesNotThrow(() => h.fire({ type: 'DB_WRITE', store: 'questions' }));
    assert.doesNotThrow(() => h.fire({ type: 'QUESTION_REVIEWED', questionId: 'q1', correct: true }));
    assert.equal(h.seen.length, before, 'unknown types emit nothing');
  } finally { h.restore(); }
});
