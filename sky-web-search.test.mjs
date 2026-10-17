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
await t('W9. web_search is never a no-model simple plan', () => !T.isSimplePlan([{ name: 'web_search', args: { query: 'x' } }], 'সর্বশেষ খবর'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
