// owner 2026-10-18: web_search (Tavily) — only news/recent questions, daily cap,
// no student data leaves the server, sources cited, kill switch. Network mocked.
let pass = 0, fail = 0;
const t = async (n, c) => { try { (await c()) ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n)); } catch (e) { fail++; console.log('  ✗', n, '→', e && e.message); } };
const T = await import('./sky-tools.mjs');
const R = await import('./tool-registry.js');
const kvOf = (seed = {}) => { const m = new Map(Object.entries(seed)); return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); } }; };
let sent = [];
globalThis.fetch = async (url, init) => { sent.push({ url: String(url), init }); return new Response(JSON.stringify({ results: [
  { title: 'ঢাবি ভর্তি বিজ্ঞপ্তি', url: 'https://example.com/a', content: 'ভর্তি পরীক্ষা শুরু হবে' },
  { title: 'bad', url: 'javascript:alert(1)', content: 'x' }] }), { status: 200 }); };
const env = { TAVILY_API_KEY: 'tvly-test', TAVILY_DAILY_CAP: 2 };

await t('W1. web_search is a declared server tool + registry entry is READ, owner-scoped, valid', () =>
  T.TOOL_NAMES.includes('web_search') && !T.CLIENT_TOOLS.includes('web_search') && R.getTool('web.search').permission === 'read' && R.validateToolRegistry().length === 0);
await t('W2. plans only for news / recent questions, and only with a key', () =>
  T.planServerTools('ঢাবি ভর্তির সর্বশেষ খবর কী?', { searchOn: true }).some(p => p.name === 'web_search')
  && T.planServerTools('latest news about HSC result', { searchOn: true }).some(p => p.name === 'web_search')
  && !T.planServerTools('ঢাবি ভর্তির সর্বশেষ খবর কী?', {}).some(p => p.name === 'web_search')
  && !T.planServerTools('সমাস কাকে বলে?', { searchOn: true }).some(p => p.name === 'web_search')
  && !T.planServerTools('আমার সর্বশেষ পরীক্ষার ফল', { searchOn: true }).some(p => p.name === 'web_search')
  && !T.planServerTools('সর্বশেষ খবর কী?', { searchOn: true, quizMode: true }).some(p => p.name === 'web_search'));
await t('W3. no email, phone, link or name in the query', () => {
  const q = T.cleanSearchQuery('রাহিম bob@x.com 01712345678 https://a.b/c ২০২৬ সালের ভর্তি খবর', 'রাহিম');
  return !/@|0171|https|রাহিম/.test(q) && /২০২৬/.test(q) && /ভর্তি খবর/.test(q);
});
await t('W4. only the cleaned query goes to Tavily (no stats / uid); key in header', async () => {
  sent = []; const kv = kvOf();
  const r = await T.runTools([[{ name: 'web_search', args: { query: 'সর্বশেষ ভর্তি খবর' } }]], { env, kv, stats: { exams: 4 }, firstName: 'রাহিম' });
  const b = JSON.parse(sent[0].init.body);
  return r.results[0].ok && sent[0].url === 'https://api.tavily.com/search' && Object.keys(b).every(k => !/uid|stats|user|name/i.test(k))
    && b.query === 'সর্বশেষ ভর্তি খবর' && !('api_key' in b) && sent[0].init.headers.Authorization === 'Bearer tvly-test';
});
await t('W5. unsafe links dropped; context asks for source links', async () => {
  const r = await T.webSearch('সর্বশেষ ভর্তি খবর', { env, kv: kvOf() });
  const c = T.renderToolContext([Object.assign({ name: 'web_search' }, r)]);
  return r.results.length === 1 && c.includes('https://example.com/a') && c.includes('উৎস') && !c.includes('javascript:');
});
await t('W6. daily cap: 3rd call of the day is refused without a network call', async () => {
  const kv = kvOf(); sent = [];
  const a = await T.webSearch('সর্বশেষ খবর', { env, kv }); const b = await T.webSearch('সর্বশেষ খবর', { env, kv }); const c = await T.webSearch('সর্বশেষ খবর', { env, kv });
  return a.ok && b.ok && !c.ok && c.error === 'daily-limit' && sent.length === 2;
});
await t('W7. kill switch + no key = no network call', async () => {
  sent = [];
  const off = await T.webSearch('সর্বশেষ খবর', { env, kv: kvOf({ 'sky:web-search': 'off' }) });
  const nokey = await T.webSearch('সর্বশেষ খবর', { env: {}, kv: kvOf() });
  return off.error === 'off' && nokey.error === 'no-key' && sent.length === 0;
});
await t('W8. a failing search never breaks the run', async () => {
  globalThis.fetch = async () => { throw new Error('down'); };
  const r = await T.runTools([[{ name: 'web_search', args: { query: 'সর্বশেষ খবর' } }, { name: 'calculate', args: { expression: '2+2' } }]], { env, kv: kvOf() });
  return r.results.length === 2 && !r.results[0].ok && r.results[1].ok;
});
await t('W10. admission date / schedule questions search; history and study questions do not', () => {
  const on = (q) => T.planServerTools(q, { searchOn: true }).some(p => p.name === 'web_search');
  return ['ঢাবি ভর্তি পরীক্ষা কবে?', 'ঢাকা বিশ্ববিদ্যালয়ের ভর্তি পরীক্ষার তারিখ কবে', 'ঢাবি ভর্তি পরীক্ষার সময়সূচী', 'গুচ্ছ আবেদন কবে শুরু', 'when is the DU admission exam'].every(on)
    && !['পলাশীর যুদ্ধ কবে হয়েছিল?', 'কবে আমার পরীক্ষা ছিল', 'সমাস কাকে বলে', 'বাংলাদেশের রাজধানী কোথায়'].some(on);
});
await t('W11. the outer worker passes the Tavily key to the chat handler (envPub whitelist)', async () => {
  const { readFileSync } = await import('fs');
  const src = readFileSync('gk-agent-worker.js', 'utf8');
  const i = src.indexOf('const envPub = {'); const j = src.indexOf('};', i);
  const block = src.slice(i, j);
  return /TAVILY_API_KEY:\s*env\.TAVILY_API_KEY/.test(block) && /TAVILY_DAILY_CAP:\s*env\.TAVILY_DAILY_CAP/.test(block)
    && readFileSync('worker-bundle.mjs', 'utf8').includes('TAVILY_API_KEY: env.TAVILY_API_KEY');
});
await t('W12. a short follow-up after a news question searches again, with the earlier topic', () => {
  const prev = 'রাজশাহী বিশ্ববিদ্যালয়ের ভর্তি পরীক্ষা কবে';
  const a = T.planServerTools('পরের বছরেরটা কবে হবে', { searchOn: true, prevText: prev }).find(x => x.name === 'web_search');
  const b = T.planServerTools('তাহলে ২০২৬-২৭ এর টা কবে?', { searchOn: true, prevText: prev }).find(x => x.name === 'web_search');
  const c = T.planServerTools('না আমি পরের বছরের টা জানতে চাচ্ছি', { searchOn: true, prevText: prev }).find(x => x.name === 'web_search');
  const none = T.planServerTools('পরের বছরেরটা কবে হবে', { searchOn: true, prevText: 'সমাস কাকে বলে' }).some(x => x.name === 'web_search');
  const own = T.planServerTools('ঢাকা বিশ্ববিদ্যালয়ের ভর্তি পরীক্ষা কবে', { searchOn: true, prevText: prev }).find(x => x.name === 'web_search');
  return a && a.args.query.includes('রাজশাহী') && b && b.args.query.includes('রাজশাহী') && b.args.query.includes('২০২৬-২৭')
    && c && c.args.query.includes('রাজশাহী') && !/আমি/.test(c.args.query) && !none && own && !own.args.query.includes('রাজশাহী');
});
await t('W13. "আমার" + admission date still searches; own-result questions do not', () =>
  T.isNewsQuestion('আমার জন্য পরবর্তী ভর্তি পরীক্ষা কবে') && !T.isNewsQuestion('আমার রেজাল্ট কেমন') && !T.isNewsQuestion('আমার সর্বশেষ পরীক্ষার স্কোর'));
await t('W14. a failed / empty search tells the model not to answer from memory', () => {
  const f = T.renderToolContext([{ name: 'web_search', ok: false, error: 'daily-limit' }]);
  const e = T.renderToolContext([{ name: 'web_search', ok: true, query: 'x', results: [] }]);
  return /could not run/.test(f) && /found no result/.test(e) && /has not been published/.test(f);
});
await t('W15. the chat passes the previous user turn to the planner', async () => {
  const { readFileSync } = await import('fs');
  return /planServerTools\(toolText, \{ prevText: prevUser/.test(readFileSync('ai-agent.js', 'utf8'));
});
await t('W16. a session year (২০২৬-২৭, 2025-2026) stays in the query; phone numbers still go', async () => {
  const { cleanSearchQuery: c } = await import('./sky-web-search.mjs');
  return c('রাবি ২০২৫-২০২৬ ভর্তি') === 'রাবি ২০২৫-২০২৬ ভর্তি' && c('২০২৬-২৭ সেশন') === '২০২৬-২৭ সেশন'
    && c('call +8801712345678 now') === 'call now' && c('01712 345 678 ফোন') === 'ফোন';
});
await t('W9. web_search is never a no-model simple plan', () => !T.isSimplePlan([{ name: 'web_search', args: { query: 'x' } }], 'সর্বশেষ খবর'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
