// current-shell/chatv14-guest — iPhone fast-start + single-frame composer + full AI response guard
import { readFileSync } from 'node:fs';

const H = readFileSync('index.html', 'utf8');
const DP = readFileSync('data-protection.js', 'utf8');
const SW = readFileSync('sw.js', 'utf8');
const DASH = readFileSync('dashboard-v2.js', 'utf8');
const AI = readFileSync('ai-agent-chat.js', 'utf8');
let pass = 0;
let fail = 0;
function test(name, condition) {
  if (condition) { pass += 1; console.log('  ✓', name); }
  else { fail += 1; console.error('  ✗', name); }
}

const bootBlock = (H.match(/async function boot\(\)\{[\s\S]*?\n\}/) || [''])[0];
const coordinator = (H.match(/const startFinalRender = \(options\) => \{[\s\S]*?else modulesParsed\(\);/) || [''])[0];
const appShellBlock = (SW.match(/const APP_SHELL = \[[\s\S]*?\n\];/) || [''])[0];
const shellAssets = [...appShellBlock.matchAll(/^\s*['"]\.\/[^'"]+['"],?$/gm)].length;
const dashboardTag = H.indexOf('./dashboard-v2.js?v=dash2f16-avatar-cache');
const firstOptionalTag = H.indexOf('qbank-redesign.js?v=practice15');

/* Startup deadline and race fix */
test('১. unwanted slow/recovery screen text is absent from production HTML',
  !H.includes('একটু বেশি সময় লাগছে') && !H.includes('showGentleRecovery') && !H.includes('showStorageRecovery'));
test('২. watchdog opens a normal usable shell before 5 seconds',
  /__admissionSplashWatchdog=setTimeout\(openUsableShell,(\d+)\)/.test(H) && Number((H.match(/__admissionSplashWatchdog=setTimeout\(openUsableShell,(\d+)\)/) || [])[1]) <= 4500 && H.includes('data-admission-usable="true"'));
test('৩. boot no longer lies that deferred modules are ready',
  bootBlock.includes("window.__admissionFinalModulesReady=false") && !bootBlock.includes("window.__admissionFinalModulesReady=true"));
test('৪. boot-ready and dashboard-ready can each trigger final render without window.load',
  coordinator.includes("window.addEventListener('admission:boot-ready',startFinalRender)") && coordinator.includes("document.addEventListener('DOMContentLoaded',modulesParsed") && DASH.includes('window.__admissionDashboardModuleReady = true'));
test('৫. dashboard first-interaction module is ordered before optional tools', dashboardTag > -1 && dashboardTag < firstOptionalTag);
test('৫a. later phase12 code cannot replace dashboard-v2 with another loader',
  readFileSync('phase12-ui.js', 'utf8').includes('if (!window.__dashboardV2Installed)'));
test('৫b. startup has no retired identity gate or token-dependent paint',
  !/ahAuthGate|ahPubToken|premium-auth|accounts\.google\.com/.test(H));
test('৬. stalled Safari IndexedDB open is bounded at 3 seconds and never clears data',
  H.includes("openTimer=window.setTimeout(()=>fail(new Error('IndexedDB open timed out; existing data was left untouched')),3000)") && !bootBlock.includes('dbClear('));
test('৭. startup readonly reads bypass the write queue and can run together', H.includes("return mode==='readonly' ? execute() : queueDb(execute)"));
test('৮. settings normalization is deferred off first paint', H.includes('Deferred settings normalization skipped.') && H.includes("requestIdleCallback(persist,{timeout:6000})"));
test('৯. removed-route cleanup is UI-only and no longer purges vocabulary/settings/progress',
  !H.includes('purgeRemovedData') && !H.includes("dbClear('vocabulary')") && H.includes('Removed feature data is deliberately retained'));

/* Data-protection startup cost */
const prepareBlock = (DP.match(/async function prepareOpen[\s\S]*?\n  \}/) || [''])[0];
test('১০. prepareOpen is metadata-only (no IndexedDB snapshot/health scan)',
  prepareBlock.includes('readSnapshots()') && !prepareBlock.includes('await snapshot(') && !prepareBlock.includes('localStorageHealth()'));
test('১১. protection snapshot runs as idle post-boot work',
  DP.includes("global.addEventListener('admission:boot-ready', scheduleBootSnapshot") && DP.includes('requestIdleCallback(run, { timeout: 12000 })'));

/* PWA lifecycle */
test('১২. build/cache/static-Welcome and main-app AI versions are synchronized',

  (() => {
    const m = H.match(/const expectedSwVersion = '([^']+)'/);
    const build = m && m[1];
    return Boolean(build) && SW.includes(`const BUILD_ID = '${build}'`) && H.includes(`sw.js?v=${build}`);
  })() &&
  /* The shell must precache the exact account-access build the page loads; a
     drift here silently leaves the offline shell on an older UI (found during
     the 2026-10-12 audit: shell pinned v…-static-welcome-lock3 while the page
     loaded v…-kbsafe1). */
  (() => {
    const loaded = H.match(/account-access\.(?:css|js)\?v=([^"']+)/);
    return Boolean(loaded) && SW.includes(`account-access.css?v=${loaded[1]}`) && SW.includes(`account-access.js?v=${loaded[1]}`);
  })() &&
  H.includes('ai-agent-chat.js?v=agent-f1-ui-p06chat') && SW.includes('ai-agent-chat.js?v=agent-f1-ui-p06chat'));
test('১৩. service-worker activation never navigates or reloads open clients',
  !SW.includes('c.navigate(c.url)') && !SW.includes("self.clients.matchAll({ type: 'window', includeUncontrolled: true });\n      for"));
test('১৪. installed PWA serves the current-build shell instantly, then revalidates; a first visit is never aborted on a timer',
  SW.indexOf('if (isDocumentRequest(request)) {') < SW.indexOf('const staticAsset =') &&
  /* current-build shell is the SAME build, so serving it cannot show an old UI */
  SW.includes("const shell = await caches.match('./index.html');") &&
  SW.includes('event.waitUntil(') &&
  /* a slow-but-working first navigation must not be aborted and handed the splash */
  !SW.includes('controller.abort(), DOCUMENT_NETWORK_TIMEOUT_MS') &&
  SW.includes('return offlineFallback(request);'));
test('১৪খ. a route whose tool script lands late recovers itself — no dead "লোড হয়নি" card',
  H.includes('function waitForRenderer(') &&
  H.includes("const LAZY_RENDERER = { ai: 'renderAiAgentPage'") &&
  H.includes("waitForRenderer('my-profile', () => typeof window.renderProfilePage === 'function')") &&
  H.includes('if (Router.path === path) render();'));
test('১৫. precache stays lean because code-native entry pages add no raster assets',
  /* Bound tracks the hand-curated APP_SHELL list. It grew from 33 → 37 when the
     P16 accessibility core landed, then 37 → 39 with the P15 offline status
     pill, then 39 → 41 with the two P17 study-plan assets, then 41 → 43 with the two P18 admission-intelligence assets, then 43 → 44
     with the P18 official question-pattern dataset. The
     point of the ceiling is to catch an accidental bulk import, not to pin an
     exact size. */
  shellAssets > 0 && shellAssets <= 44 && !appShellBlock.includes('result-analysis-500.js') && !appShellBlock.includes("  '',"));
test('১৬. PWA updates are in-place; active worker is never unregistered first', !H.includes('registration.unregister()'));

/* AI composer and response */
test('১৭. contenteditable has no independent iOS frame',
  AI.includes(':focus-visible:not(.ai-editor)') && AI.includes('.ai-agent-root .ai-editor:focus-visible{outline:0!important') && AI.includes('-webkit-appearance:none;appearance:none'));
test('১৮. rich and plain AI messages render their complete bodies directly',
  AI.includes("const inner = respRender(blocks, { idx });") && AI.includes('bodyHtml = md(esc(m.text));'));
test('১৯. AI response/code collapse implementation and label are completely absent',
  !AI.includes('ai-rb-fold') && !AI.includes('ai-code-fold') && !AI.includes('respFold(') && !AI.includes('সম্পূর্ণ দেখুন') && !AI.includes('Expand full response'));
test('২০. long code stays fully visible while copy header remains',
  AI.includes("return '<div class=\"ai-code\">' + head + body + '</div>';") && !AI.includes('if (n > 18)'));

console.log(`\nFAST-START + AI REGRESSION: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
