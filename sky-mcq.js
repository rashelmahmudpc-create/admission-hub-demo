/* AdmissionSky — MCQ Card Engine (owner 2026-10-18).
   Any MCQ that appears in a Sky answer becomes a real tap-to-answer quiz card.
   Nobody has to ask for a special format: the engine reads the answer text the
   way a student reads it — "১. প্রশ্ন", "ক) … খ) …", "✅ উত্তর: খ",
   "💡 ব্যাখ্যা: …", an answer key at the end ("উত্তরমালা: ১-খ ২-গ") — and the
   quiz-mode JSON ({"title","questions":[…]}) the server sends, even while it is
   still streaming (finished questions appear one by one).
   Escape-first: every piece of text is HTML-escaped before markup is added.
   Picks are kept per question on this device (localStorage) so a re-render or a
   reload never loses the student's answers. No network, no AI call. */
(function (root) {
  'use strict';
  if (root.SkyMCQ) return;
  const BN = '০১২৩৪৫৬৭৮৯', LET = ['ক', 'খ', 'গ', 'ঘ', 'ঙ', 'চ'];
  const bn = (s) => String(s).replace(/[0-9]/g, (d) => BN[+d]);
  const en = (s) => String(s == null ? '' : s).replace(/[০-৯]/g, (d) => String(BN.indexOf(d)));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inl = (s) => esc(String(s).trim()).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/__([^_\n]+)__/g, '<b>$1</b>').replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
  const strip = (s) => String(s).replace(/\*\*|__/g, '').trim();
  const letIdx = (l) => { const x = String(l || '').trim(); const i = LET.indexOf(x); if (i >= 0) return i; const c = x.toLowerCase().charCodeAt(0) - 97; return c >= 0 && c < 6 && x.length === 1 ? c : -1; };
  function hash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

  /* ── line grammar ── */
  const L_ = '[কখগঘঙচA-Fa-f]';
  const RE_OPT = new RegExp('^\\s*(?:[-*•]\\s+)?(?:\\*\\*)?\\(?\\s*(' + L_ + ')\\s*[).।:]\\s*(?:\\*\\*)?\\s*(.+?)\\s*$');
  const RE_OPT_INLINE = new RegExp('(?:^|\\s)\\(?(' + L_ + ')\\s*[).]\\s*', 'g');
  const RE_NUM_Q = /^\s*(?:#{1,6}\s*)?(?:[-*]\s+)?(?:\*\*)?\s*(?:(?:প্রশ্ন|Q(?:uestion)?|MCQ)\s*[-#]?\s*)?([0-9০-৯]{1,3})\s*[.)।:]\s*(?:\*\*)?\s*(.+?)\s*$/i;
  const RE_TAG_Q = /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:প্রশ্ন|Question|Q|MCQ)\s*(?:\*\*)?\s*[:：]\s*(?:\*\*)?\s*(.+?)\s*$/i;
  const RE_ANS = /^\s*(?:[-*]\s+)?(?:✅|✔️?|☑️)?\s*(?:\*\*)?\s*(?:সঠিক\s*উত্তর|উত্তর|Correct\s*answer|Answer|Ans|Correct)\s*(?:\*\*)?\s*[:：=\-–—]\s*(?:\*\*)?\s*(.+?)\s*$/i;
  const RE_EXP = /^\s*(?:[-*]\s+)?(?:💡|📖|📝)?\s*(?:\*\*)?\s*(?:ব্যাখ্যা|ব্যাখ্যাঃ|Explanation|কারণ|Why)\s*(?:\*\*)?\s*[:：\-–—]\s*(?:\*\*)?\s*(.+?)\s*$/i;
  const RE_KEY = /^\s*(?:#{1,6}\s*)?(?:[-*]\s+)?(?:✅|🔑|📌)?\s*(?:\*\*)?\s*(?:উত্তরমালা|উত্তর\s*মালা|সঠিক\s*উত্তরসমূহ|উত্তরসমূহ|উত্তরগুলো|Answer\s*key|Answers)\s*(?:\*\*)?\s*[:：]?\s*(?:\*\*)?\s*(.*)$/i;
  const RE_PAIR = new RegExp('([0-9০-৯]{1,3})\\s*[-.)।:=→]\\s*\\(?\\s*(' + L_ + ')(?![A-Za-z\\u0980-\\u09FF])', 'g');
  const RE_KEYH = /^\s*(?:#{1,6}\s*)?(?:[-*]\s+)?(?:✅|🔑|📌)?\s*(?:\*\*)?\s*(?:সঠিক\s*)?উত্তর(?:সমূহ|গুলো)?\s*(?:\*\*)?\s*[:：]?\s*(?:\*\*)?\s*$/i;
  const pairs = (s) => { RE_PAIR.lastIndex = 0; const n = (String(s).match(RE_PAIR) || []).length; RE_PAIR.lastIndex = 0; return n; };
  const isKey = (l) => RE_KEY.test(l) || RE_KEYH.test(l) || (RE_ANS.test(l) && pairs(l) >= 1 && /^\s*(?:[-*]\s+)?(?:✅|🔑)?\s*(?:\*\*)?\s*[^0-9০-৯]*[:：]\s*(?:\*\*)?\s*[0-9০-৯]/.test(l));
  const RE_MARK = /\s*(?:\(\s*(?:সঠিক|correct)\s*\)|✅|✔️?)\s*$/i;
  const looksQ = (s) => /[?？]\s*(\*\*)?\s*$|_{3,}|…\s*$|[—-]\s*$/.test(s) ||
    /(?:^|[\s(“"'])(?:কোনটি|কোনটা|কোন|কোনো|কে|কী|কি|কত|কতটি|কয়টি|কয়টি|কোথায়|কবে|কেন|কাকে|কার|কীভাবে|কিভাবে)(?=$|[\s?？,।)”"'])/.test(s) ||
    /\b(which|what|who|whom|when|where|how|choose|select|identify|find)\b/i.test(s);

  function splitInline(line) {
    const t = String(line);
    const hits = [];
    let m; RE_OPT_INLINE.lastIndex = 0;
    while ((m = RE_OPT_INLINE.exec(t))) hits.push({ i: m.index + (m[0].match(/^\s/) ? 1 : 0), end: RE_OPT_INLINE.lastIndex, l: m[1] });
    if (hits.length < 2) return null;
    for (let k = 0; k < hits.length; k++) if (letIdx(hits[k].l) !== k) return null;
    const head = t.slice(0, hits[0].i).trim();
    const opts = hits.map((h, k) => t.slice(h.end, k + 1 < hits.length ? hits[k + 1].i : t.length).trim());
    if (opts.some((o) => !o || o.length > 140)) return null;
    return { head, opts };
  }

  /* parse(text) → [{type:'text',lines} | {type:'set',qs}] */
  function parse(text, live) {
    const lines = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
    const out = [];
    let txt = [], i = 0, inFence = false;
    const pushText = (l) => txt.push(l);
    const flushText = () => { if (txt.length) { out.push({ type: 'text', lines: txt }); txt = []; } };
    const isOpt = (l) => { const m = l.match(RE_OPT); return m ? { k: letIdx(m[1]), t: m[2] } : null; };
    function readOpts(j) {
      const opts = []; let correct = -1;
      while (j < lines.length) {
        const l = lines[j];
        if (!l.trim()) { if (opts.length && j + 1 < lines.length && isOpt(lines[j + 1]) && isOpt(lines[j + 1]).k === opts.length) { j++; continue; } break; }
        if (!opts.length) { const s = splitInline(l); if (s && !s.head) { s.opts.forEach((x) => opts.push(strip(x))); j++; continue; } }
        const o = isOpt(l);
        if (!o || o.k !== opts.length) break;
        let t = o.t;
        if (RE_MARK.test(t)) { correct = opts.length; t = t.replace(RE_MARK, ''); }
        opts.push(strip(t)); j++;
      }
      opts.forEach((o, k) => { if (RE_MARK.test(o)) { correct = k; opts[k] = o.replace(RE_MARK, ''); } });
      return { opts, correct, j };
    }
    function qHead(l) {
      let m = l.match(RE_NUM_Q);
      if (m && !isOpt(l)) return { n: +en(m[1]), q: m[2] };
      m = l.match(RE_TAG_Q);
      if (m) return { n: 0, q: m[1] };
      return null;
    }
    let set = null;
    /* a list like "সমাস ৬ প্রকার: ক) … খ) …" is not a quiz: a set needs at least one
       answer key or one line that reads as a question */
    const okSet = (st) => st.qs.some((q) => q.a >= 0 || looksQ(q.q) || q.open);
    const closeSet = () => {
      if (!set) return;
      if (okSet(set)) out.push(set);
      else { out.push({ type: 'text', lines: lines.slice(set.qs[0].s0, set.qs[set.qs.length - 1].s1) }); }
      set = null;
    };
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*```/.test(l)) { inFence = !inFence; closeSet(); pushText(l); i++; continue; }
      if (inFence || !l.trim()) { if (set && !inFence) { i++; continue; } pushText(l); i++; continue; }
      if (set && /^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { i++; continue; }
      /* question candidate: numbered/tagged line, or any line right before ≥2 options */
      let head = qHead(l), inline = null;
      if (!head) { const s = splitInline(l); if (s && s.head && s.opts.length >= 3) inline = s; }
      const qText = head ? head.q : (inline ? inline.head : l);
      const s2 = !inline && head ? splitInline(head.q) : null;
      let r;
      if (inline || (s2 && s2.head && s2.opts.length >= 3)) {
        const s = inline || s2; r = { opts: s.opts.map(strip), correct: -1, j: i + 1 };
        head = head || { n: 0, q: s.head }; head.q = s.head;
      } else {
        r = readOpts(i + 1);
      }
      const enough = r.opts.length >= 3 || (r.opts.length === 2 && (head || looksQ(qText)));
      if (enough && (head || looksQ(qText) || r.opts.length >= 3) && strip(head ? head.q : qText).length <= 600) {
        const q = { s0: i, n: head ? head.n : 0, q: strip(head ? head.q : qText).replace(/^\*\*|\*\*$/g, ''), opts: r.opts, a: r.correct, x: '' };
        let j = r.j;
        /* answer / explanation lines that belong to this question */
        while (j < lines.length) {
          const t = lines[j];
          if (!t.trim()) { if (j + 1 < lines.length && (RE_ANS.test(lines[j + 1]) || RE_EXP.test(lines[j + 1]))) { j++; continue; } break; }
          let m = t.match(RE_ANS);
          if (m && !isKey(t)) {
            const v = strip(m[1]); const lm = v.match(new RegExp('^\\(?\\s*(' + L_ + ')\\s*(?:[).।:]|$|\\s)'));
            let a = lm ? letIdx(lm[1]) : -1;
            if (a < 0) { const vv = v.replace(/[।.]$/, '').trim().toLowerCase(); a = q.opts.findIndex((o) => o.toLowerCase() === vv); }
            if (a >= 0 && a < q.opts.length) q.a = a;
            const rest = v.replace(new RegExp('^\\(?\\s*' + L_ + '\\s*[).।:]?\\s*'), '');
            const ex = rest.match(/(?:ব্যাখ্যা|কারণ)\s*[:：]\s*(.+)$/); if (ex) q.x = ex[1];
            j++; continue;
          }
          m = t.match(RE_EXP);
          if (m) { q.x = (q.x ? q.x + ' ' : '') + m[1]; j++; while (j < lines.length && lines[j].trim() && !qHead(lines[j]) && !RE_ANS.test(lines[j]) && !isOpt(lines[j]) && !isKey(lines[j])) { q.x += ' ' + lines[j].trim(); j++; } continue; }
          break;
        }
        flushText();
        if (!set) set = { type: 'set', qs: [] };
        q.open = live && j >= lines.length; /* may still be streaming */
        q.s1 = j;
        set.qs.push(q);
        i = j; continue;
      }
      /* answer key for the set ("উত্তরমালা: ১-খ, ২-গ" or lines "১. খ") */
      if (isKey(l) && (set || out.some((s) => s.type === 'set'))) {
        const target = set || [...out].reverse().find((s) => s.type === 'set');
        let buf = l.replace(/^[^:：]*[:：]/, ' '), j = i + 1;
        if (RE_KEYH.test(l)) buf = '';
        while (j < lines.length && (lines[j].trim() === '' ? (j + 1 < lines.length && pairs(lines[j + 1]) > 0 && !buf.trim()) : pairs(lines[j]) > 0 && !isOpt(lines[j]))) { buf += ' ' + lines[j]; j++; }
        RE_PAIR.lastIndex = 0;
        let m, hit = 0;
        while ((m = RE_PAIR.exec(buf))) { const n = +en(m[1]), a = letIdx(m[2]); const q = target.qs.find((x, k) => (x.n || k + 1) === n); if (q && a >= 0 && a < q.opts.length && q.a < 0) { q.a = a; hit++; } }
        if (hit) { i = j; continue; }
      }
      closeSet(); pushText(l); i++;
    }
    closeSet(); flushText();
    return out;
  }

  /* quiz-mode JSON, tolerant of a stream cut mid-object */
  function parseJson(src, live) {
    const s = String(src == null ? '' : src).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    if (!/^\{\s*"(title|questions)"/.test(s)) return null;
    const tm = s.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    let title = ''; try { title = tm ? JSON.parse('"' + tm[1] + '"') : ''; } catch (_) {}
    const k = s.indexOf('"questions"'); const qs = [];
    let done = false;
    if (k >= 0) {
      let p = s.indexOf('[', k) + 1, depth = 0, start = -1, str = false, escp = false;
      for (; p > 0 && p < s.length; p++) {
        const c = s[p];
        if (str) { if (escp) escp = false; else if (c === '\\') escp = true; else if (c === '"') str = false; continue; }
        if (c === '"') { str = true; continue; }
        if (c === '{') { if (depth++ === 0) start = p; }
        else if (c === '}') { if (--depth === 0 && start >= 0) { try { qs.push(JSON.parse(s.slice(start, p + 1))); } catch (_) {} start = -1; } }
        else if (c === ']' && depth === 0) { done = true; break; }
      }
    }
    const list = qs.filter((x) => x && (x.q || x.question) && Array.isArray(x.options) && x.options.length > 1).map((x, n) => {
      const a = Number.isInteger(x.answer) ? x.answer : (typeof x.answer === 'string' ? (letIdx(x.answer) >= 0 ? letIdx(x.answer) : x.options.indexOf(x.answer)) : Number(x.answer));
      return { n: n + 1, q: String(x.q || x.question), opts: x.options.map(String), a: a >= 0 && a < x.options.length ? a : -1, x: String(x.explanation || x.exp || '') };
    });
    return { title: title || 'কুইজ', qs: list, open: live && !done };
  }

  /* ── state (per question, this device) ── */
  const SK = 'sky-mcq-v1';
  let ST = null;
  const st = () => { if (!ST) { try { ST = JSON.parse(root.localStorage.getItem(SK) || '{}') || {}; } catch (_) { ST = {}; } } return ST; };
  function stPut(k, v) {
    const s = st(); if (v == null) delete s[k]; else s[k] = [v, Date.now()];
    const ks = Object.keys(s); if (ks.length > 400) ks.sort((a, b) => s[a][1] - s[b][1]).slice(0, ks.length - 400).forEach((x) => delete s[x]);
    try { root.localStorage.setItem(SK, JSON.stringify(s)); } catch (_) {}
  }
  const pickOf = (k) => { const v = st()[k]; return v ? v[0] : -1; };
  const keyOf = (q) => 'q' + hash(q.q + '|' + q.opts.join('|'));

  /* ── render ── */
  function itemHtml(q, n) {
    const k = keyOf(q);
    const pick = pickOf(k), done = pick >= 0;
    const ok = done && q.a >= 0 && pick === q.a;
    const cls = 'skq-it' + (done ? ' done' + (q.a < 0 ? ' nokey' : ok ? ' right' : ' wrong') : '');
    const opts = q.opts.map((o, i) => {
      let c = 'skq-o';
      if (done) { if (q.a >= 0 && i === q.a) c += ' ok'; else if (i === pick) c += q.a < 0 ? ' sel' : ' no'; }
      return '<button type="button" class="' + c + '" data-skq-o="' + i + '"' + (done ? ' aria-disabled="true"' : '') + '><span class="skq-l">' + (LET[i] || i + 1) + '</span><span class="skq-ot">' + inl(o) + '</span>' + (done && q.a >= 0 && i === q.a ? '<span class="skq-ic">✓</span>' : (done && i === pick && q.a >= 0 ? '<span class="skq-ic">✕</span>' : '')) + '</button>';
    }).join('');
    const fb = !done ? '' : (q.a < 0 ? '🟦 তুমি বেছেছ: <b>' + LET[pick] + '</b> — এই প্রশ্নের উত্তর-চাবি দেওয়া নেই।'
      : (ok ? '🎉 <b>সঠিক!</b>' : '❌ <b>ভুল হয়েছে।</b> সঠিক উত্তর: <b>' + LET[q.a] + ') ' + inl(q.opts[q.a]) + '</b>'));
    const askTxt = (q.a < 0 ? 'এই MCQ-টার সঠিক উত্তর কোনটা, ব্যাখ্যা করো। আমি ' + (LET[pick] || '') + ' বেছেছি।' : 'এই MCQ-টা ধাপে ধাপে বুঝিয়ে বলো।') + '\nপ্রশ্ন: ' + strip(q.q) + '\n' + q.opts.map((o, i) => LET[i] + ') ' + o).join('\n');
    return '<div class="' + cls + '" data-skq-k="' + k + '" data-skq-a="' + q.a + '">' +
      '<p class="skq-q"><span class="skq-n">' + bn(n) + '</span>' + inl(q.q) + '</p>' +
      '<div class="skq-os" role="group">' + opts + '</div>' +
      (done ? '<div class="skq-fb">' + fb + '</div>' : '') +
      (done && q.x ? '<div class="skq-x">💡 ' + inl(q.x) + '</div>' : '') +
      (done && !ok ? '<div class="skq-ask"><button type="button" data-q="' + esc(askTxt) + '">💬 Sky, এটা বুঝিয়ে বলো</button></div>' : '') +
      '</div>';
  }
  function setHtml(set, title) {
    const all = set.qs.filter((q) => !q.open || q.opts.length >= 4);
    const waiting = set.qs.length !== all.length || !!set.open;
    if (!all.length) return waiting ? '<div class="skq skq-pend"><div class="skq-wait"><i></i><i></i><i></i> প্রশ্ন তৈরি হচ্ছে…</div></div>' : '';
    const id = 's' + hash(all.map((q) => q.q).join('|'));
    let answered = 0, right = 0, keyed = 0;
    const items = all.map((q, n) => {
      const p = pickOf(keyOf(q));
      if (q.a >= 0) keyed++;
      if (p >= 0) { answered++; if (q.a >= 0 && p === q.a) right++; }
      return itemHtml(q, n + 1);
    }).join('');
    const N = all.length, pct = Math.round(answered * 100 / N);
    const finished = !waiting && answered === N;
    const single = N === 1 && !waiting;
    const hd = single ? '' : '<div class="skq-hd"><span class="skq-t">📝 ' + inl(title || 'কুইজ') + ' · ' + bn(N) + (waiting ? '+' : '') + 'টি প্রশ্ন</span><span class="skq-sc">' + (keyed ? '🎯 ' + bn(right) + '/' + bn(keyed) : bn(answered) + '/' + bn(N)) + '</span></div><div class="skq-bar"><i style="width:' + pct + '%"></i></div>';
    let end = '';
    if (finished && !single) {
      const p = keyed ? Math.round(right * 100 / keyed) : 0;
      const msg = !keyed ? 'সবগুলোর উত্তর দিয়েছ!' : p === 100 ? 'অসাধারণ! সবগুলোই সঠিক 🏆' : p >= 70 ? 'দারুণ হয়েছে! 👏' : p >= 40 ? 'ভালো চেষ্টা — ভুলগুলো আরেকবার দেখো 💪' : 'চিন্তা নেই, আবার চেষ্টা করলেই হবে 🌱';
      const wrongN = all.filter((q) => q.a >= 0 && pickOf(keyOf(q)) !== q.a).length;
      const more = 'এই একই টপিকে নতুন আরো ' + bn(Math.min(10, Math.max(5, N))) + 'টা MCQ দাও, উত্তর আর ব্যাখ্যাসহ।\nআগের প্রশ্নগুলোর একটা: ' + strip(all[0].q);
      end = '<div class="skq-end"><div class="skq-big">' + (keyed ? bn(right) + '<small>/' + bn(keyed) + '</small>' : '✓') + '</div><p>' + msg + (keyed ? ' — ' + bn(p) + '%' : '') + '</p><div class="skq-acts">' +
        '<button type="button" data-skq-reset="all">🔁 আবার দাও</button>' +
        (wrongN ? '<button type="button" data-skq-reset="wrong">❌ শুধু ভুলগুলো (' + bn(wrongN) + ')</button>' : '') +
        '<button type="button" data-q="' + esc(more) + '">➕ আরো প্রশ্ন</button></div></div>';
    }
    const wait = waiting ? '<div class="skq-wait"><i></i><i></i><i></i> পরের প্রশ্ন আসছে…</div>' : '';
    return '<div class="skq' + (single ? ' one' : '') + (finished ? ' fin' : '') + '" data-skq="' + id + '">' + hd + items + wait + end + '</div>';
  }

  /* text → text with each MCQ set replaced by place(html) */
  function extract(text, place, opts) {
    const live = !!(opts && opts.live);
    const segs = parse(text, live);
    if (!segs.some((s) => s.type === 'set')) return text;
    return segs.map((s) => s.type === 'text' ? s.lines.join('\n') : place(setHtml(s, opts && opts.title))).join('\n');
  }
  function jsonCard(src, live) {
    const j = parseJson(src, live);
    if (!j) return null;
    return '<div class="body md">' + setHtml({ type: 'set', qs: j.qs, open: j.open }, j.title) + '</div>';
  }

  /* ── interaction ── */
  /* question data by key, so a card can be repainted in place after a tap */
  const XMAP = Object.create(null);
  function remember(text, live) {
    try {
      const j = parseJson(text, live); const segs = j ? [{ type: 'set', qs: j.qs }] : parse(text, live);
      segs.forEach((s) => s.type === 'set' && s.qs.forEach((q) => { XMAP[keyOf(q)] = q; }));
    } catch (_) {}
  }
  function paint(card, k, onlyWrong) {
    if (!card) return;
    const keys = [...card.querySelectorAll('.skq-it')].map((it) => it.getAttribute('data-skq-k'));
    const qs = keys.map((kk) => XMAP[kk]).filter(Boolean);
    if (qs.length !== keys.length) return;
    const title = ((card.querySelector('.skq-t') || {}).textContent || '').replace(/^📝\s*/, '').replace(/\s*·.*$/, '');
    const tmp = document.createElement('div'); tmp.innerHTML = setHtml({ type: 'set', qs }, title);
    const nu = tmp.firstChild; if (!nu) return;
    if (onlyWrong || (onlyWrong == null && card.classList.contains('only-wrong'))) { nu.classList.add('only-wrong'); nu.querySelectorAll('.skq-it.right').forEach((x) => x.classList.add('hid')); }
    card.replaceWith(nu);
    if (k) {
      const it = nu.querySelector('[data-skq-k="' + k + '"]');
      if (it) it.classList.add('pop');
      const end = nu.classList.contains('fin') && nu.querySelector('.skq-end');
      if (end) setTimeout(() => { try { end.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) {} }, 250);
    }
  }
  function onClick(e) {
    const t = e.target;
    const ob = t && t.closest && t.closest('.skq-o');
    if (ob) {
      const it = ob.closest('.skq-it'); if (!it || it.classList.contains('done')) return;
      const k = it.getAttribute('data-skq-k'), pick = +ob.getAttribute('data-skq-o'), a = +it.getAttribute('data-skq-a');
      stPut(k, pick);
      paint(it.closest('.skq'), k);
      try { if (root.navigator && root.navigator.vibrate) root.navigator.vibrate(a >= 0 && a === pick ? 18 : [30, 40, 30]); } catch (_) {}
      return;
    }
    const rb = t && t.closest && t.closest('[data-skq-reset]');
    if (rb) {
      const card = rb.closest('.skq'); const mode = rb.getAttribute('data-skq-reset');
      card.querySelectorAll('.skq-it').forEach((it) => {
        const k = it.getAttribute('data-skq-k'), a = +it.getAttribute('data-skq-a');
        if (mode === 'all' || pickOf(k) !== a) stPut(k, null);
      });
      paint(card, null, mode === 'wrong');
    }
  }

  const CSS = '#app.sky .skq{margin:14px 0;padding:14px;border-radius:22px;background:var(--surf,#fff);box-shadow:0 0 0 1px var(--line,#E3E8F5),0 8px 24px rgba(27,47,143,.07)}' +
    '#app.sky .skq.one{padding:12px 14px}' +
    '#app.sky .skq-hd{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:0 2px 8px;font-size:15px;font-weight:700;color:var(--ink)}' +
    '#app.sky .skq-sc{flex:none;padding:4px 12px;border-radius:999px;background:var(--soft,#F2F5FD);color:var(--pri,#3D6BFF);font-size:15px}' +
    '#app.sky .skq-bar{height:7px;border-radius:99px;background:var(--soft,#EEF2FB);overflow:hidden;margin:0 2px 12px}#app.sky .skq-bar i{display:block;height:100%;border-radius:99px;background:var(--grad,linear-gradient(90deg,#3D6BFF,#7C4DFF));transition:width .45s cubic-bezier(.3,1.2,.5,1)}' +
    '#app.sky .skq-it{padding:14px 0 6px;border-top:1px dashed var(--line,#E3E8F5)}#app.sky .skq-hd+.skq-bar+.skq-it,#app.sky .skq.one .skq-it{border-top:0;padding-top:2px}#app.sky .skq-it.hid{display:none}' +
    '#app.sky .skq-q{display:flex;gap:10px;margin:0 0 12px;font-size:18px;line-height:1.6;font-weight:650;color:var(--ink)}' +
    '#app.sky .skq-n{flex:none;display:inline-grid;place-items:center;min-width:30px;height:30px;padding:0 6px;border-radius:10px;background:var(--grad,#3D6BFF);color:#fff;font-size:15px;font-weight:800;margin-top:1px}' +
    '#app.sky .skq-os{display:grid;gap:9px}' +
    '#app.sky .skq-o{position:relative;display:flex;align-items:center;gap:12px;width:100%;min-height:52px;padding:11px 14px;border-radius:16px;border:1.5px solid var(--line,#DDE3F2);background:var(--bg,#F7F9FF);color:var(--ink);font:inherit;font-size:17px;line-height:1.5;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s,border-color .2s,background .2s,box-shadow .2s}' +
    '#app.sky .skq-o:hover{border-color:var(--pri,#3D6BFF)}#app.sky .skq-o:active{transform:scale(.985)}#app.sky .skq-it.done .skq-o{cursor:default;pointer-events:none}' +
    '#app.sky .skq-l{flex:none;display:inline-grid;place-items:center;width:32px;height:32px;border-radius:50%;background:var(--surf,#fff);box-shadow:0 0 0 1.5px var(--line,#DDE3F2);font-weight:800;font-size:15.5px;color:var(--pri,#3D6BFF);transition:.2s}' +
    '#app.sky .skq-ot{flex:1;min-width:0}#app.sky .skq-ic{flex:none;font-weight:900;font-size:18px}' +
    '#app.sky .skq-o.ok{border-color:#12A36B;background:rgba(18,163,107,.12)}#app.sky .skq-o.ok .skq-l{background:#12A36B;color:#fff;box-shadow:none}#app.sky .skq-o.ok .skq-ic{color:#12A36B}' +
    '#app.sky .skq-o.no{border-color:#E5484D;background:rgba(229,72,77,.10)}#app.sky .skq-o.no .skq-l{background:#E5484D;color:#fff;box-shadow:none}#app.sky .skq-o.no .skq-ic{color:#E5484D}' +
    '#app.sky .skq-o.sel{border-color:var(--pri,#3D6BFF);background:rgba(61,107,255,.10)}#app.sky .skq-it.done .skq-o:not(.ok):not(.no):not(.sel){opacity:.6}' +
    '#app.sky .skq-fb{margin-top:12px;font-size:16.5px;line-height:1.6;font-weight:600}' +
    '#app.sky .skq-x{margin-top:10px;padding:11px 14px;border-radius:14px;background:rgba(255,182,61,.15);font-size:16.5px;line-height:1.75;color:var(--ink)}' +
    '#app.sky .skq-ask{margin-top:10px}#app.sky .skq-ask button,#app.sky .skq-acts button{display:inline-flex;align-items:center;gap:6px;padding:9px 15px;border-radius:999px;border:0;background:var(--soft,#EEF2FB);color:var(--pri,#3D6BFF);font:inherit;font-size:15px;font-weight:700;cursor:pointer}' +
    '#app.sky .skq-end{margin-top:14px;padding:18px 14px;border-radius:18px;text-align:center;background:var(--grad,linear-gradient(135deg,#3D6BFF,#7C4DFF));color:#fff}#app.sky .skq-big{font-size:40px;font-weight:900;line-height:1}#app.sky .skq-big small{font-size:20px;opacity:.85}#app.sky .skq-end p{margin:8px 0 12px;font-size:16.5px;font-weight:600}' +
    '#app.sky .skq-acts{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}#app.sky .skq-end .skq-acts button{background:rgba(255,255,255,.95);color:#2A3FB0}' +
    '#app.sky .skq-wait{display:flex;align-items:center;gap:6px;padding:14px 4px 4px;color:var(--mute,#6B7593);font-size:15.5px;font-weight:600}#app.sky .skq-wait i{width:8px;height:8px;border-radius:50%;background:var(--pri,#3D6BFF);opacity:.35;animation:skqb 1.1s infinite}#app.sky .skq-wait i:nth-child(2){animation-delay:.18s}#app.sky .skq-wait i:nth-child(3){animation-delay:.36s;margin-right:4px}' +
    '@keyframes skqb{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-4px)}}' +
    '@media (prefers-reduced-motion:no-preference){#app.sky .skq-it.pop.right .skq-o.ok{animation:skqok .5s cubic-bezier(.3,1.6,.5,1)}#app.sky .skq-it.pop.wrong .skq-o.no{animation:skqno .42s}#app.sky .skq-it.pop .skq-fb,#app.sky .skq-it.pop .skq-x{animation:skqup .3s both}#app.sky .skq.fin .skq-end{animation:skqup .4s both}}' +
    '@keyframes skqok{0%{transform:scale(1)}40%{transform:scale(1.035);box-shadow:0 0 0 6px rgba(18,163,107,.18)}100%{transform:scale(1)}}@keyframes skqno{0%,100%{transform:translateX(0)}20%{transform:translateX(-7px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(3px)}}@keyframes skqup{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}' +
    '#app.sky[data-sky-theme="dark"] .skq-o.ok{background:#123326;border-color:#2BC48A}#app.sky[data-sky-theme="dark"] .skq-o.no{background:#3A1A1C;border-color:#F06A6E}#app.sky[data-sky-theme="dark"] .skq-x{background:#3A2E12}#app.sky[data-sky-theme="dark"] .skq-o.sel{background:#1A2550}';

  function install() {
    try { if (!document.getElementById('skyMcqCss')) { const s = document.createElement('style'); s.id = 'skyMcqCss'; s.textContent = CSS; document.head.appendChild(s); } } catch (_) {}
    try { document.addEventListener('click', onClick, false); } catch (_) {}
  }
  if (typeof document !== 'undefined') { if (document.head) install(); else document.addEventListener('DOMContentLoaded', install); }

  /* public API used by ai-agent-chat.js (mdRich) */
  function render(text, place, opts) { remember(text, opts && opts.live); return extract(text, place, opts); }
  function renderJson(src, live) { const h = jsonCard(src, live); if (h != null) remember(src, live); return h; }
  root.SkyMCQ = { version: 'sky-mcq-v1', render, renderJson, _t: { parse, parseJson, setHtml, extract, hash, pickOf, stPut } };
})(typeof window !== 'undefined' ? window : globalThis);
