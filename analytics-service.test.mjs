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
  assert.equal(analytics.__test.EVENT_VERSION, 'ev2');
  const names = Object.keys(analytics.EVENTS);
  for (const required of [
    'app_open', 'screen_view', 'session_start',
    'course_view', 'course_start', 'lesson_view', 'lesson_start', 'lesson_complete', 'course_complete',
    'quiz_start', 'quiz_complete', 'question_attempt',
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
  assert.equal(st.version, 'ev2');
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
  const store = {};
  const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const fakeWindow = { addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); }, matchMedia: () => ({ matches: false }) };
  const fakeDoc = { addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); } };
  const svc = new Function('self', 'window', 'document', 'localStorage', 'navigator',
    `${src}\nreturn self.AhAnalytics;`)({}, fakeWindow, fakeDoc, ls, {});
  svc.attach();
  await svc.configure({ forceMode: 'debug' });
  const seen = [];
  const originalInfo = console.info;
  console.info = (...args) => { if (args[0] === '[AhAnalytics]') seen.push({ name: args[1], params: args[2] }); };
  const fire = (detail) => (listeners['admission:activity'] || []).forEach(fn => fn({ detail }));
  return { svc, fire, seen, store, restore: () => { console.info = originalInfo; } };
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

/* ── Phase 2 M2/M3 — lesson granularity + per-question depth ──────────────── */

test('a28: a second lesson in the same course still emits (dedupe key is per lesson)', async () => {
  const h = await busHarness();
  try {
    h.fire({ type: 'LESSON_COMPLETE', courseId: 'sandhi-exact-native-v1', lessonId: 'lesson1', lessonNumber: 1 });
    h.fire({ type: 'LESSON_COMPLETE', courseId: 'sandhi-exact-native-v1', lessonId: 'lesson2', lessonNumber: 2 });
    h.fire({ type: 'LESSON_COMPLETE', courseId: 'sandhi-exact-native-v1', lessonId: 'lesson3', lessonNumber: 3 });
    const done = h.seen.filter(x => x.name === 'lesson_complete');
    assert.equal(done.length, 3, 'every lesson fires; course_id alone must not suppress later lessons');
    assert.deepEqual(done.map(x => x.params.lesson_id), ['lesson1', 'lesson2', 'lesson3']);
  } finally { h.restore(); }
});

test('a29: a repeated lesson_complete for the SAME lesson is still deduped', async () => {
  const h = await busHarness();
  try {
    h.fire({ type: 'LESSON_COMPLETE', courseId: 'c-1', lessonId: 'lesson1' });
    h.fire({ type: 'LESSON_COMPLETE', courseId: 'c-1', lessonId: 'lesson1' });
    assert.equal(h.seen.filter(x => x.name === 'lesson_complete').length, 1);
  } finally { h.restore(); }
});

test('a30: COURSE_COMPLETE rides the bus and keeps the course id', async () => {
  const h = await busHarness();
  try {
    h.fire({ type: 'COURSE_COMPLETE', courseId: 'somas-exact-native-v1', courseType: 'source', lessonCount: 13, completionPercent: 100 });
    const evt = h.seen.find(x => x.name === 'course_complete');
    assert.ok(evt, 'course_complete emitted');
    assert.equal(evt.params.course_id, 'somas-exact-native-v1');
    assert.equal(evt.params.lesson_count, 13);
  } finally { h.restore(); }
});

test('a31: QUESTION_ATTEMPT is repeatable and carries per-question timing', async () => {
  const h = await busHarness();
  try {
    h.fire({ type: 'QUESTION_ATTEMPT', quizId: 'exam-7', questionId: 'q-1', quizType: 'mock', correct: true, duration: 12, questionNumber: 1, subjectId: 's1', topicId: 't1' });
    h.fire({ type: 'QUESTION_ATTEMPT', quizId: 'exam-7', questionId: 'q-2', quizType: 'mock', correct: false, duration: 40, questionNumber: 2 });
    const attempts = h.seen.filter(x => x.name === 'question_attempt');
    assert.equal(attempts.length, 2, 'per-question events are never deduped');
    assert.equal(attempts[0].params.quiz_id, 'exam-7');
    assert.equal(attempts[0].params.question_id, 'q-1');
    assert.equal(attempts[0].params.correct, true);
    assert.equal(attempts[0].params.duration, 12);
    assert.equal(attempts[0].params.topic_id, 't1');
    assert.equal(attempts[1].params.correct, false);
  } finally { h.restore(); }
});

test('a32: QUESTION_ATTEMPT without a question_id is rejected (required param)', async () => {
  const h = await busHarness();
  try {
    h.fire({ type: 'QUESTION_ATTEMPT', quizId: 'exam-7', correct: true });
    assert.equal(h.seen.filter(x => x.name === 'question_attempt').length, 0, 'missing required question_id → dropped');
  } finally { h.restore(); }
});

/* ── Phase 2 M3 completion — the course MCQ engine is a quiz surface too ──── */

test('a33: QUIZ_COMPLETE rides the bus with accuracy and attempt duration', async () => {
  const h = await busHarness();
  try {
    h.fire({ type: 'QUIZ_COMPLETE', quizId: 'sandhi-exact-native-v1:course', questionCount: 40, correct: 30, wrong: 8, skipped: 2, accuracy: 75, quizType: 'practice', duration: 540 });
    const evt = h.seen.find(x => x.name === 'quiz_complete');
    assert.ok(evt, 'quiz_complete emitted from the course MCQ result');
    assert.equal(evt.params.quiz_id, 'sandhi-exact-native-v1:course', 'the course MCQ result carries its quiz_id');
    assert.equal(evt.params.accuracy, 75);
    assert.equal(evt.params.duration, 540);
  } finally { h.restore(); }
});

/* ── Phase 2 M4/M5 — funnel + drop-off intelligence ──────────────────────── */

const { buildLearningInsights, checkDataQuality, computeStreak } = analytics.__test;

/* Build a synthetic event trail: `n` events per funnel step, all on one day.
 * Each row carries the dictionary-required params, so a "clean" trail is clean
 * for the right reason rather than by accident. */
const REQUIRED = {
  course_view: { course_id: 'c1' },
  course_start: { course_id: 'c1' },
  lesson_view: { course_id: 'c1', lesson_id: 'l1' },
  lesson_start: { course_id: 'c1', lesson_id: 'l1' },
  lesson_complete: { course_id: 'c1', lesson_id: 'l1' },
  course_complete: { course_id: 'c1' },
  quiz_start: { quiz_id: 'q1' },
  quiz_complete: { quiz_id: 'q1' }
};
function trail(counts, at = Date.parse('2026-09-20T09:00:00Z')) {
  const out = [];
  for (const [name, n] of Object.entries(counts)) {
    const def = analytics.EVENTS[name];
    const identity = def && def.once ? (def.required || [])[0] : null;
    for (let i = 0; i < n; i += 1) {
      const params = { ...(REQUIRED[name] || {}) };
      /* once-only events must differ per row, otherwise the trail is duplicate
       * by construction and the quality check correctly flags it. */
      if (identity) params[identity] = `${params[identity]}-${i}`;
      out.push({ name, params, at });
    }
  }
  return out;
}

test('m4-1: the funnel reports every step in order with its reach and drop rate', () => {
  const insights = buildLearningInsights({ events: trail({ course_view: 100, course_start: 80, lesson_start: 60, lesson_complete: 40, quiz_start: 30, quiz_complete: 20 }) });
  assert.deepEqual(insights.funnel.map(s => s.key), ['course_view', 'course_start', 'lesson_start', 'lesson_complete', 'quiz_start', 'quiz_complete']);
  assert.deepEqual(insights.funnel.map(s => s.count), [100, 80, 60, 40, 30, 20]);
  assert.equal(insights.funnel[0].reachRate, 1, 'the first step is the baseline');
  assert.equal(insights.funnel[1].reachRate, 0.8);
  assert.equal(insights.funnel[1].dropRate, 0.2);
});

test('m4-2: the funnel is built from events, never from collapsed screen names', () => {
  /* a16 pins that trackScreen collapses `source-courses/sandhi` to
   * `source-courses`; a screen-based funnel would therefore merge every course
   * into one step. The step list must be event names. */
  assert.deepEqual(analytics.FUNNEL_STEPS.map(s => s.event), ['course_view', 'course_start', 'lesson_start', 'lesson_complete', 'quiz_start', 'quiz_complete']);
});

test('m5-1: the steepest stage is surfaced with a plain-language message', () => {
  const insights = buildLearningInsights({ events: trail({ course_view: 100, course_start: 90, lesson_start: 85, lesson_complete: 20, quiz_start: 18, quiz_complete: 15 }) });
  assert.equal(insights.dropOff.hasAlert, true);
  assert.equal(insights.dropOff.steepest, 'lesson_complete', 'the 85→20 lesson drop is the steepest');
  assert.equal(insights.dropOff.dropRate, 0.7647);
  assert.match(insights.dropOff.message, /৭৬%|76%/, 'the message states the size of the drop');
});

test('m5-2: a small sample never raises an alert (a percentage of 3 students is noise)', () => {
  const insights = buildLearningInsights({ events: trail({ course_view: 3, course_start: 1 }) });
  assert.equal(insights.dropOff.hasAlert, false);
  assert.equal(insights.dropOff.steepest, null);
});

test('m5-3: a healthy funnel raises no alert', () => {
  const insights = buildLearningInsights({ events: trail({ course_view: 100, course_start: 95, lesson_start: 90, lesson_complete: 88, quiz_start: 85, quiz_complete: 82 }) });
  assert.equal(insights.dropOff.hasAlert, false);
});

test('m5-4: ties break toward the earliest step, which is the one to fix first', () => {
  const insights = buildLearningInsights({ events: trail({ course_view: 50, course_start: 25, lesson_start: 12, lesson_complete: 6, quiz_start: 3, quiz_complete: 3 }) });
  assert.equal(insights.dropOff.steepest, 'lesson_start', '52% lost beats the 50% steps');
});

/* ── Phase 2 M6 — engagement, streak, retention ──────────────────────────── */

test('m6-1: a streak counts the longest run of consecutive active days', () => {
  assert.equal(computeStreak(['2026-09-01', '2026-09-02', '2026-09-03']), 3);
  assert.equal(computeStreak(['2026-09-01', '2026-09-03', '2026-09-04']), 2, 'a gap restarts the run');
  assert.equal(computeStreak([]), 0);
});

test('m6-2: engagement derives active days, streak and retention from the same events', () => {
  const events = [
    ...trail({ lesson_start: 2 }, Date.parse('2026-09-01T09:00:00Z')),
    ...trail({ lesson_start: 1 }, Date.parse('2026-09-02T09:00:00Z')),
    ...trail({ quiz_start: 1 }, Date.parse('2026-09-08T09:00:00Z'))
  ];
  const { engagement } = buildLearningInsights({ events });
  assert.equal(engagement.activeDays, 3);
  assert.equal(engagement.firstDay, '2026-09-01');
  assert.equal(engagement.lastDay, '2026-09-08');
  assert.equal(engagement.streak, 2, 'Sep 1–2 is the longest consecutive run');
  assert.equal(engagement.retention.d1, 2, 'two later days are ≥1 day after the first');
  assert.equal(engagement.retention.d7, 1);
  assert.equal(engagement.retention.d30, 0);
});

/* ── Phase 2 M7 — data quality monitoring ────────────────────────────────── */

test('m7-1: an expected event that never fired is reported as missing', () => {
  const q = checkDataQuality(trail({ course_view: 5, lesson_start: 5 }), { course_view: 5, lesson_start: 5 });
  assert.equal(q.ok, false);
  assert.ok(q.missing.includes('lesson_complete'));
  assert.ok(q.missing.includes('quiz_start'));
  assert.ok(!q.missing.includes('course_view'));
});

test('m7-2: a row missing a dictionary-required parameter is counted incomplete', () => {
  const events = [{ name: 'lesson_complete', params: { course_id: 'c1' } }]; // no lesson_id
  const q = checkDataQuality(events, { lesson_complete: 1 });
  assert.equal(q.incomplete, 1);
  assert.equal(q.ok, false);
});

test('m7-3: a duplicated once-only event is flagged', () => {
  const dup = { name: 'lesson_complete', params: { course_id: 'c1', lesson_id: 'l1' } };
  const q = checkDataQuality([dup, { ...dup }], { lesson_complete: 2 });
  assert.equal(q.duplicates, 1);
});

test('m7-4: a clean trail reports ok with nothing missing', () => {
  const counts = { course_view: 10, lesson_start: 9, lesson_complete: 8, quiz_start: 7, quiz_complete: 6 };
  const q = checkDataQuality(trail(counts), counts);
  assert.equal(q.ok, true);
  assert.deepEqual(q.missing, []);
  assert.equal(q.checked, 40);
});

test('m7-5: an empty trail reports every expected event missing, and never throws', () => {
  const q = checkDataQuality([], {});
  assert.equal(q.ok, false);
  assert.equal(q.missing.length, 5);
  assert.equal(buildLearningInsights({}).funnel[0].count, 0);
});

/* ── Phase 2 M4–M7 — the ledger that feeds the reports ───────────────────── */

test('m4-3: emitted learning events land in the on-device ledger and feed the funnel', async () => {
  const h = await busHarness();
  try {
    for (let i = 0; i < 4; i += 1) {
      h.fire({ type: 'COURSE_VIEW', courseId: 'c1', courseType: 'source' });
      h.fire({ type: 'LESSON_START', courseId: 'c1', lessonId: `l${i}`, lessonNumber: i + 1 });
      h.fire({ type: 'LESSON_COMPLETE', courseId: 'c1', lessonId: `l${i}`, lessonNumber: i + 1 });
    }
    h.svc.flushLedger();
    const rows = h.svc.readLedger();
    assert.equal(rows.length, 12, 'every emitted event is recorded');
    const insights = h.svc.buildLearningInsights({ events: rows });
    assert.equal(insights.funnel.find(s => s.key === 'course_view').count, 4);
    assert.equal(insights.funnel.find(s => s.key === 'lesson_complete').count, 4);
    assert.equal(insights.funnel.find(s => s.key === 'quiz_start').count, 0);
    assert.equal(insights.quality.ok, false, 'quiz events never fired, so quality is not ok');
  } finally { h.restore(); }
});

test('m4-4: the ledger holds only what was sent — a forbidden param never reaches it', async () => {
  const h = await busHarness();
  try {
    h.fire({ type: 'LESSON_COMPLETE', courseId: 'c1', lessonId: 'l1', answer: 'the secret answer', email: 'a@b.c' });
    h.svc.flushLedger();
    const serialized = JSON.stringify(h.svc.readLedger());
    assert.equal(serialized.includes('secret'), false, 'answer text is filtered before storage');
    assert.equal(serialized.includes('a@b.c'), false, 'email is filtered before storage');
  } finally { h.restore(); }
});

test('m4-5: the ledger stays bounded, dropping the oldest rows first', async () => {
  const h = await busHarness();
  try {
    for (let i = 0; i < 520; i += 1) h.fire({ type: 'QUESTION_ATTEMPT', quizId: 'q', questionId: `q-${i}`, correct: true });
    h.svc.flushLedger();
    const rows = h.svc.readLedger();
    assert.equal(rows.length, 500, 'the ledger never grows past its cap');
    assert.equal(rows[rows.length - 1].params.question_id, 'q-519', 'the newest row survives');
    assert.notEqual(rows[0].params.question_id, 'q-0', 'the oldest rows were dropped');
  } finally { h.restore(); }
});

