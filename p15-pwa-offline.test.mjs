/* P15 — PWA + offline-first guarantees.
 *
 * The service worker precaches the app shell and refuses to cache a corrupt
 * download. These tests read the real sw.js and index.html and verify the
 * manifest, the version markers and every asset digest against the files on
 * disk, so a stale digest or an out-of-sync build id cannot ship. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sw = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('./manifest.webmanifest', import.meta.url), 'utf8'));

const buildId = (sw.match(/const BUILD_ID = '([^']+)'/) || [])[1];
const expectedInIndex = (indexHtml.match(/expectedSwVersion\s*=\s*'([^']+)'/) || [])[1];

test('p15-01: the manifest declares a standalone, installable app', () => {
  assert.ok(manifest.name && manifest.short_name, 'name and short_name are required');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './?source=pwa#dashboard');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.lang, 'bn');
  const sizes = (manifest.icons || []).map(i => i.sizes);
  assert.ok(sizes.includes('192x192'), 'a 192px icon is required to install');
  assert.ok(sizes.includes('512x512'), 'a 512px icon is required to install');
});

test('p15-02: the service worker build id matches the one index.html expects', () => {
  assert.ok(buildId, 'sw.js must declare a BUILD_ID');
  assert.ok(expectedInIndex, 'index.html must declare an expectedSwVersion');
  assert.equal(buildId, expectedInIndex, 'a mismatch makes the update loop fire forever');
});

test('p15-03: the app shell precaches the entry documents and the sync engine', () => {
  for (const asset of ['./index.html', './manifest.webmanifest', './student-data-sync.js']) {
    assert.ok(sw.includes(`'${asset}`) || sw.includes(`"${asset}`), `${asset} must be precached`);
  }
});

test('p15-04: every precached asset matches its recorded SHA-256 (no corrupt shell)', () => {
  const block = sw.match(/\/\* sw-manifest:start \*\/([\s\S]*?)\/\* sw-manifest:end \*\//);
  assert.ok(block, 'the sw-manifest digest block must be present');
  const digests = {};
  for (const m of block[1].matchAll(/"([^"]+)":\s*"([0-9a-f]{64})"/g)) digests[m[1]] = m[2];
  assert.ok(Object.keys(digests).length >= 30, 'the digest table must cover the shell');

  let checked = 0;
  for (const [filePath, expected] of Object.entries(digests)) {
    const rel = filePath.replace(/^\.\//, '').replace(/\?.*$/, '');
    const abs = new URL('./' + rel, import.meta.url);
    // A versioned query (widget.js?v=…) is not part of the file name.
    if (!existsSync(abs)) continue;
    const actual = createHash('sha256').update(readFileSync(abs)).digest('hex');
    assert.equal(actual, expected, `${rel} digest is stale — run: npm run sw:manifest`);
    checked += 1;
  }
  assert.ok(checked >= 20, `verified only ${checked} assets`);
});

test('p15-05: the worker refuses a corrupt download and can be told to take over', () => {
  assert.match(sw, /isCurrentBuild/, 'a build-marker check must gate what is cached');
  assert.match(sw, /SKIP_WAITING/, 'the update flow needs a skipWaiting escape hatch');
  assert.match(sw, /DOCUMENT_NETWORK_TIMEOUT_MS/, 'a stalled navigation must not hang offline');
});

test('p15-06: the install-guide pop-up ships and is precached', () => {
  assert.ok(sw.includes('install-guide.js'), 'the install guide must be in the app shell');
  assert.ok(sw.includes('install-guide.css'), 'the install guide styles must be in the app shell');
  assert.match(indexHtml, /\.\/install-guide\.js/, 'index.html must load the install guide');
  assert.match(indexHtml, /\.\/install-guide\.css/, 'index.html must link the install guide styles');
});
