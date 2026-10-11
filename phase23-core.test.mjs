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
test('hydration is public and carries no retired identity dependency', !/AHAuth|ahPubToken|authHeaders|\/api\/state/.test(cloud));
console.log(`\nPUBLIC CONTENT CORE: ${pass} pass / ${fail} fail`);
if (fail) process.exit(1);
