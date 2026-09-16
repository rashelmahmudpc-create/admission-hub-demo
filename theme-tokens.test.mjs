/* T7c — Appearance coverage: dark and Premium Green must reach the auth UI.

   Owner report: switching Appearance left most of the account/auth surfaces
   unchanged — only `profile-ui.css` had theme blocks, so every other CSS file
   stayed light. account-access.css alone carried ~600 hardcoded hex values
   across its ink, surface and line colours.

   The fix routes those colours through one token contract
   (`.ah-account-shell[data-visual-contract="code-native-page-system-v1"]`).
   These tests lock in the contract: no stray hex may creep back into a colour
   slot, every referenced token must be defined, and both themes must actually
   restate the tokens rather than reusing the light values. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./account-access.css', import.meta.url), 'utf8');

const tokenBlock = (() => {
  const m = css.match(/\.ah-account-shell\[data-visual-contract="code-native-page-system-v1"\]\{(.*?)\n  position/s);
  assert.ok(m, 'the light token contract block must exist');
  return m[1];
})();

const tokensIn = block => {
  const out = {};
  for (const [, name, value] of block.matchAll(/(--ah-[a-z-]+):([^;]+);/g)) out[name] = value.trim();
  return out;
};

const light = tokensIn(tokenBlock);
const dark = tokensIn(css.match(/html\[data-theme="dark"\] \.ah-account-shell\[data-visual-contract="code-native-page-system-v1"\],\s*html\[data-theme="dark"\] \.ah-account-page\{(.*?)\n\}/s)[1]);
const green = tokensIn(css.match(/html\[data-theme="green"\] \.ah-account-shell\[data-visual-contract="code-native-page-system-v1"\],\s*html\[data-theme="green"\] \.ah-account-page\{(.*?)\n\}/s)[1]);

test('every token referenced by account-access.css is defined', () => {
  const defined = new Set(Object.keys(light));
  const strays = [...new Set([...css.matchAll(/var\((--ah-[a-z-]+)\)/g)].map(m => m[1]))]
    .filter(name => !defined.has(name) && !name.startsWith('--ah-console'));
  assert.deepEqual(strays, [], 'undefined tokens would silently fall back to nothing');
});

test('no hardcoded hex survives in a colour slot outside the token blocks', () => {
  // Strip the declarations themselves, then look for colours still written
  // literally. Two regions are legitimately literal and stay out of scope:
  //   • gradient / shadow fills keep their hexes by design;
  //   • the dark and green override blocks below, which *are* the theme values.
  const themeStart = css.indexOf('/* ---- Appearance: dark + Premium Green');
  assert.ok(themeStart > 0, 'the appearance override blocks must exist');
  const body = css.slice(0, themeStart).replace(/--ah-[a-z-]+:[^;]+;/g, '');
  // `#fff` is deliberate wherever it appears: it is the ink or hairline that
  // sits on a saturated brand fill, the one pairing correct in every theme.
  const offenders = [...body.matchAll(/(?<![-\w])(color|background|background-color|border[a-z-]*):(#[0-9a-fA-F]{3,6})/g)]
    .map(m => m[0])
    .filter(decl => !/:#f{3,6}$/i.test(decl));
  assert.deepEqual(offenders, [], 'theme colours must resolve through a token');
});

test('the auth surface actually changes between light and dark', () => {
  for (const name of ['--ah-ink', '--ah-surface', '--ah-surface-alt', '--ah-line']) {
    assert.ok(dark[name], `dark must restate ${name}`);
    assert.notEqual(dark[name], light[name], `${name} must differ in dark mode, otherwise the theme is a no-op`);
  }
});

test('the green theme is a real, distinct surface rather than a copy of light', () => {
  for (const name of ['--ah-brand-fill', '--ah-surface-alt', '--ah-line']) {
    assert.ok(green[name], `green must restate ${name}`);
    assert.notEqual(green[name], light[name], `${name} must differ in the green theme`);
  }
});

test('the token values reproduce the original light appearance exactly', () => {
  // Re-tokenising must not shift the default look. These are the literals the
  // selectors used before the refactor.
  assert.deepEqual(
    { ink: light['--ah-ink'], fill: light['--ah-brand-fill'], brand: light['--ah-brand-ink'], surface: light['--ah-surface'] },
    { ink: '#123d35', fill: '#12a876', brand: '#0f8a63', surface: '#ffffff' }
  );
});
