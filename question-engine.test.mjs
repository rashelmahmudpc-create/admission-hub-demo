/* P07 — Intelligent Question Engine (question-engine.js).
 *
 * Loads the BROWSER build the way the app does (window/self UMD), not a
 * re-implementation, so the tested code is the shipped code. Pins the contract
 * the bank depends on: correct tagging, honest quality scoring, deterministic
 * duplicate clusters, and a single-pass analyser that stays cheap on big banks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./question-engine.js', import.meta.url), 'utf8');
const fakeSelf = {};
const QE = new Function('self', 'module', 'window', `${src}\nreturn self.AhQuestionEngine;`)(fakeSelf, undefined, undefined);

const Q = (over = {}) => ({
  id: over.id || 'q1',
  subjectId: 's1', topicId: 't1', topicName: over.topicName || 'রসায়ন',
  question: over.question || 'পানির রাসায়নিক সংকেত কী?',
  options: over.options || ['H2O', 'CO2', 'O2', 'NaCl'],
  answer: over.answer != null ? over.answer : 0,
  explanation: over.explanation != null ? over.explanation : 'পানির সংকেত H2O, কারণ এতে দুইটি হাইড্রোজেন ও একটি অক্সিজেন আছে।',
  stats: over.stats,
  difficulty: over.difficulty,
});

test('qe1: the engine is versioned and self-validates', () => {
  assert.equal(QE.ENGINE_VERSION, 'qe1');
  assert.deepEqual(QE.validate(), []);
});

test('qe2: normalisation folds punctuation, case and Bengali danda', () => {
  const a = QE.normalizeText('পানির সংকেত কী?');
  const b = QE.normalizeText('  পানির   সংকেত কী । ');
  assert.equal(a, b);
  assert.equal(QE.normalizeText('A:B,C!'), 'a b c');
});

test('qe3: similarity is 1 for identical, 0 for disjoint, blended otherwise', () => {
  assert.equal(QE.similarity('রাসায়নিক সংকেত কী', 'রাসায়নিক সংকেত কী'), 1);
  assert.equal(QE.similarity('ক আ', 'খ গ'), 0);
  const near = QE.similarity('পানির রাসায়নিক সংকেত কী?', 'পানির রাসায়নিক সংকেত কোনটি?');
  assert.ok(near > 0.6 && near < 1, `near reword should be high, got ${near}`);
});

test('qe4: difficulty blends intrinsic cues and observed accuracy', () => {
  const shortQ = Q({ question: 'কোনটি সংখ্যা?', options: ['১', 'ক', 'খ', 'গ'] });
  const longQ = Q({
    question: 'নিচের কোনটি একটি জটিল সংখ্যার উদাহরণ এবং কেন সেটি বাস্তব নয়, ব্যাখ্যা করো?',
    options: ['২+৩i', '৫', '৭', '১১'],
  });
  assert.ok(['easy', 'medium', 'hard'].includes(QE.difficultyOf(shortQ)));
  // A long conceptual stem must score harder than a one-word factual one.
  assert.ok(QE.difficultyScore(longQ) > QE.difficultyScore(shortQ),
    `${QE.difficultyScore(longQ)} should exceed ${QE.difficultyScore(shortQ)}`);
});

test('qe5: observed student accuracy overrides the length heuristic', () => {
  const hardByData = Q({ stats: { attempts: 20, correct: 2, wrong: 18 } });
  const easyByData = Q({ stats: { attempts: 20, correct: 19, wrong: 1 } });
  assert.equal(QE.difficultyOf(hardByData), 'hard');
  assert.equal(QE.difficultyOf(easyByData), 'easy');
});

test('qe6: type detection separates factual, conceptual, numerical and application', () => {
  assert.equal(QE.typeOf(Q({ question: 'পানির সংকেত কী?' })), 'factual');
  assert.equal(QE.typeOf(Q({ question: 'কেন লোহা মরিচা ধরে?', options: ['ক', 'খ', 'গ', 'ঘ'] })), 'conceptual');
  assert.equal(QE.typeOf(Q({ question: '২ + ৩ এর মান কত?', options: ['৫', '৪', '৬', '৭'] })), 'numerical');
  assert.equal(QE.typeOf(Q({ question: 'নিচের কোন ক্ষেত্রে নিউটনের সূত্র প্রযোজ্য?', options: ['ক', 'খ', 'গ', 'ঘ'] })), 'application');
});

test('qe7: expected time follows difficulty in the documented bands', () => {
  const easy = QE.expectedTime({ question: 'কোনটি সংখ্যা?', options: ['১', 'ক', 'খ', 'গ'], difficulty: 'easy' });
  const hard = QE.expectedTime({ question: 'নিচের কোনটি একটি জটিল সংখ্যার উদাহরণ এবং কেন?', options: ['২+৩i', '৫', '৭', '১১'], difficulty: 'hard' });
  assert.equal(easy, 35);
  assert.equal(hard, 85);
});

test('qe8: an explanation that never names the correct option is flagged', () => {
  const good = QE.explanationScore(Q());
  assert.ok(good.score >= 80, `good explanation should score well, got ${good.score}`);
  const bad = QE.explanationScore(Q({ explanation: 'এটা মনে রাখো।' }));
  assert.ok(bad.issues.includes('explanation does not reference the correct option'));
  assert.equal(QE.explanationScore(Q({ explanation: '' })).issues[0], 'missing explanation');
});

test('qe9: answer-consistency catches the mistakes that make a question unanswerable', () => {
  assert.deepEqual(QE.consistencyIssues(Q()), []);
  assert.ok(QE.consistencyIssues(Q({ options: ['ক', 'খ'], answer: 0 })).includes('option count is not four'));
  assert.ok(QE.consistencyIssues(Q({ answer: 9 })).includes('answer key is out of range'));
  assert.ok(QE.consistencyIssues(Q({ options: ['ক', 'খ', 'ক', 'ঘ'] })).includes('duplicate options'));
  assert.ok(QE.consistencyIssues(Q({ options: ['ক', '', 'গ', 'ঘ'] })).includes('an option is empty'));
});

test('qe10: scoreQuestion folds consistency plus explanation into one number', () => {
  assert.equal(QE.scoreQuestion(Q()).score, 100);
  const broken = QE.scoreQuestion(Q({ options: ['ক', 'খ'], answer: 5, explanation: '' }));
  assert.ok(broken.score < 60);
  assert.ok(broken.issues.length >= 2);
});

test('qe11: tagQuestion is additive and never mutates the input', () => {
  const input = Q();
  const frozen = JSON.stringify(input);
  const tagged = QE.tagQuestion(input);
  assert.equal(JSON.stringify(input), frozen, 'input must not change');
  assert.notEqual(tagged, input);
  assert.equal(tagged.taggedBy, 'qe1');
  for (const field of ['difficulty', 'type', 'concept', 'expectedTime', 'quality']) {
    assert.ok(tagged[field] !== undefined, `missing ${field}`);
  }
});

test('qe12: concept tagging groups by topic plus salient idea', () => {
  const a = QE.conceptOf(Q({ subjectId: 's', topicId: 't', topicName: 'গণিত', question: 'ত্রিভুজের ক্ষেত্রফল কী?' }));
  const b = QE.conceptOf(Q({ subjectId: 's', topicId: 't', topicName: 'গণিত', question: 'ত্রিভুজের পরিসীমা কী?' }));
  assert.match(a, /^গণিত:/);
  assert.match(b, /^গণিত:/);
  assert.notEqual(a, b);
  assert.equal(QE.conceptOf({ topicId: 'x', question: 'কী?' }), 'x');
});

test('qe13: duplicate detection finds exact and near-duplicate clusters, ignores the rest', () => {
  const bank = [
    Q({ id: 'a', question: 'পানির রাসায়নিক সংকেত কী?' }),
    Q({ id: 'b', question: 'পানির রাসায়নিক সংকেত কোনটি?' }),  // near
    Q({ id: 'c', question: 'পানির রাসায়নিক সংকেত কী?', options: ['CO2', 'H2O', 'O2', 'NaCl'] }), // exact text
    Q({ id: 'd', question: 'মুক্তিযুদ্ধ কত সালে হয়েছিল?' }),
  ];
  const clusters = QE.findDuplicates(bank, { threshold: 0.8 });
  assert.equal(clusters.length, 1, JSON.stringify(clusters));
  assert.deepEqual([...clusters[0].ids].sort(), ['a', 'b', 'c']);
  assert.equal(clusters[0].count, 3);
  assert.equal(clusters[0].exact, false);
});

test('qe14: an all-distinct bank yields no duplicate clusters', () => {
  const bank = [
    Q({ id: 'a', question: 'পানির রাসায়নিক সংকেত কী?' }),
    Q({ id: 'b', question: 'মুক্তিযুদ্ধ কত সালে হয়েছিল?' }),
    Q({ id: 'c', question: 'নিউটনের দ্বিতীয় সূত্র কী?' }),
    Q({ id: 'd', question: 'বাংলাদেশের রাজধানীর নাম কী?' }),
  ];
  assert.deepEqual(QE.findDuplicates(bank, { threshold: 0.8 }), []);
});

test('qe15: analyzeBank reports the full picture in one pass', () => {
  const bank = [
    Q({ id: 'a' }),
    Q({ id: 'b', question: 'মুক্তিযুদ্ধ কত সালে হয়েছিল?', explanation: '' }),
    Q({ id: 'c', question: 'পনির রাসায়নিক সংকেত কী?', options: ['ক', 'খ'], answer: 5 }),
  ];
  const report = QE.analyzeBank(bank);
  assert.equal(report.total, 3);
  assert.equal(report.missingExplanation, 1);
  assert.equal(report.inconsistent, 1);
  assert.equal(report.untagged, 3);
  assert.ok(report.avgQuality > 0 && report.avgQuality < 100);
  assert.equal(report.byDifficulty.easy + report.byDifficulty.medium + report.byDifficulty.hard, 3);
});

test('qe16: the analyser stays tractable on a large bank (blocking works)', () => {
  const big = [];
  for (let i = 0; i < 4000; i++) {
    big.push(Q({ id: `q${i}`, question: `প্রশ্ন সংখ্যা ${i} — বিষয় ${i % 7}`, options: [`${i}`, `${i + 1}`, `${i + 2}`, `${i + 3}`] }));
  }
  const started = Date.now();
  const report = QE.analyzeBank(big);
  const took = Date.now() - started;
  assert.equal(report.total, 4000);
  assert.ok(took < 4000, `analyzeBank took ${took}ms; blocking must keep it cheap`);
});

test('qe17: applyTags returns tagged copies in order, leaving originals intact', () => {
  const bank = [Q({ id: 'a' }), Q({ id: 'b' })];
  const out = QE.applyTags(bank);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'a');
  assert.equal(out[1].id, 'b');
  assert.equal(bank[0].taggedBy, undefined);
});

/* ── The analysis panel: load the shipped IIFE against a DOM stub ─────────── */

const panelSrc = readFileSync(new URL('./question-engine-panel.js', import.meta.url), 'utf8');

function runPanel({ questions, dbPut }) {
  const nodes = new Map();
  const mkEl = (tag) => ({
    tagName: tag, id: '', className: '', innerHTML: '', style: {}, children: [],
    appendChild(c) { this.children.push(c); if (c.id) nodes.set(c.id, c); return c; },
    remove() { if (this.id) nodes.delete(this.id); },
  });
  const head = mkEl('head');
  const documentStub = {
    body: mkEl('body'),
    head,
    getElementById: (id) => nodes.get(id) || null,
    createElement: (tag) => mkEl(tag),
  };
  const toasts = [];
  const win = {
    document: documentStub,
    CACHE: { questions },
    dbGetAll: async () => questions,
    dbPut,
    confirm: () => true,
    toast: (m) => toasts.push(m),
  };
  win.self = win; win.window = win; win.AhQuestionEngine = QE;
  const fn = new Function('self', 'window', 'document', 'CACHE', 'dbGetAll', 'dbPut', 'confirm', 'toast',
    `${panelSrc}\nreturn { open: self.openQuestionEnginePanel, tagAll: self.tagAllQuestions, close: self.closeQuestionEnginePanel };`);
  const api = fn(win, win, documentStub, win.CACHE, win.dbGetAll, dbPut, win.confirm, win.toast);
  return { api, nodes, toasts, documentStub };
}

test('qe18: the panel renders the bank analysis into the sheet', () => {
  const bank = [Q({ id: 'a' }), Q({ id: 'b', question: 'পানির রাসায়নিক সংকেত কোনটি?' })];
  const { api, nodes } = runPanel({ questions: bank, dbPut: async () => {} });
  api.open();
  const panel = nodes.get('qePanel');
  assert.ok(panel, 'the panel element must be created');
  assert.match(panel.innerHTML, /Question Engine/);
  assert.match(panel.innerHTML, /গড় কোয়ালিটি/);
  assert.match(panel.innerHTML, /2×|ডুপ্লিকেট/, 'the shared cluster must surface');
});

test('qe19: tagging writes only changed records through dbPut and reports a count', async () => {
  const bank = [Q({ id: 'a' }), Q({ id: 'b' })];
  const written = [];
  const { api, toasts } = runPanel({ questions: bank, dbPut: async (store, rec) => { written.push([store, rec]); } });
  await api.tagAll();
  assert.ok(written.length >= 2, `expected writes, got ${written.length}`);
  assert.ok(written.every(([store]) => store === 'questions'));
  assert.ok(written.every(([, rec]) => rec.taggedBy === 'qe1'));
  assert.ok(toasts.some(m => /ট্যাগ বসানো হয়েছে/.test(m)));
});

test('qe21: new questions are auto-tagged at every save path', () => {
  const parser = readFileSync(new URL('./phase2-dictionary-parser.js', import.meta.url), 'utf8');
  const suite = readFileSync(new URL('./admission-hub-feature-suite.js', import.meta.url), 'utf8');
  assert.match(parser, /saveQuestionRow[\s\S]*AhQuestionEngine\?\.tagQuestion/, 'parser save must tag');
  assert.match(suite, /AhQuestionEngine\?\.tagQuestion/, 'manual add/edit must tag');
});

test('qe20: a second tagging pass is a no-op (tags are idempotent)', async () => {
  // Start from already-tagged questions.
  const bank = [QE.tagQuestion(Q({ id: 'a' })), QE.tagQuestion(Q({ id: 'b' }))];
  const written = [];
  const { api } = runPanel({ questions: bank, dbPut: async (store, rec) => { written.push(rec); } });
  await api.tagAll();
  assert.equal(written.length, 0, 'nothing changed → nothing written');
});
