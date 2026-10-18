#!/usr/bin/env python3
"""Sky recall (owner plan step 2, 2026-10-18): when a signed-in student opens
the chat, Sky reminds them of recent mistakes and their weak topic by itself.
Wires sky-recall.mjs into ai-agent.js (agentRecall), public-worker.js
(POST /api/ai/recall) and ai-agent-chat.js (loadRecall on open), and bumps the
chat asset token + SW build. Idempotent: refuses to run twice."""
import re, sys
def rd(p): return open(p, encoding='utf-8').read()
def wr(p, s): open(p, 'w', encoding='utf-8').write(s)
def sub(s, old, new):
    if old not in s: sys.exit('anchor missing: ' + old[:70])
    return s.replace(old, new, 1)

a = rd('ai-agent.js')
if 'agentRecall' in a: sys.exit('already applied')
imp = "import { bumpDailyStats, statsFromTiming } from './sky-daily-report.mjs';\n"
a = sub(a, imp, imp + "/* Sky recall (owner plan step 2): the chat-open reminder. Pure, no model call. */\nimport { buildRecall, sanitizeRecent, RECALL_VERSION } from './sky-recall.mjs';\n")
anchor = "/* ── GET /api/ai/status ---------------------------------------------------- */"
fn = '''/* ── POST /api/ai/recall ---------------------------------------------------- */
/* Sky recall (owner plan step 2, 2026-10-18): when a signed-in student opens the
   chat, Sky reminds them of recent mistakes and their weak topic by itself.
   One memory read, no write, no model call and no AI limit used. Only the
   caller's own memory is read (parseMemory re-checks the owner). Guests get
   nothing. Kill switch: PUB_KV 'sky:recall' = "off". */
export async function agentRecall(request, env, uid) {
  const id = String(uid || '');
  if (!id.startsWith('account-')) return jsonResp({ ok: true, recall: null });
  let off = false;
  try { off = String((await getKv(env && env.PUB_KV, 'sky:recall')) || '').trim().toLowerCase() === 'off'; } catch (_) { off = false; }
  if (off) return jsonResp({ ok: true, recall: null, off: true });
  const body = (await request.json().catch(() => null)) || {};
  const stats = capStats(body && body.stats) || {};
  const recent = sanitizeRecent(body && body.recent);
  const key = 'mem:' + MEMORY_VERSION + ':' + id;
  let raw = null;
  const aiState = aiStateStore(env);
  let fromState = false;
  if (aiState) { try { raw = await aiState.get(id, key); fromState = true; } catch (_) { fromState = false; } }
  if (!fromState) raw = await getKv(env && env.PUB_KV, key);
  let recall = null;
  try { recall = buildRecall({ records: parseMemory(raw, id), stats, recent, now: Date.now() }); } catch (_) { recall = null; }
  return jsonResp({ ok: true, recall, version: RECALL_VERSION });
}

'''
a = sub(a, anchor, fn + anchor)
wr('ai-agent.js', a)

p = rd('public-worker.js')
p = sub(p, "import { agentChat, agentStatus, sanitizeAiPrefs, AI_PREFS_DEFAULT, clearAiMemory } from './ai-agent.js';",
        "import { agentChat, agentStatus, agentRecall, sanitizeAiPrefs, AI_PREFS_DEFAULT, clearAiMemory } from './ai-agent.js';")
anc = "      if (path === '/api/ai/chat' && request.method === 'POST') {"
route = '''      /* Sky recall (owner plan step 2): the reminder shown when the chat opens.
         Signed-in only; a guest or a no-memory session simply gets nothing. */
      if (path === '/api/ai/recall' && request.method === 'POST') {
        const identity = await aiRequestIdentity(request, env, false);
        if (!identity.authenticated || identity.persistMemory === false) return json({ ok: true, recall: null });
        return await agentRecall(request, env, identity.uid);
      }
'''
p = sub(p, anc, route + anc)
wr('public-worker.js', p)

c = rd('ai-agent-chat.js')
css_anchor = "#app.sky .hbig{width:176px;"
c = sub(c, css_anchor,
  "#app.sky .recall{max-width:340px;margin:10px auto 0;padding:12px 14px;border-radius:16px;background:var(--surf);box-shadow:0 0 0 1px var(--line),var(--sh);font-size:14px;line-height:1.55;text-align:center;animation:drop .5s ease both}\n"
  "#app.sky .recall p{margin:0 0 8px}\n"
  "#app.sky .recall .rcc{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}\n"
  "#app.sky .recall button{border:0;border-radius:999px;padding:7px 13px;font:inherit;font-size:13px;font-weight:700;background:var(--line);color:inherit;cursor:pointer}\n"
  + css_anchor)
anc = "  /* ───────── markdown → safe HTML (escape-first) ───────── */"
helpers = '''  /* Sky recall (owner plan step 2): mistakes the student got wrong in the last
     48 h and has not mastered yet. Only a count and the oldest time leave the
     phone — never the question text. */
  function recentMistakes() {
    try {
      if (typeof CACHE === 'undefined' || !Array.isArray(CACHE.mistakes)) return null;
      const cut = Date.now() - 48 * 3600 * 1000;
      let n = 0, since = 0;
      CACHE.mistakes.forEach((m) => {
        if (!m || m.mastered === true || m.revisionStatus === 'mastered') return;
        const t = Number(m.lastWrongAt || m.time || 0);
        if (!(t >= cut)) return;
        n++;
        if (!since || t < since) since = t;
      });
      return { mistakes: n, since: since };
    } catch (_) { return null; }
  }

'''
c = sub(c, anc, helpers + anc)
anc2 = "  function resetHero() {"
lr = '''  /* Sky recall (owner plan step 2): on chat open Sky reminds the student of
     recent mistakes / their weak topic by itself. Signed-in, empty chat only;
     any failure just leaves the normal greeting. Text is always escaped. */
  async function loadRecall() {
    if (!accountScope || !sessions[cur] || sessions[cur].msgs.length) return;
    let rc = null;
    try {
      const r = await fetch('/api/ai/recall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AH-Guest': guestId() },
        body: JSON.stringify({ stats: localStats(), recent: recentMistakes() })
      });
      if (!r.ok) return;
      rc = ((await r.json()) || {}).recall;
    } catch (_) { return; }
    if (!rc || !rc.line || sessions[cur].msgs.length) return;
    const hero = document.getElementById('hero');
    if (!hero || hero.style.display === 'none') return;
    let box = document.getElementById('skyRecall');
    if (!box) { box = document.createElement('div'); box.id = 'skyRecall'; box.className = 'recall'; hero.appendChild(box); }
    const chips = (Array.isArray(rc.chips) ? rc.chips : []).slice(0, 2).map((ch, i) => '<button type="button" data-rc="' + i + '">' + esc(String((ch && ch.label) || '')) + '</button>').join('');
    box.innerHTML = '<p>' + esc(String(rc.line)) + '</p>' + (chips ? '<div class="rcc">' + chips + '</div>' : '');
    box.onclick = (e) => {
      const b = e.target.closest('[data-rc]'); if (!b) return;
      const ch = rc.chips[+b.getAttribute('data-rc')] || {};
      box.remove();
      if (ch.go) { const sb = document.querySelector('[data-go="' + String(ch.go).replace(/[^a-z0-9-]/gi, '') + '"]'); if (sb) sb.click(); else if (window.navigate) window.navigate(ch.go); return; }
      if (ch.q) send(String(ch.q));
    };
    try { mood('wave', 1800); } catch (_) {}
  }
'''
c = sub(c, anc2, lr + anc2)
c = sub(c, "  function resetHero() {\n    const hero = document.getElementById('hero');\n    if (hero) hero.style.display = '';",
        "  function resetHero() {\n    const hero = document.getElementById('hero');\n    if (hero) hero.style.display = '';\n    { const ob = document.getElementById('skyRecall'); if (ob) ob.remove(); }")
anc3 = "    setTimeout(() => { if (!sessions[cur].msgs.length) say(greet, 4200); }, 900);\n"
c = sub(c, anc3, anc3 + "    loadRecall();\n")
wr('ai-agent-chat.js', c)

for f in ['index.html', 'sw.js', 'account-retirement.test.mjs', 'p11-dashboard-v2.test.mjs', 'p21-ai-agent-ui.test.mjs', 'startup-ai-regression.test.mjs']:
    s = rd(f)
    if 'agent-f1-ui-skyv9' not in s: sys.exit('token missing in ' + f)
    wr(f, s.replace('agent-f1-ui-skyv9', 'agent-f1-ui-skyv10'))
s = rd('sw.js')
s = sub(s, "const BUILD_ID = 'v358-clear-stale-exam-cache';", "const BUILD_ID = 'v359-sky-recall';")
wr('sw.js', s)
print('sky recall applied')
