/* Admin notification panel — mobile keyboard regression guard.
 *
 * Owner bug: on a phone the keyboard dropped after every keystroke in the
 * create form. Cause: each text field's `oninput` called a handler that
 * re-rendered the whole view, replacing the focused <input> and dismissing
 * the on-screen keyboard.
 *
 * The fix keeps typing on <input>/<textarea> bound to `__gnLive`, which only
 * patches the preview nodes in place. `__gnField` (which does re-render)
 * stays reserved for controls where a rebuild is legitimate: the schedule
 * picker and programmatic template application.
 *
 * These are source contracts, not behaviour tests: they fail if someone
 * re-points a text field at the re-rendering handler.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ADMIN = readFileSync('notification-admin.js', 'utf8');
const HUB = readFileSync('notification-hub.js', 'utf8');
const FCM = readFileSync('notification-fcm.js', 'utf8');

/** Every <input>/<textarea> tag in the source, as raw strings. */
const inputTags = () => ADMIN.match(/<(?:input|textarea)\b[^>]*>/g) || [];

test('no text input re-renders on every keystroke', () => {
  const fields = inputTags().filter(tag => /oninput=/.test(tag));
  assert.ok(fields.length >= 4, `expected the create form fields, found ${fields.length}`);
  for (const tag of fields) {
    assert.ok(
      !/__gnField/.test(tag),
      `text field must not re-render on input: ${tag.slice(0, 80)}`
    );
    assert.ok(
      /oninput="window\.__gnLive\(/.test(tag),
      `text field must use the in-place live handler: ${tag.slice(0, 80)}`
    );
  }
});

test('the live handler patches the preview in place and never re-renders', () => {
  const body = ADMIN.slice(ADMIN.indexOf('window.__gnLive ='));
  const live = body.slice(0, body.indexOf('window.__gnField'));
  assert.ok(live.length > 0, '__gnLive definition found');
  assert.ok(!/reRender\(\)/.test(live), '__gnLive must not call reRender');
  assert.ok(!/innerHTML\s*=/.test(live), '__gnLive must not replace DOM subtrees');
  assert.match(live, /getElementById\('gnPrevTitle'\)/, 'updates the preview title');
  assert.match(live, /getElementById\('gnPrevBody'\)/, 'updates the preview body');
});

test('re-rendering handler is kept only for programmatic controls', () => {
  const withField = inputTags().filter(tag => /__gnField/.test(tag));
  assert.equal(withField.length, 1, 'only the schedule picker re-renders');
  assert.match(withField[0], /type="datetime-local"/, 'and it is the datetime control');
  assert.match(ADMIN, /window\.__gnField = \(field, value\) => \{ state\[field\] = value; reRender\(\); \}/);
});

test('template apply and mode/type changes still re-render deliberately', () => {
  for (const fn of ['__gnSetType', '__gnSetAudience', '__gnSetTemplate', '__gnSetMode']) {
    const re = new RegExp(`window\\.${fn} = [^\\n]*reRender\\(\\)`);
    assert.match(ADMIN, re, `${fn} re-renders on purpose`);
  }
});

/* Phase G — the student's daily-reminder switch lives in the same sheet. */
test('the settings sheet mounts a slot for the personalized row', () => {
  assert.match(HUB, /id="ahPersonalRow"/, 'a mount point exists next to the FCM row');
  assert.match(HUB, /AhFcm\?\.personalRow\?\.\(\)/, 'the hub hydrates it from the FCM module');
  assert.match(HUB, /getElementById\('ahPersonalRow'\)/, 'and swaps it in when ready');
});

test('the personalized row reads and writes the session-scoped pref route', () => {
  assert.match(FCM, /const personalRow = async/);
  assert.match(FCM, /boundedFetch\('\/personal-pref'\)/, 'reads the current setting');
  assert.match(FCM, /boundedFetch\('\/personal-pref', \{ method: 'POST'/, 'writes the new setting');
  assert.match(FCM, /personalized_enabled: next/, 'sends the boolean the API expects');
});

test('the toggle is exported and copy is bilingual', () => {
  assert.match(FCM, /personalRow, togglePersonal, devPanel/, 'both are on window.AhFcm');
  assert.match(FCM, /'দৈনিক স্মার্ট রিমাইন্ডার'/, 'bn copy present');
  assert.match(FCM, /'Daily smart reminder'/, 'en copy present');
});
