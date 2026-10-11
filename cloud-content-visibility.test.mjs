/* The public backend fills the local stores over fetch. Those rows carry no
 * ownership metadata, and the fetch context is scoped to a guest user id that is
 * regenerated per browser — so fromScopedRecord dropped every pulled row. The
 * stores were physically full (6,256 rows in vocabularyMaster) while every
 * screen read 0. This pins the real reader policy: downloaded content is visible
 * to the account and to a signed-out guest; another account's rows are not. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const HTML = readFileSync('index.html', 'utf8');

function reader(scope) {
  const sandbox = { DATA_SCOPE: scope, console };
  vm.createContext(sandbox);
  const decls = HTML.split('\n')
    .filter(l => /const (persistentDataScope|scopedRecordId|toScopedRecord|fromScopedRecord|publicRecordShape|isOwnRecord|isPublicRecord|withViewableRecords)=/.test(l))
    .join('\n');
  return vm.runInContext(
    decls + ';({fromScopedRecord,toScopedRecord,withViewableRecords,isOwnRecord,isPublicRecord})',
    sandbox
  );
}

const pulledRow = () => ({ id: 'vm-abacus', word: 'Abacus', meaning: 'গণনা যন্ত্র', category: 'A' });

test('cld-01: a pulled row with no ownership metadata is readable by the account', () => {
  const { withViewableRecords } = reader('account1234');
  const visible = withViewableRecords([pulledRow()]);
  assert.equal(visible.length, 1, 'downloaded content must reach the screen');
  assert.equal(visible[0].id, 'vm-abacus');
  assert.equal(visible[0].word, 'Abacus');
});

test('cld-02: ownership metadata is stripped off the row handed to callers', () => {
  const { withViewableRecords } = reader('account1234');
  const raw = { ...pulledRow(), __ahOwner: 'account1234', __ahId: 'vm-abacus' };
  const [visible] = withViewableRecords([raw]);
  assert.equal(visible.__ahOwner, undefined, 'never leak ownership metadata');
  assert.equal(visible.id, 'vm-abacus', 'the bare id must come back');
});

test('cld-03: another account\'s row never becomes visible', () => {
  const { withViewableRecords } = reader('account1234');
  const foreign = { id: 'other-1', word: 'Secret', __ahOwner: 'someoneelse', __ahId: 'other-1' };
  assert.equal(withViewableRecords([foreign]).length, 0, 'cross-account rows must stay hidden');
});

test('cld-04: the signed-in account still sees its own rows', () => {
  const { withViewableRecords, toScopedRecord } = reader('account1234');
  const own = toScopedRecord({ id: 'mine', word: 'Mine' });
  const visible = withViewableRecords([own]);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, 'mine');
});

test('cld-05: a signed-out guest also reads the persisted store', () => {
  // The guest branch must fall back to IndexedDB, not only the session memory map.
  assert.match(HTML, /function readPublicStore\(store\)/);
  const guest = HTML.slice(HTML.indexOf('function dbGetAll(store)'), HTML.indexOf('function dbGet(store,id)'));
  assert.match(guest, /readPublicStore\(store\)/, 'guest reads must include the persisted store');
});

test('cld-06: dbGet applies the same policy', () => {
  const get = HTML.slice(HTML.indexOf('function dbGet(store,id)'), HTML.indexOf('/* Raw (unscoped-hiding) access'));
  assert.match(get, /isOwnRecord\(record\)\|\|isPublicRecord\(record\)/, 'dbGet must not hand back a foreign row');
});
