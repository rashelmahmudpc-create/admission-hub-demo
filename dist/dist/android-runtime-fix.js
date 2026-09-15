/* Android scroll + smoothness. 1-finger pan-y, no 100% html/body lock, no nested transform. */
(() => {
  'use strict';
  if (window.__ahAndroidRuntimeFix) return;
  window.__ahAndroidRuntimeFix = true;
  const style = document.createElement('style');
  style.id = 'ah-android-runtime-fix';
  style.textContent = `
    html, body {
      height: auto !important;
      min-height: 100% !important;
      min-height: 100dvh !important;
      overflow-x: hidden !important;
      overflow-y: auto !important;
      overscroll-behavior-y: auto !important;
      touch-action: pan-y !important;
      -webkit-overflow-scrolling: touch !important;
    }
    body { touch-action: pan-y !important; }
    #app, .page {
      transform: none !important;
      will-change: auto !important;
      overflow: visible !important;
      touch-action: pan-y !important;
    }
    .command-carousel, .command-track { touch-action: pan-y !important; }
    .setup-scroll {
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
    }
    @media (display-mode: standalone), (display-mode: fullscreen) {
      html, body {
        height: auto !important;
        min-height: 100dvh !important;
        overflow-y: auto !important;
        touch-action: pan-y !important;
      }
    }
  `;
  document.documentElement.appendChild(style);
})();
