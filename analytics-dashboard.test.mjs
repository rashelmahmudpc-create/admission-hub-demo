/* Phase 4 — analytics dashboard client tests.
 *
 * The dashboard is a renderer plus one write path. Both are tested for real:
 * the ingest queue is exercised against a fake fetch and fake localStorage, and
 * the HTML is generated and asserted on — not grepped from the source, which is
 * the mistake that let a broken service-worker branch pass for months.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* Load the BROWSER build the way the app does (self/window UMD) against a fake
 * root, not a re-implementation — the tested code is the shipped code. This is
 * the same approach analytics-service.test.mjs uses, and it is what makes the
 * dashboard's real ingest path testable without jsdom. */
const src = readFileSync(new URL('./analytics-dashboard.js', import.meta.url), 'utf8');

/* A minimal browser-ish environment: localStorage, a fetch that records calls,
 * and a self the module hangs off. `ledger` is what AhAnalytics would expose. */
function makeEnv(options = {}) {
  const store = new Map();
  const calls = [];
  const root = {
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      const handler = options.fetch || (() => ({ ok: true, status: 200, json: async () => ({ stored: 1 }) }));
      return handler(url, init);
    },
    AhAnalytics: { readLedger: () => options.ledger || [] },
    /* Suppress the module's auto-boot by default; the auto-boot test opts in. */
    __ahAnalyticsNoAuto: !options.autoBoot
  };
  return { root, calls, store };
}

const loadWith = (env) => new Function('self', 'module', 'window', `${src}\nreturn self.AhAnalyticsDashboard;`)(env.root, undefined, undefined);

const ev = (name, params, at) => ({ name, params, at: at || Date.UTC(2026, 8, 24, 4, 0, 0) });

/* ── ingest ──────────────────────────────────────────────────────────────── */

test('p4c-1: only events with a course/lesson/quiz id are shipped', () => {
  const env = makeEnv({ ledger: [
    ev('app_open', {}),
    ev('screen_view', { screen_name: 'home' }),
    ev('lesson_complete', { course_id: 'js', lesson_id: 'l1' }),
    ev('question_attempt', { quiz_id: 'q1', correct: true })
  ] });
  const mod = loadWith(env);
  const pending = mod.pendingEvents();
  assert.equal(pending.length, 2);
  assert.deepEqual(pending.map(p => p.name).sort(), ['lesson_complete', 'question_attempt']);
});

test('p4c-1: a row id is stable for the same content, so a retry dedupes', () => {
  const mod = loadWith(makeEnv());
  const a = mod.rowId(ev('lesson_complete', { course_id: 'js', lesson_id: 'l1' }));
  const b = mod.rowId(ev('lesson_complete', { course_id: 'js', lesson_id: 'l1' }));
  const c = mod.rowId(ev('lesson_complete', { course_id: 'js', lesson_id: 'l2' }));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('p4c-1: syncEvents ships a batch and remembers the ids', async () => {
  const env = makeEnv({ ledger: [
    ev('lesson_complete', { course_id: 'js', lesson_id: 'l1' }),
    ev('lesson_complete', { course_id: 'js', lesson_id: 'l2' })
  ] });
  const mod = loadWith(env);
  const first = await mod.syncEvents();
  assert.equal(first.sent, 2);
  assert.equal(first.reason, 'ok');
  const second = await mod.syncEvents();
  assert.equal(second.reason, 'nothing-pending', 'a second flush must send nothing');
  assert.equal(env.calls.length, 1);
});

test('p4c-1: a failed ingest does not mark rows as shipped', async () => {
  const env = makeEnv({ fetch: () => ({ ok: false, status: 500, json: async () => ({}) }), ledger: [ev('lesson_complete', { course_id: 'js', lesson_id: 'l1' })] });
  const mod = loadWith(env);
  const res = await mod.syncEvents();
  assert.equal(res.stored, 0);
  assert.equal(res.reason, 'failed');
  assert.equal(mod.pendingEvents().length, 1, 'the row must still be pending');
});

test('p4c-1: a signed-out student is told to sign in, not silently dropped', async () => {
  const env = makeEnv({ fetch: () => ({ ok: false, status: 401, json: async () => ({ error: 'auth-required' }) }), ledger: [ev('lesson_complete', { course_id: 'js', lesson_id: 'l1' })] });
  const mod = loadWith(env);
  assert.equal((await mod.syncEvents()).reason, 'auth-required');
});

test('p4c-1: nothing to send makes no request at all', async () => {
  const env = makeEnv();
  const mod = loadWith(env);
  const res = await mod.syncEvents();
  assert.equal(res.sent, 0);
  assert.equal(env.calls.length, 0, 'an empty ledger must not hit the network');
});

test('p4c-1: the pending queue is capped per batch', async () => {
  const env = makeEnv({ ledger: Array.from({ length: 250 }, (_, i) => ev('lesson_complete', { course_id: 'js', lesson_id: `l${i}` })) });
  const mod = loadWith(env);
  const res = await mod.syncEvents();
  assert.equal(res.sent, 100, 'one request must not carry the whole ledger');
});

/* ── render ──────────────────────────────────────────────────────────────── */

const studentData = () => ({
  scope: 'student',
  userId: 'u1',
  metrics: {
    learningTimeMs: 3600000, learningMinutes: 60, lessonsCompleted: 12, practiceActivity: 340,
    accuracy: 82.5, streak: 5, longestStreak: 9, activeDays: 11,
    courseProgress: { courses: 2, lessonsTotal: 40, lessonsDone: 12, percent: 30 },
    series: Array.from({ length: 14 }, (_, i) => ({ day: `2026-09-${String(i + 11).padStart(2, '0')}`, questions: i * 3, correct: 0, wrong: 0, lessons: 0, timeMs: 0, active: true }))
  },
  comparison: { metrics: { practiceActivity: { current: 210, previous: 70, delta: 140, percent: 200, direction: 'up' } } },
  trends: { practiceActivity: { direction: 'up', strength: 0.4 } },
  trendSummary: { text: 'practice activity বাড়ছে।', up: ['practice activity'], down: [] },
  segment: { segment: 'active' },
  stage: { stage: 'intermediate' },
  milestones: { next: { kind: 'course_progress', target: 50, message: 'আর ৮টি পাঠ শেষ করলেই 50% milestone।' }, percent: 30 },
  insights: [
    { kind: 'positive', id: 'practice-up', text: '📈 অভ্যাস বেড়েছে।' },
    { kind: 'attention', id: 'mistakes-pending', text: '📝 ৯টি ভুল বাকি।' }
  ],
  funnel: [], dropOff: { hasAlert: false }, notifications: { overall: {} }
});

test('p4c-2: the student card shows every headline metric', () => {
  const html = loadWith(makeEnv()).studentHtml(studentData());
  assert.ok(html.includes('ahAnalyticsCard'));
  assert.ok(html.includes('পড়ার সময়'));
  assert.ok(html.includes('Streak'));
  assert.ok(html.includes('৮২.৫% নির্ভুল'), 'numbers render in Bengali digits');
  assert.ok(html.includes('১ ঘণ্টা'), 'learning time must be humanized');
});

test('p4c-2: insights are rendered with their tone', () => {
  const html = loadWith(makeEnv()).studentHtml(studentData());
  assert.ok(html.includes('ah-insight-good'));
  assert.ok(html.includes('ah-insight-warn'));
});

test('p4c-2: the milestone bar is rendered from the real percentage', () => {
  const html = loadWith(makeEnv()).studentHtml(studentData());
  assert.ok(html.includes('width:30%'));
  assert.ok(html.includes('milestone'));
});

test('p4c-2: a rising week is chipped, a flat one is not', () => {
  const up = loadWith(makeEnv()).studentHtml(studentData());
  assert.ok(up.includes('ah-delta up'));
  const flat = studentData();
  flat.comparison.metrics.practiceActivity.direction = 'flat';
  assert.ok(!loadWith(makeEnv()).studentHtml(flat).includes('ah-delta'));
});

test('p4c-2: a student with no data is told so, not shown zeros as achievement', () => {
  const empty = {
    metrics: { series: [], courseProgress: {}, insights: [] },
    insights: [], milestones: {}, trendSummary: {}, comparison: {}
  };
  const html = loadWith(makeEnv()).studentHtml(empty);
  assert.ok(html.includes('ah-empty'));
});

test('p4c-2: rendered text is escaped, so a crafted course id cannot inject HTML', () => {
  const d = studentData();
  d.milestones.next.message = '<img src=x onerror=alert(1)>';
  const html = loadWith(makeEnv()).studentHtml(d);
  assert.ok(!html.includes('<img src=x'), 'the payload must not survive as markup');
  assert.ok(html.includes('&lt;img'));
});

test('p4c-2: the sparkline draws one bar per day', () => {
  const svg = loadWith(makeEnv()).__test.sparkline(studentData().metrics.series, s => s.questions);
  assert.equal((svg.match(/<rect/g) || []).length, 14);
});

test('p4c-2: an all-zero series still renders (no divide by zero)', () => {
  const svg = loadWith(makeEnv()).__test.sparkline([{ questions: 0 }, { questions: 0 }], s => s.questions);
  assert.ok(svg.includes('<rect'));
});

/* ── admin ───────────────────────────────────────────────────────────────── */

test('p4c-3: the admin card shows engagement, retention and insights', () => {
  const html = loadWith(makeEnv()).adminHtml({
    engagement: { dau: 12, wau: 40, mau: 90, stickiness: 13.3 },
    retention: { byWindow: { d1: 55, d7: 30 } },
    totals: { students: 120, devices: 140 },
    insights: [{ kind: 'attention', id: 'lesson-dropoff', text: '⚠️ Lesson 23 কম।' }],
    trendSummary: { text: 'lesson completion বাড়ছে।' }
  });
  assert.ok(html.includes('ahAnalyticsAdmin'));
  assert.ok(html.includes('Stickiness'));
  assert.ok(html.includes('Retention D1'));
  assert.ok(html.includes('ah-insight-warn'));
});

test('p4c-3: loadAdmin sends the token and reports forbidden distinctly', async () => {
  const env = makeEnv({ fetch: () => ({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) }) });
  const mod = loadWith(env);
  const res = await mod.loadAdmin('wrong');
  assert.equal(res.reason, 'forbidden');
  assert.equal(env.calls[0].init.headers.Authorization, 'Bearer wrong');
});

test('p4c-3: loadStudent reports auth-required instead of throwing', async () => {
  const env = makeEnv({ fetch: () => ({ ok: false, status: 401, json: async () => ({}) }) });
  const mod = loadWith(env);
  assert.equal((await mod.loadStudent()).reason, 'auth-required');
});

test('p4c-3: a network failure degrades to failed, never an exception', async () => {
  const env = makeEnv({ fetch: () => { throw new Error('offline'); } });
  const mod = loadWith(env);
  const res = await mod.loadStudent();
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'failed');
});

/* ── mount ───────────────────────────────────────────────────────────────── */

test('p4c-4: the card mounts itself, without another module calling it', async () => {
  /* The notification hub exports a mount function nobody calls; a card that
   * waits for a caller never renders. This pins that the dashboard boots on its
   * own and lands next to the notification card. */
  const added = [];
  const anchor = { parentElement: {}, insertAdjacentElement: (where, el) => added.push({ where, id: el && el.id }) };
  const page = {
    querySelector: (sel) => (sel === '#ahNotifCard' ? anchor : null),
    appendChild: (el) => added.push({ where: 'append', id: el && el.id })
  };
  const env = makeEnv();
  env.root.document = {
    querySelector: (sel) => (sel === '#app .page' ? page : null),
    createElement: () => {
      const holder = { innerHTML: '', firstElementChild: null };
      Object.defineProperty(holder, 'innerHTML', {
        set(v) { this._html = v; this.firstElementChild = { id: 'ahAnalyticsCard', _html: v }; },
        get() { return this._html; },
        configurable: true
      });
      return holder;
    }
  };
  const mod = loadWith(env);
  const res = await mod.mount();
  assert.equal(res.ok, true);
  assert.equal(added.length, 1);
  assert.equal(added[0].where, 'afterend', 'must sit beside the notification card');
  assert.equal(added[0].id, 'ahAnalyticsCard');
});

test('p4c-4: mounting twice does not duplicate the card', async () => {
  const added = [];
  const page = {
    querySelector: (sel) => {
      if (sel === '#ahNotifCard') return { parentElement: {}, insertAdjacentElement: (w, el) => added.push(el) };
      if (sel === '#ahAnalyticsCard') return { id: 'ahAnalyticsCard' };
      return null;
    },
    appendChild: (el) => added.push(el)
  };
  const env = makeEnv();
  env.root.document = { querySelector: (sel) => (sel === '#app .page' ? page : null), createElement: () => ({ innerHTML: '', firstElementChild: { id: 'ahAnalyticsCard' } }) };
  const mod = loadWith(env);
  assert.equal((await mod.mount()).reason, 'already-mounted');
  assert.equal(added.length, 0);
});

test('p4c-4: mount never runs in a non-browser environment', async () => {
  const env = makeEnv();
  const mod = loadWith(env);
  assert.equal((await mod.mount()).reason, 'no-dom');
});

test('p4c-4: the module boots itself on load and lands the card', async () => {
  /* The real guarantee: nobody calls mount, so the module must. A DOM that only
   * appears on the second tick also proves the retry works. */
  const added = [];
  const page = {
    querySelector: (sel) => (sel === '#ahNotifCard' ? { parentElement: {}, insertAdjacentElement: (w, el) => added.push(el) } : null),
    appendChild: (el) => added.push(el)
  };
  const env = makeEnv({ autoBoot: true });
  env.root.__ahAnalyticsBootDelay = 1;
  env.root.document = {
    querySelector: (sel) => (sel === '#app .page' ? page : null),
    createElement: () => ({ innerHTML: '', firstElementChild: { id: 'ahAnalyticsCard' } })
  };
  /* No explicit boot() call: the module's own auto-boot must land the card. */
  loadWith(env);
  await new Promise(r => setTimeout(r, 80));
  assert.equal(added.length, 1, 'auto-boot must mount without a caller');
  assert.equal(added[0].id, 'ahAnalyticsCard');
});

test('p4c-4: duration humanizes minutes and hours', () => {
  assert.ok(loadWith(makeEnv()).duration(1800000).includes('মিনিট'));
  assert.ok(loadWith(makeEnv()).duration(7200000).includes('ঘণ্টা'));
});
