(() => {
  'use strict';

  if (!document.getElementById('ah-natural-scroll-fix')) {
    const style = document.createElement('style');
    style.id = 'ah-natural-scroll-fix';
    style.textContent = `
      html, body { overflow-y: auto !important; }
      #app { overflow: visible !important; }
      .setup-scroll { height: auto !important; max-height: none !important; overflow: visible !important; padding-bottom: 24px !important; }
      .setup-footer { position: sticky !important; bottom: calc(74px + var(--safe-b)) !important; }
    `;
    document.head.appendChild(style);
  }

  // Smart scroll: only scroll to top when the base route actually changes,
  // not on in-page state updates (dropdown changes, search filtering, etc.)
  let _lastRouteBase = (location.hash.slice(1) || 'dashboard').split('/')[0];
  window.addEventListener('hashchange', () => {
    const newBase = (location.hash.slice(1) || 'dashboard').split('/')[0];
    if (newBase !== _lastRouteBase) {
      window.scrollTo(0, 0);
    }
    _lastRouteBase = newBase;
  }, false);

  const bindNestedClickGuards = () => {
    document.querySelectorAll('[role="button"][onclick] button, [role="button"][onclick] a, [role="button"][onclick] input, [role="button"][onclick] select, [role="button"][onclick] textarea, [role="button"][onclick] [role="button"]').forEach(control => {
      if (control.dataset.nestedClickGuard === '1') return;
      control.dataset.nestedClickGuard = '1';
      control.addEventListener('click', event => event.stopPropagation(), false);
    });
  };

  bindNestedClickGuards();
  const app = document.getElementById('app');
  if (app && typeof MutationObserver === 'function') {
    new MutationObserver(bindNestedClickGuards).observe(app, { childList: true, subtree: true });
  }
})();

//# sourceURL=global-app-fix.js
