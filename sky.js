
/* Admission Sky — the owner's signup-flow-preview-v2 as the live signup UI.
 *
 * The markup (sky.html) and styles (sky.css) are the owner's design, scoped to
 * #ah-signup-sky so they cannot leak into the rest of the app. This engine is
 * the design's own controller with the mock steps gone: real account creation
 * and verification run through AdmissionAccount.SkyFlow (account-access.js),
 * which owns the Firebase identity and live email / Telegram verification.
 * No account state lives here.
 */
(() => {
'use strict';
/* The engine may load before the account engine has injected the signup
   surface into the page, so wait for the mount point instead of bailing. */
const ready=cb=>{const find=()=>document.getElementById('ah-signup-sky');const r=find();if(r)return cb(r);let n=0;const t=()=>{const again=find();if(again)return cb(again);if(n++<80)setTimeout(t,120)};t()};
ready(root=>{
const $=s=>root.querySelector(s),$$=s=>[...root.querySelectorAll(s)];
const bn=n=>String(n).replace(/\d/g,d=>'০১২৩৪৫৬৭৮৯'[d]);
const norm=s=>String(s).replace(/[০-৯]/g,c=>'০১২৩৪৫৬৭৮৯'.indexOf(c)).replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/\D/g,'');
const PAL=[['#E6F0FF','#2F6BFF','#FF9F1C'],['#F3E8FF','#8B3DFF','#FF4DA6'],['#DDF8EE','#00B386','#FFC233'],['#FFEDE3','#FF5A36','#FFB020'],['#FFE8F1','#E02D7B','#7A3CFF'],['#E8E6FF','#5B3DF5','#00C2FF'],['#DFF6FF','#0A8CFF','#00D68F'],['#FFF3D6','#FF9F1C','#2F6BFF']];
const PROP=['','cal','bok','mal','lck','lns','ear',''];
const MON=['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
const INST=['ঢাকা কলেজ','নটর ডেম কলেজ','ঢাকা সিটি কলেজ','হলি ক্রস কলেজ','রাজউক উত্তরা মডেল কলেজ','ভিকারুননিসা নূন স্কুল অ্যান্ড কলেজ','আইডিয়াল স্কুল অ্যান্ড কলেজ','সরকারি তিতুমীর কলেজ','রাজশাহী কলেজ','চট্টগ্রাম কলেজ','সিলেট এমসি কলেজ','বরিশাল ব্রজমোহন কলেজ','খুলনা পাবলিক কলেজ','কুমিল্লা ভিক্টোরিয়া কলেজ','ঢাকা কলেজিয়েট স্কুল','সেন্ট গ্রেগরি হাই স্কুল','মনিপুর উচ্চ বিদ্যালয়','গভঃ ল্যাবরেটরি হাই স্কুল','রাজশাহী কলেজিয়েট স্কুল','চট্টগ্রাম কলেজিয়েট স্কুল'];
const S={name:'',d:15,m:5,y:2006,level:'',school:'',college:'',skipC:false,email:'',pw:'',pw2:'',method:'email'};
const CTA=['পরের ধাপ','পরের ধাপ','পরের ধাপ','পরের ধাপ','অ্যাকাউন্ট তৈরি করো','কোড পাঠাও','যাচাই করো',''];
let i=0,busy=false,tT=0,resT=0,idleT=0,mT=0,hovT=0,nameDone=false,fwd=true;
const app=$('#sksApp'),bird=$('#sksBird'),cta=$('#sksCta'),back=$('#sksBack'),say=$('#sksSay'),html=document.documentElement,meta=document.querySelector('meta[name=theme-color]');
const BRIDGE=()=>{const a=window.AdmissionAccount;return a&&a.SkyFlow?a.SkyFlow:null};
const pad2=n=>String(n).padStart(2,'0');
const institution=(v,kind)=>({id:'sky-'+kind+'-'+String(v).toLowerCase().replace(/[^a-z0-9\u0980-\u09FF]+/g,'-').slice(0,40),name:String(v).trim(),district:''});
const profile=()=>({fullName:S.name.trim().replace(/\s+/g,' '),mobile:'',dob:S.y+'-'+pad2(S.m+1)+'-'+pad2(S.d),school:institution(S.school,'school'),higherInstitution:S.skipC?null:institution(S.college,'college'),email:S.email,pw:S.pw,pw2:S.pw2,password:S.pw,method:S.method});
function showOtpHint(t){const n=$('#sksOtH');if(n)n.textContent=t}
function createAccount(){const flow=BRIDGE();if(!flow){showOtpHint('এখন account সেবা নেই—একবার রিলোড করে আবার চেষ্টা করো');return}
 if(busy)return;busy=true;cta.disabled=true;cta.classList.add('busy');
 flow.createAccount(profile()).then(res=>{
  busy=false;cta.classList.remove('busy');refresh();
  if(res&&res.ok){go(5);return}
  const code=res&&res.code;
  if(code==='EMAIL_ALREADY_IN_USE'){talk('এই ইমেইলে আগেই account আছে। সাইন-ইনে নিয়ে যাচ্ছি।');setTimeout(()=>{if(flow.prefillLogin)flow.prefillLogin(S.email);go(0)},1400);return}
  talk(code==='VERIFICATION_UNAVAILABLE'?'এখন যাচাই পাঠানো যাচ্ছে না—আবার চেষ্টা করো।':'ইমেইলটা ঠিক আছে কি? একবার দেখে আবার চেষ্টা করো।');
  mood('sad');setTimeout(()=>go(3),1500);
 }).catch(()=>{busy=false;cta.classList.remove('busy');refresh();talk('কিছু একটা হয়েছে—আবার চেষ্টা করো।');mood('sad')});}

const first=()=>S.name.trim().split(/\s+/)[0]||'';
const TX=[()=>'হাই! আমি স্কাই। তোমার নাম কী?',()=>`বাহ্, সুন্দর নাম, ${first()}! তোমার জন্মতারিখ কত?`,()=>'তুমি কোথায় পড়ো? চলো স্কুল-কলেজ খুঁজি।',()=>'তোমার ইমেইল ঠিকানা কী?',()=>'এবার শক্ত একটা পাসওয়ার্ড বানাও। আমি দেখব না, কথা দিচ্ছি!',()=>'শেষ ধাপ! কীভাবে নিশ্চিত হতে চাও?',()=>S.method==='email'?'কোডটা তোমার ইমেইলে গেছে। ঘরে ট্যাপ করে লিখে ফেলো!':'টেলিগ্রামে কোড এসেছে। ঘরে ট্যাপ করে লিখে ফেলো!',()=>`দারুণ! স্বাগতম, ${first()}!`];
/* ---- keyboard: it must always be able to go down ---- */
const hideKb=()=>{const a=document.activeElement;if(a&&a.tagName==='INPUT'&&root.contains(a))a.blur()};
document.addEventListener('pointerdown',e=>{if(!e.target.closest('input,.fl,.sug,.chip,button,.col'))hideKb()});
$('#sksStage').addEventListener('touchmove',()=>hideKb(),{passive:true});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT'){e.preventDefault();hideKb()}});
if(window.visualViewport){const f=()=>{html.style.setProperty('--vh',window.visualViewport.height+'px');window.scrollTo(0,0)};window.visualViewport.addEventListener('resize',f);f()}
/* ---- bird ---- */
function mood(m){bird.dataset.m=m||''}
function look(x,y){bird.style.setProperty('--lx',x+'px');bird.style.setProperty('--ly',y+'px')}
function kick(c,ms){bird.classList.remove(c);void bird.offsetWidth;bird.classList.add(c);setTimeout(()=>bird.classList.remove(c),ms||700)}
function talk(t){clearInterval(tT);say.textContent='';let k=0;bird.classList.add('talk');tT=setInterval(()=>{k++;say.textContent=t.slice(0,k);if(k>=t.length){clearInterval(tT);bird.classList.remove('talk')}},28)}
function mimic(){bird.classList.add('talk');clearTimeout(mT);mT=setTimeout(()=>bird.classList.remove('talk'),240)}
function fly(r){bird.classList.remove('flyin','flyinr');void bird.offsetWidth;bird.classList.add(r?'flyinr':'flyin','flying');setTimeout(()=>bird.classList.remove('flyin','flyinr','flying'),1250)}
function hover(){bird.classList.remove('hov');void bird.offsetWidth;bird.classList.add('hov','flying');setTimeout(()=>bird.classList.remove('hov','flying'),2250)}
function wake(){clearInterval(hovT);hovT=setInterval(()=>{const a=document.activeElement;if(i<7&&!busy&&!(a&&a.tagName==='INPUT'))hover()},9500)}
function eyes(n){bird.style.setProperty('--eye',(1+Math.min(n,12)*.014).toFixed(3))}
/* ---- steps ---- */
function pal(n){const c=PAL[n];html.style.setProperty('--t',c[0]);html.style.setProperty('--p',c[1]);html.style.setProperty('--q',c[2]);meta.setAttribute('content',c[0])}
function refresh(){let ok=false;
 if(i===0)ok=S.name.trim().length>=2;else if(i===1)ok=true;
 else if(i===2)ok=!!S.level&&!!S.school&&(S.level==='SSC'||S.skipC||!!S.college);
 else if(i===3)ok=/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(S.email);
 else if(i===4)ok=S.pw.length>=8&&S.pw===S.pw2;else if(i===5)ok=true;
 else if(i===6)ok=$$('#sksOtp input').every(x=>x.value);
 cta.disabled=!ok||busy;cta.classList.toggle('ready',ok)}
function go(n){const prev=i;i=n;hideKb();pal(n);$$('.scr').forEach((e,k)=>{e.classList.toggle('on',k===n);e.classList.toggle('l',k<n)});
 $('#sksCtaT').textContent=CTA[n]||'';cta.classList.toggle('hide',n===7);back.classList.toggle('hide',!(n>=1&&n<=4||n===6));
 bird.dataset.p=PROP[n];mood('');look(0,0);eyes(0);fly(n<prev);talk(TX[n]());refresh();
 if(n===5)$('#sksMm').textContent=S.email?'কোড যাবে '+S.email:'কোড যাবে তোমার ইমেইলে';
 if(n===6)startOtp();if(n===7)celebrate()}
function next(){if(cta.disabled||busy)return;hideKb();
 if(i===4){createAccount();return}
 if(i===5){sendCode();return}
 if(i===6){verify();return}go(i+1)}
function sendCode(){const flow=BRIDGE();if(!flow){$('#sksOtH').textContent='এখন account সেবা নেই—রিলোড করে আবার চেষ্টা করো';go(6);startOtp();return}
 if(busy)return;busy=true;cta.disabled=true;cta.classList.add('busy');
 flow.sendCode(S.method).then(res=>{
  busy=false;cta.classList.remove('busy');
  if(res&&res.ok){go(6);if(res.url)try{window.open(res.url,'_blank','noopener,noreferrer')}catch(_){};return}
  talk(res&&res.retryAfter?'একটু পরে আবার পাঠানো যাবে।':'এখন কোড পাঠানো যাচ্ছে না—আবার চেষ্টা করো।');mood('sad');refresh();
 }).catch(()=>{busy=false;cta.classList.remove('busy');refresh();talk('কিছু একটা হয়েছে—আবার চেষ্টা করো।');mood('sad')});}
cta.addEventListener('click',next);
back.addEventListener('click',()=>{if(i===6)go(5);else if(i>0&&i<=4)go(i-1)});
$$('.cl').forEach(b=>b.addEventListener('pointerdown',e=>{e.preventDefault();const t=$('#'+b.dataset.c);t.value='';t.dispatchEvent(new Event('input'));t.focus()}));
/* ---- 0 name: the bird acts while he types, and understands when he is done ---- */
const inName=$('#sksInName');
inName.addEventListener('focus',()=>{mood('listen');look(0,6);nameDone=false});
inName.addEventListener('input',()=>{S.name=inName.value;nameDone=false;$('#sksFName').classList.toggle('good',S.name.trim().length>=2);kick('peck',250);mimic();mood('listen');eyes(S.name.length);look(Math.max(-6,Math.min(6,S.name.length*.8-6)),6);
 clearTimeout(idleT);idleT=setTimeout(()=>{if(i===0&&S.name&&document.activeElement===inName){mood('think');look(6,-5)}},1700);refresh()});
inName.addEventListener('blur',()=>{clearTimeout(idleT);if(i!==0)return;eyes(0);look(0,0);if(S.name.trim().length>=2&&!nameDone){nameDone=true;mood('happy');kick('clap',1500);talk(`বুঝেছি! তুমি ${first()}। কী সুন্দর নাম!`);setTimeout(()=>{if(i===0)mood('')},2200)}else mood('')});
/* ---- 1 wheel ---- */
const cd=$('#sksCD'),cm=$('#sksCM'),cy=$('#sksCY');
const YEARS=[];for(let y=2012;y>=1990;y--)YEARS.push(y);
function build(el,items,sel,onPick){el.innerHTML='<div class="pad"></div>'+items.map(t=>`<div class="it">${t}</div>`).join('')+'<div class="pad"></div>';
 const its=[...el.querySelectorAll('.it')];let tm,last=-1;const mark=k=>its.forEach((e,j)=>e.classList.toggle('sel',j===k));
 el.scrollTop=sel*44;mark(sel);
 el.addEventListener('scroll',()=>{const k=Math.max(0,Math.min(items.length-1,Math.round(el.scrollTop/44)));if(k!==last){last=k;mark(k);kick('peck',250);mood('wow');look(0,-4)}clearTimeout(tm);tm=setTimeout(()=>{onPick(k);mood('');look(0,0)},140)});
 return {set:k=>el.scrollTo({top:k*44,behavior:'smooth'})}}
const dim=()=>new Date(S.y,S.m+1,0).getDate();
function age(){const n=new Date(),b=new Date(S.y,S.m,S.d);let a=n.getFullYear()-b.getFullYear();if(n<new Date(n.getFullYear(),S.m,S.d))a--;$('#sksAge').textContent=`${bn(S.d)} ${MON[S.m]} ${bn(S.y)} · বয়স ${bn(a)} বছর`}
const wd=build(cd,Array.from({length:31},(_,k)=>bn(k+1)),S.d-1,k=>{S.d=Math.min(k+1,dim());if(k+1>dim())wd.set(S.d-1);age()});
build(cm,MON,S.m,k=>{S.m=k;if(S.d>dim()){S.d=dim();wd.set(S.d-1)}age()});
build(cy,YEARS.map(bn),YEARS.indexOf(S.y),k=>{S.y=YEARS[k];if(S.d>dim()){S.d=dim();wd.set(S.d-1)}age()});age();
/* ---- 2 school ---- */
$$('#sksLv .chip').forEach(c=>c.addEventListener('click',()=>{$$('#sksLv .chip').forEach(x=>x.classList.remove('sel'));c.classList.add('sel');S.level=c.dataset.v;$('#sksSf').style.display='block';$('#sksCwrap').style.display=S.level==='SSC'?'none':'block';kick('hop');mood('happy');setTimeout(()=>mood(''),900);talk(S.level==='SSC'?'ঠিক আছে! তোমার স্কুলটা খুঁজে নাও।':'দারুণ! স্কুল আর কলেজ দুটোই বলো।');refresh()}));
function search(inp,box,key){const render=()=>{const q=inp.value.trim();S[key]='';refresh();if(!q){box.classList.remove('show');return}
 const m=INST.filter(n=>n.includes(q)).slice(0,5);box.innerHTML=m.map(n=>`<button type="button" data-n="${n}">${n.replace(q,'<b>'+q+'</b>')}</button>`).join('')+`<button type="button" data-n="${q}">‘${q}’ যোগ করো</button>`;box.classList.add('show');kick('peck',250);mimic();look(0,6)};
 inp.addEventListener('input',render);inp.addEventListener('focus',()=>{mood('listen');look(0,6)});inp.addEventListener('blur',()=>{mood('');look(0,0)});
 box.addEventListener('pointerdown',e=>e.preventDefault());
 box.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;inp.value=b.dataset.n;S[key]=b.dataset.n;box.classList.remove('show');inp.closest('.fl').classList.add('good');kick('hop');hideKb();refresh()})}
search($('#sksInSch'),$('#sksSgSch'),'school');search($('#sksInCol'),$('#sksSgCol'),'college');
$$('#sksInSch,#sksInCol').forEach(x=>x.addEventListener('input',()=>x.closest('.fl').classList.remove('good')));
$('#sksSkipc').addEventListener('click',()=>{S.skipC=!S.skipC;$('#sksSkipc').textContent=S.skipC?'ঠিক আছে, কলেজ পরে দেব ✓':'এখনো কলেজে ভর্তি হইনি';$('#sksFCol').style.opacity=S.skipC?.4:1;hideKb();refresh()});
/* ---- 3 email ---- */
const inEm=$('#sksInEm');
inEm.addEventListener('focus',()=>{mood('listen');look(0,6)});inEm.addEventListener('blur',()=>{mood('');look(0,0)});
inEm.addEventListener('input',()=>{S.email=inEm.value.trim();const ok=/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(S.email);$('#sksFEm').classList.toggle('good',ok);$('#sksEmH').textContent=ok?'চমৎকার, ঠিকানাটা ঠিক আছে':'';kick('peck',250);mimic();look(Math.max(-6,Math.min(6,S.email.length*.4-6)),6);if(ok){mood('happy');setTimeout(()=>{if(document.activeElement===inEm)mood('listen')},800)}else mood('listen');refresh()});
$$('#sksS3 .chip').forEach(c=>c.addEventListener('click',()=>{const loc=inEm.value.split('@')[0];inEm.value=loc+'@'+c.dataset.d;inEm.dispatchEvent(new Event('input'));kick('hop');hideKb()}));
/* ---- 4 password ---- */
const pw=$('#sksInPw'),pw2=$('#sksInPw2');
const strength=p=>{let s=0;if(p.length>=8)s++;if(/\d/.test(p))s++;if(/[a-z]/.test(p)&&/[A-Z]/.test(p))s++;if(/[^\w]/.test(p)||p.length>=12)s++;return p?Math.max(1,s):0};
function pwChk(){S.pw=pw.value;S.pw2=pw2.value;const s=strength(S.pw);$('#sksMt').className='meter'+(s?' s'+s:'');const match=S.pw2&&S.pw===S.pw2;
 $('#sksFPw2').classList.toggle('good',!!match&&S.pw.length>=8);$('#sksFPw2').classList.toggle('bad',!!S.pw2&&!match);
 $('#sksPwH').textContent=S.pw.length&&S.pw.length<8?'আরও '+bn(8-S.pw.length)+' অক্ষর লাগবে':(S.pw2&&!match?'দুটো পাসওয়ার্ড মিলছে না':(match?'দারুণ, মিলে গেছে!':''));
 if(match&&S.pw.length>=8){mood('happy');setTimeout(()=>{if(document.activeElement===pw2)mood('cover')},900)}kick('peck',250);refresh()}
[pw,pw2].forEach(x=>{x.addEventListener('input',pwChk);x.addEventListener('focus',()=>mood('cover'));x.addEventListener('blur',()=>mood(''))});
$$('.eye').forEach(b=>{b.addEventListener('pointerdown',e=>e.preventDefault());b.addEventListener('click',()=>{const t=$('#'+b.dataset.t);t.type=t.type==='password'?'text':'password';mood(t.type==='text'?'wow':'cover');setTimeout(()=>{if(document.activeElement===t&&t.type==='password')mood('cover')},500)})});
/* ---- 5 verify ---- */
$$('.mc').forEach(c=>c.addEventListener('click',()=>{$$('.mc').forEach(x=>x.classList.remove('sel'));c.classList.add('sel');S.method=c.dataset.m;kick('hop');talk(S.method==='email'?'ইমেইলেই কোড পাঠাব!':'টেলিগ্রামে কোড পাঠাব!')}));
/* ---- 6 otp (Bengali and English digits both work) ---- */
const ods=$$('#sksOtp input'),cells=$$('#sksOtp .od');
function fill(arr){ods.forEach((o,j)=>{o.value=arr[j]||'';cells[j].classList.toggle('f',!!o.value)})}
function startOtp(){fill([]);$('#sksOtp').className='otp hint1';$('#sksOtH').textContent=S.method==='email'?'কোড গেছে '+(S.email||'তোমার ইমেইলে'):'টেলিগ্রামের অফিসিয়াল বটে ৬ সংখ্যার কোড এসেছে';
 let t=45;clearInterval(resT);const rb=$('#sksRsB'),rt=$('#sksRsT'),u=$('#sksTmu');rb.disabled=true;u.style.transition='none';u.style.transform='scaleX(1)';rt.textContent=`আবার পাঠানো যাবে ${bn(t)} সেকেন্ড পর `;
 requestAnimationFrame(()=>requestAnimationFrame(()=>{u.style.transition='transform 45s linear';u.style.transform='scaleX(0)'}));
 resT=setInterval(()=>{t--;if(t<=0){clearInterval(resT);rt.textContent='কোড পাওনি? ';rb.disabled=false}else rt.textContent=`আবার পাঠানো যাবে ${bn(t)} সেকেন্ড পর `},1000)}
ods.forEach((x,k)=>{
 x.addEventListener('focus',()=>{mood('listen');look(0,5);$('#sksOtp').classList.remove('hint1')});x.addEventListener('blur',()=>{if(i===6)mood('')});
 x.addEventListener('input',()=>{const d=norm(x.value);if(d.length>1){const arr=ods.map(o=>o.value);for(let j=0;j<d.length&&k+j<6;j++)arr[k+j]=d[j];fill(arr);const nk=Math.min(k+d.length,5);ods[nk].focus()}else{x.value=d;cells[k].classList.toggle('f',!!d);if(d&&k<5)ods[k+1].focus()}
  kick('peck',250);mimic();look((k-2.5)*2,5);refresh();if(ods.every(o=>o.value))verify()});
 x.addEventListener('keydown',e=>{if(e.key==='Backspace'&&!x.value&&k>0){ods[k-1].focus();ods[k-1].value='';cells[k-1].classList.remove('f');refresh()}if(e.key==='ArrowLeft'&&k>0)ods[k-1].focus();if(e.key==='ArrowRight'&&k<5)ods[k+1].focus()});
 x.addEventListener('paste',e=>{const d=norm(e.clipboardData.getData('text')||'').slice(0,6);if(!d)return;e.preventDefault();fill(d.split(''));ods[Math.min(d.length,5)].focus();refresh();if(d.length===6)verify()})});
function verify(){if(busy)return;const code=ods.map(o=>o.value).join('');if(code.length<6)return;busy=true;cta.disabled=true;cta.classList.add('busy');hideKb();
 const flow=BRIDGE();const method=S.method;
 const done=res=>{busy=false;cta.classList.remove('busy');const o=$('#sksOtp');
  if(res&&res.ok){o.classList.add('ok');cells.forEach((e,k)=>e.style.setProperty('--k',k));mood('happy');kick('hop');/* the engine's own verified/success surface takes over */return}
  const pending=res&&res.code==='EMAIL_PENDING';
  o.classList.remove('bad');void o.offsetWidth;if(!pending)o.classList.add('bad');mood('sad');if(!pending)kick('shake');
  $('#sksOtH').textContent=pending?'ইমেইলের লিংক খুলে আবার চেষ্টা করো':'কোডটা মেলেনি, আবার চেষ্টা করো';
  if(!pending)setTimeout(()=>{o.classList.remove('bad');mood('');fill([]);refresh()},900)};
 if(!flow){done({ok:false});return}
 flow.verifyCode(method,code).then(done).catch(()=>done({ok:false}));}
$('#sksRsB').addEventListener('click',()=>{const flow=BRIDGE();
 if(flow){flow.sendCode(S.method).then(res=>{kick('hop');talk(res&&res.ok?'নতুন কোড পাঠিয়ে দিলাম!':(res&&res.message)||'একটু পরে আবার চেষ্টা করো।');if(res&&res.ok)startOtp()}).catch(()=>talk('কিছু একটা হয়েছে—আবার চেষ্টা করো।'))}
 else{talk('এখন কোড পাঠানো যাচ্ছে না।')}});
/* ---- 7 celebrate ---- */
function celebrate(){mood('cheer');kick('loop',1800);$('#sksDnH').textContent='স্বাগতম, '+first()+'!';$('#sksDn').style.display='block';$('#sksDash').classList.remove('show');confetti();setTimeout(confetti,1000);setTimeout(()=>{$('#sksDn').style.display='none';$('#sksDash').classList.add('show')},3000)}
function confetti(){const cf=$('#sksCf'),c=['#2F6BFF','#FF9F1C','#00B386','#E02D7B','#8B3DFF'];for(let k=0;k<46;k++){const e=document.createElement('i');e.style.left=Math.random()*100+'%';e.style.background=c[k%5];e.style.setProperty('--d',(1.8+Math.random()*1.6)+'s');e.style.setProperty('--x',(Math.random()*120-60)+'px');e.style.setProperty('--r',(Math.random()*720-360)+'deg');cf.appendChild(e);setTimeout(()=>e.remove(),3600)}}
$('#sksReplay').addEventListener('click',()=>{Object.assign(S,{name:'',d:15,m:5,y:2006,level:'',school:'',college:'',skipC:false,email:'',pw:'',pw2:'',method:'email'});
 $$('input').forEach(x=>{x.value=''});$$('.fl').forEach(f=>f.classList.remove('good','bad'));$$('#sksLv .chip').forEach(c=>c.classList.remove('sel'));$('#sksSf').style.display='none';$('#sksMt').className='meter';age();go(0)});
root.dataset.skyMounted='1';
/* The legacy panels stay in the DOM as a hidden field store (see SkyFlow).
   Hiding them is the engine's own class-based rule, applied here rather than
   in the static markup so the legacy signup contract the guard tests assert
   against stays byte-for-byte intact. */
root.closest('form.ah-signup-view')?.classList.add('ah-signup-legacy');
wake();go(0);
});  /* ready() */
})();

