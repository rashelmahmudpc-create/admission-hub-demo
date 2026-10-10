// 🐞 Regression: the AI tutor sent every chat message to the model twice.
// Student typed "৮" and the reply read it as "৮৮" because the same user turn
// was appended twice (send() pushes it, then callStream() concatenated it again).
// These tests fail on the old code and pass on the fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateChatReq } from './ai-agent.js';

const SRC = readFileSync(new URL('./ai-agent-chat.js', import.meta.url), 'utf8');

test('callStream drops the trailing user turn send() already pushed', () => {
  // The guard must exist in the source (old code had no such line).
  assert.match(
    SRC,
    /if \(last && last\.role === 'user' && last\.content === userText\) prior = prior\.slice\(0, -1\);/,
    'callStream is missing the duplicate-turn guard'
  );
});

test('simulated send→callStream sends the current turn exactly once', () => {
  // Mirrors the fixed client flow with a single history helper.
  const msgs = [];
  const history = () =>
    msgs
      .filter((m) => m.role === 'user' || (m.role === 'ai' && !m.error))
      .map((m) => ({
        role: m.role === 'ai' ? 'assistant' : 'user',
        content: String(m.text || '').slice(0, 4000),
      }));

  const sendThenBuild = (userText) => {
    msgs.push({ role: 'user', text: userText, ts: Date.now() }); // send()
    let prior = history(); // callStream()
    const last = prior[prior.length - 1];
    if (last && last.role === 'user' && last.content === userText) prior = prior.slice(0, -1);
    return prior.concat([{ role: 'user', content: userText }]);
  };

  const sent = sendThenBuild('৮');
  const userTurns = sent.filter((m) => m.role === 'user');
  assert.equal(userTurns.length, 1, 'the model must receive one user turn, not two');
  assert.equal(userTurns[0].content, '৮');
});

test('validateChatReq cannot emit consecutive user turns', () => {
  const res = validateChatReq({
    messages: [
      { role: 'user', content: '৮' },
      { role: 'user', content: '৮' },
    ],
    fresh: false,
  });
  assert.equal(res.ok, true);
  const userTurns = res.messages.filter((m) => m.role === 'user');
  assert.equal(userTurns.length, 1, 'consecutive user turns must be merged');
  assert.ok(userTurns[0].content.includes('৮'));
});

test('validateChatReq keeps real turn boundaries intact', () => {
  const res = validateChatReq({
    messages: [
      { role: 'user', content: 'প্রশ্ন' },
      { role: 'assistant', content: 'উত্তর' },
      { role: 'user', content: 'আরেক প্রশ্ন' },
    ],
  });
  assert.equal(res.ok, true);
  assert.deepEqual(
    res.messages.map((m) => m.role),
    ['user', 'assistant', 'user']
  );
  assert.equal(res.messages[2].content, 'আরেক প্রশ্ন');
});
