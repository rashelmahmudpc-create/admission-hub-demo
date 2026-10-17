// Fresh Start phase 4: wipe every user record from the AUTH_AUTHORITY Durable
// Object SQLite while keeping the OTP/verification settings and schema meta.
// Two-step on purpose: a dry run returns exact counts; the real wipe only runs
// when the caller echoes `WIPE-ALL-<users>` for the count it just saw.

/** Tables that survive the wipe (owner order 2026-10-17: keep OTP config + Admin settings). */
export const WIPE_KEEP_TABLES = Object.freeze([
  'auth_verification_runtime_config',
  'auth_verification_provider_state',
  'auth_verification_daily_quota',
  'auth_meta',
  'schema_migrations'
]);

const INTERNAL_TABLE = /^(sqlite_|_cf_)/;
const SAFE_NAME = /^[A-Za-z0-9_]+$/;

const rows = result => (Array.isArray(result) ? result : (typeof result?.toArray === 'function' ? result.toArray() : [...(result || [])]));

export function listWipeTables(sql) {
  return rows(sql.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"))
    .map(row => String(row.name))
    .filter(name => SAFE_NAME.test(name) && !INTERNAL_TABLE.test(name) && !WIPE_KEEP_TABLES.includes(name));
}

const countOf = (sql, table) => Number(rows(sql.exec(`SELECT COUNT(*) AS n FROM "${table}"`))[0]?.n || 0);

export function wipeCounts(sql) {
  const tables = {};
  let rowsTotal = 0;
  for (const table of listWipeTables(sql)) {
    const n = countOf(sql, table);
    tables[table] = n;
    rowsTotal += n;
  }
  const users = Object.hasOwn(tables, 'auth_users') ? tables.auth_users : 0;
  return { users, rows: rowsTotal, tables, kept: [...WIPE_KEEP_TABLES] };
}

export const wipeConfirmPhrase = users => `WIPE-ALL-${Number(users) || 0}`;

/**
 * Deletes all rows of every non-kept table. Child tables reference auth_users
 * without ON DELETE CASCADE, so deletes run in passes until nothing is left
 * (a parent delete that hits a foreign key simply waits for the next pass).
 */
export function wipeAll(sql) {
  const tables = listWipeTables(sql);
  const deleted = Object.fromEntries(tables.map(table => [table, countOf(sql, table)]));
  let pending = tables.filter(table => deleted[table] > 0);
  let passes = 0;
  const failures = {};
  while (pending.length && passes < tables.length + 1) {
    passes += 1;
    const next = [];
    for (const table of pending) {
      try {
        sql.exec(`DELETE FROM "${table}"`);
        delete failures[table];
      } catch (error) {
        failures[table] = String(error?.message || error).slice(0, 160);
        next.push(table);
      }
    }
    if (next.length === pending.length) break;
    pending = next;
  }
  const remaining = Object.fromEntries(tables.map(table => [table, countOf(sql, table)]).filter(([, n]) => n > 0));
  return { passes, deleted, remaining, failures, complete: Object.keys(remaining).length === 0 };
}
