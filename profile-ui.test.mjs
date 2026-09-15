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
  assert.match(HTML, /<link rel="stylesheet" href="\.\/profile-ui\.css\?v=profile-v4">/);
  assert.match(HTML, /<script defer src="\.\/profile-ui\.js\?v=profile-v4"><\/script>/);
});

test('sw.js caches the profile assets', () => {
  assert.match(SW, /'\.\/profile-ui\.js\?v=profile-v4',/);
  assert.match(SW, /'\.\/profile-ui\.css\?v=profile-v4',/);
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

test('V2: academic identity persists multi-targets + session + goal + subjects through PATCH', () => {
  assert.match(UI, /sheet-save-targets/);
  assert.match(UI, /admissionSession/);
  assert.match(UI, /academicGoal/);
  assert.match(UI, /sheet-save-subjects/);
  assert.match(UI, /\{ targets: list \}/);
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
