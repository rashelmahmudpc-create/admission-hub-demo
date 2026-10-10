import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('native welcome has six slides and no design-tool or React runtime',()=>{
 const html=read('welcome-onboarding.html');
 assert.equal((html.match(/data-slide="\d"/g)||[]).length,6);
 assert.ok(html.includes('ভর্তির প্রস্তুতি'));
 assert.ok(html.includes('Get Started'));
 assert.ok(!/\{\{|<x-dc|<sc-for|<script|react\.js/i.test(html));
});
test('welcome keeps Get Started as the only entry and drops the old auth links',()=>{
 const js=read('welcome-onboarding.js');
 assert.ok(js.includes('welcome-signup'));
 assert.ok(js.includes('welcome-language'));
 assert.ok(js.includes('placeholder.replaceWith(signup)'));
 // Owner (2026-10-10): the "Already have an account? Log In" line and the
 // "More options" disclosure (Google + guest) are gone — only Get Started.
 assert.ok(!js.includes('welcome-login'));
 assert.ok(!js.includes('welcome-google-button'));
 assert.ok(!js.includes('continue-guest'));
 assert.ok(!js.includes('ahw-more'));
 assert.ok(!js.includes('link.replaceWith'));
 assert.ok(js.includes('closest(\'[data-w-style="w73"]\')'));
 assert.ok(!/\/api\/|localStorage|sessionStorage|cloneNode|method:\s*['"]POST/.test(js));
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
