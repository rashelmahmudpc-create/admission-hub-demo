#!/usr/bin/env python3
"""Sky step 3 (owner 2026-10-18): a quiz from the student's OWN recent mistakes.
"আমার ভুলগুলো থেকে ৫টা প্রশ্নে কুইজ দাও" (or the chat-open reminder button) builds a
tap-to-answer card from CACHE.mistakes on the phone: real questions, no AI call,
no AI limit, nothing invented, nothing written. Idempotent: refuses to run twice."""
import sys
def rd(p): return open(p, encoding='utf-8').read()
def wr(p, s): open(p, 'w', encoding='utf-8').write(s)
def sub(s, old, new, n=1):
    if s.count(old) < 1: sys.exit('anchor missing: ' + old[:80])
    return s.replace(old, new, n)

t = rd('sky-tools-client.js')
if 'mistake_quiz' in t: sys.exit('already applied')
t = sub(t, "     open_page             \"প্রশ্নব্যাংক খোলো\"\n",
           "     open_page             \"প্রশ্নব্যাংক খোলো\"\n     mistake_quiz          \"আমার ভুলগুলো থেকে ৫টা প্রশ্নে কুইজ দাও\" (step 3, 2026-10-18)\n")
t = sub(t, "knowledge_lookup: 'জমানো জ্ঞানভান্ডারে খুঁজছি', open_page: 'পেজের পথ বের করছি'",
           "knowledge_lookup: 'জমানো জ্ঞানভান্ডারে খুঁজছি', open_page: 'পেজের পথ বের করছি',\n    mistake_quiz: 'তোমার ভুল-ব্যাংক থেকে প্রশ্ন বাছছি'")
t = sub(t, "  const RE_GRADE =",
           "  const RE_MQ_A = /(ভুল|mistake)/i;\n  const RE_MQ_B = /(কুইজ|quiz|ঝালা|রিভিশন|revise|revision|অনুশীলন|practice|এমসিকিউ|mcq)/i;\n  const RE_GRADE =")
mq = r'''  /* Step 3 (owner 2026-10-18): a quiz from the student's own mistakes on this
     phone — newest first, mastered ones skipped. The questions are the real ones
     the student got wrong, so nothing is invented. Read-only. */
  function mistakeQuiz(text) {
    if (!RE_MQ_A.test(text) || !RE_MQ_B.test(text)) return null;
    const c = cache();
    const byId = {}; for (const q of (c.questions || [])) if (q && q.id != null) byId[String(q.id)] = q;
    const rows = [];
    for (const m of (c.mistakes || [])) {
      if (!m || m.mastered === true || m.revisionStatus === 'mastered') continue;
      const src = byId[String(m.questionId)] || {};
      const options = Array.isArray(m.options) && m.options.length >= 2 ? m.options : src.options;
      const question = m.question || src.question;
      let a = Number(m.correctAnswerIndex);
      if (!(isFinite(a) && a >= 0)) a = src.question ? ansIndex(src) : -1;
      if (!(isFinite(a) && a >= 0) && Array.isArray(options)) a = options.indexOf(m.correctAnswer);
      if (!question || !Array.isArray(options) || options.length < 2 || !(a >= 0 && a < options.length)) continue;
      rows.push({ id: m.questionId != null ? m.questionId : m.id, q: String(question).trim(), options: options.slice(0, 6).map((o) => String(o)), answer: a, explanation: String(m.explanation || src.explanation || '').trim().slice(0, 300), t: Number(m.lastWrongAt || m.time || 0) });
    }
    if (!rows.length) return { text: '🎉 এখন তোমার ভুল-ব্যাংকে ঝালাই করার মতো কোনো প্রশ্ন নেই। একটা পরীক্ষা দাও, ভুল হলে সেগুলো থেকে আমি কুইজ বানিয়ে দেব।', go: 'mistakes-bank', goName: 'ভুল-ব্যাংক' };
    rows.sort((x, y) => y.t - x.t);
    const pick = rows.slice(0, count(text));
    const title = 'তোমার ভুল থেকে ' + bn(pick.length) + 'টা প্রশ্ন' + (rows.length > pick.length ? ' (মোট ' + bn(rows.length) + 'টা জমা আছে)' : '');
    const card = { title: title, questions: pick.map((r) => ({ q: r.q, options: r.options, answer: r.answer, explanation: r.explanation })) };
    return { text: JSON.stringify(card), quiz: pick.map((r) => ({ id: r.id, a: r.answer })), mistakeQuiz: pick.length };
  }

'''
t = sub(t, "  /**\n   * Try the in-app tools for one message.", mq + "  /**\n   * Try the in-app tools for one message.")
t = sub(t, "      ['grade_quiz', () => gradeQuiz(t, ctx.lastQuiz)],\n",
           "      ['grade_quiz', () => gradeQuiz(t, ctx.lastQuiz)],\n      ['mistake_quiz', () => mistakeQuiz(t)],\n")
t = sub(t, "_t: { parseAnswers, gradeQuiz, makeQuiz,", "_t: { parseAnswers, gradeQuiz, makeQuiz, mistakeQuiz,")
t = sub(t, "version: 'sky-tools-client-v1'", "version: 'sky-tools-client-v2'")
wr('sky-tools-client.js', t)

r = rd('sky-recall.mjs')
r = sub(r, "buttons.push({ label: '🔁 ভুলগুলো ঝালাই করি', prompt: 'গত দুই দিনে আমার কয়েকটা প্রশ্ন ভুল হয়েছে — Mistake Bank থেকে কীভাবে রিভিশন করব, ধাপে ধাপে বলো' });",
           "buttons.push({ label: '🔁 ভুল থেকে কুইজ', prompt: 'আমার ভুলগুলো থেকে ৫টা প্রশ্নে কুইজ দাও' });")
wr('sky-recall.mjs', r)

for f, a, b in [
    ('index.html', 'sky-tools-client.js?v=tools1', 'sky-tools-client.js?v=tools2'),
    ('sw.js', 'sky-tools-client.js?v=tools1', 'sky-tools-client.js?v=tools2'),
    ('sky-agent-tools.test.mjs', 'sky-tools-client\\.js\\?v=tools1', 'sky-tools-client\\.js\\?v=tools2')]:
    s = rd(f); s = sub(s, a, b, 99); wr(f, s)
s = rd('sw.js'); s = sub(s, "const BUILD_ID = 'v360-sky-recall-v2';", "const BUILD_ID = 'v361-sky-mistake-quiz';"); wr('sw.js', s)
print('sky mistake quiz applied')
