/* Integration: the adoption module must produce rows that the app's REAL
 * scoping functions accept. A shape mismatch would leave adopted data just as
 * invisible as before, so this wires legacy-adoption.js to the actual
 * scopedRecordId/toScopedRecord/fromScopedRecord definitions in index.html. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const HTML = readFileSync('index.html', 'utf8');
const ADOPT = readFileSync('legacy-adoption.js', 'utf8');

function loadAdoption() {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(ADOPT, sandbox, { filename: 'legacy-adoption.js' });
  return sandbox.window.AHLegacyAdoption;
}

function realScoping(scope) {
  const sandbox = { DATA_SCOPE: scope, console };
  vm.createContext(sandbox);
  const lines = HTML.split('\n');
  const pick = re => lines.filter(l => re.test(l)).join('\n');
  const decls = pick(/const persistentDataScope=|const scopedRecordId=|const toScopedRecord=|const fromScopedRecord=/);
  assert.ok(decls.includes('fromScopedRecord'), 'scoping functions must be present in index.html');
  return vm.runInContext(
    decls + ';({persistentDataScope,scopedRecordId,toScopedRecord,fromScopedRecord})',
    sandbox);
}

test('an adopted row is readable through the real fromScopedRecord', () => {
  const scope = 'AbCdEf12Gh';
  const { scopedRecordId, toScopedRecord, fromScopedRecord } = realScoping(scope);
  const mod = loadAdoption();

  const legacy = { id: 'm1', word: 'apple', stats: { attempts: 3 } };
  const { ops } = mod.planStore([legacy], scope);
  const doc = ops[0].doc;

  /* The app's own writer uses toScopedRecord — the two must agree exactly. */
  const expected = toScopedRecord(legacy);
  assert.equal(JSON.stringify(doc), JSON.stringify({ ...expected, __ahId: String(expected.__ahId) }));

  const visible = fromScopedRecord(doc);
  assert.equal(visible.id, 'm1', 'bare id restored');
  assert.equal(visible.word, 'apple');
  assert.deepEqual(visible.stats, { attempts: 3 });
  assert.equal(visible.__ahOwner, undefined, 'ownership metadata is stripped on read');
  assert.equal(visible.__ahId, undefined);
  assert.equal(doc.id, scopedRecordId('m1'), 'primary key is the scoped id');
});

test('a still-unscoped legacy row stays invisible (proving the bug the fix addresses)', () => {
  const scope = 'AbCdEf12Gh';
  const { fromScopedRecord } = realScoping(scope);
  assert.equal(fromScopedRecord({ id: 'm1', word: 'apple' }), null,
    'unscoped rows are hidden — this is exactly why signing in looked like a wipe');
});

test('adopted data survives an app-style read of the whole store', () => {
  const scope = 'ZyXwVu98Ts';
  const { fromScopedRecord } = realScoping(scope);
  const mod = loadAdoption();

  const raw = [
    { id: 'note-a', text: 'first' },
    { id: 'note-b', text: 'second' },
    { id: 'OtherAcc::x', __ahOwner: 'OtherAcc', __ahId: 'x', text: 'not mine' }
  ];
  const { ops } = mod.planStore(raw, scope);
  const after = [...raw.filter(r => !ops.some(o => o.from === r.id)), ...ops.map(o => o.doc)];
  const visible = after.map(fromScopedRecord).filter(Boolean);
  assert.equal(visible.length, 2, 'exactly the adopted rows are visible to this account');
  assert.deepEqual(visible.map(v => v.text).sort(), ['first', 'second']);
});
