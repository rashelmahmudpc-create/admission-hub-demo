/* Phase 5 — AI Analytics Intelligence Core tests.
 *
 * The brief's Phase 5 standard: the AI layer must analyse behaviour, predict
 * outcomes, score risk across the eight named signals, recommend a next best
 * action, predict a best time, detect anomalies, forecast a trend, read content
 * and course health, and measure its own performance — while never inventing a
 * figure, never acting without approval, and never optimising for clicks over
 * learning.
 *
 * Each guarantee is a test here. The whole module is pure arithmetic over plain
 * rows, so nothing below needs I/O, a clock, or a model.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_INTELLIGENCE_VERSION,
  CONFIDENCE_TARGETS, CONFIDENCE_BANDS, confidenceFromSample, confidenceBand,
  RISK_KINDS, RISK_LEVELS, ACTION_KINDS, DAY_PARTS, PROFILE_DIMENSIONS,
  dayPartOf, localHour, DAY_PART_LABEL_BN,
  buildStudentProfile, predictBehaviour, predictRisk, rankNextBestActions,
  predictBestTime, trendSlope, detectMetricAnomaly, detectAnomalies, ANOMALY_METRICS,
  forecastTrend, buildContentIntelligence, buildCourseIntelligence,
  evaluateAiPerformance, buildAdminAiSignals
} from './ai-analytics-intelligence.mjs';

/* 2026-09-24, Dhaka (UTC+6) — the same instant the Phase 3 and Phase 4 suites
 * use, so a timezone mistake shows up as a disagreement between suites. */
const NOW = Date.UTC(2026, 8, 24, 4, 0, 0);

/* A declining student: strong early, drifting off. Used as the fixture that
 * should fire most risk signals, so a silent regression in the risk math is
 * visible rather than "still returns an object". */
function decliningSeries(days = 30) {
  return Array.from({ length: days }, (_, i) => ({
    questions: i < 10 ? 30 : i < 20 ? 18 : 6,
    lessons: i < 10 ? 2 : i < 20 ? 1 : 0,
    correct: i < 10 ? 25 : 12,
    wrong: i < 10 ? 5 : 8
  }));
}

const decliningMetrics = (series) => ({
  activeDays: 12,
  daysSinceActive: 4,
  hadGap: true,
  practiceActivity: 430,
  lessonsCompleted: 26,
  questionsCorrect: 300,
  questionsWrong: 130,
  accuracy: 69.8,
  streak: 0,
  longestStreak: 9,
  courseProgress: { courses: 3, started: 3, completed: 1, lessonsTotal: 40, lessonsDone: 26, percent: 65 },
  mistakes: { topics: [{ topic: 'সমাস', misses: 9 }, { topic: 'সন্ধি', misses: 5 }] },
  series
});

const decliningInput = () => {
  const series = decliningSeries();
  return {
    metrics: decliningMetrics(series),
    series,
    activityHours: Array.from({ length: 24 }, (_, h) => (h >= 20 && h <= 22 ? 5 : 1)),
    notificationOutcomes: { sent: 12, openRate: 0.5, clickRate: 0.3, learningConversion: 0.2 },
    segment: { segment: 'at_risk' },
    stage: { stage: 'developing' }
  };
};

/* ── ১. version + shape ───────────────────────────────────────────────────── */

test('P5-১. the intelligence version is stamped on every payload', () => {
  assert.equal(AI_INTELLIGENCE_VERSION, 'ai-p5-v1');
  const input = decliningInput();
  const profile = buildStudentProfile(input, { windowDays: 30 });
  assert.equal(profile.version, AI_INTELLIGENCE_VERSION);
  assert.equal(predictBehaviour(profile, { series: input.series }).version, AI_INTELLIGENCE_VERSION);
  assert.equal(predictRisk({ profile, series: input.series, metrics: input.metrics }).version, AI_INTELLIGENCE_VERSION);
  assert.equal(rankNextBestActions({ profile, metrics: input.metrics }).version, AI_INTELLIGENCE_VERSION);
  assert.equal(predictBestTime({ hours: input.activityHours }).version, AI_INTELLIGENCE_VERSION);
  assert.equal(forecastTrend([1, 2, 3, 4, 5, 6]).version, AI_INTELLIGENCE_VERSION);
});

test('P5-২. the eight risk kinds and seven action kinds are the specified ones', () => {
  assert.deepEqual([...RISK_KINDS], [
    'engagement_drop', 'course_abandonment', 'lesson_completion_decline', 'practice_decline',
    'quiz_performance_decline', 'streak_break', 'long_inactivity', 'consistency_decline'
  ]);
  assert.deepEqual([...ACTION_KINDS], [
    'return_after_inactivity', 'continue_lesson', 'review_previous_lesson',
    'revise_weak_topic', 'practice', 'take_quiz', 'complete_milestone'
  ]);
  assert.deepEqual([...RISK_LEVELS], ['low', 'medium', 'high']);
  assert.deepEqual([...DAY_PARTS], ['night', 'morning', 'afternoon', 'evening']);
  assert.equal(PROFILE_DIMENSIONS.length, 10);
});

/* ── ৩. confidence ────────────────────────────────────────────────────────── */

test('P5-৩. confidence is a function of sample size, never of how interesting the result looks', () => {
  assert.equal(confidenceFromSample(0, 10), 0);
  assert.equal(confidenceFromSample(5, 10), 0.5);
  assert.equal(confidenceFromSample(10, 10), 1);
  /* Above target it clamps instead of exceeding 1. */
  assert.equal(confidenceFromSample(100, 10), 1);
  assert.deepEqual([...CONFIDENCE_BANDS], ['insufficient', 'low', 'moderate', 'high']);
  assert.equal(confidenceBand(0.3), 'insufficient');
  assert.equal(confidenceBand(0.5), 'low');
  assert.equal(confidenceBand(0.7), 'moderate');
  assert.equal(confidenceBand(0.9), 'high');
});

test('P5-৪. every confidence target is positive, so no claim can divide by zero', () => {
  for (const [key, value] of Object.entries(CONFIDENCE_TARGETS)) {
    assert.ok(value > 0, `${key} target must be positive`);
  }
});

/* ── ৫. day parts and local hour ──────────────────────────────────────────── */

test('P5-৫. day parts split the day the way the UI labels them', () => {
  assert.equal(dayPartOf(0), 'night');
  assert.equal(dayPartOf(4), 'night');
  assert.equal(dayPartOf(5), 'morning');
  assert.equal(dayPartOf(11), 'morning');
  assert.equal(dayPartOf(12), 'afternoon');
  assert.equal(dayPartOf(16), 'afternoon');
  assert.equal(dayPartOf(17), 'evening');
  assert.equal(dayPartOf(23), 'evening');
  /* Wraps rather than producing a negative part. */
  assert.equal(dayPartOf(25), 'night');
  assert.equal(dayPartOf(-1), 'evening');
  for (const part of DAY_PARTS) assert.ok(DAY_PART_LABEL_BN[part], `${part} needs a Bengali label`);
});

test('P5-৬. the local hour uses the student timezone, not the server one', () => {
  /* 2026-09-24T04:00Z is 10:00 in Dhaka (UTC+6). */
  assert.equal(localHour(Date.UTC(2026, 8, 24, 4, 0, 0), 360), 10);
  assert.equal(localHour(Date.UTC(2026, 8, 24, 4, 0, 0), 0), 4);
  /* A late-evening Dhaka session must not read as an afternoon UTC session. */
  assert.equal(localHour(Date.UTC(2026, 8, 24, 15, 0, 0), 360), 21);
  assert.equal(localHour(Date.UTC(2026, 8, 24, 15, 0, 0), 0), 15);
});

/* ── ৭. dynamic student profile ───────────────────────────────────────────── */

test('P5-৭. the profile is dynamic and carries all ten dimensions with confidence', () => {
  const profile = buildStudentProfile(decliningInput(), { windowDays: 30 });
  for (const dim of PROFILE_DIMENSIONS) {
    assert.ok(profile.dimensions[dim], `missing dimension ${dim}`);
    assert.ok(['insufficient', 'low', 'moderate', 'high'].includes(profile.dimensions[dim].band));
  }
  assert.equal(profile.learning.value, 'high');
  assert.equal(profile.engagement.value, 'high');
  /* 12 active days out of 30 with a gap is a low consistency score, and the
   * dimension says so even though engagement looks fine. */
  assert.equal(profile.consistency.value, 'low');
  assert.ok(profile.consistency.score < 0.4);
});

test('P5-৮. the profile names its weakest dimension instead of hiding it', () => {
  const profile = buildStudentProfile(decliningInput(), { windowDays: 30 });
  assert.ok(profile.weakestDimension);
  assert.ok(PROFILE_DIMENSIONS.includes(profile.weakestDimension.key));
  assert.equal(profile.weakestDimension.confidence, 0);
  assert.equal(profile.weakestDimension.band, 'insufficient');
});

test('P5-৯. a thin profile reports insufficient rather than a confident zero', () => {
  const profile = buildStudentProfile({ metrics: { activeDays: 1, practiceActivity: 2 }, series: [{ questions: 2 }] }, { windowDays: 30 });
  assert.equal(profile.learning.band, 'insufficient');
  assert.equal(profile.engagement.band, 'insufficient');
  assert.equal(profile.readiness.confidence, 0.1);
  /* The preferred-time block is empty rather than guessing hour 0. */
  assert.equal(profile.preferredTime.hour, null);
  assert.equal(profile.preferredTime.dayPart, null);
});

test('P5-১০. the profile reads weak topics from the Phase 4 mistake rows', () => {
  const profile = buildStudentProfile(decliningInput(), { windowDays: 30 });
  assert.equal(profile.weakAreas[0].topic, 'সমাস');
  assert.equal(profile.weakAreas[0].misses, 9);
  assert.ok(profile.weakAreas.length <= 5);
});

/* ── ১১. behaviour prediction ─────────────────────────────────────────────── */

test('P5-১১. prediction reads a declining series as declining, not steady', () => {
  const input = decliningInput();
  const profile = buildStudentProfile(input, { windowDays: 30 });
  const prediction = predictBehaviour(profile, { series: input.series }, { horizonDays: 7, windowDays: 14 });
  assert.equal(prediction.predictions.engagement.direction, 'declining');
  assert.equal(prediction.predictions.completion.direction, 'declining');
  assert.equal(prediction.horizonDays, 7);
  assert.ok(prediction.confidence > 0.5);
});

test('P5-১২. prediction is labelled as an estimate, and the disclaimer travels with it', () => {
  const input = decliningInput();
  const profile = buildStudentProfile(input, { windowDays: 30 });
  const prediction = predictBehaviour(profile, { series: input.series }, {});
  assert.match(prediction.disclaimerBn, /অনুমান/);
  assert.ok(prediction.notes.length > 0);
  /* Every note carries its own confidence so the UI can sort by trust. */
  for (const note of prediction.notes) assert.ok(typeof note.confidence === 'number');
});

test('P5-১৩. inactivity probability never reaches certainty', () => {
  const input = decliningInput();
  input.metrics.daysSinceActive = 60;
  const profile = buildStudentProfile(input, { windowDays: 30 });
  const prediction = predictBehaviour(profile, { series: input.series }, {});
  assert.ok(prediction.predictions.inactivity.probability <= 0.95);
  assert.ok(prediction.predictions.inactivity.probability > 0.5);
});

test('P5-১৪. trendSlope needs three points and returns zero slope below that', () => {
  assert.equal(trendSlope([1, 2]).slope, 0);
  assert.equal(trendSlope([1, 2]).confidence, 0);
  const rising = trendSlope([1, 2, 3, 4, 5, 6, 7]);
  assert.ok(rising.slope > 0);
  assert.equal(rising.samples, 7);
});

/* ── ১৫. risk prediction ──────────────────────────────────────────────────── */

test('P5-১৫. every one of the eight risk signals is evaluated', () => {
  const input = decliningInput();
  const profile = buildStudentProfile(input, { windowDays: 30 });
  const risk = predictRisk({ profile, series: input.series, metrics: input.metrics }, { windowDays: 14 });
  assert.equal(risk.risks.length, 8);
  assert.deepEqual(risk.risks.map((r) => r.kind), [...RISK_KINDS]);
  for (const item of risk.risks) {
    assert.ok(item.score >= 0 && item.score <= 1);
    assert.ok(item.labelBn && item.labelEn);
    assert.ok(item.reasonBn && item.reasonEn);
  }
});

test('P5-১৬. a declining student surfaces the expected top risk signals', () => {
  const input = decliningInput();
  const profile = buildStudentProfile(input, { windowDays: 30 });
  const risk = predictRisk({ profile, series: input.series, metrics: input.metrics }, { windowDays: 14 });
  assert.ok(risk.overall.topKinds.length > 0);
  /* The step-down at day 20 is the dominant story, so the lesson and practice
   * declines must both register as real risk rather than rounding to zero. */
  assert.ok(risk.overall.topKinds.includes('lesson_completion_decline'));
  const practice = risk.risks.find((r) => r.kind === 'practice_decline');
  assert.ok(practice.score >= 0.5, `practice_decline scored ${practice.score}`);
  assert.ok(risk.overall.score > 0.3);
});

test('P5-১৭. a below-floor signal is "insufficient", never silently "low"', () => {
  const risk = predictRisk({ profile: {}, series: [], metrics: { activeDays: 0 } }, {});
  assert.equal(risk.overall.level, 'unknown');
  /* All eight are below their sample floor, so all eight are reported unknown. */
  assert.equal(risk.insufficient.length, 8);
  assert.equal(risk.overall.confidence, 0);
  assert.equal(risk.overall.band, 'insufficient');
});

test('P5-১৮. risk level thresholds are low/medium/high at the documented cuts', () => {
  const input = decliningInput();
  const profile = buildStudentProfile(input, { windowDays: 30 });
  const risk = predictRisk({ profile, series: input.series, metrics: input.metrics }, { windowDays: 14 });
  for (const item of risk.risks) {
    const expected = item.score >= 0.66 ? 'high' : item.score >= 0.33 ? 'medium' : 'low';
    assert.equal(item.level, expected);
  }
  assert.ok(['low', 'medium', 'high', 'unknown'].includes(risk.overall.level));
});

/* ── ১৯. next best action ─────────────────────────────────────────────────── */

test('P5-১৯. the next best action engine returns a ranked list, not a single guess', () => {
  const input = decliningInput();
  const profile = buildStudentProfile(input, { windowDays: 30 });
  const risk = predictRisk({ profile, series: input.series, metrics: input.metrics }, { windowDays: 14 });
  const actions = rankNextBestActions({
    profile, metrics: input.metrics, risk,
    milestones: { next: { target: 50, remaining: 8 } },
    goal: { target: 700, progress: 0.6 }
  });
  assert.ok(actions.actions.length >= 3);
  assert.ok(actions.best);
  assert.equal(actions.best.kind, actions.actions[0].kind);
  /* Ranking is strictly descending, so the UI can render it as-is. */
  for (let i = 1; i < actions.actions.length; i++) {
    assert.ok(actions.actions[i - 1].score >= actions.actions[i].score);
  }
  for (const action of actions.actions) {
    assert.ok(ACTION_KINDS.includes(action.kind));
    assert.ok(action.labelBn && action.labelEn);
    assert.ok(action.reasonBn && action.reasonEn);
  }
});

test('P5-২০. an inactive student is sent back with a small restart, ranked first', () => {
  const input = decliningInput();
  const profile = buildStudentProfile(input, { windowDays: 30 });
  const actions = rankNextBestActions({ profile, metrics: input.metrics });
  assert.equal(actions.best.kind, 'return_after_inactivity');
  assert.ok(actions.best.score > 0.7);
});

test('P5-২১. a student with no data gets an explicit empty list, not a padded one', () => {
  const profile = buildStudentProfile({ metrics: { activeDays: 0 }, series: [] }, { windowDays: 30 });
  const actions = rankNextBestActions({ profile, metrics: { activeDays: 0, practiceActivity: 0 } });
  assert.equal(actions.actions.length, 0);
  assert.equal(actions.best, null);
  assert.equal(actions.reason, 'insufficient-data');
  assert.equal(actions.band, 'insufficient');
});

test('P5-২২. ranking is deterministic — identical input yields identical order', () => {
  const input = decliningInput();
  const profile = buildStudentProfile(input, { windowDays: 30 });
  const risk = predictRisk({ profile, series: input.series, metrics: input.metrics }, { windowDays: 14 });
  const args = { profile, metrics: input.metrics, risk, milestones: { next: { target: 50, remaining: 8 } }, goal: { target: 700, progress: 0.6 } };
  const a = rankNextBestActions(args);
  const b = rankNextBestActions(args);
  assert.deepEqual(a.actions.map((x) => x.kind), b.actions.map((x) => x.kind));
});

/* ── ২৩. best time ────────────────────────────────────────────────────────── */

test('P5-২৩. best time reads the activity histogram and names a two-hour window', () => {
  const hours = Array.from({ length: 24 }, (_, h) => (h >= 20 && h <= 22 ? 5 : 1));
  const best = predictBestTime({ hours });
  assert.equal(best.reason, 'ok');
  assert.equal(best.dayPart, 'evening');
  assert.deepEqual(best.window, [20, 21]);
  assert.equal(best.confidence, 1);
  assert.ok(best.reasonBn && best.reasonEn);
});

test('P5-২৪. best time refuses to guess below its sample floor', () => {
  const best = predictBestTime({ hours: Array.from({ length: 24 }, (_, h) => (h === 3 ? 2 : 0)) });
  assert.equal(best.reason, 'insufficient-data');
  assert.equal(best.hour, null);
  assert.equal(best.band, 'insufficient');
  assert.match(best.reasonBn, /যথেষ্ট/);
});

test('P5-২৫. day-part totals always sum to the histogram total', () => {
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const best = predictBestTime({ hours });
  const total = Object.values(best.dayParts).reduce((a, b) => a + b, 0);
  assert.equal(total, hours.reduce((a, b) => a + b, 0));
});

/* ── ২৬. anomaly detection ───────────────────────────────────────────────── */

test('P5-২৬. a sharp drop against a real baseline is an anomaly', () => {
  const result = detectMetricAnomaly(30, 75, { recentSample: 30, baselineSample: 30, higherIsBetter: true });
  assert.equal(result.status, 'anomaly');
  assert.equal(result.direction, 'down');
  assert.ok(result.changeRatio < -0.3);
  assert.equal(result.band, 'high');
});

test('P5-২৭. a rise in a "lower is better" metric is also an anomaly', () => {
  const result = detectMetricAnomaly(0.7, 0.2, { recentSample: 30, baselineSample: 30, higherIsBetter: false });
  assert.equal(result.status, 'anomaly');
  assert.equal(result.direction, 'up');
});

test('P5-২৮. a drop measured against too small a baseline is not an anomaly', () => {
  const result = detectMetricAnomaly(10, 40, { recentSample: 3, baselineSample: 3 });
  assert.equal(result.status, 'insufficient');
  assert.equal(result.confidence, 0.21);
  assert.equal(result.changeRatio, 0);
});

test('P5-২৯. detectAnomalies covers the four named platform metrics', () => {
  const result = detectAnomalies({
    recent: { quizCompletionRate: 30, lessonErrorRate: 0.7, engagementDau: 40, notificationOpenRate: 0.4 },
    baseline: { quizCompletionRate: 75, lessonErrorRate: 0.2, engagementDau: 60, notificationOpenRate: 0.45 },
    recentSample: 30,
    baselineSample: 30
  });
  assert.deepEqual(result.all.map((a) => a.key), ANOMALY_METRICS.map((m) => m.key));
  assert.ok(result.anomalies.length >= 3);
  assert.ok(result.anomalies.every((a) => a.reasonBn && a.reasonEn));
});

test('P5-৩০. a stable metric is neither an anomaly nor a shift', () => {
  const result = detectMetricAnomaly(50, 51, { recentSample: 30, baselineSample: 30 });
  assert.equal(result.status, 'stable');
});

/* ── ৩১. trend forecasting ────────────────────────────────────────────────── */

test('P5-৩১. forecastTrend projects the observed slope and reports its fit', () => {
  const forecast = forecastTrend([30, 30, 30, 30, 30, 30, 30, 30, 30, 30], { horizonDays: 7 });
  assert.equal(forecast.direction, 'steady');
  assert.equal(forecast.projected, 30);
  assert.equal(forecast.samples, 10);
});

test('P5-৩২. a declining series forecasts downward and never projects below zero', () => {
  const forecast = forecastTrend(decliningSeries().map((d) => d.questions), { horizonDays: 7 });
  assert.equal(forecast.direction, 'declining');
  assert.ok(forecast.projected >= 0);
  assert.ok(forecast.r2 > 0.5);
  assert.ok(forecast.reasonBn && forecast.reasonEn);
});

test('P5-৩৩. a series too short to fit reports unknown instead of projecting', () => {
  const forecast = forecastTrend([10, 12, 9], {});
  assert.equal(forecast.direction, 'unknown');
  assert.equal(forecast.projected, null);
  assert.equal(forecast.band, 'insufficient');
});

/* ── ৩৪. content intelligence ─────────────────────────────────────────────── */

test('P5-৩৪. content intelligence names specific lessons and quizzes, with evidence', () => {
  const content = buildContentIntelligence({
    lessons: [{ courseId: 'c1', lessonId: 'l3', learners: 40, completionRate: 28, quizAccuracy: 35, starts: 40, exits: 22 }],
    quizzes: [{ quizId: 'q1', attempts: 30, accuracy: 32, retryRate: 0.6, hardestTopics: ['সমাস'] }]
  });
  const kinds = content.findings.map((f) => f.kind);
  assert.ok(kinds.includes('low_completion'));
  assert.ok(kinds.includes('difficult_content'));
  assert.ok(kinds.includes('high_exit_rate'));
  assert.ok(kinds.includes('challenging_quiz'));
  assert.ok(kinds.includes('recurring_mistakes'));
  for (const finding of content.findings) {
    assert.ok(finding.evidence, `${finding.kind} must carry evidence`);
    assert.ok(finding.suggestionBn && finding.suggestionEn);
    assert.ok(finding.reasonBn && finding.reasonEn);
  }
});

test('P5-৩৫. content below its sample floor is never flagged', () => {
  const content = buildContentIntelligence({
    lessons: [{ courseId: 'c1', lessonId: 'l1', learners: 3, completionRate: 10, quizAccuracy: 10, starts: 3, exits: 3 }],
    quizzes: [{ quizId: 'q9', attempts: 2, accuracy: 5 }]
  });
  assert.equal(content.findings.length, 0);
});

test('P5-৩৬. content intelligence can only suggest — it never claims the right to change content', () => {
  const content = buildContentIntelligence({ lessons: [{ courseId: 'c1', lessonId: 'l1', learners: 40, completionRate: 20, starts: 40, exits: 30 }] });
  assert.equal(content.requiresAdminApproval, true);
  assert.match(content.noteBn, /approval/i);
  assert.match(content.noteEn, /approval/i);
});

/* ── ৩৭. course intelligence ──────────────────────────────────────────────── */

test('P5-৩৭. course intelligence flags completion risk and requires approval to restructure', () => {
  const course = buildCourseIntelligence({
    courses: [
      { courseId: 'c1', learners: 80, completionRate: 15, lessonCompletionRate: 40, starts: 80, completed: 2 },
      { courseId: 'c2', learners: 60, completionRate: 0, lessonCompletionRate: 30, starts: 60, completed: 0 }
    ]
  });
  const kinds = course.suggestions.map((s) => s.kind);
  assert.ok(kinds.includes('completion_risk'));
  assert.ok(kinds.includes('lesson_completion_low'));
  assert.ok(kinds.includes('no_completions'));
  assert.equal(course.requiresAdminApproval, true);
  assert.ok(course.suggestions.every((s) => s.confidence > 0 && s.suggestionBn && s.suggestionEn));
});

test('P5-৩৮. a healthy course produces no suggestions', () => {
  const course = buildCourseIntelligence({ courses: [{ courseId: 'c9', learners: 50, completionRate: 70, lessonCompletionRate: 80, starts: 50, completed: 35 }] });
  assert.equal(course.suggestions.length, 0);
});

/* ── ৩৯. AI performance evaluation ───────────────────────────────────────── */

test('P5-৩৯. AI performance measures acceptance, learning conversion and false positives', () => {
  const performance = evaluateAiPerformance([
    { confidence: 0.8, actionTaken: 'accepted', outcome: { learned: true }, latencyMs: 400 },
    { confidence: 0.3, actionTaken: 'ignored', outcome: { learned: false }, latencyMs: 300 },
    { confidence: 0.7, outcome: { learned: false }, latencyMs: 500 }
  ]);
  assert.equal(performance.total, 3);
  assert.equal(performance.scored, 3);
  assert.equal(performance.acceptanceRate, 0.333);
  assert.equal(performance.learningConversion, 0.333);
  /* The 0.7-confidence recommendation that failed is the false positive. */
  assert.equal(performance.falsePositive, 1);
  assert.equal(performance.avgLatencyMs, 400);
});

test('P5-৪০. AI quality is unknown without outcomes, never reported as good', () => {
  const performance = evaluateAiPerformance([{ confidence: 0.9 }, { confidence: 0.8 }]);
  assert.equal(performance.scored, 0);
  assert.equal(performance.quality, 'insufficient-outcomes');
  /* Silence is not scored as success. */
  assert.equal(performance.learningConversion, 0);
});

test('P5-৪১. AI cost stays unpriced rather than fabricating a rate', () => {
  const unpriced = evaluateAiPerformance([{ confidence: 0.5, outcome: { learned: true } }]);
  assert.equal(unpriced.cost.priced, false);
  assert.equal(unpriced.cost.totalUsd, null);

  const priced = evaluateAiPerformance([
    { confidence: 0.5, outcome: { learned: true }, costUsd: 0.0012 },
    { confidence: 0.5, outcome: { learned: true }, costUsd: 0.0008 }
  ]);
  assert.equal(priced.cost.priced, true);
  assert.equal(priced.cost.totalUsd, 0.002);
});

test('P5-৪২. a low-confidence call that succeeded is counted as a false negative', () => {
  const performance = evaluateAiPerformance([
    { confidence: 0.2, outcome: { learned: true } },
    { confidence: 0.2, outcome: { learned: true } },
    { confidence: 0.9, outcome: { learned: true } },
    { confidence: 0.9, outcome: { learned: true } },
    { confidence: 0.9, outcome: { learned: true } }
  ]);
  assert.equal(performance.falseNegative, 2);
  assert.equal(performance.falseNegativeRate, 0.4);
});

/* ── ৪৩. admin signal aggregation ────────────────────────────────────────── */

test('P5-৪৩. the admin signal bundle carries forecasts, content and course reads together', () => {
  const bundle = buildAdminAiSignals({
    dashboard: {
      insights: [{ kind: 'attention', id: 'x', text: 'y' }],
      lessons: [{ courseId: 'c1', lessonId: 'l1', learners: 40, completionRate: 25, starts: 40, exits: 25 }],
      quizzes: [],
      courses: [{ courseId: 'c1', learners: 40, completionRate: 18, lessonCompletionRate: 45, starts: 40, completed: 1 }]
    },
    series: decliningSeries().map((d) => d)
  }, { horizonDays: 7 });
  assert.ok(bundle.forecasts.engagement);
  assert.ok(bundle.forecasts.lessons);
  assert.ok(bundle.content.findings.length > 0);
  assert.ok(bundle.course.suggestions.length > 0);
  /* The Phase 4 rules' own insights pass through untouched. */
  assert.equal(bundle.baseInsights.length, 1);
});

test('P5-৪৪. the AI layer adds to the Phase 4 insights and never rewrites them', () => {
  const base = [{ kind: 'attention', id: 'drop', text: 'Phase 4 said this' }];
  const bundle = buildAdminAiSignals({ dashboard: { insights: base, lessons: [], quizzes: [], courses: [] }, series: [1, 2, 3] });
  assert.equal(bundle.baseInsights, base);
  assert.equal(bundle.baseInsights[0].text, 'Phase 4 said this');
});

/* ── ৪৫. purity ───────────────────────────────────────────────────────────── */

test('P5-৪৫. every function is pure — the same input twice yields the same output', () => {
  const input = decliningInput();
  const first = buildStudentProfile(input, { windowDays: 30 });
  const second = buildStudentProfile(input, { windowDays: 30 });
  /* `generatedAt` is the one clock read; everything else must be identical. */
  assert.deepEqual({ ...first, generatedAt: 0 }, { ...second, generatedAt: 0 });

  const a = predictRisk({ profile: first, series: input.series, metrics: input.metrics }, { windowDays: 14 });
  const b = predictRisk({ profile: second, series: input.series, metrics: input.metrics }, { windowDays: 14 });
  assert.deepEqual(a, b);
});

test('P5-৪৬. the core never calls out — no fetch, no storage, no model', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('./ai-analytics-intelligence.mjs', import.meta.url), 'utf8'));
  assert.ok(!/\bfetch\s*\(/.test(source), 'the intelligence core must not fetch');
  assert.ok(!/\bglobalThis\.(crypto|localStorage)\b/.test(source), 'the core must not touch platform storage');
  assert.ok(!/from '\.\/ai-agent\.js'/.test(source), 'the core must not depend on the model layer');
});
