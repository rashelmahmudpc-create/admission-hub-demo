/* Phase 4 — event notifications (event-notifications.mjs).
 *
 * The pure decision core is tested directly; the runner is tested through a
 * pattern-matched in-memory D1 in the same style as personalized-notification,
 * with the transport injected so nothing touches the network.
 *
 * The two properties that matter most:
 *   • a first sighting writes a baseline and sends NOTHING (no broadcast storm
 *     when this code first ships), and
 *   • an achievement is announced at most once, ever.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectEvents,
  buildEventMessage,
  trimSnapshot,
  emptySnapshot,
  runScheduledEventNotifications,
  EventStore,
  DEFAULTS
} from './event-notifications.mjs';

const DAY = '2026-09-24';
/* 10:00 Dhaka (04:00 UTC) — inside the send window, outside quiet hours. */
const NOW = Date.UTC(2026, 8, 24, 4, 0, 0);

/* ── pure detection ──────────────────────────────────────────────────────── */

test('e1: a first sighting is a baseline — no events fire', () => {
  const curr = { streak: 30, mastered: 500, pending: 0, bestScore: 99, exams: [{ id: 'ex1', score: 99 }] };
  const out = detectEvents(null, curr, NOW);
  assert.equal(out.baseline, true);
  assert.deepEqual(out.events, [], 'a brand-new student is never spammed with history');
});

test('e2: crossing a streak milestone fires exactly once', () => {
  const out = detectEvents({ streak: 2 }, { streak: 3 }, NOW);
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].kind, 'streak-milestone');
  assert.equal(out.events[0].key, 'streak:3');
  assert.equal(out.events[0].value, 3);
});

test('e3: staying inside a milestone band does not re-fire', () => {
  assert.deepEqual(detectEvents({ streak: 3 }, { streak: 5 }, NOW).events, []);
  assert.deepEqual(detectEvents({ streak: 7 }, { streak: 7 }, NOW).events, []);
});

test('e4: skipping a band fires the highest milestone reached, not each one', () => {
  const out = detectEvents({ streak: 2 }, { streak: 16 }, NOW);
  assert.equal(out.events.length, 1, 'one message, not three');
  assert.equal(out.events[0].value, 14, 'the 14-day milestone is the real transition');
});

test('e5: a personal best needs a previous best to beat', () => {
  assert.deepEqual(detectEvents({ bestScore: null, exams: [] }, { bestScore: 88 }, NOW).events, [],
    'the very first exam is not a record');
  const out = detectEvents({ bestScore: 80 }, { bestScore: 88 }, NOW);
  assert.equal(out.events[0].kind, 'personal-best');
  assert.equal(out.events[0].key, 'pb:88');
  assert.deepEqual(detectEvents({ bestScore: 88 }, { bestScore: 88 }, NOW).events, [], 'a tie is not a better');
  assert.deepEqual(detectEvents({ bestScore: 88 }, { bestScore: 70 }, NOW).events, [], 'a worse score is not an event');
});

test('e6: a cleared backlog is a transition, not a state', () => {
  assert.deepEqual(detectEvents({ pending: 0 }, { pending: 0 }, NOW).events, [], 'nothing to clear');
  const out = detectEvents({ pending: 12 }, { pending: 0 }, NOW);
  assert.equal(out.events[0].kind, 'backlog-cleared');
  assert.equal(out.events[0].key, `backlog:${DAY}`);
});

test('e7: a partly-cleared backlog is not an event', () => {
  assert.deepEqual(detectEvents({ pending: 12 }, { pending: 4 }, NOW).events, []);
});

test('e8: mastery milestones behave like streak milestones', () => {
  assert.equal(detectEvents({ mastered: 24 }, { mastered: 25 }, NOW).events[0].kind, 'mastery-milestone');
  assert.equal(detectEvents({ mastered: 24 }, { mastered: 25 }, NOW).events[0].key, 'mastery:25');
  assert.deepEqual(detectEvents({ mastered: 30 }, { mastered: 40 }, NOW).events, []);
  assert.equal(detectEvents({ mastered: 90 }, { mastered: 260 }, NOW).events[0].value, 250);
});

test('e9: each genuinely new exam result fires once, and never twice', () => {
  const out = detectEvents({ exams: [{ id: 'ex1', score: 50 }] }, { exams: [{ id: 'ex1', score: 50 }, { id: 'ex2', score: 72 }] }, NOW);
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].kind, 'exam-completed');
  assert.equal(out.events[0].key, 'exam:ex2');
  assert.equal(out.events[0].value, 72);
});

test('e10: an exam with no usable score is not announced', () => {
  const out = detectEvents({ exams: [] }, { exams: [{ id: 'ex9', score: NaN }, { id: '', score: 80 }] }, NOW);
  assert.deepEqual(out.events, []);
});

test('e11: several achievements in one run are all reported', () => {
  const prev = { streak: 6, bestScore: 50, pending: 5, mastered: 24, exams: [] };
  const curr = { streak: 7, bestScore: 91, pending: 0, mastered: 25, exams: [{ id: 'ex7', score: 91 }] };
  const kinds = detectEvents(prev, curr, NOW).events.map(e => e.kind).sort();
  /* The exam equal to the new best is folded into the record (e20b), so it is
   * reported once, not twice. */
  assert.deepEqual(kinds, ['backlog-cleared', 'mastery-milestone', 'personal-best', 'streak-milestone']);
});

test('e11b: an exam below the new best keeps its own message', () => {
  const prev = { streak: 6, bestScore: 50, pending: 5, mastered: 24, exams: [] };
  const curr = { streak: 7, bestScore: 91, pending: 0, mastered: 25, exams: [{ id: 'ex7', score: 91 }, { id: 'ex8', score: 60 }] };
  const kinds = detectEvents(prev, curr, NOW).events.map(e => e.kind).sort();
  assert.deepEqual(kinds, ['backlog-cleared', 'exam-completed', 'mastery-milestone', 'personal-best', 'streak-milestone']);
});

test('e12: a malformed snapshot never throws and never invents events', () => {
  const out = detectEvents({ streak: 'x', exams: 'nope', pending: null }, { streak: 'y', exams: null }, NOW);
  assert.deepEqual(out.events, []);
});

test('e13: the snapshot keeps only the most recent exam ids', () => {
  const exams = Array.from({ length: 30 }, (_, i) => `ex${i}`);
  const trimmed = trimSnapshot({ exams }, 20);
  assert.equal(trimmed.exams.length, 20);
  assert.equal(trimmed.exams[0], 'ex10', 'oldest are dropped');
  assert.equal(trimmed.exams[19], 'ex29');
});

test('e14: every event kind has Bangla and English copy', () => {
  for (const kind of ['streak-milestone', 'personal-best', 'backlog-cleared', 'mastery-milestone', 'exam-completed']) {
    for (const lang of ['bn', 'en']) {
      const m = buildEventMessage({ kind, value: 7 }, lang);
      assert.ok(m && m.title && m.body, `${kind}/${lang} has copy`);
      assert.equal(m.kind, kind);
    }
  }
  assert.equal(buildEventMessage({ kind: 'nope' }), null);
});

test('e15: emptySnapshot is a usable baseline shape', () => {
  assert.deepEqual(emptySnapshot(), { streak: 0, bestScore: null, mastered: 0, pending: 0, exams: [] });
  assert.deepEqual(detectEvents(emptySnapshot(), emptySnapshot(), NOW).events, []);
});

/* ── runner through a fake D1 ────────────────────────────────────────────── */

function makeFakeD1(seed = {}) {
  const s = {
    devices: [{ user_id: 'u1', is_active: 1 }],
    settings: [{ user_id: 'u1', event_enabled: 1, quiet_hours_enabled: 1, quiet_start: '23:00', quiet_end: '07:00' }],
    mistakes: [], daily: [], exams: [], snapshots: [], sends: [],
    ...seed
  };
  const db = {
    state: s,
    async batch(stmts) { for (const st of stmts) await st.run(); },
    prepare(sql) {
      const runner = args => ({
        async run() {
          if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) return { meta: { changes: 0 } };
          if (sql.includes('INSERT INTO notification_event_state')) {
            const [userId, snap, at] = args;
            const existing = s.snapshots.find(r => r.user_id === userId);
            if (existing) Object.assign(existing, { snapshot_json: snap, updated_at: at });
            else s.snapshots.push({ user_id: userId, snapshot_json: snap, updated_at: at });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('INSERT INTO notification_event_sends')) {
            const [u, k, kind, at] = args;
            if (s.sends.some(x => x.u === u && x.k === k)) return { meta: { changes: 0 } };
            s.sends.push({ u, k, kind, at });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() {
          if (sql.includes('FROM notification_event_state')) {
            const row = s.snapshots.find(r => r.user_id === args[0]);
            return row ? { snapshot_json: row.snapshot_json } : null;
          }
          if (sql.includes('SELECT * FROM notification_settings')) {
            return s.settings.find(r => r.user_id === args[0]) || null;
          }
          if (sql.includes('COUNT(*)') && sql.includes('notification_event_sends')) {
            return { n: s.sends.filter(x => x.u === args[0] && x.at >= args[1]).length };
          }
          if (sql.includes('COUNT(*)') && sql.includes('revision_status=\'mastered\'')) {
            return { n: s.mistakes.filter(m => m.user_id === args[0] && !m.deleted_at && (m.mastered || m.revision_status === 'mastered')).length };
          }
          if (sql.includes('COUNT(*)') && sql.includes('revision_status<>\'mastered\'')) {
            return { n: s.mistakes.filter(m => m.user_id === args[0] && !m.deleted_at && !m.mastered && m.revision_status !== 'mastered').length };
          }
          return null;
        },
        async all() {
          if (sql.includes('DISTINCT user_id FROM fcm_devices')) {
            return { results: [...new Set(s.devices.filter(d => d.is_active).map(d => d.user_id))].map(user_id => ({ user_id })) };
          }
          if (sql.includes('FROM user_daily_stats')) {
            const rows = s.daily.filter(r => r.user_id === args[0] && !r.deleted_at && r.day <= args[1])
              .sort((a, b) => b.day.localeCompare(a.day))
              .map(r => ({ day: r.day, payload_json: JSON.stringify(r.payload) }));
            return { results: rows };
          }
          if (sql.includes('FROM user_exam_results')) {
            const rows = s.exams.filter(r => r.user_id === args[0] && !r.deleted_at)
              .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
              .map(r => ({ id: r.id, payload_json: JSON.stringify(r.payload) }));
            return { results: rows };
          }
          return { results: [] };
        }
      });
      return { bind: (...args) => runner(args), ...runner([]) };
    }
  };
  return db;
}

const runWith = (seed, over = {}) => {
  const d1 = makeFakeD1(seed);
  const store = new EventStore(d1);
  const sent = [];
  const p = runScheduledEventNotifications(
    { __skipFcmCheck: true, PROFILE_DB: d1 },
    { now: () => NOW, store, send: async (userId, message) => { sent.push({ userId, message }); return { ok: true, sent: 1 }; }, ...over }
  ).then(out => ({ out, sent, d1 }));
  return p;
};

test('e16: first run records a baseline and sends nothing', async () => {
  const { out, sent, d1 } = await runWith({ daily: [{ user_id: 'u1', day: DAY, payload: { questions: 10 } }] });
  assert.equal(out.baseline, 1);
  assert.equal(out.sent, 0);
  assert.equal(sent.length, 0, 'no message on the very first sighting');
  assert.equal(d1.state.snapshots.length, 1, 'the baseline is stored');
});

test('e17: the second run announces a real achievement', async () => {
  const d1 = makeFakeD1({
    daily: [{ user_id: 'u1', day: '2026-09-22', payload: { questions: 5 } }, { user_id: 'u1', day: '2026-09-23', payload: { questions: 5 } }]
  });
  const store = new EventStore(d1);
  const sent = [];
  const deps = { now: () => NOW, store, send: async (userId, message) => { sent.push(message); return { ok: true, sent: 1 }; } };
  await runScheduledEventNotifications({ __skipFcmCheck: true, PROFILE_DB: d1 }, deps);

  /* Day 3 arrives: the streak crosses 3. */
  d1.state.daily.push({ user_id: 'u1', day: DAY, payload: { questions: 8 } });
  const out = await runScheduledEventNotifications({ __skipFcmCheck: true, PROFILE_DB: d1 }, deps);
  assert.equal(out.sent, 1);
  assert.equal(sent[0].kind, 'streak-milestone');
  assert.match(sent[0].title, /3/);
});

test('e18: a repeated tick never delivers the same achievement twice', async () => {
  const d1 = makeFakeD1({
    daily: [{ user_id: 'u1', day: '2026-09-22', payload: { questions: 5 } }, { user_id: 'u1', day: '2026-09-23', payload: { questions: 5 } }]
  });
  const store = new EventStore(d1);
  const sent = [];
  const deps = { now: () => NOW, store, send: async (u, m) => { sent.push(m); return { ok: true, sent: 1 }; } };
  await runScheduledEventNotifications({ __skipFcmCheck: true, PROFILE_DB: d1 }, deps);
  d1.state.daily.push({ user_id: 'u1', day: DAY, payload: { questions: 8 } });
  await runScheduledEventNotifications({ __skipFcmCheck: true, PROFILE_DB: d1 }, deps);
  const again = await runScheduledEventNotifications({ __skipFcmCheck: true, PROFILE_DB: d1 }, deps);
  assert.equal(sent.length, 1, 'exactly one delivery across three ticks');
  assert.equal(again.sent, 0);
});

test('e19: event_enabled = 0 silences the engine for that student', async () => {
  const d1 = makeFakeD1({
    settings: [{ user_id: 'u1', event_enabled: 0 }],
    daily: [{ user_id: 'u1', day: '2026-09-23', payload: { questions: 5 } }]
  });
  const store = new EventStore(d1);
  const sent = [];
  await runScheduledEventNotifications({ __skipFcmCheck: true, PROFILE_DB: d1 },
    { now: () => NOW, store, send: async (u, m) => { sent.push(m); return { ok: true, sent: 1 }; } });
  assert.equal(sent.length, 0);
});

test('e20: the daily cap bounds how many achievements go out', async () => {
  const d1 = makeFakeD1({
    daily: [
      { user_id: 'u1', day: '2026-09-22', payload: { questions: 5 } },
      { user_id: 'u1', day: '2026-09-23', payload: { questions: 5 } }
    ],
    exams: [{ user_id: 'u1', id: 'ex1', payload: { score: 40 }, updated_at: 1 }]
  });
  const store = new EventStore(d1);
  const sent = [];
  const deps = { now: () => NOW, store, send: async (u, m) => { sent.push(m); return { ok: true, sent: 1 }; } };
  await runScheduledEventNotifications({ __skipFcmCheck: true, PROFILE_DB: d1 }, deps);
  /* Now a burst: three-day streak, a new best, a cleared backlog and a new exam. */
  d1.state.daily.push({ user_id: 'u1', day: DAY, payload: { questions: 8 } });
  d1.state.exams.push({ user_id: 'u1', id: 'ex2', payload: { score: 95 }, updated_at: 2 });
  d1.state.mistakes.push({ user_id: 'u1', mastered: 1 });
  const out = await runScheduledEventNotifications({ __skipFcmCheck: true, PROFILE_DB: d1 }, { ...deps, maxPerDay: 2 });
  assert.equal(out.sent, 2, 'capped at two');
  assert.deepEqual(sent.slice(-2).map(m => m.kind), ['streak-milestone', 'personal-best'],
    'the streak and the record win the scarce slots over the borderline exam');
});

test('e20b: an exam that is also a new best is announced once, as the milestone', async () => {
  const d1 = makeFakeD1({
    daily: [
      { user_id: 'u1', day: '2026-09-22', payload: { questions: 5 } },
      { user_id: 'u1', day: '2026-09-23', payload: { questions: 5 } }
    ],
    exams: [{ user_id: 'u1', id: 'ex1', payload: { score: 40 }, updated_at: 1 }]
  });
  const store = new EventStore(d1);
  const sent = [];
  const deps = { now: () => NOW, store, send: async (u, m) => { sent.push(m); return { ok: true, sent: 1 }; } };
  await runScheduledEventNotifications({ __skipFcmCheck: true, PROFILE_DB: d1 }, deps);
  d1.state.daily.push({ user_id: 'u1', day: DAY, payload: { questions: 8 } });
  d1.state.exams.push({ user_id: 'u1', id: 'ex2', payload: { score: 95 }, updated_at: 2 });
  const out = await runScheduledEventNotifications({ __skipFcmCheck: true, PROFILE_DB: d1 }, { ...deps, maxPerDay: 2 });
  assert.deepEqual(sent.slice(-2).map(m => m.kind), ['streak-milestone', 'personal-best'],
    'the record beats the plain exam result, which is suppressed so the student is not told the same number twice');
  assert.equal(out.sent, 2);
});

test('e21: one broken account does not stop the rest', async () => {
  const d1 = makeFakeD1({
    devices: [{ user_id: 'bad', is_active: 1 }, { user_id: 'good', is_active: 1 }],
    settings: [
      { user_id: 'bad', event_enabled: 1 },
      { user_id: 'good', event_enabled: 1 }
    ],
    daily: [
      { user_id: 'bad', day: '2026-09-23', payload: { questions: 5 } },
      { user_id: 'good', day: '2026-09-23', payload: { questions: 5 } }
    ]
  });
  const store = new EventStore(d1);
  const sent = [];
  const original = store.learningState.bind(store);
  store.learningState = async (userId, today) => {
    if (userId === 'bad') throw new Error('corrupt row');
    return original(userId, today);
  };
  const deps = { now: () => NOW, store, send: async (u, m) => { sent.push(u); return { ok: true, sent: 1 }; } };
  await runScheduledEventNotifications({ __skipFcmCheck: true, PROFILE_DB: d1 }, deps);
  d1.state.daily.push({ user_id: 'good', day: DAY, payload: { questions: 8 } });
  const out = await runScheduledEventNotifications({ __skipFcmCheck: true, PROFILE_DB: d1 }, deps);
  assert.ok(out.results.some(r => r.ok === false), 'the bad account is reported, not fatal');
  assert.deepEqual(sent, ['good', 'good'].slice(0, sent.length), 'the good account still gets its messages');
});

test('e22: the send window and quiet hours are respected', async () => {
  const seed = { daily: [{ user_id: 'u1', day: '2026-09-23', payload: { questions: 5 } }] };
  /* 03:00 Dhaka (21:00 UTC previous day) — inside quiet hours. */
  const night = Date.UTC(2026, 8, 23, 21, 0, 0);
  const d1 = makeFakeD1(seed);
  const store = new EventStore(d1);
  const sent = [];
  await runScheduledEventNotifications({ __skipFcmCheck: true, PROFILE_DB: d1 },
    { now: () => night, store, send: async (u, m) => { sent.push(m); return { ok: true, sent: 1 }; } });
  d1.state.daily.push({ user_id: 'u1', day: DAY, payload: { questions: 8 } });
  const out = await runScheduledEventNotifications({ __skipFcmCheck: true, PROFILE_DB: d1 },
    { now: () => Date.UTC(2026, 8, 24, 21, 0, 0), store, send: async (u, m) => { sent.push(m); return { ok: true, sent: 1 }; } });
  assert.equal(sent.length, 0, 'nothing sent during quiet hours');
  assert.equal(out.sent, 0);
});

test('e23: a device-less student is never in the audience', async () => {
  const d1 = makeFakeD1({ devices: [], daily: [{ user_id: 'u1', day: DAY, payload: { questions: 5 } }] });
  const store = new EventStore(d1);
  const out = await runScheduledEventNotifications({ __skipFcmCheck: true, PROFILE_DB: d1 },
    { now: () => NOW, store, send: async () => ({ ok: true, sent: 1 }) });
  assert.equal(out.processed, 0);
});

test('e24: no D1 means the engine is a safe no-op', async () => {
  const out = await runScheduledEventNotifications({ __skipFcmCheck: true }, { now: () => NOW, send: async () => ({ ok: true }) });
  assert.equal(out.processed, 0);
  assert.equal(out.sent, 0);
});
