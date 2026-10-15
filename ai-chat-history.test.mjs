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
