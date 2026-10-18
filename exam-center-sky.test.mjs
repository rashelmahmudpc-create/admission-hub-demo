/* Exam Center · Sky — real-data wiring (jsdom).
 *
 * The ported UI must read its question bank from CACHE (which
 * cloud-content-sync.js fills from GET /pub/content), not from the demo's
 * hardcoded eight questions. These tests load the real file and assert that:
 *   1. a live bank in CACHE becomes usable questions,
 *   2. the subject tiles are derived from the bank, not from a fixed list,
 *   3. backend field names (question/options/answer/explanation/subjectId)
 *      are translated into the shape the demo UI already renders,
 *   4. deleted and malformed records are dropped rather than rendered blank,
 *   5. an empty bank does not crash the screen.
 */
import { test as t, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* jsdom objects come from a different realm, so deepStrictEqual rejects them on
   identity. Compare a JSON round-trip instead. */
const val = (w, expr) => JSON.parse(JSON.stringify(w.eval(expr)));
import { JSDOM } from 'jsdom';

const JS = readFileSync('exam-center-sky.js', 'utf8');
const windows = [];
afterEach(() => { while (windows.length) { try { windows.pop().close(); } catch (_) {} } });

function boot(cache) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="app"></div><div id="bb"></div></body></html>',
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://admissionhub.pages.dev/' }
  );
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  // CACHE is the app-wide store cloud-content-sync.js fills from the backend.
  w.eval(`window.CACHE = ${JSON.stringify(cache)};`);
  const s = w.document.createElement('script');
  s.textContent = JS;
  w.document.body.appendChild(s);
  windows.push(dom);
  return w;
}

const BACKEND_BANK = {
  subjects: [
    { id: 's-gk', name: 'GK', order: 1 },
    { id: 's-bn', name: 'Bangla 1st', order: 2 },
  ],
  questions: [
    { id: 'q1', question: 'বাংলাদেশের রাজধানী কোনটি?', options: ['ঢাকা', 'খুলনা', 'রাজশাহী', 'সিলেট'], answer: 0, explanation: 'রাজধানী ঢাকা।', subjectId: 's-gk' },
    { id: 'q2', question: '‘সূর্য’ শব্দের সমার্থক কোনটি?', options: ['ভাস্কর', 'নীরদ', 'জলধি', 'শশী'], answer: 0, subjectId: 's-bn' },
    { id: 'q3', question: 'মুছে ফেলা প্রশ্ন', options: ['ক', 'খ'], answer: 0, subjectId: 's-gk', deleted: true },
    { id: 'q4', question: 'বিকল্পহীন প্রশ্ন', options: [], answer: 0, subjectId: 's-gk' },
    { id: 'q5', question: '', options: ['ক', 'খ'], answer: 0, subjectId: 's-gk' },
  ],
  topics: [],
};

t('reads the live bank from CACHE instead of the demo questions', () => {
  const w = boot(BACKEND_BANK);
  const n = w.eval('mapBank()');
  assert.equal(n, 2, 'only the two valid records should survive');
  assert.equal(w.eval('Q.length'), 2);
});

t('drops deleted, optionless and textless records', () => {
  const w = boot(BACKEND_BANK);
  w.eval('mapBank()');
  assert.deepEqual(val(w, 'Q.map(x=>x.id)'), ['q1', 'q2']);
});

t('translates backend field names into the shape the UI renders', () => {
  const w = boot(BACKEND_BANK);
  w.eval('mapBank()');
  const q = val(w, 'Q[0]');
  assert.equal(q.q, 'বাংলাদেশের রাজধানী কোনটি?');
  assert.deepEqual(val(w, 'Q[0].o'), ['ঢাকা', 'খুলনা', 'রাজশাহী', 'সিলেট']);
  assert.equal(q.a, 0);
  assert.equal(q.s, 'GK', 'subjectId must resolve to the subject name');
  assert.equal(q.e, 'রাজধানী ঢাকা।');
});

t('derives the subject tiles from the bank, not a fixed list', () => {
  const w = boot(BACKEND_BANK);
  w.eval('mapBank()');
  assert.deepEqual(val(w, 'SJ.map(x=>x[0])'), ['সব', 'GK', 'Bangla 1st']);
});

t('resolves a topic name from topicId when the record carries one', () => {
  const w = boot({
    subjects: [{ id: 's1', name: 'GK' }],
    questions: [{ id: 'x', question: 'প্রশ্ন', options: ['ক', 'খ'], answer: 1, subjectId: 's1', topicName: 'সমাস' }],
  });
  w.eval('mapBank()');
  assert.equal(w.eval('Q[0].t'), 'সমাস');
});

t('an empty bank is survivable, not a crash', () => {
  const w = boot({ subjects: [], questions: [], topics: [] });
  const n = w.eval('mapBank()');
  assert.equal(n, 0);
  assert.equal(w.eval('Q.length'), 0);
  assert.deepEqual(val(w, 'SJ.map(x=>x[0])'), ['সব']);
});

t('a missing CACHE does not throw', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>',
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://admissionhub.pages.dev/' });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  const s = w.document.createElement('script');
  s.textContent = JS;
  w.document.body.appendChild(s);
  windows.push(dom);
  assert.equal(w.eval('mapBank()'), 0);
});

t('no hardcoded demo question text survives in the file', () => {
  assert.ok(!/আহাদিকে তার স্বামী/.test(JS), 'the demo question must be gone');
  assert.ok(!/const Q=\[/.test(JS), 'the hardcoded array must be gone');
});
