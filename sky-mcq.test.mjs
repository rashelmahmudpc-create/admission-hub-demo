/* Sky MCQ Card Engine (owner 2026-10-18): every MCQ in a Sky answer must render
   as a tap-to-answer card — AI text, half-streamed quiz JSON and make_quiz. */
import fs from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
const t = (name, fn) => { let ok = false; try { ok = !!fn(); } catch (e) { console.error(e); ok = false; } if (ok) pass++; else fail++; console.log((ok ? '✅ ' : '❌ ') + name); };

const store = {};
const ctx = { console, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } } };
ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('./sky-mcq.js', import.meta.url), 'utf8'), ctx);
const E = ctx.SkyMCQ, M = E._t;
const sets = (txt, live) => M.parse(txt, live).filter((s) => s.type === 'set');
const card = (txt, live) => { const out = []; const r = E.render(txt, (h) => { out.push(h); return '\u0001V' + (out.length - 1) + '\u0001'; }, { live }); return { r, out }; };

const BN = `এখানে ৩টি MCQ:

**১.** বাংলাদেশের রাজধানী কোনটি?
ক) চট্টগ্রাম
খ) ঢাকা
গ) খুলনা
ঘ) রাজশাহী
✅ উত্তর: খ
💡 ব্যাখ্যা: ঢাকা ১৯৭১ থেকে রাজধানী।

**২.** H2O কী?
ক) লবণ
খ) পানি
গ) অ্যাসিড
ঘ) গ্যাস
**উত্তর:** খ) পানি

৩. সূর্য একটি —
(ক) গ্রহ (খ) নক্ষত্র (গ) উপগ্রহ (ঘ) ধূমকেতু

উত্তরমালা: ৩-খ

শেষ কথা।`;

t('M1. Bangla MCQs (line options, bold answer, inline options, answer key) → one set of 3', () => {
  const s = sets(BN); return s.length === 1 && s[0].qs.length === 3 && s[0].qs.map((q) => q.a).join() === '1,1,1' && /১৯৭১/.test(s[0].qs[0].x);
});
t('M2. text around the quiz is kept as text', () => { const { r } = card(BN); return /এখানে ৩টি MCQ/.test(r) && /শেষ কথা/.test(r) && !/চট্টগ্রাম/.test(r); });
t('M3. English options A./a) and a ✅-marked option', () => {
  const s = sets('1. What is 2+2?\nA. 3\nB. 4\nC. 5\nD. 6\nAnswer: B\n\n2) Capital of France?\na) Paris ✅\nb) Rome\nc) Berlin');
  return s[0].qs.length === 2 && s[0].qs[0].a === 1 && s[0].qs[1].a === 0 && s[0].qs[1].opts[0] === 'Paris';
});
t('M4. answer key under a heading ("### উত্তর" + "১. ক")', () => {
  const s = sets('১. ক কোনটি?\nক) a\nখ) b\nগ) c\nঘ) d\n\n২. খ কোনটি?\nক) a\nখ) b\nগ) c\nঘ) d\n\n### উত্তর\n১. ক\n২. খ');
  return s[0].qs.map((q) => q.a).join() === '0,1';
});
t('M5. an ordinary list ("সমাস ৬ প্রকার: ক) … খ) …") is NOT a quiz', () => sets('সমাস ৬ প্রকার:\nক) দ্বন্দ্ব\nখ) কর্মধারয়\nগ) তৎপুরুষ\nঘ) বহুব্রীহি').length === 0);
t('M6. code fences are never parsed', () => sets('```\n১. কোনটি?\nক) a\nখ) b\nগ) c\n```').length === 0);
t('M7. a question without an answer key still becomes a card (Sky checks it)', () => {
  const { out } = card('প্রশ্ন: কোনটি মৌলিক সংখ্যা?\nক) ৪\nখ) ৬\nগ) ৭\nঘ) ৯'); return out.length === 1 && /data-skq-a="-1"/.test(out[0]);
});
t('M8. live stream: a half-written last question waits instead of showing 2 options', () => {
  const { out } = card('১. প্রশ্ন এক কোনটি?\nক) এক\nখ) দুই\nগ) তিন\nঘ) চার\nউত্তর: ক\n\n২. প্রশ্ন দুই কোনটি?\nক) এক\nখ) দু', true);
  return out.length === 1 && (out[0].match(/class="skq-it/g) || []).length === 1 && /পরের প্রশ্ন আসছে/.test(out[0]);
});
t('M9. quiz JSON streams question by question', () => {
  const half = '{"title":"পদার্থ","questions":[{"q":"বল কী?","options":["a","b","c","d"],"answer":1,"explanation":"x"},{"q":"দ্বিতীয়","options":["a","b"';
  const h = E.renderJson(half, true); const full = E.renderJson('{"title":"পদার্থ","questions":[{"q":"বল কী?","options":["a","b","c","d"],"answer":1}]}', false);
  return /বল কী/.test(h) && /পরের প্রশ্ন আসছে/.test(h) && !/পরের প্রশ্ন আসছে/.test(full) && E.renderJson('## heading', false) === null;
});
t('M10. escape-first: HTML in a question is shown as text', () => {
  const { out } = card('১. <img src=x onerror=alert(1)> কোনটি?\nক) <b>a</b>\nখ) b\nগ) c\nঘ) d\nউত্তর: ক');
  return !/<img/.test(out[0]) && /&lt;img/.test(out[0]) && !/<b>a<\/b>/.test(out[0]);
});
t('M11. a pick is remembered per question and survives a re-render', () => {
  const txt = '১. দুই আর দুই কত?\nক) ৩\nখ) ৪\nগ) ৫\nঘ) ৬\nউত্তর: খ\nব্যাখ্যা: ২+২=৪';
  const k = (card(txt).out[0].match(/data-skq-k="([^"]+)"/) || [])[1];
  M.stPut(k, 0);
  const h = card(txt).out[0];
  return /skq-it done wrong/.test(h) && /skq-o no/.test(h) && /skq-o ok/.test(h) && /২\+২=৪/.test(h) && /Sky, এটা বুঝিয়ে বলো/.test(h);
});
t('M12. a finished set shows the score card with retry / wrong-only / more', () => {
  const txt = '১. এক কোনটি?\nক) a\nখ) b\nগ) c\nঘ) d\nউত্তর: ক\n\n২. দুই কোনটি?\nক) a\nখ) b\nগ) c\nঘ) d\nউত্তর: খ';
  const ks = [...card(txt).out[0].matchAll(/data-skq-k="([^"]+)"/g)].map((m) => m[1]);
  M.stPut(ks[0], 0); M.stPut(ks[1], 0);
  const h = card(txt).out[0];
  return /skq-end/.test(h) && /data-skq-reset="all"/.test(h) && /data-skq-reset="wrong"/.test(h) && /➕ আরো প্রশ্ন/.test(h) && /🎯 ১\/২/.test(h);
});
t('M13. no MCQ → text returned unchanged', () => { const s = '## শিরোনাম\nসাধারণ উত্তর।\n- এক\n- দুই'; return E.render(s, () => 'X', {}) === s; });

const CHAT = fs.readFileSync(new URL('./ai-agent-chat.js', import.meta.url), 'utf8');
const TOOLS = fs.readFileSync(new URL('./sky-tools-client.js', import.meta.url), 'utf8');
const AGENT = fs.readFileSync(new URL('./ai-agent.js', import.meta.url), 'utf8');
const IDX = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const SW = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
t('W1. mdRich runs answers through the engine (text + JSON), live while streaming', () => /MCQ\.renderJson\(src, !!live\)/.test(CHAT) && /MCQ\.render\(t,/.test(CHAT) && CHAT.includes('skyLive = 1; b.innerHTML = mdRich(full); skyLive = 0;') && CHAT.includes('live = live || skyLive;'));
t('W2. make_quiz writes an answer line for every question', () => TOOLS.includes("lines.push('   ✅ উত্তর: ' + LET[ansIndex(q)]);"));
t('W3. the model is told the card-friendly MCQ shape', () => /tap-to-answer quiz cards/.test(AGENT) && /✅ উত্তর: <letter>/.test(AGENT));
t('W4. engine loads before the chat and is precached', () => IDX.indexOf('sky-mcq.js?v=mcq1') > 0 && IDX.indexOf('sky-mcq.js?v=mcq1') < IDX.indexOf('ai-agent-chat.js?v=') && SW.includes("'./sky-mcq.js?v=mcq1'"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
