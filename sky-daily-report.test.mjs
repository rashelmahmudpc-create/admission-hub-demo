// Anonymous daily AI report (owner 2026-10-17): counts only, built at UTC 18:00,
// once a day, read by the admin route. Durable Object and KV are faked.
import { readFileSync } from 'fs';
let pass = 0, fail = 0;
const t = async (n, c) => { try { (await c()) ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n)); } catch (e) { fail++; console.log('  ✗', n, '→', e && e.message); } };
const R = await import('./sky-daily-report.mjs');
const { AiStateObject } = await import('./ai-state-do.mjs');

function fakeDO() {
  const objs = new Map();
  const ns = {
    idFromName: (n) => n,
    get: (id) => {
      if (!objs.has(id)) { const m = new Map(); objs.set(id, new AiStateObject({ storage: { get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); }, delete: async (k) => m.delete(k) } }, {})); }
      const o = objs.get(id); return { fetch: (req) => o.fetch(req) };
    }
  };
  return { ns, objs };
}
function fakeKV() { const m = new Map(); let writes = 0; return { m, get writes() { return writes; }, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { writes++; m.set(k, v); } }; }
const at = (h, mi, day = 17) => Date.UTC(2026, 9, day, h, mi);

await t('R1. Dhaka day: UTC 17:59 is still the 17th, 18:00 is the 18th', () => R.dhakaDay(at(17, 59)) === '2026-10-17' && R.dhakaDay(at(18, 0)) === '2026-10-18');
await t('R2. only whitelisted numeric counters survive (no uid, no text)', () => {
  const c = R.cleanInc({ requests: 1, uid: 'account-x', question: 'সমাস কী', out_model: '2', evil: 9, lat_sum_ms: -5 });
  return JSON.stringify(c) === '{"requests":1,"out_model":2}';
});
await t('R3. timing → counts for model / cache / tools / failed / limit', () => {
  const m = R.statsFromTiming({ totalMs: 1800, firstToken: 600, cache: 'off', provider: 'gemini' });
  const c = R.statsFromTiming({ totalMs: 40, cache: 'strict' });
  const tl = R.statsFromTiming({ totalMs: 5, tools: 1, quota: false });
  const f = R.statsFromTiming({ failed: true, totalMs: 9000 });
  const l = R.statsFromTiming({ limited: true });
  return m.out_model && m.prov_gemini && m.lat_lt2 && m.ft_n && c.out_cache && !c.prov_gemini && tl.out_tools && f.out_failed && !f.lat_ge5 && l.out_limited && !l.out_model;
});
await t('R4. bumps add up in the Durable Object, per Dhaka day', async () => {
  const { ns } = fakeDO(); const env = { AI_STATE: ns };
  await R.bumpDailyStats(env, R.statsFromTiming({ totalMs: 1000, cache: 'off', provider: 'groq' }), at(10, 0));
  await R.bumpDailyStats(env, R.statsFromTiming({ totalMs: 3000, cache: 'off', provider: 'gemini' }), at(11, 0));
  await R.bumpDailyStats(env, R.statsFromTiming({ limited: true }), at(12, 0));
  await R.bumpDailyStats(env, R.statsFromTiming({ totalMs: 1000 }), at(19, 0)); /* next Dhaka day */
  const s = await R.readDailyStats(env, '2026-10-17');
  return s.requests === 3 && s.out_model === 2 && s.out_limited === 1 && s.prov_groq === 1 && s.lat_sum_ms === 4000 && (await R.readDailyStats(env, '2026-10-18')).requests === 1;
});
await t('R5. no AI_STATE binding → bump is a silent no-op', async () => (await R.bumpDailyStats({}, { requests: 1 })) === false);
await t('R6. report: shares and averages are right', () => {
  const r = R.buildReport('2026-10-17', { requests: 10, out_model: 6, out_cache: 1, out_tools: 1, out_failed: 1, out_limited: 1, lat_n: 8, lat_sum_ms: 16000, lat_lt2: 4, ft_n: 6, ft_sum_ms: 3000 });
  return r.anonymous && r.totals.answered === 8 && r.shares.successPct === 88.9 && r.speed.avgMs === 2000 && r.speed.firstWordAvgMs === 500 && r.speed.under2sPct === 50;
});
await t('R7. cron: nothing before 18:00 or after the 10-minute window', async () => {
  const kv = fakeKV(); const { ns } = fakeDO(); const env = { PUB_KV: kv, AI_STATE: ns };
  const a = await R.runDailyReport(env, at(17, 59)), b = await R.runDailyReport(env, at(18, 10)), c = await R.runDailyReport(env, at(9, 0));
  return a.skipped === 'not-time' && b.skipped === 'not-time' && c.skipped === 'not-time' && kv.writes === 0;
});
await t('R8. cron at 18:00 UTC writes the report for the day that just ended, once', async () => {
  const kv = fakeKV(); const { ns } = fakeDO(); const env = { PUB_KV: kv, AI_STATE: ns };
  await R.bumpDailyStats(env, R.statsFromTiming({ totalMs: 1200, cache: 'off', provider: 'gemini' }), at(15, 0));
  const r1 = await R.runDailyReport(env, at(18, 0));
  const r2 = await R.runDailyReport(env, at(18, 1));
  const r3 = await R.runDailyReport(env, at(18, 2));
  const saved = JSON.parse(kv.m.get(R.REPORT_KEY('2026-10-17')));
  return r1.ok && r1.day === '2026-10-17' && r2.skipped === 'done' && r3.skipped === 'done' && saved.totals.requests === 1 && kv.writes === 2;
});
await t('R9. a missed 18:00 tick is caught at 18:05 for the same day', async () => {
  const kv = fakeKV(); const { ns } = fakeDO();
  const r = await R.runDailyReport({ PUB_KV: kv, AI_STATE: ns }, at(18, 5));
  return r.ok && r.day === '2026-10-17';
});
await t('R10. the saved report holds no identity', async () => {
  const kv = fakeKV(); const { ns } = fakeDO(); const env = { PUB_KV: kv, AI_STATE: ns };
  await R.bumpDailyStats(env, { requests: 1, uid: 'account-secret', email: 'a@b.com' }, at(15, 0));
  await R.runDailyReport(env, at(18, 0));
  const raw = kv.m.get(R.REPORT_KEY('2026-10-17'));
  return !/account-|@|uid|email/.test(raw);
});
await t('R11. listReports: newest first, capped', async () => {
  const kv = fakeKV(); const { ns } = fakeDO(); const env = { PUB_KV: kv, AI_STATE: ns };
  for (const day of [15, 16, 17]) await R.runDailyReport(env, at(18, 0, day));
  const l = await R.listReports(kv, 2);
  return l.reports.length === 2 && l.reports[0].day === '2026-10-17' && l.reports[1].day === '2026-10-16';
});
await t('R12. Durable Object rejects a bad day key', async () => {
  const { ns } = fakeDO();
  const r = await (await ns.get('x').fetch(new Request('https://ai-state/stats/bump', { method: 'POST', body: JSON.stringify({ day: '../evil', inc: { requests: 1 } }) }))).json();
  return r.ok === false;
});

console.log('wiring');
const agent = readFileSync('./ai-agent.js', 'utf8'), gk = readFileSync('./gk-agent-worker.js', 'utf8'), pw = readFileSync('./public-worker.js', 'utf8'), cc = readFileSync('./students-control-center.html', 'utf8'), bundle = readFileSync('./worker-bundle.mjs', 'utf8');
await t('W1. every finished chat request and the daily-limit reply are counted', () => /bumpDailyStats\(env, statsFromTiming\(\{ totalMs/.test(agent) && /statsFromTiming\(\{ limited: true \}\)/.test(agent));
await t('W2. the cron runs the report', () => /await runDailyReport\(env\)/.test(gk));
await t('W3. admin route sits behind the admin token check', () => { const a = pw.indexOf('const admin = async'), r = pw.indexOf("'/api/admin/ai-daily-report'"); return a > 0 && r > a; });
await t('W4. Control Center card reads the route with the admin token', () => /id="ai-report"/.test(cc) && /\/api\/admin\/ai-daily-report\?days=7/.test(cc) && /'Bearer '\+token/.test(cc));
await t('W5. worker bundle carries the report', () => /sky-daily-report-v1/.test(bundle) && /\/stats\/bump/.test(bundle));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
