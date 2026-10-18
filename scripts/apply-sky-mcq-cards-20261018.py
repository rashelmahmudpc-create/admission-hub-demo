#!/usr/bin/env python3
"""Sky MCQ Card Engine (owner 2026-10-18) — idempotent patch.

Wires sky-mcq.js into the chat so EVERY MCQ in a Sky answer renders as a
tap-to-answer quiz card (AI answers, quiz-mode JSON while streaming, and the
in-app make_quiz tool). Also tells the model to always write MCQs in the
card-friendly shape. Run from the repo root; running twice changes nothing.
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
changed = []

def patch(path, pairs):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    orig = s
    for old, new, marker in pairs:
        if marker in s:
            continue
        if s.count(old) != 1:
            sys.exit(f'{path}: anchor not found exactly once: {old[:80]!r} (count={s.count(old)})')
        s = s.replace(old, new)
    if s != orig:
        p.write_text(s, encoding='utf-8')
        changed.append(path)

# 1) chat renderer: mdRich runs every answer through the MCQ engine.
patch('ai-agent-chat.js', [
    (
        "  function mdRich(src) {\n    const qz = quizCard(src); if (qz !== null) return qz;\n    let t = String(src == null ? '' : src);\n    const visuals = [];\n",
        "  let skyLive = 0; /* 1 only while a streaming chunk is rendered */\n"
        "  function mdRich(src, live) {\n"
        "    live = live || skyLive;\n"
        "    /* Owner 2026-10-18: MCQ Card Engine (sky-mcq.js). Quiz JSON — even half-\n"
        "       streamed — and any MCQ written as text become tap-to-answer cards. */\n"
        "    const MCQ = window.SkyMCQ;\n"
        "    if (MCQ) { try { const h = MCQ.renderJson(src, !!live); if (h != null) return h; } catch (_) {} }\n"
        "    const qz = quizCard(src); if (qz !== null) return qz;\n"
        "    let t = String(src == null ? '' : src);\n"
        "    const visuals = [];\n"
        "    if (MCQ) { try { t = MCQ.render(t, (h) => { visuals.push(h); return '\\n\\u0001V' + (visuals.length - 1) + '\\u0001\\n'; }, { live: !!live }); } catch (_) {} }\n",
        "MCQ Card Engine (sky-mcq.js)",
    ),
    (
        "if (node) { const b = node.querySelector('.bw'); if (b) b.innerHTML = mdRich(full); }",
        "if (node) { const b = node.querySelector('.bw'); if (b) { skyLive = 1; b.innerHTML = mdRich(full); skyLive = 0; } }",
        "skyLive = 1; b.innerHTML = mdRich(full); skyLive = 0;",
    ),
])

# 2) make_quiz: give each question its answer + explanation so the card can grade it.
patch('sky-tools-client.js', [
    (
        "      q.options.slice(0, 6).forEach((o, j) => lines.push('   ' + LET[j] + ') ' + String(o).trim()));\n      lines.push('');\n",
        "      q.options.slice(0, 6).forEach((o, j) => lines.push('   ' + LET[j] + ') ' + String(o).trim()));\n"
        "      /* MCQ Card Engine: the answer line turns this into a tap-to-answer card */\n"
        "      lines.push('   ✅ উত্তর: ' + LET[ansIndex(q)]);\n"
        "      if (q.explanation) lines.push('   💡 ব্যাখ্যা: ' + String(q.explanation).replace(/\\s+/g, ' ').trim().slice(0, 400));\n"
        "      lines.push('');\n",
        "MCQ Card Engine: the answer line",
    ),
    (
        "    lines.push('✅ উত্তর এভাবে লেখো: **' + pick.slice(0, 3).map((_, i) => bn(i + 1) + '-ক').join(' ') + (pick.length > 3 ? ' …' : '') + '** — আমি মিলিয়ে নম্বর দেব।');\n",
        "    lines.push('👆 প্রতিটা প্রশ্নে ট্যাপ করে উত্তর দাও — সাথে সাথে ফল আর ব্যাখ্যা দেখবে। চাইলে লিখেও পাঠাতে পারো: **' + pick.slice(0, 3).map((_, i) => bn(i + 1) + '-ক').join(' ') + (pick.length > 3 ? ' …' : '') + '**');\n",
        "প্রতিটা প্রশ্নে ট্যাপ করে উত্তর দাও",
    ),
])

# 3) model rule: MCQs anywhere in an answer use the card-friendly shape.
patch('ai-agent.js', [
    (
        "- Put \"---\" between major parts of a long answer",
        "- MCQ / practice questions anywhere in an answer: write each as \"**১.** <question>\", then one option per line \"ক) …\", \"খ) …\", \"গ) …\", \"ঘ) …\", then \"✅ উত্তর: <letter>\" and \"💡 ব্যাখ্যা: <1-2 sentences>\". The app turns these into tap-to-answer quiz cards, so never skip the answer line and never put options on one line.\n"
        "- Put \"---\" between major parts of a long answer",
        "The app turns these into tap-to-answer quiz cards",
    ),
])

# 4) load + precache the engine (before the chat script).
patch('index.html', [
    (
        '<script defer src="./sky-tools-client.js?v=tools1"></script>\n',
        '<script defer src="./sky-mcq.js?v=mcq1"></script>\n<script defer src="./sky-tools-client.js?v=tools1"></script>\n',
        'sky-mcq.js?v=mcq1',
    ),
])
patch('sw.js', [
    (
        "  './sky-tools-client.js?v=tools1',\n",
        "  './sky-mcq.js?v=mcq1',\n  './sky-tools-client.js?v=tools1',\n",
        "'./sky-mcq.js?v=mcq1'",
    ),
])

print('changed:', ', '.join(changed) if changed else 'nothing (already applied)')
