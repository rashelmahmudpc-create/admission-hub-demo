/* Notification Command Center — mobile keyboard regression guard.
 *
 * Owner bug: on a phone the keyboard dropped after every keystroke in the
 * create form. Cause (old panel): each text field's `oninput` re-rendered the
 * whole view, replacing the focused <input> and dismissing the on-screen
 * keyboard.
 *
 * The v2 Command Center keeps typing in place: `input` events only patch the
 * compose side panels via refreshPreviewOnly(), and the visualViewport inset is
 * tracked so sheets sit above the keyboard.
 *
 * These are source contracts, not behaviour tests: they fail if someone
 * re-points a text field at a full re-render.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ADMIN = readFileSync('notification-command-center.html', 'utf8');
const HUB = readFileSync('notification-hub.js', 'utf8');
const FCM = readFileSync('notification-fcm.js', 'utf8');

test('text fields are addressable and never re-render the whole compose view', () => {
  for (const field of ['title', 'body', 'imageUrl', 'targetUrl']) {
    assert.match(ADMIN, new RegExp(`data-field="${field}"`), `${field} is addressable`);
  }
  /* The keyboard-bearing fields must not be bound to a full render(). */
  const composeForm = ADMIN.slice(ADMIN.indexOf('function composeHTML'), ADMIN.indexOf('function rulesSummary'));
  assert.ok(!/oninput="[^"]*render\(\)/.test(composeForm), 'no text field re-renders on input');
});

test('the input handler patches the side panels in place and never re-renders', () => {
  const body = ADMIN.slice(ADMIN.indexOf('function refreshPreviewOnly()'));
  const fn = body.slice(0, body.indexOf('\nfunction ', 10));
  assert.match(fn, /querySelectorAll\('\.ns-compose-side'\)/, 'targets only the side panels');
  assert.ok(!/render\(\)/.test(fn), 'refreshPreviewOnly never calls render()');
  assert.match(ADMIN, /refreshPreviewOnly\(\); return;/, 'the input dispatch refreshes in place');
});

test('the composer keeps the keyboard inset in sync', () => {
  assert.match(ADMIN, /function initKeyboard\(\)/, 'visualViewport keyboard handling exists');
  assert.match(ADMIN, /visualViewport/, 'uses the visual viewport');
  assert.match(ADMIN, /--keyboard-inset/, 'computes the keyboard inset');
  assert.match(ADMIN, /scrollIntoView/, 'scrolls the focused field into view');
});

/* Phase G — the student's daily-reminder switch lives in the hub sheet. */
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