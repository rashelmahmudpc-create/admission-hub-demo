import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SqliteAuthRepository } from './auth-native/storage/sqlite-auth-repository.mjs';
import { CloudflareNativeAuthEngine } from './auth-native/core/auth-engine.mjs';
import { AUTH_ERROR_CODES, NativeAuthError } from './auth-native/core/errors.mjs';
import { MemoryAuthRepository } from './auth-native/testing/memory-auth-repository.mjs';
import { D1ProfileStore, defaultAvatarSpec } from './auth-native/storage/d1-profile-repository.mjs';

const SECRET = 'profile-core-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWX';
const START = 1_800_000_000_000;
const AVATAR_LIMIT = 2 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Fake D1 (in-memory) — same statement surface D1ProfileStore uses.
// ---------------------------------------------------------------------------
function makeFakeD1() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      const execute = (args = []) => ({
        async run() {
          if (/^CREATE TABLE/i.test(sql)) return { changes: 0 };
          if (/INSERT INTO avatars/i.test(sql)) {
            const [userId, data, mime, bytes, updatedAt] = args;
            rows.set(userId, { data, mime, bytes, updated_at: updatedAt });
            return { changes: 1 };
          }
          if (/DELETE FROM avatars/i.test(sql)) { rows.delete(args[0]); return { changes: 1 }; }
          return { changes: 0 };
        },
        async first() {
          const row = rows.get(args[0]);
          if (!row) return null;
          if (/SELECT data/i.test(sql)) return { ...row };
          return { mime: row.mime, bytes: row.bytes, updated_at: row.updated_at };
        },
        async all() { return { results: [] }; }
      });
      return { run: () => execute([]), bind: (...args) => execute(args) };
    }
  };
}

function makeState({ d1 = null } = {}) {
  let now = START;
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
  const repository = new SqliteAuthRepository({ sql, transactionSync(work) { return database.transaction(work)(); } });
  repository.migrate();
  const engine = new CloudflareNativeAuthEngine({
    repository,
    hmacSecret: SECRET,
    now: () => now,
    avatarStore: d1 ? new D1ProfileStore(d1) : null
  });
  const context = { ip: '198.51.100.21', deviceId: 'device-profile-a-0123456789ab', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Chrome/140' };
  return { database, repository, engine, context, d1, now: () => now, advance: ms => { now += ms; } };
}

function makeMemoryState({ d1 = null } = {}) {
  let now = START;
  const repository = new MemoryAuthRepository();
  const engine = new CloudflareNativeAuthEngine({
    repository,
    hmacSecret: SECRET,
    now: () => now,
    avatarStore: d1 ? new D1ProfileStore(d1) : null
  });
  const context = { ip: '198.51.100.22', deviceId: 'device-profile-b-0123456789ab', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140' };
  return { repository, engine, context, now: () => now, advance: ms => { now += ms; } };
}

const login = (state, email, subject) => state.engine.establishFirebaseSession(
  { email, subject, remember: true, verified: true, newDevice: true, securityChallenge: false },
  state.context
);
const profileInput = (loginResult, email, subject) => ({
  sessionToken: loginResult.sessionToken, email, subject
});

const eventsOf = (state, type) => {
  if (state.repository.events) return state.repository.events.filter(row => row.eventType === type);
  return state.database.prepare('SELECT * FROM auth_security_events WHERE event_type=?').all(type);
};

// 4×4 JPEG-like payload with a valid SOI magic prefix.
const tinyJpeg = () => {
  const bytes = new Uint8Array(128);
  bytes[0] = 0xff; bytes[1] = 0xd8; bytes[2] = 0xff; bytes[3] = 0xe0;
  for (let i = 4; i < bytes.length; i += 1) bytes[i] = i % 251;
  return bytes;
};
const toBase64 = bytes => Buffer.from(bytes).toString('base64');

// ---------------------------------------------------------------------------
// 1 — Provisioning (blueprint §4: creation failure must never fail login)
// ---------------------------------------------------------------------------

test('sqlite: first verified session without an onboarding row auto-provisions a neutral editable profile', async () => {
  const state = makeState();
  const email = 'legacy@example.com';
  const subject = 'sub-legacy-1';
  const session = await login(state, email, subject);
  const result = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  assert.ok(result.profile, 'a profile row must exist');
  assert.equal(result.profile.fullName, '');
  assert.equal(result.profile.dob, '');
  assert.equal(result.profile.visibility, 'private');
  assert.equal(result.completion, 0);
  assert.match(result.publicId, /^AH-[A-Z2-9]{6}$/);
  // provisioning must be a recorded, audited event
  assert.ok(eventsOf(state, 'profile-provisioned').length >= 1);
});

test('sqlite: provisioning is idempotent (no duplicate rows/events on repeated reads)', async () => {
  const state = makeState();
  const email = 'legacy2@example.com';
  const subject = 'sub-legacy-2';
  const session = await login(state, email, subject);
  await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  assert.equal(eventsOf(state, 'profile-provisioned').length, 1);
  assert.equal(state.database.prepare('SELECT COUNT(*) AS n FROM auth_profiles').get().n, 1);
});

test('sqlite: onboarding accounts (profile already saved) are NOT re-provisioned', async () => {
  const state = makeState();
  const email = 'onboarded@example.com';
  const subject = 'sub-onboarded-1';
  const session = await login(state, email, subject);
  await state.engine.saveProfile({
    sessionToken: session.sessionToken, email, subject,
    profile: {
      fullName: 'Rafiq Islam', dob: '2008-04-12',
      school: { id: 'manual', name: 'Ideal School', district: 'Chittagong' },
      higherInstitution: null
    }
  }, state.context);
  const result = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  assert.equal(result.profile.fullName, 'Rafiq Islam');
  assert.equal(eventsOf(state, 'profile-provisioned').length, 0);
  assert.equal(result.completion, 30); // V2 weights: name 15 + dob 10 + school 5
});

// ---------------------------------------------------------------------------
// 2 — Public ID (blueprint §14: unique, permanent, non-sensitive, display-only)
// ---------------------------------------------------------------------------

test('sqlite: public ID is stable across reads and distinct per user', async () => {
  const state = makeState();
  const a = await login(state, 'a@example.com', 'sub-pub-a');
  const b = await login(state, 'b@example.com', 'sub-pub-b');
  const ra1 = await state.engine.getProfileV2(profileInput(a, 'a@example.com', 'sub-pub-a'), state.context);
  const ra2 = await state.engine.getProfileV2(profileInput(a, 'a@example.com', 'sub-pub-a'), state.context);
  const rb = await state.engine.getProfileV2(profileInput(b, 'b@example.com', 'sub-pub-b'), state.context);
  assert.equal(ra1.publicId, ra2.publicId);
  assert.notEqual(ra1.publicId, rb.publicId);
  assert.match(ra1.publicId, /^AH-[A-Z2-9]{6}$/);
  // the alphabet must not contain ambiguous glyphs
  assert.ok(!/[0O1IL]/.test(ra1.publicId.slice(3)));
});

test('sqlite: public ID is permanent (survives profile edits and re-reads)', async () => {
  const state = makeState();
  const email = 'perm@example.com';
  const subject = 'sub-perm-1';
  const session = await login(state, email, subject);
  const before = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  await state.engine.saveProfilePatch({
    ...profileInput(session, email, subject),
    fields: { bio: 'future doctor' }
  }, state.context);
  const after = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  assert.equal(before.publicId, after.publicId);
});

// ---------------------------------------------------------------------------
// 3 — PATCH semantics + optimistic concurrency (blueprint §27, §28)
// ---------------------------------------------------------------------------

test('sqlite: patch changes only provided fields (no accidental full-record overwrite)', async () => {
  const state = makeState();
  const email = 'patch@example.com';
  const subject = 'sub-patch-1';
  const session = await login(state, email, subject);
  await state.engine.saveProfile({
    sessionToken: session.sessionToken, email, subject,
    profile: {
      fullName: 'Sadia Noor', dob: '2007-11-02',
      school: { id: 'manual', name: 'Chittagong College', district: 'Chittagong' },
      higherInstitution: null
    }
  }, state.context);
  const v = (await state.engine.getProfileV2(profileInput(session, email, subject), state.context)).profile.version;
  const result = await state.engine.saveProfilePatch({
    ...profileInput(session, email, subject),
    fields: { mobile: '+8801712345678' },
    expectVersion: v
  }, state.context);
  assert.equal(result.saved, true);
  assert.equal(result.profile.mobile, '+8801712345678');
  assert.equal(result.profile.fullName, 'Sadia Noor');
  assert.equal(result.profile.dob, '2007-11-02');
  assert.equal(result.profile.school.name, 'Chittagong College');
  assert.equal(result.profile.version, v + 1);
});

test('sqlite: stale expectVersion returns PROFILE_VERSION_CONFLICT and keeps the record intact', async () => {
  const state = makeState();
  const email = 'conflict@example.com';
  const subject = 'sub-conflict-1';
  const session = await login(state, email, subject);
  await state.engine.getProfileV2(profileInput(session, email, subject), state.context); // provision → v1
  await assert.rejects(
    state.engine.saveProfilePatch({
      ...profileInput(session, email, subject),
      fields: { bio: 'first edit' },
      expectVersion: 99
    }, state.context),
    error => error instanceof NativeAuthError && error.code === AUTH_ERROR_CODES.PROFILE_VERSION_CONFLICT
  );
  const untouched = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  assert.equal(untouched.profile.version, 1);
  assert.equal(untouched.profile.bio, '');
});

test('sqlite: correct expectVersion after a concurrent edit succeeds on retry', async () => {
  const state = makeState();
  const email = 'retry@example.com';
  const subject = 'sub-retry-1';
  const session = await login(state, email, subject);
  const first = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  await state.engine.saveProfilePatch({
    ...profileInput(session, email, subject),
    fields: { bio: 'edit A' }, expectVersion: first.profile.version
  }, state.context);
  const second = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  const retried = await state.engine.saveProfilePatch({
    ...profileInput(session, email, subject),
    fields: { bio: 'edit B (based on latest)' }, expectVersion: second.profile.version
  }, state.context);
  assert.equal(retried.saved, true);
  assert.equal(retried.profile.bio, 'edit B (based on latest)');
});

test('sqlite: session remains valid after a profile error (failure isolation, blueprint §37)', async () => {
  const state = makeState();
  const email = 'iso@example.com';
  const subject = 'sub-iso-1';
  const session = await login(state, email, subject);
  await assert.rejects(
    state.engine.saveProfilePatch({
      ...profileInput(session, email, subject), fields: { bio: 'x' }, expectVersion: 42
    }, state.context),
    error => error.code === AUTH_ERROR_CODES.PROFILE_VERSION_CONFLICT
  );
  const alive = await state.engine.getFirebaseSession(session.sessionToken, { email, subject }, state.context);
  assert.ok(alive.expiresAt > START);
});

// ---------------------------------------------------------------------------
// 4 — Field validation (blueprint §26)
// ---------------------------------------------------------------------------

test('sqlite: mobile accepts BD/intl formats and rejects junk', async () => {
  const state = makeState();
  const email = 'mob@example.com';
  const subject = 'sub-mob-1';
  const session = await login(state, email, subject);
  await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  const ok = await state.engine.saveProfilePatch({
    ...profileInput(session, email, subject),
    fields: { mobile: ' +880 1712-345678 ' }
  }, state.context);
  assert.equal(ok.profile.mobile, '+8801712345678');
  for (const bad of ['abc', '12345', '01234567890123456', '+', '12 34']) {
    await assert.rejects(
      state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { mobile: bad } }, state.context),
      error => error.code === AUTH_ERROR_CODES.INVALID_INPUT
    );
  }
});

test('sqlite: bio is limited to 280 chars and stripped of line breaks', async () => {
  const state = makeState();
  const email = 'bio@example.com';
  const subject = 'sub-bio-1';
  const session = await login(state, email, subject);
  await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  await assert.rejects(
    state.engine.saveProfilePatch({
      ...profileInput(session, email, subject),
      fields: { bio: 'x'.repeat(281) }
    }, state.context),
    error => error.code === AUTH_ERROR_CODES.INVALID_INPUT
  );
  const ok = await state.engine.saveProfilePatch({
    ...profileInput(session, email, subject),
    fields: { bio: `dreams of\nmedicine ${'y'.repeat(261)}` }
  }, state.context);
  assert.equal(ok.profile.bio.length, 280);
  assert.ok(!ok.profile.bio.includes('\n'));
});

test('sqlite: target patch stores the primary goal and clears on null', async () => {
  const state = makeState();
  const email = 'goal@example.com';
  const subject = 'sub-goal-1';
  const session = await login(state, email, subject);
  const v1 = (await state.engine.getProfileV2(profileInput(session, email, subject), state.context)).profile.version;
  const set = await state.engine.saveProfilePatch({
    ...profileInput(session, email, subject),
    fields: { target: { name: 'Rajshahi University', unit: 'A Unit', year: '2026' } },
    expectVersion: v1
  }, state.context);
  assert.deepEqual(set.profile.targets, [{ name: 'Rajshahi University', unit: 'A Unit', year: '2026' }]);
  const v2 = set.profile.version;
  const cleared = await state.engine.saveProfilePatch({
    ...profileInput(session, email, subject),
    fields: { target: null },
    expectVersion: v2
  }, state.context);
  assert.deepEqual(cleared.profile.targets, []);
});

test('sqlite: visibility accepts the frozen enum only', async () => {
  const state = makeState();
  const email = 'vis@example.com';
  const subject = 'sub-vis-1';
  const session = await login(state, email, subject);
  await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  for (const value of ['public', 'limited', 'private']) {
    const result = await state.engine.saveProfilePatch({
      ...profileInput(session, email, subject), fields: { visibility: value }
    }, state.context);
    assert.equal(result.profile.visibility, value);
  }
  await assert.rejects(
    state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { visibility: 'everyone' } }, state.context),
    error => error.code === AUTH_ERROR_CODES.INVALID_INPUT
  );
});

test('sqlite: unknown patch fields are rejected (strict input, no silent extension)', async () => {
  const state = makeState();
  const email = 'strict@example.com';
  const subject = 'sub-strict-1';
  const session = await login(state, email, subject);
  await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  await assert.rejects(
    state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { email: 'hacked@evil.com' } }, state.context),
    error => error.code === AUTH_ERROR_CODES.INVALID_INPUT
  );
  await assert.rejects(
    state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: {} }, state.context),
    error => error.code === AUTH_ERROR_CODES.INVALID_INPUT
  );
});

test('sqlite: email/credential fields are NOT patchable (auth/profile separation, blueprint §2, §8)', async () => {
  const state = makeState();
  const email = 'sep@example.com';
  const subject = 'sub-sep-1';
  const session = await login(state, email, subject);
  await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  for (const key of ['email', 'password', 'provider', 'subject']) {
    await assert.rejects(
      state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { [key]: 'x' } }, state.context),
      error => error.code === AUTH_ERROR_CODES.INVALID_INPUT
    );
  }
});

// ---------------------------------------------------------------------------
// 5 — Completion engine (blueprint §6: future-ready, never pressure)
// ---------------------------------------------------------------------------

test('sqlite: completion is a weighted, display-only percentage', async () => {
  const state = makeState();
  const email = 'comp@example.com';
  const subject = 'sub-comp-1';
  const session = await login(state, email, subject);
  let view = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  assert.equal(view.completion, 0); // provisioned empty
  // name + dob + school via onboarding-style full save
  await state.engine.saveProfile({
    sessionToken: session.sessionToken, email, subject,
    profile: {
      fullName: 'Tanvir Ahmed', dob: '2009-01-30',
      school: { id: 'manual', name: 'Bindhabari College', district: 'Chittagong' },
      higherInstitution: null
    }
  }, state.context);
  view = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  assert.equal(view.completion, 30); // V2 weights: name 15 + dob 10 + school 5
  await state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { mobile: '+8801812345678' } }, state.context);
  view = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  assert.equal(view.completion, 40); // + mobile 10
  await state.engine.saveProfilePatch({
    ...profileInput(session, email, subject),
    fields: { target: { name: 'BUET', unit: 'CSE', year: '2027' } }
  }, state.context);
  view = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  assert.equal(view.completion, 55); // + targets 15
});

// ---------------------------------------------------------------------------
// 6 — Avatar system (blueprint §9-§11) on the D1 store
// ---------------------------------------------------------------------------

test('d1: avatar upload validates MIME + magic bytes + size and stores safely', async () => {
  const state = makeState({ d1: makeFakeD1() });
  const email = 'avatar@example.com';
  const subject = 'sub-avatar-1';
  const session = await login(state, email, subject);
  await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  const bytes = tinyJpeg();
  const saved = await state.engine.saveAvatar({
    ...profileInput(session, email, subject), data: toBase64(bytes), mime: 'image/jpeg'
  }, state.context);
  assert.equal(saved.saved, true);
  assert.equal(saved.bytes, bytes.byteLength);
  const view = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  assert.equal(view.avatar.present, true);
  assert.equal(view.avatar.mime, 'image/jpeg');
  assert.equal(view.avatarUrl, '/api/auth/v1/profile/avatar');
  assert.equal(eventsOf(state, 'profile-avatar-changed').length, 1);
});

test('d1: avatar round-trip returns the exact bytes with the right MIME', async () => {
  const state = makeState({ d1: makeFakeD1() });
  const email = 'rt@example.com';
  const subject = 'sub-rt-1';
  const session = await login(state, email, subject);
  const bytes = tinyJpeg();
  await state.engine.saveAvatar({ ...profileInput(session, email, subject), data: toBase64(bytes), mime: 'image/jpeg' }, state.context);
  const data = await state.engine.getAvatarData(profileInput(session, email, subject), state.context);
  assert.equal(data.present, true);
  const restored = Uint8Array.from(Buffer.from(data.data, 'base64'));
  assert.deepEqual([...restored], [...bytes]);
  assert.equal(data.mime, 'image/jpeg');
});

test('d1: fake MIME / wrong magic / oversized / bad base64 all rejected', async () => {
  const state = makeState({ d1: makeFakeD1() });
  const email = 'abuse@example.com';
  const subject = 'sub-abuse-1';
  const session = await login(state, email, subject);
  const jpeg = tinyJpeg();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...jpeg.subarray(8)]);
  const oversized = new Uint8Array(AVATAR_LIMIT + 1);
  oversized[0] = 0xff; oversized[1] = 0xd8; oversized[2] = 0xff;
  const cases = [
    { data: toBase64(jpeg), mime: 'image/png' },               // wrong magic for claimed MIME
    { data: toBase64(png), mime: 'image/jpeg' },               // mismatched
    { data: toBase64(oversized), mime: 'image/jpeg' },         // > 2MB
    { data: '!!!not-base64!!!', mime: 'image/jpeg' },          // bad base64
    { data: toBase64(jpeg), mime: 'application/pdf' },         // disallowed MIME
    { data: toBase64(jpeg), mime: 'text/html' }                // disallowed MIME
  ];
  for (const input of cases) {
    await assert.rejects(
      state.engine.saveAvatar({ ...profileInput(session, email, subject), ...input }, state.context),
      error => error.code === AUTH_ERROR_CODES.INVALID_INPUT,
      `should reject ${input.mime}`
    );
  }
  assert.equal(state.d1?.rows?.size ?? 0, 0);
});

test('d1: avatar removal resets to the generated default and drops the completion credit', async () => {
  const state = makeState({ d1: makeFakeD1() });
  const email = 'remove@example.com';
  const subject = 'sub-remove-1';
  const session = await login(state, email, subject);
  await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  const bytes = tinyJpeg();
  await state.engine.saveAvatar({ ...profileInput(session, email, subject), data: toBase64(bytes), mime: 'image/jpeg' }, state.context);
  const withAvatar = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  assert.equal(withAvatar.avatar.present, true);
  const removed = await state.engine.deleteAvatar(profileInput(session, email, subject), state.context);
  assert.equal(removed.deleted, true);
  const after = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  assert.equal(after.avatar.present, false);
  assert.equal(after.avatarUrl, null);
  assert.equal(after.completion, withAvatar.completion - 10);
  assert.ok(eventsOf(state, 'profile-avatar-removed').length >= 1);
});

test('d1: avatar store absent → upload fails closed, profile reads still work (failure isolation)', async () => {
  const state = makeState(); // no d1
  const email = 'noavatar@example.com';
  const subject = 'sub-noavatar-1';
  const session = await login(state, email, subject);
  await assert.rejects(
    state.engine.saveAvatar({ ...profileInput(session, email, subject), data: toBase64(tinyJpeg()), mime: 'image/jpeg' }, state.context),
    error => error.code === AUTH_ERROR_CODES.STORAGE_UNAVAILABLE
  );
  const view = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  assert.equal(view.avatar.present, false);
  assert.equal(view.publicId?.length, 9);
});

test('d1: deterministic generated default avatar — stable per user, code-native (zero raster)', () => {
  const a = defaultAvatarSpec('user-alpha');
  const a2 = defaultAvatarSpec('user-alpha');
  const b = defaultAvatarSpec('user-beta');
  assert.equal(a.svg, a2.svg);
  assert.notEqual(a.svg, b.svg);
  assert.match(a.svg, /^<svg[\s\S]*<\/svg>$/);
  assert.ok(!/(?:src|href|xlink|<link|<img|url\()/.test(a.svg), 'default avatar must never reference external resources');
  assert.equal(a.initials, 'UA');
});

// ---------------------------------------------------------------------------
// 7 — Public profile + privacy boundary (blueprint §21-§23)
// ---------------------------------------------------------------------------

test('public: private (default) profiles never surface; limited is name-only; public adds allowlist fields', async () => {
  const state = makeState({ d1: makeFakeD1() });
  const email = 'pub@example.com';
  const subject = 'sub-pub-main-1';
  const session = await login(state, email, subject);
  await state.engine.saveProfile({
    sessionToken: session.sessionToken, email, subject,
    profile: {
      fullName: 'Nusrat Jahan', dob: '2008-08-08',
      school: { id: 'manual', name: 'Secret School', district: 'Sreemangal' },
      higherInstitution: null
    }
  }, state.context);
  const view = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  const publicId = view.publicId;
  // private → not found
  await assert.rejects(
    state.engine.getPublicProfile({ publicId }),
    error => error.code === AUTH_ERROR_CODES.PUBLIC_PROFILE_NOT_FOUND
  );
  // limited → name + ID only
  await state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { visibility: 'limited' } }, state.context);
  const limited = (await state.engine.getPublicProfile({ publicId })).profile;
  assert.equal(limited.displayName, 'Nusrat Jahan');
  assert.equal(limited.publicId, publicId);
  assert.equal(limited.visibility, 'limited');
  assert.equal(limited.bio, undefined);
  assert.equal(limited.target, undefined);
  // public → allowlist only
  await state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { visibility: 'public', bio: 'future engineer', target: { name: 'Coxs Bazar Medical College', unit: 'MBBS', year: '2026' } } }, state.context);
  const pub = (await state.engine.getPublicProfile({ publicId })).profile;
  assert.equal(pub.visibility, 'public');
  assert.equal(pub.bio, 'future engineer');
  assert.equal(pub.target.name, 'Coxs Bazar Medical College');
  assert.ok(Number.isInteger(pub.joinedYear));
  assert.ok(!/Secret School|Sreemangal/.test(JSON.stringify(pub)), 'school details must never be public');
});

test('public: projection never contains email, mobile, DOB or internal refs', async () => {
  const state = makeState();
  const email = 'leak@example.com';
  const subject = 'sub-leak-1';
  const session = await login(state, email, subject);
  await state.engine.saveProfile({
    sessionToken: session.sessionToken, email, subject,
    profile: {
      fullName: 'Leak Test', dob: '2006-06-06',
      school: { id: 'manual', name: 'Test School', district: 'Dhaka' },
      higherInstitution: null
    }
  }, state.context);
  await state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { mobile: '+8801912345678', visibility: 'public', bio: 'x' } }, state.context);
  const view = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  const pub = (await state.engine.getPublicProfile({ publicId: view.publicId })).profile;
  const serialized = JSON.stringify(pub);
  for (const forbidden of [email, 'leak@example.com', '+8801912345678', '2006-06-06', 'Test School', subject, 'firebase']) {
    assert.ok(!serialized.includes(forbidden), `public profile leaked: ${forbidden}`);
  }
  for (const key of ['email', 'mobile', 'dob', 'dateOfBirth', 'school', 'userId', 'subjectRef', 'session']) {
    assert.ok(!(key in pub), `public profile exposed key: ${key}`);
  }
});

test('public: invalid public ID format and unknown IDs are rejected', async () => {
  const state = makeState();
  await assert.rejects(state.engine.getPublicProfile({ publicId: 'AH-0O1ILX' }), error => error.code === AUTH_ERROR_CODES.INVALID_INPUT);
  await assert.rejects(state.engine.getPublicProfile({ publicId: 'hello' }), error => error.code === AUTH_ERROR_CODES.INVALID_INPUT);
  await assert.rejects(state.engine.getPublicProfile({ publicId: 'AH-ZZZZZZ' }), error => error.code === AUTH_ERROR_CODES.PUBLIC_PROFILE_NOT_FOUND);
});

test('public avatar: bytes follow visibility — private/unknown 404, limited/public expose the exact upload', async () => {
  const state = makeState({ d1: makeFakeD1() });
  const email = 'pub-avatar@example.com';
  const subject = 'sub-pub-avatar-1';
  const session = await login(state, email, subject);
  await state.engine.saveProfile({
    sessionToken: session.sessionToken, email, subject,
    profile: { fullName: 'Avatar Public', dob: '2007-07-07', school: { id: 'manual', name: 'Hidden School', district: 'Dhaka' }, higherInstitution: null }
  }, state.context);
  const view = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  const publicId = view.publicId;
  const bytes = tinyJpeg();
  await state.engine.saveAvatar({ ...profileInput(session, email, subject), data: toBase64(bytes), mime: 'image/jpeg' }, state.context);

  // private (default) → no avatar surface (same 404 boundary as the projection)
  await assert.rejects(state.engine.getPublicAvatar({ publicId }), error => error.code === AUTH_ERROR_CODES.PUBLIC_PROFILE_NOT_FOUND);

  // limited → name + avatar allowed
  await state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { visibility: 'limited' } }, state.context);
  const lim = await state.engine.getPublicAvatar({ publicId });
  assert.equal(lim.present, true);
  assert.equal(lim.mime, 'image/jpeg');
  assert.equal(lim.bytes, bytes.byteLength);
  assert.deepEqual(Uint8Array.from(Buffer.from(lim.data, 'base64')), bytes);

  // public → still the same bytes
  await state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { visibility: 'public' } }, state.context);
  const pub = await state.engine.getPublicAvatar({ publicId });
  assert.equal(pub.present, true);
  assert.equal(pub.bytes, bytes.byteLength);

  // invalid / unknown IDs never leak
  await assert.rejects(state.engine.getPublicAvatar({ publicId: 'bad' }), error => error.code === AUTH_ERROR_CODES.INVALID_INPUT);
  await assert.rejects(state.engine.getPublicAvatar({ publicId: 'AH-ZZZZZZ' }), error => error.code === AUTH_ERROR_CODES.PUBLIC_PROFILE_NOT_FOUND);
});

test('public: suspended accounts disappear from the public projection', async () => {
  const state = makeState();
  const email = 'sus@example.com';
  const subject = 'sub-sus-1';
  const session = await login(state, email, subject);
  const view = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  await state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { visibility: 'public', bio: 'x' } }, state.context);
  const userId = state.database.prepare('SELECT user_id FROM auth_users').get().user_id;
  await state.repository.setAccountState({ userId, toStatus: 'suspended', now: state.now() });
  await assert.rejects(
    state.engine.getPublicProfile({ publicId: view.publicId }),
    error => error.code === AUTH_ERROR_CODES.PUBLIC_PROFILE_NOT_FOUND
  );
});

test('public: avatar presence is reflected on the public projection', async () => {
  const state = makeState({ d1: makeFakeD1() });
  const email = 'pubavatar@example.com';
  const subject = 'sub-pubavatar-1';
  const session = await login(state, email, subject);
  await state.engine.saveProfile({
    sessionToken: session.sessionToken, email, subject,
    profile: {
      fullName: 'With Avatar', dob: '2008-01-01',
      school: { id: 'manual', name: 'School', district: 'Dhaka' },
      higherInstitution: null
    }
  }, state.context);
  await state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { visibility: 'public', bio: 'x' } }, state.context);
  const view = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  const before = (await state.engine.getPublicProfile({ publicId: view.publicId })).profile;
  assert.equal(before.avatarPresent, false);
  await state.engine.saveAvatar({ ...profileInput(session, email, subject), data: toBase64(tinyJpeg()), mime: 'image/jpeg' }, state.context);
  const after = (await state.engine.getPublicProfile({ publicId: view.publicId })).profile;
  assert.equal(after.avatarPresent, true);
});

// ---------------------------------------------------------------------------
// 8 — Dynamic context engine (high-dynamic blueprint §01/§04/§13/§14)
// ---------------------------------------------------------------------------

test('context: NEW_USER for a fresh complete profile, GOAL_SET once a target exists', async () => {
  const state = makeState();
  const email = 'ctx@example.com';
  const subject = 'sub-ctx-1';
  const session = await login(state, email, subject);
  await state.engine.saveProfile({
    sessionToken: session.sessionToken, email, subject,
    profile: {
      fullName: 'Context User', dob: '2008-02-02',
      school: { id: 'manual', name: 'School', district: 'Dhaka' },
      higherInstitution: { id: 'manual', name: 'College', district: 'Dhaka' }
    }
  }, state.context);
  await state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { mobile: '+8801612345678' } }, state.context);
  // V2 weights: 35 + mobile 10 + goal 15 = 60 (crosses the >=60 context bar)
  await state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { academicGoal: 'Join DU Econ' } }, state.context);
  let view = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  assert.equal(view.context.context, 'NEW_USER');
  assert.equal(view.context.freshness, 'LIVE');
  assert.ok(view.context.sectionOrder.length >= 3);
  assert.equal(typeof view.context.greeting, 'string');
  await state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { target: { name: 'DU', unit: 'Econ', year: '2026' } } }, state.context);
  state.advance(8 * 86_400_000); // past the 7-day new-user window
  view = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  assert.equal(view.context.context, 'GOAL_SET');
  assert.ok(view.context.sectionOrder.includes('goal'));
});

test('context: RETURNING after a 15-day gap; PROFILE_INCOMPLETE wins over everything', async () => {
  const state = makeState();
  const DAY = 86_400_000;
  const email = 'ret@example.com';
  const subject = 'sub-ret-1';
  const session = await login(state, email, subject);
  await state.engine.saveProfile({
    sessionToken: session.sessionToken, email, subject,
    profile: {
      fullName: 'Returning User', dob: '2007-07-07',
      school: { id: 'manual', name: 'School', district: 'Dhaka' },
      higherInstitution: null
    }
  }, state.context);
  await state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { mobile: '+8801512345678' } }, state.context);
  // V2 weights: keep completion >=60 after the target is cleared below
  // (30 base + mobile 10 + subjects 10 + goal 15 = 65)
  await state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { subjects: ['Physics'], academicGoal: 'Join KU' } }, state.context);
  state.advance(8 * DAY); // past the 7-day new-user window
  await state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { target: { name: 'KU', unit: 'B Unit', year: '2026' } } }, state.context);
  let view = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  assert.equal(view.context.context, 'GOAL_SET');
  state.advance(15 * DAY); // gap since last login > 14 days
  await state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { target: null } }, state.context);
  view = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  assert.equal(view.context.context, 'RETURNING');
  // incomplete profile always takes priority (low completion)
  const fresh = await login(state, 'incomplete@example.com', 'sub-incomplete-1');
  const freshView = await state.engine.getProfileV2(profileInput(fresh, 'incomplete@example.com', 'sub-incomplete-1'), state.context);
  assert.equal(freshView.context.context, 'PROFILE_INCOMPLETE');
});

// ---------------------------------------------------------------------------
// 9 — Ownership + legacy compatibility (blueprint §25)
// ---------------------------------------------------------------------------

test('ownership: user B can never read or patch user A data through their own session', async () => {
  const state = makeState();
  const a = await login(state, 'owner-a@example.com', 'sub-owner-a');
  const b = await login(state, 'owner-b@example.com', 'sub-owner-b');
  await state.engine.saveProfile({
    sessionToken: a.sessionToken, email: 'owner-a@example.com', subject: 'sub-owner-a',
    profile: {
      fullName: 'Owner A', dob: '2008-03-03',
      school: { id: 'manual', name: 'A School', district: 'A' },
      higherInstitution: null
    }
  }, state.context);
  await state.engine.saveProfilePatch({ ...profileInput(a, 'owner-a@example.com', 'sub-owner-a'), fields: { bio: 'only A can see this' } }, state.context);
  const bView = await state.engine.getProfileV2(profileInput(b, 'owner-b@example.com', 'sub-owner-b'), state.context);
  assert.equal(bView.profile.fullName, '');
  assert.equal(bView.profile.bio, '');
  assert.notEqual(bView.publicId, (await state.engine.getProfileV2(profileInput(a, 'owner-a@example.com', 'sub-owner-a'), state.context)).publicId);
  // B's patch touches only B
  const bPatched = await state.engine.saveProfilePatch({ ...profileInput(b, 'owner-b@example.com', 'sub-owner-b'), fields: { bio: 'B\'s own note' } }, state.context);
  assert.equal(bPatched.profile.bio, 'B\'s own note');
  const aAfter = await state.engine.getProfileV2(profileInput(a, 'owner-a@example.com', 'sub-owner-a'), state.context);
  assert.equal(aAfter.profile.bio, 'only A can see this');
});

test('ownership: an expired/revoked session cannot touch the profile (auth gate intact)', async () => {
  const state = makeState();
  const email = 'gate@example.com';
  const subject = 'sub-gate-1';
  const session = await login(state, email, subject);
  await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  await state.engine.revokeSession(session.sessionToken);
  await assert.rejects(
    state.engine.getProfileV2(profileInput(session, email, subject), state.context),
    error => error.code === AUTH_ERROR_CODES.SESSION_INVALID
  );
  await assert.rejects(
    state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { bio: 'nope' } }, state.context),
    error => error.code === AUTH_ERROR_CODES.SESSION_INVALID
  );
});

test('legacy: the original full-save /profile flow still works unchanged (regression)', async () => {
  const state = makeState();
  const email = 'legacy-flow@example.com';
  const subject = 'sub-legacy-flow-1';
  const session = await login(state, email, subject);
  const saved = await state.engine.saveProfile({
    sessionToken: session.sessionToken, email, subject,
    profile: {
      fullName: 'Legacy Flow', dob: '2005-05-05',
      school: { id: 'manual', name: 'Old School', district: 'Old' },
      higherInstitution: null
    }
  }, state.context);
  assert.equal(saved.saved, true);
  assert.equal(saved.profile.fullName, 'Legacy Flow');
  const got = await state.engine.getProfile(profileInput(session, email, subject), state.context);
  assert.equal(got.profile.fullName, 'Legacy Flow');
  assert.equal(got.profile.school.name, 'Old School');
});

// ---------------------------------------------------------------------------
// 10 — Memory/SQLite parity for the core flows
// ---------------------------------------------------------------------------

test('memory repo: provision + patch + public ID + public projection behave like SQLite', async () => {
  const state = makeMemoryState({ d1: makeFakeD1() });
  const email = 'mem@example.com';
  const subject = 'sub-mem-1';
  const session = await login(state, email, subject);
  const view = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  assert.match(view.publicId, /^AH-[A-Z2-9]{6}$/);
  assert.equal(view.completion, 0);
  const patched = await state.engine.saveProfilePatch({
    ...profileInput(session, email, subject),
    fields: { fullName: 'Memory User', bio: 'works too', visibility: 'public' },
    expectVersion: view.profile.version
  }, state.context);
  assert.equal(patched.saved, true);
  assert.equal(patched.profile.fullName, 'Memory User');
  await assert.rejects(
    state.engine.saveProfilePatch({ ...profileInput(session, email, subject), fields: { bio: 'stale' }, expectVersion: 1 }, state.context),
    error => error.code === AUTH_ERROR_CODES.PROFILE_VERSION_CONFLICT
  );
  const pub = (await state.engine.getPublicProfile({ publicId: view.publicId })).profile;
  assert.equal(pub.displayName, 'Memory User');
  assert.equal(pub.bio, 'works too');
});

test('memory repo: avatar save/delete + completion credit mirror SQLite', async () => {
  const state = makeMemoryState({ d1: makeFakeD1() });
  const email = 'memavatar@example.com';
  const subject = 'sub-memavatar-1';
  const session = await login(state, email, subject);
  const v1 = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  await state.engine.saveAvatar({ ...profileInput(session, email, subject), data: toBase64(tinyJpeg()), mime: 'image/jpeg' }, state.context);
  const v2 = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  assert.equal(v2.completion, v1.completion + 10);
  await state.engine.deleteAvatar(profileInput(session, email, subject), state.context);
  const v3 = await state.engine.getProfileV2(profileInput(session, email, subject), state.context);
  assert.equal(v3.completion, v1.completion);
});
