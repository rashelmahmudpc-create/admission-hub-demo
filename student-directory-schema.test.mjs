// Fresh Start phase 2: versioned student-directory schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  STUDENT_DIRECTORY_MIGRATIONS,
  STUDENT_DIRECTORY_LATEST_VERSION,
  currentStudentDirectoryVersion,
  migrateStudentDirectory,
  normalizeEmail
} from './auth-native/storage/student-directory-schema.mjs';
import { SqliteAuthRepository } from './auth-native/storage/sqlite-auth-repository.mjs';
import { SqliteVerificationRepository } from './auth-native/verification/sqlite-verification-repository.mjs';

const NOW = 1_800_000_000_000;
const TABLES = ['students', 'login_methods', 'email_verifications', 'otp_attempts', 'sessions', 'devices', 'profiles', 'activity_log'];

// Same shape as the Durable Object storage: sql.exec + transactionSync, with
// foreign keys ON (Durable Object SQLite always enforces them).
function storageFixture() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  const sql = {
    exec(statement, ...bindings) {
      const prepared = database.prepare(statement);
      if (prepared.reader) return prepared.all(...bindings);
      prepared.run(...bindings);
      return [];
    }
  };
  return { database, storage: { sql, transactionSync(work) { return database.transaction(work)(); } } };
}

const tableNames = database => database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);

function addStudent(database, id, email, extra = {}) {
  database.prepare('INSERT INTO students (id, email, email_normalized, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, email, normalizeEmail(email), extra.status || 'pending', NOW, NOW);
}

test('fresh database gets every directory table and the latest version', () => {
  const { database, storage } = storageFixture();
  assert.equal(currentStudentDirectoryVersion(storage), 0);
  const result = migrateStudentDirectory(storage, { now: NOW });
  assert.equal(result.version, STUDENT_DIRECTORY_LATEST_VERSION);
  assert.deepEqual(result.applied, STUDENT_DIRECTORY_MIGRATIONS.map(m => m.version));
  const names = tableNames(database);
  for (const table of [...TABLES, 'schema_migrations']) assert.ok(names.includes(table), `missing table ${table}`);
  const row = database.prepare('SELECT version, name, applied_at FROM schema_migrations WHERE version = 1').get();
  assert.deepEqual(row, { version: 1, name: 'student_directory_v1', applied_at: NOW });
});

test('migration is idempotent: a second run applies nothing and keeps data', () => {
  const { database, storage } = storageFixture();
  migrateStudentDirectory(storage, { now: NOW });
  addStudent(database, 's1', 'one@example.com');
  const again = migrateStudentDirectory(storage, { now: NOW + 1 });
  assert.deepEqual(again.applied, []);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM students').get().n, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, STUDENT_DIRECTORY_MIGRATIONS.length);
});

test('existing auth tables with old data keep working next to the new schema', () => {
  const { database, storage } = storageFixture();
  const auth = new SqliteAuthRepository(storage);
  auth.migrate();
  const verification = new SqliteVerificationRepository(storage);
  verification.migrate();
  const before = tableNames(database).filter(name => name.startsWith('auth_')).sort();
  database.prepare('INSERT INTO auth_meta (key, value) VALUES (?, ?)').run('legacy-marker', 'kept');
  migrateStudentDirectory(storage, { now: NOW });
  const after = tableNames(database).filter(name => name.startsWith('auth_')).sort();
  assert.deepEqual(after, before, 'no auth_* table may be added, dropped or renamed');
  assert.equal(database.prepare('SELECT value FROM auth_meta WHERE key = ?').get('legacy-marker').value, 'kept');
  // The legacy migrations still run cleanly afterwards (every Durable Object start).
  auth.migrate();
  verification.migrate();
  migrateStudentDirectory(storage, { now: NOW + 5 });
  for (const table of TABLES) assert.equal(database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, `${table} must start empty (no data migrated)`);
});

test('normalizeEmail trims and lowercases but keeps plus aliases and dots', () => {
  assert.equal(normalizeEmail('  RashelMahmudPC+OtpTest1017@Gmail.COM '), 'rashelmahmudpc+otptest1017@gmail.com');
  assert.equal(normalizeEmail('first.last@gmail.com'), 'first.last@gmail.com');
  assert.equal(normalizeEmail('ＡＢＣ@example.com'), 'abc@example.com');
  for (const bad of ['', 'no-at', '@example.com', 'a@', 'a@@b.com', 'a b@c.com', null, undefined]) assert.equal(normalizeEmail(bad), '', String(bad));
});

test('email is unique after normalization; unnormalized values are rejected', () => {
  const { database, storage } = storageFixture();
  migrateStudentDirectory(storage, { now: NOW });
  addStudent(database, 's1', 'Student@Example.com');
  assert.throws(() => addStudent(database, 's2', '  student@EXAMPLE.com'), /UNIQUE/);
  assert.throws(() => database.prepare('INSERT INTO students (id, email, email_normalized, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('s3', 'X@Example.com', 'X@Example.com', NOW, NOW), /CHECK/);
  assert.throws(() => database.prepare('INSERT INTO students (id, email, email_normalized, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('s4', 'y@example.com', 'y@example.com', 'weird', NOW, NOW), /CHECK/);
});

test('login methods are limited to the five supported kinds and one identity maps to one student', () => {
  const { database, storage } = storageFixture();
  migrateStudentDirectory(storage, { now: NOW });
  addStudent(database, 's1', 'a@example.com');
  addStudent(database, 's2', 'b@example.com');
  const insert = database.prepare('INSERT INTO login_methods (student_id, method, provider_subject, created_at) VALUES (?, ?, ?, ?)');
  for (const method of ['password', 'google', 'facebook', 'telegram', 'passkey']) insert.run('s1', method, method === 'password' ? '' : `${method}-sub-1`, NOW);
  assert.throws(() => insert.run('s1', 'github', 'x', NOW), /CHECK/);
  assert.throws(() => insert.run('s2', 'google', 'google-sub-1', NOW), /UNIQUE/);
  insert.run('s2', 'password', '', NOW);
  assert.throws(() => insert.run('s2', 'password', '', NOW), /UNIQUE/);
  assert.throws(() => insert.run('missing', 'password', '', NOW), /FOREIGN KEY/);
});

test('deleting a student cascades to every child table', () => {
  const { database, storage } = storageFixture();
  migrateStudentDirectory(storage, { now: NOW });
  addStudent(database, 's1', 'a@example.com');
  addStudent(database, 's2', 'b@example.com');
  for (const id of ['s1', 's2']) {
    database.prepare('INSERT INTO login_methods (student_id, method, created_at) VALUES (?, ?, ?)').run(id, 'password', NOW);
    const ev = database.prepare('INSERT INTO email_verifications (student_id, email_normalized, channel, provider_id, created_at) VALUES (?, ?, ?, ?, ?)').run(id, `${id}@x.com`, 'otp', 'otp-a', NOW);
    database.prepare('INSERT INTO otp_attempts (student_id, email_verification_id, provider_id, outcome, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, ev.lastInsertRowid, 'otp-a', 'sent', 420, NOW);
    database.prepare('INSERT INTO devices (id, student_id, device_hash, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(`d-${id}`, id, `h-${id}`, NOW, NOW);
    database.prepare('INSERT INTO sessions (id, student_id, device_id, login_method, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)').run(`x-${id}`, id, `d-${id}`, 'password', NOW, NOW);
    database.prepare('INSERT INTO profiles (student_id, full_name, updated_at) VALUES (?, ?, ?)').run(id, 'Name', NOW);
    database.prepare('INSERT INTO activity_log (student_id, kind, detail_json, created_at) VALUES (?, ?, ?, ?)').run(id, 'signup', '{"via":"password"}', NOW);
  }
  database.prepare('DELETE FROM students WHERE id = ?').run('s1');
  for (const table of TABLES.filter(t => t !== 'students')) {
    assert.equal(database.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE student_id = 's1'`).get().n, 0, `${table} kept s1 rows`);
    assert.equal(database.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE student_id = 's2'`).get().n, 1, `${table} lost s2 rows`);
  }
});

test('otp history and activity log validate their values', () => {
  const { database, storage } = storageFixture();
  migrateStudentDirectory(storage, { now: NOW });
  addStudent(database, 's1', 'a@example.com');
  const otp = database.prepare('INSERT INTO otp_attempts (student_id, provider_id, outcome, latency_ms, created_at) VALUES (?, ?, ?, ?, ?)');
  for (const outcome of ['sent', 'failed', 'timeout', 'verified', 'wrong_code', 'expired', 'skipped']) otp.run('s1', 'otp-a', outcome, 10, NOW);
  assert.throws(() => otp.run('s1', 'otp-a', 'delivered', 10, NOW), /CHECK/);
  assert.throws(() => otp.run('s1', 'otp-a', 'sent', -1, NOW), /CHECK/);
  assert.throws(() => database.prepare('INSERT INTO activity_log (student_id, kind, detail_json, created_at) VALUES (?, ?, ?, ?)').run('s1', 'x', '{bad json', NOW), /CHECK/);
  assert.throws(() => database.prepare('INSERT INTO email_verifications (student_id, email_normalized, channel, created_at) VALUES (?, ?, ?, ?)').run('s1', 'a@example.com', 'sms', NOW), /CHECK/);
});

test('no column can hold a password, OTP code or session token', () => {
  const { database, storage } = storageFixture();
  migrateStudentDirectory(storage, { now: NOW });
  for (const table of TABLES) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    for (const column of columns) assert.doesNotMatch(column, /password|secret|token|code_hash|^code$|otp_code/i, `${table}.${column}`);
  }
});

test('a failed migration rolls back completely and can be retried', () => {
  const { database, storage } = storageFixture();
  migrateStudentDirectory(storage, { now: NOW });
  const broken = [...STUDENT_DIRECTORY_MIGRATIONS, { version: 99, name: 'broken', statements: ['CREATE TABLE half_done (id INTEGER)', 'THIS IS NOT SQL'] }];
  assert.throws(() => migrateStudentDirectory(storage, { now: NOW, migrations: broken }));
  assert.equal(tableNames(database).includes('half_done'), false);
  assert.equal(currentStudentDirectoryVersion(storage), STUDENT_DIRECTORY_LATEST_VERSION);
  assert.throws(() => migrateStudentDirectory(storage, { migrations: [{ version: 2, name: 'b', statements: [] }, { version: 2, name: 'c', statements: [] }] }), /strictly increasing/);
});
