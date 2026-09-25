/* Notification Command Center — shell layout regression guard.
 *
 * Owner bugs:
 * 1. "scroll করলে navigation hide হয়ে যায়" — the sidebar and the mobile tab
 *    bar scrolled away instead of staying pinned.
 * 2. "ড্রাফট সংরক্ষণ / টেস্ট পাঠান / পর্যালোচনা বাটন উপরে চলে আসে" — the
 *    Draft/Test/Review bar drifted up as the page scrolled.
 * 3. "বাটনগুলো স্ক্রিনের ওপর ভেসে থাকছে এবং কন্টেন্ট ওভারল্যাপ করছে" — the
 *    bar was then pinned to the viewport, which floated it over the form.
 *    It now belongs to the normal document flow and is only reached by
 *    scrolling to the end of the composer.
 *
 * Root cause of (1) and (2): `contain: layout` on `.ns-app` / `.ns-view` makes
 * those boxes the containing block for `position: fixed` descendants, and the
 * `.ns-view` fade animation animated `transform` (identity included), which
 * does the same. The bottom bar therefore anchored to the tall page box instead
 * of the viewport. Those contracts still hold and fail if the trap returns.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ADMIN = readFileSync('notification-command-center.html', 'utf8');

test('no ancestor turns the shell into a fixed-position containing block', () => {
  assert.ok(!/\.ns-app\{[^}]*contain:/.test(ADMIN), '.ns-app must not use contain:');
  assert.ok(!/\.ns-view\{[^}]*contain:/.test(ADMIN), '.ns-view must not use contain:');
});

test('the view fade never animates transform', () => {
  const keyframes = ADMIN.slice(ADMIN.indexOf('@keyframes ns-fade'));
  const block = keyframes.slice(0, keyframes.indexOf('}') + 1);
  assert.ok(!/transform/.test(block), 'a transform (even identity) re-anchors fixed children');
});

test('the desktop sidebar stays pinned while the page scrolls', () => {
  const sidebar = ADMIN.slice(ADMIN.indexOf('.ns-sidebar{'));
  const rule = sidebar.slice(0, sidebar.indexOf('}'));
  assert.match(rule, /position:sticky/, 'sidebar is sticky');
  assert.match(rule, /top:0/, 'sidebar is pinned to the top');
  assert.match(rule, /align-self:flex-start/, 'sidebar does not stretch with the flex row');
});

test('the mobile tab bar stays viewport-fixed', () => {
  const mobileNav = ADMIN.slice(ADMIN.indexOf('.ns-mobile-nav{'));
  assert.match(mobileNav.slice(0, mobileNav.indexOf('}')), /position:fixed/, 'tab bar is fixed');
});

test('the composer action bar stays in the normal document flow', () => {
  const actions = ADMIN.slice(ADMIN.indexOf('.ns-sticky-actions{'));
  const rule = actions.slice(0, actions.indexOf('}'));
  assert.match(rule, /position:static/, 'action bar is in flow, not pinned to the viewport');
  assert.ok(!/position:fixed/.test(rule), 'a fixed bar would overlay the composer content');
  assert.ok(!/bottom:calc\(var\(--tabbar-h\)/.test(rule), 'no viewport anchoring');
});
