/**
 * Question Bank Performance Layer v4
 * 
 * Strategy: Pagination - show 20 questions per page with Next/Previous buttons.
 * This eliminates all scrolling issues permanently.
 * 
 * Also: in-place card patching for answer clicks (no scroll reset),
 * numeric question ordering, stable question numbers.
 * 
 * NO virtualization, NO scroll manipulation, NO auto-scroll.
 */
(() => {
  'use strict';

  const practice = window.QuestionBankPracticeSession;
  if (!practice) return;

  const PAGE_SIZE = 20;
  let currentPage = 0;

  const esc = s => { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; };
  const answerFor = q => Number(q?.answerIndex ?? q?.answer ?? 0);

  // --- In-place card patch (no re-render, no scroll change) ---
  function patchCardInPlace(qid) {
    const q = CACHE.questions.find(x => x.id === qid);
    if (!q) return;
    const card = document.querySelector(`[data-qid="${CSS.escape(qid)}"]`);
    if (!card) return;

    const state = practice.answers[qid];
    const revealed = practice.revealed[qid] || state;
    const correct = answerFor(q);

    // Update status badge
    const statusEl = card.querySelector('.q-status');
    if (statusEl) {
      const status = state ? (state.correct ? 'Correct' : 'Wrong') : 'Unattempted';
      const statusClass = state ? (state.correct ? 'correct' : 'wrong') : 'unattempted';
      statusEl.className = `q-status ${statusClass}`;
      statusEl.textContent = status;
    }

    // Update options
    const opts = card.querySelectorAll('.q-opt-v2');
    opts.forEach((btn, j) => {
      btn.className = 'q-opt-v2';
      if (state) {
        if (j === correct) btn.classList.add('correct');
        else if (j === state.selected) btn.classList.add('wrong');
        btn.disabled = true;
      } else if (revealed && j === correct) {
        btn.classList.add('correct');
      }
      let icon = btn.querySelector('.q-opt-icon');
      if (state || revealed) {
        if (j === correct) {
          if (!icon) { icon = document.createElement('span'); icon.className = 'q-opt-icon'; btn.appendChild(icon); }
          icon.textContent = '✓';
        } else if (state && j === state.selected) {
          if (!icon) { icon = document.createElement('span'); icon.className = 'q-opt-icon'; btn.appendChild(icon); }
          icon.textContent = '✕';
        } else if (icon) { icon.remove(); }
      }
    });

    // Add explanation if needed
    let explanation = card.querySelector('.q-explanation-v2');
    if (revealed && !explanation) {
      const expDiv = document.createElement('div');
      const cls = state?.correct ? 'correct' : state ? 'wrong' : 'revealed';
      expDiv.className = `q-explanation-v2 ${cls}`;
      const label = state ? (state.correct ? '✓ Correct' : '✕ Wrong') : 'Answer revealed';
      expDiv.innerHTML = `<strong>${label}</strong><p>Correct answer: ${esc((q.options || [])[correct] || '')}</p>${q.explanation ? `<p>${esc(q.explanation)}</p>` : ''}`;
      const optionsDiv = card.querySelector('.q-options-v2');
      if (optionsDiv) optionsDiv.after(expDiv);
    }

    // Remove "Show Answer" button and add the manual note action after a wrong answer.
    if (revealed || state) {
      const showBtn = [...card.querySelectorAll('.q-footer-btn')].find(b => b.textContent.includes('Show Answer'));
      if (showBtn) showBtn.remove();
    }
    if (state && !state.correct && window.AiExplain && !card.querySelector('.aiex-wrap')) {
      const anchor = card.querySelector('.q-explanation-v2') || card.querySelector('.q-options-v2');
      if (anchor) {
        const row = document.createElement('div');
        row.className = 'q-aiex-row';
        row.style.cssText = 'margin:10px 0 4px';
        const crumb = String(card.querySelector('.q-breadcrumb')?.textContent || '').split('•');
        row.innerHTML = window.AiExplain.btn(qid, { q, options: q.options || [], correctText: (q.options || [])[correct] || '', student: state.selected, wrong: true, subject: String(crumb[0] || '').trim(), topic: String(crumb[1] || '').trim(), mode: 'bank' });
        anchor.after(row);
      }
    }

    updateFooterStats();
  }

  function updateFooterStats() {
    const topicId = ExplorerState.topicId;
    if (!topicId) return;
    const allQs = CACHE.questions.filter(q => q.topicId === topicId);
    const answered = allQs.filter(q => practice.answers[q.id]);
    const acc = answered.length ? Math.round(answered.filter(q => practice.answers[q.id].correct).length / answered.length * 100) : 0;
    const mistakeCount = answered.filter(q => !practice.answers[q.id].correct).length;

    document.querySelectorAll('.q-card-footer').forEach(footer => {
      const spans = footer.querySelectorAll(':scope > span');
      if (spans[0]) spans[0].innerHTML = `Accuracy <strong>${acc}%</strong>`;
      if (spans[1]) spans[1].innerHTML = `Mistakes <strong>${mistakeCount}</strong>`;
    });

    const summarySpans = document.querySelectorAll('.q-feed-summary span');
    if (summarySpans[1]) summarySpans[1].textContent = `${answered.length}/${allQs.length} answered`;
  }

  // --- Override selectTopicAnswer ---
  window.selectTopicAnswer = (qid, idx) => {
    if (practice.topicId !== ExplorerState.topicId || practice.answers[qid]) return;
    const q = CACHE.questions.find(x => x.id === qid);
    if (!q || q.topicId !== ExplorerState.topicId) return;
    const correct = answerFor(q);
    practice.answers[qid] = { selected: idx, correct: idx === correct, answeredAt: Date.now() };
    practice.recent = [qid, ...practice.recent.filter(id => id !== qid)];
    patchCardInPlace(qid);
  };

  // --- Override revealTopicAnswer ---
  window.revealTopicAnswer = qid => {
    const q = CACHE.questions.find(x => x.id === qid);
    if (!q || q.topicId !== ExplorerState.topicId || practice.answers[qid]) return;
    practice.revealed[qid] = true;
    patchCardInPlace(qid);
  };

  // --- Override toggleQuestionBookmark for in-place update ---
  const originalToggleBookmark = window.toggleQuestionBookmark;
  window.toggleQuestionBookmark = function(id) {
    const q = CACHE.questions.find(x => x.id === id);
    if (!q) return;
    if (ExplorerState.topicId && document.querySelector(`[data-qid="${CSS.escape(id)}"]`)) {
      q.bookmarked = !q.bookmarked;
      q.bookmarkUpdatedAt = Date.now();
      dbPut('questions', q).then(() => {
        const card = document.querySelector(`[data-qid="${CSS.escape(id)}"]`);
        if (card) {
          const bmBtn = [...card.querySelectorAll('.q-footer-btn')].find(b => b.textContent.includes('Bookmark'));
          if (bmBtn) {
            bmBtn.classList.toggle('active', !!q.bookmarked);
            bmBtn.setAttribute('aria-pressed', String(!!q.bookmarked));
            bmBtn.innerHTML = `⭐ ${q.bookmarked ? 'Bookmarked' : 'Bookmark'}`;
          }
        }
        toast(q.bookmarked ? 'Question bookmarked' : 'Bookmark removed');
      }).catch(() => { q.bookmarked = !q.bookmarked; toast('Could not update bookmark'); });
    } else {
      if (originalToggleBookmark) originalToggleBookmark(id);
    }
  };

  // --- Pagination navigation ---
  window.qbankGoToPage = function(page) {
    currentPage = page;
    window.scrollTo(0, 0);
    renderCurrentPage();
  };

  function renderCurrentPage() {
    const feedBody = document.querySelector('.q-feed-body');
    if (!feedBody) return;

    const topicId = ExplorerState.topicId;
    const topic = CACHE.topics.find(t => t.id === topicId);
    const subject = CACHE.subjects.find(s => s.id === topic?.subjectId);
    if (!topic || !subject) return;

    const qs = getFilteredQuestions(topicId);
    const totalPages = Math.ceil(qs.length / PAGE_SIZE);
    if (currentPage >= totalPages) currentPage = Math.max(0, totalPages - 1);

    const start = currentPage * PAGE_SIZE;
    const pageQs = qs.slice(start, start + PAGE_SIZE);

    const cardsHtml = pageQs.map((q, i) => buildCard(q, start + i, topic, subject)).join('');
    const paginationHtml = buildPagination(currentPage, totalPages, qs.length);

    feedBody.innerHTML = cardsHtml + paginationHtml;

    // Update summary
    const summarySpans = document.querySelectorAll('.q-feed-summary span');
    const allQs = CACHE.questions.filter(q => q.topicId === topicId);
    const answered = allQs.filter(q => practice.answers[q.id]);
    if (summarySpans[0]) summarySpans[0].textContent = `${qs.length} question${qs.length === 1 ? '' : 's'} · Page ${currentPage + 1}/${totalPages}`;
    if (summarySpans[1]) summarySpans[1].textContent = `${answered.length}/${allQs.length} answered`;
  }

  function getFilteredQuestions(topicId) {
    let all = CACHE.questions.filter(q => q.topicId === topicId);
    // Keep original order from CACHE (same as before any update)
    const query = String(practice.query || '').trim().toLowerCase();
    if (query) all = all.filter(q => [q.question, ...(q.options || [])].join(' ').toLowerCase().includes(query));
    const filter = ExplorerState.status || 'all';
    if (filter === 'unattempted') return all.filter(q => !practice.answers[q.id]);
    if (filter === 'mistakes') return all.filter(q => practice.answers[q.id] && !practice.answers[q.id].correct);
    if (filter === 'bookmarked') return all.filter(q => q.bookmarked === true);
    if (filter === 'recent') return practice.recent.map(id => all.find(q => q.id === id)).filter(Boolean);
    return all;
  }

  function getNum(q) {
    if (q.questionNumber != null) { const n = Number(q.questionNumber); if (Number.isFinite(n)) return n; }
    if (q.number != null) { const n = Number(q.number); if (Number.isFinite(n)) return n; }
    const match = String(q.sourceQuestionId || q.id || '').match(/(\d+)$/);
    return match ? Number(match[1]) : 99999;
  }

  // Build a map of question id -> serial number (1 to n) for the full topic
  function getSerialMap(topicId) {
    const all = CACHE.questions.filter(x => x.topicId === topicId);
    const map = new Map();
    all.forEach((q, i) => map.set(q.id, i + 1));
    return map;
  }

  function buildCard(q, index, topic, subject) {
    const topicPath = window.topicHierarchy?.topicDisplayName ? window.topicHierarchy.topicDisplayName(topic) : topic.name;
    const state = practice.answers[q.id];
    const revealed = practice.revealed[q.id] || state;
    const correct = answerFor(q);
    // Use serial number from full topic list (1 to n)
    const serialMap = getSerialMap(topic.id);
    const number = serialMap.get(q.id) || (index + 1);
    const status = state ? (state.correct ? 'Correct' : 'Wrong') : 'Unattempted';
    const statusClass = state ? (state.correct ? 'correct' : 'wrong') : 'unattempted';
    const opts = (q.options || []).map((o, j) => {
      let cls = '';
      if (state) { if (j === correct) cls = 'correct'; else if (j === state.selected) cls = 'wrong'; }
      else if (revealed && j === correct) cls = 'correct';
      return `<button class="q-opt-v2 ${cls}" type="button" ${state ? 'disabled' : ''} aria-label="Option ${String.fromCharCode(65 + j)}" onclick="selectTopicAnswer('${esc(q.id)}',${j})"><span class="q-opt-letter">${String.fromCharCode(65 + j)}</span><span class="q-opt-text">${esc(o)}</span>${cls === 'correct' && (state || revealed) ? '<span class="q-opt-icon">✓</span>' : ''}${cls === 'wrong' ? '<span class="q-opt-icon">✕</span>' : ''}</button>`;
    }).join('');
    const expHtml = revealed ? `<div class="q-explanation-v2 ${state?.correct ? 'correct' : state ? 'wrong' : 'revealed'}"><strong>${state ? (state.correct ? '✓ Correct' : '✕ Wrong') : 'Answer revealed'}</strong><p>Correct answer: ${esc((q.options || [])[correct] || '')}</p>${q.explanation ? `<p>${esc(q.explanation)}</p>` : ''}</div>` : '';
    const allQs = CACHE.questions.filter(x => x.topicId === topic.id);
    const answered = allQs.filter(x => practice.answers[x.id]);
    const acc = answered.length ? Math.round(answered.filter(x => practice.answers[x.id].correct).length / answered.length * 100) : 0;
    const mistakeCount = answered.filter(x => !practice.answers[x.id].correct).length;

    return `<article class="q-card-v2 card" data-qid="${esc(q.id)}"><div class="q-card-header"><div class="q-card-meta"><span class="q-card-num">Q ${String(number).padStart(2, '0')}</span><span class="q-breadcrumb">${esc(subject?.name || '')} • ${esc(topicPath)}</span></div><span class="q-status ${statusClass}">${status}</span></div><div class="q-text-v2">${esc(q.question)}</div><div class="q-options-v2">${opts}</div>${expHtml}${state && !state.correct && window.AiExplain ? `<div class="q-aiex-row" style="margin:10px 0 4px">${AiExplain.btn(q.id, { q, options: q.options || [], correctText: (q.options || [])[correct] || '', student: state.selected, wrong: true, subject: esc(String((subject && subject.name) || '')), topic: esc(String(topicPath || '')), mode: 'bank' })}</div>` : ''}<footer class="q-card-footer"><span>Accuracy <strong>${acc}%</strong></span><span>Mistakes <strong>${mistakeCount}</strong></span><button class="q-footer-btn ${q.bookmarked ? 'active' : ''}" type="button" aria-pressed="${!!q.bookmarked}" onclick="toggleQuestionBookmark('${esc(q.id)}')">⭐ ${q.bookmarked ? 'Bookmarked' : 'Bookmark'}</button>${!revealed ? `<button class="q-footer-btn" type="button" onclick="revealTopicAnswer('${esc(q.id)}')">Show Answer</button>` : ''}</footer></article>`;
  }

  function buildPagination(page, totalPages, totalQuestions) {
    if (totalPages <= 1) return '';
    const prevDisabled = page === 0;
    const nextDisabled = page >= totalPages - 1;
    const pageButtons = Array.from({ length: totalPages }, (_, i) => `<button class="qbank-page-btn ${i === page ? 'active' : ''}" type="button" ${i === page ? 'aria-current="page"' : ''} onclick="qbankGoToPage(${i})">${i + 1}</button>`).join('');
    return `<div class="qbank-pagination">
      <div class="qbank-page-nav">
        <button class="qbank-page-btn ${prevDisabled ? 'disabled' : ''}" ${prevDisabled ? 'disabled' : ''} onclick="qbankGoToPage(${page - 1})">← Previous</button>
        <span class="qbank-page-info">Page ${page + 1} of ${totalPages}</span>
        <button class="qbank-page-btn ${nextDisabled ? 'disabled' : ''}" ${nextDisabled ? 'disabled' : ''} onclick="qbankGoToPage(${page + 1})">Next →</button>
      </div>
      <div class="qbank-page-numbers">${pageButtons}</div>
    </div>`;
  }

  // --- Override renderQuestionBankV2 for topic feed only ---
  const originalRender = window.renderQuestionBankV2;
  window.renderQuestionBankV2 = function() {
    const path = Router.path || location.hash.slice(1);

    if (String(path).startsWith('question-bank/topic/')) {
      const topicId = decodeURIComponent(String(path).split('/')[2] || '');
      const topic = CACHE.topics?.find(t => t.id === topicId);
      const subject = CACHE.subjects?.find(s => s.id === topic?.subjectId);

      if (!topic || !subject) {
        return originalRender ? originalRender() : undefined;
      }

      ExplorerState.topicId = topicId;
      ExplorerState.subjectId = topic.subjectId || '';

      // Reset practice if topic changed
      if (practice.topicId !== topicId) {
        practice.topicId = topicId;
        practice.answers = {};
        practice.revealed = {};
        practice.recent = [];
        practice.query = '';
        practice.visibleCount = 100;
        window.BankAnswers = {};
        currentPage = 0;
      }

      const qs = getFilteredQuestions(topicId);
      const totalPages = Math.ceil(qs.length / PAGE_SIZE);
      if (currentPage >= totalPages) currentPage = Math.max(0, totalPages - 1);
      const start = currentPage * PAGE_SIZE;
      const pageQs = qs.slice(start, start + PAGE_SIZE);

      const allQs = CACHE.questions.filter(q => q.topicId === topicId);
      const answered = allQs.filter(q => practice.answers[q.id]);
      const filter = ExplorerState.status || 'all';
      const count = f => f === 'all' ? allQs.length : f === 'bookmarked' ? allQs.filter(q => q.bookmarked).length : f === 'unattempted' ? allQs.filter(q => !practice.answers[q.id]).length : f === 'mistakes' ? allQs.filter(q => practice.answers[q.id] && !practice.answers[q.id].correct).length : practice.recent.length;
      const tabs = [['all','All'],['unattempted','Unattempted'],['mistakes','Mistakes'],['bookmarked','Bookmarked'],['recent','Recent']];

      const cardsHtml = pageQs.map((q, i) => buildCard(q, start + i, topic, subject)).join('');
      const paginationHtml = buildPagination(currentPage, totalPages, qs.length);

      const topicPath = window.topicHierarchy?.topicDisplayName ? window.topicHierarchy.topicDisplayName(topic) : topic.name;
      const html = `<div class="q-bank-container"><header class="q-bank-header"><div class="row between"><div class="row"><button class="q-back-btn" type="button" aria-label="Back to topics" onclick="leaveTopic()">‹</button><div><h1>${esc(topic.name)}</h1><p>Practice / ${esc(subject.name)} / ${esc(topicPath)}</p></div></div></div></header><div class="q-filter-tabs-v2" role="tablist">${tabs.map(([k,l]) => `<button type="button" role="tab" aria-selected="${filter === k}" class="${filter === k ? 'active' : ''}" onclick="qbankSetFilter('${k}')">${l} <span>${count(k)}</span></button>`).join('')}</div><div class="q-search-box"><input type="search" inputmode="search" aria-label="Search questions" placeholder="Search this topic..." value="${esc(practice.query || '')}" oninput="qbankSearch(this.value)"></div><div class="q-feed-summary"><span>${qs.length} question${qs.length === 1 ? '' : 's'} · Page ${currentPage + 1}/${totalPages || 1}</span><span>${answered.length}/${allQs.length} answered</span></div><div class="q-feed-body">${cardsHtml || '<div class="empty card">No questions match this filter.</div>'}${paginationHtml}</div></div>`;

      renderShell(html, { title: topic.name, back: "leaveTopic()" });
      window.scrollTo(0, 0);
      return;
    }

    // For non-topic views, use original
    return originalRender ? originalRender() : undefined;
  };

  // --- Filter and search ---
  window.qbankSetFilter = function(filter) {
    ExplorerState.status = filter;
    currentPage = 0;
    window.renderQuestionBankV2();
  };

  window.qbankSearch = function(value) {
    practice.query = String(value || '');
    currentPage = 0;
    clearTimeout(window.__qbankSearchTimer);
    window.__qbankSearchTimer = setTimeout(() => {
      renderCurrentPage();
    }, 200);
  };

  // --- Ensure nextQuestionNumberForTopic ---
  if (typeof window.nextQuestionNumberForTopic !== 'function') {
    window.nextQuestionNumberForTopic = function(topicId, excludeId) {
      const numbers = (CACHE.questions || [])
        .filter(q => q.topicId === topicId && q.id !== excludeId)
        .map(q => Number(q.questionNumber ?? q.number))
        .filter(Number.isFinite);
      return (numbers.length ? Math.max(...numbers) : (CACHE.questions || []).filter(q => q.topicId === topicId).length) + 1;
    };
  }

  // --- Pagination CSS ---
  const style = document.createElement('style');
  style.id = 'qbank-pagination-style';
  style.textContent = `.qbank-pagination{display:flex;flex-direction:column;align-items:stretch;gap:10px;padding:16px 4px;margin-top:8px;border-top:1px solid var(--line);overflow:hidden}.qbank-page-nav{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%}.qbank-page-btn{background:var(--emerald);color:#fff;border:none;border-radius:11px;padding:12px 18px;font-size:14px;font-weight:700;cursor:pointer;transition:opacity .2s}.qbank-page-btn:active{opacity:.8}.qbank-page-btn.disabled{background:var(--line);color:var(--sub);cursor:not-allowed;opacity:.6}.qbank-page-nav .qbank-page-btn{flex:0 0 auto}.qbank-page-numbers{display:flex;align-items:center;gap:6px;width:100%;min-width:0;overflow-x:auto;flex-wrap:nowrap;justify-content:center;white-space:nowrap;scrollbar-width:thin}.qbank-page-numbers .qbank-page-btn{flex:0 0 auto}.qbank-page-info{font-size:13px;font-weight:600;color:var(--sub);flex:0 0 auto;white-space:nowrap}`;
  document.head.appendChild(style);
})();
