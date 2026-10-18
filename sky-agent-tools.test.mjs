// Agent phase 1 (owner 2026-10-17): tool runner limits, the 4 server tools, the
// 5 in-app tools, the no-limit simple path and the kill switch. Network mocked.
import { readFileSync } from 'fs';
import { createRequire } from 'module';
let pass = 0, fail = 0;
const t = async (n, c) => { try { (await c()) ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n)); } catch (e) { fail++; console.log('  ✗', n, '→', e && e.message); } };
const T = await import('./sky-tools.mjs');
const A = await import('./ai-agent.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const gChunk = (text) => 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) + '\n\n';
const sse = (chunks) => new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); } }), { status: 200 });
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; return sse([gChunk('উত্তর')]); };
function stubEnv(seed = {}) {
  const store = new Map(Object.entries(seed));
  const kv = { get: async (k) => (store.has(k) ? store.get(k) : null), put: async (k, v) => { store.set(k, v); } };
  return { env: { PUB_KV: kv, GEMINI_KEYS: 'goodkey00001', AGENT_DAILY_CAP: 1 }, store };
}
const STATS = { exams: 4, questions: 60, accuracy: 58, streak: 3, mistakes: 12, weakTopics: [{ name: 'সমাস', accuracy: 40, attempts: 9 }, { name: 'সন্ধি', accuracy: 55, attempts: 7 }] };
const req = (content, ctx) => new Request('https://x/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content }], context: ctx || {} }) });
const stages = (text) => [...text.matchAll(/event: stage\ndata: (.*)\n/g)].map(m => JSON.parse(m[1]).stage);

console.log('runner');
await t('T1. 11 tools declared, 5 of them in the app', () => T.TOOL_NAMES.length === 11 && T.CLIENT_TOOLS.length === 5 && T.CLIENT_TOOLS.every(n => T.TOOL_NAMES.includes(n)));
await t('T2. limits: 5 tools, 3 steps, 20 s, 3 s per tool', () => T.LIMITS.maxTools === 5 && T.LIMITS.maxSteps === 3 && T.LIMITS.budgetMs === 20000 && T.LIMITS.perToolMs === 3000);
await t('T3. never more than 5 tools, never more than 3 steps', async () => {
  const c = { name: 'calculate', args: { expression: '1+1' } };
  const r = await T.runTools([[c, c], [c, c], [c, c], [c, c]], {});
  return r.results.length === 5 && r.results.every(x => x.ok);
});
await t('T4. an argument naming another user is refused', async () => {
  const r = await T.runTools([{ name: 'get_exam_history', args: { uid: 'account-other' } }], { stats: STATS });
  return r.results[0].ok === false && r.results[0].error === 'owner-from-args-rejected';
});
await t('T5. a slow tool times out and the rest still answer', async () => {
  const kv = { get: async () => { await sleep(1500); return null; } };
  const r = await T.runTools([[{ name: 'get_app_features', args: {} }, { name: 'calculate', args: { expression: '2*3' } }]], { kv, limits: { perToolMs: 200 } });
  const af = r.results.find(x => x.name === 'get_app_features'), ca = r.results.find(x => x.name === 'calculate');
  return r.ms < 1000 && af && af.ok === false && af.error === 'timeout' && ca.value === 6;
});
await t('T6. total budget stops further steps', async () => {
  const r = await T.runTools([[{ name: 'calculate', args: { expression: '1' } }], [{ name: 'calculate', args: { expression: '2' } }]], { limits: { budgetMs: 0 } });
  return r.results.every(x => x.error === 'budget');
});
await t('T7. a stage is sent for each tool that really runs', async () => {
  const seen = [];
  await T.runTools([{ name: 'calculate', args: { expression: '1+2' } }, { name: 'analyze_weak_topics', args: {} }], { stats: STATS, onStage: (id) => seen.push(id) });
  return seen.join(',') === 'tool-calculate,tool-analyze_weak_topics';
});
await t('T8. a client tool is not run on the server', async () => (await T.runTools([{ name: 'make_quiz', args: {} }], {})).results[0].error === 'client-tool');

console.log('calculate');
await t('C1. Bengali digits and × ÷', () => T.calculate('২৫×৪').value === 100 && T.calculate('৯÷৩').value === 3);
await t('C2. order, power, brackets, root, percent', () => T.calculate('2+3*4').value === 14 && T.calculate('(3+4)^2').value === 49 && T.calculate('√16+2').value === 6 && T.calculate('50%*200').value === 100);
await t('C3. divide by zero and code are refused', () => T.calculate('5/0').error === 'divide-by-zero' && !T.calculate('alert(1)').ok && !T.calculate('constructor').ok && !T.calculate('2**').ok);
await t('C4. only a pure sum is a calculation; dates and words are not', () => T.extractCalculation('২৫×৪ কত?') && T.extractCalculation('what is 12*7') && !T.extractCalculation('সমাস কী') && !T.extractCalculation('17/10/2026') && !T.extractCalculation('2+2 আর সন্ধি কী'));

console.log('planner + answers');
await t('P1. "আমার রেজাল্ট কেমন" → exam history, simple', () => { const p = T.planServerTools('আমার রেজাল্ট কেমন?'); return p[0].name === 'get_exam_history' && T.isSimplePlan(p, 'আমার রেজাল্ট কেমন?'); });
await t('P2. weak topics are planned; long questions are not simple', () => { const q = 'আমার দুর্বল টপিক কোনগুলো আর সেগুলো কীভাবে পড়লে আগামী মাসের ভর্তি পরীক্ষায় ভালো করব বিস্তারিত বলো'; const p = T.planServerTools(q); return p.some(x => x.name === 'analyze_weak_topics') && !T.isSimplePlan(p, q); });
await t('P2b. a fact to remember (মনে রাখো, আমি … দুর্বল) is never taken by a tool', () => T.planServerTools('মনে রাখো, আমি ফিজিক্সে দুর্বল').length === 0 && T.planServerTools('আমি অঙ্কে দুর্বল').length === 0);
await t('P3. a normal academic question plans no tool', () => T.planServerTools('নিউটনের দ্বিতীয় সূত্র বুঝাও').length === 0);
await t('P4. exam history answer is in Bengali digits with the name', () => { const s = T.renderSimpleAnswer([Object.assign({ name: 'get_exam_history' }, T.getExamHistory(STATS))], 'রাফি'); return /রাফি/.test(s) && /৫৮%/.test(s) && /৪টা/.test(s); });
await t('P5. no exams yet → a kind hint, not numbers', () => /এখনো কোনো পরীক্ষার ফল/.test(T.renderSimpleAnswer([Object.assign({ name: 'get_exam_history' }, T.getExamHistory(null))])));
await t('P6. tool context for the model holds only this student\'s numbers', () => { const s = T.renderToolContext([Object.assign({ name: 'analyze_weak_topics' }, T.analyzeWeakTopics(STATS))]); return /সমাস 40%/.test(s) && /this student only/.test(s); });

console.log('chat path');
await t('S1. "২৫×৪ কত" is answered with no model call and no AI limit', async () => {
  const { env } = stubEnv();
  fetchCalls = 0;
  const outs = [];
  for (let i = 0; i < 3; i++) outs.push(await (await A.agentChat(req('২৫×৪ কত?'), env, 'account-tools1')).text()); /* cap is 1 */
  return fetchCalls === 0 && outs.every(o => /১০০/.test(o) && /"provider":"tools"/.test(o) && /"quotaUsed":false/.test(o)) && stages(outs[0]).includes('tool-calculate');
});
await t('S2. after tool answers, the one AI question of the day is still there', async () => {
  const { env } = stubEnv();
  await (await A.agentChat(req('২+২'), env, 'account-tools2')).text();
  const r = await A.agentChat(req('সমাসের উদাহরণ দাও'), env, 'account-tools2');
  const o = await r.text();
  return r.status === 200 && !/rate_limited/.test(o) && /event: done/.test(o);
});
await t('S3. "আমার রেজাল্ট কেমন" uses the student\'s own stats, no model', async () => {
  const { env } = stubEnv();
  fetchCalls = 0;
  const o = await (await A.agentChat(req('আমার রেজাল্ট কেমন?', { stats: STATS, profile: { firstName: 'রাফি' } }), env, 'account-tools3')).text();
  return fetchCalls === 0 && /৫৮%/.test(o) && /রাফি/.test(o);
});
await t('S4. a long question with tools goes to the model with a real tool stage', async () => {
  const { env } = stubEnv();
  fetchCalls = 0;
  const q = 'আমার দুর্বল টপিক কোনগুলো আর সেগুলো কীভাবে পড়লে আগামী মাসের ভর্তি পরীক্ষায় ভালো করব বিস্তারিত বলো';
  const o = await (await A.agentChat(req(q, { stats: STATS }), env, 'account-tools4')).text();
  return fetchCalls > 0 && stages(o).includes('tool-analyze_weak_topics') && /event: done/.test(o);
});
await t('S5. kill switch "off" → no tool, normal AI path', async () => {
  const { env } = stubEnv({ 'sky:agent-tools': 'off' });
  fetchCalls = 0;
  const o = await (await A.agentChat(req('২৫×৪ কত?'), env, 'account-tools5')).text();
  return fetchCalls > 0 && !/"provider":"tools"/.test(o);
});
await t('S6. no tools during a running mock exam', async () => {
  const { env } = stubEnv();
  const o = await (await A.agentChat(req('২৫×৪ কত?', { examMode: 'mock-running' }), env, 'account-tools6')).text();
  return !/"provider":"tools"/.test(o);
});
await t('S7. a guest still gets sign_in_required (tools do not bypass it)', async () => (await A.agentChat(req('২+২'), stubEnv().env, 'guest-x')).status === 401);

console.log('in-app tools');
const require = createRequire(import.meta.url);
globalThis.CACHE = { topics: [{ id: 't1', name: 'নেকলেস' }, { id: 't2', name: 'সমাস' }], subjects: [{ id: 's1', name: 'বাংলা' }],
  questions: Array.from({ length: 30 }, (_, i) => ({ id: 'q' + i, topicId: 't1', subjectId: 's1', question: 'নেকলেস প্রশ্ন ' + i, options: ['অ', 'আ', 'ই', 'ঈ'], answer: i % 4, explanation: 'কারণ ' + i })) };
globalThis.SkyFAQ = { match: (q) => (/^সমাস কী$/.test(q.trim()) ? { id: 'bn-samas', a: 'সমাস হলো…', q } : null) };
require('./sky-tools-client.js');
const S = globalThis.SkyTools;
await t('A1. make_quiz: 5 by default, max 20, from the right topic', () => {
  const a = S.run('নেকলেস থেকে কুইজ দাও', { seed: 3 }), b = S.run('নেকলেস থেকে ৫০টা কুইজ দাও', { seed: 3 });
  return a.quiz.length === 5 && b.quiz.length === 20 && a.tools[0] === 'make_quiz' && /নেকলেস/.test(a.text);
});
await t('A2. grade_quiz: numbered and plain answers, wrong ones explained', () => {
  const q = S.run('নেকলেস থেকে ৩টা কুইজ দাও', { seed: 9 }).quiz;
  const L = ['ক', 'খ', 'গ', 'ঘ'];
  const right = q.map((x, i) => (i + 1) + '-' + L[x.a]).join(' ');
  const g1 = S.run(right, { lastQuiz: q }), g2 = S.run(q.map(x => L[(x.a + 1) % 4]).join(' '), { lastQuiz: q });
  return /৩টার মধ্যে ৩টা সঠিক/.test(g1.text) && /৩টার মধ্যে ০টা সঠিক/.test(g2.text) && /কারণ/.test(g2.text);
});
await t('A3. answers with no quiz before go to the AI', () => S.run('১-ক ২-খ', {}) === null);
await t('A4. search_question_bank finds and caps at 5', () => { const r = S.run('নেকলেস নিয়ে প্রশ্ন খুঁজে দাও'); return r.tools[0] === 'search_question_bank' && /৩০টা/.test(r.text) && (r.text.match(/নেকলেস প্রশ্ন/g) || []).length === 5; });
await t('A5. open_page gives a button, never navigates by itself', () => { const r = S.run('প্রশ্নব্যাংক খোলো'); return r.go === 'question-bank' && r.tools[0] === 'open_page'; });
await t('A6. knowledge_lookup uses the shared answers', () => { const r = S.run('সমাস সম্পর্কে তথ্য খুঁজে দাও'); return r && r.faq === 'bn-samas' && r.tools[0] === 'knowledge_lookup'; });
await t('A7. unknown topic / normal question → AI as before', () => S.run('পদার্থবিজ্ঞান থেকে কুইজ দাও') === null && S.run('নিউটনের সূত্র বুঝাও') === null);
await t('A8. in-app tools are read-only (no db writes, no fetch)', () => { const s = readFileSync('./sky-tools-client.js', 'utf8'); return !/dbPut|dbDel|localStorage\.setItem|fetch\(/.test(s); });

console.log('wiring');
const chat = readFileSync('./ai-agent-chat.js', 'utf8'), idx = readFileSync('./index.html', 'utf8'), sw = readFileSync('./sw.js', 'utf8'), bundle = readFileSync('./worker-bundle.mjs', 'utf8');
await t('W1. chat runs in-app tools after small talk and shared answers, before the server', () => { const a = chat.indexOf('ST.replyMsg('), b = chat.indexOf('SkyFAQ.match(t)'), c = chat.indexOf('window.SkyTools.run('), d = chat.indexOf('const res = await ask('); return a > 0 && a < b && b < c && c < d; });
await t('W2. page loads and precaches sky-tools-client.js', () => /sky-tools-client\.js\?v=tools2/.test(idx) && /sky-tools-client\.js\?v=tools2/.test(sw));
await t('W3. worker bundle carries the server tools', () => /sky-tools-v1/.test(bundle) && /simpleToolResponse/.test(bundle));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
