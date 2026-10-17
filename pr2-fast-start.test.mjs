// PR-2 (owner 2026-10-17): the SSE stream opens at once, stages are sent when the
// work really happens, and small talk is answered in the app. Network is mocked.
import { readFileSync } from 'fs';
let pass = 0, fail = 0;
const t = async (n, c) => { try { (await c()) ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n)); } catch (e) { fail++; console.log('  ✗', n, '→', e && e.message); } };
const A = await import('./ai-agent.js');
const gChunk = (text) => 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) + '\n\n';
const sse = (chunks) => new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); } }), { status: 200 });
function stubEnv(slowMs = 0, seed = {}) {
  const store = new Map(Object.entries(seed));
  const kv = { get: async (k) => { if (slowMs && /^chatmem:/.test(k)) await new Promise(r => setTimeout(r, slowMs)); return store.has(k) ? store.get(k) : null; }, put: async (k, v) => { store.set(k, v); } };
  return { env: { PUB_KV: kv, GEMINI_KEYS: 'goodkey00001', AGENT_DAILY_CAP: 50 }, store };
}
const req = (content) => new Request('https://x/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content }] }) });
const stages = (text) => [...text.matchAll(/event: stage\ndata: (.*)\n/g)].map(m => JSON.parse(m[1]).stage);
const real = globalThis.fetch;
globalThis.fetch = async () => sse([gChunk('উত্তর')]);

await t('PR2-১. the response returns before a slow memory read finishes', async () => {
  const { env } = stubEnv(600);
  const t0 = Date.now();
  const r = await A.agentChat(req('নিউটনের সূত্র বুঝাও'), env, 'account-pr2a');
  const back = Date.now() - t0;
  const rd = r.body.getReader();
  const first = new TextDecoder().decode((await rd.read()).value);
  let rest = ''; for (;;) { const s = await rd.read(); if (s.done) break; rest += new TextDecoder().decode(s.value); }
  return r.status === 200 && back < 400 && first.startsWith(': open') && /event: done/.test(first + rest);
});
await t('PR2-২. understand is first; memory stage only when memory really exists', async () => {
  const { env } = stubEnv();
  const a = await (await A.agentChat(req('সন্ধি কী'), env, 'account-pr2b')).text();
  const { env: env2 } = stubEnv(0, { 'chatmem:account-pr2c': JSON.stringify([{ role: 'user', content: 'সমাস' }, { role: 'assistant', content: 'সমাস হলো…' }]) });
  const b = await (await A.agentChat(req('আরেকটা উদাহরণ'), env2, 'account-pr2c')).text();
  const sa = stages(a), sb = stages(b);
  return sa[0] === 'understand' && !sa.includes('memory') && sb.includes('memory') && sb.indexOf('memory') < sb.indexOf('think');
});
await t('PR2-৩. every stage id is sent at most once', async () => {
  const { env } = stubEnv(0, { 'chatmem:account-pr2d': JSON.stringify([{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }]) });
  const s = stages(await (await A.agentChat(req('আবার বলো'), env, 'account-pr2d')).text());
  return s.length === new Set(s).size;
});
await t('PR2-৪. 429 stays a real HTTP status (the limit card needs resetAt)', async () => {
  const { env } = stubEnv(); env.AGENT_DAILY_CAP = 1;
  await (await A.agentChat(req('হ্যালো'), env, 'account-pr2e')).text();
  const r = await A.agentChat(req('হ্যালো'), env, 'account-pr2e');
  const d = await r.json();
  return r.status === 429 && d.resetAt > 0;
});
globalThis.fetch = real;

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)) };
await import('./sky-smalltalk.js');
const S = globalThis.SkySmallTalk;
// 2026-10-17: greet = owner's 20 replies (in the file); everything else comes from the
// owner's big bank sky-replies.json (179 kinds), fetched lazily by the app.
await t('PR2-৫. before the bank loads only greet answers; the rest goes to the AI', () =>
  S.REPLIES.greet.length === 20 && S.reply('ধন্যবাদ') === null
  && S.REPLIES.greet.every(x => x.startsWith('### ') && x.includes('{n}') && !x.includes('……')));
await t('PR2-৫খ. name goes in after a comma; no name means no comma and no placeholder', () => {
  const a = S.reply('hlw', 'রাফি'), b = S.reply('hello');
  return /^### [^\n]+, রাফি!/.test(a) && /^### [^\n,]+!/.test(b) && !/\{n\}|……/.test(b)
    && S.kind('Hi Sky, hello!') === 'greet' && S.kind('হাই স্কাই') === 'greet' && S.kind('hi there') === 'greet';
});
const BANK = JSON.parse(readFileSync('sky-replies.json', 'utf8'));
await t('PR2-৫গ. the owner bank loads: 179 kinds, 5+ replies each, no phone number or email inside', () => {
  const raw = readFileSync('sky-replies.json', 'utf8'), ids = Object.keys(BANK.cats);
  return S.load(BANK) === true && ids.length === 179 && ids.every(k => BANK.cats[k].r.length >= 5 && BANK.cats[k].t.length > 0)
    && !/01\d{9}|@gmail|inflowsky|\.{6}/i.test(raw) && !/\{(?![nmN]\})/.test(raw.replace(/\{"|\{\}/g, ''));
});
await t('PR2-৫ঘ. every trigger reaches its own kind (17 shared triggers resolved once)', () =>
  Object.entries(BANK.cats).every(([id, c]) => c.t.every(x => S.kind(x) === id))
  && S.kind('বুঝেছি') === 'understood' && S.kind('error') === 'server_error' && S.kind('ধন্যবাদ') === 'thanks');
await t('PR2-৫ঙ. support kinds carry the contact buttons; others do not', () => {
  const w = S.replyMsg('whatsapp'), th = S.replyMsg('ধন্যবাদ', 'রাফি');
  return w.contact === true && w.cat === 'whatsapp' && th.contact === false && !/\{[nmN]\}/.test(th.text)
    && Object.entries(BANK.cats).filter(([, c]) => c.c === 1).length === 13;
});
// Rotation/name checks below run on test-only replies (never shipped).
for (const k of Object.keys(S.REPLIES)) for (let i = 0; i < 30; i++) S.REPLIES[k].push('t' + i + '{n}');
await t('PR2-৬. hi / ধন্যবাদ / তুমি কে match; a real question does not', () =>
  S.kind('hi!') === 'greet' && S.kind('হ্যালো ভাই') === 'greet' && S.kind('ধন্যবাদ') === 'thanks' && S.kind('তুমি কে?') === 'who_are_you'
  && S.kind('hi, সন্ধি কী?') === '' && S.kind('সমাস কী') === '' && S.kind('') === '' && S.reply('নিউটনের সূত্র') === null);
await t('PR2-৭. no reply repeats inside one round, and no placeholder is ever left', () => {
  const seen = new Set(); for (let i = 0; i < S.REPLIES.thanks.length; i++) seen.add(S.reply('thanks', 'রাফি'));
  return seen.size === S.REPLIES.thanks.length && [...seen].filter(x => /^t\d/.test(x)).every(x => x.includes('রাফি'))
    && ![...seen].some(x => /\{[nmN]\}/.test(x)) && !S.reply('hello').includes('{n}');
});
await t('PR2-৮. replies never name an AI model or provider', () =>
  !Object.values(S.REPLIES).flat().some(x => /gemini|groq|gpt|openai|llama/i.test(x)));
const UI = readFileSync('ai-agent-chat.js', 'utf8');
const sendSrc = UI.slice(UI.indexOf('async function send(text)'));
await t('PR2-৯. the chat waits briefly for the bank and answers small talk before any server call', () =>
  sendSrc.indexOf('ST.ready(800)') > 0 && sendSrc.indexOf('ST.replyMsg(') > sendSrc.indexOf('ST.ready(800)')
  && sendSrc.indexOf('ST.replyMsg(') < sendSrc.indexOf('await ask('));
const H = readFileSync('index.html', 'utf8'), W = readFileSync('sw.js', 'utf8');
await t('PR2-১০. sky-smalltalk.js loads before the chat; it and the bank are precached', () =>
  H.indexOf('sky-smalltalk.js?v=st2') > 0 && H.indexOf('sky-smalltalk.js?v=st2') < H.indexOf('ai-agent-chat.js?v=')
  && W.includes("'./sky-smalltalk.js?v=st2'") && W.includes("'./sky-replies.json?v=r1'")
  && readFileSync('sky-smalltalk.js', 'utf8').includes("'./sky-replies.json?v=r1'"));

console.log(`\n${fail ? '❌' : '✅'} PR-2 fast start: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
