(() => {
  'use strict';

  const stack = [];
  const RESUME_KEY = 'admission-hub-navigation-resume-v1';
  let restoring = false;
  let restoreToken = 0;
  const currentRoute = () => String(location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0] || 'dashboard';
  const baseNavigate = window.navigate;

  function loadResume() {
    try { const saved = JSON.parse(sessionStorage.getItem(RESUME_KEY) || '{}'); return saved && typeof saved === 'object' ? saved : {}; } catch (_) { return {}; }
  }
  const resume = loadResume();
  function saveResume() { try { sessionStorage.setItem(RESUME_KEY, JSON.stringify(resume)); } catch (_) {} }
  function ownerFor(path) {
    const value = String(path || 'dashboard');
    if (value.startsWith('question-bank') || value.startsWith('subject') || value.startsWith('topic') || value.startsWith('question') || value.startsWith('add-question') || value.startsWith('edit-question')) return 'question-bank';
    if (value.startsWith('smart-formatter') || value.startsWith('question-parser')) return 'smart-formatter';
    if (value.startsWith('exam')) return 'exam';
    if (value.startsWith('history') || value.startsWith('ai-chat')) return 'history';
    if (value === 'dashboard' || value === 'home' || value === 'settings') return 'dashboard';
    return 'dashboard-tool';
  }
  function remember(path = currentRoute(), top = window.scrollY || 0) {
    const owner = ownerFor(path);
    if (owner === 'dashboard') return;
    if (path.startsWith('vocabulary-master')) window.VocabularyMaster?.snapshotResume?.(path, top);
    resume[owner] = { path:String(path), top:Math.max(0, Number(top) || 0), savedAt:Date.now() };
    saveResume();
  }
  function targetForTab(tab) {
    if (tab === 'dashboard') {
      // Home is an explicit escape action. Never restore a deep tool route
      // (matching/practice/test) into the Home tab after the user leaves it.
      if (resume['dashboard-tool']) { delete resume['dashboard-tool']; saveResume(); }
      return 'dashboard';
    }
    return resume[tab]?.path || tab;
  }

  function restoreViewport(top = 0, path = currentRoute()) {
    const target = String(path || 'dashboard');
    const y = Math.max(0, Number(top) || 0);
    const token = ++restoreToken;
    let settled = false;
    const apply = () => {
      if (settled || token !== restoreToken || currentRoute() !== target) return;
      settled = true;
      [0, 80, 220].forEach(wait => window.setTimeout(() => { if (token === restoreToken && currentRoute() === target) window.scrollTo({ top:y, behavior:'auto' }); }, wait));
    };
    const afterRouteRender = event => {
      if (event.detail?.path === target) { document.removeEventListener('admission:route-rendered', afterRouteRender); apply(); }
    };
    document.addEventListener('admission:route-rendered', afterRouteRender);
    window.setTimeout(() => { document.removeEventListener('admission:route-rendered', afterRouteRender); apply(); }, 700);
  }

  function fallbackBack(path) {
    if (path === 'vocabulary-master' || path === 'notes' || path === 'deleted-questions') return { path: 'dashboard', top: document.querySelector('[data-unified-study-tools-list]')?.getBoundingClientRect().top + window.scrollY - 16 || 0 };
    if (path.startsWith('vocabulary-master/')) return { path: 'vocabulary-master', top: 0 };
    if (path.startsWith('notes/')) return { path: 'notes', top: 0 };
    if (path.startsWith('question-bank') || path === 'settings' || path === 'mistakes' || path === 'progress') return { path: 'dashboard', top: 0 };
    return { path: 'dashboard', top: 0 };
  }

  function goBackSafely() {
    const previous = stack.pop() || fallbackBack(currentRoute());
    restoring = true;
    window.navigate(previous.path);
    restoreViewport(previous.top || 0, previous.path);
  }

  function openTab(tab) {
    remember();
    const target = targetForTab(tab);
    const top = resume[ownerFor(target)]?.top || 0;
    window.navigate(target);
    restoreViewport(top, target);
  }

  if (typeof baseNavigate === 'function' && !baseNavigate.__navigationPolishWrapped) {
    const wrapped = function (path) {
      const next = String(path || 'dashboard').replace(/^#\/?/, '').split('?')[0] || 'dashboard';
      const current = currentRoute();
      if (!restoring && next !== current) { remember(current, window.scrollY || 0); stack.push({ path: current, top: window.scrollY || 0 }); }
      const result = baseNavigate.apply(this, arguments);
      if (restoring) restoring = false;
      return result;
    };
    wrapped.__navigationPolishWrapped = true;
    window.navigate = wrapped;
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('#app .backbtn');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    goBackSafely();
  }, true);

  document.addEventListener('click', event => {
    const button = event.target.closest('#navRoot [data-nav-tab]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openTab(button.dataset.navTab);
  }, true);

  window.AdmissionNavigation = { openTab, remember, targetForTab, restoreViewport };

  window.addEventListener('hashchange', () => requestAnimationFrame(() => document.body.classList.remove('admission-route-moving')), { passive: true });

  const style = document.createElement('style');
  style.textContent = `
    #app .page{animation:admissionRouteIn 170ms cubic-bezier(.23,1,.32,1)}
    @keyframes admissionRouteIn{from{opacity:.01;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
    .topbar{min-height:64px;padding:calc(10px + env(safe-area-inset-top)) 16px 10px!important}
    .topbar .backbtn{width:42px;height:42px;display:grid;place-items:center;border-radius:14px;font-size:25px;line-height:1}
    [data-unified-study-tools-list]{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:12px!important;align-items:stretch!important}
    [data-unified-study-tools-list]>button{width:100%!important;min-height:88px!important;margin:0!important}
    [data-unified-study-tools-list] .special-tool-card,[data-unified-study-tools-list] .p3-special-card-v3,[data-unified-study-tools-list] .vm-dashboard-entry,[data-unified-study-tools-list] .mm-dashboard-entry{min-height:88px!important;margin:0!important}
    @media(prefers-reduced-motion:reduce){#app .page{animation:none!important}}
  `;
  document.head.appendChild(style);
})();
