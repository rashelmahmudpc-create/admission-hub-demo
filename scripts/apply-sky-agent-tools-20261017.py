#!/usr/bin/env python3
"""Agent phase 1 (owner 2026-10-17). Safe to run twice.
- ai-agent.js: server tools (sky-tools.mjs). A simple question (arithmetic,
  "how am I doing") is answered by the tools BEFORE the AI limit is charged;
  other planned tools run in the open stream with real stages and their
  results go into the prompt (never into the shared cache).
- ai-agent-chat.js: in-app tools (sky-tools-client.js) after small talk and
  shared answers; proc panel shows the tools; quiz kept for grading; an
  open_page button.
- index.html + sw.js: load/precache sky-tools-client.js."""
import sys, re
def rd(p): return open(p, encoding='utf-8').read()
def wr(p, s): open(p, 'w', encoding='utf-8').write(s)
def need(c, msg):
    if not c: sys.exit('apply failed: ' + msg)
V = 'tools1'

# ── ai-agent.js ──
a = rd('ai-agent.js')
if 'sky-tools.mjs' not in a:
    imp = "import { isAppFeatureQuestion, loadAppFeatures, renderAppFeatures } from './sky-app-features.mjs';\n"
    need(imp in a, 'app-features import')
    a = a.replace(imp, imp + "import { planServerTools, isSimplePlan, simpleToolResponse, runTools, renderToolContext, toolsEnabled } from './sky-tools.mjs';\n", 1)

    rl = "  /* rate limit: প্রতি-user rolling 24h window-এ cap */\n"
    need(a.count(rl) == 1, 'rate-limit anchor')
    a = a.replace(rl, """  /* Agent phase 1 (owner 2026-10-17): server tools. The plan is pure (no I/O).
     A simple plan (pure arithmetic, a short "how am I doing") is answered here
     by the tools alone: no model call and no AI limit used. Never during a
     running mock exam. Kill switch: PUB_KV 'sky:agent-tools' = "off". */
  const toolText = String((v.messages[v.messages.length - 1] || {}).content || '');
  let toolPlan = examMode ? [] : planServerTools(toolText, { quizMode, hasImage: v.messages.some(m => m.image) });
  if (toolPlan.length && !(await toolsEnabled(env && env.PUB_KV))) toolPlan = [];
  if (toolPlan.length && isSimplePlan(toolPlan, toolText)) {
    const prof = sanitizeProfileContext(body && body.context && body.context.profile) || {};
    const tr = await simpleToolResponse(toolPlan, stream, { intent, pv: SYSTEM_PROMPT_V, agent: AGENT_VERSION, firstName: prof.firstName, stats, kv: env && env.PUB_KV }).catch(() => null);
    if (tr) { mark('tools'); emitTiming({ tools: toolPlan.length, quota: false }); return tr; }
  }

""" + rl, 1)

    af = "  if (appFeatureHit) sys = sys + '\\n\\n' + renderAppFeatures(await appFeaturesP);\n  const chatCacheOn = chatCacheEnabled(env) && env && env.PROFILE_DB && !appFeatureHit;\n"
    need(a.count(af) == 1, 'app-features prompt anchor')
    a = a.replace(af, """  if (appFeatureHit) sys = sys + '\\n\\n' + renderAppFeatures(await appFeaturesP);
  /* Agent phase 1: the other planned server tools (≤5 tools, ≤3 steps, 20 s).
     Each sends its own live stage; results are personal, so never cached. */
  const extraTools = toolPlan.filter(p => p.name !== 'get_app_features');
  let toolCtxUsed = false;
  if (extraTools.length) {
    try {
      const tr = await runTools([extraTools], { stats, kv: env && env.PUB_KV, onStage: prepStage });
      const block = renderToolContext(tr.results);
      if (block) { sys = sys + '\\n\\n' + block; toolCtxUsed = true; }
      mark('tools');
    } catch (_) { /* answer without tools */ }
  }
  const chatCacheOn = chatCacheEnabled(env) && env && env.PROFILE_DB && !toolCtxUsed && !appFeatureHit;
""", 1)
    wr('ai-agent.js', a)

# ── ai-agent-chat.js ──
j = rd('ai-agent-chat.js')
if 'window.SkyTools' not in j:
    hold = "    const holder = { role: 'ai', text: '', ts: Date.now(), pending: true, stage: T.stageRead, steps: [] };\n"
    need(j.count(hold) == 1, 'holder anchor')
    j = j.replace(hold, """    /* Agent phase 1 (owner 2026-10-17): in-app tools (sky-tools-client.js) —
       question bank search, quiz, quiz grading, knowledge lookup, open a page.
       Instant, no server call, no AI limit. The proc panel lists the tools. */
    if (window.SkyTools) {
      const tq0 = Date.now();
      const prevQuiz = (() => { const ms = sessions[cur].msgs; for (let i = ms.length - 2; i >= 0; i--) { if (ms[i].role === 'ai') return ms[i].quiz || null; } return null; })();
      let tr = null;
      try { tr = window.SkyTools.run(t, { lastQuiz: prevQuiz }); } catch (_) { tr = null; }
      if (tr && tr.text) {
        const m = { role: 'ai', text: tr.text, ts: Date.now(), local: true, steps: tr.steps || [], secs: Math.max(0.1, (Date.now() - tq0) / 1000).toFixed(1), tools: tr.tools || [] };
        if (tr.quiz) m.quiz = tr.quiz;
        if (tr.go) { m.go = tr.go; m.goName = tr.goName || ''; }
        if (tr.faq) { m.faq = tr.faq; m.q = tr.q; }
        sessions[cur].msgs.push(m);
        save(); renderMsgs(); mood('happy', 1200);
        return;
      }
    }
""" + hold, 1)

    fn = "  function bubble(m, idx) {\n"
    need(j.count(fn) == 1, 'bubble anchor')
    j = j.replace(fn, """  /* Agent phase 1: open_page button. */
  function goNote(m) {
    if (!m.go || m.pending || !/^[a-z0-9-]{2,40}$/.test(String(m.go))) return '';
    return '<div class="faqm"><span>🧭 ' + esc(m.goName || '') + '</span><button data-tgo="' + esc(m.go) + '">খুলে দাও →</button></div>';
  }
""" + fn, 1)

    tail = "'</div>' + faqNote(m) + acts + '</div>';"
    need(j.count(tail) == 1, 'bubble tail anchor')
    j = j.replace(tail, "'</div>' + goNote(m) + faqNote(m) + acts + '</div>';", 1)

    clk = "      const q = e.target.closest('[data-q]');\n      if (q) { closeLayers(); send(q.getAttribute('data-q')); return; }\n"
    need(j.count(clk) == 1, 'click anchor')
    j = j.replace(clk, clk.replace("      const q =", """      const tg = e.target.closest('[data-tgo]');
      if (tg) {
        const p = tg.getAttribute('data-tgo');
        const sb = document.querySelector('[data-go="' + p + '"]');
        if (sb) { sb.click(); return; }
        closeLayers(); layer(false);
        try {
          document.documentElement.classList.remove('ai-chat-open');
          const a = document.getElementById('app'); if (a) { a.classList.remove('ai-chat-open', 'sky'); ['height', 'top', 'bottom', 'paddingBottom'].forEach((k) => { a.style[k] = ''; }); } try { syncAppChrome(); } catch (_) {}
          const nb = document.querySelector('.bottomnav'); if (nb) nb.style.display = '';
        } catch (_) {}
        if (window.navigate) window.navigate(p); else location.hash = p;
        return;
      }
      const q =""", 1), 1)
    wr('ai-agent-chat.js', j)

# ── index.html + sw.js ──
h = rd('index.html')
if 'sky-tools-client.js' not in h:
    anchor = '<script defer src="./sky-faq-gk.js?v=faq1"></script>\n'
    need(anchor in h, 'index.html anchor')
    h = h.replace(anchor, anchor + '<script defer src="./sky-tools-client.js?v=' + V + '"></script>\n', 1)
    wr('index.html', h)
w = rd('sw.js')
if 'sky-tools-client.js' not in w:
    m = re.search(r"'\./sky-faq-gk\.js\?v=faq1',?", w)
    need(m, 'sw.js precache anchor')
    seg = m.group(0)
    add = "'./sky-tools-client.js?v=" + V + "'"
    w = w.replace(seg, (seg if seg.endswith(',') else seg + ',') + '\n  ' + add + ',', 1)
    wr('sw.js', w)
m6 = rd('phase9-m6-tool-registry.test.mjs')
old = "t('M6-১৩. the chat path does not invoke the tool registry (no execution wired)', (() => {\n  const agentSrc = readFileSync('ai-agent.js', 'utf8');\n  return typeof T.authorizeToolCall === 'function'\n    && !agentSrc.includes('authorizeToolCall')\n    && !/executeTool|runTool|invokeTool/i.test(agentSrc)\n    && agentSrc.includes('listTools');\n})());"
if old in m6:
    m6 = m6.replace(old, "/* Agent phase 1 (owner 2026-10-17): tools now run, but only through the READ-only,\n   owner-scoped runner in sky-tools.mjs — never by a name the model supplies. */\nt('M6-১৩. the chat path runs tools only through sky-tools.mjs (READ-only runner)', (() => {\n  const agentSrc = readFileSync('ai-agent.js', 'utf8');\n  const toolsSrc = readFileSync('sky-tools.mjs', 'utf8');\n  return typeof T.authorizeToolCall === 'function'\n    && agentSrc.includes(\"from './sky-tools.mjs'\")\n    && !/executeTool|invokeTool/i.test(agentSrc)\n    && /owner-from-args-rejected/.test(toolsSrc)\n    && !/dbPut|\\.put\\(|\\.delete\\(/.test(toolsSrc)\n    && agentSrc.includes('listTools');\n})());", 1)
    wr('phase9-m6-tool-registry.test.mjs', m6)
print('applied')
