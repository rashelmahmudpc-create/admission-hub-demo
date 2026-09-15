(() => {
  'use strict';

  const escT = (value) => typeof esc === 'function'
    ? esc(String(value ?? ''))
    : String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const refreshCache = async () => {
    CACHE.subjects = await dbGetAll('subjects');
    CACHE.topics = await dbGetAll('topics');
    CACHE.questions = await dbGetAll('questions');
  };
  const topicQuestions = id => CACHE.questions.filter(q => q.topicId === id);
  const topicProgress = id => {
    const qs = topicQuestions(id);
    const attempted = qs.reduce((n, q) => n + Number(q.stats?.attempts || 0), 0);
    const correct = qs.reduce((n, q) => n + Number(q.stats?.correct || 0), 0);
    return attempted ? Math.round(correct / attempted * 100) : 0;
  };

  function topicCard(topic) {
    const qs = topicQuestions(topic.id);
    return `<article class="urgent-topic-card"><div class="urgent-topic-row">
      <button class="urgent-topic-main" type="button" onclick="openUrgentTopicQuestions('${escT(topic.id)}')">
        <span class="urgent-topic-folder" aria-hidden="true">📁</span>
        <span class="urgent-topic-copy"><strong>${escT(topic.name)}</strong></span>
        <span class="urgent-topic-arrow" aria-hidden="true">›</span>
      </button>
      <div class="urgent-topic-bottom">
        <span class="urgent-topic-count">${qs.length} question${qs.length === 1 ? '' : 's'} · ${topicProgress(topic.id)}% progress</span>
        <div class="urgent-topic-actions">
          <button type="button" class="urgent-topic-action urgent-topic-icon-action" aria-label="Rename topic ${escT(topic.name)}" title="Rename topic" onclick="event.stopPropagation();openUrgentTopicForm('${escT(topic.subjectId)}','${escT(topic.id)}')">✏️</button>
          <button type="button" class="urgent-topic-action urgent-topic-icon-action urgent-topic-delete" aria-label="Delete topic ${escT(topic.name)}" title="Delete topic" onclick="event.stopPropagation();deleteUrgentTopic('${escT(topic.id)}')">🗑️</button>
        </div>
      </div>
    </div></article>`;
  }

  function renderUrgentTopicList() {
    const subjectId = Router.path.split('/')[2];
    const subject = CACHE.subjects.find(s => s.id === subjectId);
    if (!subject) { location.hash = 'question-bank'; return; }
    const topics = CACHE.topics.filter(t => t.subjectId === subjectId).sort((a, b) => (a.order || 0) - (b.order || 0));
    const totalQuestions = topics.reduce((n, t) => n + topicQuestions(t.id).length, 0);
    const html = `<div class="urgent-qbank-page">
      <header class="urgent-qbank-head">
        <div class="urgent-qbank-head-row">
          <button class="urgent-qbank-back" type="button" onclick="location.hash='question-bank'">‹</button>
          <div><div class="urgent-kicker">QUESTION BANK</div><h1>${escT(subject.icon || '📘')} ${escT(subject.name)}</h1><p>${topics.length} topic${topics.length === 1 ? '' : 's'} · ${totalQuestions} question${totalQuestions === 1 ? '' : 's'}</p></div>
          <button class="urgent-add-topic" type="button" onclick="openUrgentTopicForm('${escT(subjectId)}',null)">＋</button>
        </div>
      </header>
      <div class="urgent-topic-toolbar"><strong>All topics</strong><span>Choose a topic to view its questions</span></div>
      <div class="urgent-topic-list">${topics.length ? topics.map(topicCard).join('') : `<div class="urgent-topic-empty"><div>📂</div><strong>No topics yet</strong><p>Add the first topic for ${escT(subject.name)}.</p><button class="urgent-primary" type="button" onclick="openUrgentTopicForm('${escT(subjectId)}',null)">＋ Add Topic</button></div>`}</div>
    </div>`;
    renderShell(html, { title: subject.name, back: "navigate('question-bank')" });
  }

  window.openUrgentTopicQuestions = id => {
    const topic = CACHE.topics.find(t => t.id === id);
    if (topic) location.hash = `question-bank/topic/${encodeURIComponent(id)}`;
  };

  window.openUrgentTopicForm = (subjectId, topicId) => {
    const topic = topicId ? CACHE.topics.find(t => t.id === topicId) : null;
    const subject = CACHE.subjects.find(s => s.id === subjectId);
    if (!subject) return;
    const modal = document.createElement('div');
    modal.className = 'urgent-modal-bg';
    modal.id = 'urgentTopicModal';
    modal.innerHTML = `<div class="urgent-modal" role="dialog" aria-modal="true"><div class="urgent-modal-head"><h2>${topic ? 'Edit Topic' : 'Add Topic'}</h2><button type="button" onclick="closeUrgentTopicForm()">×</button></div><p class="urgent-modal-sub">Subject: <strong>${escT(subject.name)}</strong></p><label class="urgent-label" for="urgentTopicName">Topic name</label><input class="urgent-input" id="urgentTopicName" value="${escT(topic?.name || '')}" placeholder="e.g. সাহিত্য"><label class="urgent-label" for="urgentTopicDescription">Description <span>(optional)</span></label><textarea class="urgent-input" id="urgentTopicDescription" rows="3" placeholder="Short description">${escT(topic?.description || '')}</textarea><div class="urgent-modal-actions"><button class="urgent-secondary" type="button" onclick="closeUrgentTopicForm()">Cancel</button><button class="urgent-primary" type="button" onclick="saveUrgentTopic('${escT(subjectId)}',${topic ? `'${escT(topicId)}'` : 'null'})">${topic ? 'Save changes' : 'Add Topic'}</button></div></div>`;
    document.body.appendChild(modal);
    document.getElementById('urgentTopicName')?.focus();
  };
  window.closeUrgentTopicForm = () => document.getElementById('urgentTopicModal')?.remove();
  window.saveUrgentTopic = async (subjectId, topicId) => {
    const name = document.getElementById('urgentTopicName')?.value.trim();
    const description = document.getElementById('urgentTopicDescription')?.value.trim() || '';
    if (!name) { if (typeof toast === 'function') toast('Topic name is required'); return; }
    const sameSubject = CACHE.topics.filter(t => t.subjectId === subjectId && t.id !== topicId);
    if (sameSubject.some(t => t.name.trim().toLowerCase() === name.toLowerCase())) { if (typeof toast === 'function') toast('A topic with this name already exists in this subject'); return; }
    if (topicId) {
      const topic = CACHE.topics.find(t => t.id === topicId);
      if (!topic) return;
      topic.name = name; topic.description = description; topic.updatedAt = Date.now();
      await dbPut('topics', topic);
    } else {
      await dbPut('topics', { id: uid(), subjectId, name, description, order: sameSubject.length, createdAt: Date.now(), updatedAt: Date.now() });
    }
    await refreshCache();
    closeUrgentTopicForm();
    renderUrgentTopicList();
    if (typeof toast === 'function') toast(topicId ? 'Topic updated' : 'Topic added');
  };

  window.deleteUrgentTopic = async topicId => {
    const topic = CACHE.topics.find(t => t.id === topicId);
    if (!topic) return;
    const questions = topicQuestions(topicId);
    const message = questions.length
      ? `This topic has ${questions.length} question${questions.length === 1 ? '' : 's'}. Delete the topic and move its questions to Deleted Questions? You can permanently remove them later from Trash.`
      : `Delete topic “${topic.name}”?`;
    if (!window.confirm(message)) return;
    for (const question of questions) await dbDel('questions', question.id);
    await dbDel('topics', topicId);
    await refreshCache();
    renderUrgentTopicList();
    if (typeof toast === 'function') toast(questions.length ? 'Topic deleted; linked questions moved to Deleted Questions' : 'Topic deleted safely');
  };

  const previousRenderSubjectDetail = window.renderSubjectDetail;
  window.renderSubjectDetail = function urgentSubjectDetailOverride(subjectId) {
    if (subjectId) {
      Router.path = `question-bank/subject/${subjectId}`;
      return typeof window.renderQuestionBankV2 === 'function' ? window.renderQuestionBankV2() : previousRenderSubjectDetail(subjectId);
    }
    return previousRenderSubjectDetail(subjectId);
  };
  const previousRenderQuestionBank = window.renderQuestionBank;
  window.renderQuestionBank = function urgentQuestionBankOverride() {
    if (typeof ExplorerState !== 'undefined' && ExplorerState.subjectId && !ExplorerState.topicId) return typeof window.renderQuestionBankV2 === 'function' ? window.renderQuestionBankV2() : previousRenderQuestionBank();
    return previousRenderQuestionBank();
  };
  const previousRender = window.render;
  window.render = function urgentTopicRouteOverride() {
    const path = (typeof Router !== 'undefined' ? Router.path : location.hash.slice(1)) || 'dashboard';
    if (path.startsWith('question-bank/subject/') || path.startsWith('question-bank/topic/')) return typeof window.renderQuestionBankV2 === 'function' ? window.renderQuestionBankV2() : previousRender();
    if (path === 'question-bank' && typeof ExplorerState !== 'undefined' && ExplorerState.subjectId && !ExplorerState.topicId) return typeof window.renderQuestionBankV2 === 'function' ? window.renderQuestionBankV2() : previousRender();
    return previousRender();
  };

  const style = document.createElement('style');
  style.id = 'urgent-topic-fix-style';
  style.textContent = `.urgent-qbank-page{padding-bottom:24px}.urgent-qbank-head{margin-bottom:18px}.urgent-qbank-head-row{display:flex;align-items:center;gap:10px}.urgent-qbank-back{border:0;background:none;color:var(--emerald);font-size:34px;line-height:1;padding:0 4px;cursor:pointer}.urgent-kicker{font-size:10px;letter-spacing:1.4px;font-weight:800;color:#c9795f}.urgent-qbank-head h1{font-size:23px;line-height:1.15;margin:3px 0;color:var(--text)}.urgent-qbank-head p{font-size:12px;color:var(--sub);margin:4px 0 0}.urgent-add-topic{margin-left:auto;width:44px;height:44px;border:0;border-radius:14px;background:var(--emerald);color:#fff;font-size:25px;cursor:pointer;box-shadow:var(--shadow)}.urgent-topic-toolbar{display:flex;justify-content:space-between;align-items:end;gap:12px;margin:0 0 10px}.urgent-topic-toolbar strong{font-size:17px}.urgent-topic-toolbar span{font-size:11px;color:var(--sub);text-align:right}.urgent-topic-card{background:var(--card);border:1px solid var(--line);border-radius:17px;margin-bottom:11px;box-shadow:var(--shadow);overflow:hidden}.urgent-topic-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;width:100%;min-width:0;padding:10px 12px}.urgent-topic-main{display:flex;flex:1 1 100%;width:100%;min-width:0;align-items:center;gap:12px;padding:5px 3px;border:0;background:transparent;text-align:left;cursor:pointer;color:var(--text);overflow:hidden}.urgent-topic-main:active{background:var(--mint)}.urgent-topic-folder{font-size:26px}.urgent-topic-copy{flex:1 1 auto;min-width:0;overflow:hidden}.urgent-topic-copy strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:16px}.urgent-topic-arrow{font-size:25px;color:var(--emerald);flex:0 0 auto}.urgent-topic-bottom{display:flex;flex:1 1 100%;align-items:center;gap:8px;padding-left:40px}.urgent-topic-count{flex:0 0 auto;min-width:0;color:var(--sub);font-size:11px;white-space:nowrap}.urgent-topic-actions{display:flex;flex-direction:row;align-items:center;gap:5px;flex:0 0 auto;padding:0}.urgent-topic-action{flex:0 0 auto;display:inline-grid;place-items:center;width:30px;height:30px;padding:0;white-space:nowrap;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--emerald-d);font-size:15px;line-height:1;cursor:pointer}.urgent-topic-icon-action{width:30px;height:30px}.urgent-topic-delete{color:var(--red)}.urgent-topic-empty{text-align:center;background:var(--card);border:1px dashed var(--line);border-radius:18px;padding:34px 18px;color:var(--sub)}.urgent-topic-empty>div{font-size:38px}.urgent-topic-empty strong{display:block;color:var(--text);font-size:17px;margin-top:6px}.urgent-topic-empty p{font-size:13px;margin:6px 0 16px}.urgent-primary,.urgent-secondary{border:0;border-radius:11px;padding:11px 14px;font-weight:800;cursor:pointer}.urgent-primary{background:var(--emerald);color:#fff}.urgent-secondary{background:var(--mint);color:var(--emerald-d)}.urgent-modal-bg{position:fixed;top:var(--visual-viewport-offset-top,0px);left:0;right:0;bottom:auto;height:var(--visual-viewport-height);max-height:var(--visual-viewport-height);box-sizing:border-box;z-index:250;background:rgba(15,35,27,.38);display:flex;align-items:flex-end;padding-bottom:calc(var(--safe-b) + 8px);overscroll-behavior:contain}.urgent-modal{width:100%;max-width:560px;max-height:calc(var(--visual-viewport-height) - 16px);box-sizing:border-box;margin:0 auto;background:var(--card);border-radius:20px 20px 0 0;padding:19px 16px calc(20px + var(--safe-b));box-shadow:0 -10px 30px rgba(0,0,0,.16);overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;transform:translate3d(0,0,0);will-change:transform}.urgent-modal-head{display:flex;align-items:center;justify-content:space-between}.urgent-modal-head h2{margin:0;font-size:20px}.urgent-modal-head button{border:0;background:none;font-size:28px;color:var(--sub);cursor:pointer}.urgent-modal-sub{font-size:12px;color:var(--sub);margin:7px 0 14px}.urgent-label{display:block;font-size:12px;font-weight:800;color:var(--sub);margin:10px 0 5px}.urgent-label span{font-weight:500}.urgent-input{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:11px;background:var(--card);color:var(--text);padding:11px 12px;font:inherit}.urgent-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}@media(max-width:430px){.urgent-topic-toolbar{align-items:start;flex-direction:column;gap:3px}.urgent-topic-toolbar span{text-align:left}.urgent-topic-row{gap:5px;padding:10px 7px}.urgent-topic-count{font-size:10px}.urgent-topic-actions{gap:4px}.urgent-topic-action,.urgent-topic-icon-action{width:28px;height:28px;font-size:14px}.urgent-topic-main{gap:7px}.urgent-topic-folder{font-size:22px}.urgent-topic-arrow{font-size:21px}}`;
  document.head.appendChild(style);
})();
