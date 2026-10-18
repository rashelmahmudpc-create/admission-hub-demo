// Visual guard: screenshots 6 key screens and compares them to tests/visual/baseline/*.png.
// Usage: node tests/visual/visual-guard.mjs [--update]   (env SCREENS=welcome,dashboard to run a subset)
// VG_INJECT_CSS=file.css adds extra CSS to every page (self-check); VG_OUT=dir changes the output folder.
// Fails when more than 0.2% of pixels differ. Diff/actual images go to tests/visual/output/.
import http from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve, sep, join } from 'node:path';
import { chromium, devices } from 'playwright-core';

const ROOT = process.cwd();
const DIR = join(ROOT, 'tests/visual');
const BASE = join(DIR, 'baseline');
const OUT = process.env.VG_OUT ? resolve(ROOT, process.env.VG_OUT) : join(DIR, 'output');
const INJECT = process.env.VG_INJECT_CSS ? await readFile(resolve(ROOT, process.env.VG_INJECT_CSS), 'utf8') : '';
const UPDATE = process.argv.includes('--update');
const LIMIT = Number(process.env.VISUAL_LIMIT || 0.2); // percent
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json' };

let loggedIn = false;
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/api/auth/v1/config') return json(res, 200, { auth: { available: true, methods: {
    emailPassword: { available: true }, passwordReset: { available: true }, profile: { available: true },
    google: { available: false }, passkey: { available: false }, telegramVerification: { available: false }, backup: { available: false } },
    verificationEmail: { resendCooldownSeconds: 0 } } });
  if (url.pathname === '/api/auth/v1/session') return loggedIn
    ? json(res, 200, { authenticated: true, emailVerified: true, user: { emailMasked: 's***@example.com' } })
    : json(res, 401, { error: { code: 'SESSION_INVALID' } });
  if (url.pathname.startsWith('/api/')) return json(res, 404, { error: { code: 'NOT_FOUND' } });
  const p = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  if (p.includes('\0') || p.split('/').includes('..')) { res.writeHead(400); return res.end(); }
  const file = resolve(ROOT, `.${p}`);
  if (!file.startsWith(ROOT + sep)) { res.writeHead(403); return res.end(); }
  try {
    if (!(await stat(file)).isFile()) throw 0;
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }
});

const FREEZE = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function openApp(page, origin) {
  await page.goto(origin + '/', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1500);
}
async function startFlow(page, label) {
  await page.locator('#go').first().click({ timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: label }).first().click({ timeout: 15000 });
  await page.waitForTimeout(1500);
}
async function enterApp(page, origin, hash) {
  await openApp(page, origin);
  const close = page.locator('.ah-account-close').first();
  if (await close.count()) await close.click({ timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('#ahSkyEntry'), null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(h => { location.hash = h; }, hash);
  await page.waitForTimeout(4000);
}

const SCREENS = {
  'welcome':       { auth: false, run: (p, o) => openApp(p, o) },
  'signup-form':   { auth: false, run: async (p, o) => { await openApp(p, o); await startFlow(p, /^সাইন আপ/); } },
  'signin-form':   { auth: false, run: async (p, o) => { await openApp(p, o); await startFlow(p, /^সাইন ইন/); } },
  'dashboard':     { auth: true,  run: (p, o) => enterApp(p, o, '#dashboard') },
  'question-bank': { auth: true,  run: (p, o) => enterApp(p, o, '#question-bank') },
  'exam-center':   { auth: true,  run: (p, o) => enterApp(p, o, '#exam') },
};

// Pixel compare inside the browser (no extra npm packages). Channel tolerance 24/255 ignores anti-alias noise.
async function compare(page, aB64, bB64) {
  return page.evaluate(async ([a, b]) => {
    const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'data:image/png;base64,' + src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
    const px = img => { const c = new OffscreenCanvas(w, h), x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const da = px(ia), db = px(ib);
    const out = new OffscreenCanvas(w, h), ox = out.getContext('2d'), od = ox.createImageData(w, h);
    let bad = 0;
    for (let i = 0; i < da.length; i += 4) {
      const diff = Math.abs(da[i] - db[i]) > 24 || Math.abs(da[i + 1] - db[i + 1]) > 24 || Math.abs(da[i + 2] - db[i + 2]) > 24 || Math.abs(da[i + 3] - db[i + 3]) > 24;
      if (diff) { bad++; od.data[i] = 255; od.data[i + 3] = 255; } else { const g = (da[i] + da[i + 1] + da[i + 2]) / 3 * 0.3 + 178; od.data[i] = od.data[i + 1] = od.data[i + 2] = g; od.data[i + 3] = 255; }
    }
    ox.putImageData(od, 0, 0);
    const blob = await out.convertToBlob({ type: 'image/png' });
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { percent: bad / (w * h) * 100, sizeChanged: ia.width !== ib.width || ia.height !== ib.height, diff: btoa(s) };
  }, [aB64, bB64]);
}

const pick = (process.env.SCREENS || Object.keys(SCREENS).join(',')).split(',').map(s => s.trim()).filter(Boolean);
await mkdir(BASE, { recursive: true }); await mkdir(OUT, { recursive: true });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://localhost:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--font-render-hinting=none', '--disable-lcd-text'] });
let failed = 0;
try {
  for (const name of pick) {
    const s = SCREENS[name]; if (!s) { console.log(`?? unknown screen ${name}`); failed++; continue; }
    loggedIn = s.auth;
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'bn-BD', timezoneId: 'Asia/Dhaka', reducedMotion: 'reduce', serviceWorkers: 'block' });
    // Outside network: Google Fonts get an empty answer (so document.fonts never waits), everything else is aborted.
    await ctx.route(u => !u.href.startsWith(origin) && !u.href.startsWith('data:') && !u.href.startsWith('blob:'), route => {
      const h = new URL(route.request().url()).hostname;
      if (h === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      if (h === 'fonts.gstatic.com') return route.fulfill({ status: 404, body: '' });
      return route.abort();
    });
    await ctx.addInitScript(() => { Math.random = (() => { let x = 42; return () => (x = (x * 16807) % 2147483647) / 2147483647; })(); });
    if (INJECT) await ctx.addInitScript(css => document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    }), INJECT);
    const page = await ctx.newPage();
    const t0 = Date.now();
    try {
      await s.run(page, origin);
      await page.addStyleTag({ content: FREEZE });
      await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 3000))]));
      await page.waitForTimeout(300);
      const shot = await page.screenshot({ animations: 'disabled', caret: 'hide', timeout: 20000 });
      const basePath = join(BASE, `${name}.png`);
      if ((UPDATE || !existsSync(basePath)) && !INJECT) {
        await writeFile(basePath, shot);
        console.log(`SAVED ${name} (${Date.now() - t0}ms)`);
      } else {
        const r = await compare(page, (await readFile(basePath)).toString('base64'), shot.toString('base64'));
        const ok = !r.sizeChanged && r.percent <= LIMIT;
        if (!ok) { failed++; await writeFile(join(OUT, `${name}-actual.png`), shot); await writeFile(join(OUT, `${name}-diff.png`), Buffer.from(r.diff, 'base64')); }
        console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${r.percent.toFixed(3)}%${r.sizeChanged ? ' (size changed)' : ''} (${Date.now() - t0}ms)`);
      }
    } catch (e) {
      failed++; console.log(`ERROR ${name}: ${String(e.message || e).split('\n')[0]}`);
      await page.screenshot({ path: join(OUT, `${name}-error.png`), timeout: 5000 }).catch(() => {});
    }
    await ctx.close();
  }
} finally { await browser.close(); server.close(); }
console.log(failed ? `\nVISUAL GUARD: ${failed} problem(s)` : '\nVISUAL GUARD: all good');
process.exit(failed ? 1 : 0);
