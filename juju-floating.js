/* Floating JUJU assistant — retired bottom-nav AI tab-এর প্রতিস্থাপন।
   Content page-এ accessible; exam/auth/modal চলাকালীন সম্পূর্ণ hidden। */
(() => {
  'use strict';

  const BTN_ID = 'ahJujuFab';
  /* Exam চলাকালীন (attempt/setup/submission) এবং account-critical screen — JUJU নয়। */
  const HIDDEN_ROUTE = /^(exam\/?(setup|running|flash-summary|submit|submission)|login|signup|register|account|onboarding|verify|reset|password)/;

  const route = () => String((location.hash || '').replace(/^#\/?/, '').split('?')[0] || 'dashboard');

  function chromeBlocked() {
    const b = document.body, h = document.documentElement;
    if (!b || !h) return true;
    return b.classList.contains('modal-open') || b.classList.contains('keyboard-open') ||
      h.classList.contains('keyboard-open') || h.classList.contains('ai-chat-open') ||
      b.classList.contains('app-booting');
  }

  function shouldShow() {
    const path = route();
    if (path === 'ai' || path.startsWith('ai-chat')) return false;
    if (HIDDEN_ROUTE.test(path)) return false;
    if (chromeBlocked()) return false;
    const app = document.getElementById('app');
    if (!app || app.querySelector('.app-loading')) return false;
    return true;
  }

  const navVisible = () => {
    const nav = document.querySelector('#navRoot .bottomnav');
    if (!nav) return false;
    const s = window.getComputedStyle(nav);
    return s.display !== 'none' && s.visibility !== 'hidden';
  };

  const css = `.ah-juju{position:fixed;z-index:900;right:16px;bottom:calc(20px + var(--safe-b));display:inline-flex;align-items:center;gap:8px;padding:12px 16px;border:0;border-radius:999px;background:var(--emerald);color:#fff;font:inherit;font-size:13.5px;font-weight:800;letter-spacing:.01em;cursor:pointer;box-shadow:0 10px 24px rgba(15,107,79,.30);transition:opacity .18s ease,transform .18s ease}
.ah-juju.ah-juju-raised{bottom:calc(86px + var(--safe-b))}
.ah-juju:active{transform:scale(.96)}
.ah-juju.ah-juju-hidden{opacity:0;pointer-events:none;transform:translateY(6px)}
.ah-juju .ah-juju-ic{font-size:16px;line-height:1}
@media(max-width:390px){.ah-juju{right:13px;padding:11px 14px;font-size:13px}}
@media(prefers-reduced-motion:reduce){.ah-juju{transition:none}}`;

  let btn = null;

  function build() {
    if (btn && btn.isConnected) return btn;
    btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.className = 'ah-juju';
    btn.setAttribute('aria-label', 'JUJU AI assistant');
    btn.innerHTML = '<span class="ah-juju-ic" aria-hidden="true">✦</span><span>JUJU</span>';
    btn.addEventListener('click', event => {
      event.preventDefault();
      if (window.navigate) window.navigate('ai'); else location.hash = 'ai';
    });
    document.body.appendChild(btn);
    return btn;
  }

  function sync() {
    const node = build();
    const show = shouldShow();
    node.classList.toggle('ah-juju-hidden', !show);
    node.classList.toggle('ah-juju-raised', show && navVisible());
    node.setAttribute('aria-hidden', show ? 'false' : 'true');
    node.tabIndex = show ? 0 : -1;
  }

  function install() {
    if (!document.getElementById('ah-juju-style')) {
      const style = document.createElement('style');
      style.id = 'ah-juju-style';
      style.textContent = css;
      document.head.appendChild(style);
    }
    sync();
    window.addEventListener('hashchange', () => requestAnimationFrame(sync));
    document.addEventListener('admission:route-rendered', sync);
    window.addEventListener('resize', sync, { passive: true });
    /* modal/keyboard/AI-sheet খোলা-বন্ধ শুধু DOM class দিয়েই হয়। */
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();

  window.__AhJujuFab = { sync, shouldShow, route };
})();