// 🧠 P06 — PERSONAL AI TUTOR (server-side contract)
// (১) personalisation: the student's weak topics reach the prompt, sanitized.
// (২) recommendation: a deterministic revision line from the student's own data.
// (৩) memory: the last discussed topic is remembered across sessions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { capStats, buildSystemPrompt, buildStudyRecommendation } from './ai-agent.js';
import { renderContext, buildContext } from './context-engine.js';
import { makeMemory, upsertMemory, parseMemory, renderMemory, KIND, SOURCE, MEMORY_VERSION } from './memory-engine.js';

const SRC = readFileSync(new URL('./ai-agent.js', import.meta.url), 'utf8');

/* ── ১. Personalisation: weak topics are sanitized and reach the prompt ── */
test('capStats keeps well-formed weak topics and clamps their numbers', () => {
  const s = capStats({
    exams: 4, accuracy: 61,
    weakTopics: [{ name: 'তর্কবিজ্ঞান', attempts: 9, accuracy: 44 }, { name: 'বাংলা', attempts: 5, accuracy: 99.6 }]
  });
  assert.equal(s.weakTopics.length, 2);
  assert.equal(s.weakTopics[0].name, 'তর্কবিজ্ঞান');
  assert.equal(s.weakTopics[0].accuracy, 44);
  assert.equal(s.weakTopics[1].accuracy, 100, 'accuracy must clamp at 100');
});

test('capStats drops empty, duplicate, malformed and PII-bearing topic rows', () => {
  const s = capStats({
    weakTopics: [
      { name: '  ', attempts: 5, accuracy: 10 },               // empty
      { name: 'গণিত', attempts: 5, accuracy: 40 },
      { name: 'গণিত', attempts: 5, accuracy: 40 },             // duplicate
      { name: 'user@mail.com', attempts: 5, accuracy: 40 },    // PII
      null                                                    // malformed
    ]
  });
  assert.equal(s.weakTopics.length, 1);
  assert.equal(s.weakTopics[0].name, 'গণিত');
});

test('capStats returns null when no topic row survives (never a fabricated one)', () => {
  assert.equal(capStats({ weakTopics: [{ name: '' }] }), null);
  assert.equal(capStats({ exams: 3 }).weakTopics, undefined);
});

test('the system prompt carries the weak topics and the no-invention rule', () => {
  const p = buildSystemPrompt({ stats: { exams: 4, accuracy: 61, weakTopics: [{ name: 'তর্কবিজ্ঞান', attempts: 9, accuracy: 44 }] } });
  assert.match(p, /LEARNING PROFILE/);
  assert.match(p, /তর্কবিজ্ঞান \(44%, 9টা\)/);
  assert.match(p, /সংখ্যা কখনো বানাবে না/);
});

test('the context engine renders weak-topic pills only when stats are present', () => {
  const withStats = renderContext(buildContext({ uid: 'account-1', stats: { accuracy: 61, weakTopics: [{ name: 'পদার্থ', attempts: 6, accuracy: 50 }] }, memoryOn: true }));
  assert.match(withStats, /weak topics: পদার্থ 50%/);
  const without = renderContext(buildContext({ uid: 'account-1', stats: { accuracy: 61 }, memoryOn: true }));
  assert.doesNotMatch(without, /weak topics/);
});

/* ── ২. Recommendation: deterministic, grounded in the student's data ── */
test('buildStudyRecommendation names the weakest topics and gives one next step', () => {
  const rec = buildStudyRecommendation({ weakTopics: [{ name: 'রসায়ন', attempts: 8, accuracy: 33 }] });
  assert.match(rec, /রসায়ন \(33%\)/);
  assert.match(rec, /রিভিশনে/);
});

test('buildStudyRecommendation returns null with no measured weak topic', () => {
  assert.equal(buildStudyRecommendation({ exams: 3, accuracy: 90 }), null);
  assert.equal(buildStudyRecommendation(null), null);
  assert.equal(buildStudyRecommendation({ weakTopics: [] }), null);
});

test('buildStudyRecommendation follows the student language preference', () => {
  const rec = buildStudyRecommendation({ weakTopics: [{ name: 'Math', attempts: 5, accuracy: 40 }] }, { langStyle: 'en' });
  assert.match(rec, /^Your revision priority/);
});

test('the prompt offers the recommendation rather than forcing it', () => {
  const p = buildSystemPrompt({ stats: { weakTopics: [{ name: 'ইংরেজি', attempts: 5, accuracy: 40 }] } });
  assert.match(p, /STUDY RECOMMENDATION/);
  assert.match(p, /ইংরেজি \(40%\)/);
});

/* ── ৩. Memory: the last discussed topic survives into a new session ── */
test('a stored last-topic record renders under long-term memory', () => {
  const record = makeMemory({ kind: KIND.STUDIES, key: 'last-topic', value: 'নিউটনের সূত্র', source: SOURCE.USER_STATED, confidence: 0.9, reason: 'সর্বশেষ আলোচনার বিষয়' }, 'account-42');
  assert.ok(record, 'a valid last-topic record must build');
  const text = renderMemory([record], MEMORY_VERSION);
  assert.match(text, /নিউটনের সূত্র/);
});

test('a last-topic record is owner-scoped, never leaked to another student', () => {
  const record = makeMemory({ kind: KIND.STUDIES, key: 'last-topic', value: 'জীববিজ্ঞান', source: SOURCE.USER_STATED, confidence: 0.9, reason: 'সর্বশেষ আলোচনার বিষয়' }, 'account-1');
  const stored = JSON.stringify([record]);
  assert.equal(parseMemory(stored, 'account-2').length, 0, 'another account must not read it');
  assert.equal(parseMemory(stored, 'account-1').length, 1);
});

test('upsertMemory replaces (not duplicates) the last-topic for one owner', () => {
  let list = upsertMemory([], makeMemory({ kind: KIND.STUDIES, key: 'last-topic', value: 'পদার্থ', source: SOURCE.USER_STATED, confidence: 0.9, reason: 'r' }, 'account-1'), 'account-1');
  list = upsertMemory(list, makeMemory({ kind: KIND.STUDIES, key: 'last-topic', value: 'রসায়ন', source: SOURCE.USER_STATED, confidence: 0.9, reason: 'r' }, 'account-1'), 'account-1');
  const topics = list.filter(r => r.key === 'last-topic');
  assert.equal(topics.length, 1);
  assert.equal(topics[0].value, 'রসায়ন');
});

test('a rejection of the client-side weak-topic computation would break this contract', () => {
  // Guards the load-bearing client side: stats must carry learningProfile output.
  const client = readFileSync(new URL('./ai-agent-chat.js', import.meta.url), 'utf8');
  assert.match(client, /const learningProfile = /);
  assert.match(client, /weakTopics: lp\.weakTopics, subjects: lp\.subjects/);
});

test('agentChat persists the discussed topic for the next session', () => {
  assert.match(SRC, /key: 'last-topic'/);
  assert.match(SRC, /memKey/, 'the memory key must be computed once');
});
