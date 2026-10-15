import {readFileSync,writeFileSync} from 'node:fs';
const path='index.html';
let html=readFileSync(path,'utf8');
if(html.includes('function dashboardFrameReady()'))process.exit(0);
const anchor="function accountShell(){return document.querySelector('.ah-account-page');}";
const old="if(el){ if(accountReady()){if(o.parentNode)o.remove();clearInterval(iv);} return; }";
if(!html.includes(anchor)||!html.includes(old))throw Error('Boot overlay contract changed; review required');
const extra=`function dashboardFrameReady(){
    var fr=document.querySelector('#app iframe.dv3-frame');
    try{return !!fr&&fr.getClientRects().length>0&&!!fr.contentDocument&&!!fr.contentDocument.body&&fr.contentDocument.body.children.length>0;}catch(_){return false;}
  }
  `;
html=html.replace(anchor,extra+anchor);
html=html.replace(old,"if(el){ if(accountReady()||(!gate&&(vis(appPageEl())||dashboardFrameReady()))){if(o.parentNode)o.remove();clearInterval(iv);} return; }");
writeFileSync(path,html);
console.log('Boot overlay now accepts a visible, rendered dashboard frame; hidden account shells no longer force the 15s timeout.');
