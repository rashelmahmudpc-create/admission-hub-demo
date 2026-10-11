// Vocabulary card: synonyms and antonyms render side by side (কাটাকাটে).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('./', import.meta.url);
const TOOL = readFileSync(new URL('vocabulary-master-tool.js', root), 'utf8');

test('vocab-card: synonyms and antonyms share one side-by-side section', () => {
  assert.match(TOOL, /function relationPair\(synonyms, antonyms\)/, 'relationPair renderer must exist');
  assert.match(TOOL, /vm-relation-pair/, 'the paired section class must be emitted');
  assert.match(TOOL, /\$\{relationPair\(synonyms, antonyms\)\}/, 'the card must call relationPair for synonyms+antonyms');
  assert.doesNotMatch(TOOL, /\$\{relationSection\('SYNONYMS', synonyms\)\}\$\{relationSection\('ANTONYMS', antonyms\)\}/,
    'synonyms/antonyms must not render as two stacked sections');
});

test('vocab-card: the pair collapses to one column on narrow screens', () => {
  assert.match(TOOL, /\.vm-relation-pair\{display:grid;grid-template-columns:1fr 1fr/,
    'the pair must be a two-column grid on wide screens');
  const narrow = TOOL.indexOf('max-width:360px');
  assert.ok(narrow > 0, 'a 360px media query must exist');
  assert.ok(TOOL.slice(narrow).includes('.vm-relation-pair{grid-template-columns:1fr}'),
    'the pair must fall back to a single column on narrow screens');
});

test('vocab-card: a column with no items is omitted so an empty side leaves no gap', () => {
  assert.match(TOOL, /function relationColumn\(title, items\) \{\s*if \(!items\.length\) return '';/,
    'relationColumn must skip empty lists');
});
