#!/usr/bin/env python3
"""Sky onboarding keyboard layout v11 (owner 2026-10-18).

Owner screenshots (IMG_6945-6948): with the keyboard up the Next button rose under the field but a
big empty band was left between it and the keyboard; on the GPA screen the bottom third stayed empty
after the keyboard closed. Fixes:
  1. keyboard up: the big bird stays ("roomy") whenever the screen still fits; it only shrinks to
     the corner when it would not fit. The stage fills the space again, Next sits above the keyboard.
  2. the "+140px taller page" trick is removed; the strip under the page is a paint-only box-shadow.
  3. --vh is applied only while a field is focused and the keyboard is really up; a watchdog and the
     visualViewport handler restore the full layout when iOS never reports the keyboard going away.
  4. cache tokens: sky-flow-20261017-v10 -> sky-flow-20261018-v11, SW BUILD_ID -> v361-sky-kb-layout.
"""
import pathlib
import re

def sub(path, old, new):
    p = pathlib.Path(path); s = p.read_text(encoding='utf8')
    n = s.count(old)
    if n != 1: raise SystemExit(f'{path}: expected 1 match, found {n}: {old[:70]!r}')
    p.write_text(s.replace(old, new), encoding='utf8')

def sub_all(path, old, new):
    p = pathlib.Path(path); s = p.read_text(encoding='utf8')
    if old not in s: raise SystemExit(f'{path}: missing {old!r}')
    p.write_text(s.replace(old, new), encoding='utf8')

EDITS = [
('sky-onboarding.css', r'''   Driven by [data-kb] on #sky-app, set by sky-onboarding.js while a field is focused. */
#ah-sky-flow #sky-app[data-kb="1"] .petwrap{flex-direction:row;align-items:center;justify-content:flex-start;gap:12px;padding:8px 16px 0 66px}
#ah-sky-flow #sky-app[data-kb="1"] .bird{width:62px;flex:none}
#ah-sky-flow #sky-app[data-kb="1"] .bubble{margin:0;flex:1;min-width:0;min-height:0;max-width:none;display:block;text-align:left;font-size:14.5px;line-height:1.4;padding:9px 14px;border-radius:18px}
#ah-sky-flow #sky-app[data-kb="1"] .bubble:before{top:50%;left:-7px;margin:-7px 0 0;width:14px;height:14px}
#ah-sky-flow #sky-app[data-kb="1"] .stage{flex:0 1 auto;transition:height .22s ease;margin-top:4px;-webkit-mask-image:linear-gradient(#000 calc(100% - 16px),transparent);mask-image:linear-gradient(#000 calc(100% - 16px),transparent)}
#ah-sky-flow #sky-app[data-kb="1"] .scr{padding-top:6px;padding-bottom:18px}
''', r'''   Driven by [data-kb] on #sky-app, set by sky-onboarding.js while a field is focused. */
#ah-sky-flow #sky-app[data-kb="1"]:not([data-kbroomy="1"]) .petwrap{flex-direction:row;align-items:center;justify-content:flex-start;gap:12px;padding:8px 16px 0 66px}
#ah-sky-flow #sky-app[data-kb="1"]:not([data-kbroomy="1"]) .bird{width:62px;flex:none}
#ah-sky-flow #sky-app[data-kb="1"]:not([data-kbroomy="1"]) .bubble{margin:0;flex:1;min-width:0;min-height:0;max-width:none;display:block;text-align:left;font-size:14.5px;line-height:1.4;padding:9px 14px;border-radius:18px}
#ah-sky-flow #sky-app[data-kb="1"]:not([data-kbroomy="1"]) .bubble:before{top:50%;left:-7px;margin:-7px 0 0;width:14px;height:14px}
#ah-sky-flow #sky-app[data-kb="1"] .stage{flex:1 1 auto;margin-top:4px;-webkit-mask-image:linear-gradient(#000 calc(100% - 16px),transparent);mask-image:linear-gradient(#000 calc(100% - 16px),transparent)}
#ah-sky-flow #sky-app[data-kb="1"] .scr{padding-top:6px;padding-bottom:18px}
'''),
('sky-onboarding.css', r'''#ah-sky-flow #sky-app[data-kb="1"] .scr{padding-top:6px;padding-bottom:18px}
#ah-sky-flow #sky-app[data-kb="1"] .foot{padding:8px 20px 10px}
#ah-sky-flow #sky-app[data-kb="1"] .cta{height:52px}
''', r'''#ah-sky-flow #sky-app[data-kb="1"] .scr{padding-top:6px;padding-bottom:18px}
#ah-sky-flow #sky-app[data-kb="1"] .foot{padding:8px 20px 12px}
#ah-sky-flow #sky-app[data-kb="1"] .cta{height:52px}
'''),
('sky-onboarding.css', r'''
/* iOS leaves a strip between the bottom of the visible page and the keyboard bar / Safari's bottom
   chrome. The page used to end exactly at the visible edge, so that strip showed the flat page tint
   and a hard seam cut through the Next button's glow. While the keyboard is up the flow is built
   140px taller than the visible area and its content is pushed back up by the same amount, so the
   gradient, blobs and glow simply carry on underneath the system bar instead of being cut off. */
/* repeated class = enough specificity to beat account-access.css's keyboard-open rule without naming html/body */
.ah-account-page.ah-account-page.ah-account-page[data-sky-flow="on"][data-sky-kb="1"]{height:calc(var(--visual-viewport-height,100dvh) + 140px)!important}
#ah-sky-flow[data-kb="1"]{height:calc(var(--vh,100dvh) + 140px)!important}
#ah-sky-flow[data-kb="1"] #sky-app{box-sizing:border-box;padding-bottom:140px}

/* Keyboard up: the Next button follows the content instead of sitting at the very bottom with a large
   empty gap above it (the stage is sized to the screen's content by sky-onboarding.js). */
''', r'''
/* Keyboard up (owner 2026-10-18): the flow is exactly the visible area (--vh = visualViewport) and
   the Next button sits just above the keyboard. The old "+140px taller page" trick is gone - it
   left a big empty band under the button. The strip iOS leaves behind its bar is covered by a
   paint-only shadow of the live palette colour below the page (a box-shadow takes no layout space
   and never scrolls, and the flow still never touches html/body). */
.ah-account-page.ah-account-page[data-sky-flow="on"][data-sky-kb="1"]{box-shadow:0 240px 0 0 var(--ah-sky-blend,#E6F0FF)}
/* Roomy keyboard mode: there is enough room, so the big bird stays and fills the space a little
   smaller instead of shrinking to the corner (sky-onboarding.js sets data-kbroomy after measuring). */
#ah-sky-flow #sky-app[data-kb="1"][data-kbroomy="1"] .petwrap{padding-top:8px}
#ah-sky-flow #sky-app[data-kb="1"][data-kbroomy="1"] .bubble{font-size:16px;padding:10px 18px;min-height:0}
'''),
('sky-onboarding.js', r'''  if (window.visualViewport) {
    const fit = () => { host().style.setProperty('--vh', window.visualViewport.height + 'px'); window.scrollTo(0, 0); };
    window.visualViewport.addEventListener('resize', fit); fit();
''', r'''  if (window.visualViewport) {
    // --vh only follows the visual viewport while a flow field is focused and the keyboard is really
    // up. Otherwise it is removed and the CSS falls back to 100dvh, so a stale (keyboard-sized) height
    // can never leave the bottom third of the screen empty after the keyboard closes.
    const fit = () => {
      const h = host(); if (!h) return;
      const vv = window.visualViewport, a = document.activeElement;
      const typing = !!(a && a.tagName === 'INPUT' && h.contains(a));
      if (typing && vv.height < window.innerHeight * 0.88) h.style.setProperty('--vh', vv.height + 'px');
      else h.style.removeProperty('--vh');
      window.scrollTo(0, 0);
    };
    window.visualViewport.addEventListener('resize', fit); fit();
'''),
('sky-onboarding.js', r'''    };
    // Compact mode sizes the stage to the screen's own content so the Next button sits right under
    // the fields/hint/suggestions instead of far below them (flex shrinks it when space runs out).
    const fitStage = () => {
''', r'''    };
    // Keyboard up: the stage fills the space between the bubble and the Next button (CSS), and the
    // Next button sits just above the keyboard. The big bird stays ("roomy") whenever the active
    // screen still fits with it; only when it would not fit does the bird shrink to the corner.
    // Measured synchronously in one frame (try roomy -> check overflow), so nothing flickers.
    const fitStage = () => {
'''),
('sky-onboarding.js', r'''      const app = appEl(), stage = $('sky-stage');
      if (!stage) return;
      if (!app || app.dataset.kb !== '1') { stage.style.height = ''; return; }
      const scr = stage.querySelector('.scr.on');
      if (!scr) return;
''', r'''      const app = appEl(), stage = $('sky-stage');
      if (stage) stage.style.height = '';
      if (!app) return;
      if (app.dataset.kb !== '1') { delete app.dataset.kbroomy; return; }
      const scr = stage && stage.querySelector('.scr.on');
      if (!scr) return;
'''),
('sky-onboarding.js', r'''      if (!scr) return;
      const top = scr.getBoundingClientRect().top;
      let bottom = 0;
      for (const child of scr.children) {
        const r = child.getBoundingClientRect();
        if (r.height > 0) bottom = Math.max(bottom, r.bottom);
      }
      const pad = parseFloat(getComputedStyle(scr).paddingBottom) || 0;
      stage.style.height = Math.max(96, Math.ceil(bottom - top + pad)) + 'px';
    };
''', r'''      if (!scr) return;
      app.dataset.kbroomy = '1';
      if (scr.scrollHeight > scr.clientHeight + 2 || scr.clientHeight < 96) delete app.dataset.kbroomy;
    };
'''),
('sky-onboarding.js', r'''    } catch (_) {}
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { if (editing()) { reeval(); placeLater(); } });
  }
''', r'''    } catch (_) {}
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => {
      if (editing()) { reeval(); placeLater(); return; }
      const app = appEl();
      if (app && app.dataset.kb === '1' && !kbVisible()) { setKb(false); settle(true); }
    });
    // Watchdog: iOS sometimes never fires the resize when the keyboard goes away. While compact mode
    // or a keyboard height is still applied, re-check twice a second and restore the full layout.
    // The state must hold for two ticks in a row (~1s), so a keyboard that is still sliding up is
    // never mistaken for a missing one.
    let stuckTicks = 0;
    setInterval(() => {
      const app = appEl(), h = host();
      if (!app || !h) { stuckTicks = 0; return; }
      const applied = app.dataset.kb === '1' || !!h.style.getPropertyValue('--vh');
      if (!applied || (editing() && kbVisible())) { stuckTicks = 0; return; }
      if (++stuckTicks < 2) return;
      stuckTicks = 0;
      if (app.dataset.kb === '1') setKb(false);
      h.style.removeProperty('--vh');
    }, 500);
  }
'''),
]

for path, old, new in EDITS:
    sub(path, old, new)

# cache tokens (the assets are served immutable; the ?v= token is what makes phones refetch)
for f in ('app-seed.js', 'index.html', 'sw.js'):
    sub_all(f, 'sky-flow-20261017-v10', 'sky-flow-20261018-v11')
# main moves fast (other PRs bump BUILD_ID too), so replace whatever BUILD_ID is current
sw = pathlib.Path('sw.js'); s = sw.read_text(encoding='utf8')
s, n = re.subn(r"const BUILD_ID = '[^']+';", "const BUILD_ID = 'v361-sky-kb-layout';", s, count=1)
if n != 1: raise SystemExit('sw.js: BUILD_ID not found')
sw.write_text(s, encoding='utf8')
sub('scripts/cache-bump.mjs', "  ['sky-flow-20261017-v9', 'sky-flow-20261017-v10']" + chr(10),
    "  ['sky-flow-20261017-v9', 'sky-flow-20261017-v10']," + chr(10)
    + "  // keyboard layout v11: roomy bird, Next above the keyboard, no +140px page, no stale --vh." + chr(10)
    + "  ['sky-flow-20261017-v10', 'sky-flow-20261018-v11']" + chr(10))
print('applied sky keyboard layout v11')
