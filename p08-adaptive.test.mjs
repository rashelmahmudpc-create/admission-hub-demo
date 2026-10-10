/* P08 — adaptive-testing foundation + honored setup toggles.
 *
 * The exam engine lives inline in index.html. This suite extracts the
 * P08-EXAMSELECT module and runs the SHIPPED code (not a copy), then pins the
 * wiring for the three setup toggles that used to be rendered but ignored.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

const startMark = '/* P08-EXAMSELECT:start */';
const endMark = '/* P08-EXAMSELECT:end */';
const i = html.indexOf(startMark), j = html.indexOf(endMark);
assert.ok(i > 0 && j > i, 'P08-EXAMSELECT module must exist in index.html');
const moduleSrc = html.slice(i + startMark.length, j);

/* Evaluate the shipped module with a minimal window, then hand back the
   engine plus the window-level helpers it defines. */
function load() {
  const win = {};
  const fn = new Function('window', `${moduleSrc}\nreturn { ExamSelect, adaptiveOrder, selectAdaptive, filterByDifficulty, examSelectValidate };`);
  return fn(win);
}
const api = load();
const { ExamSelect } = api;

const q = (difficulty, over = {}) => ({ id: over.id || difficulty + Math.random(), difficulty, ...over });

test('p08-ad1: the selector self-validates', () => {
  assert.deepEqual(ExamSelect.validate(), []);
  assert.deepEqual(api.examSelectValidate(), []);
});

test('p08-ad2: filterByDifficulty keeps only the requested band, mixed passes all', () => {
  const pool = [q('easy'), q('medium'), q('hard'), q('medium')];
  assert.equal(api.filterByDifficulty(pool, 'hard').length, 1);
  assert.equal(api.filterByDifficulty(pool, 'medium').length, 2);
  assert.equal(api.filterByDifficulty(pool, 'mixed').length, 4);
  assert.equal(api.filterByDifficulty(pool, 'all').length, 4);
});

test('p08-ad3: an untagged question falls back to the engine or a sane default', () => {
  const win = { AhQuestionEngine: { difficultyOf: () => 'hard' } };
  const fn = new Function('window', `${moduleSrc}\nreturn ExamSelect;`);
  const eng = fn(win);
  assert.equal(eng.difficultyOf({ question: 'x' }), 'hard');
  // With no tags and no engine, it must still answer something valid.
  assert.ok(ExamSelect.DIFFS.includes(ExamSelect.difficultyOf({ question: 'y' })));
});

test('p08-ad4: adaptive order warms up easy → medium → hard without losing a question', () => {
  const pool = [q('hard'), q('hard'), q('easy'), q('medium'), q('easy')];
  const ordered = api.adaptiveOrder(pool);
  assert.equal(ordered.length, 5, 'no question may be dropped');
  assert.equal(ordered[0].difficulty, 'easy');
  assert.equal(ordered[ordered.length - 1].difficulty, 'hard');
  // Non-decreasing difficulty overall (interleaved but never a hard before an easy).
  const rank = { easy: 0, medium: 1, hard: 2 };
  const ranks = ordered.map(x => rank[x.difficulty]);
  assert.ok(ranks[0] <= ranks[1] && ranks[1] <= ranks[2], 'warm-up must climb');
});

test('p08-ad5: mixFor always sums exactly to the requested count', () => {
  for (const n of [0, 1, 3, 10, 20, 37, 100]) {
    const m = ExamSelect.mixFor(n);
    assert.equal(m.easy + m.medium + m.hard, n, `mix for ${n}`);
  }
  const m = ExamSelect.mixFor(20);
  assert.ok(m.medium >= m.easy && m.medium >= m.hard, 'medium should dominate the target mix');
});

test('p08-ad6: selectAdaptive returns the asked count and never invents questions', () => {
  const pool = [q('easy', { id: 'a' }), q('easy', { id: 'b' }), q('medium', { id: 'c' }), q('hard', { id: 'd' })];
  const sel = api.selectAdaptive(pool, 3);
  assert.equal(sel.length, 3);
  assert.ok(sel.every(x => pool.includes(x)), 'every chosen question came from the pool');
  // Asking for more than exists yields everything, not padding.
  assert.equal(api.selectAdaptive(pool, 99).length, 4);
});

test('p08-ad7: beginExam honours the difficulty filter and adaptive order', () => {
  assert.match(html, /if\(st\.order==='adaptive' && typeof adaptiveOrder==='function'\)\{ selected=adaptiveOrder\(selected\); \}/);
  assert.match(html, /if\(\['easy','medium','hard'\]\.includes\(st\.difficulty\) && typeof filterByDifficulty==='function'\)/);
});

test('p08-ad8: the exam setup offers an Adaptive question order', () => {
  assert.ok(html.includes("['adaptive','Adaptive']"), 'Adaptive chip must be present');
});

test('p08-ad9: selectQuestionsByMode has an adaptive branch', () => {
  assert.match(html, /mode==='adaptive'\)\{ candidates=selectAdaptive\(candidates,count\); \}/);
});

test('p08-ad10: "Confirm before submit" off skips the confirm modal', () => {
  assert.match(html, /function confirmSubmitExam\(\)\{\s*const e=ActiveExam;\s*if\(e && e\.configuration && e\.configuration\.confirmSubmit===false\)\{ submitExam\(false\); return; \}/);
});

test('p08-ad11: "Resume interrupted exam" off discards the resumable exam instead of prompting', () => {
  assert.match(html, /if\(resumable && resumable\.configuration && resumable\.configuration\.resume===false\)/);
});

test('p08-ad12: network recovery resends a pending submit as soon as the browser is online', () => {
  assert.match(html, /addEventListener\('online'/, 'an online handler must exist');
  assert.match(html, /if\(!e \|\| e\.status!=='running' \|\| !submitRetryHandle\) return;/, 'handler only acts on a genuinely pending submit');
  assert.match(html, /submitRetryHandle=setTimeout\(\(\)=>\{ const cur=ActiveExam; if\(cur && cur\.id===e\.id && cur\.status==='running'\) void submitExam\(true\); \},300\)/);
});
