/* v4 — Admission Hub full-screen notification inbox.
 * Owner directive 2026-09-17 (round 8): the inbox is a CLEAN list only —
 * no "Push চালু আছে / 1 device" status bar, no Test button, no
 * "চালু করুন" banner, no token/device/FCM jargon anywhere in the UI.
 * Enablement lives in the premium centered allow dialog (notification-hub.js);
 * the bell routes: registered → this inbox, not registered → allow dialog.
 * Back button returns to the dashboard (owner bug: back did nothing).
 * Dual language: bn + en written, only the active language is rendered
 * (AhI18n) — both languages never shown at the same time.
 */
(() => {
  'use strict';

  const I18N = {
    title: { bn: 'নোটিফিকেশন', en: 'Notifications' },
    back: { bn: 'ফিরে যান', en: 'Back' },
    all: { bn: 'সব', en: 'All' },
    unread: { bn: 'অপঠিত', en: 'Unread' },
    markAll: { bn: 'সব পড়া চিহ্নিত করুন', en: 'Mark all as read' },
    emptyAll: { bn: 'এখনো কোনো নোটিফিকেশন নেই', en: 'No notifications yet' },
    emptyAllSub: { bn: 'Study, streak ও admission-এর খবর এখানে আসবে', en: 'Study, streak and admission updates will appear here' },
    emptyUnread: { bn: 'সব পড়া হয়েছে', en: 'You are all caught up' },
    emptyUnreadSub: { bn: 'নতুন কিছু এলে এখানে দেখাবে', en: 'New notifications will appear here' },
    yesterday: { bn: 'গতকাল', en: 'Yesterday' },
    today: { bn: 'আজ', en: 'Today' }
  };

  const lang = () => { try { return window.AhI18n ? window.AhI18n.get() : 'bn'; } catch (_) { return 'bn'; } };
  const t = (key) => { const e = I18N[key]; return (e && e[lang()]) || (e && e.bn) || key; };

  const CAT_ICON = {
    study: '📚', streak: '🔥', revision: '🔁', mistake: '🧠',
    achievement: '🏆', exam: '📝', admission: '🎓', update: '📢'
  };

  const esc = (v) => String(v ?? '').replace(/[&<>\"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /* Real data only — the hub's own log (IDB). Never fake entries. */
  const rows = async () => {
    try {
      const hub = window.NotificationHub;
      if (hub && typeof hub._log === 'function') return (await hub._log()) || [];
    } catch (_) {}
    return [];
  };

  const fmtTime = (ts) => {
    const d = new Date(Number(ts));
    const now = new Date();
    const L = lang() === 'bn' ? 'bn-BD' : 'en-GB';
    const sameDay = d.toDateString() === now.toDateString();
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay) return d.toLocaleTimeString(L, { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === y.toDateString()) return t('yesterday');
    return d.toLocaleDateString(L, { day: 'numeric', month: 'short' });
  };

  const state = { tab: 'all' };

  const renderList = (list) => {
    if (!list.length) {
      const main = state.tab === 'unread' ? t('emptyUnread') : t('emptyAll');
      const sub = state.tab === 'unread' ? t('emptyUnreadSub') : t('emptyAllSub');
      return `<div class="nif-empty fade-in">
        <div class="nif-empty-ic">${state.tab === 'unread' ? '✓' : '🔔'}</div>
        <div class="nif-empty-t">${esc(main)}</div>
        <div class="nif-empty-s">${esc(sub)}</div>
      </div>`;
    }
    return `<div class="nif-list">` + list.slice(0, 60).map((row, i) => {
      const icon = CAT_ICON[row.category] || '🔔';
      const unread = !row.readAt;
      return `<button class="nif-item fade-in stagger-${Math.min(i + 1, 6)} ${unread ? 'nif-unread' : ''}"
        data-nif-id="${esc(row.id)}" onclick="window.__nifTap(this)" ${unread ? '' : 'aria-label="read"'}>
        <span class="nif-ic" aria-hidden="true">${icon}</span>
        <span class="nif-main">
          <span class="nif-top"><b class="nif-title">${esc(row.title || '—')}</b><span class="nif-time">${esc(fmtTime(row.createdAt))}</span></span>
          <span class="nif-body">${esc(row.body || '')}</span>
        </span>
        ${unread ? '<span class="nif-dot" aria-hidden="true"></span>' : ''}
      </button>`;
    }).join('') + `</div>`;
  };

  const styles = () => `<style>
  .nif-root{max-width:640px;margin:0 auto;padding:8px 16px calc(24px + var(--safe-b,0px));}
  .nif-head{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:10px;padding:10px 0 12px;background:var(--bg,#f6f8f7);backdrop-filter:blur(8px);}
  .nif-back{width:40px;height:40px;border-radius:14px;border:1px solid var(--line,#e3e8e5);background:var(--card,#fff);font-size:18px;font-weight:700;color:#0c3b2a;display:grid;place-items:center;cursor:pointer;}
  .nif-back:active{transform:scale(.96);}
  .nif-title-head{font-size:18px;font-weight:800;color:#0c3b2a;flex:1;}
  .nif-markall{border:none;background:none;color:var(--emerald,#0f6b4f);font-size:13px;font-weight:700;cursor:pointer;padding:8px;border-radius:10px;}
  .nif-markall:active{opacity:.6;}
  .nif-tabs{display:flex;gap:6px;background:#e9eeec;border-radius:14px;padding:4px;margin-bottom:14px;}
  .nif-tab{flex:1;border:none;background:none;border-radius:11px;padding:9px 10px;font-size:13.5px;font-weight:700;color:#5c6b64;cursor:pointer;transition:background .18s ease,color .18s ease;}
  .nif-tab.active{background:var(--card,#fff);color:#0c3b2a;box-shadow:0 2px 8px rgba(12,59,42,.10);}
  .nif-tab .nif-count{display:inline-block;min-width:18px;padding:1px 5px;margin-left:4px;border-radius:9px;background:var(--emerald,#0f6b4f);color:#fff;font-size:10.5px;text-align:center;}
  .nif-list{display:flex;flex-direction:column;gap:10px;}
  .nif-item{display:flex;align-items:flex-start;gap:12px;width:100%;text-align:left;border:1px solid var(--line,#e3e8e5);background:var(--card,#fff);border-radius:16px;padding:14px;cursor:pointer;transition:transform .12s ease,box-shadow .12s ease;}
  .nif-item:active{transform:scale(.985);}
  .nif-unread{box-shadow:0 2px 14px rgba(15,107,79,.08);border-color:#cfe4da;}
  .nif-ic{flex:0 0 auto;width:40px;height:40px;border-radius:12px;background:#eef5f1;display:grid;place-items:center;font-size:18px;}
  .nif-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;}
  .nif-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;}
  .nif-title{font-size:14px;font-weight:700;color:#10352a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .nif-time{flex:0 0 auto;font-size:11.5px;color:#8a988f;}
  .nif-body{font-size:13px;color:#54655d;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
  .nif-dot{flex:0 0 auto;width:9px;height:9px;border-radius:50%;background:var(--emerald,#0f6b4f);margin-top:6px;}
  .nif-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:64px 24px;text-align:center;}
  .nif-empty-ic{width:64px;height:64px;border-radius:20px;background:#eef5f1;display:grid;place-items:center;font-size:28px;color:var(--emerald,#0f6b4f);font-weight:800;}
  .nif-empty-t{font-size:15px;font-weight:800;color:#10352a;margin-top:8px;}
  .nif-empty-s{font-size:12.5px;color:#8a988f;line-height:1.6;max-width:30ch;}
  @keyframes nifIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  .nif-root .fade-in{animation:nifIn .3s ease both;}
  </style>`;

  const render = async () => {
    const all = (await rows()).sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
    const unread = all.filter(r => !r.readAt).length;
    const list = state.tab === 'unread' ? all.filter(r => !r.readAt) : all;

    const html = `
      <div class="nif-root">
        <div class="nif-head">
          <button class="nif-back" onclick="window.__nifBack()" aria-label="${esc(t('back'))}">←</button>
          <div class="nif-title-head">${esc(t('title'))}</div>
          ${unread > 0 ? `<button class="nif-markall" onclick="window.__nifMarkAll()">${esc(t('markAll'))}</button>` : ''}
        </div>
        <div class="nif-tabs" role="tablist">
          <button class="nif-tab ${state.tab === 'all' ? 'active' : ''}" onclick="window.__nifTab('all')">${esc(t('all'))}</button>
          <button class="nif-tab ${state.tab === 'unread' ? 'active' : ''}" onclick="window.__nifTab('unread')">${esc(t('unread'))}${unread ? `<span class="nif-count">${unread}</span>` : ''}</button>
        </div>
        ${renderList(list)}
      </div>`;
    const app = document.getElementById('app');
    if (!app) return;
    app.classList.add('no-nav');
    app.innerHTML = styles() + `<div class="page" data-admission-component="route-notifications">${html}</div>`;
    const navRoot = document.getElementById('navRoot');
    if (navRoot) navRoot.innerHTML = '';
    window.scrollTo(0, 0);
  };

  const reRender = () => render().catch(() => {});

  /* Back (owner bug 2026-09-17: tapping back did not leave the inbox).
   * Prefer the app's own navigate() (hash + render + resume plumbing);
   * if the route is still stuck after 450ms, force the hash change. */
  window.__nifBack = () => {
    const force = () => {
      try {
        if (location.hash && location.hash.replace(/^#\/?/, '') !== 'dashboard') {
          location.hash = 'dashboard';
        } else if (typeof window.render === 'function') {
          window.render();
        }
      } catch (_) {}
    };
    try {
      if (typeof window.navigate === 'function') window.navigate('dashboard');
      else location.hash = 'dashboard';
    } catch (_) { location.hash = 'dashboard'; }
    window.setTimeout(force, 450);
  };

  window.__nifTab = (tab) => { state.tab = tab === 'unread' ? 'unread' : 'all'; reRender(); };
  window.__nifTap = (el) => {
    const id = el.dataset.nifId;
    (async () => {
      try {
        const hub = window.NotificationHub;
        if (hub && typeof hub.markOneRead === 'function') await hub.markOneRead(id);
      } catch (_) {}
      reRender();
    })();
  };
  window.__nifMarkAll = () => {
    (async () => {
      try { const hub = window.NotificationHub; if (hub && typeof hub.markAllRead === 'function') await hub.markAllRead(); } catch (_) {}
      reRender();
    })();
  };

  window.renderNotificationsInbox = function renderNotificationsInbox() {
    render().catch(() => {});
  };
})();
