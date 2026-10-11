import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test("native welcome ships the owner's v5 story design",()=>{
 const html=read('welcome-onboarding.html');
 assert.ok(html.includes('ahw-sky-board'));
 assert.ok(html.includes('Admission'));
 assert.ok(html.includes('Get Started'));
 // The five entry paths the owner drew, each with a binding slot.
 for(const slot of ['signup','login','google','facebook','guest']) assert.ok(html.includes(`data-sky-slot="${slot}"`),slot);
 assert.ok(!/\{\{|<x-dc|<sc-for|<script|react\.js/i.test(html));
});
test('welcome binds the design entry buttons to the real account controls',()=>{
 const js=read('welcome-onboarding.js');
 // account-access.js owns the flows; the design triggers those controls.
 for(const role of ['welcome-signup','welcome-login','welcome-google-button','continue-guest']) assert.ok(js.includes(role),role);
 assert.ok(js.includes('data-sky-slot="'));
 // Facebook stays drawn but inert until the owner turns it on.
 assert.ok(js.includes('শীঘ্রই আসছে'));
 assert.ok(js.includes('dataset.welcomeUpgrade'));
 assert.ok(!/\/api\/|localStorage|sessionStorage|cloneNode|method:\s*['"]POST/.test(js));
});
test('the story stops when the student leaves the welcome view',()=>{
 const js=read('welcome-onboarding.js');
 // The preview's timer chain must not outlive the screen (and the page).
 assert.ok(js.includes('const active='));
 assert.ok(js.includes('const sync='));
 assert.ok(js.includes("page.dataset.currentView==='welcome'"));
 assert.ok(js.includes('pagehide'));
});
test('empty data seed stays empty and only loads the scoped UI',()=>{
 const loader=read('app-seed.js');
 assert.ok(loader.includes('window.AH_SEED = { subjects: [], topics: [], questions: [], vocabulary: [], vocabularyMaster: [] }'));
 assert.ok(loader.includes('welcome-onboarding.css'));
 assert.ok(loader.includes('welcome-onboarding.js'));
});
test('frontend workflow has no Worker deployment',()=>{
 const workflow=read('.github/workflows/deploy-welcome-frontend.yml');
 assert.ok(workflow.includes('pages deploy dist --project-name admissionhub --branch main'));
 assert.ok(!/command:\s*deploy --config|build:worker|wrangler\.toml\s*$/.test(workflow));
});
test('a successful mount reveals the welcome (regression: it stayed visibility:hidden, blank page)',()=>{
 const js=read('welcome-onboarding.js');
 // The scaffold is hidden while the template loads; every success path must
 // clear that inline style, or the whole welcome stays invisible.
 assert.ok(js.includes("ctl.view.style.visibility='hidden'"));
 assert.ok(js.includes("ctl.view.style.visibility='';"));
});
