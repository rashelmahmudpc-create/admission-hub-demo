/* P12 — Smart Vocabulary SRS engine.
 * Runs the SHIPPED module (not a copy) so the suite pins real behaviour. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./vocabulary-srs-engine.js', import.meta.url), 'utf8');
const fakeSelf = {};
const S = new Function('self', `${src}\nreturn self.AhVocabSrs;`)(fakeSelf);
const { GRADE, DAY } = S;

const rec = (word, over = {}) => ({
  word, category: String(word[0]).toUpperCase(), meaning: `${word} অর্থ`,
  synonyms: [{ word: `${word}syn`, meaning: 'সমার্থক' }],
  antonyms: [{ word: `${word}ant`, meaning: 'বিপরীত' }],
  ...over,
});

test('p12-01: a fresh card is due immediately with default ease', () => {
  const c = S.freshCard('Abandon', 1000);
  assert.equal(c.repetitions, 0);
  assert.equal(c.ease, S.START_EASE);
  assert.equal(c.dueAt, 1000);
  assert.ok(!S.isMastered(c));
  assert.ok(!S.isLeech(c));
});

test('p12-02: a good answer sets the first interval to one day', () => {
  const at = 1000;
  const c = S.schedule(S.freshCard('Abandon'), GRADE.GOOD, at);
  assert.equal(c.repetitions, 1);
  assert.equal(c.interval, 1);
  assert.equal(c.dueAt, at + DAY);
  assert.equal(c.correct, 1);
});

test('p12-03: a second good answer moves the interval to six days', () => {
  let c = S.freshCard('Abandon');
  c = S.schedule(c, GRADE.GOOD, 0);
  c = S.schedule(c, GRADE.GOOD, 0);
  assert.equal(c.repetitions, 2);
  assert.equal(c.interval, 6);
});

test('p12-04: hard grows slower than easy', () => {
  const build = grade => {
    let c = S.freshCard('x');
    c = S.schedule(c, GRADE.GOOD, 0);   // interval 1
    c = S.schedule(c, GRADE.GOOD, 0);   // interval 6
    return S.schedule(c, grade, 0);     // third review differentiates
  };
  const hard = build(GRADE.HARD), easy = build(GRADE.EASY);
  assert.ok(easy.interval > hard.interval, `${easy.interval} should exceed ${hard.interval}`);
});

test('p12-05: Again resets the card and lowers ease but never below the floor', () => {
  let c = S.schedule(S.schedule(S.freshCard('x'), GRADE.GOOD, 0), GRADE.GOOD, 0);
  const before = c.ease;
  c = S.schedule(c, GRADE.AGAIN, 0);
  assert.equal(c.repetitions, 0);
  assert.equal(c.interval, 0);
  assert.equal(c.lapses, 1);
  assert.ok(c.ease < before);
  for (let i = 0; i < 20; i++) c = S.schedule(c, GRADE.AGAIN, 0);
  assert.ok(c.ease >= 1.3 - 1e-9, 'ease must stay at or above the floor');
});

test('p12-06: three lapses make a word a leech (weak)', () => {
  let c = S.freshCard('x');
  for (let i = 0; i < 3; i++) c = S.schedule(c, GRADE.AGAIN, 0);
  assert.ok(S.isLeech(c));
});

test('p12-07: a sustained good streak masters a word and raises strength', () => {
  let c = S.freshCard('x');
  for (let i = 0; i < 6; i++) c = S.schedule(c, GRADE.GOOD, 0);
  assert.ok(S.isMastered(c), `interval ${c.interval} should reach ${S.MASTERED_INTERVAL}`);
  assert.equal(S.strength(c), 100);
});

test('p12-08: due detection respects the clock', () => {
  const c = S.schedule(S.freshCard('x'), GRADE.GOOD, 0);
  assert.ok(!S.isDue(c, DAY - 1));
  assert.ok(S.isDue(c, DAY));
});

test('p12-09: schedule does not mutate the input card', () => {
  const c = S.freshCard('x');
  const snapshot = JSON.stringify(c);
  S.schedule(c, GRADE.GOOD, 0);
  assert.equal(JSON.stringify(c), snapshot);
});

test('p12-10: gradeFor maps correctness and speed hints', () => {
  assert.equal(S.gradeFor(false), GRADE.AGAIN);
  assert.equal(S.gradeFor(true), GRADE.GOOD);
  assert.equal(S.gradeFor(true, { easy: true }), GRADE.EASY);
  assert.equal(S.gradeFor(true, { hard: true }), GRADE.HARD);
});

test('p12-11: daily plan puts the most overdue card first', () => {
  const words = ['Alpha', 'Bravo', 'Charlie'];
  const states = {
    alpha: S.schedule(S.freshCard('Alpha'), GRADE.GOOD, 0),     // due at DAY
    bravo: S.schedule(S.schedule(S.freshCard('Bravo'), GRADE.GOOD, 0), GRADE.GOOD, 0), // due at 6*DAY
  };
  const plan = S.buildDailyPlan(words, states, { now: 10 * DAY, size: 10 });
  assert.equal(plan[0].key, 'alpha');
});

test('p12-12: daily plan includes unseen words and caps at size', () => {
  const words = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
  const plan = S.buildDailyPlan(words, {}, { now: 0, size: 3 });
  assert.equal(plan.length, 3);
});

test('p12-13: summarize counts due / learning / mastered', () => {
  const words = ['Alpha', 'Bravo', 'Charlie'];
  const states = {
    alpha: S.schedule(S.freshCard('Alpha'), GRADE.GOOD, 0),
    bravo: (() => { let c = S.freshCard('Bravo'); for (let i = 0; i < 6; i++) c = S.schedule(c, GRADE.GOOD, 0); return c; })(),
  };
  const s = S.summarize(words, states, DAY);
  assert.equal(s.total, 3);
  assert.equal(s.mastered, 1);
  assert.equal(s.learning, 1);
  assert.equal(s.due, 1);
});

test('p12-14: masteryByBucket groups words and reports percentages', () => {
  const records = [rec('Apple'), rec('Ant'), rec('Ball')];
  let a = S.freshCard('Apple'); for (let i = 0; i < 6; i++) a = S.schedule(a, GRADE.GOOD, 0);
  const rows = S.masteryByBucket(records, { apple: a });
  const A = rows.find(r => r.bucket === 'A');
  assert.equal(A.total, 2);
  assert.equal(A.mastered, 1);
  assert.equal(A.mastery, 50);
});

test('p12-15: a meaning question offers the real meaning as the correct option', () => {
  const pool = [rec('Alpha'), rec('Bravo'), rec('Charlie'), rec('Delta')];
  const q = S.buildQuestion(pool[0], pool, 'meaning', () => 0.1);
  assert.ok(q.options.length >= 2);
  const correct = q.options.filter(o => o.correct);
  assert.equal(correct.length, 1);
  assert.equal(correct[0].text, pool[0].meaning);
  assert.ok(q.options.length <= 4);
});

test('p12-16: checkAnswer grades the picked option index', () => {
  const pool = [rec('Alpha'), rec('Bravo'), rec('Charlie'), rec('Delta')];
  const q = S.buildQuestion(pool[0], pool, 'synonym', () => 0.1);
  const right = q.options.findIndex(o => o.correct);
  assert.equal(S.checkAnswer(q, right), true);
  assert.equal(S.checkAnswer(q, (right + 1) % q.options.length), false);
});
