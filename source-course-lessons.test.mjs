/* Phase 2 M2 — lesson instrumentation on the live course surface.
 *
 * `source-course-tool.js` loads a supplied course document and mirrors the
 * source's OWN lesson UI onto the analytics bus. These tests boot the real tool
 * against the real sandhi course HTML (not a stub), so the selectors
 * (`section.lesson-sec`, `button.done-btn[data-lesson]`) are the ones students
 * actually get. A rename in the course HTML fails here, not silently in GA4.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const TOOL = readFileSync(new URL('./source-course-tool.js', import.meta.url), 'utf8');
const COURSE_HTML = readFileSync(new URL('./courses/sandhi/index.html', import.meta.url), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(predicate, label, timeout = 3000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = predicate();
    if (value) return value;
    await sleep(5);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function boot(route = 'source-courses/sandhi') {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"><div class="page"><div class="topbar"></div></div></div></body></html>', {
    url: `https://admissionhub.pages.dev/#${route}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.activities = [];
  window.addEventListener('admission:activity', e => window.activities.push(e.detail));
  window.navigate = () => {};
  window.renderShell = (html) => {
    const page = window.document.querySelector('#app .page');
    page.innerHTML = `<div class="topbar"></div>${html}`;
  };
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/courses/sandhi/')) return { ok: true, status: 200, text: async () => COURSE_HTML };
    return { ok: false, status: 404, text: async () => '' };
  };
  window.eval(TOOL);
  assert.ok(window.renderSourceCourseTool, 'tool must install its renderer');
  window.renderSourceCourseTool();
  return window;
}

const typesOf = (window, type) => window.activities.filter(a => a.type === type);
const clickOn = (window, el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

test('m2-1: opening a source course fires course_view and course_start once', async () => {
  const window = await boot();
  assert.equal(typesOf(window, 'COURSE_VIEW').length, 1);
  assert.equal(typesOf(window, 'COURSE_START').length, 1);
  assert.equal(typesOf(window, 'COURSE_VIEW')[0].courseId, 'sandhi-exact-native-v1');
});

test('m2-2: the real course HTML exposes the lesson selectors this feature depends on', () => {
  const dom = new JSDOM(COURSE_HTML);
  const doc = dom.window.document;
  const sections = doc.querySelectorAll('section.lesson-sec[id]');
  const buttons = doc.querySelectorAll('.done-btn[data-lesson]');
  assert.ok(sections.length >= 8, `expected the sandhi lessons, found ${sections.length}`);
  assert.equal(buttons.length, sections.length, 'every lesson section has its "পড়া শেষ" button');
  /* The section ids and the button data-lesson values must line up, otherwise
   * lesson_view and lesson_complete would report different lesson ids. */
  const sectionIds = [...sections].map(s => s.id).sort();
  const buttonIds = [...buttons].map(b => b.getAttribute('data-lesson')).sort();
  assert.deepEqual(buttonIds, sectionIds);
});

test('m2-3: marking a lesson complete emits lesson_complete with the source lesson id', async () => {
  const window = await boot();
  const host = await waitFor(() => window.document.querySelector('.source-native-host'), 'course host');
  const btn = await waitFor(() => host.querySelector('.done-btn[data-lesson="lesson3"]'), 'lesson 3 button');
  clickOn(window, btn);
  const done = await waitFor(() => typesOf(window, 'LESSON_COMPLETE')[0], 'lesson_complete signal');
  assert.equal(done.courseId, 'sandhi-exact-native-v1');
  assert.equal(done.lessonId, 'lesson3');
  assert.equal(done.lessonNumber, 3);
  assert.equal(done.completionPercent, 100);
});

test('m2-4: un-marking a lesson does NOT re-emit lesson_complete', async () => {
  const window = await boot();
  const host = await waitFor(() => window.document.querySelector('.source-native-host'), 'course host');
  const btn = await waitFor(() => host.querySelector('.done-btn[data-lesson="lesson1"]'), 'lesson 1 button');
  clickOn(window, btn); // on
  await waitFor(() => typesOf(window, 'LESSON_COMPLETE').length === 1, 'first complete');
  clickOn(window, btn); // off — the source toggles the button back
  await sleep(30);
  assert.equal(typesOf(window, 'LESSON_COMPLETE').length, 1, 'a toggle-off must not emit a second completion');
});

test('m2-5: completing every lesson fires course_complete exactly once', async () => {
  const window = await boot();
  const host = await waitFor(() => window.document.querySelector('.source-native-host'), 'course host');
  const buttons = await waitFor(() => {
    const list = host.querySelectorAll('.done-btn[data-lesson]');
    return list.length ? [...list] : null;
  }, 'lesson buttons');
  for (const btn of buttons) clickOn(window, btn);
  await waitFor(() => typesOf(window, 'COURSE_COMPLETE').length === 1, 'course_complete');
  assert.equal(typesOf(window, 'LESSON_COMPLETE').length, buttons.length, 'each lesson reported once');
  const complete = typesOf(window, 'COURSE_COMPLETE')[0];
  assert.equal(complete.courseId, 'sandhi-exact-native-v1');
  assert.equal(complete.lessonCount, buttons.length);
  /* Clicking the already-complete buttons again must not add a second row. */
  for (const btn of buttons) clickOn(window, btn);
  await sleep(30);
  assert.equal(typesOf(window, 'COURSE_COMPLETE').length, 1);
});

test('m2-6: the courses library route emits no lesson signals', async () => {
  const window = await boot('source-courses');
  await sleep(30);
  assert.equal(typesOf(window, 'LESSON_COMPLETE').length, 0);
  assert.equal(typesOf(window, 'COURSE_COMPLETE').length, 0);
});
