/* v6 — Admission Hub full-screen notification inbox (Phase 2: global feed).
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
    clearAll: { bn: 'সব মুছে ফেলুন', en: 'Clear all' },
    confirmClear: { bn: 'নিশ্চিত?', en: 'Sure?' },
    emptyAll: { bn: 'এখনো কোনো নোটিফিকেশন নেই', en: 'No notifications yet' },
    emptyAllSub: { bn: 'Study, streak ও admission-এর খবর এখানে আসবে', en: 'Study, streak and admission updates will appear here' },
    emptyUnread: { bn: 'সব পড়া হয়েছে', en: 'You are all caught up' },
    emptyUnreadSub: { bn: 'নতুন কিছু এলে এখানে দেখাবে', en: 'New notifications will appear here' },
    yesterday: { bn: 'গতকাল', en: 'Yesterday' },
    earlier: { bn: 'আগে', en: 'Earlier' },
    today: { bn: 'আজ', en: 'Today' }
  };

  const lang = () => { try { return window.AhI18n ? window.AhI18n.get() : 'bn'; } catch (_) { return 'bn'; } };
  const t = (key) => { const e = I18N[key]; return (e && e[lang()]) || (e && e.bn) || key; };

  const CAT_ICON = {
    study: '📚', streak: '🔥', revision: '🔁', mistake: '🧠',
    achievement: '🏆', exam: '📝', admission: '🎓', update: '📢'
  };

  const esc = (v) => String(v ?? '').replace(/[&<>\"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /* Global notification types → inbox category icons (Phase 2). */
  const GLOBAL_ICONS = {
    'new-content': 'study', announcement: 'update', 'new-feature': 'update',
    challenge: 'achievement', course: 'admission', important: 'update'
  };

  /* Real data only, never fake: local events from the hub log (IDB) +
   * global notifications from the server feed (Phase 2), deduped by id. */
  const localRows = async () => {
    try {
      const hub = window.NotificationHub;
      if (hub && typeof hub._log === 'function') return (await hub._log()) || [];
    } catch (_) {}
    return [];
  };
  const globalRows = async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch('/api/notifications/inbox', { credentials: 'include', signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.items || []).map(r => ({
        id: r.id,
        title: r.title,
        body: r.body,
        createdAt: Number(r.sentAt || 0),
        readAt: r.readAt ? Number(r.readAt) : null,
        category: GLOBAL_ICONS[r.type] || 'update',
        targetUrl: r.targetUrl || null,
        source: 'global'
      }));
    } catch (_) { return []; }
  };
  const rows = async () => {
    const [local, global] = await Promise.all([localRows(), globalRows()]);
    const seen = new Set(global.map(r => r.id));
    return [...global, ...local.filter(r => !seen.has(r.id))];
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

  const dayBucket = (ts, now) => {
    const d = new Date(Number(ts));
    if (Number.isNaN(d.getTime())) return 'earlier';
    if (d.toDateString() === now.toDateString()) return 'today';
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'yesterday';
    return 'earlier';
  };

  /* The blueprint asks for a Notification Center grouped Today / Yesterday /
   * Earlier. Buckets follow the rows' existing order, so a newest-first list
   * keeps its order inside each section. */
  const groupRows = (list, now = new Date()) => {
    const buckets = { today: [], yesterday: [], earlier: [] };
    for (const row of list) buckets[dayBucket(row.createdAt, now)].push(row);
    return buckets;
  };

  const sectionHeading = (key) => `<div class="nif-section"><span>${esc(t(key))}</span></div>`;

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
    let idx = 0;
    const rowHtml = (row) => {
      const icon = CAT_ICON[row.category] || '🔔';
      const unread = !row.readAt;
      const i = idx++;
      /* Phase 2: a rendered row is a notification seen. notification_open is a
       * once-only dictionary event, so the service dedupes repeat renders. */
      try { window.dispatchEvent(new CustomEvent('admission:activity', { detail: { type: 'NOTIFICATION_OPEN', notificationId: row.id, notificationType: row.source === 'global' ? 'global' : 'local' } })); } catch (_) {}
      return `<button class="nif-item fade-in stagger-${Math.min(i + 1, 6)} ${unread ? 'nif-unread' : ''}"
        data-nif-id="${esc(row.id)}" data-nif-global="${row.source === 'global' ? '1' : '0'}" data-nif-link="${esc(row.targetUrl || '')}"
        onclick="window.__nifTap(this)" ${unread ? '' : 'aria-label="read"'}>
        <span class="nif-ic" aria-hidden="true">${icon}</span>
        <span class="nif-main">
          <span class="nif-top"><b class="nif-title">${esc(row.title || '—')}</b><span class="nif-time">${esc(fmtTime(row.createdAt))}</span></span>
          <span class="nif-body">${esc(row.body || '')}</span>
        </span>
        ${unread ? '<span class="nif-dot" aria-hidden="true"></span>' : ''}
      </button>`;
    };
    const buckets = groupRows(list.slice(0, 60));
    const sections = ['today', 'yesterday', 'earlier']
      .filter(key => buckets[key].length)
      .map(key => sectionHeading(key) + buckets[key].map(rowHtml).join(''))
      .join('');
    return `<div class="nif-list">${sections}</div>`;
  };

  const styles = () => `<style>
  .nif-root{max-width:640px;margin:0 auto;padding:8px 16px calc(24px + var(--safe-b,0px));}
  .nif-head{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:10px;padding:10px 0 12px;background:var(--bg,#f6f8f7);backdrop-filter:blur(8px);}
  .nif-back{width:40px;height:40px;border-radius:14px;border:1px solid var(--line,#e3e8e5);background:var(--card,#fff);font-size:18px;font-weight:700;color:#0c3b2a;display:grid;place-items:center;cursor:pointer;}
  .nif-back:active{transform:scale(.96);}
  .nif-title-head{font-size:18px;font-weight:800;color:#0c3b2a;flex:1;}
  .nif-markall{border:none;background:none;color:var(--emerald,#0f6b4f);font-size:13px;font-weight:700;cursor:pointer;padding:8px;border-radius:10px;}
  .nif-markall:active{opacity:.6;}
  .nif-clear{border:1px solid var(--line,#e3e8e5);background:var(--card,#fff);border-radius:12px;min-width:40px;height:40px;display:grid;place-items:center;font-size:16px;cursor:pointer;padding:0 10px;}
  .nif-clear:active{transform:scale(.94);}
  .nif-clear.nif-clear-armed{background:var(--red,#dc2626);border-color:var(--red,#dc2626);color:#fff;font-size:12px;font-weight:800;}
  .nif-tabs{display:flex;gap:6px;background:#e9eeec;border-radius:14px;padding:4px;margin-bottom:14px;}
  .nif-tab{flex:1;border:none;background:none;border-radius:11px;padding:9px 10px;font-size:13.5px;font-weight:700;color:#5c6b64;cursor:pointer;transition:background .18s ease,color .18s ease;}
  .nif-tab.active{background:var(--card,#fff);color:#0c3b2a;box-shadow:0 2px 8px rgba(12,59,42,.10);}
  .nif-tab .nif-count{display:inline-block;min-width:18px;padding:1px 5px;margin-left:4px;border-radius:9px;background:var(--emerald,#0f6b4f);color:#fff;font-size:10.5px;text-align:center;}
  .nif-list{display:flex;flex-direction:column;gap:10px;}
  .nif-section{display:flex;align-items:center;gap:8px;padding:6px 2px 0;font-size:12px;font-weight:800;letter-spacing:.02em;text-transform:uppercase;color:#7b8a83;}
  .nif-section::after{content:"";flex:1;height:1px;background:var(--line,#e3e8e5);}
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
          ${all.length > 0 ? `<button class="nif-clear" id="nifClearBtn" onclick="window.__nifClearAll()" title="${esc(t('clearAll'))}" aria-label="${esc(t('clearAll'))}">🗑</button>` : ''}
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
    const isGlobal = el.dataset.nifGlobal === '1';
    const targetUrl = el.dataset.nifLink || '';
    /* Phase 2: an opened notification is an engagement signal; the tap is the
     * click, the list render is the open. Only the opaque id leaves. */
    try { window.dispatchEvent(new CustomEvent('admission:activity', { detail: { type: 'NOTIFICATION_CLICK', notificationId: id, notificationType: isGlobal ? 'global' : 'local', linkRoute: targetUrl || undefined } })); } catch (_) {}
    (async () => {
      try {
        if (isGlobal) {
          await fetch('/api/notifications/read', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
          });
        } else {
          const hub = window.NotificationHub;
          if (hub && typeof hub.markOneRead === 'function') await hub.markOneRead(id);
        }
      } catch (_) {}
      if (isGlobal && targetUrl) {
        try { location.hash = targetUrl.replace(/^#?\/?/, ''); } catch (_) {}
        return;
      }
      reRender();
    })();
  };
  window.__nifMarkAll = () => {
    (async () => {
      try { const hub = window.NotificationHub; if (hub && typeof hub.markAllRead === 'function') await hub.markAllRead(); } catch (_) {}
      reRender();
    })();
  };
  /* Clear all (two-tap confirm — first tap arms the button for 3s).
   * Wipes the local notification list; owner 2026-09-17: old auto entries
   * left over from before the auto engine was switched off must be gone. */
  let clearArmedAt = 0;
  window.__nifClearAll = () => {
    const btn = document.getElementById('nifClearBtn');
    if (!btn) return;
    if (Date.now() - clearArmedAt < 3000) {
      clearArmedAt = 0;
      btn.classList.remove('nif-clear-armed');
      (async () => {
        try { const hub = window.NotificationHub; if (hub && typeof hub.clearAllLog === 'function') await hub.clearAllLog(); } catch (_) {}
        reRender();
      })();
    } else {
      clearArmedAt = Date.now();
      btn.textContent = t('confirmClear');
      btn.classList.add('nif-clear-armed');
      window.setTimeout(() => {
        if (!document.getElementById('nifClearBtn')) return;
        document.getElementById('nifClearBtn').textContent = '🗑';
        document.getElementById('nifClearBtn').classList.remove('nif-clear-armed');
        if (Date.now() - clearArmedAt >= 3000) clearArmedAt = 0;
      }, 3000);
    }
  };

  window.renderNotificationsInbox = function renderNotificationsInbox() {
    render().catch(() => {});
  };
})();
