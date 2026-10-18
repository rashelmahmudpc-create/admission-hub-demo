// 🔁 Sky step 3 (owner 2026-10-18): a quiz from the student's OWN recent mistakes.
// Real questions from CACHE.mistakes on the phone; no AI call, nothing invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildRecall } from './sky-recall.mjs';

const require = createRequire(import.meta.url);
const NOW = Date.UTC(2026, 9, 18, 6, 0, 0);
const H = 3600e3;
const mk = (i, extra = {}) => ({ id: 'm' + i, questionId: 'q' + i, question: 'ভুল প্রশ্ন ' + i, options: ['অ', 'আ', 'ই', 'ঈ'], correctAnswerIndex: i % 4, explanation: 'কারণ ' + i, lastWrongAt: NOW - i * H, mastered: false, ...extra });
globalThis.CACHE = {
  topics: [], subjects: [],
  questions: [{ id: 'q50', question: 'ব্যাংকের প্রশ্ন', options: ['ক১', 'খ১', 'গ১'], answer: 2, explanation: 'ব্যাংকের ব্যাখ্যা' }],
  mistakes: [mk(3), mk(1), mk(2, { mastered: true }), mk(4, { revisionStatus: 'mastered' }), mk(5), mk(6), mk(7), mk(8),
    { id: 'm50', questionId: 'q50', lastWrongAt: NOW - 30 * H }, { id: 'bad', questionId: 'none', question: 'অর্ধেক', options: ['x'] }]
};
require('./sky-tools-client.js');
const S = globalThis.SkyTools;
const Q = 'আমার ভুলগুলো থেকে ৫টা প্রশ্নে কুইজ দাও';
const card = (r) => JSON.parse(r.text);

test('the reminder button text runs the mistake quiz tool, in the app', () => {
  const r = S.run(Q, {});
  assert.equal(r.tools[0], 'mistake_quiz');
  assert.equal(r.quiz.length, 5);
  assert.equal(card(r).questions.length, 5);
});

test('newest mistakes first; mastered ones are skipped', () => {
  const qs = card(S.run(Q, {})).questions.map((x) => x.q);
  assert.deepEqual(qs, ['ভুল প্রশ্ন 1', 'ভুল প্রশ্ন 3', 'ভুল প্রশ্ন 5', 'ভুল প্রশ্ন 6', 'ভুল প্রশ্ন 7']);
  assert.ok(!qs.includes('ভুল প্রশ্ন 2') && !qs.includes('ভুল প্রশ্ন 4'));
});

test('real answers and explanations; the card shape the chat already renders', () => {
  const r = S.run('ভুলগুলো থেকে ২০টা কুইজ দাও', {});
  const c = card(r);
  assert.match(r.text, /^\{"title"/);
  const one = c.questions.find((x) => x.q === 'ভুল প্রশ্ন 3');
  assert.equal(one.answer, 3);
  assert.equal(one.explanation, 'কারণ 3');
  const bank = c.questions.find((x) => x.q === 'ব্যাংকের প্রশ্ন');
  assert.ok(bank, 'a mistake without its own text is filled from the question bank');
  assert.equal(bank.answer, 2);
  assert.equal(c.questions.length, 7, 'a broken record (1 option) is dropped');
  assert.ok(r.quiz.every((x, i) => x.a === c.questions[i].answer));
});

test('no mistakes → honest message + Mistake Bank button, never the AI', () => {
  const keep = globalThis.CACHE.mistakes;
  globalThis.CACHE.mistakes = [mk(1, { mastered: true })];
  const r = S.run(Q, {});
  globalThis.CACHE.mistakes = keep;
  assert.match(r.text, /কোনো প্রশ্ন নেই/);
  assert.equal(r.go, 'mistakes-bank');
});

test('ordinary questions are not taken by this tool', () => {
  for (const t of ['আমি কোথায় ভুল করছি?', 'ভুল কেন হয়?', 'নেকলেস কুইজ দাও', 'সমাস কী']) {
    const r = S.run(t, {});
    assert.ok(!r || r.tools[0] !== 'mistake_quiz', t);
  }
});

test('the chat-open reminder offers this quiz (not just a page link)', () => {
  const r = buildRecall({ records: [], stats: {}, recent: { mistakes: 3, since: NOW - 2 * H }, now: NOW });
  assert.equal(r.chips[0].q, Q);
  assert.equal(S.run(r.chips[0].q, {}).tools[0], 'mistake_quiz');
});

test('small talk and shared answers do not intercept the button text', async () => {
  const bank = JSON.parse(readFileSync(new URL('./sky-replies.json', import.meta.url), 'utf8'));
  require('./sky-smalltalk.js');
  require('./sky-faq.js');
  const ST = globalThis.SkySmallTalk, F = globalThis.SkyFAQ;
  assert.equal(ST.load(bank), true, 'the 896-reply bank loads');
  assert.ok(ST.kind('ধন্যবাদ'), 'bank answers small talk');
  const st = ST && (ST.replyMsg ? ST.replyMsg(Q, '') : ST.reply(Q, ''));
  assert.ok(!st, 'small talk must not answer it');
  assert.ok(!(F && F.match && F.match(Q)), 'shared answers must not answer it');
});

test('read-only: the tool file never writes or calls the network', () => {
  const s = readFileSync(new URL('./sky-tools-client.js', import.meta.url), 'utf8');
  assert.ok(!/dbPut|dbDel|localStorage\.setItem|fetch\(/.test(s));
});
