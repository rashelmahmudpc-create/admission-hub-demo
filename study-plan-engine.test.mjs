/* P17 — Student-facing action agent ("prepare me") study-plan engine.
 * Runs the SHIPPED module (not a copy) against synthetic exam history. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./study-plan-engine.js', import.meta.url), 'utf8');
const fakeSelf = {};
const E = new Function('self', `${src}\nreturn self.AhStudyPlanEngine;`)(fakeSelf);

const result = (at, answers) => ({
  completedAt: at,
  snapshot: answers.map((a) => ({ questionId: a.q, topicId: a.topic, status: a.status }))
});
const byId = (list) => new Map(list.map((q) => [q.id, q]));

test('sp-01: no history yields an honest empty plan, not a fake one', () => {
  const p = E.build({ results: [], questions: [], mistakes: [] });
  assert.equal(p.days.length, 0);
  assert.equal(p.totals.questions, 0);
  assert.match(p.message, /এখনো পরীক্ষার ডেটা নেই/);
});

test('sp-02: the weakest topic is prioritised first', () => {
  const qs = [
    { id: 'a1', topicId: 'algebra', difficulty: 'easy' },
    { id: 'b1', topicId: 'geometry', difficulty: 'easy' },
    { id: 'c1', topicId: 'physics', difficulty: 'easy' }
  ];
  const results = [
    result(1000, [
      { q: 'a1', topic: 'algebra', status: 'correct' }, { q: 'b1', topic: 'geometry', status: 'wrong' },
      { q: 'c1', topic: 'physics', status: 'correct' }
    ])
  ];
  const p = E.build({ results, questions: qs, mistakes: [] });
  assert.equal(p.priorities[0].topicId, 'geometry');
  assert.equal(p.priorities[0].kind, 'weak');
  assert.equal(p.days[0].blocks[0].topicId, 'geometry');
});

test('sp-03: thin data is not called strong — a wrong answer still counts', () => {
  const qs = [
    { id: 'a1', topicId: 'algebra', difficulty: 'easy' },
    { id: 'g1', topicId: 'geometry', difficulty: 'easy' }
  ];
  const results = [result(1000, [
    { q: 'a1', topic: 'algebra', status: 'wrong' },
    { q: 'g1', topic: 'geometry', status: 'correct' }
  ])];
  const p = E.build({ results, questions: qs });
  const algebra = p.priorities.find((r) => r.topicId === 'algebra');
  const geometry = p.priorities.find((r) => r.topicId === 'geometry');
  assert.equal(algebra.kind, 'weak', 'one wrong answer in thin data is still a signal');
  assert.equal(geometry.kind, 'new', 'no data and no mistake is just "new"');
  assert.ok(p.priorities.indexOf(algebra) < p.priorities.indexOf(geometry), 'the mistake comes first');
});

test('sp-04: repeated mistakes on a topic force it into the weak tier', () => {
  const qs = [
    { id: 'a1', topicId: 'algebra', difficulty: 'easy' },
    { id: 'a2', topicId: 'algebra', difficulty: 'easy' },
    { id: 'a3', topicId: 'algebra', difficulty: 'easy' },
    { id: 'a4', topicId: 'algebra', difficulty: 'easy' }
  ];
  // All correct, so ability is high; but the same topic is recorded as repeatedly
  // missed, which must still pull it up the priority list.
  const results = [result(1000, [
    { q: 'a1', topic: 'algebra', status: 'correct' }, { q: 'a2', topic: 'algebra', status: 'correct' },
    { q: 'a3', topic: 'algebra', status: 'correct' }, { q: 'a4', topic: 'algebra', status: 'correct' }
  ])];
  const p = E.build({ results, questions: qs, mistakes: [{ questionId: 'a1', topicId: 'algebra', wrongCount: 3 }] });
  const row = p.priorities.find((r) => r.topicId === 'algebra');
  assert.equal(row.kind, 'weak');
  assert.match(row.reason, /বারবার ভুল/);
});

test('sp-05: each day block carries a difficulty mix that sums to its count', () => {
  const qs = [
    { id: 'a1', topicId: 'algebra', difficulty: 'hard' },
    { id: 'a2', topicId: 'algebra', difficulty: 'hard' },
    { id: 'a3', topicId: 'algebra', difficulty: 'hard' },
    { id: 'b1', topicId: 'geometry', difficulty: 'easy' }
  ];
  const results = [result(1000, [
    { q: 'a1', topic: 'algebra', status: 'correct' }, { q: 'a2', topic: 'algebra', status: 'correct' },
    { q: 'a3', topic: 'algebra', status: 'correct' }, { q: 'b1', topic: 'geometry', status: 'wrong' }
  ])];
  const p = E.build({ results, questions: qs, perTopic: 10 });
  for (const day of p.days) {
    for (const b of day.blocks) {
      const sum = b.mix.easy + b.mix.medium + b.mix.hard;
      assert.equal(sum, b.count, `mix for ${b.topicId} sums to its count`);
    }
  }
});

test('sp-06: a strong student is pushed toward harder practice', () => {
  const qs = [];
  const answers = [];
  for (let i = 0; i < 8; i++) { qs.push({ id: 'q' + i, topicId: 'algebra', difficulty: 'hard' }); answers.push({ q: 'q' + i, topic: 'algebra', status: 'correct' }); }
  const p = E.build({ results: [result(1000, answers)], questions: qs });
  assert.equal(p.overall.band, 'hard');
  const block = p.days[0].blocks[0];
  assert.ok(block.mix.hard >= block.mix.easy, 'hard questions dominate for a strong student');
});

test('sp-07: the plan never exceeds the requested number of days', () => {
  const qs = [];
  const answers = [];
  for (let i = 0; i < 20; i++) { const t = 't' + (i % 10); qs.push({ id: 'q' + i, topicId: t, difficulty: 'easy' }); answers.push({ q: 'q' + i, topic: t, status: i % 2 ? 'correct' : 'wrong' }); }
  const p = E.build({ results: [result(1000, answers)], questions: qs, days: 2, perDay: 2 });
  assert.ok(p.days.length <= 2, 'no more days than asked for');
  assert.ok(p.totals.questions > 0);
});

test('sp-08: the message never promises a rank or a guaranteed result', () => {
  const qs = [{ id: 'a1', topicId: 'algebra', difficulty: 'easy' }];
  const p = E.build({ results: [result(1000, [{ q: 'a1', topic: 'algebra', status: 'wrong' }])], questions: qs });
  assert.doesNotMatch(p.message, /নিশ্চিত|গ্যারান্টি|rank|র‍্যাঙ্ক|পাস/i);
});
