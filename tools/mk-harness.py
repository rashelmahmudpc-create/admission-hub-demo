#!/usr/bin/env python3
"""Build the two browser harnesses used to verify the dashboard frame.

  dv3-frame-standalone.html  -> a realistic, populated student
  dv3-empty.html             -> a brand-new student with nothing recorded

Both inject a stub host (__dv3Data/__dv3Action/AhAppearance), print any
uncaught error, and dump the rendered values into a PROBE line.
"""
import os
import json

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def frame_html():
    return open(os.path.join(HERE, 'design', '_frame.html'), encoding='utf-8').read()


FULL = {
    "user": {"name": "রাহিম", "avatar": None},
    "mission": {"total": 100, "done": 25, "subjects": [
        {"n": "বাংলা", "done": 10, "total": 34},
        {"n": "English", "done": 8, "total": 33},
        {"n": "GK", "done": 7, "total": 33}]},
    "exam": {"date": 1796616000000, "uni": "রাজশাহী বিশ্ববিদ্যালয়", "unit": "A ইউনিট",
             "prepDays": 90, "hasDate": True, "daysLeft": 53},
    "streak": {"days": 3, "target": 7, "week": [0, 0, 0, 0, 25, 30, 25]},
    "stats": {"solved": 25, "correct": 19, "wrong": 6, "mastery": 76, "minutes": 52},
    "course": {"title": "এখনো কোনো কোর্স শুরু করোনি", "progress": 0, "id": None},
    "perf": [0, 0, 0, 0, 80, 67, 75], "perfHasData": True,
    "topics": [{"n": "গণিত", "v": 0}, {"n": "বাংলা", "v": 50}, {"n": "English", "v": 67},
               {"n": "GK", "v": 71}, {"n": "পদার্থ", "v": 80}, {"n": "রসায়ন", "v": 88}],
    "goal": {"weeklyTarget": 700, "prep": 11},
    "board": {"week": None, "month": None},
}

EMPTY = {
    "user": {"name": "Scholar", "avatar": None},
    "mission": {"total": 100, "done": 0, "subjects": [{"n": "আজ", "done": 0, "total": 100}]},
    "exam": {"date": 1796616000000, "uni": "", "unit": "", "prepDays": 90,
             "hasDate": False, "daysLeft": 0},
    "streak": {"days": 0, "target": 3, "week": [0, 0, 0, 0, 0, 0, 0]},
    "stats": {"solved": 0, "correct": 0, "wrong": 0, "mastery": 0, "minutes": 0},
    "course": {"title": "এখনো কোনো কোর্স শুরু করোনি", "progress": 0, "id": None},
    "perf": [0, 0, 0, 0, 0, 0, 0], "perfHasData": False, "topics": [],
    "goal": {"weeklyTarget": 700, "prep": 0},
    "board": {"week": None, "month": None},
}

SHIM = """<script>
window.__dv3Data=function(){return __DATA__};
window.__dv3Action=function(a){window.__lastAction=a;return true};
window.AhAppearance={resolved:function(){return 'light'},set:function(){},get:function(){return 'light'}};
window.onerror=function(m,u,l){var p=document.createElement('pre');p.id='ERR';p.style.cssText='position:fixed;z-index:99999;background:#fdd;font-size:12px';p.textContent='ERR: '+m+' @'+l;document.body.appendChild(p)};
</script>"""

PROBE = """<script>
setTimeout(function(){
  var q=function(id){var e=document.getElementById(id);return e?e.textContent:null};
  var out={greet:q('greet'),today:q('today'),mCnt:q('mCnt'),mleft:q('mleft'),uni:q('uniLine'),cdBig:q('cdBig'),
   cdRest:q('cdRest'),goalDays:q('goalDays'),goalUni:q('goalUni'),goalPct:q('goalPct'),jPct:q('jPct'),
   streak:(document.querySelector('.sbig b')||{}).textContent,badgeTxt:q('badgeTxt'),
   wVal:q('wVal'),wName:q('wName'),rkNext:q('rkNext'),mastNote:q('mastNote'),weekNote:q('weekNote'),tk:q('tk'),
   timeTxt:q('timeTxt'),course:(document.querySelector('.course small')||{}).textContent,
   statSolved:(document.querySelector('[data-count="stats.solved"]')||{}).textContent,
   days7:document.querySelectorAll('#days7 div').length,
   weekBars:document.querySelectorAll('#week button').length,
   wlist:document.querySelectorAll('#wlist .wi').length,
   tools:document.querySelectorAll('#toolGroups .tl').length,
   perfSvg:!!document.querySelector('#perfSvg svg'),
   radarSvg:!!document.querySelector('#radarFull svg'),
   boardTop:document.querySelectorAll('#tops i').length,
   themeAttr:document.documentElement.getAttribute('data-theme'),
   err:(document.getElementById('ERR')||{}).textContent||null};
  var p=document.createElement('pre');p.id='PROBE';p.style.cssText='position:fixed;left:0;top:0;z-index:99999;background:#ffd;font-size:12px';
  p.textContent='PROBE='+JSON.stringify(out);document.body.appendChild(p);
},2200);
</script>"""


def build(name, data):
    s = frame_html()
    s = s.replace('<script>',
                  SHIM.replace('__DATA__', json.dumps(data, ensure_ascii=False)) + '<script>', 1)
    s = s.replace('</body>', PROBE + '</body>')
    open(os.path.join(HERE, name), 'w', encoding='utf-8').write(s)
    print('wrote tools/' + name)


build('dv3-frame-standalone.html', FULL)
build('dv3-empty.html', EMPTY)
