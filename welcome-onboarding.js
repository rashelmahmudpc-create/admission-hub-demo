/* Owner's v5 "Welcome Story" as the live welcome screen.
 *
 * The design itself is the owner's standalone preview, scoped to .ahw-sky (see
 * welcome-onboarding.css). This file mounts it into the existing welcome view
 * and re-points its entry buttons at the account flow's real controls, which
 * account-access.js has already bound:
 *   সাইন আপ  -> welcome-signup       (signup journey)
 *   সাইন ইন  -> welcome-login        (login view)
 *   Google   -> welcome-google-button (Google Identity Services host)
 *   গেস্ট     -> continue-guest       (guest entry)
 *   Facebook -> kept, deliberately inert until the owner turns it on
 *   Get Started -> the design's own auth panel
 *
 * No API, authentication or account-state change lives here; the account flow
 * keeps owning all of that. */
(() => {
'use strict';
const base=new URL('.',document.currentScript.src),version='welcome-native-20261010-v30';
let timers=[],opened=false,mounted=null,bound=null,toastTimer=null;

const $=id=>document.getElementById(id);
const at=(m,f)=>timers.push(setTimeout(f,m)),clr=()=>{timers.forEach(clearTimeout);timers=[]};

function tap(x,y){const fg=$('sky-fing');if(!fg)return;fg.style.setProperty('--fx',(x-22)+'px');fg.style.setProperty('--fy',(y-4)+'px');fg.classList.add('show');at(700,()=>fg.classList.add('press'));at(950,()=>fg.classList.remove('press'));at(1600,()=>{fg.classList.remove('show');fg.style.setProperty('--fy','780px')})}

function toast(msg){const t=$('sky-toast');if(!t)return;t.textContent=msg;t.classList.add('s');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('s'),1600)}

const ready=()=>document.readyState!=='loading'?Promise.resolve():new Promise(r=>document.addEventListener('DOMContentLoaded',()=>r(),{once:true}));

const controls=()=>{
 const view=document.getElementById('ah-account-page')?.querySelector('[data-view="welcome"]');
 if(!view)return null;
 return {
  view,
  signup:view.querySelector('[data-role="welcome-signup"]'),
  login:view.querySelector('[data-role="welcome-login"]'),
  google:view.querySelector('[data-role="welcome-google-button"]'),
  guest:view.querySelector('[data-role="continue-guest"]'),
  language:view.querySelector('[data-role="welcome-language"]')
 };
};

/* Point the design's entry buttons at the account flow's real controls. The
   controls keep their own listeners (account-access.js owns the flows); the
   design's buttons stay exactly as drawn and simply trigger them. Google is the
   exception — the real Google Identity button must be shown, so its host is
   moved into the design's Google slot. */
function bind(root,ctl){
 if(bound===root)return;
 bound=root;
 const trigger=(slotName,node)=>{const host=root.querySelector('[data-sky-slot="'+slotName+'"]');if(!host||!node)return;host.addEventListener('click',e=>{e.preventDefault();node.click()})};
 trigger('signup',ctl.signup);
 trigger('login',ctl.login);
 trigger('guest',ctl.guest);
 const gslot=root.querySelector('[data-sky-slot="google"]');
 /* Google is the one entry we must not fake: Google Identity Services renders a
    real button, so lay it transparently over the design's pill — the drawn
    button stays, and the click lands on the genuine Google control. */
 if(gslot&&ctl.google){gslot.append(ctl.google);ctl.google.classList.add('ah-sky-google-overlay')}
 const fb=root.querySelector('[data-sky-slot="facebook"]');
 if(fb){fb.setAttribute('aria-disabled','true');fb.title='Facebook লগইন শীঘ্রই আসছে';fb.addEventListener('click',()=>toast('Facebook লগইন শীঘ্রই আসছে'))}
 if(ctl.language){const top=root.querySelector('#sky-top');if(top)top.append(ctl.language)}
 $('sky-bk')?.addEventListener('click',()=>{clr();opened=false;$('sky-app')?.classList.remove('open');at(800,()=>sync())});
 $('sky-go')?.addEventListener('click',()=>{clr();opened=true;$('sky-app')?.classList.remove('desk');document.documentElement.style.setProperty('--skyt','#E3EEFF');$('sky-app')?.classList.add('open')});
}

function size(){const band=$('sky-band'),fit=$('sky-fit');if(!band||!fit)return;const r=band.getBoundingClientRect();if(!r.width||!r.height)return;fit.style.setProperty('--s',Math.min(r.width/390,r.height/640).toFixed(3))}

const start=()=>{if(opened)return;clr();play(0)};

/* The story only runs while the welcome view is actually on screen, and it must
   stop the moment the student leaves — otherwise its timer chain outlives the
   screen (and the page). */
const active=()=>{
 if(!mounted||opened)return false;
 const page=document.getElementById('ah-account-page'),view=page?.querySelector('[data-view="welcome"]');
 return !!(page&&!page.hidden&&view&&!view.hidden&&page.dataset.currentView==='welcome');
};
const sync=()=>{mount();if(!mounted)return;if(active()){if(!timers.length)start()}else clr()};

/* The owner's story timeline, exactly as in the preview. */
const P={sp:['#EAF1FF','#2F6BFF','#FFB020'],a:['#FFF0E4','#4F46E5','#FF7A59'],td:['#EDE5DA','#4F46E5','#FF7A59'],hm:['#E9F1FF','#2F6BFF','#FFB020'],b:['#F0EAFF','#7C3AED','#10B981'],d:['#E3F5F3','#0E9F9E','#F59E0B'],rt:['#FFEFF2','#2563EB','#F43F5E'],fin:['#E3F0FF','#2F6BFF','#FFB020']};
const T=[
 {p:'sp',ms:2000,sc:'sp'},
 {p:'a',ms:3700,sc:'a'},
 {p:'td',ms:4600,sc:'td',v:'msg',cam:'c-td',desk:1,tag:'বন্ধুর মেসেজ',ev:[[2800,()=>tap(168,440)]]},
 {p:'hm',ms:4400,v:'hm',cam:'c-hand',held:1,tab:0,tag:'অ্যাপে ঢুকলাম',lnc:1,ev:[[2200,()=>tap(195,326)],[2800,()=>$('sky-t1')?.classList.add('pr')]]},
 {p:'b',ms:5100,v:'b',cam:'c-flat',held:1,tab:1,tag:'AI এজেন্ট',rate:1.15,pip:1,ev:[[2500,()=>$('sky-pip')?.classList.add('hap')],[3500,()=>tap(244,648)]]},
 {p:'d',ms:5500,v:'d',cam:'c-tr',held:1,tab:2,tag:'পরীক্ষা',rate:1.3,ev:[[100,()=>tap(195,286)],[2700,()=>tap(195,565)],[4300,()=>tap(341,648)]]},
 {p:'rt',ms:5800,v:'c',cam:'c-dn',held:1,tab:3,tag:'রুটিন',rate:1.3,ev:[[300,()=>tap(195,134)],[1900,()=>tap(195,288)]]},
 {p:'fin',ms:3600,sc:'fin'}];

function pal(id){const c=P[id];if(!c)return;const r=document.documentElement;r.style.setProperty('--skyt',c[0]);r.style.setProperty('--skyp',c[1]);r.style.setProperty('--skyq',c[2])}

function play(i){if(!active()){clr();return}const s=T[i];if(!s)return;
 ['sp','a','fin','td'].forEach(id=>$('sky-'+id).classList.toggle('on',id===s.sc));
 ['msg','hm','b','d','c'].forEach(id=>$('sky-'+id).classList.toggle('on',id===s.v));
 pal(s.p);
 const app=$('sky-app');app.classList.toggle('desk',!!s.desk);app.classList.toggle('splash',i===0);
 $('sky-cam').className='cam'+(s.cam?' show '+s.cam:'')+(s.held?' held':'');
 $('sky-tb').classList.toggle('on',s.tab!==undefined);[...$('sky-tb').children].forEach((e,j)=>e.classList.toggle('act',j===s.tab));
 const tag=$('sky-tag');tag.textContent=s.tag||'';tag.classList.toggle('vis',!!s.tag);$('sky-top').classList.toggle('vis',i>0);
 $('sky-pip').classList.toggle('vis',!!s.pip);if(!s.pip)$('sky-pip').classList.remove('hap');
 if(i!==3)$('sky-t1')?.classList.remove('pr');
 if(s.lnc){const l=$('sky-lnc');l.classList.remove('go');void l.offsetWidth;l.classList.add('go')}
 if(s.rate)setTimeout(()=>{$('sky-'+s.v)?.getAnimations?.({subtree:true}).forEach(a=>a.playbackRate=s.rate)},40);
 (s.ev||[]).forEach(([m,f])=>at(m,f));
 at(s.ms,()=>play(i+1<T.length?i+1:1))}

async function mount(){
 const ctl=controls();
 if(!ctl||!ctl.signup)return;
 const state=ctl.view.dataset.welcomeUpgrade;
 if(state===version||state==='pending')return;
 ctl.view.dataset.welcomeUpgrade='pending';
 ctl.view.style.visibility='hidden';
 try{
  const res=await fetch(new URL('welcome-onboarding.html?v='+version,base));
  if(!res.ok)throw Error('Welcome template unavailable');
  const tpl=document.createElement('template');tpl.innerHTML=await res.text();
  const root=tpl.content.querySelector('.ahw-sky-board');
  if(!root||!root.querySelector('#sky-app'))throw Error('Invalid welcome template');
  build(root);
  const page=document.getElementById('ah-account-page');
  const hadFocus=ctl.view.contains(document.activeElement);
  ctl.view.className='ah-account-view ah-welcome-view ah-welcome-sky';
  ctl.view.dataset.welcomeUpgrade=version;
  ctl.view.append(root);
  ctl.view.style.visibility='';
  page.classList.add('ah-welcome-upgraded');
  mounted=root;
  bind(root,ctl);
  size();
  sync();
  if(hadFocus)ctl.signup.focus({preventScroll:true});
 }catch(error){
  ctl.view.style.visibility='';
  ctl.view.dataset.welcomeUpgrade='failed';
  document.getElementById('ah-account-page')?.classList.remove('ah-welcome-upgraded');
  console.warn('[welcome-sky] original welcome restored:',error.message);
 }
}

/* Fill the design's dynamic regions (the preview did this inline). */
function build(root){
 const stu=t=>'<svg viewBox="0 0 300 300" class="stu'+(t?' tidy':'')+'"><ellipse cx="150" cy="292" rx="134" ry="7" fill="rgba(11,27,58,.14)"/><g class="bd"><path d="M60 236C60 176 98 148 150 148s90 28 90 88Z" fill="var(--skyp)"/><path d="M82 174 96 218M218 174 204 218" stroke="var(--skyp)" stroke-width="30" stroke-linecap="round"/><path d="M124 150c6 16 46 16 52 0" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="5" stroke-linecap="round"/></g><g class="hd2"><rect x="136" y="122" width="28" height="32" rx="12" fill="#E8B48A"/><circle cx="150" cy="96" r="42" fill="#F3C7A0"/><path d="M106 94C102 52 138 44 156 46c26 0 44 20 38 50-8-18-22-26-44-26s-36 8-44 24Z" fill="#1E2A4A"/><g class="gz"><g class="ey"><circle cx="136" cy="102" r="4" fill="#1E2A4A"/><circle cx="164" cy="102" r="4" fill="#1E2A4A"/></g></g><path class="br" d="M127 91q9-6 18 0M155 91q9-6 18 0" fill="none" stroke="#1E2A4A" stroke-width="3" stroke-linecap="round"/><path class="mf" d="M138 126q12-10 24 0" fill="none" stroke="#1E2A4A" stroke-width="3.2" stroke-linecap="round"/><ellipse class="mo" cx="150" cy="122" rx="5" ry="6" fill="#B4443C"/><path class="ms" d="M134 116q16 18 32 0Z" fill="#B4443C"/><circle class="ck" cx="126" cy="116" r="6" fill="#FF9AA2" opacity=".6"/><circle class="ck" cx="174" cy="116" r="6" fill="#FF9AA2" opacity=".6"/></g><rect x="12" y="214" width="276" height="76" rx="18" fill="#fff"/><rect x="12" y="214" width="276" height="9" rx="4" fill="#E6EAF4"/><circle class="h1" cx="98" cy="217" r="11" fill="#F3C7A0"/><circle class="h2" cx="202" cy="217" r="11" fill="#F3C7A0"/>'+(t?'<rect x="24" y="192" width="70" height="16" rx="3" fill="#9DB7FF"/><rect x="28" y="176" width="62" height="16" rx="3" fill="var(--skyq)"/><rect x="32" y="160" width="54" height="16" rx="3" fill="#fff" stroke="#DDE3F0"/><rect x="206" y="192" width="70" height="16" rx="3" fill="#FF9F85"/><rect x="210" y="176" width="62" height="16" rx="3" fill="var(--skyp)"/><rect x="116" y="188" width="68" height="46" rx="7" fill="#16264A"/><rect x="121" y="193" width="58" height="36" rx="4" fill="var(--skyq)"/><path d="m139 211 8 8 14-16" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>':'<g class="drift"><rect x="40" y="186" width="46" height="58" rx="3" fill="#fff" stroke="#DDE3F0" transform="rotate(14 63 215)"/></g><rect x="20" y="204" width="86" height="22" rx="4" fill="#9DB7FF" transform="rotate(-10 63 215)"/><rect x="190" y="198" width="88" height="24" rx="4" fill="#FF9F85" transform="rotate(9 234 210)"/><g class="drift" style="animation-delay:-2s"><rect x="214" y="174" width="40" height="52" rx="3" fill="#fff" stroke="#DDE3F0" transform="rotate(-16 234 200)"/></g><rect x="114" y="208" width="46" height="34" rx="3" fill="#fff" stroke="#DDE3F0" transform="rotate(-7 137 225)"/><rect x="160" y="208" width="46" height="34" rx="3" fill="#F7F9FF" stroke="#DDE3F0" transform="rotate(7 183 225)"/><rect x="246" y="186" width="26" height="26" rx="3" fill="#FFE08A" transform="rotate(10 259 199)"/><rect class="phn" x="136" y="228" width="22" height="40" rx="5" fill="#16264A" transform="rotate(-8 147 248)"/>')+'</svg>';
 const spk=(l,t,d,x,y)=>'<i class="spk" style="left:'+l+'px;top:'+t+'px;--d:'+d+'s;--x:'+x+'px;--y:'+y+'px"></i>';
 const face=h=>'<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="28" fill="#F3C7A0"/><path d="M6 28C4 8 22 2 32 3c16 1 24 12 22 25-5-10-13-14-24-14S10 18 6 28Z" fill="#1E2A4A"/><circle cx="21" cy="32" r="2.6" fill="#1E2A4A"/><circle cx="39" cy="32" r="2.6" fill="#1E2A4A"/>'+(h?'<path d="M20 40q10 11 20 0Z" fill="#B4443C"/>':'<path d="M22 45q8-5 16 0" fill="none" stroke="#1E2A4A" stroke-width="2.4" stroke-linecap="round"/>')+'</svg>';
 const friend='<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="28" fill="#F0B98E"/><path d="M4 30C0 6 24 0 34 2c16 2 26 14 22 30-2-8-4-12-8-14-10 2-26 2-34-2-2 3-4 8-6 14Z" fill="#3A2A22"/><circle cx="21" cy="33" r="2.6" fill="#2A1E1A"/><circle cx="39" cy="33" r="2.6" fill="#2A1E1A"/><path d="M20 41q10 10 20 0Z" fill="#B4443C"/></svg>';
 const q=id=>root.querySelector('#'+id);
 q('sky-a').innerHTML='<span class="qm" style="left:96px;top:128px;--d:.8s">?</span><span class="qm" style="left:262px;top:112px;--d:1.1s">!</span><span class="qm" style="left:70px;top:190px;--d:1.4s;font-size:22px">?</span>'+stu(false)+'<div class="line">পড়া অনেক, সময় কম, শুরু করব কীভাবে?</div>';
 q('sky-b').innerHTML='<div class="chd"><div class="orb"></div><div><b>AI এজেন্ট</b><small><i></i>অনলাইন</small></div></div><div class="msgs"><div class="m me" style="--d:.8s">ভাই, ভর্তি পরীক্ষার প্রস্তুতি কীভাবে শুরু করব?<span class="fa">'+face(0)+'</span></div><div class="m ai" style="--d:1.8s"><div class="dt"><i></i><i></i><i></i></div><div class="tx">চিন্তা নেই! আগে তোমার লক্ষ্য ঠিক করি, তারপর সময় অনুযায়ী পুরো প্ল্যান বানিয়ে দেব।</div></div><div class="m me" style="--d:4s">দারুণ! এখনই শুরু করি<span class="fa">'+face(1)+'</span></div></div>'+spk(300,330,4.2,20,-30)+spk(250,380,4.3,-10,-40)+spk(330,400,4.4,10,-36)+spk(210,340,4.5,-16,-30)+'<div class="line">প্রশ্ন করো, AI বুঝিয়ে দেবে</div>';
 const days=['শ','র','সো','ম','বু','বৃ','শু'],pat=[[44,30,0],[30,52,34],[56,24,40],[34,48,0],[50,36,30],[26,56,40],[40,32,0]];
 q('sky-c').innerHTML='<div class="hdr">রুটিন তৈরি করি</div><div class="lab" style="top:48px">তোমার লক্ষ্য</div><div class="chs"><i>বিশ্ববিদ্যালয়</i><i>মেডিকেল</i><i>গুচ্ছ</i></div><div class="lab" style="top:136px">প্রতিদিন কত ঘণ্টা পড়তে পারবে?</div><div class="sld"><u></u><s></s><span class="hv"><em style="--i:0">২</em><em style="--i:1">৩</em><em style="--i:2">৪</em><em style="--i:3">৫</em><span>ঘণ্টা</span></span></div><button class="gob" type="button">রুটিন বানাও</button><div class="tap tp1"></div><div class="tap tp2"></div><div class="ldg">AI রুটিন সাজাচ্ছে…</div><div class="tt"><div class="th">তোমার সাপ্তাহিক রুটিন<span class="pl">প্রস্তুত</span></div><div class="gr">'+days.map((d,i)=>'<div class="cn">'+pat[i].filter(h=>h).map((h,j)=>'<i class="bl '+(['c','d','c'][j])+'" style="--h:'+h+'px;--k:'+(i*3+j)+'"></i>').join('')+d+'</div>').join('')+'</div></div><div class="line">নিজের মতো রুটিন, এক মিনিটে</div>';
 q('sky-d').innerHTML='<div class="eh"><b>মডেল টেস্ট ০৩</b><span class="tm" id="sky-tm">২৪:৫৯</span></div><div class="pg"><u></u></div><div class="qt">প্রশ্ন ৮ / ২০</div><div class="qq">বাংলাদেশের জাতীয় ফুল কোনটি?</div><div class="ops"><div class="op"><i>ক</i>গোলাপ</div><div class="op w1"><i>খ</i>জবা</div><div class="op r1"><i>গ</i>শাপলা</div><div class="op"><i>ঘ</i>কাঁঠালচাঁপা</div></div><div class="tap tp4"></div><div class="ex"><div class="orb"></div><div>ভুল হয়েছে! জাতীয় ফুল শাপলা। পানির ফুল, তাই মনে রাখা সহজ।</div></div><button class="sub" type="button">পরীক্ষা জমা দাও</button><div class="tap tp3"></div><div class="rs"><div class="rr"><svg viewBox="0 0 150 150"><defs><linearGradient id="sky-g2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2563EB"/><stop offset="1" stop-color="#F43F5E"/></linearGradient></defs><circle class="a" cx="75" cy="75" r="60"/><circle class="b" cx="75" cy="75" r="60"/></svg><b>১৮/২০</b></div><strong>খুব ভালো করেছ!</strong><small>AI বিশ্লেষণ: ব্যাকরণে আরেকটু অনুশীলন করলেই ১০০%</small></div>';
 q('sky-fin').innerHTML='<div class="fl">ভর্তির স্বপ্ন,<br>এবার সহজে।</div>'+stu(true)+spk(60,150,.9,-20,-30)+spk(320,170,1.1,16,-30)+spk(40,300,1.3,-14,-24)+spk(340,320,1.5,14,-30);
 q('sky-sp').innerHTML='<div class="spw"><div class="halo"></div><svg class="ring" viewBox="0 0 236 236"><defs><linearGradient id="sky-rgr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--skyp)"/><stop offset="1" style="stop-color:var(--skyq)"/></linearGradient></defs><circle class="rb" cx="118" cy="118" r="110"/><circle class="rf" cx="118" cy="118" r="110"/></svg><div class="tile big"><svg viewBox="0 0 120 120"><path class="trl" d="M20 100C44 92 76 70 100 26"/><path class="chv" d="M30 94 60 54 90 94"/><g class="cap"><path class="cf" d="M60 16 92 29 60 42 28 29Z"/><path d="M42 36v9c0 5 36 5 36 0v-9M92 29v16"/></g><path class="str" d="M100 14l3 8 8 3-8 3-3 8-3-8-8-3 8-3Z"/></svg></div></div>';
 q('sky-msg').innerHTML='<div class="mh"><div class="av">'+friend+'</div><div><b>রাফি</b><small>সক্রিয় আছেন</small></div></div><div class="mb f" style="top:84px;--d:.4s">ভাই, ভর্তির প্রস্তুতি কেমন চলছে?</div><div class="mb m" style="top:160px;--d:1.2s">আর বলিস না, কোথা থেকে শুরু করব বুঝতেছি না</div><div class="mb f ty" style="top:256px"><div class="dt"><i></i><i></i><i></i></div></div><div class="mb f" style="top:256px;--d:2.6s">Admission Sky ট্রাই কর! AI সব গুছিয়ে দেয়</div><div class="lk"><div class="lnt"><svg width="34" height="34" viewBox="0 0 120 120"><use href="#sky-mk"/></svg></div><div><b>Admission Sky</b><small>AI দিয়ে ভর্তির প্রস্তুতি</small></div><em>খুলুন</em></div>';
 const ic={ex:'<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="m9 12 2 2 4-4"/></svg>',rt:'<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>'};
 q('sky-hm').innerHTML='<div class="hmg" style="--i:0">শুভ সকাল</div><div class="hmn" style="--i:0">রাহিম</div><div class="hmp" style="--i:1"><small>আজকের লক্ষ্য</small><b>৩ / ৫ সম্পন্ন</b><u></u></div><div class="hmt t1" id="sky-t1" style="--i:2"><div class="orb"></div><div>AI এজেন্ট<small>প্রশ্ন করো, AI বুঝিয়ে দেবে</small></div></div><div class="hmt t2" style="--i:3"><div class="ito">'+ic.ex+'</div>মডেল টেস্ট<small>পরীক্ষা দাও</small></div><div class="hmt t3" style="--i:4"><div class="ito">'+ic.rt+'</div>রুটিন<small>প্ল্যান বানাও</small></div>';
 q('sky-pip').innerHTML=face(0).replace('<svg','<svg class="n"')+face(1).replace('<svg','<svg class="h"');
 root.addEventListener('click',e=>{const t=e.target.closest('.gob,.sub');if(t)toast(t.classList.contains('gob')?'রুটিন তৈরি হচ্ছে…':'পরীক্ষা জমা হচ্ছে…')});
}

/* The upgraded welcome must not keep the scroll lock once the student leaves. */
const releaseLock=()=>{
 if(typeof document==='undefined'||!document)return;
 const page=document.getElementById('ah-account-page');
 if(!page)return;
 if(page.hidden||page.dataset.currentView!=='welcome')page.classList.remove('ah-welcome-upgraded');
};
new MutationObserver(releaseLock).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','data-current-view']});
releaseLock();
const discover=new MutationObserver(()=>sync());discover.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','data-current-view']});
window.addEventListener('resize',size,{passive:true});
window.addEventListener('pagehide',()=>{clr();discover.disconnect()},{once:true});
ready().then(mount);
})();
