/* P19 — the Core Web Vitals audit, pinned as a static budget.
 *
 * A live Lighthouse run needs the deployed site and a network; these assertions
 * catch the regressions that a live run would catch, from the source alone:
 * a welcome asset that is not preloaded (the browser discovers it late and the
 * hero paints after a second round trip), a preload whose version has drifted
 * from the loader's (the preload is wasted and the fetch is paid twice), or a
 * welcome asset missing from the service-worker shell (an offline start falls
 * back to the network).
 *
 * Measured on the live site 2026-10-11 (mobile viewport, cold cache):
 *   FCP 728ms · TTFB 110ms · CLS 0.015 (good)
 *   LCP 4488ms (poor — the largest paint is the welcome hero button, and the
 *   welcome stylesheet/script were not discovered until app-seed parsed:
 *   app-seed started at 232ms, the welcome CSS at 650ms, the JS at 712ms).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const INDEX = readFileSync('index.html', 'utf8');
const SEED = readFileSync('app-seed.js', 'utf8');
const BUILD = readFileSync('scripts/build-welcome-pages.mjs', 'utf8');
const SW = readFileSync('sw.js', 'utf8');

/** The version app-seed stamps onto the welcome assets it injects. */
function seedVersion() {
  const m = SEED.match(/version\s*=\s*'([^']+)'/);
  assert.ok(m, 'app-seed.js must declare a welcome asset version');
  return m[1];
}

test('p19p-১: the welcome stylesheet and script are preloaded from the document head', () => {
  assert.ok(/<link rel="preload" as="style" href="\.\/welcome-onboarding\.css\?v=/.test(INDEX),
    'the welcome stylesheet must be preloaded: app-seed injects it at runtime, so without the hint it is discovered late');
  assert.ok(/<link rel="preload" as="script" href="\.\/welcome-onboarding\.js\?v=/.test(INDEX),
    'the welcome script must be preloaded for the same reason');
});

test('p19p-২: the preload version matches the version app-seed actually requests', () => {
  const version = seedVersion();
  for (const ext of ['css', 'js']) {
    const hint = INDEX.match(new RegExp(`welcome-onboarding\\.${ext}\\?v=([^"']+)`));
    assert.ok(hint, `the ${ext} preload hint must exist`);
    assert.equal(hint[1], version,
      `the ${ext} preload version must equal app-seed's version, or the preload downloads a URL nothing requests`);
  }
});

test('p19p-৩: the build script keeps the preload hints in step with the version', () => {
  assert.ok(/welcome-onboarding\\\.\(css\|js\)\\\?v=/.test(BUILD) || BUILD.includes('welcome-onboarding\\.(css|js)?v='),
    'the build script must rewrite the preload hint versions alongside the loader');
  assert.ok(BUILD.includes("Expected the welcome preload hints in index.html"),
    'the build script must fail loudly if the hints are missing, not silently skip them');
});

test('p19p-৪: the build script puts the welcome assets in the service-worker app shell', () => {
  /* The source sw.js does not list them; scripts/build-welcome-pages.mjs adds
     them to APP_SHELL at build time, so the deployed shell has them. Assert the
     build script does that, and that it targets the shell it ships. */
  const additions = BUILD.match(/const additions=\[([^\]]+)\]/);
  assert.ok(additions, 'the build script must declare the welcome shell additions');
  for (const asset of ['app-seed.js', 'welcome-onboarding.css', 'welcome-onboarding.js', 'welcome-onboarding.html']) {
    assert.ok(additions[1].includes(asset), `${asset} must be added to the app shell at build time`);
  }
  assert.ok(BUILD.includes("const APP_SHELL = ["), 'the additions must be spliced into APP_SHELL, not some other array');
  assert.ok(SW.includes('const APP_SHELL = ['), 'sw.js must still carry the shell the build script edits');
});

test('p19p-৫: the hero button lights without waiting on the story to finish', () => {
  const JS = readFileSync('welcome-onboarding.js', 'utf8');
  assert.ok(/at\(2600,\(\)=>\$\('sky-go'\)\?\.classList\.add\('lit'\)\)/.test(JS),
    'the Get Started light-up must be timed from the first frame at 2.6s, not from the end of the story');
});

test('p19p-৬: the preload hints sit in the head, before the stylesheets that follow', () => {
  const headEnd = INDEX.indexOf('</head>');
  const preloadAt = INDEX.indexOf('welcome-onboarding.css?v=');
  const bodyAt = INDEX.indexOf('<body');
  assert.ok(preloadAt > 0 && headEnd > 0 && bodyAt > 0);
  assert.ok(preloadAt < headEnd, 'a preload in the body is discovered as late as the asset it is meant to speed up');
  assert.ok(headEnd < bodyAt, 'the head must close before the body');
});
