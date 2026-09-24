/* Phase 5 — quota-aware fanout and send timing (send-planner.mjs).
 *
 * The planner is the part that must stay correct when a run is interrupted and
 * resumed, so it is tested head-on rather than through a network: the cursor
 * must never skip, never re-send, and the total must add up exactly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planFanout,
  backoffMs,
  isRetryable,
  retryDecision,
  classifyFcmError,
  hourHistogram,
  scoreHours,
  bestSendHour,
  advanceFanout,
  FanoutStore,
  DEFAULT_WINDOW_BUDGET
} from './send-planner.mjs';

/* ── plan (pure) ─────────────────────────────────────────────────────────── */

test('p1: a fanout smaller than the budget finishes in one tick', () => {
  const plan = planFanout(120, { budget: 400 });
  assert.deepEqual(plan, { start: 0, take: 120, end: 120, remaining: 0, batches: 12, complete: true });
});

test('p2: a fanout larger than the budget is sliced, not dropped', () => {
  const plan = planFanout(1000, { budget: 400 });
  assert.equal(plan.take, 400, 'this tick takes exactly the budget');
  assert.equal(plan.remaining, 600, 'the rest is owed, never lost');
  assert.equal(plan.complete, false);
});

test('p3: successive ticks tile the whole audience exactly once', () => {
  const total = 1000;
  const budget = 400;
  let cursor = 0;
  const slices = [];
  for (let tick = 0; tick < 10; tick += 1) {
    const plan = planFanout(total, { budget, cursor });
    slices.push([plan.start, plan.end]);
    cursor = plan.end;
    if (plan.complete) break;
  }
  assert.deepEqual(slices, [[0, 400], [400, 800], [800, 1000]]);
  /* Contiguous, no overlap, ends exactly at total. */
  for (let i = 1; i < slices.length; i += 1) assert.equal(slices[i][0], slices[i - 1][1]);
  assert.equal(slices.at(-1)[1], total);
});

test('p4: an exhausted cursor yields no work and reports complete', () => {
  const plan = planFanout(500, { budget: 400, cursor: 500 });
  assert.deepEqual(plan, { start: 500, take: 0, end: 500, remaining: 0, batches: 0, complete: true });
});

test('p5: a cursor beyond the audience cannot overshoot', () => {
  const plan = planFanout(100, { budget: 400, cursor: 9999 });
  assert.equal(plan.start, 100, 'clamped to the audience size');
  assert.equal(plan.take, 0);
  assert.equal(plan.remaining, 0);
});

test('p6: a zero or negative audience is not work', () => {
  assert.equal(planFanout(0, { budget: 400 }).complete, true);
  assert.equal(planFanout(-5, { budget: 400 }).take, 0);
});

test('p7: an absurd budget or cursor degrades to the default, not to a crash', () => {
  const plan = planFanout(1000, { budget: 0 });
  assert.equal(plan.take, Math.min(1000, DEFAULT_WINDOW_BUDGET), 'a zero budget falls back to the default');
  const nan = planFanout(1000, { budget: 'lots', cursor: 'x' });
  assert.equal(nan.start, 0);
  assert.equal(nan.take, DEFAULT_WINDOW_BUDGET);
});

/* ── retry policy (pure) ─────────────────────────────────────────────────── */

test('p8: backoff grows exponentially and respects its cap', () => {
  assert.equal(backoffMs(1, { base: 250, cap: 30_000 }), 250);
  assert.equal(backoffMs(2, { base: 250, cap: 30_000 }), 500);
  assert.equal(backoffMs(3, { base: 250, cap: 30_000 }), 1000);
  assert.equal(backoffMs(20, { base: 250, cap: 30_000 }), 30_000, 'capped');
});

test('p9: only transient reasons are retryable, a dead token never is', () => {
  assert.equal(isRetryable('rate-limited'), true);
  assert.equal(isRetryable('unavailable'), true);
  assert.equal(isRetryable('unregistered'), false);
  assert.equal(isRetryable('invalid'), false);
  assert.equal(isRetryable('unusable-token'), false);
});

test('p10: a retry gives up after the attempt ceiling', () => {
  assert.equal(retryDecision({ reason: 'rate-limited', attempt: 1, maxAttempts: 4 }).retry, true);
  assert.equal(retryDecision({ reason: 'rate-limited', attempt: 4, maxAttempts: 4 }).retry, false, 'last attempt does not retry');
  assert.equal(retryDecision({ reason: 'unregistered', attempt: 1 }).retry, false, 'a dead token is not retried at all');
  assert.equal(retryDecision({ reason: 'unregistered', attempt: 1 }).waitMs, 0);
});

test('p11: FCM statuses map to the right retry vocabulary', () => {
  assert.equal(classifyFcmError(429), 'rate-limited');
  assert.equal(classifyFcmError(200, 429), 'rate-limited');
  assert.equal(classifyFcmError(503), 'unavailable');
  assert.equal(classifyFcmError(502), 'unavailable');
  assert.equal(classifyFcmError(404), 'unusable-token');
  assert.equal(classifyFcmError(400), 'unusable-token');
  assert.equal(classifyFcmError(418), 'error');
});

/* ── send timing (pure) ──────────────────────────────────────────────────── */

test('p12: the histogram counts sends and opens per hour', () => {
  const hist = hourHistogram([{ hour: 20 }, { hour: 20, opened: true }, { hour: 8 }, { hour: 99 }, { hour: -1 }]);
  assert.equal(hist[20].sent, 2);
  assert.equal(hist[20].opened, 1);
  assert.equal(hist[8].sent, 1);
  assert.equal(hist.reduce((a, h) => a + h.sent, 0), 3, 'impossible hours are ignored');
});

test('p13: the hour a student actually opens at scores highest', () => {
  const events = [];
  for (let i = 0; i < 10; i += 1) events.push({ hour: 21, opened: true });
  for (let i = 0; i < 10; i += 1) events.push({ hour: 9 });
  const out = bestSendHour(events);
  assert.equal(out.hour, 21);
  assert.equal(out.confident, true);
});

test('p14: below the sample floor we fall back and admit we are unsure', () => {
  const out = bestSendHour([{ hour: 3 }], { min_samples: 12 });
  assert.equal(out.hour, 20, 'the default hour, not a guess from one point');
  assert.equal(out.confident, false);
  assert.equal(out.samples, 1);
});

test('p15: with no history at all, the default stands', () => {
  const out = bestSendHour([], { default_hour: 19 });
  assert.equal(out.hour, 19);
  assert.equal(out.confident, false);
});

test('p16: an unseen hour is unproven, not impossible', () => {
  const scores = scoreHours([]);
  assert.equal(scores.length, 24);
  assert.ok(scores.every(s => s > 0), 'the floor keeps every hour above zero');
});

/* ── resumable ledger through a fake D1 ──────────────────────────────────── */

function makeFakeD1() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      const runner = args => ({
        async run() {
          if (sql.includes('CREATE TABLE')) return { meta: { changes: 0 } };
          if (sql.includes('INSERT INTO notification_fanout')) {
            const [id, cursor, total, status, updated_at] = args;
            rows.set(id, { id, cursor, total, status, updated_at });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() {
          if (sql.includes('FROM notification_fanout')) return rows.get(args[0]) || null;
          return null;
        }
      });
      return { bind: (...args) => runner(args), ...runner([]) };
    }
  };
}

test('p17: progress survives a restart and resumes where it stopped', async () => {
  const d1 = makeFakeD1();
  const store = new FanoutStore(d1);
  const first = await advanceFanout(store, 'gn-big', 1000, { budget: 400 });
  assert.equal(first.end, 400);
  /* A new worker instance reads the same table and continues. */
  const resumed = await advanceFanout(new FanoutStore(d1), 'gn-big', 1000, { budget: 400 });
  assert.equal(resumed.start, 400);
  assert.equal(resumed.end, 800);
  const last = await advanceFanout(new FanoutStore(d1), 'gn-big', 1000, { budget: 400 });
  assert.equal(last.end, 1000);
  assert.equal(last.complete, true);
  assert.equal((await store.getState('gn-big')).status, 'complete');
});

test('p18: a fanout is never resumed against a different audience size', async () => {
  const store = new FanoutStore(makeFakeD1());
  await advanceFanout(store, 'gn-x', 1000, { budget: 400 });
  /* The audience changed under us; stale progress must not skip new devices. */
  const fresh = await advanceFanout(store, 'gn-x', 1500, { budget: 400 });
  assert.equal(fresh.start, 0, 'a size mismatch restarts from the top');
});

test('p19: the timed fanout run advances and completes in one shot for a small send', async () => {
  const store = new FanoutStore(makeFakeD1());
  const plan = await advanceFanout(store, 'gn-small', 50, { budget: 400 });
  assert.equal(plan.complete, true);
  assert.equal(plan.take, 50);
});

test('p20: no D1 means the planner still returns a usable plan', async () => {
  const store = new FanoutStore(null);
  assert.equal(store.available(), false);
  const plan = await advanceFanout(store, 'gn-any', 1000, { budget: 400 });
  assert.equal(plan.take, 400);
  assert.equal(plan.remaining, 600);
});
