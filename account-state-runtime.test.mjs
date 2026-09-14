import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SqliteAuthRepository } from './auth-native/storage/sqlite-auth-repository.mjs';
import { MemoryAuthRepository } from './auth-native/testing/memory-auth-repository.mjs';
import { CloudflareNativeAuthEngine } from './auth-native/core/auth-engine.mjs';
import { AUTH_ERROR_CODES } from './auth-native/core/errors.mjs';

const NOW = 1_800_000_000_000;
const EXPIRY = 1_800_864_000_000;

const establishInput = (userId, overrides = {}) => Object.freeze({
  provider: 'firebase',
  subjectRef: `subject-${userId}`,
  userIdCandidate: userId,
  emailRef: `email-ref-${userId}`,
  emailMask: `u***@example.com`,
  sessionRef: `session-${userId}`,
  sessionExpiresAt: EXPIRY,
  ipRef: 'ip-ref',
  deviceRef: 'device-ref',
  userAgent: 'Chrome',
  now: NOW,
  ...overrides
});

function sqliteFixture() {
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
  return { database, repository: new SqliteAuthRepository({ sql, transactionSync(work) { return database.transaction(work)(); } }) };
}

async function establish(repository, userId) {
  const result = await repository.establishExternalSession(establishInput(userId));
  assert.equal(result.established, true, JSON.stringify(result));
  return result;
}

test('established user defaults to active lifecycle state (no state row)', async () => {
  const { repository } = sqliteFixture();
  repository.migrate();
  await establish(repository, 'user-1');
  const state = await repository.getAccountState({ userId: 'user-1', now: NOW });
  assert.equal(state.status, 'active');
  assert.equal(state.stateVersion, 0);
});

test('unknown user returns the normalized not-found error', async () => {
  const { repository } = sqliteFixture();
  repository.migrate();
  const state = await repository.getAccountState({ userId: 'ghost', now: NOW });
  assert.equal(state.error, AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND);
  const set = await repository.setAccountState({ userId: 'ghost', toStatus: 'suspended', now: NOW });
  assert.equal(set.error, AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND);
});

test('valid transition writes state and audit events', async () => {
  const { database, repository } = sqliteFixture();
  repository.migrate();
  await establish(repository, 'user-1');
  const result = await repository.setAccountState({ userId: 'user-1', toStatus: 'suspended', now: NOW + 1000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 'suspended');
  assert.equal(result.stateVersion, 1);
  assert.equal(result.changed, true);
  const events = database.prepare("SELECT event_type FROM auth_security_events WHERE user_id='user-1'").all().map(r => r.event_type);
  assert.ok(events.includes('account-state-changed'));
  const reread = await repository.getAccountState({ userId: 'user-1', now: NOW + 2000 });
  assert.equal(reread.status, 'suspended');
  assert.equal(reread.stateVersion, 1);
});

test('invalid transition is rejected without any write', async () => {
  const { database, repository } = sqliteFixture();
  repository.migrate();
  await establish(repository, 'user-1');
  const result = await repository.setAccountState({ userId: 'user-1', toStatus: 'provisioning', now: NOW + 1000 });
  assert.equal(result.error, AUTH_ERROR_CODES.ACCOUNT_STATE_INVALID);
  const rows = database.prepare('SELECT COUNT(*) AS count FROM auth_account_state').get();
  assert.equal(rows.count, 0);
  const events = database.prepare("SELECT COUNT(*) AS count FROM auth_security_events WHERE user_id='user-1' AND event_type='account-state-changed'").get();
  assert.equal(events.count, 0);
});

test('suspension revokes every live session for the user', async () => {
  const { repository } = sqliteFixture();
  repository.migrate();
  await establish(repository, 'user-1');
  await repository.establishExternalSession(establishInput('user-1', { sessionRef: 'session-1b', userIdCandidate: 'user-1' }));
  const result = await repository.setAccountState({ userId: 'user-1', toStatus: 'suspended', now: NOW + 1000 });
  assert.equal(result.revokedSessions, 2);
  const probe = await repository.getExternalSession({
    sessionRef: 'session-1b', provider: 'firebase', subjectRef: 'subject-user-1', emailRef: 'email-ref-user-1', now: NOW + 2000
  });
  assert.equal(probe.error, AUTH_ERROR_CODES.SESSION_INVALID);
});

test('deactivation is reversible only through the recovery path', async () => {
  const { repository } = sqliteFixture();
  repository.migrate();
  await establish(repository, 'user-1');
  const off = await repository.setAccountState({ userId: 'user-1', toStatus: 'deactivated', now: NOW + 1000 });
  assert.equal(off.status, 'deactivated');
  const direct = await repository.setAccountState({ userId: 'user-1', toStatus: 'active', now: NOW + 2000 });
  assert.equal(direct.error, AUTH_ERROR_CODES.ACCOUNT_STATE_INVALID);
  const recovering = await repository.setAccountState({ userId: 'user-1', toStatus: 'recovery', now: NOW + 3000 });
  assert.equal(recovering.status, 'recovery');
  const back = await repository.setAccountState({ userId: 'user-1', toStatus: 'active', now: NOW + 4000 });
  assert.equal(back.status, 'active');
  assert.equal(back.stateVersion, 3);
});

test('entering the same state is a no-op (idempotent)', async () => {
  const { repository } = sqliteFixture();
  repository.migrate();
  await establish(repository, 'user-1');
  const first = await repository.setAccountState({ userId: 'user-1', toStatus: 'active', now: NOW + 1000 });
  assert.equal(first.changed, false);
  assert.equal(first.stateVersion, 0);
  const again = await repository.setAccountState({ userId: 'user-1', toStatus: 'active', now: NOW + 2000 });
  assert.equal(again.changed, false);
});

test('memory repository mirrors the sqlite lifecycle contract', async () => {
  const repository = new MemoryAuthRepository();
  const state = await repository.getAccountState({ userId: 'ghost', now: NOW });
  assert.equal(state.error, AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND);

  await establish(repository, 'user-1');
  const baseline = await repository.getAccountState({ userId: 'user-1', now: NOW });
  assert.equal(baseline.status, 'active');
  assert.equal(baseline.stateVersion, 0);

  const bad = await repository.setAccountState({ userId: 'user-1', toStatus: 'provisioning', now: NOW + 1000 });
  assert.equal(bad.error, AUTH_ERROR_CODES.ACCOUNT_STATE_INVALID);

  const suspended = await repository.setAccountState({ userId: 'user-1', toStatus: 'suspended', now: NOW + 2000 });
  assert.equal(suspended.status, 'suspended');
  assert.equal(suspended.changed, true);
  assert.equal(suspended.revokedSessions, 1);
  const probe = await repository.getExternalSession({
    sessionRef: 'session-user-1', provider: 'firebase', subjectRef: 'subject-user-1', emailRef: 'email-ref-user-1', now: NOW + 3000
  });
  assert.equal(probe.error, AUTH_ERROR_CODES.SESSION_INVALID);
  const audit = repository.events.filter(e => e.type === 'account-state-changed').length;
  assert.equal(audit, 1);
});

test('engine contract requires the lifecycle methods on any repository', () => {
  assert.doesNotThrow(() => new CloudflareNativeAuthEngine({ repository: new MemoryAuthRepository(), hmacSecret: 'x'.repeat(40) }));
  const broken = new MemoryAuthRepository();
  broken.setAccountState = undefined; // shadow the prototype method
  assert.throws(() => new CloudflareNativeAuthEngine({ repository: broken, hmacSecret: 'x'.repeat(40) }));
});
