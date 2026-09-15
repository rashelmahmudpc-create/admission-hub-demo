import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const UI = read('profile-ui.js');
const CSS = read('profile-ui.css');
const HTML = read('index.html');
const SW = read('sw.js');
const REDIRECTS = read('_redirects');
const DASH = read('dashboard-v2.js');
const DASH_CSS = read('dashboard-v2.css');

const mediaTag = /<(?:img|picture|source|canvas|video|object|embed)(?:\s|>)/i;

test('profile-ui.js is a guarded, zero-raster module with safe rendering', () => {
  assert.match(UI, /window\.__profileUiInstalled/);
  assert.match(UI, /const esc = \(s\)/);
  // default avatar is generated SVG — no remote or bundled raster art
  assert.match(UI, /defaultAvatarSvg/);
  assert.match(UI, /<svg viewBox="0 0 96 96"/);
  assert.match(UI, /data-avatar-contract="zero-raster-avatar-v1"/);
  // no hard-coded remote images of any kind
  assert.doesNotMatch(UI, /src=["']https?:/i);
  // the only <img> is the user's own uploaded avatar (user data, not art)
  const imgCount = (UI.match(/<img class=/g) || []).length;
  assert.equal(imgCount, 2);
});

test('public page renders only public-safe fields', () => {
  const pubStart = UI.indexOf('window.renderPublicProfilePage');
  const pub = UI.slice(pubStart);
  assert.ok(pubStart > 0);
  assert.match(pub, /data-public-contract="public-safe-profile-v1"/);
  assert.match(pub, /displayName/);
  assert.match(pub, /p\.publicId/);
  assert.match(pub, /p\.target/);
  assert.match(pub, /p\.bio/);
  assert.match(pub, /p\.completion/);
  assert.match(pub, /p\.joinedYear/);
  // private fields must never appear in the public render
  for (const privateField of ['mobile', 'dob', 'dateOfBirth', 'school', 'higherInstitution', 'email']) {
    assert.doesNotMatch(pub, new RegExp(privateField, 'i'), `${privateField} leaked into public render`);
  }
  // invalid IDs render a safe not-found view, never a fetch
  assert.match(pub, /AH-\[A-Z2-9\]\{6\}/);
});

test('PATCH uses optimistic versioning with conflict + rate-limit handling', () => {
  assert.match(UI, /profile\/patch/);
  assert.match(UI, /expectVersion: state\.version/);
  assert.match(UI, /err\.status === 409/);
  assert.match(UI, /429/);
});

test('avatar pipeline: client downscale + generated default fallback + remove', () => {
  assert.match(UI, /downscaleToBase64/);
  assert.match(UI, /canvas\.width = w/);
  assert.match(UI, /image\/jpeg/);
  assert.match(UI, /2 \* 1024 \* 1024/);
  assert.match(UI, /profile\/avatar/);
  assert.match(UI, /method: 'DELETE'/);
});

test('completion is gentle, never pressure', () => {
  assert.match(UI, /data-completion-contract="gentle-completion-v1"/);
  assert.match(UI, /নিজের ঝামেলায়/);
  assert.doesNotMatch(UI, /এখনই সম্পূর্ণ করো/);
  assert.doesNotMatch(UI, /তোমার প্রোফাইল অসম্পূর্ণ/);
});

test('failure isolation: profile problems never break the app or session', () => {
  assert.match(UI, /pp-fallback/);
  assert.match(UI, /data-role="retry-profile"/);
  assert.match(UI, /session আর ডেটা ঠিক আছে/);
});

test('dynamic context: greeting + section order honored from the server', () => {
  assert.match(UI, /context\?\.greeting/);
  assert.match(UI, /context\?\.sectionOrder/);
  assert.match(UI, /SECTION_RENDER/);
});

test('index.html: Profile tab (6th) wired into bottom nav + router', () => {
  const navStart = HTML.indexOf('const NAV_TABS=[');
  const nav = HTML.slice(navStart, navStart + 900);
  assert.ok(navStart > 0);
  assert.match(nav, /key:'my-profile', icon:'👤', label:'Profile'/);
  // order: after history
  assert.ok(nav.indexOf("key:'history'") < nav.indexOf("key:'my-profile'"));
  const entries = nav.slice(0, nav.indexOf('];')).match(/key:'/g) || [];
  assert.equal(entries.length, 6);
  // baseTab highlights the profile tab
  assert.match(HTML, /if\(path==='my-profile'\) return 'my-profile'/);
  // hash route dispatch
  assert.match(HTML, /if\(p==='my-profile'\) return \(window\.renderProfilePage/);
  // Route-name regression: the legacy 'profile' hash route stays RETIRED
  // (redirected to dashboard) — the Profile tab must use a different path.
  assert.match(HTML, /const retiredAccountRoute = p === 'profile' \|\| p\.startsWith\('profile\/'\)/);
  assert.doesNotMatch(HTML, /if\(p==='profile'\)/);
  // pretty pathname URL dispatch
  assert.ok(HTML.includes("/^\\/(AH-[A-Z2-9]{6})\\/?$/"), "pathname dispatch regex missing");
  assert.match(HTML, /window\.renderPublicProfilePage\(pid\)/);
});

test('index.html: profile assets linked with versions', () => {
  assert.match(HTML, /<link rel="stylesheet" href="\.\/profile-ui\.css\?v=profile-v6">/);
  assert.match(HTML, /<script defer src="\.\/profile-ui\.js\?v=profile-v6"><\/script>/);
});

test('sw.js caches the profile assets', () => {
  assert.match(SW, /'\.\/profile-ui\.js\?v=profile-v6',/);
  assert.match(SW, /'\.\/profile-ui\.css\?v=profile-v6',/);
});

test('_redirects serves /AH-* to the SPA', () => {
  assert.match(REDIRECTS, /^\/AH-\* \/ 200/m);
});

test('dashboard avatar is the top entry point to the Profile tab', () => {
  assert.match(DASH, /dv2-avatar-tap/);
  assert.match(DASH, /dv2-avatar-tap[\s\S]{0,140}my-profile/);
  assert.match(DASH_CSS, /\.dv2-avatar-tap\{cursor:pointer\}/);
});

test('dashboard header upgrades to the uploaded avatar', () => {
  assert.match(DASH, /window\.__ahHasAvatar/);
  assert.match(DASH, /dv2-avatar-img/);
  assert.match(DASH_CSS, /\.dv2-avatar-img\{position:absolute/);
});

test('profile css: bottom sheet, toast, skeleton, 320px-safe wrap', () => {
  assert.match(CSS, /\.pp-sheet-backdrop \{ position: fixed/);
  assert.match(CSS, /safe-area-inset-bottom/);
  assert.match(CSS, /\.pp-skel/);
  assert.match(CSS, /max-width: 520px/);
  assert.match(CSS, /prefers-reduced-motion/);
});

test('profile chrome is code-native: no raster art classes in CSS', () => {
  assert.doesNotMatch(CSS, /url\(\s*["']?\.\/.*\.(png|jpe?g|webp)/i);
});

test('V2: identity space sections all present (hero, stats, academic, journey, achievements, prefs, privacy, edit, avatar)', () => {
  assert.match(UI, /pp-hero-row/);
  assert.match(UI, /Admission Candidate/);
  assert.match(UI, /pp-stats/);
  assert.match(UI, /Day Streak/);
  assert.match(UI, /pp-academic/);
  assert.match(UI, /TARGET UNIVERSITIES/);
  assert.match(UI, /ADMISSION SESSION/);
  assert.match(UI, /ACADEMIC GOAL/);
  assert.match(UI, /PREFERRED SUBJECTS/);
  assert.match(UI, /Your Journey/);
  assert.match(UI, /First Mock/);
  assert.match(UI, /Admission Ready/);
  assert.match(UI, /pp-achv-grid/);
  assert.match(UI, /Preferences/);
  assert.match(UI, /Privacy &amp; Visibility/);
  assert.match(UI, /pp-switch/);
  assert.match(UI, /Edit Profile/);
  assert.match(UI, /Change Avatar/);
  assert.match(UI, /Change Photo/);
  assert.match(UI, /Save Changes/);
});

test('V2: stats strip reads real local study data (never faked)', () => {
  assert.match(UI, /window\.CACHE/);
  assert.match(UI, /window\.computeStreak/);
  assert.match(UI, /examResults/);
  assert.match(UI, /r\?\.mode === 'mock'/);
  // honest empty state, no invented numbers
  assert.match(UI, /'—'/);
});

test('V2: Academic Identity — dedicated edit page, multi-field save in one PATCH', () => {
  assert.match(UI, /acad-save/);
  assert.match(UI, /acad-add-target/);
  assert.match(UI, /acad-del-target/);
  assert.match(UI, /acad-add-subject/);
  assert.match(UI, /acad-del-subject/);
  assert.match(UI, /pp-acad-session/);
  assert.match(UI, /pp-acad-goal/);
  assert.match(UI, /saveAcademicPage/);
  assert.match(UI, /academicDraftInit/);
  assert.match(UI, /open-academic/);
  // only-changed-fields single PATCH — single source of truth
  assert.match(UI, /fields\.targets = targets/);
  assert.match(UI, /fields\.admissionSession = session/);
  assert.match(UI, /fields\.academicGoal = goal/);
  assert.match(UI, /fields\.subjects = subjects/);
});

test('V2: journey + achievements are honest (display-only, no XP, no fake unlock)', () => {
  assert.match(UI, /real milestones/i);
  assert.match(UI, /display-only/i);
  assert.doesNotMatch(UI, /\+ *\d+ *XP/i);
  assert.match(UI, /journeyMilestones/);
  assert.match(UI, /ACHIEVEMENTS/);
});

test('V2: explicit preferences are user-controlled local-first data (Phase 8 bridge)', () => {
  assert.match(UI, /ah-profile-prefs-v1/);
  assert.match(UI, /loadPrefs/);
  assert.match(UI, /savePrefs/);
  assert.match(UI, /pref-notifications/);
  assert.match(UI, /pref-ai/);
  // unavailable options are honest (disabled), not faked
  assert.match(UI, /শীঘ্রই আসছে/);
});

test('V2: edit page validates before patching; avatar page has upload/camera/default tabs', () => {
  assert.match(UI, /saveEditPage/);
  assert.match(UI, /pp-edit-name/);
  assert.match(UI, /pp-edit-dob/);
  assert.match(UI, /pp-edit-bio/);
  assert.match(UI, /av-tab/);
  assert.match(UI, /pick-default-avatar/);
  assert.match(UI, /getUserMedia/);
  // six generated default avatar styles, zero raster
  assert.match(UI, /defaultAvatarSvg\(state\.data\?\.profile\?\.fullName/);
});

test('hotfix: bnYear maps all 10 digits via code points (no "undefined" regression)', () => {
  // digit table generated from U+09E6..U+09EF — structurally complete
  assert.match(UI, /String\.fromCharCode\(0x09E6 \+ i\)/);
  assert.match(UI, /BN_DIGITS\[d\]/);
  const BN_DIGITS = Array.from({ length: 10 }, (_, i) => String.fromCharCode(0x09E6 + i));
  const bnYear = (y) => String(y == null ? '' : y).replace(/[0-9]/g, (d) => BN_DIGITS[d]);
  assert.equal(bnYear(2026), '\u09E8\u09E6\u09E8\u09EC'); // ২০৬
  assert.equal(bnYear('1789'), '\u09E7\u09ED\u09EE\u09EF'); // ১৭৯
  assert.equal(bnYear(null), '');
  assert.ok(!String(bnYear(2026)).includes('undefined'));
});

test('hotfix: no skeleton loading — profile renders immediately (owner directive)', () => {
  assert.doesNotMatch(UI, /pp-skel[\s\S]{0,120}Profile লোড/);
  assert.match(UI, /renderCurrentView\(\);\n    loadProfile\(\)/);
});

test('hotfix: hero layout resilience — critical styles shipped inline with the page', () => {
  assert.match(UI, /CRITICAL_CSS/);
  assert.match(UI, /<style>\$\{CRITICAL_CSS\}<\/style>/);
  assert.match(UI, /\.pp-hero-avatar\{[^}]*width:72px[^}]*height:72px/);
});

test('V2: emerald visual language, no indigo remnant in profile chrome', () => {
  assert.match(CSS, /--pp-emerald: #0f6b4f/);
  assert.doesNotMatch(CSS, /#4c7af8/);
});

test('floating account launcher removed; Profile tab is the single account entry point', () => {
  const ACC = read('account-access.js');
  // the launcher element is never attached to the document body
  assert.doesNotMatch(ACC, /document\.body\.append\(launcher/);
  assert.match(ACC, /document\.body\.append\(pageHost\)/);
  // the profile page carries the account entry card + public API opener
  assert.match(UI, /data-account-card-contract="profile-account-entry-v1"/);
  assert.match(UI, /role === 'open-account'/);
  assert.match(UI, /acct\.open\(\)/);
  // guests still get a Sign In path
  assert.match(UI, /data-role="guest-signin"/);
});

/* ------------------------------------------------------------------ */
/* Profile V2 STRICT REBUILD (master prompt) — acceptance tests        */
/* ------------------------------------------------------------------ */

const INDEX = read('index.html');
const ACC = read('account-access.js');
const ENGINE = read('auth-native/core/auth-engine.mjs');

test('7B2: hero is the LIGHT reference design (dark text on mint, code-native wash, emerald edit button)', () => {
  assert.match(CSS, /\.pp-hero \{[^}]*background: linear-gradient\(160deg, #f2fbf6/);
  assert.match(CSS, /\.pp-hero \{[^}]*color: #0c3b2a/);
  assert.match(CSS, /\.pp-hero-edit \{[^}]*background: linear-gradient\(150deg, #16a34a, #15803d\); color: #fff/);
  assert.match(CSS, /\.pp-hero-avatar \{[^}]*border: 3px solid #16a34a/);
  // dark-emerald hero gradient is gone
  assert.doesNotMatch(CSS, /#0f6b4f 0%, #17845f 55%/);
  // hero wash is code-native SVG (no raster)
  assert.match(UI, /HERO_WASH/);
  assert.match(UI, /<svg class="pp-hero-wash"/);
  assert.doesNotMatch(UI, /pp-hero[^\n]*<img/);
});

test('7B2: guest profile — no fake identity, Login + Create Account + benefits checklist', () => {
  assert.match(UI, /data-guest-contract="guest-profile-v2"/);
  assert.match(UI, /Guest Profile/);
  assert.match(UI, /data-role="guest-signin"[^>]*>Login</);
  assert.match(UI, /data-role="guest-create"[^>]*>Create Account</);
  assert.match(UI, /With your profile, you can:/);
  const benefits = UI.match(/pp-guest-benefits[\s\S]{0,400}?<ul>/);
  assert.ok(benefits, 'benefits list present');
  const list = UI.slice(UI.indexOf('const benefits = ['), UI.indexOf('];', UI.indexOf('const benefits = [')));
  assert.match(list, /personalized practice/);
  assert.match(list, /recommendations/);
  assert.match(list, /Admission roadmap/);
  // zero fake data: no demo names/avatars/stats anywhere in the profile layer
  for (const hay of [UI, CSS, INDEX]) {
    assert.doesNotMatch(hay, /Rasel Ahmed/);
    assert.doesNotMatch(hay, /12\+ streak/i);
    assert.doesNotMatch(hay, /245 MCQ/i);
  }
});

test('7B2: save button state machine — SAVE → SAVING… → SUCCESS ✓ / FAILED → Try Again, double-tap guard', () => {
  assert.match(UI, /SAVE CHANGES → SAVING… → SUCCESS/);
  assert.match(UI, /btn.textContent = 'Saving…'/);
  assert.match(UI, /btn.textContent = 'SUCCESS ✓'/);
  assert.match(UI, /btn.textContent = 'Try Again'/);
  assert.match(UI, /if \(state\.busy\) return; \/\/ double-tap guard/);
  assert.match(CSS, /\.pp-save-busy/);
  assert.match(CSS, /\.pp-save-ok/);
  assert.match(CSS, /\.pp-save-fail/);
});

test('7B2: Academic Identity is a dedicated edit page (targets/session/goal/subjects + single Save Changes)', () => {
  assert.match(UI, /function academicPageMarkup/);
  assert.match(UI, /pp-acad-sec/);
  assert.match(UI, /Target Universities/);
  assert.match(UI, /Admission Session/);
  assert.match(UI, /Academic Goal/);
  assert.match(UI, /Preferred Subjects/);
  assert.match(UI, /data-role="acad-save"[^>]*>Save Changes</);
  assert.match(CSS, /\.pp-acad-sec \{ padding: 16px/);
});

test('7B2: 16px content padding + app-like scrolling without visible scrollbars', () => {
  assert.match(CSS, /\.pp-wrap \{ position: relative; padding: 2px 16px 34px/);
  assert.match(UI, /\.pp-wrap\{max-width:640px;margin:0 auto;padding:2px 16px 34px\}/);
  assert.match(INDEX, /scrollbar-width:none/);
  assert.match(INDEX, /::-webkit-scrollbar\{width:0;height:0;display:none;\}/);
});

test('7B2: achievements are real-data only (incl. Mistake Crusher from mastered mistakes) + honest empty state', () => {
  assert.match(UI, /mistake-crusher/);
  assert.match(UI, /m\.mastered === true/);
  assert.match(UI, /data-role="achievements-empty"/);
  assert.match(UI, /প্রথম achievement-এর জন্য প্রস্তুত/);
  assert.doesNotMatch(UI, /Top 10%/); // rankings we cannot compute are never faked
});

test('7B2: stats show real 0s once data is ready (never stale "—" after boot)', () => {
  assert.match(UI, /__admissionBootStatus/);
  assert.match(UI, /x == null \|\| !s\.ready/);
  assert.match(UI, /data-role="stats-note"/);
});

test('7B2: signup collects mobile and the server full-save accepts it (one source of truth)', () => {
  assert.match(ACC, /id="ah-signup-mobile"/);
  assert.match(ACC, /const normalizedMobile = /);
  assert.match(ACC, /mobile: normalizedMobile\(\)/);
  assert.match(ACC, /data-role="mobile-feedback"/);
  assert.match(ENGINE, /mobile: mobile \|\| ''/);
  assert.ok(ENGINE.includes('mobile && !/^\\+?[0-9]{8,15}$/.test(mobile)'), 'server mobile validation');
});
