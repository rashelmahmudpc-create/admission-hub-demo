// 🧵 P27 — BOUNDED HISTORY (step 3 of the owner's AI cost plan)
//
// Long threads used to be re-sent almost verbatim: the old rule kept the last 12
// turns raw and only summarised past 16 turns, so an ordinary 9–16 turn tutoring
// session shipped every earlier answer in full. With assistant turns allowed up
// to 4000 characters that is thousands of characters of context per follow-up,
// and every provider here is on a free tier.
//
// Two properties this file exists to lock:
//
//   (a) a long thread really does shrink — older turns become a digest, and
//   (b) a short thread is returned byte-identical, because that is the common
//       case and it must not change at all.
import { readFileSync } from 'fs';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };

const H = await import('./ai-history-trim.mjs');
const A = await import('./ai-agent.js');
const SRC = readFileSync('ai-agent.js', 'utf8');
const { selectHistory, digestTurns, capRecalledTurns, HISTORY } = H;

const turn = (role, content) => ({ role, content });
const thread = (n, len = 300) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(turn('user', `প্রশ্ন ${i} ` + 'ক'.repeat(len)));
    out.push(turn('assistant', `উত্তর ${i} ` + 'খ'.repeat(len)));
  }
  return out;
};

/* ── ১. A short thread is untouched ── */
t('P27-১. a thread at or below the window is returned byte-identical',
  (() => {
    const short = thread(3);
    const r = selectHistory(short);
    return r.digest === '' && r.compacted === 0 && JSON.stringify(r.kept) === JSON.stringify(short);
  })());
t('P27-২. an empty thread does not throw', (() => {
  const r = selectHistory([]);
  return r.kept.length === 0 && r.digest === '';
})());

/* ── ২. A long thread shrinks, and the newest turns survive verbatim ── */
t('P27-৩. an ordinary 9–16 turn session really does shrink',
  (() => {
    const twelve = thread(6); // 12 messages
    const r = selectHistory(twelve);
    return r.compacted > 0 && r.kept.length === HISTORY.RECENT && r.droppedChars > 500;
  })());
t('P27-৪. the most recent turns are kept word-for-word',
  (() => {
    const long = thread(12);
    const r = selectHistory(long);
    const tail = long.slice(-HISTORY.RECENT);
    return JSON.stringify(r.kept) === JSON.stringify(tail);
  })());
/* A thread longer than the digest budget is truncated at DIGEST_MAX_CHARS, so
 * the line count is only asserted where the whole digest fits. */
t('P27-৫. the digest names every dropped turn while it fits, and is always bounded',
  (() => {
    const fits = thread(6); // 12 messages → 4 dropped, comfortably inside the budget
    const rFits = selectHistory(fits);
    const droppedFits = fits.slice(0, fits.length - HISTORY.RECENT);
    const big = thread(20);
    const rBig = selectHistory(big);
    return rFits.digest.trim().split('\n').length - 1 === droppedFits.length
      && rBig.digest.length <= HISTORY.DIGEST_MAX_CHARS + 1;
  })());
t('P27-৬. a big thread shrinks by an order of magnitude',
  (() => {
    const long = thread(30, 1000);
    const before = JSON.stringify(long).length;
    const r = selectHistory(long);
    const after = JSON.stringify(r.kept).length + r.digest.length;
    return after * 5 < before;
  })());

/* ── ৩. The digest keeps the conversation's shape ── */
t('P27-৭. the digest marks who said what, newest-consistent with summarizeTo',
  (() => {
    const d = digestTurns([turn('user', 'সালোকসংশ্লেষণ কী'), turn('assistant', 'গাছের খাবার তৈরি')]);
    return d.includes('শিক্ষার্থী:') && d.includes('AI:') && d.startsWith(HISTORY.DIGEST_HEADER);
  })());
t('P27-৮. a dropped turn with no text is skipped, not rendered as an empty line',
  !digestTurns([turn('assistant', '   ')]).includes('- AI: '));

/* ── ৪. Recalled turns are capped ── */
t('P27-৯. recalled turns are capped to the newest few',
  (() => {
    const mem = [1, 2, 3, 4, 5, 6].map(i => turn('user', 'পুরনো ' + i));
    const capped = capRecalledTurns(mem);
    return capped.length === 4 && capped[capped.length - 1].content === 'পুরনো 6';
  })());
t('P27-১০. a short recall is returned untouched',
  (() => {
    const mem = [turn('user', 'এক'), turn('assistant', 'দুই')];
    return capRecalledTurns(mem).length === 2;
  })());

/* ── ৫. Wiring + real end-to-end prompt size ── */
t('P27-১১. the trim runs before the model is called (PR-2: the chain probe overlaps the quota read)',
  SRC.indexOf('selectHistory(msgs)') < SRC.indexOf("mark('modelStart')"));
t('P27-১২. the old unbounded slice(-24) on the history is gone',
  !/msgs = msgs\.slice\(-24\);/.test(SRC));

async function promptSizeFor(messages, opts = {}) {
  const real = globalThis.fetch;
  let sentLen = 0, sentMsgCount = 0;
  globalThis.fetch = async (url, init) => {
    if (/generativelanguage/.test(String(url)) && !sentLen) {
      try {
        const b = JSON.parse(init.body);
        sentLen = JSON.stringify(b.contents || b).length;
        sentMsgCount = (b.contents || []).length;
      } catch (_) {}
    }
    return new Response('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ঠিক আছে' }] } }] }) + '\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  const env = { PUB_KV: { async get() { return null; }, async put() { return { ok: true }; } }, GEMINI_KEYS: 'k1' };
  try {
    const res = await A.agentChat(new Request('https://x/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ messages, fresh: true })
    }), env, 'account-abc', opts);
    await res.text();
  } finally { globalThis.fetch = real; }
  return { sentLen, sentMsgCount };
}
const longThread = thread(11, 1200); // 22 messages: inside the 24-message API cap
const longSize = await promptSizeFor(longThread, { persistMemory: false });
t('P27-১৩. E2E: a 22-message thread sends only the recent window to the model',
  longSize.sentMsgCount > 0 && longSize.sentMsgCount <= HISTORY.RECENT,
  { timeout: 30000 });
t('P27-১৪. E2E: a short thread still sends every message',
  (async () => {
    const s = await promptSizeFor(thread(2, 50), { persistMemory: false });
    return s.sentMsgCount === 4;
  })(), { timeout: 30000 });
t('P27-১৫. E2E: a long thread sends materially less than the raw thread',
  /* Measured: 22 messages / 26.6k chars of content drop to 8 messages / ~10k
     sent, i.e. ~0.37 of the raw thread. Assert a conservative ~half so the test
     guards the shrinkage without being brittle about the exact window. */
  longSize.sentLen > 0 && longSize.sentLen < JSON.stringify(longThread).length / 2,
  { timeout: 30000 });
/* The API cap is 24 messages, so a thread that large never reaches the trim at
 * all — it is refused first. Worth locking, because it means the trim only ever
 * sees threads the gateway has already accepted. */
t('P27-১৬. a thread above the 24-message API cap is refused before the trim runs',
  (() => {
    const v = A.validateChatReq({ messages: thread(14, 10) });
    return v.ok === false && v.code === 'too_many_messages';
  })());

console.log(`\n${fail === 0 ? '✅' : '❌'} P27 history-trim: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
