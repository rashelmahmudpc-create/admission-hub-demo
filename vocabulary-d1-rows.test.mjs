/* The vocabulary bank is filled from the cloud document (D1 fast path or the KV
 * blob). Those rows carry no `tool` field, while a locally-authored row does.
 * The loader used to require `tool === 'vocabulary-master'`, so every cloud row
 * was dropped and the bank rendered "0 words" on any device that had only ever
 * pulled from the cloud — the exact owner report on 2026-10-11.
 *
 * This runs the SHIPPED vocabulary-master-tool.js against cloud-shaped rows and
 * asserts the bank loads them. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const toolSrc = readFileSync(new URL('./vocabulary-master-tool.js', import.meta.url), 'utf8');

function makeEnv(seedRows) {
  const makeEl = () => ({
    id: '', textContent: '', dataset: {}, innerHTML: '', style: {},
    setAttribute() {}, appendChild() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
  });
  const document = {
    createElement: () => makeEl(),
    head: { appendChild() {} },
    body: { appendChild() {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener() {},
    readyState: 'complete',
  };
  const listeners = {};
  const noopStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const window = {
    Router: { path: 'vocabulary-master/bank' },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    setTimeout: () => 0, clearTimeout: () => {},
    render: () => {}, navigate: () => {}, toast: () => {},
    localStorage: noopStorage,
  };
  const sandbox = {
    window, document,
    dbGetAll: async () => seedRows,
    dbPut: async () => {}, dbDelRaw: async () => {}, DB: null,
    navigate: () => {}, toast: () => {}, render: () => {}, loadCache: async () => {},
    sessionStorage: noopStorage, localStorage: noopStorage,
    location: { hash: '#vocabulary-master/bank' },
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    setInterval: () => 0, clearInterval: () => {},
    console,
  };
  const names = Object.keys(sandbox);
  new Function(...names, toolSrc)(...names.map(k => sandbox[k]));
  return { window };
}

const cloudRows = () => [
  // Exactly the shape /api/content returns: no `tool` key.
  { id: 'vm-abacus', word: 'Abacus', meaning: 'গণনা যন্ত্র', category: 'A', normalized: 'abacus', order: 0, synonyms: [{ word: 'Forsake', meaning: 'ত্যাগ' }], antonyms: [] },
  { id: 'vm-abandon', word: 'Abandon', meaning: 'বর্জন করা', category: 'A', normalized: 'abandon', order: 1, synonyms: [], antonyms: [] },
  { id: 'vm-ban', word: 'Ban', meaning: 'নিষেধাজ্ঞা', category: 'B', normalized: 'ban', order: 2, synonyms: [], antonyms: [] },
];

test('vm-d1-01: the loader keeps cloud rows that carry no tool marker', async () => {
  const rows = cloudRows();
  assert.ok(rows.every(r => !('tool' in r)), 'fixture must mirror the cloud shape (no tool key)');
  const { window } = makeEnv(rows);
  assert.ok(window.VocabularyMaster, 'the tool must register itself');
  const count = await window.VocabularyMaster.bankCount();
  assert.equal(count, rows.length, 'every cloud row must load into the bank');
});

test('vm-d1-02: locally-authored rows (with the tool marker) still load', async () => {
  const rows = cloudRows().map(r => ({ ...r, tool: 'vocabulary-master' }));
  const { window } = makeEnv(rows);
  assert.equal(await window.VocabularyMaster.bankCount(), rows.length);
});
