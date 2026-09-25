/* Admin notification panel — history → panel seam.
 *
 * The existing backend test stubs /api/notifications/history with a fixture that
 * happens to match the page's field names, so it can never catch the two places
 * where the real Worker and the page disagreed:
 *
 *   1. FcmStore.recentGlobals() did not SELECT image_url / target_url, so the
 *      expanded row's Target and Image fields always rendered "none" even though
 *      the columns are written on every send.
 *   2. The page read `opened` off the raw history row, but per-notification
 *      opens are computed server-side into analytics.items. The raw row has no
 *      such field, so Opens always read 0.
 *
 * Both bugs survived because the fixture invented the missing fields. This test
 * removes that freedom: it runs the REAL FcmStore over an in-memory D1 to produce
 * the response body, then feeds that exact body into the REAL page in jsdom. If
 * the store stops selecting a column, or the page stops reading the right source,
 * the assertion fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { FcmStore } from './fcm-notification.mjs';
import { computeAnalytics } from './analytics-notifications.mjs';

const HTML = readFileSync('notification-command-center.html', 'utf8');

/* Minimal D1 that answers exactly the SQL FcmStore issues. Anything else returns
 * empty rather than throwing, so an unrelated new query cannot mask a failure. */
function makeD1(globals, reads) {
  /* D1 returns only the columns the statement names. Modelling that is the whole
   * point of this fake: if recentGlobals stops selecting image_url, the key must
   * actually vanish here, exactly as it does in production. A fake that hands
   * back every column cannot fail. */
  const project = (sql, row) => {
    const m = /SELECT\s+([\s\S]+?)\s+FROM/i.exec(sql);
    if (!m) return { ...row };
    const cols = m[1].split(',').map(c => c.trim().split(/\s+/)[0]).filter(Boolean);
    if (cols.includes('*')) return { ...row };
    const out = {};
    for (const c of cols) out[c] = row[c] === undefined ? null : row[c];
    return out;
  };
  const stmt = (sql, args) => ({
    async run() { return { success: true, meta: { changes: 1 } }; },
    async first() {
      if (sql.includes('COUNT(DISTINCT fcm_token)')) return { n: globals.length ? 7 : 0 };
      return null;
    },
    async all() {
      if (sql.includes('FROM global_notifications')) {
        return { results: globals.map(g => project(sql, g)) };
      }
      return { results: [] };
    }
  });
  return {
    prepare: (sql) => ({ ...stmt(sql, []), bind: (...a) => stmt(sql, a) }),
    async batch(statements) { return statements.map(() => ({ success: true })); }
  };
}

const now = Date.now();
const GLOBAL_ROW = {
  id: 'gn-live00000001',
  type: 'announcement',
  title: 'ফি জমার শেষ তারিখ',
  body: 'আগামীকালের মধ্যে ফি জমা দিন।',
  image_url: 'https://cdn.admissionhub.pages.dev/banner.webp',
  target_url: '#/smart-revision',
  audience: 'all_students',
  topic: 'all',
  status: 'sent',
  scheduled_at: null,
  sent_at: now - 3600e3,
  created_at: now - 7200e3,
  reach_estimate: 120,
  delivered: 118,
  clicks: 9,
  error: null
};

function bootPanel(body) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://admissionhub.pages.dev/notification-command-center.html',
    beforeParse(window) {
      window.sessionStorage.setItem('ahAdminTok', 'session-token-abc');
      window.fetch = () => Promise.resolve({
        ok: true, status: 200, json: () => Promise.resolve(body)
      });
    }
  });
  return dom.window;
}

const settle = () => new Promise(r => setTimeout(r, 30));

test('the store returns the image and target URL it stores', async () => {
  const store = new FcmStore(makeD1([GLOBAL_ROW], {}));
  const items = await store.recentGlobals(50);
  assert.equal(items.length, 1);
  /* These two are the fields the expanded row renders. Dropping them from the
   * SELECT makes the panel show "none" for a notification that has both. */
  assert.equal(items[0].imageUrl, GLOBAL_ROW.image_url, 'image_url must survive the store mapping');
  assert.equal(items[0].targetUrl, GLOBAL_ROW.target_url, 'target_url must survive the store mapping');
});

test('the real store output hydrates Target and Image into the panel', async () => {
  const store = new FcmStore(makeD1([GLOBAL_ROW], {}));
  const items = await store.recentGlobals(50);
  const analytics = computeAnalytics(items, { 'gn-live00000001': 41 }, 0);
  const body = {
    ok: true, items, analytics,
    reachEstimate: await store.activeDeviceCount(), dailyCap: 10
  };

  const window = bootPanel(body);
  await settle();
  const row = window.NotificationStudio.state.sent[0];
  assert.equal(row.targetUrl, '#/smart-revision', 'target URL reaches the row');
  assert.equal(row.imageUrl, 'https://cdn.admissionhub.pages.dev/banner.webp', 'image URL reaches the row');

  /* Render the expanded detail and read the actual DOM the admin sees. */
  window.NotificationStudio.setState({ expandedRow: 'gn-live00000001', tab: 'sent' });
  const html = window.document.body.innerHTML;
  assert.ok(html.includes('#/smart-revision'), 'expanded row shows the real target, not "none"');
  assert.ok(html.includes('banner.webp'), 'expanded row shows the real image, not "none"');
});

test('per-notification opens come from analytics, not the raw history row', async () => {
  const store = new FcmStore(makeD1([GLOBAL_ROW], {}));
  const items = await store.recentGlobals(50);
  /* The raw row genuinely has no `opened` key — this is the trap. */
  assert.equal(items[0].opened, undefined, 'history rows do not carry opened');
  const analytics = computeAnalytics(items, { 'gn-live00000001': 41 }, 0);
  assert.equal(analytics.items[0].opened, 41, 'analytics carries the real open count');

  const window = bootPanel({ ok: true, items, analytics, reachEstimate: 7, dailyCap: 10 });
  await settle();
  const row = window.NotificationStudio.state.sent[0];
  assert.equal(row.opened, 41, 'panel reads opens from analytics.items, not the raw row');
  assert.equal(row.delivered, 118, 'delivered still comes from the row');
});

test('the panel never fabricates opens when analytics is absent', async () => {
  const store = new FcmStore(makeD1([GLOBAL_ROW], {}));
  const items = await store.recentGlobals(50);
  /* Degraded response (analyticsFor swallows an analytics outage and returns
   * zeros). The panel must show 0, not crash or invent a number. */
  const window = bootPanel({ ok: true, items, analytics: { totals: {}, items: [] }, reachEstimate: 7, dailyCap: 10 });
  await settle();
  const row = window.NotificationStudio.state.sent[0];
  assert.equal(row.opened, 0, 'absent analytics degrades to zero');
  assert.equal(row.targetUrl, '#/smart-revision', 'the rest of the row still hydrates');
});

test('the quota widget shows the day, not the size of the history table', async () => {
  /* 40 notifications exist; only 2 were sent today. The widget must read 2/10.
   * Before the fix it read items.length, so any busy month looked over quota. */
  const many = Array.from({ length: 40 }, (_, i) => ({
    ...GLOBAL_ROW,
    id: `gn-${String(i).padStart(12, '0')}`,
    sent_at: i < 2 ? now - 60e3 : now - (30 + i) * 86400e3,
    created_at: i < 2 ? now - 60e3 : now - (30 + i) * 86400e3
  }));
  /* Rows go through the real store so the page receives the camelCase shape the
   * Worker actually sends — passing raw snake_case rows would test a fiction. */
  const items = await new FcmStore(makeD1(many, {})).recentGlobals(50);
  assert.equal(items.length, 40);

  const window = bootPanel({
    ok: true, items, analytics: { totals: {}, items: [] },
    reachEstimate: 7, dailyCap: 10, dailyUsed: 2
  });
  await settle();
  const q = window.NotificationStudio.state.quota;
  assert.equal(q.used, 2, 'server daily usage wins over the row count');
  assert.equal(q.dailyCap, 10);
  /* fmtNum renders in the active locale (default bn), so compare against the
   * same formatter rather than hardcoding Latin digits. */
  const fmt = (n) => new Intl.NumberFormat('bn-BD').format(n);
  const html = window.document.body.innerHTML;
  assert.ok(html.includes(`${fmt(2)} / ${fmt(10)}`), 'widget renders 2 / 10');
  assert.ok(!html.includes(`${fmt(40)} / ${fmt(10)}`), 'widget does not render the history size');
});

test('the quota widget degrades to a same-day count when the server omits usage', async () => {
  const rows = [
    { ...GLOBAL_ROW, id: 'gn-today000001', sent_at: now - 60e3, created_at: now - 60e3 },
    { ...GLOBAL_ROW, id: 'gn-old0000001', sent_at: now - 40 * 86400e3, created_at: now - 40 * 86400e3 }
  ];
  const items = await new FcmStore(makeD1(rows, {})).recentGlobals(50);
  /* No dailyUsed key at all — an older worker response. */
  const window = bootPanel({ ok: true, items, analytics: { totals: {}, items: [] }, reachEstimate: 7, dailyCap: 10 });
  await settle();
  assert.equal(window.NotificationStudio.state.quota.used, 1, 'counts only today\u2019s row');
});

test('the quota window label matches the UTC day the cap actually resets on', () => {
  /* The limiter keys its counter to a UTC date. The label used to say
   * "Asia/Dhaka", which disagrees with the real reset for 6 hours every day. */
  assert.match(HTML, /window:\{bn:"আজ \(UTC\)",en:"Today \(UTC\)"\}/, 'label states UTC');
  assert.doesNotMatch(HTML, /quota:\{[^}]*Asia\/Dhaka/, 'quota widget no longer claims Dhaka');
});
