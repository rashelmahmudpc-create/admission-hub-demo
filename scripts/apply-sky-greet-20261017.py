# Owner 2026-10-17: put the owner's 20 greeting replies (scripts/data/sky-greet-20261017.md)
# into sky-smalltalk.js. "……" = student name -> ", name", or nothing when no name. Idempotent.
import json, re, pathlib
P = pathlib.Path
md = P('scripts/data/sky-greet-20261017.md').read_text()
out, cur = [], None
def done():
    global cur
    if cur: out.append('\n'.join(cur).strip())
    cur = None
for line in md.splitlines():
    if line.startswith('## '):
        done(); cur = [] if re.match(r'^## \d\d ', line) else None; continue
    if cur is None: continue
    if line.strip() == '---': done(); continue
    if not cur and not line.startswith('### '): continue
    cur.append(line)
done()
assert len(out) == 20, len(out)
out = [re.sub(r',\s*……', '{n}', x) for x in out]
assert all('……' not in x and x.count('{n}') == 1 and x.startswith('### ') for x in out)
items = ',\n'.join('      ' + json.dumps(x, ensure_ascii=False) for x in out)
R = ('  /* greet: মালিকের দেওয়া ২০টা উত্তর (2026-10-17), ঘুরিয়ে দেখানো হয়। {n} = ", নাম" (নাম না থাকলে কিছুই না)।\n'
     '     বাকি ধরনের উত্তর মালিক পরে দেবেন; তালিকা খালি থাকলে কথাটা AI-এর কাছে যায়। */\n'
     '  const R = {\n    greet: [\n' + items + '\n    ],\n    thanks: [], who: [], bye: [], ok: []\n  };\n')
s = P('sky-smalltalk.js').read_text()
a = s.index('  /* উত্তর মুছে') if '  /* উত্তর মুছে' in s else s.index('  /* greet: মালিকের')
b = s.index('  const P = {')
s = s[:a] + R + s[b:]
s = s.replace("pick(cat).replace('{n}', name ? ' ' + name : '')", "pick(cat).replace('{n}', name ? ', ' + name : '')")
assert "', ' + name : ''" in s
old = r"""replace(/[<>&"'\r\n]/g, '')"""
if old in s: s = s.replace(old, r"""replace(/[<>&"'\r\n*_`|#\[\]\\]/g, '')""")
for p in ['hiiii', 'hi there', 'hello there', 'hey there', 'hi buddy', 'hlw sky', 'hiii sky', 'hiiii sky',
          'hi sky hello', 'hey hello sky', 'হাই স্কাই', 'হ্যালো স্কাই']:
    if "'" + p + "'" not in s: s = s.replace("greet: ['hi', ", "greet: ['hi', '" + p + "', ", 1)
P('sky-smalltalk.js').write_text(s)
t = P('pr2-fast-start.test.mjs').read_text()
if 'owner 20 greeting' not in t:
    a = t.index('// 2026-10-17: owner cleared every stored reply'); b = t.index('// Rotation/name checks')
    t = t[:a] + """// 2026-10-17: owner 20 greeting replies; the other categories wait for the owner.
await t('PR2-৫. greet has the owner 20 replies; other lists empty, so they go to the AI', () =>
  S.REPLIES.greet.length === 20 && ['thanks', 'who', 'bye', 'ok'].every(k => S.REPLIES[k].length === 0)
  && S.reply('ধন্যবাদ') === null && S.REPLIES.greet.every(x => x.startsWith('### ') && x.includes('{n}') && !x.includes('……')));
await t('PR2-৫খ. name goes in after a comma; no name means no comma and no placeholder', () => {
  const a = S.reply('hlw', 'রাফি'), b = S.reply('hello');
  return /^### [^\\n]+, রাফি!/.test(a) && /^### [^\\n,]+!/.test(b) && !/\\{n\\}|……/.test(b)
    && S.kind('Hi Sky, hello!') === 'greet' && S.kind('হাই স্কাই') === 'greet' && S.kind('hi there') === 'greet';
});
""" + t[b:]
    P('pr2-fast-start.test.mjs').write_text(t)
print('applied', len(out))
