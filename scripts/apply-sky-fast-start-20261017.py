#!/usr/bin/env python3
"""PR-2 (owner 2026-10-17): Sky fast start. Idempotent.
- ai-agent.js: provider probe overlaps the quota read; in streaming mode the SSE
  response opens at once (openEarly) and preparation runs inside it; stages are
  sent when the work really happens (understand at open, app-features when the
  list is loaded, memory only when memory exists). 400/401/403/429/503 stay HTTP.
- ai-agent-chat.js: small talk answered in-app from sky-smalltalk.js.
- index.html + sw.js: load/precache sky-smalltalk.js.
- tests: three E2E files restore their fetch mock after reading the stream;
  two source-order checks now compare against the model call."""
import re, sys
def rd(p): return open(p, encoding='utf-8').read()
def wr(p, s): open(p, 'w', encoding='utf-8').write(s)
def need(c, msg):
    if not c: sys.exit('apply failed: ' + msg)

s = rd('ai-agent.js')
if 'function openEarly(' not in s:
    def cut(a, b):
        global s
        i = s.index(a); j = s.index(b, i) + len(b); blk = s[i:j]; s = s[:i] + s[j:]; return blk
    intent = cut("  const intentCls = classifyIntent(", "  const safety = safetyGate(intent, examMode);\n")
    probe = cut("  /* bad-set (আজ-মার্ক-করা key/model) */\n", "  chain = rankChainByModelHealth(chain, badMap, healthNow);\n")
    gates = cut("  if (!chain.length) {\n    await settleBackground();\n", "    return stream ? sseError(msg, 403) : jsonResp(msg, 403);\n  }\n").replace("    await settleBackground();\n", "")
    probe = probe.replace("  if (hasImage) chain", "  if (v.messages.some(m => m.image)) chain")
    s = s.replace("  /* Per-user AI state lives in a Durable Object", intent + "\n"
        "  /* PR-2 (owner 2026-10-17): the provider health probe needs only the tier, so it\n"
        "     starts now and overlaps the quota round-trip instead of running after it. */\n"
        "  const providersP = (async () => {\n" + probe + "  return { kvKeys, badMap, badSet, chain };\n  })();\n  providersP.catch(() => {});\n\n"
        "  /* Per-user AI state lives in a Durable Object", 1)
    g = "  if (verificationGuidance) return guidanceResponse(verificationGuidance, stream);\n"
    need(g in s, 'guidance anchor')
    s = s.replace(g, g + "  const { kvKeys, badMap, badSet } = await providersP;\n  let { chain } = await providersP;\n" + gates +
        "  /* PR-2: from here on, in streaming mode the work runs inside an already-open\n"
        "     stream, so the student sees the first byte at once and each stage is sent\n"
        "     the moment that work really happens (not all together at the end). */\n"
        "  const early = { sent: new Set(), push: null };\n"
        "  const prepStage = (id, label) => {\n"
        "    if (!early.push || early.sent.has(id)) return;\n"
        "    early.sent.add(id);\n"
        "    early.push(`event: stage\\ndata: ${JSON.stringify({ stage: id, label })}\\n\\n`);\n"
        "  };\n"
        "  const core = async () => {\n", 1)
    old = ("  const appFeatureHit = !quizMode && !hasImage && isAppFeatureQuestion((v.messages[v.messages.length - 1] || {}).content);\n"
           "  if (appFeatureHit) sys = sys + '\\n\\n' + renderAppFeatures(await loadAppFeatures(env && env.PUB_KV));\n")
    need(old in s, 'app-features anchor')
    s = s.replace(old, "  if (appFeatureHit) sys = sys + '\\n\\n' + renderAppFeatures(await appFeaturesP);\n", 1)
    s = s.replace("  const memKeyEarly = 'mem:'",
        "  const appFeatureHit = !quizMode && !v.messages.some(m => m.image) && isAppFeatureQuestion((v.messages[v.messages.length - 1] || {}).content);\n"
        "  if (appFeatureHit) prepStage('app-features', 'টুল চালাচ্ছি — অ্যাপের ফিচার তালিকা দেখছি');\n"
        "  const appFeaturesP = appFeatureHit ? Promise.resolve().then(() => loadAppFeatures(env && env.PUB_KV)).catch(() => null) : null;\n"
        "  const memKeyEarly = 'mem:'", 1)
    m = "  const memoryText = memoryOn ? renderMemory(baseRecords.concat(tutorContext), MEMORY_VERSION) : '';\n"
    need(m in s, 'memory anchor')
    s = s.replace(m, m + "  if (memoryText || summaryText || (msgs.length > v.messages.length)) prepStage('memory', 'তোমার আগের কথাগুলো মনে করছি');\n", 1)
    need("      const sentStages = new Set();\n" in s, 'stage set anchor')
    s = s.replace("      const sentStages = new Set();\n", "      const sentStages = early.sent;\n", 1)
    tail = ("  return new Response(streamOut, {\n    status: 200,\n    headers: {\n"
            "      'Content-Type': 'text/event-stream; charset=utf-8',\n      'Cache-Control': 'no-cache, no-transform',\n"
            "      'Connection': 'keep-alive',\n      'X-Accel-Buffering': 'no',\n      'Access-Control-Allow-Origin': '*'\n    }\n  });\n}\n")
    need(tail in s, 'tail anchor')
    s = s.replace(tail, tail[:-2] + """  };
  if (!stream) return core();
  mark('open');
  return openEarly(core, early, () => prepStage('understand', STAGE_UNDERSTAND[intent] || STAGE_UNDERSTAND.GENERAL_CHAT));
}

/* PR-2: open the SSE response at once and pipe the real answer into it when it
   is ready. Stage events written during preparation go out first, in order.
   A plain queue (no backpressure): the work and the memory save must finish
   even when the reader is slow, exactly as with the inner stream. */
function openEarly(run, early, first) {
  const enc = new TextEncoder();
  let ctl = null;
  const readable = new ReadableStream({ start(c) { ctl = c; } });
  const write = (chunk) => { try { ctl.enqueue(typeof chunk === 'string' ? enc.encode(chunk) : chunk); } catch (_) {} };
  early.push = write;
  write(': open\\n\\n');
  if (first) first();
  (async () => {
    try {
      const resp = await run();
      const reader = resp && resp.body ? resp.body.getReader() : null;
      if (reader) { for (;;) { const step = await reader.read(); if (step.done) break; write(step.value); } }
    } catch (e) {
      write(`event: error\\ndata: ${JSON.stringify({ error: 'stream_failed', message: 'যুক্তি-বিচ্ছেদ ঘটেছে।', detail: String((e && e.message) || e), retryable: true })}\\n\\n`);
    } finally {
      early.push = null;
      try { ctl.close(); } catch (_) {}
    }
  })();
  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
""", 1)
    wr('ai-agent.js', s)

c = rd('ai-agent-chat.js')
if 'SkySmallTalk' not in c:
    a = "    sessions[cur].msgs.push({ role: 'user', text: t, ts: Date.now() });\n    if (!sessions[cur].name) sessions[cur].name = t.slice(0, 40);\n"
    need(a in c, 'chat send anchor')
    c = c.replace(a, a + """    /* PR-2 (owner 2026-10-17): hi / ধন্যবাদ / তুমি কে … are answered here from the
       in-app bank (sky-smalltalk.js): instant, no server call, no AI limit used. */
    const quick = window.SkySmallTalk ? window.SkySmallTalk.reply(t, (profilePayload() || {}).firstName) : null;
    if (quick) {
      sessions[cur].msgs.push({ role: 'ai', text: quick, ts: Date.now(), local: true });
      save(); renderMsgs(); mood('happy', 1200);
      return;
    }
""", 1)
    wr('ai-agent-chat.js', c)

h = rd('index.html')
if 'sky-smalltalk.js' not in h:
    tag = re.search(r'<script defer src="\./ai-agent-chat\.js\?v=[^"]+"></script>', h)
    need(tag, 'index chat tag')
    h = h.replace(tag.group(0), '<script defer src="./sky-smalltalk.js?v=st1"></script>\n' + tag.group(0), 1)
    wr('index.html', h)
w = rd('sw.js')
if "'./sky-smalltalk.js?v=st1'" not in w:
    e = re.search(r"  '\./ai-agent-chat\.js\?v=[^']+',\n", w)
    need(e, 'sw shell entry')
    w = w.replace(e.group(0), "  './sky-smalltalk.js?v=st1',\n" + e.group(0), 1)
    wr('sw.js', w)

def restore_after_read(p, window):
    L = rd(p).split('\n'); i = 0
    while i < len(L):
        if re.fullmatch(r'\s*restore\d?\(\);', L[i]):
            for k in range(1, window + 1):
                if i + k < len(L) and re.search(r'await \w+\.(text|json)\(\)', L[i + k]):
                    L.insert(i + k, L.pop(i)); break
        i += 1
    wr(p, '\n'.join(L))
restore_after_read('ai-agent-f1.test.mjs', 2)
restore_after_read('phase9-m7-memory-engine.test.mjs', 1)
for f, label in [('p25-chat-cache.test.mjs', 'P25-১৩. the cache is consulted before the provider chain is built'),
                 ('p27-history-trim.test.mjs', 'P27-১১. the trim runs before the provider chain is built')]:
    t = rd(f)
    if label in t:
        i = t.index(label); j = t.index('\n', t.index('\n', i) + 1)
        t = t[:i] + t[i:j].replace('before the provider chain is built', 'before the model is called (PR-2: the chain probe overlaps the quota read)').replace("SRC.indexOf('const fullChain = routerChain(')", "SRC.indexOf(\"mark('modelStart')\")") + t[j:]
        wr(f, t)
print('apply-sky-fast-start: ok')
