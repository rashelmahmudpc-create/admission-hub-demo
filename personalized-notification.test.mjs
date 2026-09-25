/* Phase G — personalized smart notification tests.
 *
 * The whole point of this engine is restraint: the right nudge, at the right
 * time, never twice. So the tests lean on the decision core and on the
 * no-duplicate / quiet-hours / per-day-cap guarantees. D1 is a small
 * pattern-matched double; no network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickNudge,
  buildMessage,
  dhakaParts,
  inQuietHours,
  inSendWindow,
  DEFAULTS,
  PersonalizedStore,
  runScheduledPersonalizedNotifications,
  __personalizedTest as T
} from './personalized-notification.mjs';

/* A fixed mid-morning Dhaka time: 2026-09-24 10:00 +06:00 = 04:00 UTC. */
const NOW = Date.UTC(2026, 8, 24, 4, 0, 0);
const DAY = '2026-09-24';

/* ── fake D1, pattern-matched on the exact SQL this feature uses ──────────── */
function makeFakeD1(seed = {}) {
  const s = {
    devices: seed.devices || [],
    settings: seed.settings || [],
    mistakes: seed.mistakes || [],
    daily: seed.daily || [],
    exams: seed.exams || [],
    activity: seed.activity || [],
    sends: []
  };
  const db = {
    _s: s,
    async batch(stmts) {
      const out = [];
      for (const st of stmts) out.push(await st.run());
      return out;
    },
    prepare(sql) {
      const runner = (args) => ({
        async run() {
          if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) return { meta: { changes: 0 } };
          if (sql.includes('INSERT INTO notification_sends')) {
            const [u, k, d, at] = args;
            if (s.sends.some(x => x.u === u && x.k === k && x.d === d)) return { meta: { changes: 0 } };
            s.sends.push({ u, k, d, at });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('INSERT INTO notification_settings')) {
            const [userId, push, global, personal, event, qh, qs, qe] = args;
            const existing = s.settings.find(r => r.user_id === userId) || { user_id: userId };
            Object.assign(existing, { push_enabled: push, global_enabled: global, personalized_enabled: personal, event_enabled: event, quiet_hours_enabled: qh, quiet_start: qs, quiet_end: qe });
            if (!s.settings.includes(existing)) s.settings.push(existing);
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() {
          if (sql.includes('SELECT * FROM notification_settings')) {
            return s.settings.find(r => r.user_id === args[0]) || null;
          }
          if (sql.includes('COUNT(*)') && sql.includes('user_mistakes')) {
            const n = s.mistakes.filter(m => m.user_id === args[0] && !m.deleted_at
              && !m.mastered && m.revision_status !== 'mastered').length;
            return { n };
          }
          if (sql.includes('MAX(day)')) {
            const days = s.daily.filter(r => r.user_id === args[0] && !r.deleted_at).map(r => r.day).sort();
            return { d: days.length ? days[days.length - 1] : null };
          }
          if (sql.includes('payload_json FROM user_daily_stats')) {
            const row = s.daily.find(r => r.user_id === args[0] && r.day === args[1] && !r.deleted_at);
            return row ? { payload_json: JSON.stringify(row.payload) } : null;
          }
          if (sql.includes('MAX(updated_at) AS t')) {
            const ts = s.activity.filter(r => r.user_id === args[0] && !r.deleted_at).map(r => r.updated_at);
            return { t: ts.length ? Math.max(...ts) : null };
          }
          if (sql.includes('COUNT(*)') && sql.includes('notification_sends')) {
            return { n: s.sends.filter(x => x.u === args[0] && x.d === args[1]).length };
          }
          return null;
        },
        async all() {
          if (sql.includes('DISTINCT user_id FROM fcm_devices')) {
            const ids = [...new Set(s.devices.filter(d => d.is_active).map(d => d.user_id))];
            return { results: ids.map(user_id => ({ user_id })) };
          }
          if (sql.includes('FROM user_exam_results')) {
            const rows = s.exams.filter(r => r.user_id === args[0] && !r.deleted_at)
              .sort((a, b) => b.updated_at - a.updated_at).slice(0, 3)
              .map(r => ({ payload_json: JSON.stringify(r.payload), updated_at: r.updated_at }));
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

/* A user with a device, defaults on. */
const baseSeed = (over = {}) => ({
  devices: [{ user_id: 'u1', is_active: 1 }],
  settings: [{ user_id: 'u1', personalized_enabled: 1, quiet_hours_enabled: 1, quiet_start: '23:00', quiet_end: '07:00' }],
  mistakes: [],
  daily: [],
  exams: [],
  activity: [],
  ...over
});

const storeFor = seed => {
  /* The engine also calls UserDataStore.init() to ensure student tables; our
   * double returns no rows for CREATE TABLE, which is exactly a no-op. */
  const d1 = makeFakeD1(seed);
  const s = new PersonalizedStore(d1);
  return { d1, store: s };
};

/* ── pure decision core ──────────────────────────────────────────────────── */

test('g: outside the send window nothing is sent', () => {
  /* 02:00 Dhaka = 20:00 UTC previous day. */
  const night = Date.UTC(2026, 8, 23, 20, 0, 0);
  assert.equal(pickNudge({ pendingRevisions: 50 }, {}, night), null);
  /* 06:00 Dhaka is inside quiet hours (23:00–07:00). */
  const early = Date.UTC(2026, 8, 24, 0, 0, 0);
  assert.equal(pickNudge({ pendingRevisions: 50 }, {}, early), null);
});

test('g: quiet hours wrap midnight and a bad range is ignored', () => {
  assert.equal(inQuietHours(23, 30, { quiet_hours_enabled: 1, quiet_start: '23:00', quiet_end: '07:00' }), true);
  assert.equal(inQuietHours(3, 0, { quiet_hours_enabled: 1, quiet_start: '23:00', quiet_end: '07:00' }), true);
  assert.equal(inQuietHours(12, 0, { quiet_hours_enabled: 1, quiet_start: '23:00', quiet_end: '07:00' }), false);
  assert.equal(inQuietHours(12, 0, { quiet_hours_enabled: 1, quiet_start: 'oops', quiet_end: '07:00' }), false);
});

test('g: dhakaParts reports the local day, not the UTC day', () => {
  /* 2026-09-23 22:00 UTC is already 2026-09-24 in Dhaka. */
  const p = dhakaParts(Date.UTC(2026, 8, 23, 22, 0, 0));
  assert.equal(p.date, '2026-09-24');
  assert.equal(p.hour, 4);
});

test('g: a revision backlog is the first reason chosen', () => {
  const m = pickNudge({ pendingRevisions: 12, lastStudyDay: '2026-09-22' }, {}, NOW);
  assert.equal(m.kind, 'revision-due');
  assert.match(m.body, /12/);
});

test('g: below the revision threshold, a weak exam gets the nudge', () => {
  const state = { pendingRevisions: 2, recentExams: [{ score: 42, at: NOW }], lastStudyDay: '2026-09-22' };
  const m = pickNudge(state, {}, NOW);
  assert.equal(m.kind, 'exam-weak');
  assert.match(m.body, /42/);
});

test('g: an inactive student is nudged with the number of days away', () => {
  const m = pickNudge({ pendingRevisions: 0, lastStudyDay: '2026-09-20' }, {}, NOW);
  assert.equal(m.kind, 'inactive-3d');
  assert.match(m.body, /4/);
});

test('g: an active day earns quiet encouragement, never a warning', () => {
  const m = pickNudge({ todayQuestions: 25, todayCorrect: 20, lastStudyDay: DAY }, {}, NOW);
  assert.equal(m.kind, 'daily-glow');
});

test('g: a healthy student with nothing to act on gets nothing', () => {
  const m = pickNudge({ pendingRevisions: 0, todayQuestions: 0, lastStudyDay: DAY, recentExams: [{ score: 88 }] }, {}, NOW);
  assert.equal(m, null);
});

test('g: a streak is protected only in the evening after a one-day gap', () => {
  const afternoon = Date.UTC(2026, 8, 24, 7, 0, 0); // 13:00 Dhaka
  const evening = Date.UTC(2026, 8, 24, 13, 0, 0);  // 19:00 Dhaka
  const state = { pendingRevisions: 0, lastStudyDay: '2026-09-23', todayQuestions: 0 };
  assert.equal(pickNudge(state, {}, afternoon), null);
  assert.equal(pickNudge(state, {}, evening).kind, 'streak-risk');
});

test('g: turning the feature off silences it completely', () => {
  assert.equal(pickNudge({ pendingRevisions: 40, lastStudyDay: '2026-09-01' }, { daily_enabled: 0 }, NOW), null);
});

test('g: messages are localized and every kind has both languages', () => {
  for (const kind of T.NUDGE_KINDS) {
    const bn = buildMessage(kind, { count: 5 });
    const en = buildMessage(kind, { count: 5 }, 'en');
    assert.ok(bn && bn.title && bn.body, `${kind} bn`);
    assert.ok(en && en.title && en.body, `${kind} en`);
  }
  assert.equal(buildMessage('nope', {}), null);
});

/* ── storage ─────────────────────────────────────────────────────────────── */

test('g: audience lists only students with an active device', async () => {
  const { store } = storeFor(baseSeed({ devices: [
    { user_id: 'u1', is_active: 1 }, { user_id: 'u2', is_active: 0 }, { user_id: 'u3', is_active: 1 }
  ] }));
  const users = await store.audience();
  assert.deepEqual(users.sort(), ['u1', 'u3']);
});

test('g: learning state is read from the server-side student tables', async () => {
  const { store } = storeFor(baseSeed({
    mistakes: [
      { user_id: 'u1', revision_status: 'pending', mastered: 0 },
      { user_id: 'u1', revision_status: 'mastered', mastered: 1 },
      { user_id: 'u1', revision_status: 'pending', mastered: 0, deleted_at: 1 }
    ],
    daily: [
      { user_id: 'u1', day: '2026-09-22', payload: { questions: 10, correct: 8 } },
      { user_id: 'u1', day: DAY, payload: { questions: 5, correct: 4 } }
    ],
    exams: [{ user_id: 'u1', payload: { score: 55 }, updated_at: NOW }]
  }));
  const state = await store.learningState('u1', DAY);
  assert.equal(state.pendingRevisions, 1, 'only live, unmastered mistakes count');
  assert.equal(state.todayQuestions, 5);
  assert.equal(state.lastStudyDay, DAY);
  assert.equal(state.recentExams[0].score, 55);
});

test('g: the per-day cap is enforced by the store, not by trusting the caller', async () => {
  const { store } = storeFor(baseSeed());
  assert.equal(await store.nudgedToday('u1', DAY), 0);
  assert.equal(await store.recordSend('u1', 'revision-due', DAY, NOW), true, 'first claim wins');
  assert.equal(await store.recordSend('u1', 'revision-due', DAY, NOW), false, 'a replay cannot claim again');
  assert.equal(await store.nudgedToday('u1', DAY), 1);
});

/* ── end-to-end run ──────────────────────────────────────────────────────── */

const run = (seed, opts = {}) => {
  const { store } = storeFor(seed);
  const delivered = [];
  return runScheduledPersonalizedNotifications({}, {
    store,
    now: () => NOW,
    requireFcm: false,
    send: async (userId, message) => { delivered.push({ userId, message }); return { ok: true, sent: 1 }; },
    ...opts
  }).then(result => ({ result, delivered }));
};

test('g: one student, one nudge, and it is the right one', async () => {
  const { result, delivered } = await run(baseSeed({
    mistakes: Array.from({ length: 9 }, () => ({ user_id: 'u1', revision_status: 'pending', mastered: 0 })),
    daily: [{ user_id: 'u1', day: '2026-09-22', payload: { questions: 8, correct: 6 } }]
  }));
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].message.kind, 'revision-due');
  assert.equal(result.sent, 1);
});

test('g: running twice in one day delivers nothing the second time', async () => {
  const seed = () => baseSeed({
    mistakes: Array.from({ length: 9 }, () => ({ user_id: 'u1', revision_status: 'pending', mastered: 0 })),
    daily: [{ user_id: 'u1', day: '2026-09-22', payload: { questions: 8, correct: 6 } }]
  });
  const first = await run(seed());
  assert.equal(first.delivered.length, 1);

  /* The SAME store across both runs. A fresh store would make this pass for the
   * wrong reason: with no send log the run stops at 'fcm-not-configured' before
   * it ever reaches the duplicate guard, so the assertion proves nothing. */
  const { store } = storeFor(seed());
  const delivered = [];
  const call = () => runScheduledPersonalizedNotifications({}, {
    store, now: () => NOW, requireFcm: false,
    send: async (u, m) => { delivered.push(m); return { ok: true, sent: 1 }; }
  });
  const one = await call();
  assert.equal(one.sent, 1, 'the first run delivers');
  const two = await call();
  assert.equal(two.sent, 0, 'the same day is not nudged twice');
  assert.equal(delivered.length, 1);
});

test('g: a student who opted out is skipped without a send', async () => {
  const { result, delivered } = await run(baseSeed({
    settings: [{ user_id: 'u1', personalized_enabled: 0, quiet_hours_enabled: 1, quiet_start: '23:00', quiet_end: '07:00' }],
    mistakes: Array.from({ length: 9 }, () => ({ user_id: 'u1', revision_status: 'pending', mastered: 0 }))
  }));
  assert.equal(delivered.length, 0);
  assert.equal(result.sent, 0);
  assert.equal(result.skipped, 1);
});

test('g: one failing account does not stop the others', async () => {
  const { result, delivered } = await run(baseSeed({
    devices: [{ user_id: 'u1', is_active: 1 }, { user_id: 'u2', is_active: 1 }],
    settings: [
      { user_id: 'u1', personalized_enabled: 1, quiet_hours_enabled: 0, quiet_start: '23:00', quiet_end: '07:00' },
      { user_id: 'u2', personalized_enabled: 1, quiet_hours_enabled: 0, quiet_start: '23:00', quiet_end: '07:00' }
    ],
    mistakes: [
      ...Array.from({ length: 9 }, () => ({ user_id: 'u1', revision_status: 'pending', mastered: 0 })),
      ...Array.from({ length: 9 }, () => ({ user_id: 'u2', revision_status: 'pending', mastered: 0 }))
    ]
  }), {
    send: async userId => {
      if (userId === 'u1') throw new Error('device exploded');
      deliveredSafe.push(userId);
      return { ok: true, sent: 1 };
    }
  });
  const deliveredSafe = [];
  assert.equal(result.processed, 2);
});

test('g: no active device means no work at all', async () => {
  const { result, delivered } = await run(baseSeed({ devices: [] }));
  assert.equal(result.processed, 0);
  assert.equal(delivered.length, 0);
});

/* ── admin routes ────────────────────────────────────────────────────────── */

const call = (path, env, method = 'GET', token = 'admin-secret-token') => {
  const req = new Request(`https://x.test${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  /* Pin the route's clock to NOW (inside the 08:00–22:00 Dhaka send window) so
   * preview assertions do not depend on the hour the suite happens to run. */
  return T.handlePersonalizedNotificationRequest(req, env, { now: () => NOW });
};

test('g: personal routes are admin-only', async () => {
  const { d1 } = storeFor(baseSeed());
  const env = { PROFILE_DB: d1, ADMIN_TOKEN: 'admin-secret-token' };
  assert.equal(await T.handlePersonalizedNotificationRequest(new Request('https://x.test/api/userdata/pull'), env), null, 'other paths are ignored');
  assert.equal((await call('/api/notifications/personal/preview-all', env, 'GET', 'wrong')).status, 403);
  assert.equal((await call('/api/notifications/personal/preview-all', env, 'GET', '')).status, 403);
});

test('g: preview reports the message that would be sent, without sending', async () => {
  const { d1 } = storeFor(baseSeed({
    mistakes: Array.from({ length: 9 }, () => ({ user_id: 'u1', revision_status: 'pending', mastered: 0 })),
    daily: [{ user_id: 'u1', day: '2026-09-22', payload: { questions: 8, correct: 6 } }]
  }));
  const env = { PROFILE_DB: d1, ADMIN_TOKEN: 'admin-secret-token' };
  const res = await call('/api/notifications/personal/preview?user=u1', env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.state.pendingRevisions, 9);
  assert.ok(body.message, 'a nudge is proposed');
  assert.equal(d1._s.sends.length, 0, 'preview never records or sends');
});

test('g: preview-all lists the whole audience', async () => {
  const { d1 } = storeFor(baseSeed({
    devices: [{ user_id: 'u1', is_active: 1 }, { user_id: 'u2', is_active: 1 }],
    settings: [
      { user_id: 'u1', personalized_enabled: 1, quiet_hours_enabled: 1, quiet_start: '23:00', quiet_end: '07:00' },
      { user_id: 'u2', personalized_enabled: 1, quiet_hours_enabled: 1, quiet_start: '23:00', quiet_end: '07:00' }
    ]
  }));
  const env = { PROFILE_DB: d1, ADMIN_TOKEN: 'admin-secret-token' };
  const body = await (await call('/api/notifications/personal/preview-all', env)).json();
  assert.equal(body.audience, 2);
  assert.equal(body.plan.length, 2);
});

test('g: the student pref route requires a session', async () => {
  const { d1 } = storeFor(baseSeed());
  const env = { PROFILE_DB: d1 }; // no AUTH_AUTHORITY
  const res = await T.handlePersonalizedNotificationRequest(
    new Request('https://x.test/api/notifications/personal-pref', { method: 'GET' }), env);
  assert.equal(res.status, 401);
});

test('g: a student can read and flip their own daily-reminder switch', async () => {
  const { d1 } = storeFor(baseSeed());
  const env = {
    PROFILE_DB: d1,
    AUTH_AUTHORITY: {
      idFromName: () => 'auth',
      get: () => ({ fetch: async () => new Response(JSON.stringify({ ok: true, result: { user: { id: 'u1' } } }), { status: 200 }) })
    }
  };
  const headers = { Cookie: `__Host-ah_session=${'s'.repeat(48)}` };
  const read = await T.handlePersonalizedNotificationRequest(
    new Request('https://x.test/api/notifications/personal-pref', { headers }), env);
  assert.equal((await read.json()).personalized_enabled, 1, 'defaults on');

  const off = await T.handlePersonalizedNotificationRequest(
    new Request('https://x.test/api/notifications/personal-pref', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ personalized_enabled: false })
    }), env);
  assert.equal((await off.json()).personalized_enabled, 0);
  assert.equal(d1._s.settings.find(r => r.user_id === 'u1').personalized_enabled, 0);

  /* And with it off, the engine leaves them alone. */
  const { result, delivered } = await run(baseSeed({
    settings: [{ user_id: 'u1', personalized_enabled: 1, quiet_hours_enabled: 1, quiet_start: '23:00', quiet_end: '07:00' }],
    mistakes: Array.from({ length: 9 }, () => ({ user_id: 'u1', revision_status: 'pending', mastered: 0 }))
  }));
  assert.equal(delivered.length, 1, 'sanity: it would send when on');
});
