/* P11 — Adaptive Learning Engine.
 * Runs the SHIPPED module (not a copy) against synthetic exam history. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./adaptive-engine.js', import.meta.url), 'utf8');
const fakeSelf = {};
const E = new Function('self', `${src}\nreturn self.AhAdaptiveEngine;`)(fakeSelf);

const result = (at, answers) => ({
  completedAt: at,
  snapshot: answers.map(a => ({ questionId: a.q, topicId: a.topic, status: a.status, timing: { ms: (a.sec || 60) * 1000 } }))
});
const byId = list => new Map(list.map(q => [q.id, q]));

test('p11e-01: an empty history yields a neutral, mixed recommendation', () => {
  const m = E.analyze({ results: [], questions: [] });
  assert.deepEqual(m.topics, []);
  assert.equal(m.recommendedDifficulty, 'mixed');
  assert.equal(m.overall.ability, 0);
  assert.equal(m.speed.profile, 'balanced');
  assert.equal(m.practicePattern.exams, 0);
});

test('p11e-02: ability weights hard questions more than easy ones', () => {
  // Four correct easy + four wrong hard is weaker than four wrong easy + four correct hard.
  const easyStrong = result(1000, [
    { q: 'a', topic: 't1', status: 'correct' }, { q: 'b', topic: 't1', status: 'correct' },
    { q: 'c', topic: 't1', status: 'correct' }, { q: 'd', topic: 't1', status: 'correct' },
    { q: 'e', topic: 't1', status: 'wrong' }, { q: 'f', topic: 't1', status: 'wrong' },
    { q: 'g', topic: 't1', status: 'wrong' }, { q: 'h', topic: 't1', status: 'wrong' }
  ]);
  const qs = [{ id: 'a', difficulty: 'easy' }, { id: 'b', difficulty: 'easy' }, { id: 'c', difficulty: 'easy' }, { id: 'd', difficulty: 'easy' },
              { id: 'e', difficulty: 'hard' }, { id: 'f', difficulty: 'hard' }, { id: 'g', difficulty: 'hard' }, { id: 'h', difficulty: 'hard' }];
  const m = E.analyze({ results: [easyStrong], questions: qs });
  // gained = 4*1 (easy correct) = 4; total = 4*1 + 4*2 = 12 -> 33.3%
  assert.equal(m.topics[0].ability, 33.3);
  assert.ok(m.topics[0].ability < m.topics[0].accuracy, 'hard failures drag ability below raw accuracy');
});

test('p11e-03: a topic with few answers is not pushed into a band', () => {
  const m = E.analyze({ results: [result(1000, [{ q: 'a', topic: 't1', status: 'correct' }])], questions: [] });
  assert.equal(m.topics[0].band, 'mixed');
  assert.ok(m.topics[0].confidence < 1);
});

test('p11e-04: a strong topic recommends hard, a weak one recommends easy', () => {
  const answers = [
    { q: 'a', topic: 't1', status: 'correct' }, { q: 'b', topic: 't1', status: 'correct' },
    { q: 'c', topic: 't1', status: 'correct' }, { q: 'd', topic: 't1', status: 'correct' },
    { q: 'e', topic: 't2', status: 'wrong' }, { q: 'f', topic: 't2', status: 'wrong' },
    { q: 'g', topic: 't2', status: 'wrong' }, { q: 'h', topic: 't2', status: 'wrong' }
  ];
  const m = E.analyze({ results: [result(1000, answers)], questions: [] });
  assert.equal(m.topics.find(t => t.topicId === 't1').band, 'hard');
  assert.equal(m.topics.find(t => t.topicId === 't2').band, 'easy');
});

test('p11e-05: recommendBand thresholds are honest about how much data exists', () => {
  assert.equal(E.recommendBand(90, 2), 'mixed', 'two answers is not enough');
  assert.equal(E.recommendBand(90, 6), 'hard');
  assert.equal(E.recommendBand(60, 6), 'medium');
  assert.equal(E.recommendBand(20, 6), 'easy');
});

test('p11e-06: fast-but-wrong is distinguished from slow-but-right', () => {
  const fastWrong = [];
  for (let i = 0; i < 5; i++) fastWrong.push({ q: 'q' + i, topic: 't1', status: 'wrong', sec: 10 });
  const slowRight = [];
  for (let i = 0; i < 5; i++) slowRight.push({ q: 'q' + i, topic: 't1', status: 'correct', sec: 200 });
  const qs = Array.from({ length: 5 }, (_, i) => ({ id: 'q' + i, difficulty: 'medium' }));
  const a = E.analyze({ results: [result(1000, fastWrong)], questions: qs }).speed.profile;
  const b = E.analyze({ results: [result(1000, slowRight)], questions: qs }).speed.profile;
  assert.equal(a, 'fast-wrong', 'answering everything fast and wrong is the fast-wrong profile');
  assert.equal(b, 'slow-right');
});

test('p11e-07: fast-accurate is recognised when quick answers are also right', () => {
  const rows = [];
  for (let i = 0; i < 4; i++) rows.push({ q: 'c' + i, topic: 't1', status: 'correct', sec: 10 });
  for (let i = 0; i < 4; i++) rows.push({ q: 's' + i, topic: 't1', status: 'wrong', sec: 200 });
  const qs = Array.from({ length: 8 }, (_, i) => ({ id: i < 4 ? 'c' + i : 's' + (i - 4), difficulty: 'medium' }));
  const m = E.analyze({ results: [result(1000, rows)], questions: qs });
  assert.equal(m.speed.profile, 'fast-accurate');
  assert.equal(m.speed.fastAccuracy, 100);
});

test('p11e-08: skipped questions never enter the model', () => {
  const at = 1000;
  const m = E.analyze({ results: [result(at, [{ q: 'a', topic: 't1', status: 'correct' }, { q: 'b', topic: 't1', status: 'skipped' }])], questions: [] });
  assert.equal(m.topics[0].attempts, 1);
  assert.equal(m.overall.attempts, 1);
});

test('p11e-09: practice pattern remembers exams, active days and preferred difficulty', () => {
  const rs = [result(new Date('2026-10-01').getTime(), [{ q: 'a', topic: 't1', status: 'correct' }]),
              result(new Date('2026-10-01').getTime() + 10, [{ q: 'b', topic: 't1', status: 'correct' }]),
              result(new Date('2026-10-02').getTime(), [{ q: 'c', topic: 't1', status: 'correct' }])];
  const qs = [{ id: 'a', difficulty: 'hard' }, { id: 'b', difficulty: 'hard' }, { id: 'c', difficulty: 'medium' }];
  const p = E.analyze({ results: rs, questions: qs }).practicePattern;
  assert.equal(p.exams, 3);
  assert.equal(p.activeDays, 2);
  assert.equal(p.totalQuestions, 3);
  assert.equal(p.preferredDifficulty, 'hard');
});

test('p11e-10: the target mix is a valid probability distribution for every band', () => {
  for (const band of ['easy', 'medium', 'hard', 'mixed']) {
    const m = E.targetMix(band);
    const sum = m.easy + m.medium + m.hard;
    assert.ok(Math.abs(sum - 1) < 1e-9, `${band} mix must sum to 1`);
    assert.ok(m.easy >= 0 && m.medium >= 0 && m.hard >= 0);
  }
  assert.ok(E.targetMix('easy').easy > E.targetMix('hard').easy, 'a struggling student gets more easy questions');
  assert.ok(E.targetMix('hard').hard > E.targetMix('easy').hard, 'a strong student gets more hard questions');
});

test('p11e-11: analyze is tolerant of null records and odd input', () => {
  const m = E.analyze({ results: [null, {}, { snapshot: null }], questions: null });
  assert.ok(Array.isArray(m.topics));
  assert.ok(m.speed && m.practicePattern && m.overall);
});

/* ---- wiring: the engine ships and the exam path actually consults it ---- */
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
const panel = readFileSync(new URL('./adaptive-insights-panel.js', import.meta.url), 'utf8');

test('p11e-12: the engine and panel are loaded and precached', () => {
  assert.match(html, /adaptive-engine\.js\?v=p11-v1/);
  assert.match(html, /adaptive-insights-panel\.js\?v=p11-v1/);
  assert.match(sw, /'\.\/adaptive-engine\.js\?v=p11-v1'/);
  assert.match(sw, /'\.\/adaptive-insights-panel\.js\?v=p11-v1'/);
});

test('p11e-13: the adaptive exam mode selects by the student\'s measured band', () => {
  assert.ok(html.includes('function adaptiveBand()'), 'the band must be read from the engine');
  assert.ok(html.includes('selectAdaptiveFor'), 'ExamSelect must expose a band-aware selection');
  assert.match(html, /mode==='adaptive'\)\{ const band=adaptiveBand\(\)/, 'the adaptive branch must consult the band');
});

test('p11e-14: the panel is read-only and offers an adaptive practice entry', () => {
  assert.ok(panel.includes('AhAdaptiveEngine'));
  assert.ok(panel.includes('openAdaptivePanel'));
  assert.ok(!/dbPut|dbDel|localStorage\.setItem/.test(panel), 'the panel must not write anything');
  assert.ok(html.includes('startAdaptivePractice'), 'a one-tap adaptive practice entry must exist');
});
