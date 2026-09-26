/* Phase 5 — the AI analytics routes through the real worker entry point.
 *
 * The intelligence, policy and store tests call the modules directly. This file
 * calls the worker's `fetch`, so it proves the wiring that a unit test cannot:
 * that the route is registered, that it is reached *before* the Phase 4 handler
 * which claims the same prefix, that the access gates hold, and that the shipped
 * bundle behaves identically to the source.
 *
 * The registration-order test is the important one. Phase 4 owns
 * `/api/analytics/*`, so if Phase 5 were registered after it, every
 * `/api/analytics/ai/*` request would be answered by Phase 4's admin gate — a 403
 * that looks like a permissions problem and would send a future debugger in
 * entirely the wrong direction.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import sourceWorker from './gk-agent-worker.js';
import bundledWorker from './worker-bundle.mjs';
import { handleAiAnalyticsRequest } from './ai-analytics-routes.mjs';
import Database from 'better-sqlite3';
import { readFile } from 'node:fs/promises';

const NOW = Date.UTC(2026, 8, 24, 4, 0, 0);
const DAY = 86400000;

function d1From(database) {
  const wrap = (statement, bindings) => ({
    async run() { const i = database.prepare(statement).run(...bindings); return { meta: { changes: i.changes }, results: [] }; },
    async first() { const p = database.prepare(statement); return p.reader ? (p.get(...bindings) ?? null) : (p.run(...bindings), null); },
    async all() { const p = database.prepare(statement); return { results: p.reader ? p.all(...bindings) : (p.run(...bindings), []) }; }
  });
  return {
    prepare: (s) => ({ bind: (...b) => wrap(s, b), ...wrap(s, []) }),
    async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; }
  };
}

/* Seeds the Phase 4 tables the AI layer reads, plus a few events so the
 * best-time path has something to count. The DDL is Phase 4's own — a trimmed
 * table here would let the AI layer pass against a schema that does not exist. */
function env(overrides = {}) {
  const database = new Database(':memory:');
  database.exec(`CREATE TABLE IF NOT EXISTS analytics_events (
    user_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, params_json TEXT,
    at INTEGER NOT NULL, day_key TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, id))`);
  database.exec('CREATE INDEX IF NOT EXISTS idx_ae_user_at ON analytics_events(user_id, at)');
  database.prepare('INSERT INTO analytics_events (user_id, id, name, params_json, at, day_key, created_at) VALUES (?,?,?,?,?,?,?)')
    .run('u1', 'e1', 'lesson_start', '{}', NOW, '2026-09-24', NOW);
  return { env: { PROFILE_DB: d1From(database), ...overrides }, database };
}

const workerFetch = (worker, request, e) => worker.fetch(request, e, { waitUntil() {}, passThroughOnException() {} });

/* ── ১. routing ───────────────────────────────────────────────────────────── */

for (const [name, worker] of [['source', sourceWorker], ['bundle', bundledWorker]]) {
  test(`p5w-১ (${name}): the AI route is reached, not swallowed by the Phase 4 handler`, async () => {
    const { env: e } = env({ ADMIN_TOKEN: 'tok' });
    const res = await workerFetch(worker, new Request('https://worker/api/analytics/ai/health', {
      method: 'GET',
      headers: { Authorization: 'Bearer tok' }
    }), e);
    /* 200 means the AI handler answered. A 403 here would mean Phase 4's admin
     * gate got there first — the exact ordering failure this test pins. */
    assert.equal(res.status, 200, 'the AI health route must be served by the AI handler');
    const body = await res.json();
    assert.equal(body.version, 'ai-p5-v1');
    assert.equal(body.policyVersion, 'ai-p5-policy-v1');
    assert.equal(body.copilotVersion, 'ai-p5-copilot-v1');
    assert.equal(body.store.available, true);
  });

  test(`p5w-২ (${name}): admin AI routes are closed without a token`, async () => {
    for (const route of ['insights', 'risk', 'notifications', 'trends', 'decisions', 'approvals', 'experiments', 'health']) {
      const { env: e } = env();
      const res = await workerFetch(worker, new Request(`https://worker/api/analytics/ai/${route}`, { method: 'GET' }), e);
      assert.equal(res.status, 403, `${route} must require the admin token`);
      assert.equal((await res.json()).error, 'forbidden');
    }
  });

  test(`p5w-৩ (${name}): a wrong admin token gets the same answer as no token`, async () => {
    const { env: e } = env({ ADMIN_TOKEN: 'the-real-token' });
    const res = await workerFetch(worker, new Request('https://worker/api/analytics/ai/insights', {
      headers: { Authorization: 'Bearer the-wrong-token' }
    }), e);
    assert.equal(res.status, 403);
  });

  test(`p5w-৪ (${name}): a student dashboard needs a session`, async () => {
    const { env: e } = env();
    const res = await workerFetch(worker, new Request('https://worker/api/analytics/ai/me?user=someone-else', { method: 'GET' }), e);
    assert.equal(res.status, 401, 'no session means no personal intelligence, whatever the query says');
    assert.equal((await res.json()).error, 'auth-required');
  });

  test(`p5w-৫ (${name}): a non-AI analytics path still belongs to Phase 4`, async () => {
    const { env: e } = env();
    const res = await workerFetch(worker, new Request('https://worker/api/analytics/overview', { method: 'GET' }), e);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'forbidden');
  });

  test(`p5w-৬ (${name}): an unrelated path passes through untouched`, async () => {
    const { env: e } = env();
    const res = await workerFetch(worker, new Request('https://worker/api/not-analytics', { method: 'GET' }), e);
    const body = await res.text();
    assert.ok(!/forbidden|auth-required|storage-unavailable/.test(body),
      'the AI handler must not claim routes it does not own');
  });

  test(`p5w-৭ (${name}): CORS preflight is answered without touching storage`, async () => {
    const { env: e } = env();
    const res = await workerFetch(worker, new Request('https://worker/api/analytics/ai/chat', {
      method: 'OPTIONS',
      headers: { Origin: 'https://admissionhub.pages.dev' }
    }), e);
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
    assert.ok(res.headers.get('Access-Control-Allow-Headers').includes('Authorization'));
  });
}

/* ── ৮. registration order, pinned in the source ─────────────────────────── */

test('p5w-৮. the AI handler is registered before the Phase 4 handler in the worker', async () => {
  const source = await readFile(new URL('./gk-agent-worker.js', import.meta.url), 'utf8');
  const aiAt = source.indexOf('handleAiAnalyticsRequest(request');
  const p4At = source.indexOf('handleAnalyticsRequest(request');
  assert.ok(aiAt > 0, 'the AI handler must be called from the worker');
  assert.ok(p4At > 0, 'the Phase 4 handler must be called from the worker');
  assert.ok(aiAt < p4At, 'the AI handler must be registered before the Phase 4 handler, or Phase 4 will 403-swallow /api/analytics/ai/*');
});

/* ── ৯. admin routes end to end ─────────────────────────────────────────── */

test('p5w-৯. every advertised admin AI route answers 200 with a valid token', async () => {
  const routes = ['insights', 'risk', 'notifications', 'trends', 'decisions', 'approvals', 'experiments', 'health'];
  for (const route of routes) {
    const { env: e } = env({ ADMIN_TOKEN: 'tok' });
    const res = await workerFetch(sourceWorker, new Request(`https://worker/api/analytics/ai/${route}?days=7`, {
      headers: { Authorization: 'Bearer tok' }
    }), e);
    assert.equal(res.status, 200, `${route} must be served`);
    const body = await res.json();
    assert.equal(typeof body, 'object');
    assert.ok(!/auth-required|forbidden|storage-unavailable/.test(JSON.stringify(body)), `${route} leaked a gate error`);
  }
});

test('p5w-১০. the admin AI payload is aggregate only — no per-student field', async () => {
  const { env: e } = env({ ADMIN_TOKEN: 'tok' });
  for (const route of ['insights', 'risk', 'notifications', 'trends']) {
    const res = await workerFetch(sourceWorker, new Request(`https://worker/api/analytics/ai/${route}?days=30`, {
      headers: { Authorization: 'Bearer tok' }
    }), e);
    const text = JSON.stringify(await res.json());
    assert.ok(!/"user_id"/.test(text), `${route} must not expose a user id`);
    assert.ok(!/"studentId"/.test(text), `${route} must not expose a student id`);
    assert.ok(!/"email"/.test(text), `${route} must not expose an email`);
  }
});

test('p5w-১১. content and course intelligence always declare that a human must approve', async () => {
  const { env: e } = env({ ADMIN_TOKEN: 'tok' });
  const res = await workerFetch(sourceWorker, new Request('https://worker/api/analytics/ai/insights?days=30', {
    headers: { Authorization: 'Bearer tok' }
  }), e);
  const body = await res.json();
  assert.equal(body.requiresAdminApproval, true);
  assert.equal(body.content.requiresAdminApproval, true);
  assert.equal(body.course.requiresAdminApproval, true);
});

test('p5w-১২. the approvals route states which decision kinds need a human', async () => {
  const { env: e } = env({ ADMIN_TOKEN: 'tok' });
  const res = await workerFetch(sourceWorker, new Request('https://worker/api/analytics/ai/approvals', {
    headers: { Authorization: 'Bearer tok' }
  }), e);
  const body = await res.json();
  assert.deepEqual(body.requiresApprovalFor, ['content_change', 'course_restructure', 'policy_change', 'mass_notification', 'platform_decision']);
  assert.equal(body.policyVersion, 'ai-p5-policy-v1');
});

test('p5w-১৩. the health route says plainly whether a model is wired', async () => {
  const { env: e } = env({ ADMIN_TOKEN: 'tok' });
  const res = await workerFetch(sourceWorker, new Request('https://worker/api/analytics/ai/health', {
    headers: { Authorization: 'Bearer tok' }
  }), e);
  const body = await res.json();
  /* No GEMINI_KEYS in this env, so the bridge is inert — and says so. */
  assert.equal(body.model.configured, false);
  assert.ok(body.capabilities.includes('admin:read-aggregate'));
  assert.ok(body.capabilities.includes('admin:approve'));
  assert.ok(body.capabilities.includes('student:read-self'));
});

/* ── ১৪. copilot chat end to end ────────────────────────────────────────── */

test('p5w-১৪. the copilot answers a Bangla question with real figures, no model configured', async () => {
  const { env: e } = env({ ADMIN_TOKEN: 'tok' });
  const res = await workerFetch(sourceWorker, new Request('https://worker/api/analytics/ai/chat', {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'engagement কেমন?', days: 30 })
  }), e);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.intent, 'engagement');
  assert.equal(body.usedModel, false);
  assert.ok(body.grounded);
});

test('p5w-১৫. the copilot refuses an unmatched question with suggestions, not a guess', async () => {
  const { env: e } = env({ ADMIN_TOKEN: 'tok' });
  const res = await workerFetch(sourceWorker, new Request('https://worker/api/analytics/ai/chat', {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'আজ আবহাওয়া কেমন?' })
  }), e);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'no-matching-intent');
  assert.ok(body.suggestionsBn.length > 0);
});

test('p5w-১৬. an empty question is refused before any work is done', async () => {
  const { env: e } = env({ ADMIN_TOKEN: 'tok' });
  const res = await workerFetch(sourceWorker, new Request('https://worker/api/analytics/ai/chat', {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: '   ' })
  }), e);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'question-required');
  assert.ok(body.suggestionsBn.length > 0);
});

test('p5w-১৭. a repeated question is served from cache the second time', async () => {
  const { env: e } = env({ ADMIN_TOKEN: 'tok' });
  const request = () => new Request('https://worker/api/analytics/ai/chat', {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'retention কেমন?', days: 30 })
  });
  const first = await (await workerFetch(sourceWorker, request(), e)).json();
  assert.equal(first.cached, false);
  const second = await (await workerFetch(sourceWorker, request(), e)).json();
  assert.equal(second.cached, true, 'the second identical question must hit the cache');
  /* The cached answer is the same answer, not a fresh empty one. */
  assert.equal(second.intent, first.intent);
  assert.equal(second.textBn, first.textBn);
});

/* ── ১৮. notify route never sends ───────────────────────────────────────── */

test('p5w-১৮. the notify route returns wording only and never sends', async () => {
  const { env: e } = env({ ADMIN_TOKEN: 'tok' });
  const res = await workerFetch(sourceWorker, new Request('https://worker/api/analytics/ai/notify', {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'lesson_reminder', params: { lessonTitle: 'সমাস' }, fallbackCopy: { bn: 'পরের lesson ready' } })
  }), e);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sends, false, 'sending remains Phase 3s job');
  assert.equal(body.source, 'phase3-catalogue');
  assert.equal(body.copy.bn, 'পরের lesson ready');
  assert.equal(body.requiresApproval, false);
});

test('p5w-১৯. a mass audience escalates to an approval instead of returning copy to send', async () => {
  const { env: e } = env({ ADMIN_TOKEN: 'tok' });
  const res = await workerFetch(sourceWorker, new Request('https://worker/api/analytics/ai/notify', {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'lesson_reminder', audience: 900, fallbackCopy: { bn: 'সবাইকে জানাও' } })
  }), e);
  const body = await res.json();
  assert.equal(body.sends, false);
  assert.equal(body.requiresApproval, true);
  assert.deepEqual(body.approvalKinds, ['mass_notification']);
  assert.ok(body.approval, 'an approval record must be created');
  assert.equal(body.approval.status, 'pending');
});

test('p5w-২০. a notify request without a kind is refused', async () => {
  const { env: e } = env({ ADMIN_TOKEN: 'tok' });
  const res = await workerFetch(sourceWorker, new Request('https://worker/api/analytics/ai/notify', {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }), e);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'kind-required');
});

/* ── ২১. approval decision end to end ───────────────────────────────────── */

test('p5w-২১. an approval can be created, decided and read back satisfied', async () => {
  const { env: e } = env({ ADMIN_TOKEN: 'tok' });
  /* Create one by asking for a mass notification. */
  const created = await (await workerFetch(sourceWorker, new Request('https://worker/api/analytics/ai/notify', {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'streak_nudge', audience: 500, fallbackCopy: { bn: 'স্ট্রিক ধরে রাখো' } })
  }), e)).json();
  const id = created.approval.id;

  const listed = await (await workerFetch(sourceWorker, new Request('https://worker/api/analytics/ai/approvals?status=pending', {
    headers: { Authorization: 'Bearer tok' }
  }), e)).json();
  assert.ok(listed.approvals.some((a) => a.id === id));
  assert.equal(listed.pending >= 1, true);

  /* A decision with no actor is refused. */
  const anonymous = await workerFetch(sourceWorker, new Request(`https://worker/api/analytics/ai/approvals/${id}/decide`, {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'approved' })
  }), e);
  assert.equal(anonymous.status, 400);
  assert.equal((await anonymous.json()).error, 'actor-required');

  const decided = await workerFetch(sourceWorker, new Request(`https://worker/api/analytics/ai/approvals/${id}/decide`, {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'approved', actor: 'admin@admissionhub', note: 'verified' })
  }), e);
  assert.equal(decided.status, 200);
  const body = await decided.json();
  assert.equal(body.ok, true);
  assert.equal(body.approval.status, 'approved');
  assert.equal(body.approval.actor, 'admin@admissionhub');
  assert.equal(body.satisfied.ok, true);
});

/* ── ২২. decisions + performance read ───────────────────────────────────── */

test('p5w-২২. the decisions route reports the AI performance summary', async () => {
  const { env: e } = env({ ADMIN_TOKEN: 'tok' });
  await workerFetch(sourceWorker, new Request('https://worker/api/analytics/ai/chat', {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'funnel কেমন?' })
  }), e);

  const res = await workerFetch(sourceWorker, new Request('https://worker/api/analytics/ai/decisions', {
    headers: { Authorization: 'Bearer tok' }
  }), e);
  const body = await res.json();
  assert.ok(Array.isArray(body.decisions));
  assert.ok(body.decisions.length >= 1, 'a copilot answer must be logged');
  assert.ok(body.performance);
  assert.equal(body.performance.total, body.decisions.length);
});

/* ── ২৩. student feedback path ──────────────────────────────────────────── */

test('p5w-২৩. student feedback needs a session and a decision id', async () => {
  const { env: e } = env();
  const noSession = await workerFetch(sourceWorker, new Request('https://worker/api/analytics/ai/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decisionId: 'x', actionTaken: 'accepted' })
  }), e);
  assert.equal(noSession.status, 401);
});

/* ── ২৪. unknown AI route ───────────────────────────────────────────────── */

test('p5w-২৪. an unknown AI route is a 404 with suggestions, not a silent 200', async () => {
  const { env: e } = env({ ADMIN_TOKEN: 'tok' });
  const res = await workerFetch(sourceWorker, new Request('https://worker/api/analytics/ai/does-not-exist', {
    headers: { Authorization: 'Bearer tok' }
  }), e);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'not-found');
  assert.ok(body.suggestionsBn.length > 0);
});

/* ── ২৬. the student path, with a real session ───────────────────────────
 *
 * The worker's `fetch` cannot be handed a session, so these call the real
 * handler with `deps.sessionUser` injected — the same seam the Phase 4 route
 * tests use. What matters here is authorisation: a student reads their own
 * intelligence and nothing else, and feedback can only be recorded against a
 * decision that belongs to them.
 */

const withSession = (userId) => ({ sessionUser: async () => (userId ? { user: { id: userId } } : null) });

function studentRequest(path, init = {}) {
  return new Request(`https://worker${path}`, init);
}

test('p5w-২৬. a student gets their own intelligence bundle', async () => {
  const { env: e } = env();
  const res = await handleAiAnalyticsRequest(studentRequest('/api/analytics/ai/me'), e, {}, withSession('u1'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.scope, 'student');
  assert.ok(body.profile, 'the profile must be present');
  assert.ok(body.profile.dimensions.preferredTime, 'all ten dimensions, including best time');
  assert.equal(body.profile.dimensions.preferredTime.band, 'insufficient');
  /* `actions` is the ranking envelope, so it carries the version and the reason
   * alongside the list — not a bare array. */
  assert.equal(body.actions.version, 'ai-p5-v1');
  assert.ok(Array.isArray(body.actions.actions));
  assert.equal(body.actions.reason, 'insufficient-data');
  /* A student's own payload carries no other student's id. */
  assert.ok(!/"u2"/.test(JSON.stringify(body)));
});

test('p5w-২৭. a student cannot read another student by changing the query', async () => {
  const { env: e } = env();
  const res = await handleAiAnalyticsRequest(studentRequest('/api/analytics/ai/me?user=someone-else'), e, {}, withSession('u1'));
  assert.equal(res.status, 200);
  const body = await res.json();
  /* The session wins: the answer is u1's, whatever the query asked for. */
  assert.equal(body.scope, 'student');
  assert.ok(!/"someone-else"/.test(JSON.stringify(body)));
});

test('p5w-২৮. feedback on a decision that is not the student\'s is refused, and the refusal does not reveal whether the id exists', async () => {
  const { env: e, database } = env({ ADMIN_TOKEN: 'tok' });
  const { AiAnalyticsStore } = await import('./ai-analytics-store.mjs');
  const aiStore = new AiAnalyticsStore(d1From(database));
  await aiStore.init();
  /* A real decision that belongs to somebody else. */
  const other = await aiStore.logDecision({ studentId: 'u2', signal: 'nba:practice', recommendation: 'practice', confidence: 0.6 }, NOW);

  const missing = await handleAiAnalyticsRequest(studentRequest('/api/analytics/ai/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decisionId: 'dec_nonexistent', actionTaken: 'accepted' })
  }), e, {}, withSession('u1'));
  const stolen = await handleAiAnalyticsRequest(studentRequest('/api/analytics/ai/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decisionId: other.id, actionTaken: 'accepted' })
  }), e, {}, withSession('u1'));

  /* Both are 403 with the same body: an id that does not exist and an id that
   * belongs to someone else must be indistinguishable, or the endpoint becomes
   * an oracle for which decision ids are real. */
  assert.equal(missing.status, 403);
  assert.equal(stolen.status, 403);
  assert.equal((await missing.json()).error, (await stolen.json()).error);

  /* And the other student's row is untouched. */
  const after = await aiStore.getDecision(other.id);
  assert.equal(after.actionTaken, null);
  assert.equal(after.resolvedAt, null);
});

test('p5w-২৯. a student can record feedback on their own recommendation', async () => {
  const { env: e, database } = env();
  /* Seed a decision owned by u1, as the student path would. */
  const { AiAnalyticsStore } = await import('./ai-analytics-store.mjs');
  const aiStore = new AiAnalyticsStore(d1From(database));
  await aiStore.init();
  const logged = await aiStore.logDecision({ studentId: 'u1', signal: 'nba:practice', recommendation: 'practice', confidence: 0.6 }, NOW);

  const res = await handleAiAnalyticsRequest(studentRequest('/api/analytics/ai/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decisionId: logged.id, actionTaken: 'accepted', learned: true })
  }), e, {}, withSession('u1'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);

  const stored = await aiStore.getDecision(logged.id);
  assert.equal(stored.actionTaken, 'accepted');
  assert.equal(stored.outcome.learned, true);
  assert.equal(stored.resolvedAt !== null, true);
});

test('p5w-৩০. feedback with an unknown action is refused', async () => {
  const { env: e, database } = env();
  const { AiAnalyticsStore } = await import('./ai-analytics-store.mjs');
  const aiStore = new AiAnalyticsStore(d1From(database));
  await aiStore.init();
  const mine = await aiStore.logDecision({ studentId: 'u1', signal: 'nba:practice', recommendation: 'practice', confidence: 0.6 }, NOW);

  const res = await handleAiAnalyticsRequest(studentRequest('/api/analytics/ai/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decisionId: mine.id, actionTaken: 'ignored-it' })
  }), e, {}, withSession('u1'));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'bad-action');
  /* A refused action must not have been written as `ignored`. */
  const after = await aiStore.getDecision(mine.id);
  assert.equal(after.actionTaken, null);
  assert.equal(after.resolvedAt, null);
});

/* ── ২৫. no storage ─────────────────────────────────────────────────────── */

test('p5w-২৫. without PROFILE_DB the AI routes report storage unavailable, not a crash', async () => {
  const res = await workerFetch(sourceWorker, new Request('https://worker/api/analytics/ai/health', {
    method: 'GET',
    headers: { Authorization: 'Bearer tok' }
  }), { ADMIN_TOKEN: 'tok' });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'storage-unavailable');
});
