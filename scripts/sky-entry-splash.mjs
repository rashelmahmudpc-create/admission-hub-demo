// Idempotent: Sky avatar entry splash (owner 2026-10-16). Entering the dashboard
// shows ONLY the Sky avatar for at least 5s, then the dashboard. Welcome is not delayed.
import {readFileSync,writeFileSync} from 'node:fs';
const p='index.html';let s=readFileSync(p,'utf8');
if(s.includes('SKY ENTRY SPLASH')){console.log('Sky entry splash already applied');process.exit(0);}
const rep=(a,b)=>{if(s.split(a).length!==2)throw Error('Sky splash anchor changed: '+a.slice(0,60));s=s.replace(a,()=>b);};
rep("  var stuck=0;\n  var iv=setInterval(function(){",
`  /* SKY ENTRY SPLASH (owner 2026-10-16): the dashboard is revealed only after the
     Sky avatar has been on screen for at least 5s. The welcome screen is not delayed. */
  var SKY_MIN=5000,t0=Date.now();
  function dropDash(){var w=SKY_MIN-(Date.now()-t0);if(w>0){setTimeout(function(){if(o.parentNode)o.remove();},w);}else if(o.parentNode)o.remove();}
  var stuck=0;
  var iv=setInterval(function(){`);
rep("if(el){ if(accountReady()||(!gate&&(vis(appPageEl())||dashboardFrameReady()))){if(o.parentNode)o.remove();clearInterval(iv);} return; }",
"if(el){ if(accountReady()){if(o.parentNode)o.remove();clearInterval(iv);} else if(!gate&&(vis(appPageEl())||dashboardFrameReady())){clearInterval(iv);dropDash();} return; }");
rep("      if(stuck>=3){document.body.classList.remove('ah-account-page-active');if(o.parentNode)o.remove();clearInterval(iv);return;}\n    }else stuck=0;\n    if(real()){if(o.parentNode)o.remove();clearInterval(iv);}",
"      if(stuck>=3){document.body.classList.remove('ah-account-page-active');clearInterval(iv);dropDash();return;}\n    }else stuck=0;\n    if(accountReady()){if(o.parentNode)o.remove();clearInterval(iv);return;}\n    if(real()){clearInterval(iv);dropDash();}");
// Entry splash after Sign In / Sign Up / Guest: separate script right after the guard.
const guardEnd="  document.body.appendChild(o);\n})();\n</script>\n";
rep(guardEnd, guardEnd+`<script id="ah-sky-entry">
/* SKY ENTRY SPLASH: when the user leaves the welcome/account screen for the
   dashboard (sign in, sign up, guest), cover everything with ONLY the Sky avatar
   for 5s, then show the dashboard (hard cap 12s). */
(function(){
  var src=document.getElementById('ahBootGuard');if(!src)return;
  var html=src.innerHTML,css=src.style.cssText,MIN=5000;
  function shown(el){return !!el&&!el.hidden&&el.getClientRects().length>0;}
  function acct(){var el=document.querySelector('.ah-account-page');return shown(el)&&(el.innerText||'').trim().length>20;}
  function dash(){var fr=document.querySelector('#app iframe.dv3-frame');try{if(fr&&fr.getClientRects().length&&fr.contentDocument&&fr.contentDocument.body&&fr.contentDocument.body.children.length)return true;}catch(_){}var pg=document.querySelector('#app .page');return shown(pg);}
  function show(){
    if(document.getElementById('ahSkyEntry'))return;
    var n=document.createElement('div');n.id='ahSkyEntry';n.className='ah-boot';n.style.cssText=css;n.innerHTML=html;
    document.body.appendChild(n);var s0=Date.now();
    var w=setInterval(function(){var e=Date.now()-s0;if((e>=MIN&&dash())||e>=12000){clearInterval(w);n.remove();}},150);
  }
  window.__ahSkySplash=show;
  document.addEventListener('admissionhub:entry-complete',show);
  var was=false,last=document.body.classList.contains('ah-account-page-active');
  new MutationObserver(function(){var g=document.body.classList.contains('ah-account-page-active');if(g&&acct())was=true;if(last&&!g&&was){was=false;show();}last=g;}).observe(document.body,{attributes:true,attributeFilter:['class']});
  setInterval(function(){if(document.body.classList.contains('ah-account-page-active')&&acct())was=true;},300);
}());
</script>
`);
writeFileSync(p,s);console.log('Sky entry splash applied (5s minimum on dashboard entry).');
