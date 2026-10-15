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
