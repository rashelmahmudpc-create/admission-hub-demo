#!/usr/bin/env python3
"""Sky keyboard layout v12 (owner 2026-10-18, IMG_6957/6958).
1. Keyboard up: the "or" line and Google/Telegram/passkey tiles step aside (only while typing).
2. Keyboard up: the mascot stays big and centred; it is sized to fill the free space (grows into a
   gap, shrinks when tight), so no empty band is left between the fields and Next (password screen).
   Only when even a 56px bird does not fit does it move to the corner.
"""
import pathlib, re

def sub(path, old, new):
    p = pathlib.Path(path); s = p.read_text(encoding='utf8')
    if s.count(old) != 1: raise SystemExit(f'{path}: expected 1 match: {old[:60]!r}')
    p.write_text(s.replace(old, new), encoding='utf8')

sub('sky-onboarding.css', '#ah-sky-flow #sky-app[data-kb="1"][data-kbroomy="1"] .petwrap{padding-top:8px}\n',
    '#ah-sky-flow #sky-app[data-kb="1"][data-kbroomy="1"] .petwrap{padding-top:8px}\n'
    '#ah-sky-flow #sky-app[data-kb="1"][data-kbroomy="1"] .bird{width:var(--kbbird,clamp(112px,calc(var(--vh,100svh)*.215),180px))}\n'
    '/* Keyboard up (owner 2026-10-18): the provider buttons step aside while typing. */\n'
    '#ah-sky-flow #sky-app[data-kb="1"] .scr .or,#ah-sky-flow #sky-app[data-kb="1"] .scr .tiles{display:none}\n')

sub('sky-onboarding.js', "      if (app.dataset.kb !== '1') { delete app.dataset.kbroomy; return; }\n",
    "      if (app.dataset.kb !== '1') { delete app.dataset.kbroomy; app.style.removeProperty('--kbbird'); return; }\n")
sub('sky-onboarding.js', """      app.dataset.kbroomy = '1';
      if (scr.scrollHeight > scr.clientHeight + 2 || scr.clientHeight < 96) delete app.dataset.kbroomy;
""", """      app.style.removeProperty('--kbbird');
      app.dataset.kbroomy = '1';
      // Size the big bird to the free space: grow into a gap, shrink when tight (aspect 1:1, so the
      // width change is the height change). Only if even 56px does not fit does it go to the corner.
      const top = scr.getBoundingClientRect().top;
      let bottom = top;
      for (const child of scr.children) { const r = child.getBoundingClientRect(); if (r.height > 0) bottom = Math.max(bottom, r.bottom); }
      const need = bottom - top + (parseFloat(getComputedStyle(scr).paddingBottom) || 0);
      const bird = $('sky-bird'), w = bird ? bird.getBoundingClientRect().width : 0;
      if (w) {
        const nw = Math.max(56, Math.min(170, Math.floor(w - (need - scr.clientHeight) - 8)));
        if (Math.abs(nw - w) > 2) app.style.setProperty('--kbbird', nw + 'px');
      }
      if (scr.scrollHeight > scr.clientHeight + 2 || scr.clientHeight < 96) { delete app.dataset.kbroomy; app.style.removeProperty('--kbbird'); }
""")
for f in ('app-seed.js', 'index.html', 'sw.js'):
    p = pathlib.Path(f); s = p.read_text(encoding='utf8')
    if 'sky-flow-20261018-v11' not in s: raise SystemExit(f'{f}: token missing')
    p.write_text(s.replace('sky-flow-20261018-v11', 'sky-flow-20261018-v12'), encoding='utf8')
p = pathlib.Path('sw.js'); s, n = re.subn(r"const BUILD_ID = '[^']+';", "const BUILD_ID = 'v363-sky-kb-v12';", p.read_text(encoding='utf8'), count=1)
if n != 1: raise SystemExit('BUILD_ID missing')
p.write_text(s, encoding='utf8')
print('applied sky keyboard layout v12')
