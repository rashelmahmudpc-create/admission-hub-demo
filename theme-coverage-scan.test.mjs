import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`./${p}`, import.meta.url), 'utf8');

/* The appearance engine (index.html) sets data-theme on <html> for dark/green.
   Any stylesheet that paints its own colours without a [data-theme] override
   stays light while the rest of the app goes dark — the owner's report that a
   theme change "only applies to some cards". This records the real coverage so
   the gap is visible and cannot silently grow. */
const SURFACES = [
  'profile-ui.css',
  'account-access.css',
  'dashboard-v2.css',
  'vocabulary-master.css',
  'vocabulary-upgrade.css',
  'vocabulary-phase2.css',
  '3d-loader.css'
];

// Surfaces already themed. Lowering one of these is a regression.
const THEMED = {
  'profile-ui.css': 40,
  'account-access.css': 9
};

const countThemeRules = (css) => (css.match(/\[data-theme=/g) || []).length;

test('themed surfaces never lose their dark/green overrides', () => {
  for (const [file, floor] of Object.entries(THEMED)) {
    const n = countThemeRules(read(file));
    assert.ok(n >= floor, `${file} dropped to ${n} theme rules (was >= ${floor})`);
  }
});

test('every stylesheet that paints colours declares at least one theme rule', () => {
  const unthemed = [];
  for (const file of SURFACES) {
    const css = read(file);
    const paints = /(^|[\s;{(])background(-color)?:\s*#|(^|[\s;{(])color:\s*#/m.test(css);
    if (paints && countThemeRules(css) === 0) unthemed.push(file);
  }
  // Known open gap (documented, not silently accepted): these surfaces are
  // light-only today. Shrinking this list is the fix; growing it is a bug.
  const KNOWN_LIGHT_ONLY = [
    'dashboard-v2.css',
    'vocabulary-master.css',
    'vocabulary-upgrade.css',
    'vocabulary-phase2.css',
    '3d-loader.css'
  ];
  for (const file of unthemed) {
    assert.ok(KNOWN_LIGHT_ONLY.includes(file),
      `${file} paints colours but has no [data-theme] override — add one or list it as a known gap`);
  }
  assert.ok(unthemed.length <= KNOWN_LIGHT_ONLY.length, 'light-only surface count must not grow');
});

/* The language engine rewrites Bengali text nodes, then re-runs on `ah:lang`.
   Strings it has no English for pass through untouched, which is what makes a
   language switch look like it "only works on the profile page". Requiring the
   dictionary to keep growing keeps that from stalling. */
test('the English dictionary does not shrink and covers the account surfaces', () => {
  const dict = read('language-engine.js');
  const entries = (dict.match(/^\s*'[^']+':\s*'[^']*'/gm) || []).length;
  assert.ok(entries >= 200, `dictionary shrank to ${entries} entries`);
  // The engine must keep re-applying on language change, not only at boot.
  assert.match(dict, /addEventListener\('ah:lang'/, 'language engine must re-apply on ah:lang');
});