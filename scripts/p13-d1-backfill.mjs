/* P13 — D1 backfill: turn the live /api/content document into SQL that fills the
 * indexed `questions` table the read path queries.
 *
 *   node scripts/p13-d1-backfill.mjs --in content.json --out backfill.sql
 *   node scripts/p13-d1-backfill.mjs --url https://<worker>/api/content --out backfill.sql
 *
 * Emits: CREATE TABLE/INDEXES (from p13-d1-read.mjs SCHEMA), a DELETE for a
 * clean re-run, then batched INSERT ... ON CONFLICT so re-running is idempotent.
 * Pure string building, so it is unit-testable without a database.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { SCHEMA } from '../p13-d1-read.mjs';

const DIFFICULTY = { easy: 1, medium: 2, hard: 3, mixed: 0 };
const BATCH = 25;

const sqlStr = v => (v === null || v === undefined) ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const sqlInt = v => { const n = Number(v); return Number.isFinite(n) ? String(Math.trunc(n)) : '0'; };

/* difficulty arrives as a word ("mixed") from the live doc; the column is an
   integer tier so it can be ranged on. Unknown words fall to 0 (mixed). */
export function difficultyTier(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0;
  return DIFFICULTY[String(value || '').toLowerCase()] ?? 0;
}

/* A stable, indexed sort key. topic first so a topic page is one contiguous
   range, then id — matching idx_q_topic(topic_id, sort_key, id). */
export function sortKeyFor(q) {
  return `${q.topicId || ''}|${q.subjectId || ''}|${q.id || ''}`;
}

export function questionToRow(q, now = Date.now()) {
  const payload = { ...q };
  delete payload.id;
  return {
    id: String(q.id),
    topic_id: String(q.topicId || ''),
    subject_id: String(q.subjectId || ''),
    difficulty: difficultyTier(q.difficulty),
    published: 1,
    sort_key: sortKeyFor(q),
    payload: JSON.stringify(payload),
    updated_at: now,
  };
}

export function buildSql(doc, { now = Date.now(), batch = BATCH } = {}) {
  const questions = Array.isArray(doc && doc.questions) ? doc.questions : [];
  const rows = questions.filter(q => q && q.id).map(q => questionToRow(q, now));
  const out = [];
  out.push('-- P13 D1 backfill — generated, idempotent.');
  out.push(SCHEMA.trim());
  // No explicit BEGIN/COMMIT: D1 runs on Durable Objects, which reject SQL
  // transaction statements (wrangler: "use state.storage.transaction()").
  // `d1 execute` applies the file atomically anyway.
  out.push('DELETE FROM questions;');
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    out.push('INSERT INTO questions (id, topic_id, subject_id, difficulty, published, sort_key, payload, updated_at) VALUES');
    out.push(chunk.map(r =>
      `  (${sqlStr(r.id)}, ${sqlStr(r.topic_id)}, ${sqlStr(r.subject_id)}, ${sqlInt(r.difficulty)}, 1, ${sqlStr(r.sort_key)}, ${sqlStr(r.payload)}, ${sqlInt(r.updated_at)})`
    ).join(',\n') + '\nON CONFLICT(id) DO UPDATE SET topic_id=excluded.topic_id, subject_id=excluded.subject_id, difficulty=excluded.difficulty, published=excluded.published, sort_key=excluded.sort_key, payload=excluded.payload, updated_at=excluded.updated_at;');
  }
  out.push(`SELECT COUNT(*) AS rows FROM questions;`);
  return out.join('\n') + '\n';
}

export function buildFromContentJson(jsonText, opts) {
  return buildSql(JSON.parse(jsonText), opts);
}

function arg(name, fallback = '') {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const out = arg('out', 'backfill.sql');
  const file = arg('in', '');
  const url = arg('url', '');
  let text;
  if (file) text = readFileSync(file, 'utf8');
  else if (url) {
    const res = await fetch(url, { headers: { 'X-AH-App': 'admission-hub' } });
    if (!res.ok) throw new Error('fetch ' + url + ' -> HTTP ' + res.status);
    text = await res.text();
  } else {
    console.error('usage: node scripts/p13-d1-backfill.mjs --in content.json | --url <endpoint> [--out backfill.sql]');
    process.exit(2);
  }
  const sql = buildFromContentJson(text, { now: Date.now() });
  writeFileSync(out, sql);
  const rows = (JSON.parse(text).questions || []).length;
  console.log(`p13-d1-backfill: ${rows} questions -> ${out} (${sql.length} bytes)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('backfill error:', e && e.message); process.exit(1); });
}
