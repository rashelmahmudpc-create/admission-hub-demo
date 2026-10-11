/* Admission Hub — P18 Admission Intelligence: the visible panel.
 *
 * The student taps "ভর্তি-বুদ্ধি" on the dashboard and sees what their own
 * practice says about their admission preparation: which official subjects they
 * have covered for their chosen university + unit, which they have not touched,
 * which topics are weak, what their question-pattern looks like, and a revision
 * plan that counts down to the exam.
 *
 * Read-only: it never writes to the database and never calls a model. Classic
 * script (window/self IIFE), matching the other tool modules here.
 *
 * POLICY: no rank/pass/seat promise anywhere. If the engine ever produced such
 * a sentence the panel drops it rather than showing it.
 */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const engine = () => (typeof self !== 'undefined' ? self.AhAdmissionIntel : undefined);
  const catalog = () => (typeof self !== 'undefined' ? self.AH_AcademicCatalog : undefined);

  const CSS = `
  .ai-overlay{position:fixed;inset:0;z-index:9000;background:rgba(8,30,24,.55);display:flex;align-items:flex-end;justify-content:center}
  .ai-sheet{width:100%;max-width:560px;max-height:92vh;display:flex;flex-direction:column;background:var(--card,#fff);border-radius:20px 20px 0 0;overflow:hidden;box-shadow:0 -8px 40px rgba(0,0,0,.3)}
  .ai-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--line,rgba(15,107,79,.12));font-size:16px}
  .ai-x{border:0;background:none;font-size:22px;line-height:1;cursor:pointer;color:var(--sub,#5F7A72)}
  .ai-body{padding:16px 18px;overflow-y:auto}
  .ai-hero{border-radius:14px;padding:14px 15px;background:linear-gradient(135deg,#EFF7F2,#DBF3E6);margin-bottom:16px}
  .ai-hero small{color:var(--sub,#5F7A72);font-size:11.5px}
  .ai-hero p{margin:5px 0 0;font-size:13.5px;line-height:1.5;color:var(--ink,#16302A)}
  .ai-sec{margin-bottom:18px}
  .ai-sec h4{margin:0 0 9px;font-size:12.5px;color:var(--sub,#5F7A72);text-transform:uppercase;letter-spacing:.04em}
  .ai-chips{display:flex;flex-wrap:wrap;gap:6px}
  .ai-chip{font-size:11.5px;padding:4px 10px;border-radius:20px;background:rgba(15,107,79,.12);color:#0E6B4F;font-weight:600}
  .ai-chip.miss{background:rgba(192,57,43,.12);color:#C0392B}
  .ai-row{display:flex;align-items:center;gap:9px;padding:8px 0;border-bottom:1px solid var(--line,rgba(15,107,79,.08))}
  .ai-row:last-child{border-bottom:0}
  .ai-row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--ink,#16302A)}
  .ai-bar{flex:0 0 84px;height:7px;border-radius:5px;background:rgba(15,107,79,.12);overflow:hidden}
  .ai-bar i{display:block;height:100%;background:#0E6B4F}
  .ai-bar i.low{background:#C0392B}
  .ai-pc{flex:0 0 38px;text-align:right;font-size:12px;font-weight:700;color:var(--sub,#5F7A72)}
  .ai-day{border:1px solid var(--line,rgba(15,107,79,.12));border-radius:12px;padding:11px 12px;margin-bottom:8px}
  .ai-day b{font-size:13px;color:var(--ink,#16302A)}
  .ai-day p{margin:6px 0 0;font-size:12.5px;color:var(--sub,#5F7A72)}
  .ai-note{margin-top:14px;font-size:11.5px;line-height:1.5;color:var(--sub,#5F7A72);border-top:1px solid var(--line,rgba(15,107,79,.12));padding-top:12px}`;

  function injectCss() {
    if (document.getElementById('aiStyle')) return;
    const st = document.createElement('style');
    st.id = 'aiStyle';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  const results = () => (typeof CACHE !== 'undefined' && Array.isArray(CACHE.examResults) ? CACHE.examResults : []);
  const questions = () => (typeof CACHE !== 'undefined' && Array.isArray(CACHE.questions) ? CACHE.questions : []);
  const topics = () => (typeof CACHE !== 'undefined' && Array.isArray(CACHE.topics) ? CACHE.topics : []);
  function goal() {
    try {
      if (typeof CACHE !== 'undefined' && CACHE && CACHE.settings && CACHE.settings.dv2Goal) return CACHE.settings.dv2Goal;
    } catch (_) {}
    return {};
  }

  const DIFF_LABEL = { easy: 'সহজ', medium: 'মাঝারি', hard: 'কঠিন' };
  const safeText = (s) => { const E = engine(); return (!E || E.guaranteeSafe(s)) ? s : ''; };

  function coverageHtml(cov, mapReason) {
    if (!cov.total) {
      return `<div class="ai-hero"><small>সাবজেক্ট-মানচিত্র</small><p>বিশ্ববিদ্যালয় ও ইউনিট সেট করলে তোমার অফিসিয়াল সাবজেক্টের তালিকা এখানে দেখাবে।</p></div>`;
    }
    return `<div class="ai-hero"><small>${esc(mapReason === 'ok' ? 'তোমার সাবজেক্ট-কভারেজ' : 'সাবজেক্ট')}</small><p>অফিসিয়াল ${cov.total}টি সাবজেক্টের মধ্যে ${cov.covered}টিতে অভ্যাস হয়েছে (${cov.percent}%)।</p></div>
      <div class="ai-sec"><h4>অফিসিয়াল সাবজেক্ট</h4><div class="ai-chips">${cov.subjects.map((s) =>
        `<span class="ai-chip${s.practised ? '' : ' miss'}">${esc(s.subject)}</span>`).join('')}</div></div>`;
  }

  function topicsHtml(list) {
    if (!list.length) return '';
    return `<div class="ai-sec"><h4>টপিক-দক্ষতা</h4>${list.slice(0, 8).map((t) =>
      `<div class="ai-row"><span class="nm">${esc(t.name)}${t.confident ? '' : ' · কম ডেটা'}</span><span class="ai-bar"><i class="${t.accuracy < 50 ? 'low' : ''}" style="width:${t.accuracy}%"></i></span><span class="ai-pc">${t.accuracy}%</span></div>`).join('')}</div>`;
  }

  function patternHtml(rows) {
    const any = rows.some((r) => r.attempted);
    if (!any) return '';
    return `<div class="ai-sec"><h4>প্রশ্ন-প্যাটার্ন</h4>${rows.map((r) =>
      `<div class="ai-row"><span class="nm">${esc(DIFF_LABEL[r.difficulty])}</span><span class="ai-bar"><i class="${r.accuracy < 50 ? 'low' : ''}" style="width:${r.accuracy}%"></i></span><span class="ai-pc">${r.attempted ? r.accuracy + '%' : '—'}</span></div>`).join('')}</div>`;
  }

  function planHtml(days) {
    if (!days.length) return '';
    return `<div class="ai-sec"><h4>রিভিশন-প্ল্যান</h4>${days.map((d) =>
      `<div class="ai-day"><b>দিন ${d.day}</b>${d.blocks.map((b) =>
        `<p>${esc(b.name || b.subject)}${b.questions ? ' · ' + b.questions + ' প্রশ্ন' : ''} — ${esc(safeText(b.why))}</p>`).join('')}</div>`).join('')}</div>`;
  }

  function open() {
    const E = engine();
    if (!E) { window.toast && window.toast('ভর্তি-বুদ্ধি ইঞ্জিন এখনো লোড হয়নি'); return; }
    injectCss();
    const plan = E.build({ results: results(), questions: questions(), topics: topics(), goal: goal(), catalog: catalog() });
    let el = document.getElementById('aiPanel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'aiPanel';
      el.className = 'ai-overlay';
      document.body.appendChild(el);
    }
    const head = plan.university ? `${esc(plan.university.name)} — ${esc(plan.unit ? plan.unit.label + ' Unit' : '')}` : '';
    el.innerHTML = `
      <div class="ai-sheet">
        <div class="ai-head"><b>🏆 ভর্তি-বুদ্ধি</b><button class="ai-x" onclick="window.closeAdmissionIntelPanel()">×</button></div>
        <div class="ai-body">
          ${head ? `<div class="ai-hero"><small>তোমার লক্ষ্য</small><p>${head}</p></div>` : ''}
          <div class="ai-hero"><small>সারসংক্ষেপ</small><p>${esc(safeText(plan.message))}</p></div>
          ${coverageHtml(plan.coverage, plan.mapReason)}
          ${topicsHtml(plan.topics)}
          ${patternHtml(plan.pattern)}
          ${planHtml(plan.plan)}
          <div class="ai-note">এটা তোমার নিজের অভ্যাসের ডেটা থেকে তৈরি পরামর্শ — কোনো র‍্যাঙ্ক, পাস বা আসনের নিশ্চয়তা নয়।</div>
        </div>
      </div>`;
  }

  window.openAdmissionIntelPanel = open;
  window.closeAdmissionIntelPanel = () => { const el = document.getElementById('aiPanel'); if (el) el.remove(); };
})();
