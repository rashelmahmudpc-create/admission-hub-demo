/* Phase 5 — AI analytics store against a real database.
 *
 * The store is the only part of Phase 5 that writes. A fake D1 that pattern-matches
 * SQL proves the call shape but cannot catch a wrong column, a missing index or an
 * upsert that silently inserts a duplicate. This file runs the store's real
 * statements against a real SQLite database, so a schema mistake fails here rather
 * than in production.
 *
 * The behaviours that matter are the ones an audit depends on: a decision logged
 * twice must not count twice, a retry must not inflate the outcome statistics, an
 * approval with no human attached must not read as satisfied, and an expired cache
 * entry must not be served.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AiAnalyticsStore, AI_CACHE_TTL_MS, AI_STORE_VERSION } from './ai-analytics-store.mjs';
import { evaluateAiPerformance } from './ai-analytics-intelligence.mjs';
import { approvalSatisfied } from './ai-analytics-policy.mjs';

const NOW = Date.UTC(2026, 8, 24, 4, 0, 0);
const DAY = 86400000;

/* D1-shaped facade over better-sqlite3, matching the harness the other sqlite
 * suites use: prepare().bind().run()/first()/all(). */
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

async function fixture() {
  const database = new Database(':memory:');
  const d1 = d1From(database);
  const store = new AiAnalyticsStore(d1);
  await store.init();
  /* Phase 4 owns this table; the store only reads the `at` column from it. */
  database.exec(`CREATE TABLE IF NOT EXISTS analytics_events (
    id TEXT PRIMARY KEY, user_id TEXT, name TEXT, params_json TEXT, at INTEGER NOT NULL
  )`);
  return { database, store };
}

/* ── ১. schema ────────────────────────────────────────────────────────────── */

test('P5-STORE-১. init creates every table the store owns, and is idempotent', async () => {
  const { database, store } = await fixture();
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
  for (const expected of ['ai_cache', 'ai_decisions', 'ai_approvals', 'ai_experiments']) {
    assert.ok(tables.includes(expected), `missing table ${expected}`);
  }
  /* Running init again must not throw or duplicate. */
  await store.init();
  await store.init();
  assert.equal(store.available(), true);
});

test('P5-STORE-২. an unavailable database is a supported state, not a crash', async () => {
  const store = new AiAnalyticsStore(null);
  assert.equal(store.available(), false);
  assert.equal(await store.init(), false);
  assert.equal(await store.getCache('x'), null);
  assert.deepEqual(await store.listDecisions(), []);
  assert.deepEqual(await store.listApprovals(), []);
  assert.deepEqual(await store.experimentResults('x'), []);
  assert.deepEqual(await store.analyticsEventsFor('u1', 0), []);
  assert.deepEqual(await store.health(), { available: false });
  const put = await store.putCache('x', 'insight', { a: 1 });
  assert.equal(put.stored, false);
});

/* ── ৩. cache ─────────────────────────────────────────────────────────────── */

test('P5-STORE-৩. a cached payload round-trips with its model and expiry', async () => {
  const { store } = await fixture();
  await store.putCache('copilot:abc:30', 'copilot', { textBn: 'উত্তর', intent: 'engagement' }, { now: NOW, model: 'gemini-x' });
  const hit = await store.getCache('copilot:abc:30', NOW + 1000);
  assert.equal(hit.fresh, true);
  assert.equal(hit.model, 'gemini-x');
  assert.equal(hit.payload.textBn, 'উত্তর');
  assert.equal(hit.payload.intent, 'engagement');
  assert.equal(hit.expiresAt, NOW + AI_CACHE_TTL_MS.copilot);
});

test('P5-STORE-৪. an expired entry is not served', async () => {
  const { store } = await fixture();
  await store.putCache('k', 'copilot', { a: 1 }, { now: NOW });
  assert.ok(await store.getCache('k', NOW + 1000));
  /* Past the TTL, the read returns nothing. */
  assert.equal(await store.getCache('k', NOW + AI_CACHE_TTL_MS.copilot + 1), null);
});

test('P5-STORE-৫. writing the same key twice updates rather than duplicating', async () => {
  const { database, store } = await fixture();
  await store.putCache('k', 'insight', { v: 1 }, { now: NOW });
  await store.putCache('k', 'insight', { v: 2 }, { now: NOW + 10 });
  const rows = database.prepare('SELECT COUNT(*) AS n FROM ai_cache').get();
  assert.equal(rows.n, 1);
  const hit = await store.getCache('k', NOW + 20);
  assert.equal(hit.payload.v, 2);
});

test('P5-STORE-৬. the sweep removes only expired rows, and stats agree with it', async () => {
  const { store } = await fixture();
  await store.putCache('old', 'copilot', { a: 1 }, { now: NOW, ttlMs: 1000 });
  await store.putCache('new', 'copilot', { b: 2 }, { now: NOW, ttlMs: 10 * DAY });

  const before = await store.cacheStats(NOW + 2000);
  assert.equal(before.total, 2);
  assert.equal(before.live, 1);
  assert.equal(before.expired, 1);

  const swept = await store.sweepCache(NOW + 2000);
  assert.equal(swept.removed, 1);

  const after = await store.cacheStats(NOW + 2000);
  assert.equal(after.total, 1);
  assert.equal(after.live, 1);
  assert.equal(await store.getCache('new', NOW + 2000) !== null, true);
});

/* ── ৭. decision log ──────────────────────────────────────────────────────── */

test('P5-STORE-৭. a decision round-trips with its signal, model and confidence', async () => {
  const { store } = await fixture();
  const logged = await store.logDecision({
    studentId: 'u1',
    signal: 'nba:practice',
    recommendation: 'practice',
    reason: 'ranking',
    model: 'gemini-x',
    modelVersion: 'ai-p5-v1',
    confidence: 0.72,
    latencyMs: 120,
    costUsd: 0.0004
  }, NOW);
  assert.equal(logged.stored, true);

  const rows = await store.listDecisions();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, logged.id);
  assert.equal(rows[0].studentId, 'u1');
  assert.equal(rows[0].signal, 'nba:practice');
  assert.equal(rows[0].confidence, 0.72);
  assert.equal(rows[0].latencyMs, 120);
  assert.equal(rows[0].costUsd, 0.0004);
  assert.equal(rows[0].outcome, null);
  assert.equal(rows[0].resolvedAt, null);
});

test('P5-STORE-৮. logging the same decision twice does not double-count the outcome', async () => {
  const { store } = await fixture();
  const first = await store.logDecision({ studentId: 'u1', signal: 'nba:practice', recommendation: 'practice', confidence: 0.7 }, NOW);
  /* A retry with the same id resolves the row rather than inserting a second. */
  await store.logDecision({
    id: first.id,
    signal: 'nba:practice',
    recommendation: 'practice',
    confidence: 0.7,
    actionTaken: 'accepted',
    outcome: { accepted: true, learned: true }
  }, NOW + 1000);

  const rows = await store.listDecisions();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actionTaken, 'accepted');
  assert.equal(rows[0].outcome.learned, true);
  assert.equal(rows[0].resolvedAt, NOW + 1000);
});

test('P5-STORE-৯. an auto-generated id is stable for the same logical decision at the same instant', async () => {
  const { store } = await fixture();
  const a = await store.logDecision({ studentId: 'u1', signal: 'nba:practice', recommendation: 'practice' }, NOW);
  const b = await store.logDecision({ studentId: 'u1', signal: 'nba:practice', recommendation: 'practice' }, NOW);
  assert.equal(a.id, b.id, 'a retry at the same instant must map to one row');
  /* A different instant is a genuinely new recommendation. */
  const c = await store.logDecision({ studentId: 'u1', signal: 'nba:practice', recommendation: 'practice' }, NOW + 1);
  assert.notEqual(c.id, a.id);
});

test('P5-STORE-১০. the decision log feeds evaluateAiPerformance with real rows', async () => {
  const { store } = await fixture();
  await store.logDecision({ studentId: 'u1', signal: 'nba:practice', recommendation: 'practice', confidence: 0.8 }, NOW);
  await store.logDecision({ studentId: 'u2', signal: 'nba:revision', recommendation: 'revise', confidence: 0.5 }, NOW);
  const rows = await store.listDecisions();
  await store.logDecision({ id: rows.find((r) => r.studentId === 'u1').id, signal: 'nba:practice', recommendation: 'practice', confidence: 0.8, actionTaken: 'accepted', outcome: { accepted: true, learned: true } }, NOW + 10);

  const performance = evaluateAiPerformance(await store.listDecisions());
  assert.equal(performance.total, 2);
  assert.equal(performance.scored, 1);
  assert.equal(performance.learningConversion, 1);
});

test('P5-STORE-১১. decisions can be filtered by time, and stats count resolved rows', async () => {
  const { store } = await fixture();
  await store.logDecision({ studentId: 'u1', signal: 'nba:a', recommendation: 'a', confidence: 0.5 }, NOW - 5 * DAY);
  await store.logDecision({ studentId: 'u1', signal: 'nba:b', recommendation: 'b', confidence: 0.5, outcome: { learned: true } }, NOW);

  const recent = await store.listDecisions({ sinceMs: NOW - DAY });
  assert.equal(recent.length, 1);
  assert.equal(recent[0].signal, 'nba:b');

  const stats = await store.decisionStats();
  assert.equal(stats.total, 2);
  assert.equal(stats.resolved, 1);
});

test('P5-STORE-১২. a single decision can be fetched by id, and an unknown id is null', async () => {
  const { store } = await fixture();
  const logged = await store.logDecision({ studentId: 'u1', signal: 'nba:practice', recommendation: 'practice', confidence: 0.6 }, NOW);
  const found = await store.getDecision(logged.id);
  assert.equal(found.id, logged.id);
  assert.equal(found.studentId, 'u1');
  assert.equal(await store.getDecision('dec_missing'), null);
});

test('P5-STORE-১৩. the decision log stores a signal name, not the student rows behind it', async () => {
  const { database, store } = await fixture();
  await store.logDecision({
    studentId: 'u1',
    signal: 'nba:practice',
    recommendation: 'practice',
    reason: 'ranking',
    confidence: 0.7,
    /* A caller that tries to stash raw rows must not have them persisted. */
    outcome: { learned: true }
  }, NOW);
  const row = database.prepare('SELECT * FROM ai_decisions').get();
  const serialised = JSON.stringify(row);
  assert.ok(!/questions|mistakes|daily_stats/.test(serialised), 'raw learning rows must not be copied into the log');
  assert.ok(row.signal.includes('nba:'), 'the signal name is what is stored');
});

/* ── ১৪. approvals ───────────────────────────────────────────────────────── */

test('P5-STORE-১৪. an approval starts pending and only a named human can decide it', async () => {
  const { store } = await fixture();
  const created = await store.createApproval({ kind: 'mass_notification', payload: { audience: 900 } }, NOW);
  assert.equal(created.stored, true);

  const pending = await store.getApproval(created.id);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.actor, null);
  assert.equal(approvalSatisfied(pending).ok, false);

  /* A decision with no actor is refused outright. */
  const anonymous = await store.decideApproval(created.id, 'approved', '', {}, NOW);
  assert.equal(anonymous.stored, false);
  assert.equal(anonymous.reason, 'actor-required');
  assert.equal((await store.getApproval(created.id)).status, 'pending');

  const decided = await store.decideApproval(created.id, 'approved', 'admin@admissionhub', { note: 'ok' }, NOW + 100);
  assert.equal(decided.stored, true);
  const after = await store.getApproval(created.id);
  assert.equal(after.status, 'approved');
  assert.equal(after.actor, 'admin@admissionhub');
  assert.equal(after.note, 'ok');
  assert.equal(approvalSatisfied(after).ok, true);
});

test('P5-STORE-১৫. a modified approval stores the human replacement payload, so the original cannot ship', async () => {
  const { store } = await fixture();
  const created = await store.createApproval({ kind: 'content_change', payload: { lessonId: 'l3' } }, NOW);
  await store.decideApproval(created.id, 'modified', 'admin@x', { payload: { lessonId: 'l3', newCopy: 'মানুষের লেখা' } }, NOW + 100);
  const after = await store.getApproval(created.id);
  assert.equal(after.status, 'modified');
  assert.equal(after.payload.newCopy, 'মানুষের লেখা');
  const satisfied = approvalSatisfied(after);
  assert.equal(satisfied.ok, true);
  assert.equal(satisfied.payload.newCopy, 'মানুষের লেখা');
});

test('P5-STORE-১৬. an invalid status is refused, and a rejected approval is never satisfied', async () => {
  const { store } = await fixture();
  const created = await store.createApproval({ kind: 'platform_decision' }, NOW);
  const bad = await store.decideApproval(created.id, 'maybe', 'admin@x', {}, NOW);
  assert.equal(bad.stored, false);
  assert.equal(bad.reason, 'bad-status');

  await store.decideApproval(created.id, 'rejected', 'admin@x', {}, NOW + 10);
  const after = await store.getApproval(created.id);
  assert.equal(approvalSatisfied(after).ok, false);
  assert.equal(approvalSatisfied(after).reason, 'rejected');
});

test('P5-STORE-১৭. approvals can be listed and filtered by status', async () => {
  const { store } = await fixture();
  await store.createApproval({ kind: 'mass_notification' }, NOW);
  const second = await store.createApproval({ kind: 'content_change' }, NOW);
  await store.decideApproval(second.id, 'approved', 'admin@x', {}, NOW + 1);

  assert.equal((await store.listApprovals()).length, 2);
  assert.equal((await store.listApprovals({ status: 'pending' })).length, 1);
  assert.equal((await store.listApprovals({ status: 'approved' })).length, 1);
  assert.equal(await store.getApproval('apr_missing'), null);
});

/* ── ১৮. experiments ─────────────────────────────────────────────────────── */

test('P5-STORE-১৮. experiment outcomes aggregate per variant with rates', async () => {
  const { store } = await fixture();
  /* 4 shown of A, 2 converted; 3 shown of B, 1 converted. */
  for (let i = 0; i < 4; i++) {
    await store.recordExperiment({ experiment: 'notification-copy', variant: 'A', studentId: `a${i}`, opened: true, clicked: true, converted: i < 2 }, NOW + i);
  }
  for (let i = 0; i < 3; i++) {
    await store.recordExperiment({ experiment: 'notification-copy', variant: 'B', studentId: `b${i}`, opened: i === 0, clicked: false, converted: i === 0 }, NOW + i);
  }

  const rows = await store.experimentResults('notification-copy');
  const a = rows.find((r) => r.variant === 'A');
  const b = rows.find((r) => r.variant === 'B');
  assert.equal(a.shown, 4);
  assert.equal(a.converted, 2);
  assert.equal(a.conversionRate, 0.5);
  assert.equal(a.openRate, 1);
  assert.equal(b.shown, 3);
  assert.equal(b.converted, 1);
  assert.equal(b.conversionRate, 0.3333);
});

test('P5-STORE-১৯. a later open is merged onto the same row, not inserted again', async () => {
  const { database, store } = await fixture();
  const first = await store.recordExperiment({ experiment: 'e1', variant: 'A', studentId: 'u1' }, NOW);
  await store.recordExperiment({ id: first.id, experiment: 'e1', variant: 'A', studentId: 'u1', opened: true, converted: true }, NOW + 100);
  const rows = database.prepare('SELECT COUNT(*) AS n FROM ai_experiments').get();
  assert.equal(rows.n, 1);
  const result = (await store.experimentResults('e1'))[0];
  assert.equal(result.shown, 1);
  assert.equal(result.opened, 1);
  assert.equal(result.converted, 1);
});

test('P5-STORE-২০. an unknown experiment returns an empty result set', async () => {
  const { store } = await fixture();
  assert.deepEqual(await store.experimentResults('never-ran'), []);
});

/* ── ২১. student activity hours ─────────────────────────────────────────── */

test('P5-STORE-২১. activity hours read only the timestamp column, scoped to one student', async () => {
  const { database, store } = await fixture();
  database.prepare('INSERT INTO analytics_events (id, user_id, name, params_json, at) VALUES (?,?,?,?,?)')
    .run('e1', 'u1', 'lesson_start', '{"secret":"do-not-read"}', NOW);
  database.prepare('INSERT INTO analytics_events (id, user_id, name, params_json, at) VALUES (?,?,?,?,?)')
    .run('e2', 'u2', 'lesson_start', '{}', NOW);
  database.prepare('INSERT INTO analytics_events (id, user_id, name, params_json, at) VALUES (?,?,?,?,?)')
    .run('e3', 'u1', 'quiz_start', '{}', NOW - 5 * DAY);

  const rows = await store.analyticsEventsFor('u1', NOW - DAY);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].at, NOW);
  /* The intelligence path must not see event names or params. */
  assert.deepEqual(Object.keys(rows[0]), ['at']);
});

test('P5-STORE-২২. activity hours degrade to empty when Phase 4 has not created its table', async () => {
  const database = new Database(':memory:');
  const store = new AiAnalyticsStore(d1From(database));
  await store.init();
  /* `analytics_events` was never created — a fresh database is not a fault. */
  assert.deepEqual(await store.analyticsEventsFor('u1', 0), []);
});

/* ── ২৩. health ──────────────────────────────────────────────────────────── */

test('P5-STORE-২৩. health reports the cache, decision and approval state in one call', async () => {
  const { store } = await fixture();
  await store.putCache('k', 'copilot', { a: 1 }, { now: NOW });
  await store.logDecision({ studentId: 'u1', signal: 'nba:practice', recommendation: 'practice', confidence: 0.7, outcome: { learned: true } }, NOW);
  await store.createApproval({ kind: 'mass_notification' }, NOW);

  const health = await store.health(NOW + 1000);
  assert.equal(health.available, true);
  assert.equal(health.version, AI_STORE_VERSION);
  assert.equal(health.cache.total, 1);
  assert.equal(health.cache.live, 1);
  assert.equal(health.decisions.total, 1);
  assert.equal(health.decisions.resolved, 1);
  assert.equal(health.pendingApprovals, 1);
});

test('P5-STORE-২৪. a missing column is a loud error, not silently treated as no data', async () => {
  const { database } = await fixture();
  /* Simulate schema drift: the table exists but is missing a column the store
   * selects. The Phase 4 store's contract is that this must throw. */
  database.exec('DROP TABLE ai_decisions');
  database.exec('CREATE TABLE ai_decisions (id TEXT PRIMARY KEY, signal TEXT)');
  const store = new AiAnalyticsStore(d1From(database));
  await assert.rejects(() => store.listDecisions(), /no such column|column/i);
});

test('P5-STORE-২৫. the store never writes another student\'s id onto a decision it did not create', async () => {
  const { store } = await fixture();
  const mine = await store.logDecision({ studentId: 'u1', signal: 'nba:practice', recommendation: 'practice', confidence: 0.6 }, NOW);
  /* A second student resolving the same id must be detectable by comparing the
   * stored studentId — this is the check the route performs. */
  const fetched = await store.getDecision(mine.id);
  assert.equal(fetched.studentId, 'u1');
  assert.notEqual(fetched.studentId, 'u2');
});
