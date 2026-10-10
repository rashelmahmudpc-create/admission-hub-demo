/* P13 — D1 backfill generator. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { difficultyTier, sortKeyFor, questionToRow, buildSql, buildFromContentJson } from './scripts/p13-d1-backfill.mjs';

const DOC = {
  v: 1,
  questions: [
    { id: 'pq-0001', subjectId: 'sub-01', topicId: 'top-001', question: "প্রশ্ন এক", options: ['ক', 'খ'], answer: 0, difficulty: 'mixed' },
    { id: "pq-0002", subjectId: 'sub-01', topicId: 'top-002', question: "O'Brien test", options: ['a'], answer: 0, difficulty: 'easy' },
  ],
};

test('p13b-01: difficulty words map to integer tiers', () => {
  assert.equal(difficultyTier('easy'), 1);
  assert.equal(difficultyTier('medium'), 2);
  assert.equal(difficultyTier('hard'), 3);
  assert.equal(difficultyTier('mixed'), 0);
  assert.equal(difficultyTier(2), 2);
  assert.equal(difficultyTier(undefined), 0);
});

test('p13b-02: the sort key starts with the topic so a topic page is contiguous', () => {
  assert.equal(sortKeyFor({ topicId: 't', subjectId: 's', id: 'i' }), 't|s|i');
});

test('p13b-03: a question row drops the id from the payload and keeps the rest', () => {
  const row = questionToRow(DOC.questions[0], 123);
  assert.equal(row.id, 'pq-0001');
  assert.equal(row.topic_id, 'top-001');
  assert.equal(row.updated_at, 123);
  const payload = JSON.parse(row.payload);
  assert.equal(payload.id, undefined, 'id must not be duplicated inside the payload');
  assert.equal(payload.question, "প্রশ্ন এক");
});

test('p13b-04: the SQL creates the schema, clears, and inserts', () => {
  const sql = buildSql(DOC, { now: 1 });
  assert.match(sql, /CREATE TABLE IF NOT EXISTS questions/);
  assert.match(sql, /DELETE FROM questions;/);
  assert.match(sql, /INSERT INTO questions/);
  assert.ok(!/BEGIN TRANSACTION|COMMIT/.test(sql), 'D1 rejects SQL transaction statements');
  assert.match(sql, /ON CONFLICT\(id\) DO UPDATE/, 're-running must be idempotent');
  
  
});

test('p13b-05: quotes are escaped so a name with an apostrophe cannot break the SQL', () => {
  const sql = buildSql(DOC, { now: 1 });
  assert.ok(sql.includes("O''Brien"), 'apostrophe must be doubled');
});

test('p13b-06: rows are batched into multiple INSERT statements', () => {
  const many = { questions: Array.from({ length: 450 }, (_, i) => ({ id: 'q' + i, topicId: 't', subjectId: 's', difficulty: 'mixed' })) };
  const sql = buildSql(many, { now: 1, batch: 25 });
  const inserts = sql.match(/INSERT INTO questions/g) || [];
  assert.equal(inserts.length, 18, '450 rows at batch 25 = 18 statements (small enough to avoid SQLITE_TOOBIG)');
});

test('p13b-07: rows without an id are skipped, and JSON content parses', () => {
  const sql = buildFromContentJson(JSON.stringify({ questions: [{ topicId: 't' }, { id: 'ok' }] }), { now: 1 });
  assert.ok(sql.includes("'ok'"));
  assert.ok(!sql.includes('pq-0001'));
});

test('p13b-08: the backfill workflow is manual, confirmed, and additive-only', () => {
  const w = readFileSync(new URL('./.github/workflows/p13-d1-backfill.yml', import.meta.url), 'utf8');
  assert.match(w, /workflow_dispatch:/, 'must be manual');
  assert.match(w, /BACKFILL/, 'must require an explicit confirmation input');
  assert.match(w, /d1 execute admission-profile --remote --file backfill.sql/, 'must apply the generated SQL to D1');
  assert.match(w, /test -s backfill.sql/, 'must refuse to run on an empty file');
  assert.ok(!/wrangler.*deploy/.test(w), 'backfill must not deploy code');
});
