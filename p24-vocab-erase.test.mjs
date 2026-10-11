// P24 — vocabulary erase: the erased document must remove the bank, preserve
// the exam product, and stay self-consistent with the Worker's own fingerprint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blankVocab } from './scripts/p24-vocab-erase.mjs';
import { fingerprintGlobal, verifyIntegrity, publishGlobal } from './public-worker.js';

const root = new URL('./', import.meta.url);
const WORKER = readFileSync(new URL('public-worker.js', root), 'utf8');
const SYNC = readFileSync(new URL('cloud-content-sync.js', root), 'utf8');
const D1READ = readFileSync(new URL('p13-d1-read.mjs', root), 'utf8');

const sample = () => ({
  v: 5, at: 1, sig: 'x',
  subjects: [{ id: 'sub-01' }],
  topics: [{ id: 'top-001' }],
  questions: [{ id: 'q1', question: 'q', options: ['a', 'b'], o: ['a', 'b'] }],
  vocabulary: [{ id: 'voc-001', word: 'Conjecture', meaning: 'অনুমান করা' }],
  vocabularyMaster: [
    { id: 'vm-1', word: 'Abacus', meaning: 'গণনা যন্ত্র', category: 'A' },
    { id: 'vm-2', word: 'Juxtapose', meaning: 'পাশাপাশি রাখা', category: 'J' },
  ],
});

test('p24: erase removes both vocabulary lists and nothing else', () => {
  const out = blankVocab(sample());
  assert.deepEqual(out.vocabulary, []);
  assert.deepEqual(out.vocabularyMaster, []);
  assert.equal(out.questions.length, 1, 'questions must survive the erase');
  assert.equal(out.subjects.length, 1);
  assert.equal(out.topics.length, 1);
});

test('p24: the erased document carries a recomputed signature and matching counts', () => {
  const out = blankVocab(sample());
  assert.notEqual(out.sig, 'x');
  assert.equal(out.sig, fingerprintGlobal(out));
  assert.deepEqual(out.counts, { subjects: 1, topics: 1, questions: 1, vocabulary: 0, vocabularyMaster: 0 });
  const report = verifyIntegrity(out);
  assert.ok(report.ok, `erased document must verify clean, got ${JSON.stringify(report)}`);
});

test('p24: the erase is idempotent', () => {
  const once = blankVocab(sample());
  const twice = blankVocab(once);
  assert.deepEqual(twice.vocabularyMaster, []);
  assert.equal(twice.sig, once.sig);
});

test('p24: publishGlobal accepts a deliberate empty bank but still refuses an all-empty document', async () => {
  const store = new Map();
  const env = { PUB_KV: { get: async k => store.get(k) || null, put: async (k, v) => store.set(k, v) } };
  const blank = blankVocab(sample());
  const ok = await publishGlobal(env, blank);
  assert.equal(ok.published, true, `empty-bank publish must go through, got ${JSON.stringify(ok)}`);
  const meta = JSON.parse(store.get('pubContentMeta'));
  assert.equal(meta.counts.vocabularyMaster, 0);
  assert.deepEqual(meta.categories, {});
  assert.equal(meta.sig, blank.sig, 'the stored meta must sign the erased document');
  const refused = await publishGlobal(env, { subjects: [], topics: [], questions: [], vocabulary: [], vocabularyMaster: [] });
  assert.equal(refused.error, 'empty', 'a wholly empty document must still be refused');
});

test('p24: the device purge empties a server-emptied store and ignores absent keys', () => {
  assert.match(SYNC, /const EMPTIED_STORES = \['vocabularyMaster', 'vocabulary'\]/);
  assert.match(SYNC, /purgeServerEmptiedStores\(doc\)/, 'applyDoc must run the purge');
  assert.match(SYNC, /!Array\.isArray\(doc\[store\]\) \|\| doc\[store\]\.length\) continue;/, 'only an explicitly empty array may purge');
});

test('p24: the D1 mirror drops the erased kind and the D1 read path serves an empty bank', () => {
  assert.match(WORKER, /DELETE FROM content_lists WHERE kind IN \(\$\{gone/, 'publish must delete vanished kinds from the D1 mirror');
  assert.match(D1READ, /const lists = \(await this\.lists\(\)\) \|\| \{\};/, 'document() must return the lists even when empty');
});
