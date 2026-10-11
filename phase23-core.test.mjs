// Public content pagination + offline hydration regression.
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0;
const test = (name, ok) => { if (ok) { pass++; console.log('  ✓', name); } else { fail++; console.error('  ✗', name); } };
const source = readFileSync('public-worker.js', 'utf8');
const bundle = readFileSync('worker-bundle.mjs', 'utf8');
const cloud = readFileSync('cloud-content-sync.js', 'utf8');

function grab(text, name) {
  const start = Math.max(text.indexOf(`const ${name} =`), text.indexOf(`var ${name} =`));
  if (start < 0) return '';
  const end = text.indexOf('\n};', start);
  return end < 0 ? '' : text.slice(start, end + 3);
}
const block = grab(source, 'paginateContent');
const bundledBlock = grab(bundle, 'paginateContent');
test('paginateContent exists in source and deploy bundle', !!block && !!bundledBlock);
if (block) {
  const paginate = new Function('return ' + block.replace(/^const paginateContent = /, '') + ';')();
  const doc = { v: 9, questions: [1, 2, 3, 4, 5], vocabulary: ['a', 'b', 'c'], subjects: [{}] };
  const page = paginate(doc, 2, 1);
  test('limit and offset return the expected page and total', page.questions.join(',') === '2,3' && page.total === 5 && page.page.limit === 2 && page.page.offset === 1 && page.v === 9);
  test('no positive limit preserves backward-compatible full document', paginate(doc, 0, 0) === doc);
  test('offset near end returns remaining rows only', paginate(doc, 10, 3).questions.join(',') === '4,5');
}
test('public content route still applies query pagination', source.includes("url.searchParams.get('limit')") && source.includes("url.searchParams.get('offset')") && bundle.includes('url.searchParams.get("limit")'));
test('cloud hydration keeps offline local-data fallback', cloud.includes('__ahCloudOffline') && cloud.includes('applySeedIfEmpty') && cloud.includes('putManyFast'));

/* The vocabulary bank is thousands of rows; writing it before render() is what
   made first load look stuck. It must be deferred past the first paint. */
const vmTool = readFileSync('vocabulary-master-tool.js', 'utf8');
test('vocabulary hydration is deferred, not on the first-paint path', (() => {
  const renderAt = cloud.indexOf('if (typeof render === \'function\') render();');
  const vmWriteAt = cloud.indexOf("putManyFast('vocabularyMaster'");
  return renderAt > -1 && vmWriteAt > -1 && renderAt < vmWriteAt;
})());
test('the deferred hydrate runs after a yield and returns a promise', cloud.includes('hydrateVocabularyInBackground') && /await new Promise\(r => setTimeout\(r, 0\)\)/.test(cloud));
test('a failed hydrate leaves the signature unsaved so it retries', /return false; \/\* a failed hydrate leaves the sig unsaved/.test(cloud));
test('the vocabulary tool exposes reload for the post-hydrate refresh', /async reload\(\)/.test(vmTool) && vmTool.includes('loadRecords(true)'));

/* Owner voice note (2026-10-11): 50 words per scroll, real per-category counts
   immediately (never a 0 flash), and one-time caching. */
test('the vocabulary bank pages 50 at a time', /visible: 50/.test(vmTool) && vmTool.includes('state.visible += 50') && vmTool.includes('Load 50 more words'));
test('scrolling loads the next page without a button press', vmTool.includes('vmLoadMoreSentinel') && vmTool.includes('IntersectionObserver') && vmTool.includes('api.loadMore()'));
test('per-category counts are cached so a cold open shows real numbers', vmTool.includes("COUNTS_KEY = 'vmCategoryCounts'") && vmTool.includes('function categoryFoundCount') && vmTool.includes('categoryCounts()'));
test('a category with no hydrated rows says "loading", not "0 words"', vmTool.includes('category-র শব্দ আসছে') && !/id="vmCategoryFound"[^`]*\$\{all\.length/.test(vmTool));

/* A first-ever device has no cached counts, so the totals must come from the
   meta endpoint. They stay out of countsOf because verifyIntegrity compares that
   object byte-for-byte against already-stored metas. */
test('meta carries per-category totals, kept out of the integrity counts', source.includes('const categoryCountsOf =') && source.includes('categories: categoryCountsOf(doc)') && !/vocabularyMaster: \(doc\.vocabularyMaster \|\| \[\]\)\.length,\s*\n\s*categories/.test(source));
test('the bundle carries the same per-category meta', bundle.includes('categoryCountsOf') && bundle.includes('categories'));
test('the client fetches meta counts when the bank is empty', vmTool.includes('ensureCloudCounts') && vmTool.includes("fetch('/api/content/meta'"));
test('hydration is public and carries no retired identity dependency', !/AHAuth|ahPubToken|authHeaders|\/api\/state/.test(cloud));

/* Owner report (2026-10-11): "still zero" + "something sinking at the bottom".
   The 30-card starter seed was planted on every cold load after the cloud pull,
   so a device whose bank was only the seed showed "30 words" for ever and the
   cloud short-circuit never re-fetched. And the offline pill floated over the
   bottom nav. */
test('the starter seed is off by default so the bank stays cloud-authoritative', vmTool.includes('AH_VOCAB_SEED_ENABLED === true) await seedCategoryA()'));
test('a device behind the server pulls the whole bank, bypassing the sig short-circuit', vmTool.includes('refreshBankFromCloud') && /state\.records\.length < cloudTotal/.test(vmTool) && vmTool.includes("fetch('/api/content'"));
test('the planted starter cards are removed once the real bank lands', vmTool.includes("record.id.startsWith('vm-seed-a-')") && vmTool.includes('dbDelRaw'));
test('the offline pill sits above the bottom nav, never over it', readFileSync('offline-status.css','utf8').includes('bottom:calc(70px + env(safe-area-inset-bottom,0px))'));
test('the pill never shows a lingering "syncing" state over the nav', !readFileSync('offline-status.js','utf8').includes('সিংক হচ্ছে'));
test('the vocabulary page clears the sticky bottom nav', vmTool.includes('padding-bottom:calc(74px + env(safe-area-inset-bottom,0px))'));

/* A changed asset under an unchanged ?v= is served immutable for a year, so a
   device keeps the old file and the fix never lands. Every tool asset edited
   alongside the bank must carry a fresh token. */
const indexHtml = readFileSync('index.html', 'utf8');
test('the vocabulary tool and the sync bridge carry fresh asset tokens', indexHtml.includes('vocabulary-master-tool.js?v=vm-scroll50-v109') && indexHtml.includes('cloud-content-sync.js?v=vm-d1meta-v222'));
console.log(`\nPUBLIC CONTENT CORE: ${pass} pass / ${fail} fail`);
if (fail) process.exit(1);
