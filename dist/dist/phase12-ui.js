(() => {
  'use strict';

  const bengaliDate = () => {
    try {
      return new Intl.DateTimeFormat('bn-BD', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      }).format(new Date());
    } catch (_) {
      return new Date().toLocaleDateString('bn-BD');
    }
  };

  const metricNumber = (value) => {
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === 'object') {
      for (const key of ['count', 'value', 'total', 'amount', 'timeMs', 'minutes']) {
        const n = Number(value[key]);
        if (Number.isFinite(n)) return n;
      }
      return 0;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  const safeTodayStats = () => {
    const row = (CACHE.dailyStats || []).find((item) => item.id === todayKey()) || {};
    return {
      questions: metricNumber(row.questions),
      correct: metricNumber(row.correct),
      wrong: metricNumber(row.wrong),
      timeMs: metricNumber(row.timeMs)
    };
  };

  const dashboardTools = [
    ['📚', 'Bank', 'প্রশ্নভাণ্ডার', 'question-bank'],
    ['📋', 'Mock', 'মক টেস্ট', 'exam/setup'],
    ['⚡', 'Quick', 'দ্রুত অনুশীলন', 'exam/setup'],
    ['❌', 'Mistakes', 'ভুলের খাতা', 'mistakes'],
    ['📊', 'Progress', 'অগ্রগতি দেখুন', 'progress'],
    ['📅', '90 Days', '৯০ দিনের রুটিন', 'progress/plan'],
    ['🔄', 'Revision', 'স্মার্ট রিভিশন', 'mistakes'],
    ['📖', 'Vocab', 'ভোকাবুলারি', 'vocabulary'],
    ['🕐', 'History', 'পরীক্ষার ইতিহাস', 'history'],
    ['🔍', 'Search', 'প্রশ্ন খুঁজুন', 'question-bank'],
    ['⚙️', 'Settings', 'অ্যাপ সেটিংস', 'settings'],
    ['⋯', 'More', 'আরও ফিচার', 'settings']
  ];

  const specialTools = [
    ['📖', 'Dictionary', 'শব্দের অর্থ ও Vocabulary', 'dictionary'],
    ['🧩', 'Memorizing', 'Smart memorization tools', 'memorizing']
  ];

  // The primary five-tab navigation is intentionally the only shared navigation.
  window.bottomNavHtml = function phase12BottomNav(active) {
    return `<nav class="bottomnav" aria-label="প্রধান নেভিগেশন">
      ${NAV_TABS.map((tab) => `<button class="navbtn ${active === tab.key ? 'active' : ''}" data-nav-tab="${tab.key}" onclick="window.AdmissionNavigation ? window.AdmissionNavigation.openTab('${tab.key}') : navigate('${tab.key}')" aria-label="${tab.label}">
        <span class="ic" aria-hidden="true">${tab.icon}</span><span>${tab.label}</span>
      </button>`).join('')}
    </nav>`;
  };

  // dashboard-v2 is the first-interaction renderer. Never replace it with this
  // legacy placeholder when deferred scripts execute in their document order.
  if (!window.__dashboardV2Installed) {
    window.renderDashboard = function phase12Dashboard() {
      const existingMarkup = typeof window.__phase3DashboardMarkup === 'function'
        ? window.__phase3DashboardMarkup()
        : '<div class="app-loading"><div class="app-loading-mark">✦</div><span>Dashboard loading…</span></div>';
      renderShell(`<main class="dashboard-existing">${existingMarkup}</main>`, { topbar: false });
    };
  }
})();

/* Keep the primary navigation pinned to the visual viewport on iOS Safari/PWA. */
(() => {
  const isStandalonePwa = () => {
    try {
      return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches;
    } catch (_) {
      return window.navigator.standalone === true;
    }
  };
  const syncViewportNav = () => {
    const nav = document.getElementById('navRoot');
    if (!nav) return;
    const vv = window.visualViewport;
    const viewportHeight = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
    const standaloneScreenHeight = isStandalonePwa() && window.screen && Number.isFinite(window.screen.height) ? window.screen.height : 0;
    const layoutHeight = Math.round(isStandalonePwa() && standaloneScreenHeight ? standaloneScreenHeight : viewportHeight);
    const visualHeight = Math.round((vv && vv.height) || layoutHeight);
    document.documentElement.style.setProperty('--visual-viewport-height', `${visualHeight}px`);
    if (isStandalonePwa()) {
      // iOS Add to Home Screen can report a shorter visualViewport while the
      // standalone layout viewport remains full height. Anchor to the layout
      // viewport explicitly; using visualViewport/bottom:0 can stop too high.
      const navHeight = nav.offsetHeight || 74;
      nav.style.setProperty('top', `${Math.max(0, layoutHeight - navHeight)}px`, 'important');
      nav.style.setProperty('bottom', 'auto', 'important');
      nav.style.setProperty('left', '0px', 'important');
      nav.style.setProperty('right', '0px', 'important');
      nav.style.setProperty('transform', 'none', 'important');
      return;
    }
    const offsetTop = Math.max(0, Math.round((vv && vv.offsetTop) || 0));
    nav.style.setProperty('top', `${offsetTop + visualHeight - nav.offsetHeight}px`, 'important');
    nav.style.setProperty('bottom', 'auto', 'important');
  };
  window.syncViewportNav = syncViewportNav;
  window.addEventListener('resize', syncViewportNav, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(syncViewportNav, 120), { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncViewportNav, { passive: true });
    window.visualViewport.addEventListener('scroll', syncViewportNav, { passive: true });
  }
  document.addEventListener('DOMContentLoaded', syncViewportNav, { once: true });
  setTimeout(syncViewportNav, 0);
})();

/* Phase 1+2 visual system: restrained warm-white canvas, soft glass cards, readable Bengali type. */
const phase12Style = document.createElement('style');
phase12Style.textContent = `
  :root{--bg:#fbfaf7;--card:rgba(255,255,255,.88);--text:#17211c;--sub:#65716b;--line:rgba(24,55,42,.11);--mint:#e8f4ee;--emerald:#0f6b4f;--emerald-d:#0b4f3b;--radius:18px;--shadow:0 8px 24px rgba(23,58,43,.06)}
  html,body{font-family:'Noto Sans Bengali',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  body{background:var(--bg)} #app{max-width:600px;padding-bottom:calc(82px + var(--safe-b))}.page{padding:18px 16px 30px}.topbar{background:rgba(251,250,247,.84);border-bottom:1px solid var(--line);box-shadow:none}.card{background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow);border-radius:18px}.premium-card{background:var(--mint);color:var(--text);border:1px solid rgba(15,107,79,.12)}
  .dashboard-v2{padding-bottom:8px}.dashboard-header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:8px 2px 24px}.brand-kicker,.hero-kicker{font-size:11px;letter-spacing:.16em;font-weight:800;color:var(--emerald);text-transform:uppercase}.dashboard-header h1{font-size:30px;line-height:1.18;letter-spacing:-.04em;margin:7px 0 5px}.dashboard-header p{color:var(--sub);font-size:14px;margin:0}.settings-trigger{background:transparent;border:1px solid var(--line);border-radius:14px;color:var(--emerald-d);padding:10px 11px;font-size:18px;display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer}.settings-trigger span{font-size:10px;font-weight:700}.command-hero{background:linear-gradient(145deg,#edf8f2,#e2f1e9);border:1px solid rgba(15,107,79,.14);border-radius:24px;padding:22px 20px;box-shadow:0 14px 32px rgba(15,107,79,.08)}.hero-topline,.hero-goal-row{display:flex;justify-content:space-between;align-items:center;gap:12px}.hero-settings{border:0;background:transparent;color:var(--emerald-d);font-size:18px;cursor:pointer}.command-hero h2{font-size:17px;margin:10px 0 5px}.hero-goal-row strong{font-size:38px;line-height:1;color:var(--emerald-d);letter-spacing:-.05em}.hero-goal-row strong small{font-size:16px;font-weight:600;color:var(--sub);letter-spacing:0}.hero-goal-row>b{font-size:20px;color:var(--emerald-d)}.hero-progress{height:10px;border-radius:999px;background:rgba(15,107,79,.13);overflow:hidden;margin:20px 0}.hero-progress span{display:block;height:100%;border-radius:inherit;background:var(--emerald);transition:width .25s ease}.hero-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;border-top:1px solid rgba(15,107,79,.12);padding-top:16px}.hero-stats span{display:flex;flex-direction:column;gap:3px;min-width:0}.hero-stats strong{font-size:16px;color:var(--emerald-d);white-space:nowrap}.hero-stats small{font-size:11px;color:var(--sub)}.dashboard-section{margin-top:28px}.section-heading{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:12px}.section-heading h2{font-size:20px;letter-spacing:-.025em;margin:0}.section-heading span{font-size:11px;color:var(--sub)}  .command-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.command-carousel{overflow:hidden;border-radius:20px;touch-action:pan-y;position:relative}.command-track{display:flex;will-change:transform;transition:transform .28s cubic-bezier(.23,1,.32,1)}.command-slide{flex:0 0 100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:repeat(2,minmax(0,1fr));gap:10px}.command-dots{display:flex;justify-content:center;align-items:center;gap:7px;margin-top:12px}.command-dot{width:8px;height:8px;padding:0;border:0;border-radius:50%;background:rgba(15,107,79,.2);cursor:pointer;transition:transform .18s ease,background .18s ease}.command-dot.active{background:var(--emerald);transform:scale(1.35)}.command-card,.special-tool-card{font:inherit;text-align:left;cursor:pointer;border:1px solid var(--line);background:rgba(255,255,255,.74);border-radius:15px;padding:12px;min-height:96px;display:flex;flex-direction:column;align-items:flex-start;gap:5px;box-shadow:var(--shadow);transition:transform .16s ease,border-color .16s ease,background .16s ease}.command-card:active,.special-tool-card:active{transform:scale(.97)}.command-card:hover,.special-tool-card:hover{border-color:rgba(15,107,79,.3);background:#fff}.command-icon,.special-tool-icon{font-size:23px;line-height:1.1;margin-bottom:3px}.command-title{font-size:13px;font-weight:800;color:var(--text)}.command-subtitle{font-size:10px;color:var(--sub)}.command-hero{position:relative}.special-tools-grid{display:grid;gap:10px}.special-tool-card{min-height:78px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:13px;padding:14px 16px}.special-tool-icon{font-size:28px;margin:0}.special-tool-card strong,.special-tool-card small{display:block}.special-tool-card strong{font-size:15px}.special-tool-card small{font-size:12px;color:var(--sub);margin-top:2px}.tool-arrow{font-size:20px;color:var(--emerald)}.resume-card,.start-card{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:28px;padding:16px 17px;border-radius:18px;border:1px solid rgba(201,138,44,.24);background:#fffaf1}.resume-card p,.start-card p{margin:5px 0 0;color:var(--sub);font-size:12px}.focus-card{background:rgba(255,255,255,.72);border:1px solid var(--line);border-radius:18px;padding:16px;box-shadow:var(--shadow)}.focus-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}.focus-row:last-of-type{border-bottom:0}.focus-row strong,.focus-row small{display:block}.focus-row small{font-size:12px;color:var(--sub);margin-top:3px}.focus-card .btn{margin-top:14px}.bottomnav{background:rgba(255,255,255,.9);backdrop-filter:blur(16px);border-top:1px solid var(--line);box-shadow:0 -6px 22px rgba(23,58,43,.05);padding-top:6px}.navbtn{font-size:11px;padding:8px 0 9px;gap:4px}.navbtn .ic{font-size:23px}.navbtn.active{color:var(--emerald);font-weight:800}.btn{border-radius:12px;min-height:42px;box-shadow:none}.muted{font-size:13px}.h2{font-size:19px}
  @media(max-width:430px){.dashboard-header h1{font-size:26px}.command-hero{padding:19px 16px}.hero-goal-row strong{font-size:33px}.hero-stats{gap:7px}.hero-stats strong{font-size:14px}.hero-stats small{font-size:10px}.command-card{min-height:120px;padding:15px}.command-icon{font-size:27px}}
  @media(max-width:430px){.command-slide{gap:7px}.command-slide .command-card{min-height:88px;padding:9px}.command-slide .command-icon{font-size:20px}.command-slide .command-title{font-size:11px}.command-slide .command-subtitle{font-size:9px}.section-heading span{font-size:10px}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`;
document.head.appendChild(phase12Style);

// Keep the existing router and every non-dashboard feature intact, while making Home deterministic.
const phase12PreviousRender = window.render;
window.render = function phase12RouteGuard() {
  if (Router.path === 'dashboard' || Router.path === 'home' || Router.path === '') return window.renderDashboard();
  return phase12PreviousRender();
};

const phase12PreviousShell = window.renderShell;
window.renderShell = function phase12Shell(inner, opts) {
  phase12PreviousShell(inner, opts);
  if (Router.path !== 'dashboard') return;
  const page = document.querySelector('#app .page');
  if (!page) return;
  page.querySelectorAll('[data-phase5-quicklinks],[data-phase5-dashboard],[data-phase34-dashboard],[data-dashboard-comparison]').forEach((node) => node.remove());
  Array.from(page.children).filter((node) => {
    const text = node.textContent || '';
    return text.includes('Today vs Yesterday') || text.includes('90-Day Admission Plan') || text.includes('Daily Admission Intelligence');
  }).forEach((node) => node.remove());
};

// Explicit global bindings are used because the legacy app is composed of classic scripts.
renderShell = function phase12ShellBinding(inner, opts) {
  phase12PreviousShell(inner, opts);
  if (Router.path !== 'dashboard') return;
  const page = document.querySelector('#app .page');
  if (!page) return;
  page.querySelectorAll('[data-phase5-quicklinks],[data-phase5-dashboard],[data-phase34-dashboard],[data-dashboard-comparison]').forEach((node) => node.remove());
  Array.from(page.children).filter((node) => {
    const text = node.textContent || '';
    return text.includes('Today vs Yesterday') || text.includes('90-Day Admission Plan') || text.includes('Daily Admission Intelligence');
  }).forEach((node) => node.remove());
};
render = function phase12RouteBinding() {
  if (Router.path === 'dashboard' || Router.path === 'home' || Router.path === '') return renderDashboard();
  return phase12PreviousRender();
};

const phase12CleanLegacy = () => {
  if (Router.path !== 'dashboard') return;
  const page = document.querySelector('#app .page');
  if (!page) return;
  page.querySelectorAll('[data-phase5-quicklinks],[data-phase5-dashboard],[data-phase34-dashboard],[data-dashboard-comparison]').forEach((node) => node.remove());
  Array.from(page.children).filter((node) => {
    const text = node.textContent || '';
    return text.includes('Today vs Yesterday') || text.includes('90-Day Admission Plan') || text.includes('Daily Admission Intelligence');
  }).forEach((node) => node.remove());
};
render = function phase12FinalRouteBinding() {
  if (Router.path === 'dashboard' || Router.path === 'home' || Router.path === '') {
    const result = renderDashboard();
    setTimeout(phase12CleanLegacy, 0);
    setTimeout(phase12CleanLegacy, 60);
    return result;
  }
  return phase12PreviousRender();
};
