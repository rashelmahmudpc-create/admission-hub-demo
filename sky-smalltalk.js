/* Sky small talk (owner 2026-10-17, PR-2): hi / ধন্যবাদ / তুমি কে … are answered
   inside the app. No server call, no AI limit used. Only a message that is
   NOTHING BUT small talk matches ("hi, সন্ধি কী?" still goes to the tutor).
   Replies rotate without repeats until a category is used up. {n} = " name";
   a "who" reply gets the name in front instead ("রাফি, আমি Sky…"). */
(function (root) {
  'use strict';
  /* উত্তর মুছে ফেলা হয়েছে (মালিকের নির্দেশ 2026-10-17)। নতুন উত্তর এখানে বসবে।
     কোনো ধরনের তালিকা খালি থাকলে কথাটা AI-এর কাছে যায়। */
  /* উত্তর মুছে ফেলা হয়েছে (মালিকের নির্দেশ 2026-10-17)। নতুন উত্তর এখানে বসবে।
     কোনো ধরনের তালিকা খালি থাকলে কথাটা AI-এর কাছে যায়। */
  const R = { greet: [], thanks: [], who: [], bye: [], ok: [] };
  const P = {
    greet: ['hi', 'hii', 'hiii', 'hey', 'hello', 'helo', 'hlw', 'hallo', 'hey sky', 'hi sky', 'hello sky', 'হাই', 'হায়', 'হ্যালো', 'হেলো', 'হেই', 'সালাম', 'আসসালামু আলাইকুম', 'আস্সালামু আলাইকুম', 'আসসালামুয়ালাইকুম', 'assalamu alaikum', 'assalamualaikum', 'salam', 'good morning', 'good evening', 'শুভ সকাল', 'শুভ সন্ধ্যা', 'কেমন আছো', 'কেমন আছ', 'কি খবর', 'কী খবর', 'kemon acho', 'how are you'],
    thanks: ['thanks', 'thank you', 'thankyou', 'thanks sky', 'thank u', 'thx', 'tnx', 'tq', 'ty', 'ধন্যবাদ', 'অনেক ধন্যবাদ', 'ধন্যবাদ sky', 'থ্যাংকস', 'থ্যাঙ্কস', 'থ্যাংক ইউ', 'শুকরিয়া', 'জাজাকাল্লাহ', 'dhonnobad', 'onek dhonnobad'],
    who: ['তুমি কে', 'তুমি কে sky', 'আপনি কে', 'তোমার নাম কি', 'তোমার নাম কী', 'তোমার পরিচয়', 'তোমার পরিচয় দাও', 'who are you', 'what is your name', 'your name', 'tumi ke', 'tomar nam ki', 'sky কে', 'sky ke', 'তুমি কি ai', 'তুমি কি রোবট', 'are you ai', 'are you a bot'],
    bye: ['bye', 'bye bye', 'by', 'goodbye', 'good night', 'gn', 'বাই', 'বিদায়', 'আল্লাহ হাফেজ', 'আল্লাহ হাফিজ', 'allah hafez', 'allah hafiz', 'শুভ রাত্রি', 'শুভরাত্রি', 'see you', 'পরে কথা হবে'],
    ok: ['ok', 'okay', 'okk', 'oky', 'k', 'hmm', 'hm', 'acha', 'accha', 'thik ache', 'ঠিক আছে', 'আচ্ছা', 'ওকে', 'অকে', 'হুম', 'বুঝেছি', 'বুঝছি', 'got it', 'nice', 'great', 'cool', 'good', 'দারুণ', 'ভালো', 'বাহ', '👍', '👌']
  };
  const norm = (s) => String(s || '').toLowerCase()
    .replace(/[\u200c\u200d]/g, '')
    .replace(/[!?.,।৷;:~"'`()\[\]{}…\-_*]+/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, (e) => (e === '👍' || e === '👌') ? ' ' + e + ' ' : ' ')
    .replace(/\s+/g, ' ').trim()
    .replace(/\s+(ভাই|আপু|ভাইয়া|bhai|vai|apu|দোস্ত|dost)$/u, '').trim();
  const MAP = new Map();
  for (const k of Object.keys(P)) for (const p of P[k]) MAP.set(norm(p), k);
  function kind(text) {
    const raw = String(text || '');
    if (!raw.trim() || raw.length > 40) return '';
    return MAP.get(norm(raw)) || '';
  }
  const KEY = 'skySmallTalk:v1';
  function pick(cat) {
    const list = R[cat]; let st = {};
    try { st = JSON.parse(root.localStorage.getItem(KEY) || '{}') || {}; } catch (_) { st = {}; }
    let s = st[cat];
    if (!s || !Array.isArray(s.o) || s.o.length !== list.length || s.i >= list.length) {
      const o = list.map((_, i) => i);
      for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
      if (s && Array.isArray(s.o) && s.o.length && o[0] === s.o[s.o.length - 1]) o.push(o.shift());
      s = { o, i: 0 };
    }
    const idx = s.o[s.i]; s.i += 1; st[cat] = s;
    try { root.localStorage.setItem(KEY, JSON.stringify(st)); } catch (_) {}
    return list[idx];
  }
  function reply(text, firstName) {
    const cat = kind(text);
    if (!cat || !Array.isArray(R[cat]) || !R[cat].length) return null;
    const name = String(firstName || '').replace(/[<>&"'\r\n]/g, '').trim().slice(0, 30);
    const out = pick(cat).replace('{n}', name ? ' ' + name : '');
    return cat === 'who' && name ? name + ', ' + out : out;
  }
  const api = Object.freeze({ kind, reply, REPLIES: R, PHRASES: P });
  root.SkySmallTalk = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
