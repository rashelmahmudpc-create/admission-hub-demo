/* Phase 4 — notification analytics (analytics-notifications.mjs).
 *
 * The funnel arithmetic is pure, so it is tested directly against plain rows.
 * The property that matters most: every rate divides by the right denominator,
 * and a missing denominator reports 0 rather than NaN or Infinity — the admin
 * must never see a broken number.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAnalytics,
  summarizeHistory,
  AnalyticsStore,
  __analyticsTest
} from './analytics-notifications.mjs';

const row = over => ({
  id: 'gn-1', title: 'Hi', type: 'info', status: 'sent', audience: 'all_students',
  sentAt: 1000, reachEstimate: 10, delivered: 8, clicks: 2, error: null, ...over
});

test('a1: the funnel totals every stage', () => {
  const rows = [
    row({ id: 'a', delivered: 100, clicks: 10 }),
    row({ id: 'b', delivered: 50, clicks: 5 }),
    row({ id: 'c', status: 'failed', delivered: 0, clicks: 0, error: 'no-devices' })
  ];
  const out = computeAnalytics(rows, { a: 40, b: 5 }, 3);
  assert.deepEqual(out.totals, {
    notifications: 3, sent: 2, failed: 1, delivered: 150, opened: 45, clicked: 15,
    invalidTokens: 3, ctr: 10, engagement: 30
  });
});

test('a2: rates divide by delivered, not by sent', () => {
  /* One sent notification reaching 200 devices, 50 clicks. CTR is 25%, not 50%. */
  const out = computeAnalytics([row({ delivered: 200, clicks: 50 })], {});
  assert.equal(out.totals.ctr, 25);
});

test('a3: a zero denominator reports 0, never NaN or Infinity', () => {
  const out = computeAnalytics([row({ status: 'failed', delivered: 0, clicks: 0 })], {});
  assert.equal(out.totals.ctr, 0);
  assert.equal(out.totals.engagement, 0);
  const empty = computeAnalytics([], {});
  assert.equal(empty.totals.ctr, 0);
  assert.equal(empty.totals.engagement, 0);
  assert.equal(empty.totals.notifications, 0);
});

test('a4: rates round to one decimal place', () => {
  const out = computeAnalytics([row({ delivered: 3, clicks: 1 })], {});
  assert.equal(out.totals.ctr, 33.3);
});

test('a5: opened is read from the read counts map, keyed by notification id', () => {
  const out = computeAnalytics([row({ id: 'gn-x' })], { 'gn-x': 7 });
  assert.equal(out.totals.opened, 7);
  assert.equal(out.items[0].opened, 7);
});

test('a6: a missing read count is zero, and a read count for another id is ignored', () => {
  const out = computeAnalytics([row({ id: 'gn-x' })], { 'gn-other': 99 });
  assert.equal(out.totals.opened, 0);
});

test('a7: per-item figures carry the same rates as the totals', () => {
  const out = computeAnalytics([row({ id: 'gn-a', delivered: 40, clicks: 6 })], { 'gn-a': 20 });
  const item = out.items[0];
  assert.equal(item.delivered, 40);
  assert.equal(item.opened, 20);
  assert.equal(item.clicked, 6);
  assert.equal(item.openRate, 50);
  assert.equal(item.ctr, 15);
});

test('a8: a failed row keeps its error and contributes no deliveries', () => {
  const out = computeAnalytics([row({ status: 'failed', delivered: null, clicks: null, error: 'topic+fallback failed' })], {});
  const item = out.items[0];
  assert.equal(item.status, 'failed');
  assert.equal(item.delivered, 0, 'a null delivered is treated as nothing, not NaN');
  assert.equal(item.clicked, 0);
  assert.equal(item.error, 'topic+fallback failed');
});

test('a9: negative or non-numeric counters cannot produce a negative total', () => {
  const out = computeAnalytics([row({ delivered: -5, clicks: 'abc', reachEstimate: 'x' })], {});
  assert.equal(out.totals.delivered, 0);
  assert.equal(out.totals.clicked, 0);
  assert.equal(out.items[0].reachEstimate, null, 'a non-numeric estimate stays unknown');
});

test('a10: an extremely long error is truncated so the payload stays small', () => {
  const out = computeAnalytics([row({ status: 'failed', error: 'x'.repeat(500) })], {});
  assert.equal(out.items[0].error.length, 200);
});

test('a11: invalid tokens are a health count, not a send failure', () => {
  const out = computeAnalytics([row({ status: 'sent' })], {}, 12);
  assert.equal(out.totals.invalidTokens, 12);
  assert.equal(out.totals.failed, 0, 'dead tokens do not make a successful send look failed');
});

test('a12: the history summary is the item list, newest order preserved', () => {
  const rows = [
    row({ id: 'new', title: 'Newest', delivered: 10, clicks: 1 }),
    row({ id: 'old', title: 'Older', delivered: 20, clicks: 2 })
  ];
  const out = summarizeHistory(rows, { new: 5 });
  assert.deepEqual(out.map(x => x.id), ['new', 'old'], 'the caller supplies the order, we keep it');
  assert.equal(out[0].opened, 5);
  assert.equal(out[0].ctr, 10);
  assert.equal(out[1].ctr, 10);
});

test('a13: pct is the single rounding point', () => {
  assert.equal(__analyticsTest.pct(1, 3), 33.3);
  assert.equal(__analyticsTest.pct(0, 0), 0);
  assert.equal(__analyticsTest.pct(3, 3), 100);
});

/* ── store reads through a fake D1 ───────────────────────────────────────── */

function makeFakeD1(state = {}) {
  const s = { reads: [], devices: [], ...state };
  return {
    state: s,
    prepare(sql) {
      const runner = args => ({
        async run() { return { meta: { changes: 0 } }; },
        async first() {
          if (sql.includes('COUNT(*)') && sql.includes('fcm_devices') && sql.includes('is_active=0')) {
            return { n: s.devices.filter(d => !d.is_active).length };
          }
          return null;
        },
        async all() {
          if (sql.includes('FROM notification_reads')) {
            const ids = args;
            const byId = {};
            for (const r of s.reads) {
              if (!ids.includes(r.notification_id)) continue;
              byId[r.notification_id] = byId[r.notification_id] || new Set();
              byId[r.notification_id].add(r.user_id);
            }
            return { results: Object.entries(byId).map(([notification_id, users]) => ({ notification_id, n: users.size })) };
          }
          return { results: [] };
        }
      });
      return { bind: (...args) => runner(args), ...runner([]) };
    }
  };
}

test('a14: readCounts counts distinct readers, not read events', async () => {
  const d1 = makeFakeD1({
    reads: [
      { notification_id: 'gn-a', user_id: 'u1' },
      { notification_id: 'gn-a', user_id: 'u1' }, // a duplicate row must not double-count
      { notification_id: 'gn-a', user_id: 'u2' },
      { notification_id: 'gn-b', user_id: 'u1' }
    ]
  });
  const store = new AnalyticsStore(d1);
  const out = await store.readCounts(['gn-a', 'gn-b', 'gn-c']);
  assert.deepEqual(out, { 'gn-a': 2, 'gn-b': 1 });
});

test('a15: readCounts with no ids does not query', async () => {
  const store = new AnalyticsStore(makeFakeD1({}));
  assert.deepEqual(await store.readCounts([]), {});
});

test('a16: the inactive device count is the deactivated rows', async () => {
  const d1 = makeFakeD1({ devices: [{ is_active: 1 }, { is_active: 0 }, { is_active: 0 }] });
  const store = new AnalyticsStore(d1);
  assert.equal(await store.inactiveDeviceCount(), 2);
});

test('a17: no D1 means analytics degrade to an empty funnel, not a crash', async () => {
  const store = new AnalyticsStore(null);
  assert.equal(store.available(), false);
  const out = computeAnalytics([row({ delivered: 5, clicks: 0 })], {}, 0);
  assert.equal(out.totals.ctr, 0, 'without reads the funnel is still computable');
  assert.deepEqual(await store.readCounts([]), {}, 'and asking for no ids is a harmless no-op');
});
