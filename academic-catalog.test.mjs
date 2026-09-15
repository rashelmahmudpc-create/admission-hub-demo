/* Academic Catalog Engine — functional tests (node:test)
   Owner spec: units come ONLY from university + session; official portals
   are the source of truth (CU 2025-26 = A,B,B1,B2,C,D,D1; RU = A,B,C;
   KU different; never a generic A/B/C/D). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Load the BROWSER build the way the app does (window/self UMD), not a
// re-implementation — the tested code is the shipped code.
const src = readFileSync(new URL('./academic-catalog.js', import.meta.url), 'utf8');
const fakeSelf = {};
const cat = new Function('self', 'module', 'window', `${src}\nreturn self.AH_AcademicCatalog;`)(fakeSelf, undefined, undefined);

test('catalog is versioned and lists both sessions', () => {
  assert.equal(typeof cat.version, 'string');
  assert.ok(cat.version.length > 4);
  const sessions = cat.listSessions();
  assert.ok(sessions.length >= 2);
  assert.ok(sessions.some((s) => s.id === '2025-26'));
  assert.ok(sessions.some((s) => s.id === '2026-27'));
});

test('CU 2025-26 units are exactly A, B, B1, B2, C, D, D1 (official)', () => {
  const units = cat.unitsFor('cu', '2025-26');
  assert.deepEqual(units.map((u) => u.id).sort(), ['A', 'B', 'B1', 'B2', 'C', 'D', 'D1'].sort());
});

test('RU units are exactly A, B, C (official)', () => {
  const units = cat.unitsFor('ru', '2025-26');
  assert.deepEqual(units.map((u) => u.id).sort(), ['A', 'B', 'C'].sort());
});

test('KU unit structure differs (A-E) and is not the generic A/B/C/D', () => {
  const units = cat.unitsFor('ku', '2025-26');
  assert.deepEqual(units.map((u) => u.id).sort(), ['A', 'B', 'C', 'D', 'E'].sort());
});

test('BUET / IUT have NO unit system (single admission entry)', () => {
  assert.deepEqual(cat.unitsFor('buet', '2025-26').map((u) => u.id), ['BUET']);
  assert.deepEqual(cat.unitsFor('iut', '2025-26').map((u) => u.id), ['IUT']);
});

test('unknown university or session yields no units (never invented)', () => {
  assert.deepEqual(cat.unitsFor('nope', '2025-26'), []);
  assert.deepEqual(cat.unitsFor('cu', '1999-00'), []);
  assert.deepEqual(cat.subjectsFor('cu', '2025-26', 'NOPE'), []);
});

test('subjects are official per unit group', () => {
  const cuA = cat.subjectsFor('cu', '2025-26', 'A');
  assert.ok(cuA.includes('Physics') && cuA.includes('Chemistry') && cuA.includes('Math'));
  const cuB = cat.subjectsFor('cu', '2025-26', 'B');
  assert.ok(cuB.includes('English') && cuB.includes('Math'));
  assert.ok(!cuB.includes('Physics'), 'commerce unit must not offer Physics');
  const ruA = cat.subjectsFor('ru', '2025-26', 'A');
  assert.ok(ruA.includes('Physics'));
  // subjects are a copy — mutating the result must not corrupt the catalog
  cuA.push('HACKED');
  assert.ok(!cat.subjectsFor('cu', '2025-26', 'A').includes('HACKED'));
});

test('search: Bangla + English aliases, ranked', () => {
  assert.equal(cat.searchUniversities('CU', 1)[0].university.id, 'cu');
  assert.equal(cat.searchUniversities('ঢাকা', 1)[0].university.id, 'du');
  assert.equal(cat.searchUniversities('chittagong', 1)[0].university.id, 'cu');
  assert.equal(cat.searchUniversities('বুয়েট', 1)[0].university.id, 'buet');
  assert.equal(cat.searchUniversities('khulna', 1)[0].university.id, 'ku');
  const hits = cat.searchUniversities('u', 10);
  assert.ok(hits.length >= 5);
  assert.ok(hits.every((h) => h.university && h.university.name));
});

test('search: empty query returns the catalog, no crash', () => {
  const hits = cat.searchUniversities('', 3);
  assert.equal(hits.length, 3);
  assert.equal(cat.searchUniversities('zzzz', 5).length, 0);
});

test('getUniversity resolves id, alias, and full name', () => {
  assert.equal(cat.getUniversity('cu').name, 'University of Chittagong');
  assert.equal(cat.getUniversity('Rajshahi').id, 'ru');
  assert.equal(cat.getUniversity('University of Dhaka').id, 'du');
  assert.equal(cat.getUniversity(''), null);
  assert.equal(cat.getUniversity('nope-not-real'), null);
});

test('groupLabel is human-readable and unit-scoped', () => {
  assert.match(cat.groupLabel('cu', '2025-26', 'A'), /Science/);
  assert.match(cat.groupLabel('cu', '2025-26', 'B'), /Business|Commerce/);
  assert.equal(cat.groupLabel('cu', '2025-26', 'NOPE'), '');
});
