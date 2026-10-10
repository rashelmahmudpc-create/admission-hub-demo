/* Install Guide — warm install pop-up behaviour (jsdom).
 *
 * It must invite the student once, tailor the steps to the platform, remember
 * a dismissal so it never nags, and stay completely silent once installed. */
import { test as t, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const JS = readFileSync('install-guide.js', 'utf8');
const windows = [];
afterEach(() => { while (windows.length) { try { windows.pop().close(); } catch (_) {} } });

function boot({ ua = 'Mozilla/5.0 (Linux; Android 13)', standalone = false, store = new Map(), touch = false } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://admissionhub.pages.dev/'
  });
  const w = dom.window;
  const uaDef = Object.getOwnPropertyDescriptor(w.navigator, 'userAgent');
  // jsdom navigator is read-only; override via defineProperty on a clone.
  Object.defineProperty(w.navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(w.navigator, 'maxTouchPoints', { value: touch ? 5 : 0, configurable: true });
  if (standalone) Object.defineProperty(w.navigator, 'standalone', { value: true, configurable: true });
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
  w.localStorage.clear();
  for (const [k, v] of store) w.localStorage.setItem(k, v);
  const s = w.document.createElement('script');
  s.textContent = JS;
  w.document.body.appendChild(s);
  windows.push(dom);
  return w;
}

t('ig-01: on Android it offers the real install action and Android steps', async () => {
  const w = boot({ ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7)' });
  assert.equal(w.AhInstallGuide.platform(), 'android');
  const ok = await w.AhInstallGuide.show();
  assert.equal(ok, true);
  const card = w.document.querySelector('.ahig-card');
  assert.ok(card, 'the pop-up renders');
  assert.match(w.document.querySelector('.ahig-primary').textContent, /যোগ করুন/);
  assert.match(w.document.querySelector('.ahig-steps').textContent, /মেনু/);
});

t('ig-02: on iPhone it shows the Share → Add to Home Screen steps', async () => {
  const w = boot({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', touch: true });
  assert.equal(w.AhInstallGuide.platform(), 'ios');
  await w.AhInstallGuide.show();
  const steps = w.document.querySelector('.ahig-steps').textContent;
  assert.match(steps, /Add to Home Screen/);
  assert.match(steps, /Share/);
});

t('ig-06: the animation demo shows the gesture and the result on the right platform', async () => {
  const w = boot({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', touch: true });
  await w.AhInstallGuide.show();
  const stage = w.document.querySelector('.ahig-stage');
  assert.ok(stage, 'the demo stage renders');
  assert.equal(stage.getAttribute('data-demo'), 'ios');
  assert.ok(w.document.querySelector('[data-anim="tap"]'), 'there is a tap target');
  assert.ok(w.document.querySelector('[data-anim="hit"]'), 'there is a highlighted menu row');
  assert.ok(w.document.querySelector('[data-anim="land"]'), 'the resulting home-screen icon is shown');
  assert.match(stage.textContent, /Add to Home Screen/);
});

t('ig-03: an installed app (standalone) is never interrupted', async () => {
  const w = boot({ standalone: true });
  assert.equal(w.AhInstallGuide.isStandalone(), true);
  const ok = await w.AhInstallGuide.show();
  assert.equal(ok, false);
  assert.equal(w.document.querySelector('.ahig-card'), null);
});

t('ig-04: it shows once, then stays quiet for two weeks after a dismissal', async () => {
  const w = boot();
  await w.AhInstallGuide.show();
  w.document.querySelector('.ahig-close').click();
  await new Promise(r => setTimeout(r, 280));
  assert.equal(w.document.querySelector('.ahig-card'), null, 'closing removes it');
  const state = JSON.parse(w.localStorage.getItem('ah-install-guide-v1'));
  assert.ok(state.dismissedAt > 0, 'the dismissal is remembered');
  const again = await w.AhInstallGuide.show();
  assert.equal(again, false, 'it does not nag within the snooze window');
});

t('ig-05: "পরে মনে করাব" snoozes, and the owner\'s copy is used', async () => {
  const w = boot();
  await w.AhInstallGuide.show();
  const html = w.document.querySelector('.ahig-card').textContent;
  assert.match(html, /হাতের কাছেই/);
  assert.match(html, /অফলাইনেও পড়তে/);
  assert.doesNotMatch(html, /ইনস্টল করুন।/);
  w.document.querySelector('[data-action="later"]').click();
  assert.ok(JSON.parse(w.localStorage.getItem('ah-install-guide-v1')).dismissedAt > 0);
});
