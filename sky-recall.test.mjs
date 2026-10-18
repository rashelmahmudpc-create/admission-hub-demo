// 🔔 Sky recall (owner plan step 2): when the chat opens, Sky reminds the
// student of recent mistakes and their weak topic by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRecall, sanitizeRecent, whenWord } from './sky-recall.mjs';
import { makeMemory, upsertMemory, KIND, SOURCE, MEMORY_VERSION } from './memory-engine.js';
import { agentRecall } from './ai-agent.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 18, 6, 0, 0);
const UID = 'account-sidratul';
const weak = (v, uid = UID, ts = NOW - DAY) => makeMemory({ kind: KIND.STUDIES, key: 'weak-topic', value: v, source: SOURCE.AI_INFERRED, confidence: 0.8, reason: 'r', ts }, uid);
const last = (v, ts) => makeMemory({ kind: KIND.STUDIES, key: 'last-topic', value: v, source: SOURCE.USER_STATED, confidence: 0.9, reason: 'সর্বশেষ আলোচনার বিষয়', ts }, UID);

test('nothing known → no reminder (the normal greeting stays)', () => {
  assert.equal(buildRecall({ records: [], stats: { exams: 0 }, recent: null, now: NOW }), null);
});

test('stated weak topic, no exams → "আগে বলেছিলে সমাসে দুর্বল — আজ সমাস দিয়ে শুরু করি?"', () => {
  const r = buildRecall({ records: [weak('সমাসে')], stats: { exams: 0 }, now: NOW });
  assert.match(r.line, /আগে বলেছিলে সমাসে দুর্বল — আজ সমাস দিয়ে শুরু করি\?/);
  assert.equal(r.chips[0].q, 'সমাস থেকে ৫টা প্রশ্নে কুইজ দাও');
});

test('yesterday\'s mistakes come first, weak topic second', () => {
  const r = buildRecall({ records: [weak('সমাসে')], stats: {}, recent: { mistakes: 5, since: NOW - DAY - 3600e3 }, now: NOW });
  assert.match(r.line, /^গতকাল থেকে ৫টা প্রশ্নে ভুল হয়েছে/);
  assert.match(r.line, /সমাসে দুর্বল/);
  assert.deepEqual(r.kinds, ['mistakes', 'weak-stated']);
  assert.equal(r.chips.length, 2);
});

test('a measured weak topic beats the stated one and shows its real accuracy', () => {
  const r = buildRecall({ records: [weak('সমাসে')], stats: { weakTopics: [{ name: 'ইংরেজি', accuracy: 40 }, { name: 'গণিত', accuracy: 30 }] }, now: NOW });
  assert.match(r.line, /গণিত-এ সঠিকতা এখন ৩০%/);
  assert.doesNotMatch(r.line, /সমাস/);
});

test('last topic is used only when nothing else, and only within 7 days', () => {
  const fresh = buildRecall({ records: [last('নিউটনের সূত্র', NOW - DAY)], now: NOW });
  assert.match(fresh.line, /গতকাল আমরা “নিউটনের সূত্র” নিয়ে কথা বলছিলাম/);
  assert.equal(buildRecall({ records: [last('নিউটনের সূত্র', NOW - 9 * DAY)], now: NOW }), null);
});

test('client numbers are clamped; junk is ignored', () => {
  assert.deepEqual(sanitizeRecent({ mistakes: 1e9, since: 'x' }), { mistakes: 999, since: 0 });
  assert.equal(sanitizeRecent('x'), null);
  assert.equal(whenWord(NOW, NOW), 'আজ');
  assert.equal(whenWord(NOW - 3 * DAY, NOW), '৩ দিন আগে');
});

function fakeEnv(store) {
  return { PUB_KV: { get: async (k) => (k in store ? store[k] : null), put: async () => {}, delete: async () => {} } };
}
const req = (body) => new Request('https://x/api/ai/recall', { method: 'POST', body: JSON.stringify(body || {}) });

test('endpoint: a student sees only their own memory', async () => {
  const store = { ['mem:' + MEMORY_VERSION + ':account-a']: JSON.stringify(upsertMemory([], weak('সমাসে', 'account-a'), 'account-a')) };
  const a = await (await agentRecall(req({ stats: { exams: 0 } }), fakeEnv(store), 'account-a')).json();
  assert.match(a.recall.line, /সমাসে/);
  const b = await (await agentRecall(req({ stats: { exams: 0 } }), fakeEnv(store), 'account-b')).json();
  assert.equal(b.recall, null);
});

test('endpoint: guests get nothing; the kill switch turns it off', async () => {
  const g = await (await agentRecall(req({}), fakeEnv({}), 'guest-1')).json();
  assert.equal(g.recall, null);
  const store = { 'sky:recall': 'off', ['mem:' + MEMORY_VERSION + ':account-a']: JSON.stringify([weak('সমাসে', 'account-a')]) };
  const o = await (await agentRecall(req({}), fakeEnv(store), 'account-a')).json();
  assert.equal(o.recall, null);
  assert.equal(o.off, true);
});

test('wiring: route, client call, no question text leaves the phone', () => {
  const pub = readFileSync(new URL('./public-worker.js', import.meta.url), 'utf8');
  assert.ok(pub.includes("path === '/api/ai/recall' && request.method === 'POST'"));
  const ui = readFileSync(new URL('./ai-agent-chat.js', import.meta.url), 'utf8');
  assert.ok(ui.includes("fetch('/api/ai/recall'"));
  assert.ok(ui.includes('loadRecall();'));
  assert.ok(ui.includes("return { mistakes: n, since: since };"));
  assert.ok(ui.includes("box.innerHTML = '<p>' + esc(String(rc.line))"), 'recall text must be escaped');
});
