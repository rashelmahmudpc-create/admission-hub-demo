// Visual guard: takes screenshots of key screens and compares them with baseline PNGs.
// Usage: node tests/visual/visual-guard.mjs [--update] [--only=welcome,dashboard]
// Env: VG_ONLY=welcome  VG_THRESHOLD=0.2 (percent)  VG_OUT=tests/visual/output
//      VG_INJECT_CSS=path/inside/repo.css  (self-check: load an extra stylesheet on every page; guard must FAIL)
import http from 'node:http';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, sep, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const BASE_DIR = join(HERE, 'baseline');
const OUT_DIR = resolve(ROOT, process.env.VG_OUT || 'tests/visual/output');
const args = process.argv.slice(2);
const UPDATE = args.includes('--update') || process.env.VG_UPDATE === '1';
const onlyArg = (args.find(a => a.startsWith('--only=')) || '').slice(7) || process.env.VG_ONLY || '';
const ONLY = onlyArg ? onlyArg.split(',').map(s => s.trim()).filter(Boolean) : null;
const THRESHOLD = Number(process.env.VG_THRESHOLD || 0.2); // percent of pixels
const INJECT_CSS = process.env.VG_INJECT_CSS || '';
const CHANNEL_TOL = 32; // per-channel difference ignored (anti-aliasing)

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };

const SCREENS = [
  { name: 'welcome' },
  { name: 'signup-form', open: /^সাইন আপ/ },
  { name: 'signin-form', open: /^সাইন ইন/ },
  { name: 'dashboard', hash: '#dashboard' },
  { name: 'question-bank', hash: '#question-bank' },
  { name: 'exam-center', hash: '#exam' }
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  if (pathname.includes('\0') || pathname.split('/').includes('..')) { res.writeHead(400); return res.end(); }
  const file = resolve(ROOT, `.${pathname}`);
  if (!file.startsWith(ROOT + sep)) { res.writeHead(403); return res.end(); }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not-file');
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }
});

const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function setupContext(browser, origin, loggedIn) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'bn-BD', timezoneId: 'Asia/Dhaka',
    reducedMotion: 'reduce', serviceWorkers: 'block', colorScheme: 'light' });
  await ctx.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin === origin) {
      if (!u.pathname.startsWith('/api/')) return route.continue();
      if (u.pathname === '/api/auth/v1/config') return json(route, 200, { auth: { available: true,
        methods: { emailPassword: { available: true }, passwordReset: { available: true }, google: { available: false },
          passkey: { available: false }, telegramVerification: { available: false }, backup: { available: false } } } });
      if (u.pathname === '/api/auth/v1/session') return loggedIn
        ? json(route, 200, { authenticated: true, emailVerified: true, user: { emailMasked: 's***@example.com' } })
        : json(route, 401, { error: { code: 'SESSION_INVALID' } });
      return json(route, 404, { error: { code: 'NOT_FOUND' } });
    }
    // Outside world: fonts get an empty answer (fast, deterministic), everything else is aborted.
    if (u.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (u.hostname === 'fonts.gstatic.com') return route.fulfill({ status: 404, body: '' });
    return route.abort();
  });
  await ctx.addInitScript(() => {
    let s = 42; Math.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    const css = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';
    const put = () => { const st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', put); else put();
  });
  if (INJECT_CSS) await ctx.addInitScript(href => {
    const add = () => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
  }, '/' + INJECT_CSS.replace(/^\/+/, ''));
  return ctx;
}

async function capture(browser, origin, screen) {
  const loggedIn = Boolean(screen.hash);
  const ctx = await setupContext(browser, origin, loggedIn);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date('2026-10-18T06:00:00Z'));
  let stage = 'goto';
  try {
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
    if (screen.open) {
      stage = 'click #go';
      await page.locator('#go').click({ timeout: 15000 });
      stage = 'click ' + screen.open;
      await page.getByRole('button', { name: screen.open }).first().click({ timeout: 15000 });
      await page.waitForTimeout(2000);
    } else if (loggedIn) {
      stage = 'close account sheet';
      const close = page.locator('.ah-account-close').first();
      await close.waitFor({ state: 'visible', timeout: 10000 }).then(() => close.click()).catch(() => {});
      stage = 'wait splash';
      await page.locator('#ahSkyEntry').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      stage = 'set hash';
      await page.evaluate(h => { location.hash = h; }, screen.hash);
      await page.waitForTimeout(4000);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    } else {
      await page.waitForTimeout(3000);
    }
    stage = 'fonts';
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 3000))])).catch(() => {});
    stage = 'screenshot';
    // Wait until the screen stops changing: two shots 1s apart must be identical (max 10 tries).
    const opts = { animations: 'disabled', caret: 'hide', timeout: 45000 };
    let prev = await page.screenshot(opts);
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000);
      const next = await page.screenshot(opts);
      if (next.equals(prev)) return next;
      prev = next;
    }
    console.log(`WARN ${screen.name}: screen never became stable`);
    return prev;
  } catch (e) {
    e.message = `[${screen.name}] at "${stage}": ${e.message}`;
    throw e;
  } finally { await ctx.close().catch(() => {}); }
}

// Compares two PNGs inside the browser (canvas) so no extra npm package is needed.
async function compare(browser, a, b) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async ({ a, b, tol }) => {
      const load = src => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = 'data:image/png;base64,' + src; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { sizeMismatch: true, percent: 100, a: [ia.width, ia.height], b: [ib.width, ib.height] };
      const w = ia.width, h = ia.height;
      const grab = img => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h); };
      const da = grab(ia), db = grab(ib);
      const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); const out = x.createImageData(w, h);
      let diff = 0;
      for (let i = 0; i < da.data.length; i += 4) {
        const d = Math.max(Math.abs(da.data[i] - db.data[i]), Math.abs(da.data[i + 1] - db.data[i + 1]), Math.abs(da.data[i + 2] - db.data[i + 2]), Math.abs(da.data[i + 3] - db.data[i + 3]));
        if (d > tol) { diff++; out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 0; out.data[i + 3] = 255; }
        else { const g = (da.data[i] + da.data[i + 1] + da.data[i + 2]) / 3; out.data[i] = out.data[i + 1] = out.data[i + 2] = 200 + g / 5; out.data[i + 3] = 255; }
      }
      x.putImageData(out, 0, 0);
      return { percent: (diff / (w * h)) * 100, pixels: diff, diffPng: c.toDataURL('image/png').split(',')[1] };
    }, { a: a.toString('base64'), b: b.toString('base64'), tol: CHANNEL_TOL });
  } finally { await page.close(); }
}

const port = await new Promise((ok, bad) => { server.once('error', bad); server.listen(0, '127.0.0.1', () => ok(server.address().port)); });
const origin = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--font-render-hinting=none', '--disable-lcd-text'] });
await mkdir(BASE_DIR, { recursive: true });
await mkdir(OUT_DIR, { recursive: true });
let failed = 0;
// Warm-up: the very first page load of a cold browser can be slow; do it once and ignore the result.
{ const w = await browser.newPage(); await w.goto(origin + '/', { waitUntil: 'load', timeout: 60000 }).catch(() => {}); await w.close(); }
try {
  for (const screen of SCREENS.filter(s => !ONLY || ONLY.includes(s.name))) {
    const t0 = Date.now();
    const basePath = join(BASE_DIR, `${screen.name}.png`);
    let shot;
    try { shot = await capture(browser, origin, screen); }
    catch (e1) {
      console.log(`RETRY ${screen.name}: ${e1.message.split('\n')[0]}`);
      try { shot = await capture(browser, origin, screen); }
      catch (e) { failed++; console.log(`FAIL ${screen.name} error: ${e.message.split('\n')[0]}`); continue; }
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (UPDATE || !existsSync(basePath)) {
      await writeFile(basePath, shot);
      console.log(`SAVED ${screen.name} baseline (${secs}s)`);
      continue;
    }
    const r = await compare(browser, await readFile(basePath), shot);
    const ok = !r.sizeMismatch && r.percent <= THRESHOLD;
    if (!ok) {
      failed++;
      await writeFile(join(OUT_DIR, `${screen.name}.actual.png`), shot);
      if (r.diffPng) await writeFile(join(OUT_DIR, `${screen.name}.diff.png`), Buffer.from(r.diffPng, 'base64'));
    }
    console.log(`${ok ? 'PASS' : 'FAIL'} ${screen.name} diff=${r.percent.toFixed(3)}%${r.sizeMismatch ? ' (size mismatch)' : ''} (${secs}s)`);
  }
} finally { await browser.close(); server.close(); }
if (failed) { console.log(`visual-guard: ${failed} screen(s) failed`); process.exit(1); }
console.log('visual-guard: all screens OK');
