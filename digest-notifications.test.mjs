/* Phase 4 — daily / weekly / monthly digests (digest-notifications.mjs).
 *
 * Calendar math is pure, so the "is it Sunday", "is it the 1st", "which ISO
 * week is this" questions are tested directly. The runner goes through a
 * pattern-matched D1 with an injected clock and transport.
 *
 * The properties that matter: an empty period is silent, a period sends once,
 * and a day can never carry more than one digest.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dhakaCalendar,
  dueDigests,
  digestRange,
  summarize,
  buildDigestMessage,
  isoWeek,
  runScheduledDigests,
  DigestStore
} from './digest-notifications.mjs';

/* Dhaka = UTC+6. 18:00 UTC = 00:00 next day Dhaka. */
const dhakaAt = (y, m, d, hh, mm = 0) => Date.UTC(y, m - 1, d, hh - 6, mm);

/* ── calendar (pure) ─────────────────────────────────────────────────────── */

test('d1: a date maps to the right Dhaka weekday, month and ISO week', () => {
  /* 2026-09-24 is a Thursday. */
  const cal = dhakaCalendar(dhakaAt(2026, 9, 24, 10));
  assert.equal(cal.date, '2026-09-24');
  assert.equal(cal.weekday, 3, 'Mon=0 … Thu=3');
  assert.equal(cal.dayOfMonth, 24);
  assert.equal(cal.monthKey, '2026-09');
  assert.equal(cal.weekKey, '2026-W39');
  assert.equal(cal.prevMonthKey, '2026-08');
});

test('d2: isoWeek handles the year boundary', () => {
  assert.deepEqual(isoWeek('2026-01-01'), { isoYear: 2026, week: 1 }, '1 Jan 2026 is a Thursday, week 1');
  assert.deepEqual(isoWeek('2027-01-01'), { isoYear: 2026, week: 53 }, '1 Jan 2027 belongs to ISO week 53 of 2026');
  assert.deepEqual(isoWeek('2026-12-31'), { isoYear: 2026, week: 53 });
});

test('d3: the Dhaka day, not the UTC day, decides the date', () => {
  /* 21:00 UTC on 23 Sep is 03:00 on 24 Sep in Dhaka. */
  const cal = dhakaCalendar(Date.UTC(2026, 8, 23, 21, 0));
  assert.equal(cal.date, '2026-09-24');
  assert.equal(cal.hour, 3);
});

test('d4: January 1st points the monthly digest at December', () => {
  const cal = dhakaCalendar(dhakaAt(2027, 1, 1, 10));
  assert.equal(cal.monthKey, '2027-01');
  assert.equal(cal.prevMonthKey, '2026-12');
});

/* ── due selection (pure) ────────────────────────────────────────────────── */

test('d5: the daily digest only becomes due in the evening', () => {
  assert.deepEqual(dueDigests({ date: '2026-09-24', dayOfMonth: 24, weekday: 3, hour: 12 }, {}), [],
    'midday is too early for a day-in-review');
  const evening = dueDigests({ date: '2026-09-24', dayOfMonth: 24, weekday: 3, hour: 20 }, {});
  assert.deepEqual(evening.map(x => x.kind), ['daily']);
  assert.equal(evening[0].periodKey, '2026-09-24');
});

test('d6: Sunday is the weekly digest day', () => {
  /* 2026-09-27 is a Sunday. */
  const cal = dhakaCalendar(dhakaAt(2026, 9, 27, 10));
  assert.equal(cal.weekday, 6, 'Sun=6');
  assert.deepEqual(dueDigests(cal, {}).map(x => x.kind), ['weekly']);
  assert.equal(dueDigests(cal, {})[0].periodKey, '2026-W39');
  const thursday = dueDigests(dhakaCalendar(dhakaAt(2026, 9, 24, 20)), {});
  assert.deepEqual(thursday.map(x => x.kind), ['daily'], 'no weekly mid-week');
});

test('d7: the 1st is the monthly digest day; the weekly joins when it is a Sunday', () => {
  /* 2026-11-01 is a Sunday — monthly and weekly due, ordered rarest first. The
   * daily has not reached its (later) evening hour yet. */
  const cal = dhakaCalendar(dhakaAt(2026, 11, 1, 10));
  assert.equal(cal.weekday, 6);
  assert.equal(cal.dayOfMonth, 1);
  assert.deepEqual(dueDigests(cal, {}).map(x => x.kind), ['monthly', 'weekly'],
    'ordered rarest first, so the cap takes monthly then weekly');
  assert.deepEqual(dueDigests({ ...cal, hour: 20 }, {}).map(x => x.kind), ['monthly', 'weekly', 'daily']);
});

test('d7b: a non-Sunday 1st still has monthly and daily due', () => {
  /* 2026-12-01 is a Tuesday. */
  const cal = dhakaCalendar(dhakaAt(2026, 12, 1, 20));
  assert.equal(cal.weekday, 1);
  assert.deepEqual(dueDigests(cal, {}).map(x => x.kind), ['monthly', 'daily']);
});

test('d8: a period stays due after its hour, so a missed hour is caught up', () => {
  const late = dueDigests({ date: '2026-09-24', dayOfMonth: 24, weekday: 3, hour: 22 }, {});
  assert.deepEqual(late.map(x => x.kind), ['daily']);
});

/* ── ranges + summary (pure) ─────────────────────────────────────────────── */

test('d9: each range brackets exactly its period', () => {
  const cal = dhakaCalendar(dhakaAt(2026, 9, 24, 10));
  assert.deepEqual(digestRange('daily', cal), { from: '2026-09-24', to: '2026-09-24' });
  assert.deepEqual(digestRange('weekly', cal), { from: '2026-09-17', to: '2026-09-23' },
    'the week before the Sunday it is sent');
  const firstOfMonth = dhakaCalendar(dhakaAt(2026, 10, 1, 10));
  assert.deepEqual(digestRange('monthly', firstOfMonth), { from: '2026-09-01', to: '2026-09-30' });
});

test('d10: a range across month and year ends is computed correctly', () => {
  const jan1 = dhakaCalendar(dhakaAt(2027, 1, 1, 10));
  assert.deepEqual(digestRange('monthly', jan1), { from: '2026-12-01', to: '2026-12-31' });
  const feb1 = dhakaCalendar(dhakaAt(2026, 3, 1, 10));
  assert.deepEqual(digestRange('monthly', feb1), { from: '2026-02-01', to: '2026-02-28' },
    'a short month ends on the 28th');
});

test('d11: summarize totals only days that had study', () => {
  const out = summarize([
    { questions: 10, correct: 8 },
    { questions: 0, correct: 0 },
    { questions: 30, correct: 21 }
  ]);
  assert.deepEqual(out, { questions: 40, correct: 29, activeDays: 2, accuracy: 73 });
  assert.deepEqual(summarize([]), { questions: 0, correct: 0, activeDays: 0, accuracy: 0 });
});

test('d12: every digest kind has Bangla and English copy with the numbers in it', () => {
  const s = { questions: 40, activeDays: 5, accuracy: 73 };
  for (const kind of ['daily', 'weekly', 'monthly']) {
    for (const lang of ['bn', 'en']) {
      const m = buildDigestMessage(kind, s, lang);
      assert.ok(m && m.title && m.body, `${kind}/${lang} has copy`);
      assert.match(m.body, /40/, `${kind}/${lang} states the question count`);
      assert.equal(m.kind, `digest-${kind}`);
    }
  }
  assert.equal(buildDigestMessage('yearly', s), null);
});

/* ── runner through a fake D1 ────────────────────────────────────────────── */

function makeFakeD1(seed = {}) {
  const s = {
    devices: [{ user_id: 'u1', is_active: 1 }],
    settings: [{ user_id: 'u1', personalized_enabled: 1, quiet_hours_enabled: 1, quiet_start: '23:30', quiet_end: '06:30' }],
    daily: [], sends: [],
    ...seed
  };
  const db = {
    state: s,
    async batch(stmts) { for (const st of stmts) await st.run(); },
    prepare(sql) {
      const runner = args => ({
        async run() {
          if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) return { meta: { changes: 0 } };
          if (sql.includes('INSERT INTO notification_digest_sends')) {
            const [u, pk, kind, at] = args;
            if (s.sends.some(x => x.u === u && x.pk === pk)) return { meta: { changes: 0 } };
            s.sends.push({ u, pk, kind, at });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() {
          if (sql.includes('SELECT * FROM notification_settings')) return s.settings.find(r => r.user_id === args[0]) || null;
          if (sql.includes('COUNT(*)') && sql.includes('notification_digest_sends')) {
            return { n: s.sends.filter(x => x.u === args[0] && x.at >= args[1]).length };
          }
          return null;
        },
        async all() {
          if (sql.includes('DISTINCT user_id FROM fcm_devices')) {
            return { results: [...new Set(s.devices.filter(d => d.is_active).map(d => d.user_id))].map(user_id => ({ user_id })) };
          }
          if (sql.includes('FROM user_daily_stats')) {
            const [userId, from, to] = args;
            const rows = s.daily.filter(r => r.user_id === userId && !r.deleted_at && r.day >= from && r.day <= to)
              .sort((a, b) => a.day.localeCompare(b.day))
              .map(r => ({ day: r.day, payload_json: JSON.stringify(r.payload) }));
            return { results: rows };
          }
          if (sql.includes('FROM notification_reads')) {
            const [userId] = args;
            return { results: s.reads.filter(r => r.user_id === userId).map(r => ({ read_at: r.read_at })) };
          }
          return { results: [] };
        }
      });
      return { bind: (...args) => runner(args), ...runner([]) };
    }
  };
  return db;
}

const runWith = (seed, deps = {}) => {
  const d1 = makeFakeD1(seed);
  const store = new DigestStore(d1);
  const sent = [];
  return runScheduledDigests(
    { __skipFcmCheck: true, PROFILE_DB: d1 },
    { store, send: async (userId, message) => { sent.push({ userId, message }); return { ok: true, sent: 1 }; }, ...deps }
  ).then(out => ({ out, sent, d1 }));
};

test('d13: the evening daily digest carries the day’s real numbers', async () => {
  const { out, sent } = await runWith({
    daily: [{ user_id: 'u1', day: '2026-09-24', payload: { questions: 25, correct: 20 } }]
  }, { now: () => dhakaAt(2026, 9, 24, 20) });
  assert.equal(out.sent, 1);
  assert.equal(sent[0].message.kind, 'digest-daily');
  assert.match(sent[0].message.body, /25/, 'the real question count is in the message');
});

test('d14: a day with no study is never recapped', async () => {
  const { out, sent } = await runWith({ daily: [] }, { now: () => dhakaAt(2026, 9, 24, 20) });
  assert.equal(out.sent, 0);
  assert.equal(sent.length, 0, 'silence over an empty period');
});

test('d15: the daily digest is not sent before its hour', async () => {
  const { sent } = await runWith({
    daily: [{ user_id: 'u1', day: '2026-09-24', payload: { questions: 25 } }]
  }, { now: () => dhakaAt(2026, 9, 24, 12) });
  assert.equal(sent.length, 0);
});

test('d16: a repeated cron tick never sends the same period twice', async () => {
  const d1 = makeFakeD1({ daily: [{ user_id: 'u1', day: '2026-09-24', payload: { questions: 25 } }] });
  const store = new DigestStore(d1);
  const sent = [];
  const deps = { now: () => dhakaAt(2026, 9, 24, 20), store, send: async (u, m) => { sent.push(m); return { ok: true, sent: 1 }; } };
  await runScheduledDigests({ __skipFcmCheck: true, PROFILE_DB: d1 }, deps);
  await runScheduledDigests({ __skipFcmCheck: true, PROFILE_DB: d1 }, deps);
  const third = await runScheduledDigests({ __skipFcmCheck: true, PROFILE_DB: d1 }, deps);
  assert.equal(sent.length, 1, 'exactly one delivery across three ticks');
  assert.equal(third.sent, 0);
});

test('d17: the Sunday weekly digest summarizes the seven days ending yesterday', async () => {
  /* 2026-09-27 is a Sunday; its digest covers 20–26 Sep. A row inside that
   * window counts; one a day older does not. */
  const { sent } = await runWith({
    daily: [
      { user_id: 'u1', day: '2026-09-19', payload: { questions: 999 } },
      { user_id: 'u1', day: '2026-09-20', payload: { questions: 10, correct: 8 } },
      { user_id: 'u1', day: '2026-09-26', payload: { questions: 30, correct: 24 } }
    ]
  }, { now: () => dhakaAt(2026, 9, 27, 10) });
  assert.equal(sent.length, 1, 'the rarest due digest wins the one slot');
  assert.equal(sent[0].message.kind, 'digest-weekly');
  assert.match(sent[0].message.body, /40/, '20–26 Sep only: 10 + 30, not the 999 from the 19th');
  assert.match(sent[0].message.body, /২|2/, 'two active days');
});

test('d18: one digest per day, the rarest first, on a triple-due day', async () => {
  /* 2026-11-01 (Sunday, 1st) — monthly, weekly and daily all due. */
  const { out, sent } = await runWith({
    daily: [
      { user_id: 'u1', day: '2026-10-15', payload: { questions: 10 } },
      { user_id: 'u1', day: '2026-10-28', payload: { questions: 12 } },
      { user_id: 'u1', day: '2026-11-01', payload: { questions: 5 } }
    ]
  }, { now: () => dhakaAt(2026, 11, 1, 10) });
  assert.equal(sent.length, 1, 'the daily cap of one is respected');
  assert.equal(sent[0].message.kind, 'digest-monthly', 'the rarest digest wins');
  assert.equal(out.sent, 1);
});

test('d19: the weekly digest waits when the week had no study', async () => {
  const { sent } = await runWith({
    daily: [{ user_id: 'u1', day: '2026-09-27', payload: { questions: 5 } }]
  }, { now: () => dhakaAt(2026, 9, 27, 10) });
  assert.equal(sent.length, 0, 'nothing studied in 17–23 Sep, so nothing to recap');
});

test('d20: quiet hours and the nudge opt-out both silence digests', async () => {
  const night = await runWith({
    daily: [{ user_id: 'u1', day: '2026-09-24', payload: { questions: 25 } }]
  }, { now: () => dhakaAt(2026, 9, 24, 23) });
  assert.equal(night.sent.length, 0, 'inside quiet hours');

  const optedOut = await runWith({
    settings: [{ user_id: 'u1', personalized_enabled: 0, quiet_hours_enabled: 1 }],
    daily: [{ user_id: 'u1', day: '2026-09-24', payload: { questions: 25 } }]
  }, { now: () => dhakaAt(2026, 9, 24, 20) });
  assert.equal(optedOut.sent.length, 0, 'a student who muted nudges is not recap-spammed');
});

test('d21: a student with no device is not in the audience', async () => {
  const { out } = await runWith({
    devices: [],
    daily: [{ user_id: 'u1', day: '2026-09-24', payload: { questions: 25 } }]
  }, { now: () => dhakaAt(2026, 9, 24, 20) });
  assert.equal(out.processed, 0);
});

test('d22: one broken account does not stop the rest', async () => {
  const d1 = makeFakeD1({
    devices: [{ user_id: 'bad', is_active: 1 }, { user_id: 'good', is_active: 1 }],
    settings: [],
    daily: [{ user_id: 'good', day: '2026-09-24', payload: { questions: 25 } }]
  });
  const store = new DigestStore(d1);
  const sent = [];
  const original = store.rangeStats.bind(store);
  store.rangeStats = async (userId, from, to) => {
    if (userId === 'bad') throw new Error('corrupt row');
    return original(userId, from, to);
  };
  const out = await runScheduledDigests({ __skipFcmCheck: true, PROFILE_DB: d1 },
    { now: () => dhakaAt(2026, 9, 24, 20), store, send: async (u, m) => { sent.push(u); return { ok: true, sent: 1 }; } });
  assert.ok(out.results.some(r => r.ok === false), 'the bad account is reported, not fatal');
  assert.deepEqual(sent, ['good'], 'the good account still gets its digest');
});

test('d24: a student with a known opening hour is timed to it', async () => {
  /* 12 opens at 21:00 Dhaka is enough history to be confident, so the daily
   * recap moves from the 20:00 default to 21:00 for this student. */
  const reads = Array.from({ length: 12 }, () => ({ user_id: 'u1', read_at: Date.UTC(2026, 8, 20, 21 - 6, 0) }));
  const { sent } = await runWith({
    reads,
    daily: [{ user_id: 'u1', day: '2026-09-24', payload: { questions: 25 } }]
  }, { now: () => dhakaAt(2026, 9, 24, 21) });
  assert.equal(sent.length, 1, 'the 21:00 window is now their send hour');
  assert.equal(sent[0].message.kind, 'digest-daily');

  /* The same student at 20:00 — still their default — sees nothing yet. */
  const before = await runWith({
    reads,
    daily: [{ user_id: 'u1', day: '2026-09-24', payload: { questions: 25 } }]
  }, { now: () => dhakaAt(2026, 9, 24, 20) });
  assert.equal(before.sent.length, 0, 'their hour has not arrived');
});

test('d25: a student with no opening history keeps the default hour', async () => {
  const { sent } = await runWith({
    daily: [{ user_id: 'u1', day: '2026-09-24', payload: { questions: 25 } }]
  }, { now: () => dhakaAt(2026, 9, 24, 20) });
  assert.equal(sent.length, 1, 'the fixed default still fires');
});
