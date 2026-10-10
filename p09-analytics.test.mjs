/* P09 — Advanced Analytics insight engine.
 * Runs the SHIPPED module (not a copy) against a synthetic student history. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* Load the BROWSER build the way the app does (self UMD), so the tested code is
   the shipped code. */
const src = readFileSync(new URL('./analytics-insight-engine.js', import.meta.url), 'utf8');
const fakeSelf = {};
const A = new Function('self', `${src}\nreturn self.AhAnalyticsInsights;`)(fakeSelf);

/* Build an exam result whose snapshot encodes the answers we want. */
function result(at, answers) {
  return {
    id: 'r' + at, completedAt: at, accuracy: A.pct(answers.filter(a => a.status === 'correct').length, answers.filter(a => a.status !== 'skipped').length),
    snapshot: answers.map((a, i) => ({ questionId: a.q, subjectId: 's1', topicId: a.topic, status: a.status, timing: { seconds: a.sec || 30 }, question: 'q' + i }))
  };
}
const byId = list => new Map(list.map(q => [q.id, q]));

test('p09-01: an empty history produces an empty, non-throwing model', () => {
  const m = A.analyze({ results: [], mistakes: [], questions: [] });
  assert.deepEqual(m.topics, []);
  assert.equal(m.improvement.overall, 0);
  assert.equal(m.patterns.totalWrong, 0);
  assert.deepEqual(m.insights, []);
});

test('p09-02: topic strength — a high scorer is strong, a low one is weak', () => {
  const rs = [
    result(1000, [{ q: 'a', topic: 't1', status: 'correct' }, { q: 'b', topic: 't1', status: 'correct' }, { q: 'c', topic: 't1', status: 'correct' }, { q: 'd', topic: 't1', status: 'correct' }]),
    result(2000, [{ q: 'e', topic: 't2', status: 'wrong' }, { q: 'f', topic: 't2', status: 'wrong' }, { q: 'g', topic: 't2', status: 'wrong' }, { q: 'h', topic: 't2', status: 'correct' }])
  ];
  const m = A.analyze({ results: rs, questions: [] });
  const t1 = m.topics.find(t => t.topicId === 't1');
  const t2 = m.topics.find(t => t.topicId === 't2');
  assert.equal(t1.status, A.STATUS.STRONG);
  assert.equal(t1.accuracy, 100);
  assert.equal(t1.trend, 'flat', 'one exam is never a trend');
  assert.equal(t2.status, A.STATUS.WEAK);
  assert.equal(t2.accuracy, 25);
});

test('p09-03: a downward move is called out even when the average is decent', () => {
  // First half all correct, second half mostly wrong → declining.
  const rs = [result(1000, [{ q: 'a', topic: 't1', status: 'correct' }, { q: 'b', topic: 't1', status: 'correct' }]),
              result(2000, [{ q: 'c', topic: 't1', status: 'wrong' }, { q: 'd', topic: 't1', status: 'wrong' }])];
  const t1 = A.analyze({ results: rs, questions: [] }).topics.find(t => t.topicId === 't1');
  assert.equal(t1.trend, 'down');
  assert.equal(t1.status, A.STATUS.DECLINING);
});

test('p09-04: an untagged topic with fewer than four answers has no claimed direction', () => {
  assert.equal(A.trendOf([{ at: 1, status: 'correct' }, { at: 2, status: 'wrong' }]), 'flat');
});

test('p09-05: unreviewed mistakes in a below-par topic mark it needs-revision', () => {
  const rs = [result(1000, [{ q: 'a', topic: 't1', status: 'correct' }, { q: 'b', topic: 't1', status: 'wrong' }, { q: 'c', topic: 't1', status: 'wrong' }, { q: 'd', topic: 't1', status: 'correct' }])];
  const mistakes = [{ questionId: 'b', topicId: 't1', revisionStatus: 'pending', wrongCount: 1 }];
  const t1 = A.analyze({ results: rs, mistakes, questions: [] }).topics.find(t => t.topicId === 't1');
  assert.equal(t1.pendingMistakes, 1);
  assert.equal(t1.status, A.STATUS.REVISION);
});

test('p09-06: difficulty-wise accuracy splits by the question tag, untagged counted', () => {
  const rs = [result(1000, [{ q: 'a', topic: 't1', status: 'correct' }, { q: 'b', topic: 't1', status: 'wrong' }, { q: 'c', topic: 't1', status: 'correct' }])];
  const questions = [{ id: 'a', difficulty: 'easy' }, { id: 'b', difficulty: 'hard' }, { id: 'c' }];
  const d = A.analyze({ results: rs, questions }).difficulty;
  assert.equal(d.easy.accuracy, 100);
  assert.equal(d.hard.accuracy, 0);
  assert.equal(d.medium.accuracy, 100, 'an untagged question defaults to medium');
  assert.equal(d.untagged, 1);
});

test('p09-07: time-spent reports a total, an average, and per-difficulty averages', () => {
  const rs = [result(1000, [{ q: 'a', topic: 't1', status: 'correct', sec: 20 }, { q: 'b', topic: 't1', status: 'correct', sec: 40 }])];
  rs[0].timeUsed = 60;
  const t = A.analyze({ results: rs, questions: [{ id: 'a', difficulty: 'easy' }, { id: 'b', difficulty: 'hard' }] }).time;
  assert.equal(t.answered, 2);
  assert.equal(t.averagePerQuestion, 30);
  assert.equal(t.byDifficulty.easy.average, 20);
  assert.equal(t.byDifficulty.hard.average, 40);
});

test('p09-08: wrong-pattern report surfaces repeated slips and per-topic counts', () => {
  const mistakes = [
    { questionId: 'a', topicId: 't1', wrongCount: 3 },
    { questionId: 'b', topicId: 't1', wrongCount: 1 },
    { questionId: 'c', topicId: 't2', wrongCount: 2 }
  ];
  const wp = A.analyze({ results: [], mistakes, questions: [] }).patterns;
  assert.equal(wp.totalWrong, 3);
  assert.equal(wp.repeated.length, 2, 'only wrongCount >= 2 is a pattern');
  assert.equal(wp.repeated[0].questionId, 'a');
  assert.equal(wp.byTopic.find(x => x.topicId === 't1').count, 2);
});

test('p09-09: improvement rate compares the later half of exams with the earlier half', () => {
  const rs = [result(1000, [{ q: 'a', topic: 't1', status: 'wrong' }]), result(2000, [{ q: 'b', topic: 't1', status: 'wrong' }]),
              result(3000, [{ q: 'c', topic: 't1', status: 'correct' }]), result(4000, [{ q: 'd', topic: 't1', status: 'correct' }])];
  const imp = A.analyze({ results: rs, questions: [] }).improvement;
  assert.equal(imp.samples, 4);
  assert.equal(imp.overall, 100, '0% -> 100% is +100 points');
});

test('p09-10: insight cards use plain language and stay silent when there is nothing to say', () => {
  const rs = [result(1000, [{ q: 'a', topic: 't1', status: 'correct' }, { q: 'b', topic: 't1', status: 'correct' }, { q: 'c', topic: 't1', status: 'correct' }, { q: 'd', topic: 't1', status: 'correct' }]),
              result(2000, [{ q: 'e', topic: 't2', status: 'wrong' }, { q: 'f', topic: 't2', status: 'wrong' }, { q: 'g', topic: 't2', status: 'wrong' }, { q: 'h', topic: 't2', status: 'correct' }])];
  const cards = A.analyze({ results: rs, questions: [] }).insights;
  assert.ok(cards.length >= 2);
  assert.ok(cards.every(c => c.kind && c.title && c.text));
  assert.ok(cards.some(c => c.kind === 'positive'), 'a strong topic yields a positive card');
  assert.ok(cards.some(c => c.kind === 'attention'), 'a weak topic yields an attention card');
});

test('p09-11: analyze is tolerant of missing fields and odd input', () => {
  const m = A.analyze({ results: [null, {}, { snapshot: null }], mistakes: [null], questions: null });
  assert.ok(Array.isArray(m.topics));
  assert.ok(m.insights);
});

/* ---- wiring: the panel and the shell must actually ship ---- */
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
const panel = readFileSync(new URL('./analytics-insights-panel.js', import.meta.url), 'utf8');
const progress = readFileSync(new URL('./progress-tool.js', import.meta.url), 'utf8');

test('p09-12: the insight engine and panel are loaded and precached', () => {
  assert.match(html, /analytics-insight-engine\.js\?v=p09-v1/);
  assert.match(html, /analytics-insights-panel\.js\?v=p09-v1/);
  assert.match(sw, /'\.\/analytics-insight-engine\.js\?v=p09-v1'/);
  assert.match(sw, /'\.\/analytics-insights-panel\.js\?v=p09-v1'/);
});

test('p09-13: the Progress page offers the analysis entry point', () => {
  assert.match(progress, /openAnalyticsInsightsPanel/);
  assert.match(progress, /p2-insights-btn/);
});

test('p09-14: the panel is read-only and renders every section', () => {
  assert.ok(panel.includes('window.openAnalyticsInsightsPanel'), 'panel must expose its opener');
  assert.ok(panel.includes("AhAnalyticsInsights"), 'panel must read the engine');
  for (const section of ['মূল কথা', 'কঠিনতা', 'উন্নতির হার', 'বারবার ভুল']) {
    assert.ok(panel.includes(section), `panel must render the ${section} section`);
  }
  assert.ok(!/dbPut\s*\(/.test(panel), 'the panel must never write to the database');
});
