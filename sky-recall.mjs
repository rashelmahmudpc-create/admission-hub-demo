// 🔔 Sky recall (owner plan step 2, 2026-10-18): when a signed-in student opens
// the chat, Sky reminds them of yesterday's mistakes and their weak topic on its
// own. Pure and deterministic: no model call, no AI limit used, no I/O. The
// facts come only from THIS student's own memory and the stats their own app
// sent; nothing is invented. Returns null when there is nothing honest to say.
import { statedWeakTopics, sanitizeMemoryText, isPiiFree, KIND } from './memory-engine.js';
import { topicBase } from './sky-tools.mjs';

export const RECALL_VERSION = 'recall-v1';
const DAY = 24 * 60 * 60 * 1000;
const LAST_TOPIC_MAX_AGE = 7 * DAY;
const BN = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const bn = (n) => String(n).replace(/[0-9]/g, (d) => BN[d]);

function cleanName(v, max = 40) {
  const s = sanitizeMemoryText(v, max);
  return s && isPiiFree(s) ? s : '';
}

/** "আজ" / "গতকাল" / "N দিন আগে" for a timestamp. */
export function whenWord(ts, now) {
  const d = Math.floor((now - ts) / DAY);
  if (!(ts > 0) || d < 0) return '';
  if (d === 0) return 'আজ';
  if (d === 1) return 'গতকাল';
  return bn(d) + ' দিন আগে';
}

/**
 * input: { records (parsed long-term memory), stats (capStats shape),
 *          recent: { mistakes: n, since: ts } (client-counted, last 48 h), now }
 * output: { line, chips: [{label, q} | {label, go}], kinds: [...], version } | null
 */
export function buildRecall(input = {}) {
  const now = Number(input.now) || Date.now();
  const records = Array.isArray(input.records) ? input.records : [];
  const stats = input.stats && typeof input.stats === 'object' ? input.stats : {};
  const recent = input.recent && typeof input.recent === 'object' ? input.recent : {};
  const parts = [];
  const chips = [];
  const kinds = [];

  /* 1. Recent mistakes (the app counted them; 48 h, not yet mastered). */
  const wrong = Math.max(0, Math.min(999, Number(recent.mistakes) | 0));
  if (wrong > 0) {
    const when = whenWord(Number(recent.since) || 0, now);
    const lead = when === 'আজ' ? 'আজ' : when === 'গতকাল' ? 'গতকাল থেকে' : 'সম্প্রতি';
    parts.push(lead + ' ' + bn(wrong) + 'টা প্রশ্নে ভুল হয়েছে — আগে ওগুলো একবার ঝালিয়ে নেবে?');
    chips.push({ label: '🔁 ভুলগুলো ঝালাই', go: 'mistake-bank' });
    kinds.push('mistakes');
  }

  /* 2. Weak topic: measured from exams first, else what the student said. */
  const measured = Array.isArray(stats.weakTopics) ? stats.weakTopics.filter((t) => t && t.name) : [];
  const said = statedWeakTopics(records, 1);
  if (measured.length) {
    const worst = measured.slice().sort((a, b) => (a.accuracy | 0) - (b.accuracy | 0))[0];
    const name = cleanName(worst.name);
    if (name) {
      parts.push(name + '-এ সঠিকতা এখন ' + bn(worst.accuracy | 0) + '% — আজ একটু ' + name + ' চর্চা করি?');
      chips.push({ label: '🎯 ' + name + ' কুইজ', q: name + ' থেকে ৫টা প্রশ্নে কুইজ দাও' });
      kinds.push('weak-measured');
    }
  } else if (said.length) {
    const name = cleanName(said[0]);
    const base = topicBase(name);
    if (name) {
      parts.push('আগে বলেছিলে ' + name + ' দুর্বল — আজ ' + base + ' দিয়ে শুরু করি?');
      chips.push({ label: '🎯 ' + base + ' কুইজ', q: base + ' থেকে ৫টা প্রশ্নে কুইজ দাও' });
      kinds.push('weak-stated');
    }
  }

  /* 3. Last discussed topic (only when nothing above, and only if recent). */
  if (!parts.length) {
    const last = records.find((r) => r && r.kind === KIND.STUDIES && r.key === 'last-topic');
    if (last && now - (Number(last.ts) || 0) <= LAST_TOPIC_MAX_AGE) {
      const topic = cleanName(last.value, 60);
      if (topic) {
        const when = whenWord(Number(last.ts), now);
        parts.push((when ? when + ' ' : '') + 'আমরা “' + topic + '” নিয়ে কথা বলছিলাম — সেখান থেকে চালিয়ে যাবে?');
        chips.push({ label: '↩️ আগের আলোচনা', q: 'আগের আলোচনাটা চালিয়ে যাও: ' + topic });
        kinds.push('last-topic');
      }
    }
  }

  if (!parts.length) return null;
  return { line: parts.slice(0, 2).join(' '), chips: chips.slice(0, 2), kinds, version: RECALL_VERSION };
}

/** Recent-mistake summary the client sends: clamp and trust nothing else. */
export function sanitizeRecent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mistakes = Math.max(0, Math.min(999, Number(raw.mistakes) | 0));
  const since = Number(raw.since);
  return { mistakes, since: Number.isFinite(since) && since > 0 ? since : 0 };
}
