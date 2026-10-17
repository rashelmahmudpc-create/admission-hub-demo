#!/usr/bin/env python3
"""PR-3 (owner 2026-10-17): Sky shared answers. Safe to run twice.
- sky-faq.js: Banglish question words (ki, kake bole ...); 'বল' is a topic (force).
- sky-faq-en.js / sky-faq-sci.js: small alias fixes.
- ai-agent-chat.js: after small talk, a very close shared-answer match is answered
  in-app (no server call, no AI limit). The bubble shows a note and an
  "আরো বিস্তারিত" chip that sends the question to the AI.
- index.html + sw.js: load/precache the five sky-faq files."""
import sys
def rd(p): return open(p, encoding='utf-8').read()
def wr(p, s): open(p, 'w', encoding='utf-8').write(s)
def need(c, msg):
    if not c: sys.exit('apply failed: ' + msg)
V = 'faq1'
FILES = ['sky-faq.js', 'sky-faq-bn.js', 'sky-faq-en.js', 'sky-faq-sci.js', 'sky-faq-gk.js']

s = rd('sky-faq.js')
if 'bujhiye' not in s:
    a = "'please plz pls sky"
    b = ' দাও না বলো বল বলেন '
    need(a in s and b in s, 'sky-faq.js filler anchors')
    s = s.replace(a, "'ki kake bole bolte bujhay bojhay bujhi bujhiye bujhao bojhao dao koy koto prokar mane please plz pls sky", 1)
    s = s.replace(b, ' দাও না বলো বলেন ', 1)
    wr('sky-faq.js', s)

e = rd('sky-faq-en.js')
if "'a an the'" in e:
    wr('sky-faq-en.js', e.replace("'a an the'", "'article in english'", 1))
c = rd('sky-faq-sci.js')
if "k: ['বল', " not in c:
    need("k: ['বল পদার্থবিজ্ঞান'," in c and "k: ['কাজ পদার্থবিজ্ঞান'," in c, 'sky-faq-sci.js alias anchors')
    c = c.replace("k: ['বল পদার্থবিজ্ঞান',", "k: ['বল', 'বল পদার্থবিজ্ঞান',", 1)
    c = c.replace("k: ['কাজ পদার্থবিজ্ঞান',", "k: ['কাজ', 'কাজ পদার্থবিজ্ঞান',", 1)
    wr('sky-faq-sci.js', c)

j = rd('ai-agent-chat.js')
if 'window.SkyFAQ' not in j:
    st = j.find('SkySmallTalk.reply(')
    need(st > 0, 'small-talk hook (PR-2) missing')
    hold = "    const holder = { role: 'ai', text: '', ts: Date.now(), pending: true"
    at = j.find(hold, st)
    need(at > 0, 'holder anchor')
    j = j[:at] + """    /* PR-3 (owner 2026-10-17): common textbook questions (সমাস কী …) get the same
       reviewed answer for everyone from the in-app bank (sky-faq*.js): instant, no
       server call, no AI limit. "আরো বিস্তারিত" sends the question to the AI. */
    const faq = window.SkyFAQ ? window.SkyFAQ.match(t) : null;
    if (faq) {
      sessions[cur].msgs.push({ role: 'ai', text: faq.a, ts: Date.now(), local: true, faq: faq.id, q: faq.q });
      save(); renderMsgs(); mood('happy', 1200);
      return;
    }
""" + j[at:]
    b0 = '  function bubble(m, idx) {\n'
    need(j.count(b0) == 1, 'bubble anchor')
    j = j.replace(b0, """  /* PR-3: shared-answer note + "আরো বিস্তারিত" chip (data-q sends it to the AI). */
  function faqNote(m) {
    if (!m.faq || m.pending) return '';
    const more = String(m.q || '').slice(0, 120) + ' — আরো বিস্তারিত বুঝিয়ে বলো';
    return '<div class="faqm"><span>📌 সবার জন্য জমানো উত্তর</span><button data-q="' + esc(more) + '">আরো বিস্তারিত →</button></div>';
  }
""" + b0, 1)
    r0 = "'<div class=\"bw\">' + inner + '</div>' + acts + '</div>';"
    need(j.count(r0) == 1, 'bubble return anchor')
    j = j.replace(r0, "'<div class=\"bw\">' + inner + '</div>' + faqNote(m) + acts + '</div>';", 1)
    c0 = '#app.sky .acts{display:flex;gap:2px;margin-top:10px}\n'
    need(j.count(c0) == 1, 'css anchor')
    j = j.replace(c0, c0 + '#app.sky .faqm{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:10px;font-size:12.5px;color:var(--mute)}\n'
                  '#app.sky .faqm button{padding:7px 12px;border-radius:999px;background:var(--soft);color:var(--pri);font-weight:600;font-size:13px}\n', 1)
    wr('ai-agent-chat.js', j)

h = rd('index.html')
if 'sky-faq.js' not in h:
    tag = '<script defer src="./sky-smalltalk.js?v=st1"></script>\n'
    need(tag in h, 'index.html small-talk tag')
    h = h.replace(tag, tag + ''.join('<script defer src="./%s?v=%s"></script>\n' % (f, V) for f in FILES), 1)
    wr('index.html', h)
w = rd('sw.js')
if "'./sky-faq.js?v=" not in w:
    line = "  './sky-smalltalk.js?v=st1',\n"
    need(line in w, 'sw.js small-talk line')
    w = w.replace(line, line + ''.join("  './%s?v=%s',\n" % (f, V) for f in FILES), 1)
    wr('sw.js', w)
print('apply-sky-shared-answers: ok')
