import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://127.0.0.1:8099/';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
await page.goto(base, { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(5000);

const probe = () => page.evaluate(() => {
  const pg = document.getElementById('ah-account-page');
  const host = document.getElementById('ah-sky-flow');
  const views = [...pg.querySelectorAll('[data-view]')].filter(v => !v.hidden).map(v => v.dataset.view);
  const txt = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
  return {
    pageHidden: pg.hidden, currentView: pg.dataset.currentView, skyFlow: pg.dataset.skyFlow || null,
    skyHidden: host ? host.hidden : null, visibleViews: views,
    skyMode: window.AdmissionSkyFlow ? window.AdmissionSkyFlow.mode : null,
    text: txt.slice(0, 110),
  };
});

const steps = [];
steps.push({ step: 'boot', ...await probe() });
await page.screenshot({ path: '/tmp/f1_welcome.png' });

// Click Sign Up on the welcome screen.
const su = await page.$('[data-role="welcome-signup"]');
if (su) { await su.click(); await page.waitForTimeout(2500); }
steps.push({ step: 'clicked Sign Up', ...await probe() });
await page.screenshot({ path: '/tmp/f2_signup.png' });

// Back out of the flow, then try Log In.
await page.evaluate(() => { const p = document.getElementById('ah-account-page'); const h = document.getElementById('ah-sky-flow'); if (h) h.hidden = true; delete p.dataset.skyFlow; p.dataset.currentView = 'welcome'; p.querySelectorAll('[data-view]').forEach(v => { v.hidden = v.dataset.view !== 'welcome'; }); });
await page.waitForTimeout(800);
const li = await page.$('[data-role="welcome-login"]');
if (li) { await li.click(); await page.waitForTimeout(2500); }
steps.push({ step: 'clicked Log In', ...await probe() });
await page.screenshot({ path: '/tmp/f3_login.png' });

console.log(JSON.stringify({ steps, errs: errs.slice(0, 5) }, null, 1));
await browser.close();
