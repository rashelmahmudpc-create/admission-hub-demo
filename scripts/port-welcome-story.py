#!/usr/bin/env python3
"""One-off porter: turn the owner's Welcome Story v5 preview into a scoped
welcome-story.{css,js} pair. Not part of the build; run once and inspect."""
import pathlib, re, sys

SRC = pathlib.Path('/workspace/project/c4617f47cf844c228f3fd8721e5e2e9e/incoming/1791926350571-Admission_Sky___Welcome_Story_v5__preview_.html')
OUT = pathlib.Path('/workspace/admission-hub-demo')
HOST = '#ah-welcome-story'

html = SRC.read_text(encoding='utf-8')
css = re.search(r'<style>(.*?)</style>', html, re.S).group(1)
# Strip /* ... */ before parsing: the block splitter keys on { } ; and would
# otherwise glue a leading comment onto the selector that follows it.
css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
js = re.search(r'<script>(.*?)</script>', html, re.S).group(1)
main = re.search(r'(<main class="app splash" id="app">.*?</main>)', html, re.S).group(1)
symbol = re.search(r'(<svg width="0" height="0".*?</svg>)', html, re.S).group(1)

# ---- CSS: re-scope every rule under the host -------------------------------
def split_blocks(src):
    blocks, i, n = [], 0, len(src)
    while i < n:
        while i < n and src[i] in ' \t\r\n': i += 1
        if i >= n: break
        if src[i] == '}': i += 1; continue
        j = i
        while j < n and src[j] not in '{};': j += 1
        prelude = src[i:j].strip()
        if j >= n:
            if prelude: blocks.append((prelude, None))
            break
        if src[j] == ';':
            blocks.append((prelude, None)); i = j + 1; continue
        depth, k = 1, j + 1
        while k < n and depth:
            if src[k] == '{': depth += 1
            elif src[k] == '}': depth -= 1
            k += 1
        blocks.append((prelude, src[j + 1:k - 1])); i = k
    return blocks

def scope_selector(sel):
    out = []
    for part in sel.split(','):
        p = part.strip()
        if p in (':root', 'html', 'body'):
            out.append(HOST)
        elif p.startswith(':root'):
            out.append(HOST + p[len(':root'):])
        elif p == '*':
            out.append(HOST + ' *')
        elif p.startswith('html'):
            out.append(HOST + p[len('html'):])
        elif p.startswith('body'):
            out.append(HOST + p[len('body'):])
        else:
            out.append(HOST + ' ' + p)
    return ','.join(out)

def render_blocks(blocks):
    out = []
    for prelude, body in blocks:
        if body is None:
            out.append(prelude + ';'); continue
        if prelude.startswith('@property') or prelude.startswith('@keyframes') or prelude.startswith('@font-face'):
            out.append(f'{prelude}{{{body}}}'); continue
        if prelude.startswith('@'):
            out.append(f'{prelude}{{{render_blocks(split_blocks(body))}}}'); continue
        out.append(f'{scope_selector(prelude)}{{{body}}}')
    return ''.join(out)

scoped_css = render_blocks(split_blocks(css))
# `pin` and `blk` already exist in sky-onboarding.css with different keyframes;
# a shared @keyframes name would let the later sheet win and break this one.
scoped_css = scoped_css.replace('@keyframes pin{', '@keyframes ahw-pin{').replace('animation:pin ', 'animation:ahw-pin ')
scoped_css = scoped_css.replace('@keyframes blk{', '@keyframes ahw-blk{').replace('animation:blk ', 'animation:ahw-blk ')

css_out = f"""/* Admission Sky — Welcome Story v5 (owner's preview).
 *
 * Ported from Admission_Sky___Welcome_Story_v5__preview_.html. The preview is a
 * full page of its own; here every rule is re-scoped under #ah-welcome-story so
 * the animation cannot leak into the rest of the app. Zero raster media: the
 * device, the students and the icons are inline SVG, the fields are CSS.
 *
 * `pin` and `blk` are renamed ahw-* because sky-onboarding.css already defines
 * both names with different keyframes and this sheet loads after it.
 */
#ah-welcome-story{{position:absolute;inset:0}}
{scoped_css}
/* The host fills the welcome view and the story's .app fills the host. The
   story's edge-anchored children are absolutely positioned, so they resolve
   against .app's padding box and ignore its padding -- the safe-area insets
   have to be added to each one. Without this the CTA sat under the home
   indicator on a phone with one, the same clip the Sky flow had. */
#ah-welcome-story .app{{position:absolute;inset:0;height:auto;box-sizing:border-box}}
#ah-welcome-story .top{{top:calc(12px + env(safe-area-inset-top,0px))}}
#ah-welcome-story .band{{top:calc(54px + env(safe-area-inset-top,0px));bottom:calc(86px + env(safe-area-inset-bottom,0px))}}
#ah-welcome-story .cta{{bottom:calc(16px + env(safe-area-inset-bottom,0px))}}
#ah-welcome-story .auth{{padding-top:calc(8px + env(safe-area-inset-top,0px));padding-bottom:calc(22px + env(safe-area-inset-bottom,0px))}}
"""

# ---- JS: scope the id lookups and wire the buttons to the bridge -----------
js_out = js
# the preview's $() looks up ids across the whole document; keep it inside the host
js_out = js_out.replace(
    "const $=id=>document.getElementById(id),app=$('app')",
    "const host=document.getElementById('ah-welcome-story');if(!host)return;host.innerHTML=TEMPLATE;\n"
    "const $=id=>host.querySelector('[id=\"'+id+'\"]'),app=$('app')")
# palette + theme-color must be written to the host, not the document root
js_out = js_out.replace(
    "root=document.documentElement,meta=document.querySelector('meta[name=theme-color]')",
    "root=host,meta=document.querySelector('meta[name=theme-color]')")
js_out = js_out.replace("const bn=n=>String(n).replace(/\\d/g,d=>'০১২৩৪৫৬৭৮৯'[d]);\n", "")

# Replace the preview's toast-only button handler with the real entry paths.
old_buttons = """document.querySelectorAll('.b').forEach(b=>b.addEventListener('click',()=>{const t=$('toast');t.classList.add('s');setTimeout(()=>t.classList.remove('s'),1400)}));"""
new_buttons = """const bridge=()=>window.AdmissionSkyBridge||null;
function flash(msg){const t=$('toast');t.textContent=msg;t.classList.add('s');setTimeout(()=>t.classList.remove('s'),1600)}
$('auth').querySelector('.b.p').addEventListener('click',()=>{const b=bridge();if(b)b.showSignup();else flash('প্রিভিউ — পরের ধাপে যুক্ত হবে')});
$('auth').querySelector('.b.s').addEventListener('click',()=>{const b=bridge();if(b)b.showLogin();else flash('প্রিভিউ — পরের ধাপে যুক্ত হবে')});
const so=$('auth').querySelector('.so');
so.children[0].addEventListener('click',async()=>{const b=bridge();if(!b)return flash('প্রিভিউ — পরের ধাপে যুক্ত হবে');try{const ok=await b.google();if(!ok)flash('Google এখন প্রস্তুত নয়')}catch(_){flash('Google দিয়ে প্রবেশ করা গেল না')}});
so.children[1].addEventListener('click',async()=>{const b=bridge();if(!b)return flash('প্রিভিউ — পরের ধাপে যুক্ত হবে');try{const ok=await b.facebook();if(!ok)flash('Facebook এখন প্রস্তুত নয়')}catch(_){flash('Facebook দিয়ে প্রবেশ করা গেল না')}});
$('auth').querySelector('.b.g').addEventListener('click',()=>{const b=bridge();if(b&&b.continueGuest)b.continueGuest();else flash('প্রিভিউ — পরের ধাপে যুক্ত হবে')});
window.AdmissionWelcomeStory=Object.freeze({open(){app.classList.remove('open');open=false;size();play(1)},close(){app.classList.remove('open');open=false},resize:size,el:()=>host});"""
assert old_buttons in js_out
js_out = js_out.replace(old_buttons, new_buttons)

js_out = js_out.replace("(()=>{\n", "(()=>{\nconst TEMPLATE=`" + main + symbol.replace('`', '\\`') + "`;\n", 1)

js_out = f"""/* Admission Sky — Welcome Story v5 (owner's preview).
 *
 * Ported from Admission_Sky___Welcome_Story_v5__preview_.html. The preview's
 * buttons only showed a toast; here Sign Up / Sign In / Google / Facebook /
 * Guest call window.AdmissionSkyBridge, which account-access.js owns. The story
 * never talks to the API itself.
 */
{js_out}
"""

(OUT / 'welcome-story.css').write_text(css_out, encoding='utf-8')
(OUT / 'welcome-story.js').write_text(js_out, encoding='utf-8')
print('css bytes', len(css_out), 'js bytes', len(js_out))
print('css rules:', scoped_css.count('{'), 'host-prefixed:', scoped_css.count(HOST))
