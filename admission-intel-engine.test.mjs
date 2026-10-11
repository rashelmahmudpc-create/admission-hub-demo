/* P18 — Admission Intelligence Engine.
 *
 * Runs the SHIPPED engine against synthetic history and the SHIPPED academic
 * catalog. Two things matter most here and are asserted hard:
 *   1. the official university/unit/subject map comes from the catalog, never
 *      from a hard-coded A/B/C/D guess;
 *   2. no output ever promises a rank, a pass or a seat. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./admission-intel-engine.js', import.meta.url), 'utf8');
const fakeSelf = {};
const E = new Function('self', `${src}\nreturn self.AhAdmissionIntel;`)(fakeSelf);
// Load the shipped browser build of the catalog the same way the app does.
const catSrc = readFileSync(new URL('./academic-catalog.js', import.meta.url), 'utf8');
const catalog = new Function('self', 'module', 'window', `${catSrc}\nreturn self.AH_AcademicCatalog;`)({}, undefined, undefined);

const result = (at, answers) => ({
  completedAt: at,
  snapshot: answers.map((a) => ({ questionId: a.q, topicId: a.topic, status: a.status }))
});
const goal = (university, unit, daysLeft = 30) => ({ university, unit, daysLeft });

test('ai-01: no history is reported honestly, not filled with fake numbers', () => {
  const p = E.build({ results: [], questions: [], topics: [], catalog, goal: goal('Rajshahi University', 'A Unit') });
  assert.equal(p.totals.answered, 0);
  assert.equal(p.coverage.covered, 0);
  assert.match(p.message, /এখনো পরীক্ষার ডেটা নেই/);
  // With no history the only honest plan is "start these official subjects" —
  // and it must never carry an invented question count or a made-up accuracy.
  const blocks = p.plan.flatMap((d) => d.blocks);
  assert.ok(blocks.every((b) => b.kind === 'new'), 'only untouched-subject blocks, no fake weakness claims');
  assert.ok(blocks.every((b) => b.questions === 0), 'no invented question counts');
  assert.ok(blocks.every((b) => b.accuracy === undefined), 'no invented accuracy');
});

test('ai-01b: with neither history nor a resolvable goal there is no plan at all', () => {
  const p = E.build({ results: [], questions: [], topics: [], catalog: null, goal: {} });
  assert.deepEqual(p.plan, []);
});

test('ai-02: the subject list is the OFFICIAL one for the chosen university+unit', () => {
  const p = E.build({ results: [], questions: [], topics: [], catalog, goal: goal('University of Dhaka', 'B Unit') });
  assert.equal(p.mapReason, 'ok');
  // DU B is the commerce group in the catalog — not a generic A/B/C/D set.
  assert.deepEqual(p.eligibleSubjects, ['English', 'Math', 'Accounting', 'Finance & Banking', 'Business Organization & Management', 'ICT']);
  assert.match(p.group, /Commerce/);
});

test('ai-03: a different unit yields a different official subject set', () => {
  const a = E.build({ results: [], questions: [], topics: [], catalog, goal: goal('University of Dhaka', 'A Unit') });
  const c = E.build({ results: [], questions: [], topics: [], catalog, goal: goal('University of Dhaka', 'C Unit') });
  assert.notDeepEqual(a.eligibleSubjects, c.eligibleSubjects);
  assert.ok(a.eligibleSubjects.includes('Physics'));
  assert.ok(c.eligibleSubjects.includes('Bangla'));
});

test('ai-04: an unknown university is admitted, never silently invented', () => {
  const p = E.build({ results: [], questions: [], topics: [], catalog, goal: goal('Nowhere University', 'A Unit') });
  assert.equal(p.mapReason, 'unknown-university');
  assert.deepEqual(p.eligibleSubjects, []);
  assert.equal(p.university, null);
});

test('ai-05: no catalog at all degrades to history-only, not a guessed unit map', () => {
  const p = E.build({ results: [], questions: [], topics: [], catalog: null, goal: goal('Rajshahi University', 'A Unit') });
  assert.equal(p.mapReason, 'no-catalog');
  assert.deepEqual(p.eligibleSubjects, []);
});

test('ai-06: the goal label "A Unit" resolves to catalog unit A', () => {
  const p = E.build({ results: [], questions: [], topics: [], catalog, goal: goal('Rajshahi University', 'A Unit') });
  assert.equal(p.mapReason, 'ok');
  assert.equal(p.unit.id, 'A');
  assert.ok(p.eligibleSubjects.length > 0);
});

test('ai-07: coverage counts only subjects actually practised', () => {
  const topics = [{ id: 'phy1', name: 'Physics — Motion' }, { id: 'chem1', name: 'Chemistry — Bonding' }];
  const questions = [{ id: 'q1', topicId: 'phy1', difficulty: 'easy' }];
  const results = [result(1000, [{ q: 'q1', topic: 'phy1', status: 'correct' }])];
  const p = E.build({ results, questions, topics, catalog, goal: goal('Rajshahi University', 'A Unit') });
  assert.equal(p.coverage.covered, 1);
  assert.ok(p.coverage.subjects.find((s) => s.subject === 'Physics').practised);
  assert.ok(!p.coverage.subjects.find((s) => s.subject === 'Chemistry').practised);
  assert.ok(p.coverage.untouched.includes('Chemistry'));
});

test('ai-08: the weakest topic is flagged and leads the plan', () => {
  const topics = [{ id: 'alg', name: 'Math — Algebra' }, { id: 'geo', name: 'Math — Geometry' }];
  const questions = [{ id: 'a1', topicId: 'alg', difficulty: 'easy' }, { id: 'g1', topicId: 'geo', difficulty: 'easy' }];
  const results = [
    result(1000, [{ q: 'a1', topic: 'alg', status: 'correct' }, { q: 'g1', topic: 'geo', status: 'wrong' }]),
    result(2000, [{ q: 'a1', topic: 'alg', status: 'correct' }, { q: 'g1', topic: 'geo', status: 'wrong' }])
  ];
  const p = E.build({ results, questions, topics, catalog, goal: goal('Rajshahi University', 'A Unit') });
  assert.equal(p.topics[0].topicId, 'geo');
  assert.equal(p.plan[0].blocks[0].topicId, 'geo');
  assert.equal(p.plan[0].blocks[0].kind, 'weak');
});

test('ai-09: an untouched official subject is named as a priority, with no invented questions', () => {
  const topics = [{ id: 'phy1', name: 'Physics — Motion' }];
  const questions = [{ id: 'q1', topicId: 'phy1', difficulty: 'easy' }];
  const results = [result(1000, [{ q: 'q1', topic: 'phy1', status: 'correct' }])];
  const p = E.build({ results, questions, topics, catalog, goal: goal('Rajshahi University', 'A Unit') });
  const newBlocks = p.plan.flatMap((d) => d.blocks).filter((b) => b.kind === 'new');
  assert.ok(newBlocks.length > 0, 'untouched subjects must appear');
  assert.ok(newBlocks.every((b) => b.questions === 0), 'we must not invent question counts for unknown subjects');
});

test('ai-10: the plan never runs past the exam horizon', () => {
  const topics = [{ id: 't1', name: 'Physics' }];
  const questions = [{ id: 'q1', topicId: 't1', difficulty: 'easy' }];
  const results = [result(1000, [{ q: 'q1', topic: 't1', status: 'correct' }])];
  const p = E.build({ results, questions, topics, catalog, goal: goal('Rajshahi University', 'A Unit', 3) });
  assert.ok(p.plan.length <= 3, 'plan days must not exceed daysLeft');
});

test('ai-11: the question-pattern report reflects the real difficulty mix', () => {
  const topics = [{ id: 't1', name: 'Physics' }];
  const questions = [
    { id: 'e1', topicId: 't1', difficulty: 'easy' },
    { id: 'h1', topicId: 't1', difficulty: 'hard' }
  ];
  const results = [result(1000, [
    { q: 'e1', topic: 't1', status: 'correct' },
    { q: 'h1', topic: 't1', status: 'wrong' }
  ])];
  const p = E.build({ results, questions, topics, catalog, goal: goal('Rajshahi University', 'A Unit') });
  const easy = p.pattern.find((x) => x.difficulty === 'easy');
  const hard = p.pattern.find((x) => x.difficulty === 'hard');
  assert.equal(easy.accuracy, 100);
  assert.equal(hard.accuracy, 0);
  assert.ok(!p.pattern.find((x) => x.difficulty === 'medium').attempted);
});

test('ai-12: POLICY — nothing the engine emits promises a rank, pass or seat', () => {
  const topics = [{ id: 't1', name: 'Physics' }];
  const questions = [{ id: 'q1', topicId: 't1', difficulty: 'easy' }];
  const results = [result(1000, [{ q: 'q1', topic: 't1', status: 'correct' }])];
  const p = E.build({ results, questions, topics, catalog, goal: goal('Rajshahi University', 'A Unit') });
  const everything = [p.message, ...p.plan.flatMap((d) => d.blocks.map((b) => b.why || ''))].join(' ');
  assert.ok(E.guaranteeSafe(everything), 'engine output must pass the policy lock');
});

test('ai-13: POLICY — guaranteeSafe rejects a rank/pass promise', () => {
  assert.ok(!E.guaranteeSafe('তুমি নিশ্চিত ভর্তি হয়ে যাবে'));
  assert.ok(!E.guaranteeSafe('guaranteed rank'));
  assert.ok(E.guaranteeSafe('তোমার অভ্যাসের ডেটা অনুযায়ী পরামর্শ'));
});

test('ai-14: the engine is pure — no model call, no storage, no network', () => {
  assert.ok(!/\bfetch\s*\(/.test(src), 'no fetch');
  assert.ok(!/XMLHttpRequest/.test(src), 'no XHR');
  assert.ok(!/dbPut|objectStore\(|localStorage/.test(src), 'no writes');
  assert.ok(!/openai|gemini|anthropic/i.test(src), 'no model provider');
});

test('ai-15: BUET/IUT single-admission units are handled (no fake A/B/C/D)', () => {
  const p = E.build({ results: [], questions: [], topics: [], catalog, goal: goal('BUET', 'BUET Unit') });
  assert.equal(p.mapReason, 'ok');
  assert.equal(p.unit.id, 'BUET');
  assert.ok(p.eligibleSubjects.length > 0);
});
