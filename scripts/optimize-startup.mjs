// Idempotent, fail-closed source migration. Does not alter backend/session validation.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(process.argv[2]||'.');
const read=p=>readFileSync(join(root,p),'utf8');
const write=(p,v)=>writeFileSync(join(root,p),v);
let html=read('index.html');
if(html.includes('id="ah-idle-features"')){console.log('Startup optimization already applied');process.exit(0);}
const idleNames=new Set([
 'experience-studio-store.js','experience-studio-themes.js','experience-studio-animations.js',
 'experience-studio-cards.js','experience-studio-hooks.js','experience-studio-shell.js',
 'notification-hub.js','notification-fcm.js','notification-inbox.js','notification-center-route.js',
 'analytics-dashboard.js','analytics-insight-engine.js','analytics-insights-panel.js','cloud-content-sync.js'
]);
const idle=[];
html=html.replace(/<script\b([^>]*\bsrc=["']([^"']+)["'][^>]*)>\s*<\/script>/g,(tag,attrs,src)=>{
 const name=src.split('?')[0].split('/').pop();
 if(!idleNames.has(name))return tag;
 const code=read(name);
 if(code.includes('DOMContentLoaded')&&!code.includes('document.readyState'))throw Error('Unsafe late module: '+name);
 idle.push(src);
 return `<script type="application/x-ah-idle" data-ah-src="${src}"></script>`;
});
if(idle.length!==idleNames.size)throw Error('Expected 14 known idle modules; got '+idle.length);
const seed=html.match(/<script\b[^>]*\bsrc=["'][^"']*app-seed\.js\?[^"']+["'][^>]*>\s*<\/script>/g);
if(seed?.length!==1)throw Error('Expected one app-seed script');
html=html.replace(seed[0],'');
const accountTag=/<script\b[^>]*\bsrc=["'][^"']*account-access\.js\?[^"']+["'][^>]*>\s*<\/script>/;
if(!accountTag.test(html))throw Error('Auth bridge tag missing');
html=html.replace(accountTag,m=>m+'\n'+seed[0]);
const emptyGuard='return !!el&&!el.hidden&&el.getClientRects().length>0;';
if(!html.includes(emptyGuard))throw Error('Boot guard contract changed');
html=html.replace(emptyGuard,"return !!el&&!el.hidden&&el.getClientRects().length>0&&(el.innerText||'').trim().length>20;");
const warm="if(typeof requestIdleCallback==='function') requestIdleCallback(warmPacks,{timeout:6000}); else setTimeout(warmPacks,3000);";
if(!html.includes(warm))throw Error('Warm-pack contract changed');
html=html.replace(warm,"const queueWarmPacks=()=>setTimeout(()=>{if(typeof requestIdleCallback==='function') requestIdleCallback(warmPacks,{timeout:6000});else warmPacks();},5000);\n  if(document.readyState==='complete')queueWarmPacks();else window.addEventListener('load',queueWarmPacks,{once:true});");
const runtime=`<script id="ah-idle-features">
(()=>{'use strict';
 const sources=${JSON.stringify(idle)};
 let work=null;
 const state=window.AdmissionStartup= {version:'startup-fast-v1',loaded:[],failed:[],ready:false};
 const pause=()=>new Promise(r=>setTimeout(r,16));
 const load=src=>new Promise(resolve=>{const s=document.createElement('script');s.src=src;s.async=false;s.onload=()=>{state.loaded.push(src);resolve();};s.onerror=()=>{state.failed.push(src);console.warn('[Startup] Optional feature unavailable:',src);resolve();};document.head.appendChild(s);});
 const start=()=>{if(work)return work;work=(async()=>{try{await window.__admissionBootPromise;}catch(_){} await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));try{performance.mark('ah-critical-first-frame');}catch(_){} for(const src of sources){await load(src);await pause();}state.ready=true;window.dispatchEvent(new CustomEvent('admission:idle-features-ready'));})();return work;};
 state.loadFeatures=start;
 const queue=()=>setTimeout(start,200);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',queue,{once:true});else queue();
})();
</script>`;
html=html.replace(/<\/body>\s*<\/html>\s*$/,runtime+'\n</body>\n</html>');
const barrier="const modulesParsed=()=>{\n    window.__admissionModuleBarrierReady=true;\n    startFinalRender();\n    const promise=window.__admissionBootPromise;\n    if(promise&&typeof promise.then==='function') promise.then(()=>startFinalRender()).catch(()=>{});\n  };";
if(!html.includes(barrier))throw Error('Module barrier contract changed');
html=html.replace(barrier,"const modulesParsed=()=>{\n    window.__admissionModuleBarrierReady=true;\n    const finish=()=>{if(window.__admissionBootStatus==='ready'&&document.querySelector('#app .dv3-frame'))return;startFinalRender();};\n    finish();\n    const promise=window.__admissionBootPromise;\n    if(promise&&typeof promise.then==='function')promise.then(finish).catch(()=>{});\n  };");
let auth=read('account-access.js');
const refresh='const sessionReady = refreshSession();';
if(!auth.includes(refresh))throw Error('Session bootstrap contract changed');
auth=auth.replace(refresh,`const sessionReady = refreshSession().then(session => {
      // Only the SERVER-verified session releases the startup hide. No cached
      // cookie, browser hint or guessed identity is accepted as authority.
      if (accountVerified(session) && pageHost.hidden) {
        document.documentElement.classList.remove('ah-pre');
      }
      return session;
    });`);
const old='account-access.js?v=20261015-login-complete-v1';
const next=old+'&startup=fast1';
if(!html.includes(old))throw Error('Auth asset version changed; review migration');
html=html.split(old).join(next);
let sw=read('sw.js').split(old).join(next);
sw=sw.replace(/const BUILD_ID = '[^']*';/,"const BUILD_ID = 'v350-fast-startup';");
html=html.split('v349-sky-bottom-inset').join('v350-fast-startup');
// Keep the existing production verification workflow's asset pins current.
const guardPath='.github/workflows/telegram-auth-canary-activate.yml';
let guard=read(guardPath);
guard=guard.split('account-access.js?v=20261015-safearea1').join(next)
 .split('account-access.css?v=20261015-safearea1').join('account-access.css?v=20261015-login-complete-v1')
 .split('agent-f1-ui-p06chat').join('agent-f1-ui-skyv7')
 .split('v335-lock-20261016').join('v350-fast-startup');
write(guardPath,guard);
write('account-access.js',auth);write('index.html',html);write('sw.js',sw);
console.log('Optimized 14 optional modules, server-verified entry gate, first-frame warmup, welcome priority and duplicate iframe render.');
