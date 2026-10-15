// Regression 2026-10-15: the 2nd chat question failed ("উত্তরটা আসেনি") because the
// UI sent earlier model turns as role 'ai', which the gateway rejected with 400.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateChatReq } from './ai-agent.js';

const q1 = { role: 'user', content: 'নিউটনের ১ম সূত্র কী?' };
test('a follow-up carrying an ai-role answer is accepted as assistant', () => {
  const v = validateChatReq({ messages: [q1, { role: 'ai', content: 'জড়তার সূত্র।' }, { role: 'user', content: '২য় সূত্র?' }] });
  assert.equal(v.ok, true);
  assert.deepEqual(v.messages.map(m => m.role), ['user', 'assistant', 'user']);
});
test('an empty (failed) earlier answer is skipped, not fatal', () => {
  const v = validateChatReq({ messages: [q1, { role: 'assistant', content: '' }, { role: 'user', content: 'আবার' }] });
  assert.equal(v.ok, true);
});
test('a long earlier answer is clipped and old history trimmed to budget', () => {
  const long = 'ক'.repeat(9000);
  const msgs = [];
  for (let i = 0; i < 6; i++) { msgs.push({ role: 'user', content: 'প্রশ্ন ' + i }); msgs.push({ role: 'assistant', content: long }); }
  msgs.push({ role: 'user', content: 'শেষ প্রশ্ন' });
  const v = validateChatReq({ messages: msgs });
  assert.equal(v.ok, true);
  assert.equal(v.messages[v.messages.length - 1].content, 'শেষ প্রশ্ন');
});
test('a single over-long user message is still rejected', () => {
  assert.equal(validateChatReq({ messages: [{ role: 'user', content: 'ক'.repeat(4001) }] }).code, 'message_too_long');
});
test('the UI maps stored ai turns to assistant and drops failed ones', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  assert.match(UI, /role: m\.role === 'user' \? 'user' : 'assistant'/);
  assert.match(UI, /!m\.pending && !m\.error/);
});

/* Regression 2026-10-15 (owner voice note): two UI faults seen on iPhone PWA.
   (1) A guest who was not signed in got the generic "উত্তরটা আসেনি" instead of
       being told to log in. (2) The bottom safe-area inset was added twice - by
       the fixed shell and again by .dock - so a band of --bg (near-white) was
       painted below the composer and the composer sat too high. */
test('a 401 shows the full login explanation, not the generic failure', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  assert.match(UI, /needLoginLong:/);
  assert.match(UI, /res\.status === 401/);
  assert.match(UI, /holder\.errorKind = 'login'/);
});
test('the login explanation is multi-line and renders as paragraphs', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  assert.match(UI, /\[\s*'স্কাই উত্তর দিতে পারেনি[\s\S]*?\.join\(/);
  assert.match(UI, /m\.errorKind === 'login'/);
});
test('the bottom safe-area inset is applied exactly once', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  const uses = UI.match(/padding-bottom:env\(safe-area-inset-bottom/g) || [];
  assert.equal(uses.length, 0, 'shell must not repeat the inset .dock already owns');
  const dock = UI.match(/#app\.sky \.dock\{[^}]*padding:[^}]*env\(safe-area-inset-bottom/g) || [];
  assert.equal(dock.length, 1, '.dock is the single owner of the bottom inset');
});

/* Regression 2026-10-15 (owner photo): in the app's dark theme the composer and
   the drawer search box were painted WHITE, and the composer was nowhere near the
   bottom. Root cause: the app has TWO theme engines. AhAppearance reads
   'ah-appearance' and reports phase1's dark theme, 'midnight-academic', as
   "light", so the chat painted its light palette over a midnight app. A third
   fault: with the soft keyboard open the composer was invisible, because the
   keyboard shrinks visualViewport without resizing the layout viewport, and the
   dock is bottom-anchored inside a fixed full-height shell. */
test('a phase1 dark theme is treated as dark by the chat', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  assert.match(UI, /midnight-academic/,
    'the chat must know phase1 calls its dark theme midnight-academic');
  assert.match(UI, /function appResolved\(\)[\s\S]*?darkName[\s\S]*?return 'dark'/,
    'appResolved must return dark when either theme engine says dark');
});
test('a theme switch is repainted without a custom event', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  assert.match(UI, /new MutationObserver\(paintTheme\)/,
    'phase1.setTheme rewrites data-theme and fires no event, so watch the attribute');
});
test('the composer follows the visual viewport when the keyboard opens', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  assert.match(UI, /visualViewport/);
  assert.match(UI, /vv\.height/, 'shell must be sized to the visible height');
  assert.match(UI, /vv\.offsetTop/, 'shell must be pinned to the visual viewport top');
  assert.match(UI, /window\.innerHeight - vv\.height - vv\.offsetTop/,
    'keyboard height is innerHeight minus the visible viewport');
});
test('closing the chat clears the keyboard-fit inline geometry', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  const clears = UI.match(/a\.style\.height = a\.style\.top = a\.style\.bottom = a\.style\.paddingBottom = ''/g) || [];
  assert.equal(clears.length, 3,
    'every close path must drop the inline size, or the shell stays shrunk');
});
