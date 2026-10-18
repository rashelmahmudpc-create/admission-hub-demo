#!/usr/bin/env python3
"""Build dashboard-v2.js from the owner's Scholar Dashboard design.

The owner supplied 'Scholar Dashboard 3.html' as the design he wants. It is a
standalone page whose DATA block holds demo values and whose buttons only fire
an 'app:action' event nobody listens to. This script keeps the design's markup,
CSS and behaviour, swaps the demo DATA for the app's real CACHE data, and
forwards every action to the host app.

Run:  python3 tools/build-dashboard-v3.py
Out:  dashboard-v2.js

The design source is kept in the repo (tools/design/scholar-dashboard-3.html)
so a rebuild never depends on the Telegram upload folder.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, 'design', 'scholar-dashboard-3.html')
OUTER = os.path.join(HERE, 'dashboard-v3-outer.js')
OUT = os.path.join(ROOT, 'dashboard-v2.js')

src = open(SRC, encoding='utf-8').read()

# ---- split the design into css / body / js -------------------------------
a = src.find('<style>', src.find('</style>') + 1)
b = src.find('</style>', a)
CSS = src[a + 7:b]

bsrc = src.find('>', src.find('<body')) + 1
BODY = src[bsrc:src.find('<script>')]
BODY = re.sub(r'<title>[^<]*</title>', '', BODY)
BODY = re.sub(r'<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>', '', BODY)
BODY = re.sub(r'<style>[\s\S]*?</style>', '', BODY)

ss = src.find('<script>') + 8
JS = src[ss:src.find('</script>', ss)]
assert '</script>' not in JS, 'design JS must not contain a literal script close'


def replace(text, old, new, count=1):
    if text.count(old) < 1:
        raise SystemExit('patch target not found: ' + old[:90])
    return text.replace(old, new, count)


def slice_between(text, start_marker, end_marker):
    i = text.find(start_marker)
    if i < 0:
        raise SystemExit('missing start marker: ' + start_marker)
    j = text.find(end_marker, i + len(start_marker))
    if j < 0:
        raise SystemExit('missing end marker: ' + end_marker)
    return i, j


# ---- PATCH 1: demo DATA -> live host data --------------------------------
di = JS.find('var DATA = {')
dj = JS.find('};', di) + 2
assert di >= 0 and dj > di
JS = JS[:di] + (
    "/* Live data from the host app. The host resolves CACHE and passes a fully\n"
    "   normalised object, so no field below can be missing and no number here is\n"
    "   invented: absent data arrives as an honest zero/empty value. */\n"
    "var DATA=(function(){try{return (parent.__dv3Data&&parent.__dv3Data())||{}}catch(e){return {}}})();"
) + JS[dj:]

# ---- PATCH 2: buttons -> host actions (drop the demo toast) --------------
JS = replace(JS,
    "document.addEventListener('click',function(e){\n"
    "  var a=e.target.closest('[data-action]');if(!a||a.dataset.action==='theme')return;\n"
    "  document.dispatchEvent(new CustomEvent('app:action',{detail:{action:a.dataset.action}}));\n"
    "  if(a.dataset.toast)toast(a.dataset.toast+' (ডেমো)');\n"
    "});",
    "document.addEventListener('click',function(e){\n"
    "  var a=e.target.closest('[data-action]');if(!a||a.dataset.action==='theme')return;\n"
    "  var ok=false;try{ok=!!(parent.__dv3Action&&parent.__dv3Action(a.dataset.action))}catch(_){}\n"
    "  if(!ok)toast('এই অংশটি এখনো যুক্ত হয়নি');\n"
    "});")

# ---- PATCH 3: theme follows the app, never its own ------------------------
ti, tj = slice_between(JS, '/* ---- theme ---- */', '/* ---- header ---- */')
JS = JS[:ti] + (
    "/* ---- theme: the app owns appearance. This frame only mirrors it, so the\n"
    "   dashboard can never drift from the app's own light/dark setting. ---- */\n"
    "var mq=window.matchMedia('(prefers-color-scheme: dark)');\n"
    "function isDark(){var t=document.documentElement.getAttribute('data-theme');return t?t==='dark':mq.matches}\n"
    "function paintThemeIcon(){var el=$('#themeIcon');if(el)el.innerHTML=icon(isDark()?'sun':'moon',false)}\n"
    "function syncTheme(){\n"
    "  var mode='light';try{mode=parent.AhAppearance&&parent.AhAppearance.resolved?parent.AhAppearance.resolved():'light'}catch(_){}\n"
    "  if(mode==='dark')document.documentElement.setAttribute('data-theme','dark');\n"
    "  else document.documentElement.removeAttribute('data-theme');\n"
    "  paintThemeIcon();paintChrome();\n"
    "}\n"
    "function paintChrome(){\n"
    "  var bg='';try{bg=(getComputedStyle(document.documentElement).getPropertyValue('--bg')||'').trim()}catch(_){}\n"
    "  if(bg){try{parent.__dv3Chrome&&parent.__dv3Chrome(bg)}catch(_){}}\n"
    "}\n"
    "function syncSafe(){try{var v=parent.__dv3SafeTop&&parent.__dv3SafeTop();document.documentElement.style.setProperty('--sat-p',(v||0)+'px')}catch(_){}}\n"
    "setInterval(paintChrome,1200);addEventListener('pageshow',paintChrome);\n"
    "syncSafe();addEventListener('resize',syncSafe);addEventListener('orientationchange',function(){setTimeout(syncSafe,200)});\n"
    "try{parent.document.addEventListener('ah:appearance',syncTheme)}catch(_){}\n"
    "$('#themeBtn').addEventListener('click',function(){\n"
    "  var b=$('#themeBtn');b.classList.remove('flip');void b.offsetWidth;b.classList.add('flip');\n"
    "  try{parent.AhAppearance&&parent.AhAppearance.set(isDark()?'light':'dark')}catch(_){}\n"
    "  setTimeout(syncTheme,60);\n"
    "});\n"
    "if(mq.addEventListener)mq.addEventListener('change',syncTheme);\n"
    "syncTheme();\n"
) + JS[tj:]

# ---- PATCH 4: exam/countdown must survive an unset goal -------------------
JS = replace(JS,
    "$('#uniLine').textContent=DATA.exam.uni+' · '+DATA.exam.unit;\n"
    "$('#goalUni').textContent=DATA.exam.uni+' · '+DATA.exam.unit;",
    "var __examLabel=DATA.exam.uni?(DATA.exam.uni+(DATA.exam.unit?' · '+DATA.exam.unit:'')):'লক্ষ্য এখনো সেট করোনি';\n"
    "$('#uniLine').textContent=__examLabel;\n"
    "$('#goalUni').textContent=__examLabel;")

JS = replace(JS,
    "try{$('#cdRest').textContent='পরীক্ষা: '+new Date(exam).toLocaleDateString('bn-BD',{day:'numeric',month:'long',year:'numeric'})}catch(e){}",
    "try{$('#cdRest').textContent=DATA.exam.hasDate?('পরীক্ষা: '+new Date(exam).toLocaleDateString('bn-BD',{day:'numeric',month:'long',year:'numeric'})):'লক্ষ্য ঠিক করলে এখানে দিন গুনবে'}catch(e){}")

# ---- PATCH 5: radar with no topic data yet --------------------------------
JS = replace(JS,
    "var vals=T.map(function(t){return t.v}),labs=T.map(function(t){return t.n});\n"
    "$('#radarFull').innerHTML=radar(vals,labs,'');$('#radarMini').innerHTML=radar(vals,labs,'on-dark');",
    "if(!T.length)T=[{n:'এখনো ডেটা নেই',v:0},{n:'—',v:0},{n:'—',v:0}];\n"
    "var vals=T.map(function(t){return t.v}),labs=T.map(function(t){return t.n});\n"
    "$('#radarFull').innerHTML=radar(vals,labs,'');$('#radarMini').innerHTML=radar(vals,labs,'on-dark');")

# radar click handler: with no topic data there is no .radar svg and no rows
JS = replace(JS,
    "var wi=0,weakIdx=sorted.slice(0,3).map(function(t){return T.indexOf(t)});\n"
    "$('#radarMini').parentNode.querySelector('.radar').addEventListener('click',function(){wi=(wi+1)%3;hl(weakIdx[wi])});\n"
    "hl(weakIdx[0]);",
    "var wi=0,weakIdx=sorted.slice(0,3).map(function(t){return T.indexOf(t)});\n"
    "var __rmini=$('#radarMini')&&$('#radarMini').parentNode&&$('#radarMini').parentNode.querySelector('.radar');\n"
    "if(__rmini)__rmini.addEventListener('click',function(){wi=(wi+1)%3;hl(weakIdx[wi])});\n"
    "if(weakIdx.length)hl(weakIdx[0]);")

# ---- PATCH 6: perf chart with no answered day yet -------------------------
pi = JS.find('/* ---- performance chart (scrub) ---- */')
assert pi >= 0
js_open = JS.find('(function(){', pi)
assert js_open > pi
JS = JS[:js_open + len('(function(){')] + (
    "\n  if(!DATA.perfHasData){$('#perfSvg').innerHTML='<p class=\"wnote\">এখনো কোনো পরীক্ষার উত্তর নেই — কয়েকটি প্রশ্ন সমাধান করলে এখানে সাপ্তাহিক গ্রাফ দেখা যাবে।</p>';return}"
) + JS[js_open + len('(function(){'):]

# ---- PATCH 7: board with no leaderboard feed ------------------------------
# The design draws the board only when the slide is shown, so a fresh account
# leaves the card blank. Paint an honest empty state instead of a phantom rank.
JS = replace(JS,
    "function drawBoard(){",
    "function drawBoardEmpty(){\n"
    "  $('#rk').textContent='—';$('#rkUp').innerHTML='';$('#tops').innerHTML='';\n"
    "  $('#rkNext').textContent='লিডারবোর্ড এখনো চালু হয়নি';$('#rkBar').style.width='0';\n"
    "}\n"
    "function drawBoard(){")

bi, bj = slice_between(JS, 'function drawBoard(){', "}\n$('#seg')")
JS = JS[:bi] + (
    "function drawBoard(){\n"
    "  var B=DATA.board[bset];\n"
    "  if(!B||!B.next){$('#rk').textContent='—';$('#rkUp').innerHTML='';$('#tops').innerHTML='';\n"
    "    $('#rkNext').textContent='লিডারবোর্ড এখনো চালু হয়নি';$('#rkBar').style.width='0';return}\n"
    "  roll($('#rk'),B.rank,B.rank+28,1000);$('#rk').dataset.pre='#';\n"
    "  $('#rkUp').innerHTML=icon('up')+bn(B.up)+' ধাপ';\n"
    "  $('#tops').innerHTML=B.top.map(function(c,i){return '<i style=\"animation-delay:'+(i*90+300)+'ms\">'+c+'</i>'}).join('')+'<small>শীর্ষ ৩ জন</small>';\n"
    "  $('#rkNext').textContent='পরের র‍্যাঙ্কে আর '+bn(B.next-B.xp)+' XP';\n"
    "  var bar=$('#rkBar');bar.style.width='0';requestAnimationFrame(function(){requestAnimationFrame(function(){bar.style.width=Math.round(B.xp/B.next*100)+'%'})});\n"
) + JS[bj:]

# ---- PATCH 7b: AI ticker with fewer than two topics -----------------------
JS = replace(JS,
    "var tickLines=[w3[0].n+' '+bn(alloc[0])+'টি প্রশ্ন',bn(Math.min(10,S.wrong))+'টি ভুল ঠিক করো',w3[1].n+' '+bn(alloc[1])+'টি অনুশীলন'],tki=0;",
    "var tickLines=w3.length>=2?[w3[0].n+' '+bn(alloc[0])+'টি প্রশ্ন',bn(Math.min(10,S.wrong))+'টি ভুল ঠিক করো',w3[1].n+' '+bn(alloc[1])+'টি অনুশীলন']:['একটি পরীক্ষা দিয়ে শুরু করো','প্রতিদিনের লক্ষ্য পূরণ করো','ভুলগুলো একবার ঝালিয়ে নাও'],tki=0;")

# ---- PATCH 8: goal-days mirrors the honest countdown ----------------------
JS = replace(JS,
    "function tickCd(){var days=cdVals()[0];if(ui===0)$('#cdBig').textContent=days;$('#goalDays').textContent=days}",
    "function tickCd(){var days=cdVals()[0];if(ui===0)$('#cdBig').textContent=days;$('#goalDays').textContent=DATA.exam.hasDate?days:0}")

# ---- initial paint: the goal countdown and the board must be correct before
# ---- the first timer tick or slide change, or the goal card shows a phantom
# ---- zero until the minute rolls over -------------------------------------
JS = replace(JS,
    "showUnit(false);setInterval(tickCd,60000);",
    "showUnit(false);tickCd();setInterval(tickCd,60000);")

# the board is drawn on slide change only, so paint the empty state up front
JS = replace(JS,
    "$('button',this).forEach(function(x){x.classList.toggle('on',x===b)});drawBoard()});",
    "$('button',this).forEach(function(x){x.classList.toggle('on',x===b)});drawBoard()});\n"
    "drawBoardEmpty();")

# ---- the design's own "sample data" badge ---------------------------------
assert 'নমুনা ডেটা' in BODY, 'sample-data badge not found'
BODY = BODY.replace('নমুনা ডেটা', 'লাইভ ডেটা')

# ---- font stack: the app's own fonts (offline-safe, no external fetch) ----
CSS = replace(CSS,
    "--f:'Inter','Hind Siliguri','Noto Sans Bengali',system-ui,-apple-system,'Segoe UI',sans-serif;",
    "--f:'Noto Sans Bengali','Hind Siliguri','Inter',system-ui,-apple-system,'Segoe UI',sans-serif;")
assert 'https://' not in CSS, 'design CSS must not fetch anything'

# ---- PATCH 8b: the header shows the student's real photo ------------------
# The design always drew the mascot, ignoring DATA.user.avatar, so the header
# never showed an uploaded photo (owner report 2026-10-17: "ড্যাশবোর্ডে
# প্রোফাইলের অনুযায়ী ছবিটা দেখাবে"). Paint the photo when there is one and fall
# back to the mascot otherwise. The URL is re-read from the host a few times
# after boot, because the profile can finish loading just after the frame
# paints; each read is a localStorage lookup, so it costs no network.
# The avatar is also the fastest way into the Profile tab: dashboard-v2.css
# already carried .dv2-avatar-tap/.dv2-avatar-img, but nothing ever applied
# them, so the photo was decorative.
JS = replace(JS,
    "$('#avatar').innerHTML=mascot(false);",
    "function avatarUrl(){var u=null;try{u=(parent.__ahAvatarUrl&&parent.__ahAvatarUrl())||null}catch(_){}\n"
    "if(!u){try{u=(DATA&&DATA.user&&DATA.user.avatar)||null}catch(_){}}\n"
    "if(!u)return null;try{if(u.charAt(0)==='/')return parent.location.origin+u}catch(_){}\n"
    "return u}\n"
    "function paintAvatar(){var el=$('#avatar');if(!el)return;var u=avatarUrl();\n"
    "var want=u?'<img class=\"dv2-avatar-img\" alt=\"\" src=\"'+u+'\">':mascot(false);\n"
    "if(el.getAttribute('data-src')!==(u||'')){el.setAttribute('data-src',u||'');el.innerHTML=want}}\n"
    "paintAvatar();\n"
    "var avatarTries=0,avatarTick=setInterval(function(){paintAvatar();\n"
    "if(++avatarTries>=8)clearInterval(avatarTick)},600);\n"
    "(function(){var el=$('#avatar');if(!el)return;el.classList.add('dv2-avatar-tap');\n"
    "el.addEventListener('click',function(){var path='my-profile';\n"
    "try{if(parent.__dv3Action&&parent.__dv3Action('nav.profile'))return}catch(_){}\n"
    "try{if(parent.AdmissionNavigation&&parent.AdmissionNavigation.openTab)parent.AdmissionNavigation.openTab(path)}catch(_){}});\n"
    "el.setAttribute('role','button');el.setAttribute('aria-label','প্রোফাইল খোলো')})();")
# The photo must fill the rounded square the mascot sat in, or it renders at its
# natural pixel size and bursts the header. .dv2-avatar-img is absolutely
# positioned, so .avatar must establish the containing block or the photo
# escapes to the nearest positioned ancestor and covers the page.
CSS = replace(CSS,
    ".avatar .mascot{width:42px;margin-bottom:-4px}",
    ".avatar .mascot{width:42px;margin-bottom:-4px}\n"
    ".avatar{position:relative}\n"
    ".avatar img{width:100%;height:100%;object-fit:cover;display:block}")

# ---- PATCH 9: header clears the phone's status bar and blends with it -----
# The design was drawn inside a preview that added the safe-area padding itself.
# Standalone, the sticky header sat at y=0 *under* the status bar, so the greeting
# and buttons were cut off. --sat is the device's top inset (CSS env() or the value
# the host measured, whichever is larger) and the header pads itself by it. The
# stuck header uses the page colour (not the lighter nav tint) so the status-bar
# area and the header look like one surface.
CSS = replace(CSS,
    ":root{\n  --bg:#F4F6FD;",
    ":root{\n  --sat:max(env(safe-area-inset-top,0px),var(--sat-p,0px));\n  --bg:#F4F6FD;")
CSS = replace(CSS,
    "padding-block:14px 12px;margin-inline:-20px;padding-inline:20px}",
    "padding-block:calc(14px + var(--sat)) 12px;margin-inline:-20px;padding-inline:20px}")
CSS = replace(CSS,
    ".top.stuck::before{background:var(--nav);",
    ".top.stuck::before{background:var(--bg);background:color-mix(in srgb,var(--bg) 90%,transparent);")

# ---- assemble the frame --------------------------------------------------
HTML = ('<!doctype html><html lang="bn"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>:root{color-scheme:light}html,body{margin:0;padding:0;height:100%;'
        'background:var(--bg,#F4F6FD)}</style>'
        '<style>' + CSS + '</style></head><body>' + BODY +
        '<script>' + JS + '</script></body></html>')

# the frame is embedded as a template literal, so escape its own syntax once
escaped = HTML.replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')
escaped = escaped.replace('</script>', '<\\/script>')

out = open(OUTER, encoding='utf-8').read().replace('/*__SRCDOC__*/', '`' + escaped + '`')
if '/*__SRCDOC__*/' in out:
    raise SystemExit('srcdoc marker not substituted')

open(OUT, 'w', encoding='utf-8').write(out)

# the assembled frame, kept beside the design source so the browser harnesses
# can load it without having to un-escape the template literal
frame_path = os.path.join(HERE, 'design', '_frame.html')
open(frame_path, 'w', encoding='utf-8').write(HTML)

print('wrote %s (%d bytes; frame %d chars)' % (OUT, len(out), len(HTML)))
print('wrote %s' % frame_path)
