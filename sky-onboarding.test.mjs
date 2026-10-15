/* Admission Sky flow — regression guard for the live signup / log-in design.
 *
 * Boots the REAL sky-onboarding.js in jsdom with a stub bridge (the seam
 * account-access.js publishes as window.AdmissionSkyBridge) and asserts the
 * contract the deleted welcome tests used to cover: the flow fails closed with
 * no bridge, mounts and gates its CTA per screen, and never reaches the network
 * or keeps a hardcoded OTP of its own. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const JS = readFileSync('sky-onboarding.js', 'utf8');
const CSS = readFileSync('sky-onboarding.css', 'utf8');

function makeBridge(doc, log) {
  const mount = () => doc.getElementById('ah-sky-flow');
  return {
    friendly: e => String(e && e.message || e),
    mount,
    reveal(node) { const m = mount(); if (node && node !== m) m.append(node); m.hidden = false; },
    conceal() { log.push('conceal'); mount().hidden = true; },
    welcome() { log.push('welcome'); mount().hidden = true; },
    capabilities: async () => ({ email: true, telegram: true, emailOwnership: true, google: true, facebook: true, passkey: false }),
    institutions: async () => [],
    signup: async () => ({}),
    login: async () => ({}),
    startEmail: async () => ({ resendAfter: 45 }),
    startTelegram: async () => ({ resendAfter: 45 }),
    verifyEmail: async () => ({}),
    verifyTelegram: async () => ({}),
    finish() { log.push('finish'); }
  };
}

// Same bridge, but the email start reports the Firebase-link fallback: every OTP
// provider is spent, so the Worker sent a link and there is no code to type.
function makeLinkBridge(doc, log) {
  const b = makeBridge(doc, log);
  b.startEmail = async () => ({ link: true, resendAfter: 45, emailMasked: 'a•••@e•••.com' });
  b.checkEmail = async () => { log.push('checkEmail'); return true; };
  return b;
}

async function boot({ withBridge = true, bridge = null } = {}) {
  const log = [];
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>
    <div id="ah-account-page" class="ah-account-page">
      <div id="ah-sky-flow" hidden></div>
    </div></body></html>`, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
  const w = dom.window;
  // The flow's wake() starts a long-lived interval; track timers so the test
  // can stop them and let the runner exit without --test-force-exit.
  const timers = new Set();
  const setInterval_ = w.setInterval.bind(w);
  w.setInterval = (fn, ms) => { const id = setInterval_(fn, ms); timers.add(id); return id; };
  const stop = () => { for (const id of timers) w.clearInterval(id); timers.clear(); dom.window.close(); };
  // The flow must not touch these; trip a hard failure if it does.
  w.fetch = () => { throw new Error('sky flow must not fetch directly'); };
  w.XMLHttpRequest = function () { throw new Error('sky flow must not XHR directly'); };
  if (withBridge) w.AdmissionSkyBridge = bridge ? bridge(w.document, log) : makeBridge(w.document, log);
  w.eval(JS);
  for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 5));
  return { w, dom, log, stop };
}

const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 5)); };

test('sky-01: the flow fails closed when the bridge is missing', async () => {
  const { w, stop } = await boot({ withBridge: false });
  const opened = await w.AdmissionSkyFlow.open('signup');
  assert.equal(opened, false, 'without the bridge the flow must refuse to open, not pretend success');
  assert.equal(w.document.getElementById('ah-sky-flow').hidden, true, 'nothing may be revealed without the bridge');
  stop();
});

test('sky-02: the flow never reaches the network or keeps its own OTP', () => {
  assert.doesNotMatch(JS, /\bfetch\s*\(/, 'the flow asks the bridge, never the network');
  assert.doesNotMatch(JS, /XMLHttpRequest/, 'the flow must not open a raw request');
  assert.doesNotMatch(JS, /localStorage|sessionStorage/, 'the bridge owns session state, not the flow');
  assert.doesNotMatch(JS, /['"][0-9]{6}['"]/, 'no hardcoded ASCII OTP may survive');
  assert.doesNotMatch(JS, /['"][০-৯]{6}['"]/, 'no hardcoded Bengali OTP may survive');
});

test('sky-03: signup mounts on screen 0 and gates the CTA on the name', async () => {
  const { w, stop } = await boot();
  const opened = await w.AdmissionSkyFlow.open('signup');
  assert.equal(opened, true);
  await settle();
  assert.equal(w.AdmissionSkyFlow.mode, 'signup');
  assert.equal(w.AdmissionSkyFlow.i, 0, 'the flow opens directly on the first screen');
  const cta = w.document.getElementById('sky-cta');
  assert.ok(cta.disabled, 'the CTA starts disabled until the step is valid');
  const name = w.document.getElementById('sky-in-name');
  name.value = 'রাশেল';
  name.dispatchEvent(new w.Event('input'));
  await settle(2);
  assert.equal(cta.disabled, false, 'a valid name enables the CTA');
  stop();
});

test('sky-04: login gates the CTA on a valid email', async () => {
  const { w, stop } = await boot();
  await w.AdmissionSkyFlow.open('login');
  await settle();
  assert.equal(w.AdmissionSkyFlow.mode, 'login');
  const cta = w.document.getElementById('sky-cta');
  const em = w.document.getElementById('sky-lin-em');
  em.value = 'nope';
  em.dispatchEvent(new w.Event('input'));
  await settle(2);
  assert.ok(cta.disabled, 'an invalid email keeps the CTA disabled');
  em.value = 'student@example.com';
  em.dispatchEvent(new w.Event('input'));
  await settle(2);
  assert.equal(cta.disabled, false, 'a valid email enables the CTA');
  stop();
});

test('sky-05: close() conceals through the bridge, not by reaching into the page', async () => {
  const { w, log, stop } = await boot();
  await w.AdmissionSkyFlow.open('signup');
  await settle();
  w.AdmissionSkyFlow.close();
  assert.ok(log.includes('conceal'), 'close must ask the bridge to conceal the flow');
  stop();
});

test('sky-06: the flow never installs an app-wide scroll lock', () => {
  // The old welcome locked html/body with overflow:hidden while a class was
  // present and forgot to release it, which froze the whole app on the
  // dashboard. The sky flow is scoped to #ah-sky-flow, so it must not select
  // html/body at all, and its JS must not write to them.
  const rules = CSS.split('}').filter(rule => rule.includes('{'));
  for (const rule of rules) {
    const selector = rule.slice(0, rule.indexOf('{'));
    assert.ok(!/(^|[\s,>+~])(html|body)([\s,>+~{]|$)/.test(selector),
      `a rule reaches past the flow's host: ${selector.trim().slice(0, 60)}`);
  }
  assert.doesNotMatch(JS, /documentElement\.(classList|style)/, 'the flow must not restyle the document root');
  assert.doesNotMatch(JS, /body\.(classList|style)/, 'the flow must not restyle the body');
  assert.doesNotMatch(JS, /position\s*[:=]\s*['"]?fixed/, 'the flow must not pin the page');
});

test('sky-07: the account shell collapses so the flow cannot land below the fold', () => {
  // Live bug (2026-10-13): the flow is a SIBLING of .ah-account-shell, and the
  // shell kept min-height:100dvh while its own content was hidden. The shell
  // therefore occupied the first viewport and pushed #ah-sky-flow to
  // top:100dvh -- a full screen below the fold. Every element had a non-zero
  // box, so a visibility check passed while the phone showed a blank page.
  const rule = CSS.match(
    /\.ah-account-page\[data-sky-flow="on"\][^{]*\.ah-account-shell[^{]*\{[^}]*\}/g
  ) || [];
  const collapse = rule.find(r => /min-height\s*:\s*0/.test(r));
  assert.ok(collapse, 'a [data-sky-flow="on"] rule must collapse the shell min-height to 0');
  assert.match(collapse, /min-height\s*:\s*0\s*!important/,
    'without !important the later @media(max-width:620px) rule re-asserts min-height:100dvh');
});

test('sky-08: the flow does not double-count the safe-area insets', () => {
  // Live bug (2026-10-13, owner: "next বাটন কোথাও নিচে হারিয়ে গেছে, উপরে
  // আলাদা হয়ে যাচ্ছে"). #ah-sky-flow already carries
  // padding-top/bottom:env(safe-area-inset-*), so its content box is the
  // viewport MINUS the insets. A descendant that adds env(safe-area-inset-*)
  // again, or sizes itself to the raw viewport (var(--vh)), overflows the
  // padded host and is clipped by its overflow:hidden -- on a real iPhone the
  // CTA ended up below the visible area. Chromium headless reports
  // env()=0, so this is invisible to a plain headless check: assert the source.
  const appRule = (CSS.match(/#ah-sky-flow \.app\{[^}]*\}/g) || []).find(r => /height/.test(r));
  assert.ok(appRule, 'the .app rule must declare a height');
  assert.match(appRule, /height\s*:\s*100%/,
    '.app must fill its padded parent (height:100%), not the raw viewport');
  assert.doesNotMatch(appRule, /var\(--vh/,
    'var(--vh) is the raw viewport height; inside the padded host it overflows and clips the CTA');

  // The host is the only element that may read the insets. Its own
  // absolutely-positioned :before/:after overlays are exempt: they sit out of
  // the layout flow, so they cannot push the CTA off screen.
  const insetRules = (CSS.match(/#ah-sky-flow[^{]*\{[^}]*safe-area-inset[^}]*\}/g) || []);
  const offenders = insetRules.filter(r => !/^#ah-sky-flow(::?(before|after))?\s*\{/.test(r.trim()));
  assert.deepEqual(offenders, [],
    `only #ah-sky-flow may consume env(safe-area-inset-*); found: ${offenders.map(r => r.split('{')[0].trim()).join(', ')}`);
});


test('sky-09: the Firebase-link fallback hides the code box and checks the link', async () => {
  // Live bug (2026-10-13, owner): when every OTP provider is spent the Worker
  // sends a Firebase link, but the flow still showed the 6-digit code box -- a
  // form the student can never fill. The link panel must replace it.
  const { w, log, stop } = await boot({ bridge: makeLinkBridge });
  await w.AdmissionSkyFlow.open('login');
  await settle();
  const set = (id, v) => { const el = w.document.getElementById(id); el.value = v; el.dispatchEvent(new w.Event('input')); };
  const cta = () => w.document.getElementById('sky-cta');
  set('sky-lin-em', 'student@example.com');
  await settle(2);
  cta().click(); await settle(4);              // email -> password
  set('sky-lin-pw', 'Str0ngPass!2');
  await settle(2);
  cta().click(); await settle(6);              // password -> doLogin -> method
  cta().click(); await settle(8);              // method -> startOtp (link fallback)
  assert.equal(w.AdmissionSkyFlow.i, 3, 'the flow must be on the verification screen');
  const otp = w.document.getElementById('sky-otp');
  const lk = w.document.getElementById('sky-lk');
  assert.equal(otp.style.display, 'none', 'the code box must be hidden when the link was sent');
  assert.ok(lk.classList.contains('on'), 'the link panel must be revealed');
  cta().click(); await settle(8);              // CTA -> checkLink
  assert.ok(log.includes('checkEmail'), 'the CTA must ask the bridge to check the link');
  assert.ok(log.includes('finish'), 'a verified link must finish the flow');
  stop();
});

test('sky-10: the OTP path still shows the code box when a code was sent', async () => {
  const { w, stop } = await boot();
  await w.AdmissionSkyFlow.open('login');
  await settle();
  const set = (id, v) => { const el = w.document.getElementById(id); el.value = v; el.dispatchEvent(new w.Event('input')); };
  const cta = () => w.document.getElementById('sky-cta');
  set('sky-lin-em', 'student@example.com');
  await settle(2);
  cta().click(); await settle(4);              // email -> password
  set('sky-lin-pw', 'Str0ngPass!2');
  await settle(2);
  cta().click(); await settle(6);              // password -> doLogin -> method
  cta().click(); await settle(8);              // method -> startOtp (real code)
  assert.equal(w.AdmissionSkyFlow.i, 3, 'the flow must be on the verification screen');
  const otp = w.document.getElementById('sky-otp');
  const lk = w.document.getElementById('sky-lk');
  assert.notEqual(otp.style.display, 'none', 'a real code keeps the code box visible');
  assert.ok(!lk.classList.contains('on'), 'the link panel stays hidden on the code path');
  stop();
});

test('sky-11: the back button is available on every step and leaves to the welcome from the first', async () => {
  const { w, log, stop } = await boot();
  await w.AdmissionSkyFlow.open('signup');
  await settle();
  const back = w.document.getElementById('sky-back');
  // The owner (2026-10-15): "back দেওয়া যাচ্ছে না" -- it used to be hidden on
  // the first step and on the method screens. It must be visible from step 0.
  assert.equal(back.classList.contains('hide'), false, 'back is shown on the first step');
  back.dispatchEvent(new w.Event('click'));
  await settle(2);
  assert.ok(log.includes('welcome'), 'back on the first step returns to the welcome');
  stop();
});

test('sky-12: back steps one screen back in the middle of the flow', async () => {
  const { w, stop } = await boot();
  await w.AdmissionSkyFlow.open('signup');
  await settle();
  const name = w.document.getElementById('sky-in-name');
  name.value = 'রাশেল';
  name.dispatchEvent(new w.Event('input'));
  await settle(2);
  w.document.getElementById('sky-cta').dispatchEvent(new w.Event('click'));
  await settle(3);
  assert.equal(w.AdmissionSkyFlow.i, 1, 'the CTA advanced to the second step');
  w.document.getElementById('sky-back').dispatchEvent(new w.Event('click'));
  await settle(3);
  assert.equal(w.AdmissionSkyFlow.i, 0, 'back returned to the previous step');
  stop();
});
