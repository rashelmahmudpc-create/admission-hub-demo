/* Admin notification panel - mobile keyboard regression guard.
 *
 * Owner bug: on a phone the keyboard dropped after every keystroke in the
 * create form. Cause: each text field's input handler re-rendered the whole
 * view, replacing the focused <input> and dismissing the on-screen keyboard.
 *
 * The command center keeps that fix: text fields dispatch through a delegated
 * data-act listener whose handlers only patch the preview in place
 * (liveUpdate()), never rebuild the composer. Only the datetime control and
 * programmatic template application re-render on purpose.
 *
 * These are source contracts, not behaviour tests: they fail if someone
 * re-points a text field at a re-rendering path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ADMIN = readFileSync('notification-command-center.js', 'utf8');
const ADMIN_CSS = readFileSync('notification-command-center.css', 'utf8');
const HUB = readFileSync('notification-hub.js', 'utf8');
const FCM = readFileSync('notification-fcm.js', 'utf8');

/** Every <input>/<textarea> tag in the source, as raw strings. */
const inputTags = () => ADMIN.match(/<(?:input|textarea)\b[^>]*>/g) || [];

test('every text field patches the composer in place, never re-renders', () => {
  const fields = { title: 'title', body: 'body', titleen: 'titleEn', bodyen: 'bodyEn' };
  for (const [field, prop] of Object.entries(fields)) {
    const re = new RegExp(`${field}: function\\(el\\)\\{ NS\\.state\\.${prop} = el\\.value; scheduleAutosave\\(\\); liveUpdate\\(\\); \\}`);
    assert.match(ADMIN, re, `${field} updates in place`);
  }
});

test('the live path never replaces DOM subtrees', () => {
  const body = ADMIN.slice(ADMIN.indexOf('function liveUpdate(){'));
  const live = body.slice(0, body.indexOf('/* ---------- send'));
  assert.ok(live.length > 0, 'liveUpdate definition found');
  assert.match(live, /getElementById\('nsPreviewHost'\)/, 'patches the preview host');
  assert.match(live, /getElementById\('nsBodyCount'\)/, 'patches the body counter');
  assert.ok(!/getElementById\('nsTitle'\)[\s\S]*innerHTML\s*=/.test(live), 'does not rebuild the title input');
});

test('the composer inputs are addressable by the in-place handlers', () => {
  const fields = inputTags().filter(tag => /data-act="(title|body|titleen|bodyen)"/.test(tag));
  assert.ok(fields.length >= 4, `expected the composer fields, found ${fields.length}`);
  assert.match(ADMIN, /id="nsPreviewHost"/, 'preview host is addressable');
  assert.match(ADMIN, /id="nsTitle"/, 'title input is addressable');
});

test('the send sheet stays above the on-screen keyboard', () => {
  /* The sheet is position:fixed, so it is laid out against the full viewport.
   * Without the keyboard inset its card centres behind the keyboard and the
   * focused field cannot be reached. */
  assert.match(ADMIN_CSS, /var\(--keyboard-inset/, 'the sheet reserves the keyboard height');
  assert.match(ADMIN_CSS, /max-height:calc\(92dvh - var\(--keyboard-inset\)\)/, 'the card is bounded by the keyboard');
  assert.match(ADMIN_CSS, /overflow-y:auto/, 'and can scroll when the card is taller than the space');
  assert.match(ADMIN, /setProperty\('--keyboard-inset'/, 'the inset is fed from the visual viewport');
});

/* Phase G - the student's daily-reminder switch lives in the same sheet. */
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
