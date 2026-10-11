/* Question Pattern dataset — functional tests (node:test)
   The dataset must only carry official, attributed values; a missing entry is
   reported as absent, never guessed (MASTER_KNOWLEDGE_BASE §43, §120). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Load the BROWSER build the way the app does (window/self UMD).
const src = readFileSync(new URL('./question-pattern.js', import.meta.url), 'utf8');
const fakeSelf = {};
const qp = new Function('self', 'module', 'window', `${src}\nreturn self.AH_QuestionPattern;`)(fakeSelf, undefined, undefined);

test('qp-01: the dataset is versioned and lists the covered universities', () => {
  assert.equal(typeof qp.version, 'string');
  assert.ok(qp.version.length > 4);
  assert.ok(qp.universities.includes('du') && qp.universities.includes('ru'));
});

test('qp-02: RU A unit is the official 100-mark / 80-question / 60-minute MCQ paper', () => {
  const p = qp.forUnit('ru', 'A');
  assert.equal(p.total, 100);
  assert.equal(p.mcqQuestions, 80);
  assert.equal(p.duration, 60);
  assert.equal(p.negative, 0.25);
  assert.ok(p.source && p.status === 'confirmed');
});

test('qp-03: DU uses the official 60+40 split; Fine Arts and IBA differ', () => {
  const d = qp.forUnit('du', 'A');
  assert.equal(d.mcq, 60);
  assert.equal(d.written, 40);
  assert.equal(d.mcqMinutes, 45);
  const art = qp.forUnit('du', 'E');
  assert.equal(art.mcq, 40);
  assert.equal(art.written, 60);
  const iba = qp.forUnit('du', 'F');
  assert.equal(iba.mcq, 70);
});

test('qp-04: CU and KU carry their official MCQ/written and duration', () => {
  const cu = qp.forUnit('cu', 'A');
  assert.equal(cu.total, 100);
  assert.equal(cu.duration, 60);
  const ku = qp.forUnit('ku', 'A');
  assert.equal(ku.mcq, 60);
  assert.equal(ku.written, 40);
  assert.equal(ku.duration, 90);
});

test('qp-05: IUT carries its official subject split and two-hour duration', () => {
  const iut = qp.forUnit('iut', 'IUT');
  assert.equal(iut.total, 100);
  assert.equal(iut.duration, 120);
  assert.equal(iut.negative, 0.25);
});

test('qp-06: an unknown university or unit returns null, never a guess', () => {
  assert.equal(qp.forUnit('nope', 'A'), null);
  assert.equal(qp.forUnit('', ''), null);
  const unknownUnit = qp.forUnit('ru', 'Z');
  assert.ok(unknownUnit, 'an unknown unit falls back to the university default');
  assert.equal(unknownUnit.total, 100);
});

test('qp-07: every entry is attributed to a source and a status', () => {
  for (const u of qp.universities) {
    const p = qp.forUnit(u, u === 'du' ? 'A' : '');
    assert.ok(p, u + ' must resolve a default pattern');
    assert.ok(p.source, u + ' must cite a source');
    assert.ok(['confirmed', 'partial', 'provisional'].includes(p.status), u + ' must carry a status');
  }
});

test('qp-08: SUST claims only the negative-marking rule (marks differ by unit)', () => {
  const su = qp.forUnit('su', 'A');
  assert.equal(su.negative, 0.2);
  assert.equal(su.total, undefined, 'no single total may be claimed when units differ');
  assert.equal(su.status, 'partial');
});
