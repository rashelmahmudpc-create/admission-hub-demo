/* Phase 3 — Notification & Engagement Intelligence tests.
 *
 * The brief's completion standard is a list of twenty-one guarantees. Every one
 * of them is a test here, named after the guarantee, so the standard cannot rot:
 * eligibility, priority, frequency, cooldown, duplicate protection, quiet hours,
 * preferences, timezone, the five intelligences, fatigue, FCM integration,
 * learning conversion, A/B, the feedback loop and the AI-ready split.
 *
 * The decision core is pure, so most tests need no I/O at all. Where storage is
 * needed, D1 is a small pattern-matched double and FCM is injected — no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KIND_META, KIND_ORDER, DEFAULTS, DEFAULT_PREFS, AB_VARIANTS, LEARNING_KINDS,
  localParts, inQuietHours, inSendWindow, dayDiff,
  computeSignals, classifySegment, buildCandidates, rankCandidates,
  detectFatigue, effectiveCap, checkFrequency, dayPart, preferredHour, bestSendWindow,
  hashToInt, assignVariant, buildMessage, attributeConversion,
  computePerformance, computeFeedback, computeDecisionStats, decide,
  IntelligenceStore, runScheduledIntelligenceNotifications, handleIntelligenceRequest,
  __intelligenceTest as T
} from './notification-intelligence.mjs';

/* 2026-09-24 10:00 in Dhaka (UTC+6) — inside the 08:00–22:00 send window. */
const NOW = Date.UTC(2026, 8, 24, 4, 0, 0);
const TODAY = '2026-09-24';

/* ── fake D1, pattern-matched on the exact SQL this feature uses ──────────── */

function makeFakeD1(seed = {}) {
  const s = {
    devices: seed.devices || [],
    sends: seed.sends || [],          // notification_sends (shared with Phase G)
    state: seed.state || [],          // notification_intel_state
    outcomes: seed.outcomes || [],    // notification_outcomes
    fatigue: seed.fatigue || [],
    decisions: seed.decisions || []   // notification_decisions
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
            if (s.sends.some(x => x.user_id === u && x.kind === k && x.day_key === d)) return { meta: { changes: 0 } };
            s.sends.push({ user_id: u, kind: k, day_key: d, sent_at: at });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('INSERT INTO notification_outcomes')) {
            const [user_id, key, kind, category, variant, day_key, sent_at, status] = args;
            if (s.outcomes.some(o => o.user_id === user_id && o.notification_key === key)) return { meta: { changes: 0 } };
            s.outcomes.push({ user_id, notification_key: key, kind, category, variant, day_key, sent_at, status, opened_at: 0, clicked_at: 0, learning_at: 0, learning_kind: null });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('INSERT INTO notification_decisions')) {
            const [id, user_id, rule, kind, score, decision, stage, reason, day_key, created_at] = args;
            const row = s.decisions.find(r => r.id === id);
            if (row) Object.assign(row, { kind, score, decision, stage, reason, created_at });
            else s.decisions.push({ id, user_id, rule, kind, score, decision, stage, reason, day_key, created_at });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('INSERT INTO notification_intel_state')) {
            const [user_id, tz, prefs_json, updated_at] = args;
            const row = s.state.find(r => r.user_id === user_id);
            if (row) Object.assign(row, { tz_offset_min: tz, prefs_json, updated_at });
            else s.state.push({ user_id, tz_offset_min: tz, prefs_json, updated_at });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('INSERT INTO notification_fatigue')) {
            const [user_id, sent, opened, clicked, open_rate, level, computed_at] = args;
            const row = s.fatigue.find(r => r.user_id === user_id);
            if (row) Object.assign(row, { sent, opened, clicked, open_rate, level, computed_at });
            else s.fatigue.push({ user_id, sent, opened, clicked, open_rate, level, computed_at });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE notification_outcomes SET opened_at')) {
            const [at, u, key] = args;
            const row = s.outcomes.find(o => o.user_id === u && o.notification_key === key);
            if (!row) return { meta: { changes: 0 } };
            row.opened_at = row.opened_at || at;
            return { meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE notification_outcomes SET clicked_at')) {
            const [at, u, key] = args;
            const row = s.outcomes.find(o => o.user_id === u && o.notification_key === key);
            if (!row) return { meta: { changes: 0 } };
            row.clicked_at = row.clicked_at || at;
            return { meta: { changes: 1 } };
          }
          if (sql.includes('SET learning_at=COALESCE')) {
            const [at, kind, u, key] = args;
            const row = s.outcomes.find(o => o.user_id === u && o.notification_key === key);
            if (!row) return { meta: { changes: 0 } };
            row.learning_at = row.learning_at || at;
            row.learning_kind = row.learning_kind || kind;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() {
          if (sql.includes('FROM notification_intel_state')) {
            const row = s.state.find(r => r.user_id === args[0]);
            return row ? { ...row } : null;
          }
          if (sql.includes('COUNT(*)') && sql.includes('FROM notification_sends')) {
            return { n: s.sends.filter(x => x.user_id === args[0] && x.day_key === args[1]).length };
          }
          if (sql.includes('COUNT(*)') && sql.includes('FROM notification_outcomes') && sql.includes('category=')) {
            const [u, d, cat] = args;
            return { n: s.outcomes.filter(o => o.user_id === u && o.day_key === d && o.category === cat && o.status !== 'failed').length };
          }
          if (sql.includes('MAX(sent_at)')) {
            const ts = s.outcomes.filter(o => o.user_id === args[0]).map(o => o.sent_at);
            return { t: ts.length ? Math.max(...ts) : null };
          }
          if (sql.includes('FROM notification_fatigue')) {
            const row = s.fatigue.find(r => r.user_id === args[0]);
            return row ? { ...row } : null;
          }
          return null;
        },
        async all() {
          if (sql.includes('DISTINCT user_id FROM fcm_devices')) {
            const ids = [...new Set(s.devices.filter(d => d.is_active).map(d => d.user_id))];
            return { results: ids.map(user_id => ({ user_id })) };
          }
          if (sql.includes('SELECT notification_key FROM notification_outcomes')) {
            return { results: s.outcomes.filter(o => o.user_id === args[0]).map(o => ({ notification_key: o.notification_key })) };
          }
          if (sql.includes('learning_at IS NULL')) {
            const [u, since] = args;
            const rows = s.outcomes.filter(o => o.user_id === u && o.sent_at >= since && !o.learning_at)
              .sort((a, b) => b.sent_at - a.sent_at).slice(0, 10);
            return { results: rows.map(r => ({ notification_key: r.notification_key, kind: r.kind, sent_at: r.sent_at, opened_at: r.opened_at, clicked_at: r.clicked_at })) };
          }
          if (sql.includes('FROM notification_outcomes WHERE user_id=? ORDER BY sent_at DESC')) {
            const [u, limit] = args;
            const rows = s.outcomes.filter(o => o.user_id === u).sort((a, b) => b.sent_at - a.sent_at).slice(0, limit);
            return { results: rows.map(r => ({ notification_key: r.notification_key, kind: r.kind, sent_at: r.sent_at, opened_at: r.opened_at, clicked_at: r.clicked_at })) };
          }
          if (sql.includes('FROM notification_decisions')) {
            return { results: s.decisions.filter(r => r.day_key === args[0]) };
          }
          if (sql.includes('FROM notification_outcomes WHERE day_key=?')) {
            return { results: s.outcomes.filter(o => o.day_key === args[0]) };
          }
          if (sql.includes('FROM notification_outcomes ORDER BY sent_at DESC')) {
            const limit = args[0];
            return { results: s.outcomes.slice().sort((a, b) => b.sent_at - a.sent_at).slice(0, limit) };
          }
          return { results: [] };
        }
      });
      return { bind: (...args) => runner(args), ...runner([]) };
    }
  };
  return db;
}

const storeFor = seed => {
  const d1 = makeFakeD1(seed);
  return { d1, store: new IntelligenceStore(d1) };
};

const signalsFor = over => computeSignals(over, NOW);

const baseSeed = (over = {}) => ({
  devices: [{ user_id: 'u1', is_active: 1 }],
  ...over
});

/* ── the eligibility pipeline (sections 1, 5, 18) ────────────────────────── */

test('p3-1: no device means no notification, before anything else is read', () => {
  const d = decide({ signals: signalsFor({}), deps: { nowMs: NOW, hasDevices: false } });
  assert.equal(d.decision, 'skip');
  assert.equal(d.stage, 'eligible');
  assert.equal(d.trace[0].reason, 'no-devices');
});

test('p3-2: push off and personalized off both stop the pipeline', () => {
  const signals = signalsFor({ mistakes: { pending: 20 } });
  assert.equal(decide({ signals, prefs: { push_enabled: 0 }, deps: { nowMs: NOW, hasDevices: true } }).stage, 'enabled');
  const d = decide({ signals, prefs: { personalized_enabled: 0 }, deps: { nowMs: NOW, hasDevices: true } });
  assert.equal(d.stage, 'enabled');
  assert.equal(d.reason, 'personalized-off');
});

test('p3-3: quiet hours are respected, in the student local time', () => {
  const signals = signalsFor({ mistakes: { pending: 20 } });
  /* 23:30 Dhaka — inside the default 23:00–07:00 quiet window. */
  const late = Date.UTC(2026, 8, 24, 17, 30, 0);
  const d = decide({ signals, prefs: {}, deps: { nowMs: late, hasDevices: true } });
  assert.equal(d.stage, 'quiet-hours');
});

test('p3-4: the send window keeps notifications out of the small hours', () => {
  /* 04:00 Dhaka — quiet, and outside the window even with quiet hours off. */
  const early = Date.UTC(2026, 8, 23, 22, 0, 0);
  const d = decide({ signals: signalsFor({ mistakes: { pending: 20 } }), prefs: { quiet_hours_enabled: 0 }, deps: { nowMs: early, hasDevices: true } });
  assert.equal(d.stage, 'send-window');
});

test('p3-5: a category the student switched off is never a candidate', () => {
  const signals = signalsFor({ dailyStats: [{ day: '2026-09-23', questions: 20, correct: 10 }], mistakes: { pending: 9, topics: [{ topic: 'algebra', misses: 7 }] } });
  /* Everything this student qualifies for is `learning`; switching it off must
   * leave nothing rather than fall through to a lower-priority kind. */
  const d = decide({ signals, prefs: { categories: { learning: 0, achievement: 1, challenge: 1, streak: 1 } }, deps: { nowMs: NOW, hasDevices: true } });
  assert.equal(d.decision, 'skip');
  assert.equal(d.stage, 'relevant');
});

/* ── smart audience selection (section 2) ────────────────────────────────── */

test('p3-6: audience segments are derived from behaviour, most urgent first', () => {
  const dormant = signalsFor({ dailyStats: [{ day: '2026-09-15', questions: 10 }] });
  assert.equal(classifySegment(dormant).segment, 'dormant');

  const struggling = signalsFor({ dailyStats: [{ day: '2026-09-23', questions: 30, correct: 12 }], mistakes: { topics: [{ topic: 'algebra', misses: 9 }] } });
  assert.equal(classifySegment(struggling).segment, 'struggling');

  const near = signalsFor({ dailyStats: [{ day: TODAY, questions: 20, correct: 18 }], courses: [{ id: 'c1', lessonsTotal: 20, lessonsDone: 19 }] });
  assert.equal(classifySegment(near).segment, 'milestone-near');

  const fresh = signalsFor({});
  assert.equal(classifySegment(fresh).segment, 'new');
});

test('p3-7: the streak-risk segment outranks a merely cooling student', () => {
  const s = signalsFor({ dailyStats: [{ day: '2026-09-22', questions: 10 }, { day: '2026-09-23', questions: 10 }] });
  assert.equal(s.streak, 2);
  assert.equal(s.streakRisk, true);
  assert.equal(classifySegment(s).segment, 'streak-risk');
});

/* ── priority engine (section 6) ─────────────────────────────────────────── */

test('p3-8: the priority table ranks streak and certificate above general nudges', () => {
  assert.ok(KIND_META['streak-risk'].priority > KIND_META['pending-learning'].priority);
  assert.ok(KIND_META['certificate'].priority > KIND_META['challenge'].priority);
  const ranked = rankCandidates([
    { kind: 'challenge', value: 1 }, { kind: 'pending-learning', value: 40 },
    { kind: 'streak-risk', value: 5 }, { kind: 'certificate', value: 1 }
  ]);
  assert.deepEqual(ranked.map(c => c.kind), ['streak-risk', 'certificate', 'pending-learning', 'challenge']);
});

test('p3-9: ranking is deterministic — equal priority breaks on the larger value', () => {
  const a = rankCandidates([{ kind: 'progress', value: 25 }, { kind: 'progress', value: 75 }]);
  assert.equal(a[0].value, 75);
});

test('p3-10: the highest-value candidate is the one that goes out', () => {
  const signals = signalsFor({
    dailyStats: [{ day: '2026-09-22', questions: 10 }, { day: '2026-09-23', questions: 10 }],
    mistakes: { pending: 30 }
  });
  const d = decide({ signals, prefs: {}, ctx: { hour: 19 }, deps: { nowMs: Date.UTC(2026, 8, 24, 13, 0, 0), hasDevices: true, userId: 'u1' } });
  assert.equal(d.decision, 'send');
  assert.equal(d.candidate.kind, 'streak-risk', 'streak-risk (90) beats pending-learning (55)');
});

/* ── frequency control, cooldown, duplicates (section 5) ─────────────────── */

test('p3-11: the daily limit stops a second notification in the same day', () => {
  const signals = signalsFor({ mistakes: { pending: 20 } });
  const d = decide({ signals, prefs: {}, deps: { nowMs: NOW, hasDevices: true, sendsToday: 1 } });
  assert.equal(d.decision, 'skip');
  assert.equal(d.stage, 'daily-limit');
});

test('p3-12: the per-category limit stops a second notification of the same kind', () => {
  const signals = signalsFor({ mistakes: { pending: 20 } });
  const d = decide({ signals, prefs: {}, deps: { nowMs: NOW, hasDevices: true, categorySends: { learning: 1 } } });
  assert.equal(d.stage, 'category-limit');
});

test('p3-13: the cooldown blocks a send that is too soon after the last one', () => {
  const signals = signalsFor({ mistakes: { pending: 20 } });
  const d = decide({ signals, prefs: {}, deps: { nowMs: NOW, hasDevices: true, lastSentAt: NOW - 60 * 1000 } });
  assert.equal(d.stage, 'cooldown');
});

test('p3-14: duplicate protection matches the stable candidate key', () => {
  const signals = signalsFor({ mistakes: { pending: 20 } });
  const key = buildCandidates(signals, { hour: 10 }).find(c => c.kind === 'pending-learning').key;
  const d = decide({ signals, prefs: {}, deps: { nowMs: NOW, hasDevices: true, seenKeys: new Set([key]) } });
  assert.equal(d.decision, 'skip');
  assert.ok(d.trace.some(t => t.stage === 'duplicate'));
});

test('p3-15: a blocked candidate does not stop the next-best one', () => {
  /* The learning category is capped, but the streak nudge is a different
   * category — it must still be considered. */
  const signals = signalsFor({ dailyStats: [{ day: '2026-09-22', questions: 10 }, { day: '2026-09-23', questions: 10 }] });
  const d = decide({
    signals, prefs: {}, ctx: { hour: 19 },
    deps: { nowMs: Date.UTC(2026, 8, 24, 13, 0, 0), hasDevices: true, categorySends: { learning: 1 } }
  });
  assert.equal(d.decision, 'send');
  assert.equal(d.candidate.kind, 'streak-risk');
});

/* ── the five intelligences (sections 12–16) ─────────────────────────────── */

test('p3-16: streak intelligence fires only after the day is wearing on', () => {
  /* Two active days ending yesterday: the streak is alive but today is empty. */
  const signals = signalsFor({ dailyStats: [{ day: '2026-09-22', questions: 10 }, { day: '2026-09-23', questions: 10 }] });
  assert.equal(signals.streak, 2);
  assert.ok(!buildCandidates(signals, { hour: 14 }).some(c => c.kind === 'streak-risk'));
  assert.ok(buildCandidates(signals, { hour: 19 }).some(c => c.kind === 'streak-risk'));
});

test('p3-17: comeback intelligence needs a real gap, not one quiet day', () => {
  const twoDays = signalsFor({ dailyStats: [{ day: '2026-09-22', questions: 10 }] });
  assert.ok(!buildCandidates(twoDays, { hour: 10 }).some(c => c.kind === 'comeback'));
  const fourDays = signalsFor({ dailyStats: [{ day: '2026-09-20', questions: 10 }] });
  const c = buildCandidates(fourDays, { hour: 10 }).find(x => x.kind === 'comeback');
  assert.ok(c);
  assert.equal(c.value, 4);
});

test('p3-18: progress intelligence fires when a milestone is within reach', () => {
  const signals = signalsFor({ dailyStats: [{ day: TODAY, questions: 10 }], courses: [{ id: 'c1', lessonsTotal: 20, lessonsDone: 19 }] });
  const c = buildCandidates(signals, { hour: 10 }).find(x => x.kind === 'progress');
  assert.ok(c, 'one lesson from 100% is a milestone');
  assert.equal(c.value, 100);
  assert.match(c.reason, /c1/);
});

test('p3-19: progress intelligence stays quiet when the milestone is far', () => {
  const signals = signalsFor({ dailyStats: [{ day: TODAY, questions: 10 }], courses: [{ id: 'c1', lessonsTotal: 100, lessonsDone: 10 }] });
  assert.ok(!buildCandidates(signals, { hour: 10 }).some(x => x.kind === 'progress'));
});

test('p3-20: achievement intelligence announces a crossed mark', () => {
  const signals = signalsFor({ dailyStats: [{ day: TODAY, questions: 10 }], courses: [{ id: 'c1', lessonsTotal: 10, lessonsDone: 5 }] });
  const kinds = buildCandidates(signals, { hour: 10 }).map(c => c.kind);
  assert.ok(kinds.includes('achievement'), '50% is an achievement');
});

test('p3-21: a finished course earns a certificate, not a progress nudge', () => {
  const signals = signalsFor({ dailyStats: [{ day: TODAY, questions: 10 }], courses: [{ id: 'c1', lessonsTotal: 10, lessonsDone: 10 }] });
  const kinds = buildCandidates(signals, { hour: 10 }).map(c => c.kind);
  assert.ok(kinds.includes('certificate'));
  assert.ok(!kinds.includes('progress'));
});

test('p3-22: weak-topic intelligence needs evidence, not one bad day', () => {
  const thin = signalsFor({ dailyStats: [{ day: '2026-09-23', questions: 3, correct: 0 }], mistakes: { topics: [{ topic: 'algebra', misses: 9 }] } });
  assert.ok(!buildCandidates(thin, { hour: 10 }).some(c => c.kind === 'weak-topic'), 'too few attempts');

  const real = signalsFor({ dailyStats: [{ day: '2026-09-23', questions: 30, correct: 12 }], mistakes: { topics: [{ topic: 'algebra', misses: 9 }] } });
  const c = buildCandidates(real, { hour: 10 }).find(x => x.kind === 'weak-topic');
  assert.ok(c);
  assert.match(c.reason, /algebra/);
});

/* ── fatigue detection (section 11) ──────────────────────────────────────── */

test('p3-23: fatigue is sent-up / opened-down over a minimum sample', () => {
  const ignored = Array.from({ length: 10 }, (_, i) => ({ sentAt: NOW - i * 3600000, openedAt: 0 }));
  const f = detectFatigue(ignored, NOW);
  assert.equal(f.sent, 10);
  assert.equal(f.opened, 0);
  assert.equal(f.fatigued, true);
  assert.equal(f.level, 'high');

  const two = detectFatigue([{ sentAt: NOW, openedAt: 0 }, { sentAt: NOW, openedAt: 0 }], NOW);
  assert.equal(two.fatigued, false, 'two ignores is not fatigue');
});

test('p3-24: an engaged student is never labelled fatigued', () => {
  const opened = Array.from({ length: 12 }, (_, i) => ({ sentAt: NOW - i * 3600000, openedAt: NOW - i * 3600000 + 60000 }));
  const f = detectFatigue(opened, NOW);
  assert.equal(f.fatigued, false);
  assert.equal(f.level, 'normal');
});

test('p3-25: fatigue lowers the frequency, and silences nudges first', () => {
  const fatigued = { fatigued: true, level: 'high' };
  assert.equal(effectiveCap({ max_per_day: 1 }, fatigued), 0);
  assert.equal(checkFrequency({ prefs: {}, fatigue: fatigued, isCelebration: false }).allowed, false);
  assert.equal(checkFrequency({ prefs: {}, fatigue: fatigued, isCelebration: true }).allowed, true, 'good news still reaches them');
});

/* ── smart timing (section 4) ────────────────────────────────────────────── */

test('p3-26: day parts match the brief and the night is weighted highest', () => {
  assert.equal(dayPart(2), 'night');
  assert.equal(dayPart(9), 'morning');
  assert.equal(dayPart(14), 'afternoon');
  assert.equal(dayPart(20), 'evening');
  assert.equal(T.DAY_PART_WEIGHT.night > T.DAY_PART_WEIGHT.evening, true);
});

test('p3-27: a learned hour beats the baseline once there is enough history', () => {
  assert.equal(preferredHour([{ hour: 20 }, { hour: 21 }]), null, 'two points is not a pattern');
  assert.equal(preferredHour([{ hour: 20 }, { hour: 21 }, { hour: 20 }]), 20);
  const learned = bestSendWindow({ history: [{ hour: 21 }, { hour: 21 }, { hour: 22 }] }, {});
  assert.equal(learned.source, 'learned');
  const baseline = bestSendWindow({ history: [] }, {});
  assert.equal(baseline.source, 'baseline');
});

/* ── timezone-aware delivery (section 19) ────────────────────────────────── */

test('p3-28: the same instant is a different local hour per student', () => {
  const instant = Date.UTC(2026, 8, 24, 4, 0, 0);
  assert.equal(localParts(instant, 360).hour, 10, 'Dhaka');
  assert.equal(localParts(instant, 0).hour, 4, 'UTC');
  assert.equal(localParts(instant, -300).hour, 23, 'New York');
});

test('p3-29: quiet hours follow the student timezone, not the server', () => {
  const instant = Date.UTC(2026, 8, 24, 4, 0, 0); // 10:00 Dhaka, 23:00 New York (prev day)
  const signals = signalsFor({ mistakes: { pending: 20 } });
  const dhaka = decide({ signals, prefs: { tz_offset_min: 360 }, deps: { nowMs: instant, hasDevices: true } });
  assert.equal(dhaka.decision, 'send');
  const ny = decide({ signals, prefs: { tz_offset_min: -300 }, deps: { nowMs: instant, hasDevices: true } });
  assert.equal(ny.decision, 'skip');
  assert.equal(ny.stage, 'quiet-hours');
});

test('p3-30: a timezone is stored and read back per student', async () => {
  const { store } = storeFor(baseSeed());
  await store.saveState('u1', { tzOffsetMin: -300, prefs: { categories: { streak: 0 } } }, NOW);
  const state = await store.getState('u1');
  assert.equal(state.tz_offset_min, -300);
  assert.equal(state.prefs.categories.streak, 0);
  assert.equal(state.prefs.categories.learning, 1, 'unspecified categories keep their default');
  assert.equal(state.stored, true);
});

/* ── A/B foundation (section 10) ─────────────────────────────────────────── */

test('p3-31: variant assignment is deterministic for the same student and kind', () => {
  const a = assignVariant('u1', 'streak-risk');
  const b = assignVariant('u1', 'streak-risk');
  assert.equal(a, b, 'a cron tick must not reshuffle the experiment');
  assert.ok(AB_VARIANTS.includes(a));
});

test('p3-32: variants differ in copy only, never in eligibility', () => {
  const a = buildMessage('streak-risk', { value: 3 }, 'bn', 'A');
  const b = buildMessage('streak-risk', { value: 3 }, 'bn', 'B');
  assert.notEqual(a.body, b.body);
  assert.equal(a.kind, b.kind);
  assert.equal(a.category, b.category);
});

test('p3-33: every kind has copy in every variant', () => {
  for (const kind of KIND_ORDER) {
    for (const variant of AB_VARIANTS) {
      const m = buildMessage(kind, { value: 5 }, 'bn', variant);
      assert.ok(m && m.title && m.body, `${kind}/${variant}`);
    }
  }
  assert.equal(buildMessage('nope', {}, 'bn', 'A'), null);
});

/* ── notification → learning conversion (section 8) ──────────────────────── */

test('p3-34: a learning event after the open is credited to the notification', () => {
  const send = { sentAt: NOW, openedAt: NOW + 60000 };
  const credit = attributeConversion(send, [{ kind: 'lesson_start', at: NOW + 120000 }]);
  assert.equal(credit.converted, true);
  assert.equal(credit.kind, 'lesson_start');
  assert.equal(credit.lagMs, 120000);
});

test('p3-35: learning that happened before the tap is not credited', () => {
  const send = { sentAt: NOW, openedAt: NOW + 300000 };
  const credit = attributeConversion(send, [{ kind: 'lesson_start', at: NOW + 120000 }]);
  assert.equal(credit.converted, false);
});

test('p3-36: a learning event outside the window is not credited', () => {
  const send = { sentAt: NOW };
  const credit = attributeConversion(send, [{ kind: 'lesson_complete', at: NOW + 7 * 3600000 }]);
  assert.equal(credit.converted, false);
});

test('p3-37: only real learning kinds count as a conversion', () => {
  const send = { sentAt: NOW };
  for (const kind of LEARNING_KINDS) {
    assert.equal(attributeConversion(send, [{ kind, at: NOW + 1000 }]).converted, true, kind);
  }
  assert.equal(attributeConversion(send, [{ kind: 'screen_view', at: NOW + 1000 }]).converted, false);
});

/* ── performance + feedback loop (sections 9, 20) ────────────────────────── */

test('p3-38: performance reports the full funnel per kind', () => {
  const rows = [
    { kind: 'progress', variant: 'A', status: 'sent', sentAt: NOW, openedAt: NOW + 1000, clickedAt: NOW + 2000, learningAt: NOW + 3000, hour: 10 },
    { kind: 'progress', variant: 'A', status: 'sent', sentAt: NOW, openedAt: 0, clickedAt: 0, learningAt: 0, hour: 10 },
    { kind: 'progress', variant: 'A', status: 'failed', sentAt: NOW, hour: 10 }
  ];
  const perf = computePerformance(rows);
  assert.equal(perf.totals.sent, 2);
  assert.equal(perf.totals.failed, 1);
  assert.equal(perf.totals.opened, 1);
  assert.equal(perf.totals.clicked, 1);
  assert.equal(perf.totals.converted, 1);
  assert.equal(perf.totals.conversion, 50);
  assert.equal(perf.byKind.progress.sent, 2);
});

test('p3-39: the feedback loop names a winning variant only with enough data', () => {
  const few = computeFeedback([
    { kind: 'progress', variant: 'A', status: 'sent', sentAt: NOW, openedAt: NOW },
    { kind: 'progress', variant: 'B', status: 'sent', sentAt: NOW, openedAt: 0 }
  ]);
  assert.equal(few.winner, null, 'two sends is not a result');

  const many = [];
  for (let i = 0; i < 30; i += 1) {
    many.push({ kind: 'progress', variant: 'A', status: 'sent', sentAt: NOW, openedAt: NOW, clickedAt: NOW, learningAt: NOW, hour: 20 });
    many.push({ kind: 'progress', variant: 'B', status: 'sent', sentAt: NOW, openedAt: 0, hour: 20 });
  }
  const win = computeFeedback(many);
  assert.equal(win.winner.variant, 'A');
  assert.equal(win.winner.beat, 'B');
  assert.equal(win.ready, true);
});

test('p3-40: the feedback loop learns the best hour from conversions', () => {
  const rows = [];
  for (let i = 0; i < 10; i += 1) rows.push({ kind: 'progress', variant: 'A', status: 'sent', sentAt: NOW, openedAt: NOW, learningAt: NOW, hour: 20 });
  for (let i = 0; i < 10; i += 1) rows.push({ kind: 'progress', variant: 'A', status: 'sent', sentAt: NOW, openedAt: 0, hour: 9 });
  const fb = computeFeedback(rows);
  assert.equal(fb.bestHour, 20);
});

/* ── AI-ready architecture (section 20) ──────────────────────────────────── */

test('p3-41: the decision core is pure — no I/O, no model, same input same output', () => {
  const signals = signalsFor({ mistakes: { pending: 20 } });
  const args = { signals, prefs: {}, deps: { nowMs: NOW, hasDevices: true, userId: 'u1' } };
  const first = decide(args);
  const second = decide(args);
  assert.deepEqual(first, second);
  assert.equal(first.decision, 'send');
  assert.ok(Array.isArray(first.trace), 'the pipeline explains itself stage by stage');
});

/* ── storage ─────────────────────────────────────────────────────────────── */

test('p3-42: the audience is only students with an active device', async () => {
  const { store } = storeFor({ devices: [{ user_id: 'u1', is_active: 1 }, { user_id: 'u2', is_active: 0 }, { user_id: 'u3', is_active: 1 }] });
  assert.deepEqual((await store.audience()).sort(), ['u1', 'u3']);
});

test('p3-43: claiming a send is idempotent and shares the daily cap', async () => {
  const { store, d1 } = storeFor(baseSeed());
  const claim = { userId: 'u1', key: 'pending:2026-09-24:20', kind: 'pending-learning', category: 'learning', variant: 'A', dayKey: TODAY, at: NOW };
  assert.equal(await store.claimSend(claim), true);
  assert.equal(await store.claimSend(claim), false, 'a replay cannot claim again');
  assert.equal(await store.sendsToday('u1', TODAY), 1);
  assert.equal(d1._s.outcomes.length, 1);
});

test('p3-44: the daily cap counts what the Phase G engine already sent', async () => {
  const { store } = storeFor(baseSeed({ sends: [{ user_id: 'u1', kind: 'revision-due', day_key: TODAY, sent_at: NOW }] }));
  assert.equal(await store.sendsToday('u1', TODAY), 1, 'one shared allowance, not two');
});

test('p3-45: the per-category cap counts outcomes, and failures do not count', async () => {
  const { store } = storeFor(baseSeed({ outcomes: [
    { user_id: 'u1', notification_key: 'k1', category: 'learning', day_key: TODAY, status: 'sent' },
    { user_id: 'u1', notification_key: 'k2', category: 'learning', day_key: TODAY, status: 'failed' }
  ] }));
  assert.equal(await store.categorySendsToday('u1', TODAY, 'learning'), 1);
});

test('p3-46: outcomes record opened, clicked and the learning credit', async () => {
  const { store } = storeFor(baseSeed());
  await store.claimSend({ userId: 'u1', key: 'k1', kind: 'progress', category: 'learning', variant: 'A', dayKey: TODAY, at: NOW });
  assert.equal(await store.markOutcome({ userId: 'u1', key: 'k1', field: 'opened_at', at: NOW + 1000 }), true);
  assert.equal(await store.markOutcome({ userId: 'u1', key: 'k1', field: 'clicked_at', at: NOW + 2000 }), true);
  assert.equal(await store.markLearning({ userId: 'u1', key: 'k1', kind: 'lesson_start', at: NOW + 3000 }), true);
  const rows = await store.rowsForPerformance();
  assert.equal(rows[0].openedAt, NOW + 1000);
  assert.equal(rows[0].clickedAt, NOW + 2000);
  assert.equal(rows[0].learningAt, NOW + 3000);
  assert.equal(rows[0].learningKind, 'lesson_start');
});

test('p3-47: the first outcome sticks — a later open cannot rewrite the timestamp', async () => {
  const { store } = storeFor(baseSeed());
  await store.claimSend({ userId: 'u1', key: 'k1', kind: 'progress', category: 'learning', variant: 'A', dayKey: TODAY, at: NOW });
  await store.markOutcome({ userId: 'u1', key: 'k1', field: 'opened_at', at: NOW + 1000 });
  await store.markOutcome({ userId: 'u1', key: 'k1', field: 'opened_at', at: NOW + 9000 });
  const rows = await store.rowsForPerformance();
  assert.equal(rows[0].openedAt, NOW + 1000);
});

test('p3-48: only sends still inside the window are convertible', async () => {
  const { store } = storeFor(baseSeed({ outcomes: [
    { user_id: 'u1', notification_key: 'fresh', kind: 'progress', sent_at: NOW - 1000, opened_at: 0, clicked_at: 0, learning_at: 0 },
    { user_id: 'u1', notification_key: 'old', kind: 'progress', sent_at: NOW - 10 * 3600000, opened_at: 0, clicked_at: 0, learning_at: 0 },
    { user_id: 'u1', notification_key: 'done', kind: 'progress', sent_at: NOW - 2000, opened_at: 0, clicked_at: 0, learning_at: NOW }
  ] }));
  const rows = await store.convertibleSends('u1', NOW - 6 * 3600000);
  assert.deepEqual(rows.map(r => r.key), ['fresh']);
});

test('p3-49: fatigue is persisted and read back', async () => {
  const { store } = storeFor(baseSeed());
  await store.saveFatigue('u1', { sent: 10, opened: 1, clicked: 0, openRate: 0.1, level: 'high' }, NOW);
  const f = await store.fatigue('u1');
  assert.equal(f.fatigued, true);
  assert.equal(f.level, 'high');
  assert.equal(f.sent, 10);
});

/* ── cron runner + FCM integration (sections 3, 17) ──────────────────────── */

const run = (seed, opts = {}) => {
  const { store } = storeFor(seed);
  const delivered = [];
  return runScheduledIntelligenceNotifications({}, {
    store,
    now: () => NOW,
    requireFcm: false,
    signalsFor: async () => signalsFor(seed.signals || {}),
    send: async (userId, message) => { delivered.push({ userId, message }); return { ok: true, sent: 1 }; },
    ...opts
  }).then(result => ({ result, delivered }));
};

test('p3-50: one student, one notification, the right kind', async () => {
  const { result, delivered } = await run(baseSeed({ signals: { dailyStats: [{ day: '2026-09-23', questions: 20, correct: 10 }], mistakes: { pending: 9, topics: [{ topic: 'algebra', misses: 7 }] } } }));
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].message.kind, 'weak-topic');
  assert.equal(result.sent, 1);
  assert.ok(delivered[0].message.variant, 'every send carries its A/B variant');
});

test('p3-51: a second run on the same day delivers nothing', async () => {
  /* The SAME store across both runs: the duplicate and daily guards live in the
   * send log, so a fresh store would make this test pass for the wrong reason
   * (no rows to see) rather than because the guard held. */
  const { store, d1 } = storeFor(baseSeed({ signals: { mistakes: { pending: 9 } } }));
  const runOnce = async () => {
    const delivered = [];
    const result = await runScheduledIntelligenceNotifications({}, {
      store, now: () => NOW, requireFcm: false,
      signalsFor: async () => signalsFor({ mistakes: { pending: 9 } }),
      send: async (u, m) => { delivered.push(m); return { ok: true, sent: 1 }; }
    });
    return { result, delivered };
  };

  const first = await runOnce();
  assert.equal(first.delivered.length, 1, 'the first run delivers');
  const second = await runOnce();
  assert.equal(second.result.sent, 0, 'the same day is not nudged twice');
  assert.equal(second.delivered.length, 0);
  assert.equal(d1._s.outcomes.length, 1, 'still exactly one recorded send');
});

test('p3-52: a student who opted out is skipped without a send', async () => {
  const { store } = storeFor(baseSeed({
    state: [{ user_id: 'u1', tz_offset_min: 360, prefs_json: JSON.stringify({ personalized_enabled: 0 }), updated_at: NOW }],
    signals: { mistakes: { pending: 9 } }
  }));
  const delivered = [];
  const result = await runScheduledIntelligenceNotifications({}, {
    store, now: () => NOW, requireFcm: false,
    signalsFor: async () => signalsFor({ mistakes: { pending: 9 } }),
    send: async (u, m) => { delivered.push(m); return { ok: true, sent: 1 }; }
  });
  assert.equal(result.sent, 0);
  assert.equal(delivered.length, 0);
});

test('p3-53: one failing account does not stop the others', async () => {
  const { store } = storeFor({
    devices: [{ user_id: 'u1', is_active: 1 }, { user_id: 'u2', is_active: 1 }],
    signals: { mistakes: { pending: 9 } }
  });
  const sentTo = [];
  const result = await runScheduledIntelligenceNotifications({}, {
    store, now: () => NOW, requireFcm: false,
    signalsFor: async () => signalsFor({ mistakes: { pending: 9 } }),
    send: async userId => {
      if (userId === 'u1') throw new Error('device exploded');
      sentTo.push(userId);
      return { ok: true, sent: 1 };
    }
  });
  assert.equal(result.processed, 2);
  assert.deepEqual(sentTo, ['u2']);
});

test('p3-54: no active device means no work at all', async () => {
  const { result, delivered } = await run(baseSeed({ devices: [] }));
  assert.equal(result.processed, 0);
  assert.equal(delivered.length, 0);
});

test('p3-55: a failed delivery is recorded and does not count as sent', async () => {
  const { store, d1 } = storeFor(baseSeed({ signals: { mistakes: { pending: 9 } } }));
  const result = await runScheduledIntelligenceNotifications({}, {
    store, now: () => NOW, requireFcm: false,
    signalsFor: async () => signalsFor({ mistakes: { pending: 9 } }),
    send: async () => ({ ok: false, sent: 0, reason: 'no-devices' })
  });
  assert.equal(result.sent, 0);
  assert.equal(d1._s.outcomes.length, 1, 'the attempt is still recorded for measurement');
});

test('p3-56: FCM is not configured, so the run does nothing', async () => {
  const { store } = storeFor(baseSeed({ signals: { mistakes: { pending: 9 } } }));
  const result = await runScheduledIntelligenceNotifications({}, { store, now: () => NOW, requireFcm: true });
  assert.equal(result.reason, 'fcm-not-configured');
  assert.equal(result.sent, 0);
});

/* ── routes ──────────────────────────────────────────────────────────────── */

const ADMIN = 'admin-secret-token';
const adminCall = (path, env, method = 'GET') => handleIntelligenceRequest(
  new Request(`https://x.test${path}`, { method, headers: { Authorization: `Bearer ${ADMIN}` } }),
  env, { now: () => NOW }
);

test('p3-57: admin routes reject a bad token', async () => {
  const env = { PROFILE_DB: makeFakeD1(baseSeed()), ADMIN_TOKEN: ADMIN };
  const res = await handleIntelligenceRequest(new Request('https://x.test/api/notifications/intel/preview?user=u1'), env, { now: () => NOW });
  assert.equal(res.status, 403);
});

test('p3-58: the preview explains the decision without sending anything', async () => {
  const env = { PROFILE_DB: makeFakeD1(baseSeed()), ADMIN_TOKEN: ADMIN };
  const res = await adminCall('/api/notifications/intel/preview?user=u1', env);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.decision.decision, 'skip');
  assert.equal(body.decision.stage, 'relevant', 'a brand-new student has no reason to be nudged');
  assert.equal(env.PROFILE_DB._s.outcomes.length, 0, 'preview never writes a send');
});

test('p3-59: an unknown path falls through to the next handler', async () => {
  const env = { PROFILE_DB: makeFakeD1(baseSeed()), ADMIN_TOKEN: ADMIN };
  const res = await handleIntelligenceRequest(new Request('https://x.test/api/notifications/other'), env, { now: () => NOW });
  assert.equal(res, null);
});

test('p3-66: a preflight for another route is not swallowed by this handler', async () => {
  /* This handler runs ahead of every other /api/* handler. If it answered
   * OPTIONS unconditionally, it would answer CORS preflight for the whole app
   * and every cross-origin request would fail. */
  const env = { PROFILE_DB: makeFakeD1(baseSeed()), ADMIN_TOKEN: ADMIN };
  for (const path of ['/api/userdata/pull', '/api/files/list', '/api/notifications/global/send']) {
    const res = await handleIntelligenceRequest(new Request(`https://x.test${path}`, { method: 'OPTIONS' }), env, { now: () => NOW });
    assert.equal(res, null, path);
  }
  const mine = await handleIntelligenceRequest(new Request('https://x.test/api/notifications/intel-pref', { method: 'OPTIONS' }), env, { now: () => NOW });
  assert.equal(mine.status, 204, 'our own preflight is answered');
});

test('p3-60: performance is computed from the stored outcomes', async () => {
  const env = {
    PROFILE_DB: makeFakeD1(baseSeed({ outcomes: [
      { user_id: 'u1', notification_key: 'k1', kind: 'progress', category: 'learning', variant: 'A', day_key: TODAY, sent_at: NOW, opened_at: NOW, clicked_at: NOW, learning_at: NOW, learning_kind: 'lesson_start', status: 'sent' },
      { user_id: 'u1', notification_key: 'k2', kind: 'progress', category: 'learning', variant: 'A', day_key: TODAY, sent_at: NOW, opened_at: 0, clicked_at: 0, learning_at: 0, status: 'sent' }
    ] })),
    ADMIN_TOKEN: ADMIN
  };
  const res = await adminCall('/api/notifications/intel/performance', env);
  const body = await res.json();
  assert.equal(body.totals.sent, 2);
  assert.equal(body.totals.converted, 1);
  assert.equal(body.totals.conversion, 50);
});

test('p3-61: the student routes require a session', async () => {
  const env = { PROFILE_DB: makeFakeD1(baseSeed()) };
  for (const [path, method] of [['/api/notifications/intel-pref', 'GET'], ['/api/notifications/intel-pref', 'POST'], ['/api/notifications/outcome', 'POST']]) {
    const res = await handleIntelligenceRequest(new Request(`https://x.test${path}`, { method }), env, { now: () => NOW });
    assert.equal(res.status, 401, path);
  }
});

test('p3-62: a learning report credits the most recent convertible send', async () => {
  const env = {
    PROFILE_DB: makeFakeD1(baseSeed({ outcomes: [
      { user_id: 'u1', notification_key: 'older', kind: 'progress', category: 'learning', variant: 'A', day_key: TODAY, sent_at: NOW - 3600000, opened_at: NOW - 3500000, clicked_at: 0, learning_at: 0, status: 'sent' },
      { user_id: 'u1', notification_key: 'newer', kind: 'weak-topic', category: 'learning', variant: 'B', day_key: TODAY, sent_at: NOW - 600000, opened_at: NOW - 500000, clicked_at: 0, learning_at: 0, status: 'sent' }
    ] })),
    __session: { user: { id: 'u1' } }
  };
  /* sessionUser is imported from fcm-notification.mjs and reads the session
   * cookie; stub it for this route-level test via the injected deps. */
  const res = await handleIntelligenceRequest(
    new Request('https://x.test/api/notifications/outcome', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'learning', kind: 'lesson_start' })
    }),
    env, { now: () => NOW, sessionUser: async () => ({ user: { id: 'u1' } }) }
  );
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.credited, 'newer', 'the most recent send wins');
  assert.equal(env.PROFILE_DB._s.outcomes.find(o => o.notification_key === 'newer').learning_kind, 'lesson_start');
});

test('p3-63: an unknown learning kind is rejected, not credited blindly', async () => {
  const env = { PROFILE_DB: makeFakeD1(baseSeed()), __session: { user: { id: 'u1' } } };
  const res = await handleIntelligenceRequest(
    new Request('https://x.test/api/notifications/outcome', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'learning', kind: 'screen_view' })
    }),
    env, { now: () => NOW, sessionUser: async () => ({ user: { id: 'u1' } }) }
  );
  assert.equal(res.status, 400);
});

test('p3-64: timezone and per-category preferences round-trip through the route', async () => {
  const env = { PROFILE_DB: makeFakeD1(baseSeed()) };
  const session = async () => ({ user: { id: 'u1' } });

  const saved = await handleIntelligenceRequest(
    new Request('https://x.test/api/notifications/intel-pref', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tz_offset_min: -300, categories: { streak: 0 } })
    }),
    env, { now: () => NOW, sessionUser: session }
  );
  assert.equal((await saved.json()).tz_offset_min, -300);

  const read = await handleIntelligenceRequest(new Request('https://x.test/api/notifications/intel-pref'), env, { now: () => NOW, sessionUser: session });
  const body = await read.json();
  assert.equal(body.tz_offset_min, -300);
  assert.equal(body.prefs.categories.streak, 0);
  assert.equal(body.prefs.categories.achievement, 1);
});

test('p3-65: an absurd timezone offset is clamped, never trusted', async () => {
  const { store } = storeFor(baseSeed());
  const saved = await store.saveState('u1', { tzOffsetMin: 99999, prefs: {} }, NOW);
  assert.equal(saved.tz_offset_min, 840, 'UTC+14 is the real maximum');
  const low = await store.saveState('u1', { tzOffsetMin: -99999, prefs: {} }, NOW);
  assert.equal(low.tz_offset_min, -720);
});

/* ── section 17: the decision log (why did we send / not send?) ───────────── */

test('p3-66: a run records a decision row for every evaluated student', async () => {
  const d1 = makeFakeD1(baseSeed({ devices: [{ user_id: 'u1', is_active: 1 }, { user_id: 'u2', is_active: 1 }] }));
  const store = new IntelligenceStore(d1);
  await runScheduledIntelligenceNotifications(
    { PROFILE_DB: d1, __skipFcmCheck: true },
    { store, now: () => NOW, signalsFor: async () => computeSignals({}, NOW), send: async () => ({ ok: true, sent: 1 }) }
  );
  assert.equal(d1._s.decisions.length, 2, 'one decision row per student, send or skip');
  for (const row of d1._s.decisions) {
    assert.ok(['send', 'skip'].includes(row.decision));
    assert.equal(row.day_key, TODAY);
    assert.ok(row.reason, 'every decision carries a reason');
  }
});

test('p3-67: a sent decision records the rule and its priority as the score', async () => {
  const d1 = makeFakeD1(baseSeed());
  const store = new IntelligenceStore(d1);
  const signals = computeSignals({ dailyStats: [{ day: '2026-09-23', questions: 20, correct: 18 }], mistakes: { pending: 20 } }, NOW);
  await runScheduledIntelligenceNotifications(
    { PROFILE_DB: d1, __skipFcmCheck: true },
    { store, now: () => NOW, signalsFor: async () => signals, send: async () => ({ ok: true, sent: 1 }) }
  );
  const row = d1._s.decisions.find(r => r.decision === 'send');
  assert.ok(row, 'the send was logged');
  assert.equal(row.rule, 'pending-learning');
  assert.equal(row.score, KIND_META['pending-learning'].priority);
  assert.match(String(row.reason), /pending/);
});

test('p3-68: a skip is logged with its stage, so silence is explainable', async () => {
  const d1 = makeFakeD1(baseSeed({ state: [{ user_id: 'u1', tz_offset_min: 360, prefs_json: JSON.stringify({ personalized_enabled: 0 }), updated_at: NOW }] }));
  const store = new IntelligenceStore(d1);
  await runScheduledIntelligenceNotifications(
    { PROFILE_DB: d1, __skipFcmCheck: true },
    { store, now: () => NOW, signalsFor: async () => computeSignals({ mistakes: { pending: 20 } }, NOW), send: async () => ({ ok: true, sent: 1 }) }
  );
  const row = d1._s.decisions.find(r => r.decision === 'skip');
  assert.ok(row, 'the skip was logged');
  assert.equal(row.stage, 'enabled');
  assert.equal(row.reason, 'personalized-off');
  assert.equal(row.rule, 'none');
});

test('p3-69: the same student-day-rule is logged once, not once per cron tick', async () => {
  const d1 = makeFakeD1(baseSeed());
  const store = new IntelligenceStore(d1);
  const signals = computeSignals({ mistakes: { pending: 20 } }, NOW);
  const run = () => runScheduledIntelligenceNotifications(
    { PROFILE_DB: d1, __skipFcmCheck: true },
    { store, now: () => NOW, signalsFor: async () => signals, send: async () => ({ ok: true, sent: 1 }) }
  );
  await run();
  await run();
  const keyed = d1._s.decisions.filter(r => r.rule === 'pending-learning');
  assert.equal(keyed.length, 1, 'the upsert key collapses a repeated tick');
});

test('p3-70: the decision log never breaks a run when its write fails', async () => {
  const d1 = makeFakeD1(baseSeed());
  const store = new IntelligenceStore(d1);
  store.logDecision = async () => { throw new Error('disk full'); };
  const res = await runScheduledIntelligenceNotifications(
    { PROFILE_DB: d1, __skipFcmCheck: true },
    { store, now: () => NOW, signalsFor: async () => computeSignals({ mistakes: { pending: 20 } }, NOW), send: async () => ({ ok: true, sent: 1 }) }
  );
  assert.equal(res.sent, 1, 'the send still happened');
});

/* ── section 20: the admin dashboard (computeDecisionStats) ───────────────── */

test('p3-71: the dashboard counts eligible, sent and skipped for the day', () => {
  const decisions = [
    { rule: 'streak-risk', decision: 'send', stage: 'send', reason: 'streak 6' },
    { rule: 'none', decision: 'skip', stage: 'quiet-hours', reason: '23:00-07:00' },
    { rule: 'none', decision: 'skip', stage: 'quiet-hours', reason: '23:00-07:00' },
    { rule: 'none', decision: 'skip', stage: 'relevant', reason: 'no-candidate' }
  ];
  const stats = computeDecisionStats(decisions, []);
  assert.equal(stats.eligible, 4);
  assert.equal(stats.sent, 1);
  assert.equal(stats.skipped, 3);
  assert.equal(stats.topSkipStage.key, 'quiet-hours');
  assert.equal(stats.topSkipStage.count, 2);
});

test('p3-72: the top rule is the rule we sent most, not the one we considered most', () => {
  const decisions = [
    { rule: 'streak-risk', decision: 'send', stage: 'send', reason: 'x' },
    { rule: 'streak-risk', decision: 'send', stage: 'send', reason: 'x' },
    { rule: 'none', decision: 'skip', stage: 'duplicate', reason: 'k' }
  ];
  const stats = computeDecisionStats(decisions, []);
  assert.equal(stats.topRule.key, 'streak-risk');
  assert.equal(stats.topRule.count, 2);
});

test('p3-73: CTR is clicks over sent, never over eligible', () => {
  const decisions = Array.from({ length: 100 }, (_, i) => ({ rule: i < 10 ? 'progress' : 'none', decision: i < 10 ? 'send' : 'skip', stage: i < 10 ? 'send' : 'relevant', reason: 'r' }));
  const outcomes = Array.from({ length: 10 }, (_, i) => ({ kind: 'progress', status: 'sent', openedAt: i < 4 ? NOW : 0, clickedAt: i < 2 ? NOW : 0 }));
  const stats = computeDecisionStats(decisions, outcomes);
  assert.equal(stats.totals.sent, 10);
  assert.equal(stats.totals.clickRate, 20, '2 clicks of 10 sent = 20%, not 2% of 100 eligible');
  assert.equal(stats.totals.openRate, 40);
});

test('p3-74: best-performing is the highest click rate, ties broken by open rate', () => {
  const outcomes = [
    { kind: 'achievement', status: 'sent', openedAt: NOW, clickedAt: NOW },
    { kind: 'achievement', status: 'sent', openedAt: NOW, clickedAt: NOW },
    { kind: 'weak-topic', status: 'sent', openedAt: NOW, clickedAt: 0 },
    { kind: 'weak-topic', status: 'sent', openedAt: NOW, clickedAt: 0 },
    { kind: 'weak-topic', status: 'sent', openedAt: NOW, clickedAt: 0 }
  ];
  const stats = computeDecisionStats([], outcomes);
  assert.equal(stats.bestPerforming.kind, 'achievement');
  assert.equal(stats.bestPerforming.clickRate, 100);
  assert.equal(stats.byRulePerformance[1].kind, 'weak-topic');
});

test('p3-75: a failed send is excluded from the dashboard denominator', () => {
  const outcomes = [
    { kind: 'progress', status: 'sent', openedAt: NOW, clickedAt: NOW },
    { kind: 'progress', status: 'failed', openedAt: 0, clickedAt: 0 }
  ];
  const stats = computeDecisionStats([], outcomes);
  assert.equal(stats.totals.sent, 1);
  assert.equal(stats.totals.clickRate, 100, 'the failed send does not drag CTR down');
});

test('p3-76: an empty day reports zeros, not NaN', () => {
  const stats = computeDecisionStats([], []);
  assert.equal(stats.eligible, 0);
  assert.equal(stats.totals.clickRate, 0);
  assert.equal(stats.bestPerforming, null);
  assert.equal(stats.topReason, null);
});

test('p3-77: the dashboard route returns the day stats for an admin', async () => {
  const env = {
    PROFILE_DB: makeFakeD1(baseSeed({
      decisions: [
        { id: 'a', user_id: 'u1', rule: 'streak-risk', kind: 'streak-risk', score: 90, decision: 'send', stage: 'send', reason: 'streak 6', day_key: TODAY, created_at: NOW },
        { id: 'b', user_id: 'u2', rule: 'none', kind: null, score: 0, decision: 'skip', stage: 'quiet-hours', reason: '23:00-07:00', day_key: TODAY, created_at: NOW }
      ],
      outcomes: [
        { user_id: 'u1', notification_key: 'streak-risk:2026-09-24:6', kind: 'streak-risk', category: 'streak', variant: 'A', day_key: TODAY, sent_at: NOW, opened_at: NOW, clicked_at: NOW, learning_at: 0, status: 'sent' }
      ]
    })),
    ADMIN_TOKEN: 'sekret'
  };
  const res = await handleIntelligenceRequest(
    new Request(`https://x.test/api/notifications/intel/dashboard?day=${TODAY}`, { headers: { Authorization: 'Bearer sekret' } }),
    env, { now: () => NOW }
  );
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.day, TODAY);
  assert.equal(body.eligible, 2);
  assert.equal(body.sent, 1);
  assert.equal(body.skipped, 1);
  assert.equal(body.bestPerforming.kind, 'streak-risk');
  assert.equal(body.totals.clickRate, 100);
});

test('p3-78: the dashboard is admin-only', async () => {
  const env = { PROFILE_DB: makeFakeD1(baseSeed()), ADMIN_TOKEN: 'sekret' };
  const res = await handleIntelligenceRequest(
    new Request(`https://x.test/api/notifications/intel/dashboard?day=${TODAY}`),
    env, { now: () => NOW }
  );
  assert.equal(res.status, 403);
});

