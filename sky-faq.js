/* Sky shared answers (owner 2026-10-17, PR-3): common textbook questions
   (সমাস কী, সন্ধি কী …) get the same reviewed answer for everyone, inside the
   app: no server call, no AI limit used. Only a VERY close match is used: after
   removing question words (কী, কাকে বলে, what is …) the rest must equal a stored
   topic name (or differ by a small typo, with one clear winner). The bubble has an
   "আরো বিস্তারিত" button that sends the question to the AI.
   Data files (sky-faq-*.js) push entries into root.SkyFAQData:
   { id, k: [topic names], a: 'markdown answer' }. */
(function (root) {
  'use strict';
  const FILLER = new Set((
    'কী কি কাকে বলে বলতে বোঝায় বোঝানো বোঝ বোঝো বুঝায় বুঝ বুঝি বুঝিয়ে বুঝাও বোঝাও দাও দাও না বলো বলেন ' +
    'সংজ্ঞা সংজ্ঞাসহ উদাহরণসহ লেখ লেখো লিখ মানে অর্থ কয় কত প্রকার প্রকারভেদ একটু আমাকে প্লিজ স্কাই ভাই আপু ' +
    'ki kake bole bolte bujhay bojhay bujhi bujhiye bujhao bojhao dao koy koto prokar mane please plz pls sky what whats is are was define definition meaning of the a an explain tell me about'
  ).split(/\s+/));
  const SUFFIX = ['ের', 'এর', 'র', 'টি', 'টা', "'s"];
  const MAX_LEN = 80;

  function norm(s) {
    return String(s == null ? '' : s).normalize('NFC').toLowerCase()
      .replace(/[\u200c\u200d]/g, '')
      .replace(/[?？!।,.:;"“”‘’'`()[\]{}\-–—_/\\|…*#~<>=+]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function core(s) { return norm(s).split(' ').filter((w) => w && !FILLER.has(w)).join(' '); }
  function variants(c) {
    const out = [c];
    const sp = c.lastIndexOf(' ');
    const head = sp < 0 ? '' : c.slice(0, sp + 1), last = c.slice(sp + 1);
    for (const x of SUFFIX) if (last.length > x.length + 1 && last.endsWith(x)) out.push(head + last.slice(0, -x.length));
    return out;
  }
  function lev(a, b, cap) {
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > cap) return cap + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  let index = null, seen = -1;
  function build() {
    const data = Array.isArray(root.SkyFAQData) ? root.SkyFAQData : [];
    if (index && seen === data.length) return index;
    index = new Map(); seen = data.length;
    for (const e of data) {
      if (!e || !e.id || !e.a || !Array.isArray(e.k)) continue;
      for (const k of e.k) { const c = core(k); if (c && !index.has(c)) index.set(c, e); }
    }
    return index;
  }

  function match(text) {
    const raw = String(text == null ? '' : text);
    if (!raw.trim() || raw.length > MAX_LEN || /\n/.test(raw.trim())) return null;
    const c = core(raw);
    if (!c || c.length > 40) return null;
    const idx = build();
    for (const v of variants(c)) { const e = idx.get(v); if (e) return { id: e.id, a: e.a, q: raw.trim() }; }
    let hit = null, best = 9, tie = false;
    for (const [k, e] of idx) {
      if (k.length < 5) continue;
      const cap = k.length >= 9 ? 2 : 1;
      for (const v of variants(c)) {
        const d = lev(v, k, cap);
        if (d > cap) continue;
        if (d < best) { best = d; hit = e; tie = false; } else if (d === best && hit !== e) tie = true;
      }
    }
    return hit && !tie ? { id: hit.id, a: hit.a, q: raw.trim() } : null;
  }

  const api = { match, count: () => build().size && new Set(build().values()).size, _core: core };
  root.SkyFAQ = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
