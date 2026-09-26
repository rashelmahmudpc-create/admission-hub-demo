/* Phase 4 — Analytics Dashboard & Smart Insights tests.
 *
 * The brief's completion standard is a list of twenty guarantees. Each one is a
 * test here, named after the guarantee, so the standard cannot rot: the unified
 * layer, the student dashboard, personal insights, course/lesson/quiz analytics,
 * engagement, retention, drop-off signals, segmentation, notification and
 * campaign analytics, comparison, trends, milestones, admin insights, filters,
 * access control and the AI-ready signal layer.
 *
 * The metric core is pure, so most tests need no I/O. Where storage is needed,
 * D1 is a small pattern-matched double — no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dayKey, shiftDay, daysBetween, dayRange, computeStreak, liveStreak,
  normalizeLearning, computeLearningMetrics,
  compareValue, splitPeriods, comparePeriods,
  linearTrend, detectTrends,
  SEGMENTS, classifyBehaviourSegment, classifyLearningStage,
  FUNNEL_STEPS, DROPOFF_ALERT_RATE, DROPOFF_MIN_SAMPLE, countByEvent, buildFunnel, detectFunnelDropOff,
  buildCourseAnalytics, buildLessonAnalytics, buildQuizAnalytics,
  computeEngagement, RETENTION_WINDOWS, computeRetention,
  computeNotificationAnalytics, computeCampaignAnalytics, rankCampaigns,
  MILESTONES, computeMilestones,
  INSIGHT_KINDS, buildStudentInsights, buildAdminInsights, summarizeTrends,
  AnalyticsStore, parseFilters, applyFilters,
  buildStudentDashboard, buildAdminDashboard, handleAnalyticsRequest,
  ANALYTICS_PREFIX
} from './analytics-engine.mjs';

/* 2026-09-24, Dhaka (UTC+6) — matches the Phase 3 suite so the two agree. */
const NOW = Date.UTC(2026, 8, 24, 4, 0, 0);
const TODAY = '2026-09-24';
const OPTS = { today: TODAY, nowMs: NOW, tzOffsetMin: 360 };

/* ── fake D1, pattern-matched on the exact SQL this feature uses ──────────── */

function makeFakeD1(seed = {}) {
  const s = {
    events: seed.events || [],
    dailyStats: seed.dailyStats || [],
    courses: seed.courses || [],
    outcomes: seed.outcomes || [],
    globals: seed.globals || [],
    reads: seed.reads || [],
    devices: seed.devices || []
  };
  const db = {
    _s: s,
    async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; },
    prepare(sql) {
      const runner = (args) => ({
        async run() {
          if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) return { meta: { changes: 0 } };
          if (sql.includes('INSERT INTO analytics_events')) {
            const [user_id, id, name, params_json, at, day_key, created_at] = args;
            if (s.events.some(e => e.user_id === user_id && e.id === id)) return { meta: { changes: 0 } };
            s.events.push({ user_id, id, name, params_json, at, day_key, created_at });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        },
        async first() {
          if (sql.includes('COUNT(DISTINCT user_id) AS n FROM fcm_devices')) return { n: s.devices.length };
          return null;
        },
        async all() {
          if (sql.includes('FROM analytics_events') && sql.includes('WHERE at>=')) {
            return { results: s.events.filter(e => e.at >= args[0]).map(e => ({ id: e.id, name: e.name, params_json: e.params_json, at: e.at })) };
          }
          if (sql.includes('FROM analytics_events') && sql.includes('user_id=? AND at>=')) {
            return { results: s.events.filter(e => e.user_id === args[0] && e.at >= args[1]).map(e => ({ id: e.id, name: e.name, params_json: e.params_json, at: e.at })) };
          }
          if (sql.includes('FROM user_daily_stats') && sql.includes('GROUP BY s.user_id')) {
            const byUser = new Map();
            for (const d of s.dailyStats) {
              if (d.deleted_at) continue;
              if (d.day < args[0]) continue;
              const cur = byUser.get(d.user_id) || { user_id: d.user_id, days: new Set(), questions: 0, lessons: 0, time_ms: 0 };
              cur.days.add(d.day);
              cur.questions += Number(d.questions) || 0;
              cur.lessons += Number(d.lessons) || 0;
              cur.time_ms += Number(d.timeMs) || 0;
              byUser.set(d.user_id, cur);
            }
            return { results: [...byUser.values()].map(u => ({ user_id: u.user_id, days: [...u.days].join(','), questions: u.questions, lessons: u.lessons, time_ms: u.time_ms })) };
          }
          if (sql.includes('FROM user_daily_stats') && sql.includes('user_id=?')) {
            return { results: s.dailyStats.filter(d => d.user_id === args[0] && !d.deleted_at).sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, args[1]).map(d => ({ day: d.day, payload_json: JSON.stringify(d) })) };
          }
          if (sql.includes('FROM user_exam_results')) {
            return { results: s.examResults?.filter(r => r.user_id === args[0]).map(r => ({ id: r.id, payload_json: JSON.stringify(r), updated_at: r.updated_at })) || [] };
          }
          if (sql.includes('FROM user_mistakes')) {
            const byTopic = new Map();
            for (const m of s.mistakes || []) {
              if (m.user_id !== args[0]) continue;
              byTopic.set(m.topic, (byTopic.get(m.topic) || 0) + 1);
            }
            return { results: [...byTopic.entries()].map(([topic, misses]) => ({ topic, misses })) };
          }
          if (sql.includes('FROM user_settings') && sql.includes('GROUP BY')) return { results: [] };
          if (sql.includes('FROM user_settings') && sql.includes('id=\'settings\'')) {
            const row = s.courses.find(c => c.user_id === args[0]);
            return { results: row ? [{ payload_json: JSON.stringify({ courses: row.courses }) }] : [] };
          }
          if (sql.includes('FROM user_settings')) {
            return { results: s.courses.filter(c => !args.length || c.updated_at >= args[0]).map(c => ({ user_id: c.user_id, payload_json: JSON.stringify({ courses: c.courses }), updated_at: c.updated_at })) };
          }
          if (sql.includes('FROM notification_outcomes') && sql.includes('user_id=?')) {
            return { results: s.outcomes.filter(o => o.user_id === args[0] && o.sent_at >= args[1]) };
          }
          if (sql.includes('FROM notification_outcomes')) {
            return { results: s.outcomes.filter(o => o.sent_at >= args[0]) };
          }
          if (sql.includes('FROM global_notifications')) {
            return { results: s.globals.filter(g => Math.max(g.sent_at || 0, g.scheduled_at || 0) >= args[0]) };
          }
          if (sql.includes('FROM notification_reads')) {
            const byId = new Map();
            for (const r of s.reads) byId.set(r.notification_id, (byId.get(r.notification_id) || 0) + 1);
            return { results: [...byId.entries()].map(([notification_id, n]) => ({ notification_id, n })) };
          }
          return { results: [] };
        }
      });
      return { bind: (...args) => runner(args), ...runner([]) };
    }
  };
  return db;
}

const day = (n) => shiftDay(TODAY, -n);

/* ── 1. unified analytics engine ─────────────────────────────────────────── */

test('p4-1: the engine normalizes every student-owned table into one shape', () => {
  const out = normalizeLearning({
    dailyStats: [{ day: TODAY, questions: 10, correct: 7, wrong: 3, lessons: 2, timeMs: 600000 }],
    examResults: [{ id: 'e1', score: 80, at: NOW }],
    mistakes: [{ topic: 'js', misses: 3 }],
    courses: [{ id: 'javascript', lessonsTotal: 10, lessonsDone: 5 }]
  });
  assert.equal(out.dailyStats.length, 1);
  assert.equal(out.exams.length, 1);
  assert.equal(out.mistakes[0].topic, 'js');
  assert.equal(out.courses[0].lessonsDone, 5);
});

test('p4-1: malformed rows are dropped, never guessed at', () => {
  const out = normalizeLearning({
    dailyStats: [{ day: 'not-a-day', questions: 5 }, { day: TODAY, questions: 5 }],
    courses: [{ id: 'x', lessonsTotal: 0 }, { id: '', lessonsTotal: 5 }]
  });
  assert.equal(out.dailyStats.length, 1);
  assert.equal(out.courses.length, 0);
});

test('p4-1: a metric reads the same tables the Phase 1–3 code writes', () => {
  const m = computeLearningMetrics({
    dailyStats: [
      { day: day(1), questions: 20, correct: 15, wrong: 5, lessons: 3, timeMs: 1800000 },
      { day: day(2), questions: 10, correct: 5, wrong: 5, lessons: 1, timeMs: 600000 }
    ],
    courses: [{ id: 'js', lessonsTotal: 10, lessonsDone: 4 }]
  }, OPTS);
  assert.equal(m.practiceActivity, 30);
  assert.equal(m.lessonsCompleted, 4);
  assert.equal(m.accuracy, 66.7);
  assert.equal(m.learningMinutes, 40);
  assert.equal(m.activeDays, 2);
  assert.equal(m.courseProgress.percent, 40);
});

/* ── 2. student analytics dashboard ──────────────────────────────────────── */

test('p4-2: the student dashboard carries every metric the brief names', async () => {
  const store = new AnalyticsStore(makeFakeD1({
    dailyStats: [
      { user_id: 'u1', day: day(1), questions: 20, correct: 15, wrong: 5, lessons: 3, timeMs: 1800000 },
      { user_id: 'u1', day: day(2), questions: 10, correct: 6, wrong: 4, lessons: 1, timeMs: 900000 }
    ],
    courses: [{ user_id: 'u1', courses: [{ id: 'js', lessonsTotal: 10, lessonsDone: 4 }], updated_at: NOW }]
  }));
  const d = await buildStudentDashboard(store, 'u1', { today: TODAY, seriesDays: 14, filters: { sinceMs: NOW - 30 * 86400000, untilMs: NOW, tzOffsetMin: 360 } });
  for (const key of ['learningTimeMs', 'lessonsCompleted', 'quizActivity', 'practiceActivity', 'accuracy', 'streak', 'activeDays', 'series', 'courseProgress']) {
    assert.ok(key in d.metrics, `metric ${key} missing`);
  }
  assert.equal(d.scope, 'student');
  assert.equal(d.userId, 'u1');
});

test('p4-2: the dashboard is scoped to the session user by construction', async () => {
  const store = new AnalyticsStore(makeFakeD1({
    dailyStats: [
      { user_id: 'u1', day: day(1), questions: 99, correct: 99, wrong: 0, lessons: 0, timeMs: 0 },
      { user_id: 'u2', day: day(1), questions: 1, correct: 1, wrong: 0, lessons: 0, timeMs: 0 }
    ]
  }));
  const d = await buildStudentDashboard(store, 'u2', { today: TODAY, filters: { sinceMs: NOW - 30 * 86400000, untilMs: NOW, tzOffsetMin: 360 } });
  assert.equal(d.metrics.practiceActivity, 1, 'must not include another student\'s rows');
});

/* ── 3. personal progress intelligence ───────────────────────────────────── */

test('p4-3: comparison reports the direction, not just two numbers', () => {
  const c = compareValue(120, 100);
  assert.equal(c.direction, 'up');
  assert.equal(c.delta, 20);
  assert.equal(c.percent, 20);
  assert.equal(compareValue(80, 100).direction, 'down');
  assert.equal(compareValue(100, 100).direction, 'flat');
});

test('p4-3: a period comparison splits the series into two equal windows', () => {
  const series = dayRange(TODAY, 14).map((d, i) => ({ day: d, questions: i < 7 ? 10 : 30, lessons: 0, timeMs: 0, correct: 0, wrong: 0, active: true }));
  const cmp = comparePeriods(series, 7);
  assert.equal(cmp.current.length, 7);
  assert.equal(cmp.previous.length, 7);
  assert.equal(cmp.metrics.practiceActivity.direction, 'up');
  assert.equal(cmp.metrics.practiceActivity.current, 210);
  assert.equal(cmp.metrics.practiceActivity.previous, 70);
});

test('p4-3: zero previous activity is not reported as a percentage rise of zero', () => {
  assert.equal(compareValue(10, 0).percent, 100);
  assert.equal(compareValue(0, 0).percent, 0);
});

/* ── 4. smart student insights ───────────────────────────────────────────── */

test('p4-4: rising activity produces a positive insight', () => {
  const metrics = computeLearningMetrics({ dailyStats: [{ day: day(1), questions: 30, correct: 25, wrong: 5, lessons: 2, timeMs: 0 }] }, OPTS);
  const series = dayRange(TODAY, 14).map((d, i) => ({ day: d, questions: i < 7 ? 5 : 30, correct: 0, wrong: 0, lessons: 0, timeMs: 0, active: true }));
  const insights = buildStudentInsights(metrics, { comparison: comparePeriods(series, 7) });
  assert.ok(insights.some(i => i.kind === 'positive' && i.id === 'practice-up'));
});

test('p4-4: falling activity and pending mistakes produce attention signals', () => {
  const metrics = computeLearningMetrics({ dailyStats: [{ day: day(10), questions: 5, correct: 3, wrong: 2, lessons: 0, timeMs: 0 }], mistakes: [{ topic: 'js', misses: 9 }] }, OPTS);
  const insights = buildStudentInsights(metrics, { trend: { practiceActivity: { direction: 'down', strength: 0.4 } } });
  assert.ok(insights.some(i => i.kind === 'attention' && i.id === 'practice-down'));
  assert.ok(insights.some(i => i.kind === 'attention' && i.id === 'mistakes-pending'));
});

test('p4-4: a quiet student gets told how long it has been', () => {
  const metrics = computeLearningMetrics({ dailyStats: [{ day: day(6), questions: 5, correct: 3, wrong: 2, lessons: 0, timeMs: 0 }] }, OPTS);
  const insights = buildStudentInsights(metrics, {});
  assert.ok(insights.some(i => i.id === 'inactive'));
});

test('p4-4: a healthy student is not told anything alarming', () => {
  const metrics = computeLearningMetrics({
    dailyStats: [day(0), day(1), day(2)].map(d => ({ day: d, questions: 20, correct: 18, wrong: 2, lessons: 2, timeMs: 600000 }))
  }, OPTS);
  const insights = buildStudentInsights(metrics, {});
  assert.equal(insights.filter(i => i.kind === 'attention').length, 0);
});

/* ── 5. course analytics ─────────────────────────────────────────────────── */

test('p4-5: course analytics roll up learners, progress and completion', () => {
  const rows = [
    { userId: 'u1', courseId: 'js', lessonsTotal: 10, lessonsDone: 10 },
    { userId: 'u2', courseId: 'js', lessonsTotal: 10, lessonsDone: 5 },
    { userId: 'u3', courseId: 'js', lessonsTotal: 10, lessonsDone: 0 }
  ];
  const events = [
    { name: 'course_view', params: { course_id: 'js' }, at: NOW },
    { name: 'course_start', params: { course_id: 'js' }, at: NOW },
    { name: 'lesson_start', params: { course_id: 'js', lesson_id: 'l1' }, at: NOW },
    { name: 'lesson_complete', params: { course_id: 'js', lesson_id: 'l1' }, at: NOW }
  ];
  const [c] = buildCourseAnalytics(rows, events);
  assert.equal(c.courseId, 'js');
  assert.equal(c.learners, 3);
  assert.equal(c.started, 2);
  assert.equal(c.completed, 1);
  assert.equal(c.progressPercent, 50);
  assert.equal(c.views, 1);
  assert.equal(c.lessonCompletionRate, 100);
});

test('p4-5: a course with no learners is not invented from events alone', () => {
  const out = buildCourseAnalytics([], [{ name: 'course_view', params: { course_id: 'ghost' }, at: NOW }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].learners, 0);
  assert.equal(out[0].completionRate, 0);
});

/* ── 6. lesson performance ───────────────────────────────────────────────── */

test('p4-6: lesson analytics compute completion, time and retry', () => {
  const events = [
    { name: 'lesson_view', params: { course_id: 'js', lesson_id: 'l1' }, at: NOW },
    { name: 'lesson_start', params: { course_id: 'js', lesson_id: 'l1' }, at: NOW },
    { name: 'lesson_start', params: { course_id: 'js', lesson_id: 'l1' }, at: NOW + 1000 },
    { name: 'lesson_complete', params: { course_id: 'js', lesson_id: 'l1', duration: 300000 }, at: NOW + 300000 },
    { name: 'question_attempt', params: { course_id: 'js', lesson_id: 'l1', correct: true }, at: NOW + 300001 },
    { name: 'question_attempt', params: { course_id: 'js', lesson_id: 'l1', correct: false }, at: NOW + 300002 }
  ];
  const [l] = buildLessonAnalytics(events);
  assert.equal(l.lessonId, 'l1');
  assert.equal(l.views, 1);
  assert.equal(l.starts, 2);
  assert.equal(l.completes, 1);
  assert.equal(l.retries, 1);
  assert.equal(l.avgTimeMs, 300000);
  assert.equal(l.completionRate, 0.5);
  assert.equal(l.quizAccuracy, 50);
});

test('p4-6: lesson analytics sorts the worst completion first', () => {
  const events = [
    ...Array.from({ length: 3 }, () => ({ name: 'lesson_start', params: { course_id: 'c', lesson_id: 'good' }, at: NOW })),
    ...Array.from({ length: 3 }, () => ({ name: 'lesson_complete', params: { course_id: 'c', lesson_id: 'good' }, at: NOW })),
    ...Array.from({ length: 3 }, () => ({ name: 'lesson_start', params: { course_id: 'c', lesson_id: 'bad' }, at: NOW }))
  ];
  const out = buildLessonAnalytics(events);
  assert.equal(out[0].lessonId, 'bad');
});

/* ── 7. quiz & practice analytics ────────────────────────────────────────── */

test('p4-7: quiz analytics separate correct, wrong and skipped', () => {
  const events = [
    { name: 'quiz_start', params: { quiz_id: 'q1' }, at: NOW },
    { name: 'question_attempt', params: { quiz_id: 'q1', correct: true, duration: 1000 }, at: NOW },
    { name: 'question_attempt', params: { quiz_id: 'q1', correct: false, duration: 2000 }, at: NOW },
    { name: 'question_attempt', params: { quiz_id: 'q1', skipped: true, duration: 500 }, at: NOW },
    { name: 'quiz_complete', params: { quiz_id: 'q1' }, at: NOW }
  ];
  const [q] = buildQuizAnalytics(events);
  assert.equal(q.attempts, 3);
  assert.equal(q.correct, 1);
  assert.equal(q.wrong, 1);
  assert.equal(q.skipped, 1);
  assert.equal(q.accuracy, 33.3);
  assert.equal(q.completed, 1);
  assert.equal(q.completionRate, 1);
});

test('p4-7: hard topics need a real sample before they are named', () => {
  const events = Array.from({ length: 3 }, () => ({ name: 'question_attempt', params: { quiz_id: 'q1', topic_id: 't1', correct: false }, at: NOW }));
  const [q] = buildQuizAnalytics(events);
  assert.equal(q.hardestTopics.length, 0, 'three attempts is not a signal');
});

/* ── 8. engagement dashboard ─────────────────────────────────────────────── */

test('p4-8: engagement counts active students, not app opens', () => {
  const students = [
    { userId: 'a', activeDays: [TODAY], learningActions: 5 },
    { userId: 'b', activeDays: [day(3)], learningActions: 5 },
    { userId: 'c', activeDays: [day(20)], learningActions: 5 },
    { userId: 'd', activeDays: [], learningActions: 0 }
  ];
  const e = computeEngagement(students, OPTS);
  assert.equal(e.dau, 1);
  assert.equal(e.wau, 2);
  assert.equal(e.mau, 3);
  assert.equal(e.totalStudents, 4);
});

test('p4-8: returning users are those with more than one active day', () => {
  const e = computeEngagement([
    { userId: 'a', activeDays: [TODAY, day(1)] },
    { userId: 'b', activeDays: [TODAY] }
  ], OPTS);
  assert.equal(e.returningUsers, 1);
  assert.equal(e.newUsers, 1);
  assert.equal(e.returningRate, 50);
});

test('p4-8: stickiness is DAU over MAU', () => {
  const e = computeEngagement([
    { userId: 'a', activeDays: [TODAY] },
    { userId: 'b', activeDays: [day(5)] },
    { userId: 'c', activeDays: [day(10)] }
  ], OPTS);
  assert.equal(e.stickiness, 33.3);
});

/* ── 9. retention dashboard ──────────────────────────────────────────────── */

test('p4-9: retention covers D1/D7/D14/D30', () => {
  const r = computeRetention([
    { userId: 'a', activeDays: [day(40), day(39), day(33), day(26), day(10)] },
    { userId: 'b', activeDays: [day(40), day(39)] }
  ], OPTS);
  assert.deepEqual(r.windows.map(w => w.window), RETENTION_WINDOWS);
  assert.equal(r.cohortSize, 2);
});

test('p4-9: an immature cohort cannot drag the rate down', () => {
  /* Joined yesterday — cannot have returned on D7 or D30, so must be excluded
   * from those denominators entirely. */
  const r = computeRetention([{ userId: 'fresh', activeDays: [day(1)] }], OPTS);
  assert.equal(r.byWindow.d1, 0);
  assert.equal(r.byWindow.d7, 0);
  assert.equal(r.windows.find(w => w.window === 7).matureCohortSize, 0);
});

test('p4-9: a student who came back is counted in the window', () => {
  const r = computeRetention([{ userId: 'a', activeDays: [day(30), day(23)] }], OPTS);
  assert.equal(r.byWindow.d1, 100);
  assert.equal(r.byWindow.d7, 100);
});

/* ── 10. drop-off & risk ─────────────────────────────────────────────────── */

test('p4-10: drop-off needs the sample and the rate', () => {
  const small = buildFunnel({ course_view: 3, course_start: 1 });
  assert.equal(detectFunnelDropOff(small).hasAlert, false, '3 students is noise');

  const real = buildFunnel({ course_view: 20, course_start: 18, lesson_start: 16, lesson_complete: 5, quiz_start: 4, quiz_complete: 3 });
  const drop = detectFunnelDropOff(real);
  assert.equal(drop.hasAlert, true);
  assert.equal(drop.steepest, 'lesson_complete');
  assert.ok(drop.message.includes('পাঠ'));
});

test('p4-10: the funnel steps and thresholds match the Phase 2 engine', () => {
  assert.equal(FUNNEL_STEPS.length, 6);
  assert.equal(FUNNEL_STEPS[0].event, 'course_view');
  assert.equal(FUNNEL_STEPS[5].event, 'quiz_complete');
  assert.equal(DROPOFF_ALERT_RATE, 0.4);
  assert.equal(DROPOFF_MIN_SAMPLE, 5);
});

test('p4-10: a healthy funnel raises no alert', () => {
  const ok = buildFunnel({ course_view: 20, course_start: 19, lesson_start: 18, lesson_complete: 17, quiz_start: 16, quiz_complete: 15 });
  assert.equal(detectFunnelDropOff(ok).hasAlert, false);
});

/* ── 11. student segmentation ────────────────────────────────────────────── */

test('p4-11: every behaviour segment is reachable', () => {
  const mk = (daysSince, activeDays, extra = {}) => classifyBehaviourSegment({ daysSinceActive: daysSince, activeDays, streak: 0, ...extra }, { today: TODAY });
  assert.equal(mk(null, 0).segment, 'new');
  assert.equal(mk(20, 5).segment, 'inactive');
  assert.equal(mk(5, 5).segment, 'at_risk');
  assert.equal(mk(1, 2).segment, 'new');
  assert.equal(mk(0, 12).segment, 'highly_active');
  assert.equal(mk(0, 4).segment, 'active');
  assert.equal(mk(0, 3, { hadGap: true }).segment, 'returning');
  /* "Returning" is also derived from the student's own day history, so the admin
   * segmentation — which has no caller hint — can still produce it. */
  const returned = computeLearningMetrics({ dailyStats: [{ day: day(20), questions: 5, correct: 3, wrong: 2, lessons: 0, timeMs: 0 }, { day: TODAY, questions: 5, correct: 3, wrong: 2, lessons: 0, timeMs: 0 }, { day: day(1), questions: 5, correct: 3, wrong: 2, lessons: 0, timeMs: 0 }] }, OPTS);
  assert.equal(returned.hadGap, true);
  assert.equal(classifyBehaviourSegment(returned, { today: TODAY }).segment, 'returning');
  /* Every segment the list advertises must actually be produced by the rules —
   * a label nothing can reach is a filter that silently matches nobody. */
  const produced = new Set([
    mk(null, 0).segment, mk(20, 5).segment, mk(5, 5).segment,
    mk(0, 12).segment, mk(0, 4).segment, classifyBehaviourSegment(returned, { today: TODAY }).segment
  ]);
  assert.deepEqual([...produced].sort(), [...SEGMENTS].sort());
});

test('p4-11: a strong streak makes a student highly active', () => {
  assert.equal(classifyBehaviourSegment({ daysSinceActive: 0, activeDays: 3, streak: 9 }, { today: TODAY }).segment, 'highly_active');
});

test('p4-11: learning stage is separate from behaviour segment', () => {
  assert.equal(classifyLearningStage({ lessonsCompleted: 0, practiceActivity: 5, courseProgress: {} }).stage, 'beginner');
  assert.equal(classifyLearningStage({ lessonsCompleted: 15, practiceActivity: 150, courseProgress: {} }).stage, 'intermediate');
  assert.equal(classifyLearningStage({ lessonsCompleted: 50, practiceActivity: 600, courseProgress: {} }).stage, 'pro');
});

test('p4-11: a falling trend moves an otherwise-fine student to at risk', () => {
  const seg = classifyBehaviourSegment({ daysSinceActive: 0, activeDays: 4, streak: 0 }, { today: TODAY, trend: { direction: 'down', strength: 0.4 } });
  assert.equal(seg.segment, 'at_risk');
});

/* ── 12. notification analytics ──────────────────────────────────────────── */

test('p4-12: notification analytics count sent/opened/clicked/learning', () => {
  const outcomes = [
    { notification_key: 'k1', category: 'streak', kind: 'streak_risk', variant: 'A', sent_at: NOW, opened_at: NOW, clicked_at: NOW, learning_at: NOW, learning_kind: 'question_attempt' },
    { notification_key: 'k2', category: 'streak', kind: 'streak_risk', variant: 'A', sent_at: NOW, opened_at: NOW, clicked_at: 0, learning_at: 0, learning_kind: '' },
    { notification_key: 'k3', category: 'learning', kind: 'weak_topic', variant: 'B', sent_at: NOW, opened_at: 0, clicked_at: 0, learning_at: 0, learning_kind: '' }
  ];
  const a = computeNotificationAnalytics(outcomes);
  assert.equal(a.overall.sent, 3);
  assert.equal(a.overall.opened, 2);
  assert.equal(a.overall.clicked, 1);
  assert.equal(a.overall.learning, 1);
  assert.equal(a.overall.learningConversion, 33.3);
  assert.equal(a.overall.openRate, 66.7);
});

test('p4-12: a learning outcome with an unknown kind is not counted as learning', () => {
  const a = computeNotificationAnalytics([
    { notification_key: 'k1', sent_at: NOW, learning_at: NOW, learning_kind: 'not-a-learning-kind' }
  ]);
  assert.equal(a.overall.learning, 0);
});

test('p4-12: notification conversion is the headline metric', () => {
  const a = computeNotificationAnalytics([
    { notification_key: 'k1', category: 'achievement', sent_at: NOW, opened_at: NOW, clicked_at: NOW, learning_at: NOW, learning_kind: 'lesson_complete' }
  ]);
  assert.equal(a.bestCategory.key, 'achievement');
  assert.equal(a.bestCategory.learningConversion, 100);
});

/* ── 13. campaign analytics ──────────────────────────────────────────────── */

test('p4-13: campaign analytics join sends to reads', () => {
  const c = computeCampaignAnalytics([
    { id: 'c1', type: 'global', audience: 'all_students', topic: 'all', status: 'sent', sent_at: NOW, delivered: 100 },
    { id: 'c2', type: 'global', audience: 'all_students', topic: 'all', status: 'scheduled', scheduled_at: NOW + 1000, delivered: 0 }
  ], { c1: 25 });
  assert.equal(c[0].campaignId, 'c1');
  assert.equal(c[0].openRate, 25);
  assert.equal(c[0].isLive, true);
  assert.equal(c.find(x => x.campaignId === 'c2').isLive, false);
});

test('p4-13: campaigns with too little reach are not ranked', () => {
  const ranked = rankCampaigns([
    { campaignId: 'tiny', isLive: true, delivered: 2, openRate: 100 },
    { campaignId: 'real', isLive: true, delivered: 50, openRate: 30 }
  ]);
  assert.equal(ranked.ranked.length, 1);
  assert.equal(ranked.best.campaignId, 'real');
});

/* ── 14. comparison engine ───────────────────────────────────────────────── */

test('p4-14: today vs yesterday, this week vs last week', () => {
  const series = dayRange(TODAY, 14).map((d, i) => ({ day: d, questions: i === 13 ? 50 : 10, correct: 0, wrong: 0, lessons: 0, timeMs: 0, active: true }));
  const week = comparePeriods(series, 7);
  assert.equal(week.metrics.practiceActivity.current, 110);
  assert.equal(week.metrics.practiceActivity.previous, 70);
  const day2 = comparePeriods(series, 1);
  assert.equal(day2.metrics.practiceActivity.current, 50);
});

/* ── 15. trend detection ─────────────────────────────────────────────────── */

test('p4-15: a rising series is detected as up and a falling one as down', () => {
  assert.equal(linearTrend([1, 2, 3, 4, 5, 6, 7]).direction, 'up');
  assert.equal(linearTrend([7, 6, 5, 4, 3, 2, 1]).direction, 'down');
});

test('p4-15: noise is not a trend', () => {
  assert.equal(linearTrend([10, 10, 10, 10, 10, 10, 10]).direction, 'flat');
  assert.equal(linearTrend([5, 5]).direction, 'flat', 'two points is not a trend');
});

test('p4-15: the summary sentence combines a rise and a fall', () => {
  const s = summarizeTrends({ lessonsCompleted: { direction: 'up' }, practiceActivity: { direction: 'down' } });
  assert.ok(s.text.includes('বাড়ছে'));
  assert.ok(s.text.includes('কমছে'));
  assert.ok(s.text.includes('কিন্তু'));
});

test('p4-15: an unchanged period says so rather than inventing a trend', () => {
  assert.ok(summarizeTrends({ practiceActivity: { direction: 'flat' } }).text.includes('স্থির'));
});

/* ── 16. goal & milestone insights ───────────────────────────────────────── */

test('p4-16: the next milestone is the nearest one, with lessons remaining', () => {
  const m = computeMilestones({ courseProgress: { percent: 42, lessonsDone: 42, lessonsTotal: 100 }, streak: 3, practiceActivity: 30 });
  const course = m.milestones.find(x => x.kind === 'course_progress');
  assert.equal(course.target, 50);
  assert.equal(course.lessonsNeeded, 8);
  assert.ok(course.message.includes('৫০'.replace('৫০', '50')));
});

test('p4-16: milestones cover streak and practice too', () => {
  const m = computeMilestones({ courseProgress: { percent: 100, lessonsDone: 10, lessonsTotal: 10 }, streak: 5, practiceActivity: 90 });
  assert.equal(m.milestones.find(x => x.kind === 'streak').target, 7);
  assert.equal(m.milestones.find(x => x.kind === 'practice').target, 100);
});

/* ── 17. admin smart insights ────────────────────────────────────────────── */

test('p4-17: admin insights name the engaged course, the drop-off lesson and the best category', () => {
  const insights = buildAdminInsights({
    courses: [
      { courseId: 'javascript', learners: 40, lessonCompletionRate: 0.8 },
      { courseId: 'react', learners: 20, lessonCompletionRate: 0.7 }
    ],
    lessons: [
      { courseId: 'javascript', lessonId: '23', starts: 20, completionRate: 0.2 },
      { courseId: 'javascript', lessonId: '24', starts: 20, completionRate: 0.9 }
    ],
    quizzes: [{ quizId: 'q1', attempts: 30, accuracy: 40 }],
    notifications: { bestCategory: { key: 'achievement', sent: 40, learningConversion: 25 } }
  });
  assert.ok(insights.some(i => i.id === 'most-engaged-course' && i.text.includes('javascript')));
  assert.ok(insights.some(i => i.id === 'lesson-dropoff' && i.text.includes('23')));
  assert.ok(insights.some(i => i.id === 'hardest-quiz'));
  assert.ok(insights.some(i => i.id === 'best-notification-category' && i.text.includes('achievement')));
});

test('p4-17: admin insights do not name a lesson from a tiny sample', () => {
  const insights = buildAdminInsights({ lessons: [{ courseId: 'c', lessonId: 'l', starts: 2, completionRate: 0 }] });
  assert.equal(insights.filter(i => i.id === 'lesson-dropoff').length, 0);
});

test('p4-17: an empty platform produces no insights, not false ones', () => {
  assert.equal(buildAdminInsights({}).length, 0);
});

/* ── 18. analytics filters ───────────────────────────────────────────────── */

test('p4-18: filters parse a day window and every dimension', () => {
  const url = new URL('https://x/api/analytics/courses?days=7&course=js&lesson=l1&category=streak&segment=at_risk&type=streak_risk&platform=android');
  const f = parseFilters(url, NOW);
  assert.equal(f.days, 7);
  assert.equal(f.course, 'js');
  assert.equal(f.lesson, 'l1');
  assert.equal(f.category, 'streak');
  assert.equal(f.segment, 'at_risk');
  assert.equal(f.notificationType, 'streak_risk');
  assert.equal(f.platform, 'android');
  assert.equal(f.untilMs, NOW);
});

test('p4-18: a nonsense day count is clamped, never trusted', () => {
  assert.equal(parseFilters(new URL('https://x/api/analytics/courses?days=99999'), NOW).days, 365);
  assert.equal(parseFilters(new URL('https://x/api/analytics/courses?days=-5'), NOW).days, 1);
});

test('p4-18: applyFilters narrows events, courses and outcomes together', () => {
  const f = { sinceMs: NOW - 1000, untilMs: NOW + 1000, course: 'js', lesson: '', category: '', segment: '', notificationType: '', platform: '' };
  const out = applyFilters({
    events: [
      { name: 'lesson_complete', params: { course_id: 'js', lesson_id: 'l1' }, at: NOW },
      { name: 'lesson_complete', params: { course_id: 'react', lesson_id: 'l1' }, at: NOW }
    ],
    courses: [{ courseId: 'js' }, { courseId: 'react' }],
    lessons: [{ courseId: 'js', lessonId: 'l1' }, { courseId: 'react', lessonId: 'l1' }],
    quizzes: [], campaigns: [], outcomes: [], segments: []
  }, f);
  assert.equal(out.events.length, 1);
  assert.equal(out.courses.length, 1);
  assert.equal(out.lessons.length, 1);
});

test('p4-18: an event outside the window is filtered out', () => {
  const f = { sinceMs: NOW - 1000, untilMs: NOW, course: '', lesson: '', category: '', segment: '', notificationType: '', platform: '' };
  const out = applyFilters({ events: [{ name: 'lesson_complete', params: {}, at: NOW - 5000 }], courses: [], lessons: [], quizzes: [], campaigns: [], outcomes: [], segments: [] }, f);
  assert.equal(out.events.length, 0);
});

/* ── 19. access control ──────────────────────────────────────────────────── */

test('p4-19: the student route refuses a request with no session', async () => {
  const store = new AnalyticsStore(makeFakeD1());
  const res = await handleAnalyticsRequest(new Request('https://x/api/analytics/me'), { PROFILE_DB: {}, ADMIN_TOKEN: 'secret' }, {}, { store, sessionUser: async () => null });
  assert.equal(res.status, 401);
});

test('p4-19: the student route reads the session user, not a query param', async () => {
  const store = new AnalyticsStore(makeFakeD1({
    dailyStats: [
      { user_id: 'victim', day: day(1), questions: 99, correct: 99, wrong: 0, lessons: 0, timeMs: 0 },
      { user_id: 'me', day: day(1), questions: 1, correct: 1, wrong: 0, lessons: 0, timeMs: 0 }
    ]
  }));
  const res = await handleAnalyticsRequest(
    new Request('https://x/api/analytics/me?user=victim'),
    { PROFILE_DB: {}, ADMIN_TOKEN: 'secret' }, {},
    { store, sessionUser: async () => ({ user: { id: 'me' } }) }
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.userId, 'me');
  assert.equal(body.metrics.practiceActivity, 1, 'a query param must not widen the scope');
});

test('p4-19: admin routes are forbidden without the token', async () => {
  const store = new AnalyticsStore(makeFakeD1());
  const res = await handleAnalyticsRequest(new Request('https://x/api/analytics/overview'), { PROFILE_DB: {}, ADMIN_TOKEN: 'secret' }, {}, { store });
  assert.equal(res.status, 403);
});

test('p4-19: admin routes accept the right token', async () => {
  const store = new AnalyticsStore(makeFakeD1());
  const res = await handleAnalyticsRequest(
    new Request('https://x/api/analytics/overview', { headers: { Authorization: 'Bearer secret' } }),
    { PROFILE_DB: {}, ADMIN_TOKEN: 'secret' }, {}, { store }
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.scope, 'admin');
});

test('p4-19: no admin token configured means admin is closed, not open', async () => {
  const store = new AnalyticsStore(makeFakeD1());
  const res = await handleAnalyticsRequest(new Request('https://x/api/analytics/overview'), { PROFILE_DB: {} }, {}, { store });
  assert.equal(res.status, 403);
});

test('p4-19: the handler declines routes it does not own', async () => {
  const res = await handleAnalyticsRequest(new Request('https://x/api/notifications/status'), {}, {}, {});
  assert.equal(res, null);
});

test('p4-19: storage unavailable is reported, not crashed on', async () => {
  const res = await handleAnalyticsRequest(new Request('https://x/api/analytics/me'), {}, {}, { store: { available: () => false } });
  assert.equal(res.status, 503);
});

/* ── 20. AI-ready signal layer ───────────────────────────────────────────── */

test('p4-20: the admin dashboard exposes structured signals for Phase 5', async () => {
  const store = new AnalyticsStore(makeFakeD1({
    events: [
      { user_id: 'u1', id: 'e1', name: 'course_view', params_json: '{}', at: NOW },
      { user_id: 'u1', id: 'e2', name: 'lesson_complete', params_json: '{"course_id":"js","lesson_id":"l1"}', at: NOW }
    ],
    dailyStats: [{ user_id: 'u1', day: TODAY, questions: 10, correct: 8, wrong: 2, lessons: 1, timeMs: 600000 }],
    outcomes: [{ notification_key: 'k1', kind: 'streak_risk', category: 'streak', variant: 'A', day_key: TODAY, sent_at: NOW, opened_at: NOW, clicked_at: NOW, learning_at: NOW, learning_kind: 'question_attempt' }]
  }));
  const d = await buildAdminDashboard(store, { ...parseFilters(new URL('https://x/api/analytics/overview?days=30'), NOW), today: TODAY });
  assert.ok(d.signals.funnel);
  assert.ok(d.signals.insights);
  assert.ok(d.signals.trends);
  assert.ok('notificationConversion' in d.signals);
  assert.equal(typeof d.signals.dropOff.hasAlert, 'boolean');
});

test('p4-20: the signal layer is JSON-serializable, so the AI layer can take it', async () => {
  const store = new AnalyticsStore(makeFakeD1());
  const d = await buildAdminDashboard(store, { ...parseFilters(new URL('https://x/api/analytics/overview'), NOW), today: TODAY });
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(d.signals)));
});

test('p4-20: the admin payload never carries a per-student row', async () => {
  const store = new AnalyticsStore(makeFakeD1({
    dailyStats: [{ user_id: 'student-1', day: TODAY, questions: 10, correct: 8, wrong: 2, lessons: 1, timeMs: 0 }]
  }));
  const d = await buildAdminDashboard(store, { ...parseFilters(new URL('https://x/api/analytics/overview'), NOW), today: TODAY });
  const text = JSON.stringify(d);
  assert.ok(!text.includes('student-1'), 'aggregate view must not leak a user id');
});

/* ── routes ──────────────────────────────────────────────────────────────── */

test('p4-routes: the events route is idempotent on (user, id)', async () => {
  const fake = makeFakeD1();
  const store = new AnalyticsStore(fake);
  const body = { events: [{ id: 'e1', name: 'lesson_complete', params: { course_id: 'js', lesson_id: 'l1' }, at: NOW }] };
  const mk = () => new Request('https://x/api/analytics/events', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  const env = { PROFILE_DB: {}, ADMIN_TOKEN: 'secret' };
  const deps = { store, sessionUser: async () => ({ user: { id: 'u1' } }) };
  const first = await (await handleAnalyticsRequest(mk(), env, {}, deps)).json();
  const second = await (await handleAnalyticsRequest(mk(), env, {}, deps)).json();
  assert.equal(first.stored, 1);
  assert.equal(second.stored, 0, 'a replayed flush must not double-count');
  assert.equal(fake._s.events.length, 1);
});

test('p4-routes: each admin view is served from the same dashboard build', async () => {
  const store = new AnalyticsStore(makeFakeD1({
    dailyStats: [{ user_id: 'u1', day: TODAY, questions: 10, correct: 8, wrong: 2, lessons: 1, timeMs: 600000 }]
  }));
  const env = { PROFILE_DB: {}, ADMIN_TOKEN: 'secret' };
  for (const view of ['courses', 'lessons', 'quizzes', 'engagement', 'retention', 'notifications', 'campaigns', 'segments', 'funnel', 'insights', 'trends', 'signals']) {
    const res = await handleAnalyticsRequest(
      new Request(`https://x${ANALYTICS_PREFIX}${view}`, { headers: { Authorization: 'Bearer secret' } }),
      env, {}, { store }
    );
    assert.equal(res.status, 200, `${view} failed`);
    assert.ok(view in await res.json(), `${view} missing from payload`);
  }
});

test('p4-routes: an unknown admin view is a 404, not an empty 200', async () => {
  const store = new AnalyticsStore(makeFakeD1());
  const res = await handleAnalyticsRequest(
    new Request(`https://x${ANALYTICS_PREFIX}nonsense`, { headers: { Authorization: 'Bearer secret' } }),
    { PROFILE_DB: {}, ADMIN_TOKEN: 'secret' }, {}, { store }
  );
  assert.equal(res.status, 404);
});

test('p4-routes: CORS preflight is answered for our own path only', async () => {
  const res = await handleAnalyticsRequest(new Request('https://x/api/analytics/me', { method: 'OPTIONS' }), {}, {}, {});
  assert.equal(res.status, 204);
  const foreign = await handleAnalyticsRequest(new Request('https://x/api/other', { method: 'OPTIONS' }), {}, {}, {});
  assert.equal(foreign, null);
});

/* ── helpers ─────────────────────────────────────────────────────────────── */

test('p4-helpers: dayKey uses the student\'s local day, not UTC', () => {
  /* 2026-09-24T20:00Z is 2026-09-25 02:00 in Dhaka. */
  const ts = Date.UTC(2026, 8, 24, 20, 0, 0);
  assert.equal(dayKey(ts, 360), '2026-09-25');
  assert.equal(dayKey(ts, 0), '2026-09-24');
});

test('p4-helpers: a streak that ends yesterday is still alive', () => {
  assert.equal(liveStreak([day(1), day(2), day(3)], TODAY), 3);
  assert.equal(liveStreak([day(2), day(3)], TODAY), 0, 'a missed today and yesterday breaks it');
  assert.equal(liveStreak([TODAY, day(1)], TODAY), 2);
});

test('p4-helpers: streak counting and longest-streak agree', () => {
  assert.equal(computeStreak([day(5), day(4), day(3), day(1)]), 3);
});

test('p4-helpers: dayRange always returns one entry per day', () => {
  const r = dayRange(TODAY, 7);
  assert.equal(r.length, 7);
  assert.equal(r[6], TODAY);
  assert.equal(r[0], day(6));
});

test('p4-helpers: daysBetween is calendar-correct across a month end', () => {
  assert.equal(daysBetween('2026-08-31', '2026-09-01'), 1);
});

test('p4-helpers: an empty store still produces a valid dashboard', async () => {
  const store = new AnalyticsStore(makeFakeD1());
  const d = await buildStudentDashboard(store, 'nobody', { today: TODAY, filters: { sinceMs: NOW - 86400000, untilMs: NOW, tzOffsetMin: 360 } });
  assert.equal(d.metrics.practiceActivity, 0);
  assert.equal(d.metrics.accuracy, 0);
  assert.deepEqual(d.insights, []);
  assert.equal(d.dropOff.hasAlert, false);
});

test('p4-helpers: milestone list is ordered so the nearest is surfaced', () => {
  assert.ok(MILESTONES[0] < MILESTONES[MILESTONES.length - 1]);
  assert.ok(INSIGHT_KINDS.includes('attention'));
});
