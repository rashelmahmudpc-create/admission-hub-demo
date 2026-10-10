/* Owner-supplied welcome design, native DOM. No API, authentication or account-state changes. */
(() => {
'use strict';
const base=new URL('.',document.currentScript.src),version='welcome-native-20261010-v9';
const themes=[['#1d4ed8','#2563eb','#fff','37,99,235'],['#5b3df0','#6c4cf5','#fff','108,76,245'],['#078a68','#0a9a73','#fff','10,154,115'],['#d93f1c','#e8482a','#fff','232,72,42'],['#b8265a','#d6336c','#fff','214,51,108'],['#b45309','#ffb020','#2b1a00','255,176,32']];
const english=[['All admission notices in one place','Never miss university, medical or GST admissions'],['Simple visual courses','Understand grammar with visuals and examples'],['Question bank and model tests','Sharpen your skills, one subject at a time'],['Learn from mistakes','See what went wrong and why the answer is correct'],['Track your progress','See clearly where you need to improve'],['AI help for any question','Ask when you get stuck and get a simple explanation']];
let pending=false;
const mount=async()=>{
 const page=document.getElementById('ah-account-page'),view=page?.querySelector('[data-view="welcome"]');
 if(!view||pending||view.dataset.welcomeUpgrade)return;
 const controls=Object.fromEntries(['welcome-signup','welcome-language'].map(role=>[role,view.querySelector(`[data-role="${role}"]`)]));
 if(!controls['welcome-signup']||!controls['welcome-language'])return;
 pending=true;
 /* Hide the old welcome scaffold until the new design is mounted, so the old
    UI never flashes on screen; it is revealed again if the fetch fails. */
 view.style.visibility='hidden';
 try{
  const response=await fetch(new URL(`welcome-onboarding.html?v=${version}`,base));
  if(!response.ok)throw Error('Welcome template unavailable');
  const template=document.createElement('template');template.innerHTML=await response.text();
  const board=template.content.querySelector('.ahw-artboard');
  if(!board||!board.querySelector('[data-w-signup]'))throw Error('Invalid welcome template');
  const signup=controls['welcome-signup'],language=controls['welcome-language'];
  const placeholder=board.querySelector('[data-w-signup]');
  signup.className=placeholder.className;signup.dataset.wStyle=placeholder.dataset.wStyle;signup.innerHTML=placeholder.innerHTML;placeholder.replaceWith(signup);
  board.querySelector('[data-w-language]').replaceWith(language);
  /* Owner: Get Started is the only entry. The "Already have an account? Log In"
     line and the "More options" disclosure (Google / guest) are removed. */
  board.querySelector('[data-w-login]')?.closest('[data-w-style="w73"]')?.remove();
  const heading=board.querySelector('#ah-welcome-heading');heading.dataset.bn='ভর্তির প্রস্তুতি,|এবার গুছিয়ে।';heading.dataset.en='Admission prep,|now organized.';
  const intro=heading.nextElementSibling;intro.dataset.bn=intro.textContent;intro.dataset.en='Study a little every day, practise, and see your progress for yourself.';
  const swipe=board.querySelector('[data-w-swipe]'),slides=[...swipe.firstElementChild.children],dots=[...board.querySelectorAll('[data-slide]')];
  slides.forEach((card,i)=>{
   card.setAttribute('role','group');card.setAttribute('aria-roledescription','slide');card.setAttribute('aria-label',`${i+1} / 6: ${dots[i].getAttribute('aria-label')}`);
   const copy=card.lastElementChild;
   [...copy.children].slice(1).forEach((node,j)=>{node.dataset.bn=node.textContent;node.dataset.en=english[i][j];});
  });
  const pause=document.createElement('button');pause.className='ahw-pause';pause.type='button';dots[0].parentElement.append(pause);
  swipe.tabIndex=0;swipe.setAttribute('role','region');swipe.setAttribute('aria-roledescription','carousel');swipe.setAttribute('aria-label','Admission Hub features');
  const hadFocus=view.contains(document.activeElement);
  view.className='ah-account-view ah-welcome-live';view.dataset.welcomeUpgrade=version;view.replaceChildren(board);view.style.visibility='';page.classList.add('ah-welcome-upgraded');
  let slide=0,timer=null,paused=matchMedia('(prefers-reduced-motion: reduce)').matches,hover=false,focused=false,start=null;
  const render=n=>{
   slide=(n+6)%6;const[accent,btn,ink,rgb]=themes[slide];
   for(const[key,value]of Object.entries({accent,btn,ink,shadow:`rgba(${rgb},.38)`,card:`rgba(${rgb},.16)`,track:`${-slide*100}%`}))view.style.setProperty(`--w-${key}`,value);
   for(let i=0;i<6;i++)view.style.setProperty(`--w-g${i}`,i===slide?'1':'0');
   dots.forEach((dot,i)=>dot.setAttribute('aria-pressed',String(i===slide)));
   slides.forEach((card,i)=>{card.setAttribute('aria-hidden',String(i!==slide));card.inert=i!==slide;});
  };
  const sync=()=>{
   clearInterval(timer);timer=null;pause.textContent=paused?'▶':'Ⅱ';pause.setAttribute('aria-label',paused?'Play slideshow':'Pause slideshow');
   board.classList.toggle('ahw-frozen',paused||document.hidden||page.hidden||view.hidden);
   if(!paused&&!hover&&!focused&&!document.hidden&&!page.hidden&&!view.hidden)timer=setInterval(()=>render(slide+1),5600);
  };
  const translate=()=>{
   const lang=language.value==='en'?'en':'bn';
   board.querySelectorAll('[data-bn][data-en]').forEach(node=>{
    if(node===heading){const[first,second]=node.dataset[lang].split('|'),em=document.createElement('em');em.textContent=second;node.replaceChildren(document.createTextNode(first),document.createElement('br'),em);}else node.textContent=node.dataset[lang];
   });
  };
  language.addEventListener('change',translate);
  window.addEventListener('ah:lang',event=>{language.value=event.detail?.lang==='en'?'en':'bn';translate();});
  dots.forEach((dot,i)=>dot.addEventListener('click',()=>{render(i);sync();}));
  pause.addEventListener('click',()=>{paused=!paused;sync();});
  swipe.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();render(event.key==='Home'?0:event.key==='End'?5:slide+(event.key==='ArrowRight'?1:-1));sync();});
  swipe.addEventListener('pointerdown',event=>{if(event.isPrimary&&event.button===0)start=[event.clientX,event.clientY,event.pointerId];});
  window.addEventListener('pointerup',event=>{if(!start||start[2]!==event.pointerId)return;const dx=event.clientX-start[0],dy=event.clientY-start[1];start=null;if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)){render(slide+(dx<0?1:-1));sync();}});
  window.addEventListener('pointercancel',()=>{start=null;});
  board.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse'){hover=true;sync();}});board.addEventListener('pointerleave',()=>{hover=false;sync();});
  board.addEventListener('focusin',()=>{focused=true;sync();});board.addEventListener('focusout',()=>queueMicrotask(()=>{focused=board.contains(document.activeElement);sync();}));
  document.addEventListener('visibilitychange',sync);
  const observer=new MutationObserver(sync);observer.observe(page,{attributes:true,attributeFilter:['hidden','data-current-view']});observer.observe(view,{attributes:true,attributeFilter:['hidden']});
  render(0);translate();sync();if(hadFocus)signup.focus({preventScroll:true});discover.disconnect();
 }catch(error){view.style.visibility='';console.warn('[welcome-ui] Original welcome retained:',error.message);}finally{pending=false;}
};
const discover=new MutationObserver(mount);discover.observe(document.documentElement,{childList:true,subtree:true});mount();window.addEventListener('pagehide',()=>discover.disconnect(),{once:true});
})();
