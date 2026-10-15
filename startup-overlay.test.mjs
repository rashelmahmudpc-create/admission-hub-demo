import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const html=readFileSync('index.html','utf8');
const start=html.indexOf("var o=document.createElement('div');o.id='ahBootGuard';");
const end=html.indexOf('})();',start);
const guard=html.slice(start,end);
function simulate({gate=false,frame=true,frameReady=true,accountVisible=false}){
 let removed=false,tick;
 const overlay={style:{},parentNode:{},remove(){removed=true;this.parentNode=null;}};
 const shell={hidden:!accountVisible,innerText:accountVisible?'Verified account welcome content':'',getClientRects(){return this.hidden?[]:[{}]}};
 const iframe={getClientRects:()=>[{}],contentDocument:{body:{children:frameReady?[{}]:[]}}};
 const doc={createElement:()=>overlay,body:{appendChild(){},classList:{contains:()=>gate,remove(){}}},querySelector(s){if(s==='.ah-account-page')return shell;if(s==='#app iframe.dv3-frame')return frame?iframe:null;if(s==='#app .page')return {innerText:'',textContent:'',getClientRects:()=>[{}]};return null;}};
 runInNewContext(guard,{document:doc,setInterval(fn){tick=fn;return 1;},clearInterval(){},setTimeout(){}});
 tick();return removed;
}
test('verified returning dashboard is not hidden behind 15-second timeout',()=>assert.equal(simulate({}),true));
test('a frame that has not rendered is not considered usable',()=>assert.equal(simulate({frameReady:false}),false));
test('active account gate is never bypassed by an underlying dashboard',()=>assert.equal(simulate({gate:true}),false));
test('visible populated welcome screen can release overlay',()=>assert.equal(simulate({gate:true,accountVisible:true}),true));
