import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const VOICE = readFileSync(new URL('./vocabulary-elevenlabs.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

function boot(fetchImpl, overrides = {}) {
  const rows = new Map();
  let getAllCalls = 0;
  const window = {
    toast() {},
    speechSynthesis: { cancel() {} },
    VocabularyPronunciation: { speakTtsOnly() {} }
  };
  const navigator = { onLine: true };
  const localStorage = { getItem() { return ''; }, setItem() {}, removeItem() {} };
  const urlApi = { createObjectURL() { return 'blob:voice-test'; }, revokeObjectURL() {} };
  const context = {
    window, navigator, localStorage, fetch: fetchImpl,
    Blob, ArrayBuffer, Uint8Array, URL: urlApi,
    setTimeout, clearTimeout, AbortController,
    dbGet: async (store, key) => store === 'voiceCache' ? rows.get(key) : undefined,
    dbPut: async (store, row) => {
      if (overrides.dbPut) return overrides.dbPut(store, row, rows);
      if (store === 'voiceCache') rows.set(row.id, structuredClone(row));
      return row;
    },
    dbGetAll: async store => {
      getAllCalls++;
      if (overrides.dbGetAll) return overrides.dbGetAll(store, rows);
      return store === 'voiceCache' ? [...rows.values()] : [];
    },
    dbDelRaw: async (store, key) => { if (store === 'voiceCache') rows.delete(key); return true; }
  };
  if (overrides.dbClear) context.dbClear = overrides.dbClear;
  window.navigator = navigator;
  window.localStorage = localStorage;
  window.URL = urlApi;
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  runInNewContext(VOICE, context, { filename: 'vocabulary-elevenlabs.js' });
  return { window, api: window.VocabularyElevenLabs, rows, getAllCalls: () => getAllCalls };
}

function audioResponse() {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob([new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3])], { type: 'audio/mpeg' }),
    json: async () => ({})
  };
}

test('voice cache stores ArrayBuffer bytes and replays them without a second fetch', async () => {
  let fetchCalls = 0;
  const harness = boot(async () => { fetchCalls++; return audioResponse(); });
  const first = await harness.api.speakWord('Ephemeral', null);
  assert.match(first, /^generated/);
  assert.equal(fetchCalls, 1);
  const stored = harness.rows.values().next().value;
  assert.ok(stored, 'the generated clip must be cached');
  assert.equal(Object.prototype.toString.call(stored.audioBytes), '[object ArrayBuffer]');
  assert.equal('audioBlob' in stored, false, 'new IndexedDB records must not contain Blob/File values');
  assert.equal(stored.audioType, 'audio/mpeg');

  const second = await harness.api.speakWord('Ephemeral', null);
  assert.equal(second, 'cache');
  assert.equal(fetchCalls, 1, 'cached playback must not refetch');
});

test('reset barrier prevents an in-flight vocabulary prefetch from repopulating the cache', async () => {
  let announceFetch;
  let finishFetch;
  const fetchStarted = new Promise(resolve => { announceFetch = resolve; });
  const responsePending = new Promise(resolve => { finishFetch = resolve; });
  const harness = boot(() => { announceFetch(); return responsePending; });
  const prefetch = harness.api.prefetchWords(['race'], 1);
  await fetchStarted;
  harness.api.beginUserDataReset();
  finishFetch(audioResponse());
  await prefetch;
  harness.api.endUserDataReset();
  assert.equal(harness.rows.size, 0, 'a pre-reset request must not write after deletion');
});

test('the exact Safari Blob write error is handled; live audio resolves as uncached', async () => {
  const exactSafariError = 'Error preparing Blob/File data to be stored in object store';
  const harness = boot(async () => audioResponse(), {
    dbPut: async () => { throw new Error(exactSafariError); }
  });
  const result = await harness.api.speakWord('Ephemeral', null);
  assert.match(result, /^generated-uncached/);
  assert.equal(harness.window.__lastVoiceError, exactSafariError);
});

test('clear-all uses the scoped clear helper instead of materializing legacy Blob rows', async () => {
  let clearStore = '';
  const harness = boot(async () => { throw new Error('fetch should not run'); }, {
    dbClear: async store => { clearStore = store; return 3; },
    dbGetAll: async () => { throw new Error('Blob rows must not be read'); }
  });
  assert.equal(await harness.api.clearAll(), 3);
  assert.equal(clearStore, 'voiceCache');
  assert.equal(harness.getAllCalls(), 0);
});

test('scoped reset deletes all stores in one queued transaction and only scans synced rows for tombstones', () => {
  const helper = HTML.match(/async function dbClearStoresAtomically\(stores\)\{[\s\S]*?\n\}/)?.[0] || '';
  const reset = HTML.match(/function resetAll\(\)\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(helper, /queueDb\(\(\)=>new Promise/);
  assert.match(helper, /DB\.transaction\(names,'readwrite'\)/);
  assert.match(helper, /if\(STUDENT_SYNC_STORES\.has\(name\)\)/);
  assert.match(helper, /objectStore\.delete\(range\)/);
  assert.match(reset, /await dbClearStoresAtomically\(STORES\)/);
  assert.match(reset, /beginUserDataReset/);
  assert.match(reset, /catch\(error\)/);
  assert.match(HTML, /Your saved data may still be on this device; its status has not been verified\./);
  assert.doesNotMatch(HTML, /Your saved questions, vocabulary, progress, and settings were not deleted\./);
});

test('legacy Blob cache rows stay readable while new writes migrate to bytes', async () => {
  let fetchCalls = 0;
  const harness = boot(async () => { fetchCalls++; throw new Error('cached legacy voice should not refetch'); });
  const key = harness.api.cacheKey('Legacy word');
  harness.rows.set(key, { id: key, audioBlob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }), size: 3 });
  const result = await harness.api.speakWord('Legacy word', null);
  assert.equal(result, 'cache');
  assert.equal(fetchCalls, 0);
});

test('overlapping reset barriers stay closed until the last reset finishes', async () => {
  let fetchCalls = 0;
  const harness = boot(async () => { fetchCalls++; return audioResponse(); });
  harness.api.beginUserDataReset();
  harness.api.beginUserDataReset();
  harness.api.endUserDataReset();
  assert.equal(await harness.api.prefetchWords(['blocked'], 1), 0);
  assert.equal(fetchCalls, 0, 'one active reset must keep cache writes blocked');
  harness.api.endUserDataReset();
  assert.equal(await harness.api.prefetchWords(['allowed'], 1), 1);
  assert.equal(fetchCalls, 1, 'cache writes resume after every reset completes');
});
