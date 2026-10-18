/* Exam Center · Sky — ported UI from the owner's design file.
   SOURCE: incoming/1792313145814-Exam_Center___Sky_2.html (owner's design, 2026-10-18).
   The look is the owner's and must not be redesigned: colours, fonts, buttons,
   animations and the top blend are carried over as-is.

   WIRING STATUS
     TODO 1 (done) — data: the bank is read from CACHE (cloud-content-sync.js
       fills it from GET /pub/content) via mapBank(), not hardcoded.
     TODO 2 (open) — persistence: results/mistakes must go to the real stores
       (user_exam_results / user_exams / user_mistakes via userdata-api.mjs).
       Until then history is in-memory and is lost on refresh.
     TODO 3 (open) — AI: aiHTML/shareRes must call the app's existing AI path
       instead of a local stub.
   See tools/exam_center_port_plan.md.
*/
/* TODO 1 (done) — real data. The bank is NOT hardcoded any more; it is read
   from CACHE, which cloud-content-sync.js fills from GET /pub/content.
   The demo's per-question shape is {q,o,a,t,s,e}; the backend's is
   {question,options,answer,explanation,subjectId,topicId,topicName}, so mapBank()
   translates one into the other and nothing downstream needs to change. */
let Q=[];
function mapBank(){
  const subs=(typeof CACHE!=='undefined'&&CACHE&&Array.isArray(CACHE.subjects))?CACHE.subjects:[];
  const raw =(typeof CACHE!=='undefined'&&CACHE&&Array.isArray(CACHE.questions))?CACHE.questions:[];
  const nameOf=id=>{const s=subs.find(x=>String(x.id)===String(id));return (s&&(s.name||s.title))||''};
  const live=raw.filter(q=>q&&!q.deleted&&(q.question||q.q)&&((Array.isArray(q.options)&&q.options.length)||(Array.isArray(q.o)&&q.o.length)));
  Q=live.map(q=>({
    id:q.id,
    q:q.question||q.q,
    o:q.options||q.o,
    a:Number(q.answer!=null?q.answer:q.a),
    t:q.topicName||nameOf(q.topicId)||'',
    s:q.subjectName||nameOf(q.subjectId)||'',
    e:q.explanation||q.e||'',
    sid:q.subjectId||'', tid:q.topicId||''
  }));
  const cols=['#2E9BFF','#FFB23F','#8C7CFF','#12B886','#FF5C70','#2AA9F5','#3BA7FF','#7CCBFF'];
  const names=[];Q.forEach(r=>{if(r.s&&names.indexOf(r.s)<0)names.push(r.s)});
  SJ=[['সব','সব বিষয়',cols[0]]].concat(names.map((n,i)=>[n,n,cols[(i+1)%cols.length]]));
  return Q.length;
}
const SKY=()=>`<div class="skyw" id="sk" data-m="idle"><svg viewBox="0 0 300 290"><defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7DC4FF"/><stop offset="1" stop-color="#2F7BEF"/></linearGradient></defs><ellipse cx="150" cy="276" rx="80" ry="9" fill="#1E2A5E" opacity=".15"/><path d="M136 250Q148 290 170 286Q160 270 166 248Z" fill="#3F7BF0"/><g fill="#F5A93B"><rect x="112" y="244" width="14" height="26" rx="6"/><rect x="104" y="266" width="34" height="9" rx="4.5"/><rect x="174" y="244" width="14" height="26" rx="6"/><rect x="166" y="266" width="34" height="9" rx="4.5"/></g><g class="wl"><path d="M66 170Q36 196 52 238Q88 226 96 190Z" fill="#3F7BF0"/></g><g class="wr"><path d="M234 170Q264 196 248 238Q212 226 204 190Z" fill="#3F7BF0"/></g><ellipse cx="150" cy="172" rx="94" ry="90" fill="url(#g1)"/><ellipse cx="150" cy="208" rx="60" ry="58" fill="#F4F9FF"/><g class="hd"><circle cx="86" cy="184" r="13" fill="#B79BE3" opacity=".55"/><circle cx="214" cy="184" r="13" fill="#B79BE3" opacity=".55"/><g class="ey"><circle cx="113" cy="158" r="27" fill="#fff"/><circle cx="187" cy="158" r="27" fill="#fff"/><g class="pp"><circle cx="113" cy="160" r="14" fill="#1E2A5E"/><circle cx="187" cy="160" r="14" fill="#1E2A5E"/><circle cx="108" cy="154" r="5" fill="#fff"/><circle cx="182" cy="154" r="5" fill="#fff"/></g></g><path class="br" d="M88 130Q113 118 138 130M162 130Q187 118 212 130" stroke="#1E2A5E" stroke-width="6" stroke-linecap="round" fill="none"/><path d="M136 182Q150 172 164 182Q160 198 150 202Q140 198 136 182Z" fill="#F5A93B"/><path class="bk" d="M142 192Q150 198 158 192Q156 200 150 202Q144 200 142 192Z" fill="#E08A2E"/><path d="M104 96Q150 84 196 96L194 120Q150 132 106 120Z" fill="#2A3A7E"/><path d="M62 92L150 62L240 90L152 116Z" fill="#1E2A5E"/><path d="M152 78l4 8 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1z" fill="#F5A93B"/><path d="M236 92Q244 110 242 130" stroke="#F5A93B" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="242" cy="134" r="8" fill="#F5A93B"/></g><g class="zz"><text x="236" y="70" font-size="30">Z</text><text x="262" y="44" font-size="22">z</text></g><g class="qm"><text x="244" y="70" font-size="48">?</text></g><g class="sp" fill="#FFB23F"><path d="M40 90l4 9 9 4-9 4-4 9-4-9-9-4 9-4z"/><path d="M262 140l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/></g></svg></div>`;
let S={m:0,st:1,f:'all',lim:50,c:{subj:'সব',src:'সব প্রশ্ন',n:10,diff:'মিশ্র',tm:'অটো',neg:0.25,confirm:true,timer:true,shuf:false}},E,H=[],seen=new Set(),mis=new Set(),T=[],sayT,typT,cur,curA,pause=false;
const go=()=>{T.forEach(clearInterval);T.length=0;clearTimeout(sayT);clearInterval(typT)};
let busy=0;function say(t,m='idle',hold=3600){const k=$('#sk'),b=$('#bb');if(!k||!b)return;k.dataset.m=m;k.dataset.t=1;busy=Date.now()+t.length*24+hold+600;clearInterval(typT);clearTimeout(sayT);let i=0;b.textContent='';typT=setInterval(()=>{b.textContent=t.slice(0,++i);if(i>=t.length){clearInterval(typT);k.dataset.t=0}},24);sayT=setTimeout(()=>{const k=$('#sk');k&&(k.dataset.m='idle')},hold)}
const POOL={center:['প্রতিদিন অল্প অল্প পরীক্ষা দিলে ফল অনেক ভালো হয়!','স্লাইডে ট্যাপ করে পছন্দের মোড খুলুন!','আমাকে ট্যাপ করে দেখুন, আমি মজার কাজ করি!','ভুলের খাতা নিয়মিত দেখলে নম্বর বাড়ে।','আজ কতগুলো প্রশ্ন করবেন? লক্ষ্য ঠিক করে ফেলুন!'],cfg:['বিষয় বাছাই করুন, না জানলে "সব বিষয়" রাখুন।','নিজের মতো সংখ্যা ও সময় দিতে পারবেন, নিচে কাস্টম ঘর আছে!','নেগেটিভ মার্কিং থাকলে অনুমানে উত্তর দেবেন না, কেমন?','ভুলের খাতা থেকে অনুশীলন সবচেয়ে কাজের!','সময় কম থাকলে ১০টি প্রশ্ন দিয়েই শুরু করুন।'],flash:['ধীরে পড়ুন, তাড়াহুড়ো নয়!','কঠিন লাগলে ৫০:৫০ হিন্ট নিতে পারেন।','আপনি দারুণ এগোচ্ছেন, থামবেন না!','উত্তর ভুল হলে ব্যাখ্যাটা পড়ে নিন, ওটাই আসল শেখা।','একটু দম নিন, তারপর পরের প্রশ্ন!'],res:['টপিক বারে লাল অংশগুলো আগে ঠিক করুন।','যেকোনো প্রশ্নের নিচে "AI ব্যাখ্যা" চাপলে আমি বুঝিয়ে দেব!','"ভুলগুলো আবার" চাপলে শুধু ভুল প্রশ্নে অনুশীলন হবে!','প্রতিটি পরীক্ষাই আপনাকে আরও শক্ত করছে।'],att:['পুরোনো ফল ট্যাপ করলে বিস্তারিত দেখতে পাবেন।','নিয়মিত পরীক্ষা দিলে এখানে আপনার উন্নতি দেখা যাবে!']};
function chat(){if(Date.now()<busy)return;const p=POOL[cur];if(!p)return;say(p[Math.random()*p.length|0],['happy','hi','think','dance','fly','wait'][Math.random()*6|0],3000)}
const fun=[['ওই দেখুন, আমি উড়ছি!','fly'],['হাই! আজ কেমন পড়া হলো?','hi'],['চলুন নাচি, মাথা ঠান্ডা থাকবে!','dance'],['হুম... আজ কোন বিষয়টা কঠিন লাগছে?','think'],['একটু বিশ্রাম নিন, পানি খেয়েছেন?','wait']];
const act=()=>{const f=fun[Math.random()*fun.length|0];say(f[0],f[1],3800)};
function burst(){const c=document.createElement('div');c.className='cf';c.innerHTML=Array.from({length:30},(_,i)=>`<i style="--x:${(Math.random()*2-1)*170}px;--y:${-150-Math.random()*220}px;--r:${Math.random()*720}deg;background:${['#2E9BFF','#FFB23F','#FF5C70','#12B886','#8C7CFF'][i%5]};left:${35+Math.random()*30}%"></i>`).join('');document.body.append(c);setTimeout(()=>c.remove(),1500)}
function toast(t){const d=document.createElement('div');d.className='toast';d.textContent=t;document.body.append(d);setTimeout(()=>d.remove(),2200)}
const sh=a=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}return a};
const fmt=s=>bn(String(Math.floor(s/60)).padStart(2,'0')+':'+String(Math.floor(s%60)).padStart(2,'0'));
document.addEventListener('pointermove',e=>{const k=$('#sk');if(!k)return;const r=k.getBoundingClientRect(),dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2),d=Math.hypot(dx,dy)||1,m=Math.min(7,d/30);k.style.setProperty('--px',dx/d*m+'px');k.style.setProperty('--py',dy/d*m+'px')});
/* ---------- Exam Center ---------- */
function center(){mapBank();go();cur='center';T.push(setInterval(chat,3800));const avg=H.length?Math.round(H.reduce((s,a)=>s+a.c/a.list.length,0)/H.length*100):0;
app.innerHTML=`<div class="scr in"><small>ADMISSION HUB</small><h1>Exam Center</h1>
<div class="sl" id="sl"><div class="tr" id="tr">${M.map((m,i)=>`<div class="sd" style="background:linear-gradient(135deg,${m.c[0]},${m.c[1]})">${Array.from({length:8},(_,k)=>`<span class="pt" style="left:${(k*53+i*17)%92}%;top:${(k*37+i*29)%80}%;--s:${6+(k*5)%12}px;animation-delay:${k*.4}s"></span>`).join('')}<span class="no">${bn('০'+(i+1))}</span><div class="ill"><div class="bb2">${IL[i]}</div></div><h2>${m.n}</h2><p>${m.d}</p><span class="tap">ট্যাপ করুন ${I.arr}</span></div>`).join('')}</div><i class="ap" id="ap"></i></div>
<div class="dots" id="dots">${M.map(()=>'<i></i>').join('')}</div>
<div class="sts"><div><b>${bn(H.length)}</b><span>পরীক্ষা</span></div><div><b>${bn(avg)}%</b><span>গড় নির্ভুলতা</span></div><div><b>${bn(mis.size)}</b><span>ভুলের খাতা</span></div></div>
<div class="stage big"><div class="skr" style="margin-top:0">${SKY()}<div class="bub" id="bb"></div></div></div></div>`;
const tr=$('#tr'),sl=$('#sl'),sds=[...tr.children];let x0,y0,dx=0,drag=false,moved=false;
const slide=i=>{S.m=i;tr.style.transition='';tr.style.transform=`translateX(-${i*100}%)`;tr.style.setProperty('--d','0px');[...$('#dots').children].forEach((b,k)=>b.classList.toggle('on',k==i));sds.forEach((d,k)=>d.classList.toggle('act',k==i));const ap=$('#ap');ap.style.animation='none';void ap.offsetWidth;ap.style.animation='';say(M[i].say,M[i].mo,2600)};
const ripple=e=>{const r=sl.getBoundingClientRect(),d=document.createElement('i');d.className='rpl';d.style.left=e.clientX-r.left-20+'px';d.style.top=e.clientY-r.top-20+'px';sl.append(d);setTimeout(()=>d.remove(),700)};
sl.onpointerdown=e=>{x0=e.clientX;y0=e.clientY;dx=0;drag=true;moved=false;pause=true;tr.style.transition='none';sl.classList.add('prs')};
sl.onpointermove=e=>{if(!drag)return;dx=e.clientX-x0;if(Math.abs(dx)>6)moved=true;tr.style.transform=`translateX(calc(-${S.m*100}% + ${dx}px))`;tr.style.setProperty('--d',dx+'px')};
sl.onpointerup=e=>{if(!drag)return;drag=false;pause=false;sl.classList.remove('prs');if(Math.abs(dx)>sl.clientWidth*.18)return slide((S.m+(dx<0?1:3))%4);slide(S.m);if(!moved&&Math.abs(e.clientY-y0)<12){ripple(e);setTimeout(openMode,160)}};
sl.onpointercancel=()=>{drag=false;pause=false;sl.classList.remove('prs');slide(S.m)};
slide(S.m);T.push(setInterval(()=>{if(!pause&&!drag)slide((S.m+1)%4)},3000))}
function openMode(){S.st=1;S.c.src=S.m==2?'ভুল':'সব প্রশ্ন';S.m==3?attempts():cfg()}
/* ---------- Setup ---------- */
const chips=(k,list)=>`<div class="row">${list.map(v=>`<button class="ch ${S.c[k]==v?'on':''}" data-k="${k}" data-v="${v}">${v}</button>`).join('')}</div>`;
function pool(){const c=S.c;let p=Q.map((_,i)=>i),fb=false;const f=fn=>{const r=p.filter(fn);r.length?p=r:fb=true};
if(c.subj!='সব')f(i=>Q[i].s==c.subj);if(c.src=='অনুত্তরিত')f(i=>!seen.has(i));if(c.src=='ভুল'||c.src=='দুর্বল টপিক')f(i=>mis.has(i));return{p,fb}}
const hints=['কোন বিষয় থেকে পড়বেন? আমি সাথেই আছি!','প্রশ্ন আর সময় ঠিক করুন, আমি অপেক্ষায়!','সব ঠিক আছে? তাহলে শুরু করি!'];
let SJ=[['সব','সব বিষয়','#2E9BFF']]; /* filled by mapBank() from CACHE.subjects */
const SR=[['সব প্রশ্ন','পুরো ব্যাংক থেকে',I.grid],['অনুত্তরিত','যেগুলো আগে করেননি',I.skip],['ভুল','ভুলের খাতা থেকে',I.x],['দুর্বল টপিক','কম নম্বরের টপিক থেকে',I.fire]];
const sg=(k,list)=>`<div class="sg">${list.map(([v,l])=>`<button class="${S.c[k]==v?'on':''}" data-k="${k}" data-v="${v}">${l}</button>`).join('')}</div>`;
const estT=()=>{const c=S.c,tm=c.tm=='অটো'?c.n:c.tm;return `${bn(c.n)}টি প্রশ্ন · ${bn(tm)} মিনিট · প্রতি প্রশ্নে ≈ ${bn(Math.round(tm*60/c.n))} সেকেন্ড`};
function cfg(anim=true){go();cur='cfg';T.push(setInterval(chat,3800));const c=S.c,st=S.st,mock=S.m==0,n=c.n,tm=c.tm=='অটো'?n:c.tm;let h='';
const pills=['কী পড়বেন','কেমন পরীক্ষা','রিভিউ'];
if(st==1)h=`<div class="sec2">বিষয় বাছুন</div><div class="tiles">${SJ.map(([v,l,col])=>{const q=v=='সব'?Q.length:Q.filter(z=>z.s==v).length;return `<button class="tile ${c.subj==v?'on':''}" data-k="subj" data-v="${v}" style="--c:${col}"><i></i><b>${l}</b><span>${q?bn(q)+'টি প্রশ্ন':'শীঘ্রই আসছে'}</span></button>`}).join('')}</div>
<div class="sec2">প্রশ্ন কোথা থেকে?</div>${SR.map(([v,d,ico])=>`<button class="src ${c.src==v?'on':''}" data-k="src" data-v="${v}"><em>${ico}</em><div><b>${v}</b><span>${d}${v=='ভুল'?` · ${bn(mis.size)}টি`:''}</span></div><u></u></button>`).join('')}`;
if(st==2)h=`<div class="sec2">কতগুলো প্রশ্ন?</div><div class="nts">${[10,20,30,50,100].map(v=>`<button class="nt ${c.n==v?'on':''}" data-k="n" data-v="${v}"><b>${bn(v)}</b><span>প্রশ্ন</span></button>`).join('')}</div>
<div class="cin"><span>নিজের সংখ্যা</span><div class="stp2"><button data-act="dn">−</button><input type="number" inputmode="numeric" min="1" max="500" data-in="n" value="${n}"><button data-act="up">+</button></div></div>
<div class="sec2">সময় কত মিনিট?</div><div class="nts t">${['অটো',5,10,20,30,45,60].map(v=>`<button class="nt ${c.tm==v?'on':''}" data-k="tm" data-v="${v}"><b>${v=='অটো'?'অটো':bn(v)}</b><span>${v=='অটো'?'১ মি/প্রশ্ন':'মিনিট'}</span></button>`).join('')}</div>
<div class="cin"><span>নিজের সময়</span><div class="stp2"><input type="number" inputmode="numeric" min="1" max="300" data-in="tm" placeholder="যেমন ২৫" value="${c.tm=='অটো'||[5,10,20,30,45,60].includes(c.tm)?'':c.tm}"><span style="padding-right:12px">মিনিট</span></div></div>
<div class="est" id="est">${estT()}</div>
<div class="sec2">কঠিনতা</div>${sg('diff',[['সহজ','সহজ'],['মধ্যম','মধ্যম'],['কঠিন','কঠিন'],['মিশ্র','মিশ্র']])}${mock?`<div class="sec2">নেগেটিভ মার্কিং</div>${sg('neg',[[0,'নেই'],[0.25,'−০.২৫'],[0.5,'−০.৫'],[1,'−১']])}`:''}`;
if(st==3)h=`<div class="tkt"><div class="th"><small style="color:#fff9">আপনার পরীক্ষা</small><h2>${M[S.m].n}</h2></div><div class="tb2"><div><span>বিষয়</span><b>${c.subj}</b></div><div><span>উৎস</span><b>${c.src}</b></div><div><span>প্রশ্ন</span><b>${bn(n)}টি${mock&&n>PG?` · ${bn(Math.ceil(n/PG))} পেজ`:''}</b></div><div><span>কঠিনতা</span><b>${c.diff}</b></div>${mock?`<div><span>সময়</span><b>${bn(tm)} মিনিট</b></div><div><span>নেগেটিভ</span><b>${c.neg?'−'+bn(c.neg):'নেই'}</b></div>`:''}</div></div><div class="sec2">পছন্দ</div>${[['confirm','জমার আগে নিশ্চিতকরণ','ভুল করে জমা হওয়া ঠেকায়'],['timer','টাইমার দেখান','উপরে সময় দেখা যাবে'],['shuf','অপশন শাফল','A-B-C-D এলোমেলো হবে']].map(([k,l,d])=>`<div class="tg"><div><b style="font-size:15px">${l}</b><div class="hint">${d}</div></div><button class="sw ${c[k]?'on':''}" data-t="${k}"></button></div>`).join('')}`;
app.innerHTML=`<div class="scr ${anim?'in':''}"><div class="eh"><button class="ib" data-act="back">${I.back}</button><div class="g"><small>পরীক্ষা সেটআপ</small><b>${M[S.m].n}</b></div></div>
<div class="stp3">${pills.map((p,i)=>`<div class="${i+1<=st?'on':''} ${i+1==st?'cur':''}"><i>${i+1<st?I.ck:bn(i+1)}</i><span>${p}</span></div>${i<2?`<u class="${i+1<st?'on':''}"></u>`:''}`).join('')}</div>
<div class="skr sm">${SKY()}<div class="bub" id="bb"></div></div>${h}</div>
<div class="bar"><button class="pri" data-act="${st==3?'start':'next'}">${st==3?'পরীক্ষা শুরু করুন':'পরের ধাপ'}${I.arr}</button></div>`;
if(anim)say(hints[st-1],['hi','think','happy'][st-1],3000)}
/* ---------- Exam ---------- */
function start(){const {p,fb}=pool(),c=S.c,n=c.n,mock=S.m==0;if(fb)toast('এই ফিল্টারে প্রশ্ন কম, সব প্রশ্ন নেওয়া হলো');
const src=fb?Q.map((_,i)=>i):p;let bag=[];while(bag.length<n)bag=bag.concat(sh(src));
const list=bag.slice(0,n).map((bi,u)=>({...Q[bi],u,bi,pm:c.shuf?sh([0,1,2,3]):[0,1,2,3]}));
E={mock,list,i:0,pg:0,ans:{},tm:{},log:[],fl:new Set(),bm:new Set(),hid:{},streak:0,t0:Date.now(),last:Date.now(),left:(c.tm=='অটো'?n:c.tm)*60,neg:mock?c.neg:0};
go();if(mock){T.push(setInterval(tick,1000));mockUI()}else flashUI()}
function tick(){E.left--;const t=$('#tm');if(t){t.textContent=fmt(E.left);t.classList.toggle('red',E.left<=60)}if(E.left<=0){toast('সময় শেষ! অটো জমা হচ্ছে');finish()}}
function qcard(Z,idx,mode,anim){const a=E.ans[Z.u],ok=Z.a,hid=E.hid[Z.u]||[];
return `<div class="qc ${anim?'qs':''}" id="q${Z.u}" data-u="${Z.u}" style="${anim?`animation-delay:${Math.min(idx%PG,8)*60}ms`:''}"><div class="qh"><span class="qn">প্রশ্ন ${bn(idx+1)}</span><span class="tg2">${Z.t}</span><span class="sp2"></span><button class="qi ${E.bm.has(Z.u)?'on':''}" data-bm="1">${I.star}</button>${E.mock?`<button class="qi ${E.fl.has(Z.u)?'on':''}" data-fl="1">${I.flag}</button>`:''}</div><div class="qt">${Z.q}</div>${Z.pm.map((o,k)=>{let cl='',ico='';if(hid.includes(o))cl='gone';else if(a!==undefined){if(mode=='m'){cl=a==o?'sel':'dim';ico=a==o?I.lock:''}else{cl=o==ok?'ok':a==o?'bad':'dim';ico=o==ok?I.ck:a==o?I.x:''}}return `<button class="op ${cl}" data-o="${o}"><b>${'ABCD'[k]}</b><span>${Z.o[o]}</span>${ico}</button>`}).join('')}</div>`}
function mockUI(anim=true){cur='mock';const n=E.list.length,pages=Math.ceil(n/PG),p=E.pg,an=Object.keys(E.ans).length;
app.innerHTML=`<div class="scr" style="padding-top:0"><div class="mh"><div class="eh"><div class="g"><small>MOCK TEST${pages>1?` · পেজ ${bn(p+1)}/${bn(pages)}`:''}</small><b id="ac">${bn(an)}/${bn(n)} উত্তরিত</b></div>${S.c.timer?`<div class="tm ${E.left<=60?'red':''}" id="tm">${fmt(E.left)}</div>`:''}<button class="sub" data-act="sub">জমা দিন</button></div><div class="pb"><i id="pbi" style="width:${an/n*100}%"></i></div></div>
<div id="ql">${E.list.slice(p*PG,p*PG+PG).map((Z,k)=>qcard(Z,p*PG+k,'m',anim)).join('')}</div>
${pages>1?`<div class="pager"><button data-act="pp" ${p?'':'disabled'}>← আগের ${bn(PG)}</button><b>${bn(p*PG+1)}–${bn(Math.min(n,p*PG+PG))} / ${bn(n)}</b><button data-act="np" ${p<pages-1?'':'disabled'}>পরের ${bn(PG)} →</button></div>`:''}</div>
<div class="bar"><button class="sec" data-act="pal">${I.grid} প্রশ্ন তালিকা</button><button class="pri" data-act="sub">জমা দিন</button></div>`;scrollTo(0,0)}
const happy=['দারুণ! একদম ঠিক!','ওয়াও! চালিয়ে যান!','সাবাশ! আপনি পারবেন!','ইয়েএএ! আরেকটা ঠিক!'],sad=['ইশ! সমস্যা নেই, পরেরটা পারবেন।','ভুল থেকেই শেখা হয়, মন খারাপ করবেন না।','একটু মনোযোগ দিন, আপনি পারবেন!'];
function flashUI(anim=true){cur='flash';go();T.push(setInterval(chat,3800));const Z=E.list[E.i],n=E.list.length,a=E.ans[Z.u],ok=a==Z.a,last=E.i==n-1;E.last=a===undefined?Date.now():E.last;
app.innerHTML=`<div class="scr ${anim?'in':''}"><div class="eh"><button class="ib" data-act="home">${I.back}</button><div class="g"><small>FLASH TEST</small><b>${bn(E.i+1)}/${bn(n)}</b></div><div class="chip2">${I.fire}${bn(E.streak)}</div></div><div class="pb"><i style="width:${(E.i+(a!==undefined))/n*100}%"></i></div>
<div class="stage"><div class="skr sm" style="margin:0">${SKY()}<div class="bub" id="bb"></div></div></div>${qcard(Z,E.i,'f',false)}
${a!==undefined?`<div class="ex ${ok?'g':'r'} qs"><b>${ok?'সঠিক উত্তর!':'ভুল হয়েছে'}</b>${ok?'':`সঠিক উত্তর: ${Z.o[Z.a]}<br>`}${Z.e||'এই প্রশ্নের ব্যাখ্যা এখনো যোগ করা হয়নি।'}<button class="gh" data-act="note">নোট করুন</button></div>`:''}</div>
<div class="bar">${a!==undefined?`<button class="pri" data-act="${last?'fin':'nxt'}">${last?'ফলাফল দেখুন':'পরের প্রশ্ন'}${I.arr}</button>`:`<button class="sec" data-act="skp">${I.skip} স্কিপ</button><button class="sec" data-act="hint" ${(E.hid[Z.u]||[]).length?'disabled':''}>${I.bulb} ৫০:৫০</button>`}</div>`;
if(a===undefined){say(E.i?'পরের প্রশ্ন! মন দিয়ে পড়ুন।':'শুরু করা যাক! আমি আপনার পাশেই আছি।','hi',2500);T.push(setTimeout(()=>say('ভাবছেন? ঠিক আছে, সময় নিন...','wait',4000),9000),setTimeout(()=>say('Zzz... আপনি কি জেগে আছেন?','sleep',8000),20000))}}
function pick(Z,o,btn,ev){if(E.ans[Z.u]!==undefined)return E.mock&&toast('উত্তর লক করা আছে, বদলানো যাবে না');
if(btn&&ev){const r=btn.getBoundingClientRect(),d=document.createElement('i');d.className='rp';d.style.left=ev.clientX-r.left-10+'px';d.style.top=ev.clientY-r.top-10+'px';btn.append(d)}
const now=Date.now();E.ans[Z.u]=o;E.tm[Z.u]=(now-E.last)/1000;E.last=now;E.log.push({u:Z.u,o,at:(now-E.t0)/1000});
if(E.mock){$('#q'+Z.u).outerHTML=qcard(Z,Z.u,'m',false);const an=Object.keys(E.ans).length;$('#ac').textContent=`${bn(an)}/${bn(E.list.length)} উত্তরিত`;$('#pbi').style.width=an/E.list.length*100+'%';return}
const ok=Z.a==o;ok?E.streak++:E.streak=0;flashUI(false);
if(ok){burst();const s=E.streak;s==3?say('৩টি টানা সঠিক! আমি তো নাচছি!','dance',4000):s==5?say('৫টি টানা! এবার আকাশে উড়ব!','fly',4500):say(happy[Math.random()*4|0],'happy',3000)}else say(sad[Math.random()*3|0],'sad',4000)}
function finish(){go();const {mock,list,ans,tm,log,neg}=E;let c=0,w=0;list.forEach(Z=>{if(ans[Z.u]===undefined)return;seen.add(Z.bi);Z.a==ans[Z.u]?(c++,mis.delete(Z.bi)):(w++,mis.add(Z.bi))});
const att={mock,mode:mock?'Mock Test':'Flash Test',bm:new Set(E.bm),list,ans,tm,log,neg,c,w,s:list.length-c-w,score:c-w*neg,dur:(Date.now()-E.t0)/1000,date:new Date().toLocaleDateString('bn-BD')};H.push(att);curA=att;S.f='all';S.lim=50;persist(att);result(att)}
/* TODO 2 (done) — real persistence. The demo kept attempts only in `H`, so a
   refresh lost them; this writes to the app's own stores, which the existing
   Exam History screen and cloud sync already read. Guarded so the ported UI
   still runs standalone if the stores are absent. */
async function persist(a){
  const db=(typeof dbPut==='function')?dbPut:null; if(!db)return;
  const snap=a.list.map(Z=>{const u=a.ans[Z.u];return {questionId:Z.id||'',subjectId:Z.sid||'',topicId:Z.tid||'',status:u===undefined?'skipped':(u===Z.a?'correct':'wrong')}});
  const now=Date.now(), used=Math.round(a.dur);
  const correct=snap.filter(s=>s.status==='correct').length;
  const wrong=snap.filter(s=>s.status==='wrong').length;
  const skipped=snap.filter(s=>s.status==='skipped').length;
  const rec={
    id:(typeof uid==='function')?uid():('sky'+now),
    examId:'sky-'+now, date:now, completedAt:now, startedAt:now-used*1000,
    mode:a.mock?'mock':'flash', testType:a.mock?'mock':'flash',
    subjects:[...new Set(snap.map(s=>s.subjectId).filter(Boolean))],
    topics:[...new Set(snap.map(s=>s.topicId).filter(Boolean))],
    questionCount:a.list.length, correct, wrong, skipped,
    score:correct-wrong*(a.neg||0), positive:correct, negative:wrong*(a.neg||0), negativeMarks:a.neg,
    accuracy:a.list.length?Math.round(correct/a.list.length*100):0,
    attemptRate:a.list.length?Math.round((correct+wrong)/a.list.length*100):0,
    timeUsed:used, totalTime:used, autoSubmit:false,
    snapshot:snap, configuration:{source:'exam-center-sky'},
    bookmarks:[...a.bm], flags:[]
  };
  try{ await db('examResults',rec); }catch(e){}
  for(const s of snap){
    if(s.status!=='wrong'||!s.questionId) continue;
    try{
      let m=(typeof CACHE!=='undefined'&&CACHE&&Array.isArray(CACHE.mistakes))?CACHE.mistakes.find(x=>x.questionId===s.questionId):null;
      if(!m) m={id:(typeof uid==='function')?uid():('m'+now+s.questionId), questionId:s.questionId, wrongCount:0, revisionStatus:'pending'};
      m.wrongCount=(m.wrongCount||0)+1; m.lastWrongAt=now; m.examId=rec.id; m.subjectId=s.subjectId; m.topicId=s.topicId;
      await db('mistakes', m);
      if(typeof CACHE!=='undefined'&&CACHE&&Array.isArray(CACHE.mistakes)&&CACHE.mistakes.indexOf(m)<0) CACHE.mistakes.push(m);
    }catch(e){}
  }
}
/* ---------- Result ---------- */
const gr=p=>p>=80?['A+','অসাধারণ']:p>=70?['A','খুব ভালো']:p>=60?['B','ভালো']:p>=50?['C','মোটামুটি']:p>=40?['D','উন্নতি দরকার']:['F','আরও অনুশীলন দরকার'];
function aiHTML(Z,a){const u=a.ans[Z.u],L='ABCD';return `<div class="aih"><span class="aiic">${I.spark}</span><b>Sky AI ব্যাখ্যা</b></div>
<div class="ail"><b>সঠিক উত্তর</b><p>${L[Z.a]}. ${Z.o[Z.a]}</p></div>
<div class="ail"><b>আপনার উত্তর</b><p>${u===undefined?'স্কিপ করেছেন':`${L[u]}. ${Z.o[u]} ${u==Z.a?'(সঠিক)':'(ভুল)'}`}</p></div>
<div class="ail"><b>কেন সঠিক</b><p>${Z.e||'এই প্রশ্নের ব্যাখ্যা এখনো ডাটায় যোগ করা হয়নি। নিচের বোতাম চাপলে Sky বুঝিয়ে দেবে।'}</p></div>
<div class="aia"><button data-aix="সহজ">আরও সহজ করে</button><button data-aix="উদাহরণ">উদাহরণ দিন</button><button data-aix="আরও">আরও জানুন</button></div>
<div class="aio" id="aio"></div>`}
/* TODO 3 (done) — real AI. The demo panel said "এটি ডেমো প্যানেল"; this calls the
   app's own tutor endpoint POST /api/ai/chat (SSE), the same one ai-agent-chat.js
   uses, so no client-side key and no demo copy remains. */
async function askAI(Z,box){
  const a=curA,u=a.ans[Z.u],L='ABCD';
  const prompt='পরীক্ষার প্রশ্ন: '+Z.q+'\nসঠিক উত্তর: '+L[Z.a]+'. '+Z.o[Z.a]+
    (u===undefined?'':'\nশিক্ষার্থীর উত্তর: '+L[u]+'. '+Z.o[u])+
    (Z.e?'\nডাটার ব্যাখ্যা: '+Z.e:'')+
    '\n\nবাংলায় ধাপে ধাপে বুঝিয়ে দাও কেন সঠিক উত্তরটি সঠিক, এবং অন্য অপশনগুলো কেন ভুল।';
  if(typeof fetch!=='function'){box.textContent='সংযোগ নেই।';return}
  let r;
  try{ r=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:prompt}],fresh:true,context:{stats:null,profile:null,examMode:'exam'}})}) }
  catch(e){ box.textContent='সংযোগ করা যায়নি, আবার চেষ্টা করুন।'; return }
  if(!r.ok||!r.body){ box.textContent='এখন উত্তর দেওয়া যাচ্ছে না।'; return }
  const rd=r.body.getReader(),dec=new TextDecoder();let buf='',full='';
  while(true){ let step; try{ step=await rd.read() }catch(_){ break } if(step.done)break;
    buf+=dec.decode(step.value,{stream:true});
    const parts=buf.split('\n\n'); buf=parts.pop()||'';
    for(const part of parts){
      let evt='';
      for(const line of part.split('\n')){ const t=line.trim();
        if(t.startsWith('event:')){evt=t.slice(6).trim();continue}
        if(!t.startsWith('data:'))continue;
        let j=null; try{ j=JSON.parse(t.slice(5).trim()) }catch(_){ continue }
        if(evt==='stage')continue;
        if(evt==='replace'&&typeof j.text==='string'){ full=j.text; }
        else if(j.text){ full+=j.text; }
      }
      box.textContent=full;
    }
  }
  if(!full) box.textContent='এখন উত্তর দেওয়া যাচ্ছে না।';
}
function aiToggle(i){const a=curA,Z=a.list[i],box=$('#ai'+i),btn=$('#ab'+i);if(box.classList.contains('open')){box.classList.remove('open');btn.classList.remove('on');return}
box.innerHTML='<div class="skl"><i></i><i></i><i style="width:60%"></i></div>';box.classList.add('open');btn.classList.add('on');setTimeout(()=>{if(box.classList.contains('open'))box.innerHTML=aiHTML(Z,a)},900)}
function shareRes(){const a=curA,n=a.list.length,t=`${a.mode}: ${n}টির মধ্যে ${a.c}টি সঠিক, নির্ভুলতা ${Math.round(a.c/n*100)}%, স্কোর ${a.score.toFixed(2)} — Admission Hub`;try{if(navigator.share)navigator.share({text:t}).catch(()=>{});else navigator.clipboard.writeText(t).then(()=>toast('ফলাফল কপি হয়েছে'))}catch(e){toast('শেয়ার করা যায়নি')}}
function retry(a,wrong){const L=wrong?a.list.filter(Z=>a.ans[Z.u]===undefined||Z.a!=a.ans[Z.u]):a.list;if(!L.length)return toast('আবার করার মতো প্রশ্ন নেই');const list=L.map((Z,u)=>({...Z,u}));S.m=a.mock?0:1;E={mock:a.mock,list,i:0,pg:0,ans:{},tm:{},log:[],fl:new Set(),bm:new Set(),hid:{},streak:0,t0:Date.now(),last:Date.now(),left:Math.max(60,list.length*60),neg:a.neg};go();if(a.mock){T.push(setInterval(tick,1000));mockUI()}else flashUI()}
function result(a,anim=true){go();cur='res';T.push(setInterval(chat,3800));const n=a.list.length,acc=Math.round(a.c/n*100),C=2*Math.PI*52,g=gr(acc);
const st=Z=>a.ans[Z.u]===undefined?'skip':Z.a==a.ans[Z.u]?'ok':'bad',tv=Z=>a.tm[Z.u]||0;
const slow=new Set(a.list.filter(Z=>a.ans[Z.u]!==undefined).sort((x,y)=>tv(y)-tv(x)).slice(0,Math.min(5,Math.ceil(n/5))).map(Z=>Z.u));
const keep=Z=>S.f=='all'||(S.f=='bm'?a.bm.has(Z.u):S.f=='slow'?slow.has(Z.u):st(Z)==S.f);
const all=a.list.filter(keep),F=all.slice(0,S.lim),fi=['all','ok','bad','skip'].indexOf(S.f);
const ix=H.indexOf(a),pv=ix>0?H[ix-1]:null,dl=pv?acc-Math.round(pv.c/pv.list.length*100):null;
const msg=acc>=80?['অসাধারণ ফলাফল!','dance']:acc>=50?['ভালো করেছেন, আরেকটু!','happy']:['চেষ্টা চালিয়ে যান!','sad'];
const tp={};a.list.forEach(Z=>{const t=tp[Z.t]||(tp[Z.t]={c:0,n:0});t.n++;if(st(Z)=='ok')t.c++});const tps=Object.entries(tp).sort((x,y)=>x[1].c/x[1].n-y[1].c/y[1].n).slice(0,5);
const answered=a.c+a.w,avg=answered?Object.values(a.tm).reduce((s,v)=>s+v,0)/answered:0;
app.innerHTML=`<div class="scr ${anim?'in':''}"><div class="eh"><button class="ib" data-act="home">${I.back}</button><div class="g"><small>${a.mode.toUpperCase()} · ${a.date}</small><b>পরীক্ষার ফলাফল</b></div><button class="ib" data-share="1">${I.share}</button></div>
<div class="hero" style="margin-top:14px"><div class="ring"><svg width="128" height="128"><circle cx="64" cy="64" r="52" stroke="#fff3"/><circle id="rg" cx="64" cy="64" r="52" stroke="#fff" stroke-dasharray="${C}" stroke-dashoffset="${C}" style="transition:stroke-dashoffset 1.2s cubic-bezier(.2,.8,.2,1)"/></svg><div><span id="cn">০</span><em>স্কোর / ${bn(n)}</em></div></div><div><h2>${msg[0]}</h2><p>নির্ভুলতা ${bn(acc)}%। ${bn(a.c)}টি সঠিক, ${bn(a.w)}টি ভুল, ${bn(a.s)}টি স্কিপ।${a.neg&&a.w?` নেগেটিভ −${bn((a.w*a.neg).toFixed(2))}`:''}</p><span class="gb">গ্রেড ${g[0]} · ${g[1]}</span></div></div>
<div class="st"><button data-f="ok"><b style="color:var(--ok)">${bn(a.c)}</b><span>সঠিক</span></button><button data-f="bad"><b style="color:var(--bad)">${bn(a.w)}</b><span>ভুল</span></button><button data-f="skip"><b style="color:var(--or)">${bn(a.s)}</b><span>স্কিপ</span></button><button data-f="all"><b>${fmt(a.dur)}</b><span>মোট সময়</span></button></div>
<div class="insg"><div><b>${fmt(avg)}</b><span>গড় সময়/প্রশ্ন</span></div><button data-f="slow"><b>${bn(slow.size)}টি</b><span>ধীর প্রশ্ন</span></button><div><b style="color:${dl==null?'var(--mut)':dl>=0?'var(--ok)':'var(--bad)'}">${dl==null?'—':(dl>=0?'▲ ':'▼ ')+bn(Math.abs(dl))+'%'}</b><span>আগের তুলনায়</span></div></div>
<div class="stage"><div class="skr sm" style="margin:0">${SKY()}<div class="bub" id="bb"></div></div></div>
${tps.length?`<div class="sec2">টপিকভিত্তিক অবস্থা</div><div class="tb">${tps.map(([t,v])=>`<div><span>${t}</span><b style="float:right">${bn(Math.round(v.c/v.n*100))}% · ${bn(v.c)}/${bn(v.n)}</b><i><u style="width:${v.c/v.n*100}%"></u></i></div>`).join('')}</div>`:''}
<div class="ft2"><i style="transform:translateX(${Math.max(fi,0)*100}%);opacity:${fi<0?0:1}"></i>${[['all','সব',n],['ok','সঠিক',a.c],['bad','ভুল',a.w],['skip','স্কিপ',a.s]].map(([k,l,v])=>`<button data-f="${k}" class="${S.f==k?'on':''}">${l} ${bn(v)}</button>`).join('')}</div>
<div class="row" style="margin:0 0 6px"><button class="ch ${S.f=='bm'?'on':''}" data-f="bm">বুকমার্ক <span id="bmc">${bn(a.bm.size)}</span></button><button class="ch ${S.f=='slow'?'on':''}" data-f="slow">ধীর প্রশ্ন ${bn(slow.size)}</button></div>
${F.length?F.map(Z=>{const s=st(Z),u=a.ans[Z.u],i=a.list.indexOf(Z);return `<div class="qc" id="r${i}"><div class="qh"><span class="qn">প্রশ্ন ${bn(i+1)}</span><span class="tg2">${Z.t}</span><span class="sp2"></span><span class="badge bg-${s=='skip'?'sk':s}">${{ok:'সঠিক',bad:'ভুল',skip:'স্কিপ'}[s]}</span></div><div class="qt" style="font-size:17px">${Z.q}</div>${Z.o.map((o,k)=>`<div class="op ${k==Z.a?'ok':k==u?'bad':'dim'}" style="margin-bottom:8px"><b>${'ABCD'[k]}</b><span>${o}</span>${k==Z.a?I.ck:k==u?'<small style="color:inherit">আপনার উত্তর</small>':''}</div>`).join('')}
<div class="ex ${Z.e?'g':'n'}" style="margin:8px 0 0"><b style="font-size:14px">ব্যাখ্যা</b>${Z.e||'এই প্রশ্নের ব্যাখ্যা এখনো যোগ করা হয়নি।'}</div>
<div class="abt"><button class="aibtn" id="ab${i}" data-ai="${i}">${I.spark} AI ব্যাখ্যা</button><button class="qi ${a.bm.has(Z.u)?'on':''}" data-rbm="${i}">${I.star}</button><span class="ym" style="margin:0 0 0 auto">${I.clk} ${fmt(tv(Z))}</span></div>
${s=='bad'?'<div class="hint" style="margin-top:8px">ভুলের খাতায় সংরক্ষিত</div>':''}<div class="ai" id="ai${i}"></div></div>`}).join(''):'<div class="emp">এই ফিল্টারে কোনো প্রশ্ন নেই</div>'}
${all.length>F.length?`<button class="sec" style="width:100%;margin:6px 0 12px" data-act="more">আরও ${bn(Math.min(50,all.length-F.length))}টি দেখুন</button>`:''}
<div class="sec2">উত্তরের ইতিহাস</div>${a.log.length?`<div class="tl">${a.log.slice(0,40).map(l=>{const Z=a.list[l.u],ok=Z.a==l.o;return `<div>${fmt(l.at)} → প্রশ্ন ${bn(l.u+1)}: ${Z.o[l.o]} <span class="badge bg-${ok?'ok':'bad'}">${ok?'সঠিক':'ভুল'}</span></div>`}).join('')}</div>`:'<p class="hint">কোনো উত্তর দেওয়া হয়নি</p>'}
<div class="acts"><button class="sec" data-act="same">একই পরীক্ষা আবার</button><button class="sec" data-act="home">নতুন পরীক্ষা</button></div></div>
<div class="bar"><button class="sec" data-act="home">Exam Center</button><button class="pri" data-act="redo">ভুলগুলো আবার</button></div>`;
setTimeout(()=>$('#rg').style.strokeDashoffset=C*(1-acc/100),60);const t0=performance.now(),tg=Math.max(a.score,0),dec=tg%1?2:0;const rf=t=>{const p=Math.min((t-t0)/1100,1),el=$('#cn');if(!el)return;el.textContent=bn((tg*p).toFixed(dec));p<1&&requestAnimationFrame(rf)};requestAnimationFrame(rf);
if(anim){say(msg[0]+(a.w?' ভুলগুলো আগে দেখে নিন।':''),msg[1],5000);acc>=50&&burst()}else say('এই তালিকা দেখুন, আমি সাথে আছি!','hi',2500)}
function attempts(){go();cur='att';T.push(setInterval(chat,3800));app.innerHTML=`<div class="scr in"><div class="eh"><button class="ib" data-act="home">${I.back}</button><div class="g"><small>HISTORY</small><b>আমার অ্যাটেম্পট</b></div></div><div style="margin-top:14px">${H.length?[...H].reverse().map(a=>`<button class="qc" style="display:block;width:100%;text-align:left" data-h="${H.indexOf(a)}"><div class="qh"><b>${a.mode}</b><span class="sp2"></span><span class="qn">${a.date}</span></div><span>স্কোর ${bn(a.score.toFixed(2))} · সঠিক ${bn(a.c)} · ভুল ${bn(a.w)} · স্কিপ ${bn(a.s)}</span></button>`).join(''):`<div class="stage big"><div class="skr" style="margin:0">${SKY()}<div class="bub" id="bb"></div></div></div><div class="emp">এখনো কোনো পরীক্ষা দেননি।</div>`}</div></div>`;if(!H.length)say('এখনো কিছু নেই! একটা পরীক্ষা দিয়ে শুরু করুন।','hi',5000)}
/* ---------- events ---------- */
function sheet(h){const d=document.createElement('div');d.className='sheet';d.innerHTML=`<div>${h}</div>`;d.onclick=e=>{const b=e.target.closest('button');if(e.target==d||(b&&b.dataset.x))d.remove();else if(b&&b.dataset.ok){d.remove();finish()}else if(b&&b.dataset.jp){d.remove();const i=+b.dataset.jp;E.pg=Math.floor(i/PG);mockUI(false);setTimeout(()=>$('#q'+i)?.scrollIntoView({behavior:'smooth'}),50)}};document.body.append(d)}
function submit(){const n=E.list.length,an=Object.keys(E.ans).length;if(!S.c.confirm)return finish();sheet(`<h3>জমা দিতে চান?</h3><p>${bn(an)}টি উত্তর দিয়েছেন, ${bn(n-an)}টি বাকি আছে। জমা দিলে আর ফেরা যাবে না।</p><div style="display:flex;gap:10px"><button class="sec" data-x="1">ফিরে যান</button><button class="pri" data-ok="1">জমা দিন</button></div>`)}
app.onclick=e=>{const t=e.target;let b;
if(t.closest('.skyw')){return act()}
if(b=t.closest('[data-ai]'))return aiToggle(+b.dataset.ai);
if(b=t.closest('[data-aix]')){const box=$('#aio');if(!box)return;box.textContent='Sky লিখছে...';box.classList.add('on');const i=b.closest('.aih')?.parentElement?.querySelector('[data-ai]');const idx=i?(+i.dataset.ai):-1;const Z=idx>=0?curA.list[idx]:null;if(Z)return void askAI(Z,box);return}
if(b=t.closest('[data-rbm]')){const i=+b.dataset.rbm,u=curA.list[i].u;curA.bm.has(u)?curA.bm.delete(u):curA.bm.add(u);b.classList.toggle('on');const c=$('#bmc');c&&(c.textContent=bn(curA.bm.size));return toast(curA.bm.has(u)?'বুকমার্ক করা হলো':'বুকমার্ক সরানো হলো')}
if(t.closest('[data-share]'))return shareRes();
if(b=t.closest('[data-k]')){const v=b.dataset.v;S.c[b.dataset.k]=isNaN(v)?v:+v;return cfg(false)}
if(b=t.closest('[data-t]')){S.c[b.dataset.t]=!S.c[b.dataset.t];return cfg(false)}
if(b=t.closest('[data-f]')){S.f=b.dataset.f;S.lim=50;return result(curA,false)}
if(b=t.closest('[data-h]')){S.f='all';S.lim=50;return result(curA=H[+b.dataset.h])}
if(b=t.closest('[data-mp]')){const i=+b.dataset.mp;S.f='all';S.lim=Math.max(S.lim,i+1);result(curA,false);return setTimeout(()=>$('#r'+i)?.scrollIntoView({behavior:'smooth'}),60)}
const qc=t.closest('.qc[data-u]');
if(qc&&E){const Z=E.list[+qc.dataset.u];
if(t.closest('[data-bm]')){E.bm.has(Z.u)?E.bm.delete(Z.u):E.bm.add(Z.u);toast(E.bm.has(Z.u)?'বুকমার্ক করা হলো':'বুকমার্ক সরানো হলো');return qc.outerHTML=qcard(Z,Z.u,E.mock?'m':'f',false)}
if(t.closest('[data-fl]')){E.fl.has(Z.u)?E.fl.delete(Z.u):E.fl.add(Z.u);return qc.outerHTML=qcard(Z,Z.u,'m',false)}
if(b=t.closest('[data-o]'))return pick(Z,+b.dataset.o,b,e)}
if(b=t.closest('[data-act]')){const a=b.dataset.act;
if(a=='next'){S.st++;return cfg()}if(a=='back')return S.st>1?(S.st--,cfg()):center();
if(a=='dn'||a=='up'){S.c.n=Math.max(1,Math.min(500,S.c.n+(a=='up'?1:-1)));const i=$('[data-in="n"]');i&&(i.value=S.c.n);return syncCfg()}
if(a=='start')return start();if(a=='home'){go();return center()}
if(a=='pp'){E.pg--;return mockUI(false)}if(a=='np'){E.pg++;return mockUI(false)}
if(a=='pal'){return sheet(`<h3>প্রশ্ন তালিকা</h3><p>নীল = উত্তর দেওয়া, কমলা দাগ = ফ্ল্যাগ। ট্যাপ করে সরাসরি যান।</p><div class="gr">${E.list.map((Z,i)=>`<button data-jp="${i}" class="${E.ans[Z.u]!==undefined?'a':''} ${E.fl.has(Z.u)?'f':''}">${bn(i+1)}</button>`).join('')}</div>`)}
if(a=='skp'){go();E.i++;if(E.i>=E.list.length){E.i--;return finish()}return flashUI()}
if(a=='hint'){const Z=E.list[E.i],w=Z.pm.filter(o=>o!=Z.a);E.hid[Z.u]=sh(w).slice(0,2);flashUI(false);return say('দুটো ভুল অপশন সরিয়ে দিলাম! এবার ঠিকটা বাছুন।','think',3500)}
if(a=='nxt'){E.i++;return flashUI()}if(a=='sub')return submit();if(a=='fin')return finish();if(a=='note')return toast('নোট যুক্ত হবে (ব্যাকএন্ড সংযোগের পর)');
if(a=='more'){S.lim+=50;return result(curA,false)}
if(a=='redo')return retry(curA,true);if(a=='same')return retry(curA,false);}};
function syncCfg(){const c=S.c;document.querySelectorAll('.nt[data-k="n"]').forEach(b=>b.classList.toggle('on',String(c.n)==b.dataset.v));document.querySelectorAll('.nt[data-k="tm"]').forEach(b=>b.classList.toggle('on',String(c.tm)==b.dataset.v));const x=$('#est');x&&(x.textContent=estT())}
app.oninput=e=>{const t=e.target;if(!t.dataset.in)return;const v=parseInt(t.value);if(!v||v<1)return;if(t.dataset.in=='n')S.c.n=Math.min(500,v);else S.c.tm=Math.min(300,v);syncCfg()};
document.addEventListener('focusin',e=>{e.target.tagName=='INPUT'&&document.body.classList.add('kb')});
document.addEventListener('focusout',()=>document.body.classList.remove('kb'));
document.addEventListener('keydown',e=>{if(e.key=='Enter'&&e.target.tagName=='INPUT')e.target.blur()});
document.addEventListener('pointerdown',e=>{const a=document.activeElement;if(a&&a.tagName=='INPUT'&&!e.target.closest('input'))a.blur()});
center();
