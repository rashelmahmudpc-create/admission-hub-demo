/* P10 — Smart Mistake & Revision engine.
 * Runs the SHIPPED module (not a copy) against synthetic wrong answers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./mistake-engine.js', import.meta.url), 'utf8');
const fakeSelf = {};
const M = new Function('self', `${src}\nreturn self.AhMistakeEngine;`)(fakeSelf);

const snap = (over = {}) => ({
  status: 'wrong', questionId: 'q1', options: ['H2O', 'CO2', 'O2', 'NaCl'],
  selectedIndex: 1, correctAnswerIndex: 0, timing: { seconds: 60 }, ...over
});

test('p10e-01: a correct or skipped answer is never labelled a mistake', () => {
  assert.equal(M.categorize({ snapshot: snap({ status: 'correct' }) }), null);
  assert.equal(M.categorize({ snapshot: snap({ status: 'skipped' }) }), null);
});

test('p10e-02: a wrong answer on an easy question, answered fast, is careless', () => {
  const r = M.categorize({ snapshot: snap({ timing: { seconds: 5 } }), difficulty: 'easy' });
  assert.equal(r.category, M.CATEGORY.CARELESS);
});

test('p10e-03: a wrong answer that took very long is time pressure', () => {
  const r = M.categorize({ snapshot: snap({ timing: { seconds: 200 } }), difficulty: 'hard' });
  assert.equal(r.category, M.CATEGORY.TIME);
});

test('p10e-04: a wrong factual answer is a memory slip', () => {
  const r = M.categorize({ snapshot: snap({ timing: { seconds: 60 } }), difficulty: 'hard', question: { type: 'factual' } });
  assert.equal(r.category, M.CATEGORY.MEMORY);
});

test('p10e-05: a wrong answer between similar-looking options is confusion', () => {
  const r = M.categorize({ snapshot: snap({ options: ['H2O', 'H2O2', 'O2', 'NaCl'], selectedIndex: 1, timing: { seconds: 60 } }), difficulty: 'hard' });
  assert.equal(r.category, M.CATEGORY.CONFUSION);
});

test('p10e-06: a reopened mistake — wrong more than once — is repeated', () => {
  const r = M.categorize({ snapshot: snap(), record: { wrongCount: 3 } });
  assert.equal(r.category, M.CATEGORY.REPEATED);
  assert.equal(r.wrongCount, 3);
});

test('p10e-07: isRepeated fires at two wrong answers, not at one', () => {
  assert.equal(M.isRepeated({ wrongCount: 1 }), false);
  assert.equal(M.isRepeated({ wrongCount: 2 }), true);
  assert.equal(M.isRepeated({}), false);
});

test('p10e-08: the priority ladder climbs critical -> high -> medium and bottoms at mastered', () => {
  assert.equal(M.priorityTier({ wrongCount: 1, revisionStatus: 'pending' }), M.TIER.MEDIUM);
  assert.equal(M.priorityTier({ wrongCount: 2, revisionStatus: 'pending' }), M.TIER.HIGH);
  assert.equal(M.priorityTier({ wrongCount: 4, revisionStatus: 'pending' }), M.TIER.CRITICAL);
  assert.equal(M.priorityTier({ wrongCount: 9, revisionStatus: 'mastered' }), M.TIER.MASTERED);
  assert.equal(M.priorityTier({ wrongCount: 9, mastered: true }), M.TIER.MASTERED);
});

test('p10e-09: a very low accuracy on a frequently-seen question is critical', () => {
  assert.equal(M.priorityTier({ wrongCount: 1, attempts: 10, correct: 3 }), M.TIER.CRITICAL);
});

test('p10e-10: two correct revisions in a row mark the mistake mastered', () => {
  const first = M.nextRevisionState({ correctAfterMistake: 0, revisionCount: 0 }, { correct: true, at: 1000 });
  assert.equal(first.mastered, false);
  assert.equal(first.status, 'IMPROVING');
  assert.equal(first.revisionStatus, 'pending');
  const second = M.nextRevisionState(first, { correct: true, at: 2000 });
  assert.equal(second.mastered, true);
  assert.equal(second.revisionStatus, 'mastered');
  assert.equal(second.status, 'RESOLVED');
  assert.equal(second.masteredAt, 2000);
});

test('p10e-11: a fresh miss puts a mastered mistake straight back to pending', () => {
  const missed = M.nextRevisionState({ correctAfterMistake: 2, mastered: true, revisionCount: 4 }, { correct: false, at: 3000 });
  assert.equal(missed.mastered, false);
  assert.equal(missed.revisionStatus, 'pending');
  assert.equal(missed.correctAfterMistake, 0);
  assert.equal(missed.status, 'UNRESOLVED');
  assert.equal(missed.masteredAt, null);
});

test('p10e-12: nextRevisionState keeps an earlier masteredAt once mastered', () => {
  const s = M.nextRevisionState({ correctAfterMistake: 1, masteredAt: 500 }, { correct: true, at: 9000 });
  assert.equal(s.mastered, true);
  assert.equal(s.masteredAt, 500, 'the first mastered timestamp is preserved');
});

test('p10e-13: every category and tier has a Bengali label', () => {
  for (const c of Object.values(M.CATEGORY)) assert.ok(M.label(c), `missing label for ${c}`);
  for (const t of Object.values(M.TIER)) assert.ok(M.tierLabel(t), `missing label for ${t}`);
});

/* ---- wiring: the engine ships and its consumers actually use it ---- */
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
const bank = readFileSync(new URL('./mistakes-bank-tool.js', import.meta.url), 'utf8');
const analysis = readFileSync(new URL('./mistake-analysis.js', import.meta.url), 'utf8');
const smart = readFileSync(new URL('./smart-revision-tool.js', import.meta.url), 'utf8');

test('p10e-14: the engine is loaded and precached', () => {
  assert.match(html, /mistake-engine\.js\?v=p10-v1/);
  assert.match(sw, /'\.\/mistake-engine\.js\?v=p10-v1'/);
});

test('p10e-15: the bank tool labels every row with the engine tier and repeat flag', () => {
  assert.ok(bank.includes('AhMistakeEngine'), 'bank must read the engine');
  assert.ok(bank.includes('priorityTier') && bank.includes('isRepeated'));
  assert.ok(bank.includes('nextRevisionState'), 'mastered transition must come from the engine');
  assert.ok(bank.includes('mistake-repeat'), 'the repeated flag must be rendered');
});

test('p10e-16: the analysis card and revision reason carry the engine category/tier', () => {
  assert.ok(analysis.includes('AhMistakeEngine') && analysis.includes('mistakeCategory'));
  assert.ok(smart.includes('AhMistakeEngine') && smart.includes('tierLabel'));
});
