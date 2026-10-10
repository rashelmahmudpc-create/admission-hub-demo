// Category A starter cards — shape + wiring guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('./', import.meta.url);
const load = () => new Function('window', `${readFileSync(new URL('vocabulary-a-seed.js', root), 'utf8')}; return window.AH_VOCAB_A_SEED;`)({});
const H = readFileSync(new URL('index.html', root), 'utf8');
const TOOL = readFileSync(new URL('vocabulary-master-tool.js', root), 'utf8');

test('vocab-a: exactly 10 starter cards, all category A', () => {
  const cards = load();
  assert.equal(cards.length, 10);
  assert.ok(cards.every(c => c.category === 'A'), 'every starter card must sit in category A');
});

test('vocab-a: each card has an English word, a Bengali meaning, and a unique fixed id', () => {
  const cards = load();
  const ids = new Set();
  for (const c of cards) {
    assert.match(c.word, /^[A-Za-z]/, `${c.word} must start with a Latin letter`);
    assert.ok(c.meaning && /[\u0980-\u09FF]/.test(c.meaning), `${c.word} needs a Bengali meaning`);
    assert.ok(c.id && !ids.has(c.id), `${c.word} needs a unique id`);
    ids.add(c.id);
    assert.ok(Array.isArray(c.synonyms) && c.synonyms.length, `${c.word} needs synonyms`);
    assert.ok(Array.isArray(c.antonyms) && c.antonyms.length, `${c.word} needs antonyms`);
    for (const rel of [...c.synonyms, ...c.antonyms]) assert.ok(rel.word && rel.meaning, `${c.word} relation needs word+meaning`);
  }
});

test('vocab-a: ids are fixed so re-seeding is a no-op', () => {
  const cards = load();
  assert.ok(cards.every(c => /^vm-seed-a-\d\d$/.test(c.id)));
  assert.ok(cards.every(c => c.tool === 'vocabulary-master'));
});

test('vocab-a: the seed is loaded from index.html before the tool, and the tool refreshes it when empty', () => {
  const seedIdx = H.indexOf('./vocabulary-a-seed.js');
  const toolIdx = H.indexOf('./vocabulary-master-tool.js');
  assert.ok(seedIdx > 0 && toolIdx > seedIdx, 'seed script must be included before the vocabulary tool');
  assert.match(TOOL, /window\.AH_VOCAB_A_SEED/);
  assert.match(TOOL, /await seedCategoryA\(\)/);
});

test('vocab-a: opening a category prefetches its words (and relations) into the voice cache', () => {
  const VOICE = readFileSync(new URL('vocabulary-elevenlabs.js', root), 'utf8');
  assert.match(VOICE, /const prefetchWords = async/);
  assert.match(VOICE, /prefetchWords,\s/, 'prefetchWords must be exported on window.VocabularyElevenLabs');
  assert.match(TOOL, /function prefetchCategoryVoices\(\)/);
  assert.match(TOOL, /lib\.prefetchWords\(unique, 24\)/);
  assert.match(TOOL, /prefetchCategoryVoices\(\);/, 'renderCategory must trigger the prefetch');
});
