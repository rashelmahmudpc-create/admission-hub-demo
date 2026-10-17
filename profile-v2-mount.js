/* Profile V2 — mounts the owner's new Profile UI on the my-profile route.

   The new design carries its own :root tokens and 17 class names that also
   exist in the app (card, row, on, chip…), so injecting it into the live DOM
   would restyle the whole SPA. The dashboard already solved this exact problem
   by rendering inside a same-origin frame; this module follows that pattern so
   the design keeps its own scoped styles and the app stays untouched.

   The frame is same-origin, so it shares the session cookie and the profile
   cache the rest of the app uses.
*/
(function () {
  'use strict';

  var FRAME_TITLE = 'প্রোফাইল';
  /* The app's bottom nav is 74px plus the home indicator, and it sits above the
     frame, so the design's last card needs that much clearance. */
  var NAV_RESERVE = 96;
  /* Bump this whenever profile-v2.html changes. The page URL carries the token,
     so a new build fetches a new URL and the service worker can never serve the
     previous page from its shell cache. */
  var PAGE_VERSION = 'profile-v2-1';
  var PAGE_URL = './profile-v2.html?v=' + PAGE_VERSION;
  /* A marker that exists only in the design's own page. If the fetched body
     lacks it we were handed something else (the service worker answers document
     requests with the app shell, which would nest the whole app inside this
     frame), so we fail visibly instead of rendering garbage. */
  var PAGE_MARKER = 'id="shell"';

  /* The page source is fetched once and kept, then handed to the frame via
     srcdoc. A separate HTML file cannot be navigated to directly: the service
     worker answers every document request with the app shell. */
  var sourcePromise = null;
  function pageSource() {
    if (!sourcePromise) {
      sourcePromise = fetch(PAGE_URL, {
        credentials: 'same-origin',
        cache: 'no-store',
        // Keep this out of the service worker's document branch, which would
        // return the app shell instead of the page.
        headers: { Accept: 'text/plain' }
      })
        .then(function (res) {
          if (!res.ok) throw new Error('profile-v2.html ' + res.status);
          return res.text();
        })
        .then(function (text) {
          if (text.indexOf(PAGE_MARKER) < 0) throw new Error('unexpected profile page body');
          return text;
        })
        .catch(function (err) {
          sourcePromise = null; // allow a later retry
          throw err;
        });
    }
    return sourcePromise;
  }

  function frameMarkup() {
    return '<iframe class="pv2-frame" title="' + FRAME_TITLE + '" ' +
      'style="position:fixed;inset:0;width:100%;height:100%;border:0;display:block;z-index:5;' +
      'background:var(--ah-chrome,#F4F6FD)"></iframe>';
  }

  function fallback(err) {
    console.warn('[profile-v2] frame load failed', err);
    return '<section class="card" data-profile-v2-fallback="1">' +
      '<h3>প্রোফাইল লোড হয়নি</h3>' +
      '<p class="muted">ইন্টারনেট সংযোগ দেখে পেজটি আবার খুলুন।</p></section>';
  }

  /* Prepare the design's document for life inside the app frame. Both changes
     are additive — the design's own stylesheet is left untouched.
     The theme is handed in as a global, not as data-theme on <html>: the
     design's own boot calls applyTheme(), which removes that attribute when its
     theme is 'auto', so an attribute set here would be erased before first
     paint. A global survives and is what themeForUi() reads. */
  function prepare(html) {
    var mode = 'light';
    try {
      mode = (window.AhAppearance && window.AhAppearance.resolved && window.AhAppearance.resolved()) || 'light';
    } catch (_) {}
    var bridge = '<script data-profile-v2-bridge="1">' +
      'window.__AH_THEME__=' + JSON.stringify(mode) + ';' +
      '</' + 'script>' +
      '<style data-profile-v2-bridge="1">' +
      '.scroll{padding-bottom:calc(' + NAV_RESERVE + 'px + env(safe-area-inset-bottom,0px))!important}' +
      '.toast{bottom:calc(' + (NAV_RESERVE + 22) + 'px + env(safe-area-inset-bottom,0px))!important}' +
      '</style>';
    return html.replace('</head>', bridge + '</head>');
  }

  function mountFrame() {
    var app = document.getElementById('app');
    var frame = app && app.querySelector('iframe.pv2-frame');
    if (!frame) return;
    pageSource().then(function (html) {
      if (!frame.isConnected || frame.getAttribute('srcdoc')) return;
      frame.setAttribute('srcdoc', prepare(html));
    }).catch(function (err) {
      if (typeof window.renderShell === 'function') window.renderShell(fallback(err), { title: FRAME_TITLE });
    });
  }

  var previous = window.renderProfilePage;
  window.renderProfilePage = function renderProfileV2() {
    /* The owner's renderer carries an auth gate: a signed-out visitor gets the
       login card, never a profile. Mirror that gate before taking over, so the
       new design can never show to a guest. The check matches profile-ui.js's
       own authGate() because that function is private to its closure. */
    try {
      var acc = window.AdmissionAccount;
      var verified = !!(acc && acc.isVerified && acc.isVerified());
      if (!verified) {
        // Not a verified session (loading, guest, or account module missing):
        // let the original renderer handle it, skeleton and login card included.
        if (typeof previous === 'function') return previous.apply(this, arguments);
        return undefined;
      }
    } catch (_) {
      if (typeof previous === 'function') return previous.apply(this, arguments);
      return undefined;
    }

    try {
      if (typeof window.renderShell === 'function') {
        window.renderShell(frameMarkup(), { title: FRAME_TITLE, topbar: false, hideNav: false });
      } else {
        var app = document.getElementById('app');
        if (app) app.innerHTML = frameMarkup();
      }
      mountFrame();
      return undefined;
    } catch (err) {
      if (typeof previous === 'function') return previous.apply(this, arguments);
      console.warn('[profile-v2] mount failed', err);
      return undefined;
    }
  };

  // The frame is rebuilt on every route render, so re-supply the source after
  // each shell paint.
  document.addEventListener('admission:route-rendered', function (ev) {
    var path = ev && ev.detail && ev.detail.path;
    if (path === 'my-profile') mountFrame();
  });

  window.__profileV2Installed = true;
})();
