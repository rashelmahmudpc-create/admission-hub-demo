/* Exam Center · Sky — persistence and AI wiring (jsdom).
 *
 * The demo lost every attempt on refresh and showed a "demo panel" instead of a
 * real explanation. These tests load the real file and assert that:
 *   1. finishing an attempt writes a result to the app's own store,
 *   2. wrong answers land in the mistakes store with their subject/topic ids,
 *   3. the written record carries the fields the existing Exam History screen
 *      and cloud sync read (score, accuracy, snapshot),
 *   4. no demo caption survives in the rendered UI,
 *   5. the AI panel calls the app's own tutor endpoint instead of a stub.
 */
import { test as t, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const JS = readFileSync('exam-center-sky.js', 'utf8');
const windows = [];
afterEach(() => { while (windows.length) { try { windows.pop().close(); } catch (_) {} } });

function boot(extra = '') {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="app"></div><div id="bb"></div></body></html>',
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://admissionhub.pages.dev/' }
  );
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  w.eval(`window.CACHE = {subjects:[{id:'s1',name:'GK'}],questions:[],topics:[],mistakes:[]}; window.__writes=[]; window.dbPut = async (store,rec)=>{ window.__writes.push({store,rec}); }; window.uid = ()=>'id-'+Math.random().toString(36).slice(2);`);
  const s = w.document.createElement('script');
  s.textContent = JS;
  w.document.body.appendChild(s);
  if (extra) w.eval(extra);
  windows.push(dom);
  return w;
}

t('finishing an attempt persists a result to the real store', async () => {
  const w = boot();
  w.eval(`
    H.length = 0;
    curA = { mock:true, mode:'Mock Test', bm:new Set(), neg:0.25, dur:120,
      list:[
        {id:'q1', q:'প্রশ্ন এক', o:['ক','খ'], a:0, s:'GK', sid:'s1', tid:'t1', u:0},
        {id:'q2', q:'প্রশ্ন দুই', o:['ক','খ'], a:1, s:'GK', sid:'s1', tid:'t2', u:0}
      ],
      ans:{0:0,1:0}, tm:{}, log:[] };
    persist(curA);
  `);
  await new Promise(r => setTimeout(r, 30));
  const writes = JSON.parse(JSON.stringify(w.eval('window.__writes')));
  const results = writes.filter(x => x.store === 'examResults');
  assert.equal(results.length, 1, 'one result must be written');
  const rec = results[0].rec;
  assert.equal(rec.questionCount, 2);
  assert.equal(rec.correct, 1);
  assert.equal(rec.wrong, 1);
  assert.equal(rec.accuracy, 50);
  assert.equal(rec.snapshot.length, 2);
});

t('a wrong answer is recorded in the mistakes store with its ids', async () => {
  const w = boot();
  w.eval(`
    H.length = 0;
    curA = { mock:true, mode:'Mock Test', bm:new Set(), neg:0.25, dur:60,
      list:[ {id:'q9', q:'প্রশ্ন', o:['ক','খ'], a:1, s:'GK', sid:'s1', tid:'t7', u:0} ],
      ans:{0:0}, tm:{}, log:[] };
    persist(curA);
  `);
  await new Promise(r => setTimeout(r, 30));
  const writes = JSON.parse(JSON.stringify(w.eval('window.__writes')));
  const mis = writes.filter(x => x.store === 'mistakes');
  assert.equal(mis.length, 1, 'the wrong answer must enter the mistakes store');
  assert.equal(mis[0].rec.questionId, 'q9');
  assert.equal(mis[0].rec.subjectId, 's1');
  assert.equal(mis[0].rec.topicId, 't7');
  assert.equal(mis[0].rec.revisionStatus, 'pending');
});

t('a correct answer is not recorded as a mistake', async () => {
  const w = boot();
  w.eval(`
    H.length = 0;
    curA = { mock:true, mode:'Mock Test', bm:new Set(), neg:0.25, dur:60,
      list:[ {id:'q9', q:'প্রশ্ন', o:['ক','খ'], a:1, s:'GK', sid:'s1', tid:'t7', u:1} ],
      ans:{0:1}, tm:{}, log:[] };
    persist(curA);
  `);
  await new Promise(r => setTimeout(r, 30));
  const writes = JSON.parse(JSON.stringify(w.eval('window.__writes')));
  assert.equal(writes.filter(x => x.store === 'mistakes').length, 0);
});

t('persistence survives a missing store without throwing', async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>',
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://admissionhub.pages.dev/' });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  const s = w.document.createElement('script');
  s.textContent = JS;
  w.document.body.appendChild(s);
  windows.push(dom);
  await w.eval(`persist({mock:true,bm:new Set(),neg:0,dur:1,list:[{id:'x',q:'q',o:['a'],a:0,u:0}],ans:{0:0},tm:{},log:[]})`);
});

t('no demo caption survives in the UI copy', () => {
  assert.ok(!/ডেমো প্যানেল/.test(JS.replace(/\/\*[\s\S]*?\*\//g, '')), 'the demo panel caption must be gone');
  assert.ok(!/AI সংযোগ হলে/.test(JS), 'the placeholder toast must be gone');
});

t('the AI panel calls the app tutor endpoint, not a stub', async () => {
  const w = boot();
  let called = null;
  w.fetch = async (url, init) => {
    called = { url, body: JSON.parse(init.body) };
    const enc = new TextEncoder();
    return { ok: true, body: { getReader: () => { let done = false; return { read: async () => { if (done) return { done: true }; done = true; return { done: false, value: enc.encode('data: {"text":"কারণ এটাই সঠিক"}\n\n') }; } }; } } };
  };
  const box = w.document.createElement('div');
  w.document.body.appendChild(box);
  w.eval(`curA = { list:[{id:'q1',q:'প্রশ্ন',o:['ক','খ'],a:1,e:'কারণ'}], ans:{0:0} };`);
  await w.eval(`askAI(curA.list[0], document.body.lastElementChild)`);
  assert.equal(called.url, '/api/ai/chat', 'must use the app tutor endpoint');
  assert.ok(called.body.messages[0].content.includes('প্রশ্ন'), 'must send the question');
  assert.equal(box.textContent, 'কারণ এটাই সঠিক');
});

t('the exam file carries no hardcoded question bank', () => {
  assert.ok(!/const Q=\[/.test(JS));
  assert.ok(!/আহাদিকে তার স্বামী/.test(JS));
});
