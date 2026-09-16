import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const UI = readFileSync(new URL('./profile-ui.js', import.meta.url), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(predicate, label, timeout = 3000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

const PROFILE = {
  publicId: 'AH-CROP0001',
  completion: 72,
  joinedYear: '2026',
  profile: {
    fullName: 'Crop Student',
    dob: '2007-04-11',
    mobile: '01712345678',
    school: { id: 'manual', name: 'Model High School', district: 'Dhaka' },
    higherInstitution: null,
    bio: '',
    visibility: 'private',
    targets: [],
    subjects: []
  },
  context: { greeting: 'হ্যালো' }
};

// Boot profile-ui.js on the avatar view with a recording fetch, so the test can
// observe exactly which API calls the crop dialog makes.
function boot() {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', {
    url: 'https://admissionhub.pages.dev/#my-profile',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.calls = [];
  window.__canvasDrawn = null;
  window.NotificationHub = { openCenter() {} };
  window.AdmissionAccount = { isVerified: () => true, getSessionState: () => 'AUTHENTICATED', open() {} };
  window.AhI18n = { set() {} };
  window.AhAppearance = { set() {} };
  window.AH_AcademicCatalog = {
    listSessions: () => [{ id: '2025-26' }],
    getUniversity: () => null,
    unitsFor: () => [{ id: 'A' }],
    subjectsFor: () => [],
    searchUniversities: () => []
  };
  window.CACHE = { examResults: [], mistakes: [] };
  window.fetch = async (url, init = {}) => {
    const u = String(url);
    window.calls.push({ url: u, method: init.method || 'GET', body: init.body });
    const body = u.includes('/api/auth/v1/profile/avatar')
      ? { ok: true }
      : (u.includes('/api/auth/v1/profile') ? PROFILE : {});
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
  };
  // The cropper draws the source image onto a canvas and re-encodes it. jsdom
  // has no canvas backend, so record the drawImage geometry instead of pixels —
  // that is exactly what the crop maths has to get right.
  const realCreate = window.document.createElement.bind(window.document);
  window.document.createElement = (tag, ...rest) => {
    const el = realCreate(tag, ...rest);
    if (String(tag).toLowerCase() === 'canvas') {
      el.width = 0;
      el.height = 0;
      el.getContext = () => ({
        fillStyle: '',
        fillRect() {},
        drawImage(im, sx, sy, sw, sh, dx, dy, dw, dh) {
          window.__canvasDrawn = { sx, sy, sw, sh, dx, dy, dw, dh };
        }
      });
      el.toDataURL = () => 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ';
    }
    return el;
  };
  // A loadable image stand-in: jsdom never decodes, so hand the cropper a
  // natural size and fire load on the next tick.
  window.Image = class {
    constructor() {
      this.naturalWidth = 1600;
      this.naturalHeight = 1200;
    }
    set src(value) {
      this._src = value;
      setTimeout(() => this.onload && this.onload(), 0);
    }
    get src() { return this._src; }
  };
  if (!window.URL.createObjectURL) window.URL.createObjectURL = () => 'blob:crop-source';
  window.URL.revokeObjectURL = () => {};
  window.eval(UI);
  window.renderProfilePage();
  return window;
}

const clickOn = (window, el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

// Drive the real pipeline: open the avatar view, hand the hidden file input a
// picked photo, and wait for the crop dialog to mount on document.body.
async function openCropper(window) {
  await waitFor(() => window.document.querySelector('[data-role="open-avatar-page"]'), 'profile page');
  await waitFor(() => {
    clickOn(window, window.document.querySelector('[data-role="open-avatar-page"]'));
    return window.document.querySelector('[data-role="avatar-file-capture"]');
  }, 'avatar view');

  await waitFor(() => {
    const input = window.document.querySelector('[data-role="avatar-file-capture"]');
    if (!input) return false;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [{ type: 'image/jpeg', size: 900_000, name: 'photo.jpg' }]
    });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    return window.document.getElementById('pp-crop-host');
  }, 'crop dialog mounted');
  return window.document.getElementById('pp-crop-host');
}

// The crop dialog lives on document.body, outside #app. The original bug was
// that only #app had a delegated click handler, so Save and Cancel — which live
// in this host — had no listener and did nothing at all.
test('crop Cancel closes the dialog without ever calling the avatar API', async () => {
  const window = boot();
  const host = await openCropper(window);
  assert.ok(host.querySelector('[data-role="crop-cancel"]'), 'cancel button must exist');

  const cancel = host.querySelector('.pp-crop-actions [data-role="crop-cancel"]');
  clickOn(window, cancel);
  await waitFor(() => !host.querySelector('.pp-crop-overlay'), 'dialog removed on cancel');

  assert.equal(window.calls.some(c => c.url.includes('/profile/avatar')), false,
    'Cancel must not upload anything');
  assert.equal(window.__canvasDrawn, null, 'Cancel must not encode an avatar');
});

test('crop Save encodes the crop and uploads it, then closes the dialog', async () => {
  const window = boot();
  const host = await openCropper(window);

  const save = host.querySelector('[data-role="crop-save"]');
  assert.ok(save, 'save button must exist');
  clickOn(window, save);

  await waitFor(() => window.calls.some(c => c.url.includes('/profile/avatar')), 'avatar upload');

  // The crop maths must produce a sane square window inside the source image.
  const drawn = window.__canvasDrawn;
  assert.ok(drawn, 'the cropper must draw the source image');
  assert.ok(drawn.sw > 0 && drawn.sh > 0, 'source rect must be non-empty');
  assert.equal(drawn.sw, drawn.sh, 'the crop window must be square');
  assert.ok(drawn.sx >= -1 && drawn.sy >= -1, 'crop must not start outside the image');
  assert.ok(drawn.sx + drawn.sw <= 1601 && drawn.sy + drawn.sh <= 1201,
    'crop must not extend past the source image');
  assert.equal(drawn.dw, 512, 'output must be re-encoded to 512px');
  assert.equal(drawn.dh, 512, 'output must be re-encoded to 512px');

  const upload = window.calls.find(c => c.url.includes('/profile/avatar'));
  assert.equal(upload.method, 'POST');
  const payload = JSON.parse(upload.body);
  assert.equal(payload.mime, 'image/jpeg');
  assert.ok(payload.data.length > 0, 'upload must carry the encoded bytes');

  await waitFor(() => !host.querySelector('.pp-crop-overlay'), 'dialog closed after save');
});

test('crop Save without a loaded image does nothing rather than uploading a blank', async () => {
  const window = boot();
  await waitFor(() => window.document.querySelector('[data-role="open-avatar-page"]'), 'profile page');
  await waitFor(() => {
    clickOn(window, window.document.querySelector('[data-role="open-avatar-page"]'));
    return window.document.querySelector('[data-role="avatar-file-capture"]');
  }, 'avatar view');
  // Mount the dialog directly with no crop.img, which is the state a failed
  // decode leaves behind: Save must bail out, not post a grey square.
  window.document.body.insertAdjacentHTML('beforeend', `
    <div id="pp-crop-host"><button data-role="crop-save" type="button">✓ Save Avatar</button></div>`);
  const host = window.document.getElementById('pp-crop-host');
  clickOn(window, host.querySelector('[data-role="crop-save"]'));
  await sleep(60);
  assert.equal(window.__canvasDrawn, null, 'no crop without a loaded image');
  assert.equal(window.calls.some(c => c.url.includes('/profile/avatar')), false,
    'must not upload a blank avatar');
});