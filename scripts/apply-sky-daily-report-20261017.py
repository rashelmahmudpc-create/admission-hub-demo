#!/usr/bin/env python3
"""Anonymous daily AI report (owner 2026-10-17). Safe to run twice.
- ai-state-do.mjs: /stats/bump and /stats/get (whitelisted numeric counters).
- ai-agent.js: each finished request adds counts (no uid/text) via bumpDailyStats.
- gk-agent-worker.js: the per-minute cron builds the report at UTC 18:00.
- public-worker.js: GET /api/admin/ai-daily-report (admin token).
- students-control-center.html: a "Sky AI · দৈনিক রিপোর্ট" card."""
import sys
def rd(p): return open(p, encoding='utf-8').read()
def wr(p, s): open(p, 'w', encoding='utf-8').write(s)
def need(c, msg):
    if not c: sys.exit('apply failed: ' + msg)
def once(s, a, b, msg):
    need(s.count(a) == 1, msg)
    return s.replace(a, b, 1)

# ai-state-do.mjs
d = rd('ai-state-do.mjs')
if '/stats/bump' not in d:
    d = once(d, "  async fetch(request) {\n", """  /* Anonymous daily AI counters (sky-daily-report.mjs). Only whitelisted
     numeric fields are kept; a day expires after 40 days. Single-threaded, so
     the read-modify-write needs no lock. */
  async bumpStats({ day, inc }) {
    const d = String(day || '').slice(0, 10);
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(d)) return { ok: false };
    const clean = cleanInc(inc);
    const key = 'stats:' + d;
    const cur = (await this.#entry(key)) || { v: {} };
    const v = Object.assign({}, cur.v || {});
    for (const k of Object.keys(clean)) v[k] = num(v[k]) + clean[k];
    await this.ctx.storage.put(key, { v, exp: Date.now() + 40 * 86400000 });
    return { ok: true };
  }

  async getStats({ day }) {
    const entry = await this.#entry('stats:' + String(day || '').slice(0, 10));
    return { stats: entry ? cleanInc(entry.v) : {} };
  }

  async fetch(request) {
""", 'do fetch anchor')
    d = once(d, "        case '/rate/consume': return json(await this.consumeRate(body));\n",
             "        case '/rate/consume': return json(await this.consumeRate(body));\n        case '/stats/bump': return json(await this.bumpStats(body));\n        case '/stats/get': return json(await this.getStats(body));\n", 'do route anchor')
    d = once(d, "export const AI_STATE_VERSION = 'ai-state-v1';\n",
             "import { cleanInc } from './sky-daily-report.mjs';\n\nexport const AI_STATE_VERSION = 'ai-state-v1';\n", 'do version anchor')
    wr('ai-state-do.mjs', d)

# ai-agent.js
a = rd('ai-agent.js')
if 'sky-daily-report.mjs' not in a:
    a = once(a, "import { isAppFeatureQuestion, loadAppFeatures, renderAppFeatures } from './sky-app-features.mjs';\n",
             "import { isAppFeatureQuestion, loadAppFeatures, renderAppFeatures } from './sky-app-features.mjs';\nimport { bumpDailyStats, statsFromTiming } from './sky-daily-report.mjs';\n", 'import anchor')
    old = "    try { console.log(JSON.stringify({ evt: 'ai.timing', agent: AGENT_VERSION, totalMs: Date.now() - startedAt, ...timings, ...extra })); } catch (_) {}\n"
    a = once(a, old, old + "    /* Anonymous daily report (owner 2026-10-17): counts only — no uid, no text. */\n    try { bumpDailyStats(env, statsFromTiming({ totalMs: Date.now() - startedAt, ...timings, ...extra })).catch(() => {}); } catch (_) {}\n", 'emitTiming anchor')
    lim = "    const resetAt = (quota.start || now) + RL_WINDOW_MS;\n"
    a = once(a, lim, lim + "    try { bumpDailyStats(env, statsFromTiming({ limited: true })).catch(() => {}); } catch (_) {}\n", 'limit anchor')
    wr('ai-agent.js', a)

# gk-agent-worker.js
g = rd('gk-agent-worker.js')
if 'runDailyReport' not in g:
    g = once(g, "import pubHandler, { publishGlobal } from './public-worker.js';\n",
             "import pubHandler, { publishGlobal } from './public-worker.js';\nimport { runDailyReport } from './sky-daily-report.mjs';\n", 'gk import anchor')
    g = once(g, "    try { await runScheduledDigests(env); } catch (_) {}\n",
             "    try { await runScheduledDigests(env); } catch (_) {}\n    /* Anonymous daily AI report (owner 2026-10-17): built once at Bangladesh\n       midnight (UTC 18:00) from counts only; read in the Control Center. */\n    try { await runDailyReport(env); } catch (_) {}\n", 'scheduled anchor')
    wr('gk-agent-worker.js', g)

# public-worker.js
p = rd('public-worker.js')
if 'ai-daily-report' not in p:
    p = once(p, "import { recordError, summarizeErrors } from './p19-error-monitor.mjs';\n",
             "import { recordError, summarizeErrors } from './p19-error-monitor.mjs';\nimport { listReports } from './sky-daily-report.mjs';\n", 'pw import anchor')
    p = once(p, "  if (path === '/api/admin/errors' && request.method === 'GET') {\n",
             """  if (path === '/api/admin/ai-daily-report' && request.method === 'GET') {
    /* Anonymous daily AI report — counts only, newest first. */
    const days = new URL(request.url).searchParams.get('days');
    return json(await listReports(env.PUB_KV, days || 7));
  }
  if (path === '/api/admin/errors' && request.method === 'GET') {
""", 'pw route anchor')
    wr('public-worker.js', p)

# students-control-center.html
h = rd('students-control-center.html')
if 'ai-report' not in h:
    h = once(h, '<section class="card"><h2>সংখ্যা</h2><div class="stats" id="stats"></div></section>\n',
             '<section class="card"><h2>সংখ্যা</h2><div class="stats" id="stats"></div></section>\n      <section class="card" id="ai-report"><h2>Sky AI · দৈনিক রিপোর্ট (পরিচয়হীন)</h2><p class="lead">প্রতি রাত ১২টায় (বাংলাদেশ সময়) আগের দিনের হিসাব। শুধু সংখ্যা: কারো নাম, প্রশ্ন বা ID নেই।</p><div id="ai-report-body">লোড হচ্ছে…</div></section>\n', 'cc section anchor')
    h = once(h, "  const load=async(append=false)=>{",
             """  const loadAiReport=async()=>{const box=$('#ai-report-body');if(!box)return;try{const r=await fetch('/api/admin/ai-daily-report?days=7',{credentials:'same-origin',cache:'no-store',headers:{'Authorization':'Bearer '+token}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error('x');const rows=Array.isArray(d.reports)?d.reports:[];if(!rows.length){box.replaceChildren(el('p','এখনো কোনো রিপোর্ট তৈরি হয়নি। প্রথম রিপোর্ট আসবে রাত ১২টার পরে।','lead'));return}const sec=ms=>ms==null?'—':(ms/1000).toFixed(1)+'s';box.replaceChildren(table(['দিন','মোট অনুরোধ','উত্তর','AI / ক্যাশ / টুল','ব্যর্থ','লিমিট শেষ','গড় সময়','প্রথম শব্দ','২s-এর কম'],rows.map(x=>[x.day,x.totals.requests,x.totals.answered+' ('+x.shares.successPct+'%)',x.answeredBy.model+' / '+x.answeredBy.cache+' / '+x.answeredBy.tools,x.totals.failed,x.totals.dailyLimitReached,sec(x.speed.avgMs),sec(x.speed.firstWordAvgMs),x.speed.under2sPct+'%'])))}catch(_){box.replaceChildren(el('p','রিপোর্ট আনা যায়নি (admin token বা server)।','lead'))}};
  const load=async(append=false)=>{""", 'cc load anchor')
    h = once(h, "try{await load()}catch(e){token=''", "try{await load();loadAiReport()}catch(e){token=''", 'cc connect anchor')
    wr('students-control-center.html', h)
import re, hashlib, base64
def cs(x): return 'sha256-' + base64.b64encode(hashlib.sha256(x.encode('utf-8')).digest()).decode()
h = rd('students-control-center.html')
new_hash = cs(re.search(r'<script>([\s\S]*?)</script>', h).group(1))
hd = rd('_headers')
if new_hash not in hd:
    import subprocess
    old_page = subprocess.run(['git', 'show', 'HEAD:students-control-center.html'], capture_output=True, text=True).stdout
    m = re.search(r'<script>([\s\S]*?)</script>', old_page)
    need(m, 'old script')
    old_hash = cs(m.group(1))
    need(old_hash in hd, 'old CSP hash in _headers')
    wr('_headers', hd.replace(old_hash, new_hash))
print('applied')
