/* Build-time frontend cache refresh. Never writes backend sources or deploys a Worker. */
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(process.argv[2]||'dist');
const version='sky-flow-20261013-v1';
const indexPath=join(root,'index.html');
let html=readFileSync(indexPath,'utf8');
const matches=html.match(/app-seed\.js\?v=[^"']+/g)||[];
if(matches.length!==1)throw Error('Expected exactly one existing app-seed loader');
html=html.replace(matches[0],`app-seed.js?v=${version}`);
/* The P19 preload hints point at the same versioned welcome assets app-seed
   injects. If they drift, the browser downloads one URL and app-seed requests
   another — the preload is wasted and the fetch is paid twice. */
html=html.replace(/sky-onboarding\.(css|js)\?v=[^"']+/g,(m,ext)=>`sky-onboarding.${ext}?v=${version}`);
if((html.match(/sky-onboarding\.(css|js)\?v=/g)||[]).length<2)throw Error('Expected the welcome preload hints in index.html');
writeFileSync(indexPath,html);
const swPath=join(root,'sw.js');
let sw=readFileSync(swPath,'utf8');
const release=(process.env.GITHUB_SHA||'local-preview').slice(0,12);
sw=sw.replace(/const BUILD_ID = '[^']*';/,`const BUILD_ID = 'welcome-${release}';`);
const additions=['app-seed.js','sky-onboarding.css','sky-onboarding.js'];
sw=sw.replace('const APP_SHELL = [','const APP_SHELL = [\n'+additions.map(path=>`  './${path}?v=${version}',`).join('\n'));
writeFileSync(swPath,sw);
const result=spawnSync(process.execPath,[join(root,'scripts/sw-manifest.mjs')],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
console.log('Admission Sky frontend build: versioned loader, isolated UI and offline cache updated.');
