/* Phase 4 — analytics engine against a real database.
 *
 * The unit tests use a fake D1 that pattern-matches SQL, which proves the
 * metric math but cannot catch a wrong column, a wrong table, or a JSON path
 * that does not exist in the real document. This file closes that gap: it runs
 * the engine's actual statements against a real SQLite database built from the
 * real Phase 1–3 DDL, so a schema mismatch fails here instead of in production.
 *
 * No network, no worker: the engine is called directly with the same store the
 * route handler uses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AnalyticsStore, buildStudentDashboard, buildAdminDashboard, parseFilters } from './analytics-engine.mjs';
import { UserDataStore } from './userdata-api.mjs';

const NOW = Date.UTC(2026, 8, 24, 4, 0, 0);
const TODAY = '2026-09-24';
const DAY = 86400000;
const day = (n) => new Date(NOW - n * DAY).toISOString().slice(0, 10);

/* A D1-shaped facade over better-sqlite3, the same shape the other sqlite tests
 * use: prepare().bind().all()/first()/run(). */
function d1From(database) {
  const wrap = (statement, bindings) => ({
    async run() {
      const prepared = database.prepare(statement);
      const info = prepared.run(...bindings);
      return { meta: { changes: info.changes }, results: [] };
    },
    async first() {
      const prepared = database.prepare(statement);
      return prepared.reader ? (prepared.get(...bindings) ?? null) : (prepared.run(...bindings), null);
    },
    async all() {
      const prepared = database.prepare(statement);
      return { results: prepared.reader ? prepared.all(...bindings) : (prepared.run(...bindings), []) };
    }
  });
  return {
    prepare: (statement) => ({ bind: (...bindings) => wrap(statement, bindings), ...wrap(statement, []) }),
    async batch(statements) { const out = []; for (const s of statements) out.push(await s.run()); return out; }
  };
}

/* Builds the real Phase 1–3 tables using the real store, then seeds rows through
 * that store's own write path — so the seed is shaped exactly like production. */
async function fixture() {
  const database = new Database(':memory:');
  const d1 = d1From(database);
  const userdata = new UserDataStore(d1);
  await userdata.init();
  const analytics = new AnalyticsStore(d1);
  await analytics.init();

  /* Phase 3 tables the analytics reads (created by their own modules in prod). */
  database.exec(`CREATE TABLE IF NOT EXISTS notification_outcomes (
    notification_key TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT, category TEXT, variant TEXT,
    day_key TEXT, sent_at INTEGER NOT NULL, opened_at INTEGER, clicked_at INTEGER, learning_at INTEGER,
    learning_kind TEXT, PRIMARY KEY (user_id, notification_key, sent_at))`);
  database.exec(`CREATE TABLE IF NOT EXISTS global_notifications (
    id TEXT PRIMARY KEY, type TEXT, audience TEXT, topic TEXT, status TEXT,
    sent_at INTEGER, scheduled_at INTEGER, delivered INTEGER DEFAULT 0)`);
  database.exec(`CREATE TABLE IF NOT EXISTS notification_reads (
    notification_id TEXT NOT NULL, user_id TEXT NOT NULL, read_at INTEGER, PRIMARY KEY (notification_id, user_id))`);
  database.exec(`CREATE TABLE IF NOT EXISTS fcm_devices (user_id TEXT NOT NULL, token TEXT NOT NULL, PRIMARY KEY (user_id, token))`);

  /* Seed through the real write path, so the stored document shape is exactly
   * what production stores — not a hand-built row that could hide a mismatch. */
  const put = async (store, userId, id, doc, opts = {}) => userdata.applyOp(userId, 'test-device', {
    store, id, doc, op: opts.deleted ? 'delete' : 'put', updated_at: opts.updatedAt ?? NOW
  });
  return { database, d1, userdata, analytics, put };
}

const filters = (days = 30) => ({ ...parseFilters(new URL(`https://x/api/analytics/overview?days=${days}`), NOW), today: TODAY, tzOffsetMin: 360 });

/* ── schema ──────────────────────────────────────────────────────────────── */

test('p4db-1: the engine reads the real daily-stats document shape', async () => {
  const { analytics, put, database } = await fixture();
  /* Write through the real userdata store — the same path the app uses. */
  await put('dailyStats', 'u1', TODAY, { questions: 12, correct: 9, wrong: 3, lessons: 2, timeMs: 900000 });
  await put('dailyStats', 'u1', day(1), { questions: 8, correct: 6, wrong: 2, lessons: 1, timeMs: 600000 });
  const rows = await analytics.dailyStats('u1', 30);
  assert.equal(rows.length, 2);
  const today = rows.find(r => r.day === TODAY);
  assert.equal(today.questions, 12);
  assert.equal(today.lessons, 2);
  assert.equal(today.timeMs, 900000, 'timeMs must come from the payload, not a column');

  /* The platform aggregate must use the same JSON path and agree. */
  const agg = await analytics.studentSnapshots(NOW - 30 * DAY);
  assert.equal(agg.length, 1);
  assert.equal(agg[0].questions, 20);
  assert.equal(agg[0].lessons, 3);
  assert.equal(agg[0].timeMs, 1500000);
  assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='analytics_events'").get());
});

test('p4db-1: a soft-deleted day is invisible to analytics', async () => {
  const { analytics, put } = await fixture();
  await put('dailyStats', 'u1', TODAY, { questions: 12, correct: 9, wrong: 3, lessons: 2, timeMs: 900000 });
  await put('dailyStats', 'u1', day(1), { questions: 8, correct: 6, wrong: 2, lessons: 1, timeMs: 600000 });
  await put('dailyStats', 'u1', day(2), { questions: 99, correct: 99, wrong: 0, lessons: 9, timeMs: 1 }, { deleted: true, updatedAt: NOW + 1 });
  const rows = await analytics.dailyStats('u1', 30);
  assert.equal(rows.length, 2, 'a deleted day must not be counted');
});

test('p4db-2: course progress is read from the real user_settings document', async () => {
  const { analytics, put } = await fixture();
  await put('settings', 'u1', 'settings', {
    courses: [{ id: 'javascript', lessonsTotal: 20, lessonsDone: 8 }],
    streak: 4
  });
  const courses = await analytics.courses('u1');
  assert.equal(courses.length, 1);
  assert.equal(courses[0].id, 'javascript');
  assert.equal(courses[0].lessonsDone, 8);
  assert.equal(courses[0].lessonsTotal, 20);
});

/* ── ingest ──────────────────────────────────────────────────────────────── */

test('p4db-3: ingest is idempotent against a real UNIQUE constraint', async () => {
  const { analytics, database } = await fixture();
  const events = [
    { id: 'ev-1', name: 'lesson_complete', params: { course_id: 'js', lesson_id: 'l1' }, at: NOW },
    { id: 'ev-2', name: 'question_attempt', params: { quiz_id: 'q1', correct: true }, at: NOW }
  ];
  const first = await analytics.ingestEvents('u1', events, NOW);
  assert.equal(first.stored, 2);
  const second = await analytics.ingestEvents('u1', events, NOW);
  assert.equal(second.stored, 0, 'a replay must store nothing new');
  const count = database.prepare('SELECT COUNT(*) AS n FROM analytics_events').get();
  assert.equal(count.n, 2);
});

test('p4db-3: a malformed event is skipped, not stored as a ghost row', async () => {
  const { analytics, database } = await fixture();
  const res = await analytics.ingestEvents('u1', [
    { name: 'lesson_complete' },          // no id
    { id: 'ok', name: 'lesson_complete', params: {}, at: NOW },
    { id: 'no-name' }                     // no name
  ], NOW);
  assert.equal(res.stored, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM analytics_events').get().n, 1);
});

test('p4db-3: events round-trip through params_json intact', async () => {
  const { analytics } = await fixture();
  await analytics.ingestEvents('u1', [
    { id: 'ev-1', name: 'lesson_complete', params: { course_id: 'js', lesson_id: 'l1', duration: 12345 }, at: NOW }
  ], NOW);
  const events = await analytics.userEvents('u1', NOW - DAY);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].params, { course_id: 'js', lesson_id: 'l1', duration: 12345 });
});

/* ── end-to-end dashboards ───────────────────────────────────────────────── */

test('p4db-4: a student dashboard is built entirely from real rows', async () => {
  const { analytics, put } = await fixture();
  for (const [d, q, c, l, t] of [[TODAY, 20, 15, 3, 1800000], [day(1), 10, 8, 1, 900000], [day(2), 15, 12, 2, 1200000]]) {
    await put('dailyStats', 'u1', d, { questions: q, correct: c, wrong: q - c, lessons: l, timeMs: t });
  }
  await put('settings', 'u1', 'settings', { courses: [{ id: 'js', lessonsTotal: 20, lessonsDone: 6 }] });
  await put('mistakes', 'u1', 'm1', { topic: 'closures', misses: 4 });

  const dash = await buildStudentDashboard(analytics, 'u1', { today: TODAY, filters: filters(30) });
  assert.equal(dash.metrics.practiceActivity, 45);
  assert.equal(dash.metrics.lessonsCompleted, 6);
  assert.equal(dash.metrics.learningMinutes, 65);
  assert.equal(dash.metrics.activeDays, 3);
  assert.equal(dash.metrics.streak, 3);
  assert.equal(dash.metrics.courseProgress.percent, 30);
  assert.equal(dash.metrics.accuracy, 77.8);
  assert.equal(dash.metrics.series.length, 14);
});

test('p4db-4: the admin dashboard aggregates across students, not per student', async () => {
  const { analytics, put } = await fixture();
  await put('dailyStats', 'u1', TODAY, { questions: 20, correct: 15, wrong: 5, lessons: 3, timeMs: 1800000 });
  await put('dailyStats', 'u2', TODAY, { questions: 10, correct: 5, wrong: 5, lessons: 1, timeMs: 600000 });
  await put('dailyStats', 'u3', day(5), { questions: 5, correct: 4, wrong: 1, lessons: 0, timeMs: 300000 });

  const dash = await buildAdminDashboard(analytics, filters(30));
  assert.equal(dash.scope, 'admin');
  assert.equal(dash.engagement.dau, 2, 'two students were active today');
  assert.equal(dash.engagement.mau, 3);
  assert.equal(dash.totals.students, 3);
  const text = JSON.stringify(dash);
  assert.ok(!text.includes('"u1"'), 'no student id may appear in the admin payload');
});

test('p4db-5: notification outcomes are joined to their campaigns for real', async () => {
  const { analytics, database } = await fixture();
  database.exec(`INSERT INTO global_notifications(id,type,audience,topic,status,sent_at,delivered)
    VALUES ('c1','global','all_students','all','sent',${NOW},100)`);
  database.exec(`INSERT INTO notification_reads(notification_id,user_id,read_at) VALUES ('c1','u1',${NOW}),('c1','u2',${NOW})`);
  database.exec(`INSERT INTO notification_outcomes(notification_key,user_id,kind,category,variant,day_key,sent_at,opened_at,clicked_at,learning_at,learning_kind)
    VALUES ('k1','u1','streak_risk','streak','A','${TODAY}',${NOW},${NOW},${NOW},${NOW},'question_attempt'),
           ('k2','u2','streak_risk','streak','A','${TODAY}',${NOW},${NOW},0,0,'')`);

  const dash = await buildAdminDashboard(analytics, filters(30));
  assert.equal(dash.notifications.overall.sent, 2);
  assert.equal(dash.notifications.overall.learning, 1);
  assert.equal(dash.notifications.overall.learningConversion, 50);
  const campaign = dash.campaigns.ranked.find(c => c.campaignId === 'c1');
  assert.ok(campaign, 'the sent campaign must be ranked');
  assert.equal(campaign.opened, 2);
  assert.equal(campaign.openRate, 2);
  assert.equal(dash.campaigns.best.campaignId, 'c1');
});

test('p4db-6: the whole admin payload is JSON-serializable from real data', async () => {
  const { analytics, put, database } = await fixture();
  await put('dailyStats', 'u1', TODAY, { questions: 20, correct: 15, wrong: 5, lessons: 3, timeMs: 1800000 });
  await analytics.ingestEvents('u1', [
    { id: 'e1', name: 'course_view', params: { course_id: 'js' }, at: NOW },
    { id: 'e2', name: 'lesson_complete', params: { course_id: 'js', lesson_id: 'l1' }, at: NOW }
  ], NOW);
  database.exec(`INSERT INTO fcm_devices(user_id,token) VALUES ('u1','tok-1')`);
  const dash = await buildAdminDashboard(analytics, filters(30));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(dash.signals)));
  assert.equal(dash.totals.devices, 1);
});

test('p4db-7: a window that excludes every row yields zeros, not a crash', async () => {
  const { analytics, put } = await fixture();
  await put('dailyStats', 'u1', day(200), { questions: 99, correct: 99, wrong: 0, lessons: 9, timeMs: 1 });
  const dash = await buildAdminDashboard(analytics, filters(7));
  assert.equal(dash.engagement.mau, 0);
  assert.equal(dash.totals.students, 0);
});

/* ── fresh-database robustness ───────────────────────────────────────────── */

test('p4db-8: every read survives a database where no feature table exists yet', async () => {
  /* Regression: the engine reads eight tables owned by other modules. On a
   * fresh database — or a first request that reaches analytics before those
   * features have run — a raw SELECT threw "no such table" and the admin route
   * answered 500. The fake D1 in the unit tests returned [] for any unknown
   * query, so 92 passing tests never saw it. Each read must now report "no
   * data" and let the metric render as zero. */
  const database = new Database(':memory:');
  const analytics = new AnalyticsStore(d1From(database));
  await analytics.init(); /* creates only analytics_events */

  const results = await Promise.all([
    analytics.studentSnapshots(NOW - 30 * DAY),
    analytics.dailyStats('u1', 30),
    analytics.examResults('u1'),
    analytics.mistakes('u1'),
    analytics.courses('u1'),
    analytics.courseRows(NOW - 30 * DAY),
    analytics.notificationOutcomes(NOW - 30 * DAY),
    analytics.userOutcomes('u1', NOW - 30 * DAY),
    analytics.globalNotifications(NOW - 30 * DAY),
    analytics.readCounts(),
    analytics.deviceCount(),
    analytics.eventsSince(NOW - 30 * DAY),
    analytics.userEvents('u1', NOW - 30 * DAY)
  ]);
  for (const value of results) {
    if (Array.isArray(value)) assert.equal(value.length, 0);
    else if (value && typeof value === 'object') assert.equal(Object.keys(value).length, 0);
    else assert.equal(value, 0);
  }

  /* And the dashboards must build, not throw. */
  const admin = await buildAdminDashboard(analytics, filters(30));
  assert.equal(admin.engagement.mau, 0);
  assert.equal(admin.totals.students, 0);
  const student = await buildStudentDashboard(analytics, 'u1', { today: TODAY, filters: filters(30) });
  assert.equal(student.metrics.practiceActivity, 0);
});

test('p4db-8: the missing-schema guard is narrow, not a blanket catch', async () => {
  /* The guard must only swallow "the table does not exist yet". A missing
   * column means the table is there but its schema is not what the engine was
   * written against — a deployment fault that must surface, not be rendered as
   * zeros. And any other failure (a corrupt database, a lost connection) is an
   * outage and must reach the caller too. */
  const failing = (error) => ({
    prepare: () => {
      const stmt = {
        run: async () => ({ meta: { changes: 0 }, results: [] }),
        first: async () => { throw new Error(error); },
        all: async () => { throw new Error(error); }
      };
      return { ...stmt, bind: () => stmt };
    }
  });

  const drifted = new AnalyticsStore(failing('no such column: deleted_at'));
  await assert.rejects(() => drifted.deviceCount(), /no such column/);

  const outage = new AnalyticsStore(failing('disk I/O error'));
  await assert.rejects(() => outage.deviceCount(), /disk I\/O error/);

  /* And the one message that *is* swallowed returns empty rather than throwing. */
  const fresh = new AnalyticsStore(failing('no such table: user_settings'));
  assert.equal(await fresh.deviceCount(), 0);
});
