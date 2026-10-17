# Owner 2026-10-17: clear every stored Sky answer (in-app small talk + shared answers)
# and retire the server chat cache (chat-cache-v1 -> v2). Code stays. Idempotent.
import re, pathlib
P = pathlib.Path
NOTE = 'উত্তর মুছে ফেলা হয়েছে (মালিকের নির্দেশ 2026-10-17)। নতুন উত্তর এখানে বসবে।'
for f in ['sky-faq-bn.js', 'sky-faq-en.js', 'sky-faq-sci.js', 'sky-faq-gk.js']:
    s = P(f).read_text(); a = s.index('.push(\n') + 7; b = s.rindex('\n  );')
    P(f).write_text(s[:a] + '    /* ' + NOTE + ' */' + s[b:])
s = P('sky-smalltalk.js').read_text()
a = s.index('  const R = {'); b = s.index('  const P = {')
s = s[:a] + "  /* " + NOTE + "\n     কোনো ধরনের তালিকা খালি থাকলে কথাটা AI-এর কাছে যায়। */\n  const R = { greet: [], thanks: [], who: [], bye: [], ok: [] };\n" + s[b:]
old = "    const cat = kind(text);\n    if (!cat) return null;"
if old in s: s = s.replace(old, "    const cat = kind(text);\n    if (!cat || !Array.isArray(R[cat]) || !R[cat].length) return null;")
assert '!R[cat].length' in s
P('sky-smalltalk.js').write_text(s)
c = P('ai-chat-cache.mjs').read_text().replace("'chat-cache-v1'", "'chat-cache-v2'")
assert "'chat-cache-v2'" in c; P('ai-chat-cache.mjs').write_text(c)
FX = """// 2026-10-17: owner cleared every stored answer; new ones will be added later.
t('PR3-১. the stored answer bank is empty, and nothing matches while it is empty', () =>
  Array.isArray(D) && D.length === 0 && ['সমাস কী', 'what is noun', 'পদ্মা সেতু'].every(q => F.match(q) === null));
// Matcher checks below run on a small test-only list (never shipped).
const fx = (id, ...k) => D.push({ id, k, a: 't' });
fx('bn-samas', 'সমাস', 'samas'); fx('bn-sandhi', 'সন্ধি', 'sandhi'); fx('bn-karok', 'কারক', 'karok');
fx('sci-newton1', 'নিউটনের প্রথম সূত্র', 'জড়তার সূত্র', "newton's first law", 'newton first law');
fx('sci-force', 'বল', 'force'); fx('gk-padma-bridge', 'পদ্মা সেতু', 'padma bridge');
fx('en-noun', 'noun', 'nouns'); fx('en-tense', 'tense', 'tenses'); fx('en-tag', 'tag question', 'question tag');
fx('gk-gdp', 'জিডিপি', 'gdp'); fx('bio-photosynthesis', 'সালোকসংশ্লেষণ', 'photosynthesis');
"""
t = P('pr3-shared-answers.test.mjs').read_text()
if 'test-only list' not in t:
    a = t.index("t('PR3-১."); b = t.index("t('PR3-২.")
    t = t[:a] + FX + t[b:]
    a = t.index("t('PR3-৩."); b = t.index("t('PR3-৪.")
    t = t[:a] + "t('PR3-৩. the four data files ship no answers', () =>\n  FILES.every(f => !/\\{\\s*id:/.test(readFileSync('./' + f, 'utf8'))));\n" + t[b:]
    t = t.replace("every(q => id(q) === null && S.reply(q, '') !== null)", "every(q => id(q) === null && S.kind(q) !== '')")
    P('pr3-shared-answers.test.mjs').write_text(t)
t = P('pr2-fast-start.test.mjs').read_text()
if 'test-only replies' not in t:
    a = t.index("await t('PR2-৫."); b = t.index("await t('PR2-৬.")
    t = t[:a] + """// 2026-10-17: owner cleared every stored reply; new ones will be added later.
await t('PR2-৫. reply lists are empty for now, so small talk goes to the AI (no crash)', () =>
  Object.keys(S.REPLIES).length >= 4 && Object.values(S.REPLIES).every(l => Array.isArray(l) && l.length === 0)
  && S.reply('hi', 'রাফি') === null && S.reply('ধন্যবাদ') === null && S.kind('hi') === 'greet');
// Rotation/name checks below run on test-only replies (never shipped).
for (const k of Object.keys(S.REPLIES)) for (let i = 0; i < 30; i++) S.REPLIES[k].push('t' + i + '{n}');
""" + t[b:]
    P('pr2-fast-start.test.mjs').write_text(t)
print('applied')
