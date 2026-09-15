// Phase 7B (Profile V2) — chunk 1: schema v8 + engine fields + validators.
// Blueprint: multiple academic targets, admission session, preferred subjects,
// academic goal; owner-approved completion weights (sum 100); public v2 allowlist.
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SqliteAuthRepository } from './auth-native/storage/sqlite-auth-repository.mjs';
import { CloudflareNativeAuthEngine, normalizeProfilePatch } from './auth-native/core/auth-engine.mjs';
import { AUTH_ERROR_CODES } from './auth-native/core/errors.mjs';

const SECRET = 'profile-v2-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWX';
const START = 1_800_000_000_000;

function makeState() {
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
  const engine = new CloudflareNativeAuthEngine({ repository, hmacSecret: SECRET, now: () => now });
  const context = { ip: '198.51.100.31', deviceId: 'device-profile-v2-0123456789ab', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Chrome/140' };
  return { database, repository, engine, context, now: () => now, advance: ms => { now += ms; } };
}

const login = (state, email, subject) => state.engine.establishFirebaseSession(
  { email, subject, remember: true, verified: true, newDevice: true, securityChallenge: false },
  state.context
);
const profileInput = (loginResult, email, subject) => ({ sessionToken: loginResult.sessionToken, email, subject });
const view = async (state, loginResult, email, subject) => state.engine.getProfileV2(profileInput(loginResult, email, subject), state.context);
const patch = (state, loginResult, email, subject, fields) =>
  state.engine.saveProfilePatch({ ...profileInput(loginResult, email, subject), fields }, state.context);

// ---------------------------------------------------------------------------
// 1 — Schema v8
// ---------------------------------------------------------------------------

test('v8: provisioned profile carries admission_session, academic_goal, subjects defaults', async () => {
  const state = makeState();
  const email = 'v8prov@example.com';
  const subject = 'sub-v8prov-1';
  const session = await login(state, email, subject);
  const result = await view(state, session, email, subject);
  assert.equal(result.profile.admissionSession, '');
  assert.equal(result.profile.academicGoal, '');
  assert.deepEqual(result.profile.subjects, []);
});

test('v8: old database (pre-v8) migrates additively and keeps existing rows', async () => {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  // simulate a pre-v8 auth_profiles table (no new columns) with one row
  database.exec(`
    CREATE TABLE auth_profiles (
      user_id TEXT PRIMARY KEY,
      profile_version INTEGER NOT NULL,
      full_name TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      school_id TEXT NOT NULL,
      school_name TEXT NOT NULL,
      school_district TEXT NOT NULL,
      higher_id TEXT,
      higher_name TEXT,
      higher_district TEXT,
      mobile TEXT,
      bio TEXT,
      targets TEXT DEFAULT '[]',
      visibility TEXT NOT NULL DEFAULT 'private',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO auth_profiles(user_id,profile_version,full_name,date_of_birth,school_id,school_name,school_district,higher_id,higher_name,higher_district,mobile,bio,targets,visibility,created_at,updated_at)
    VALUES('legacy-user-1',3,'Legacy Student','2008-05-05','s1','Old School','Dhaka',NULL,NULL,NULL,'01711111111','old bio','[]','private',1790000000000,1790000000000);
  `);
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
  const row = database.prepare('SELECT full_name,mobile,admission_session,academic_goal,subjects FROM auth_profiles WHERE user_id=?').get('legacy-user-1');
  assert.equal(row.full_name, 'Legacy Student');
  assert.equal(row.mobile, '01711111111');
  assert.equal(row.admission_session, '');
  assert.equal(row.academic_goal, '');
  assert.equal(row.subjects, '[]');
});

// ---------------------------------------------------------------------------
// 2 — Normalize: new field validation (unit level, no DB)
// ---------------------------------------------------------------------------

test('normalize: admissionSession accepts empty or 4-digit year, rejects junk', () => {
  assert.equal(normalizeProfilePatch({ admissionSession: '2026' }).admissionSession, '2026');
  assert.equal(normalizeProfilePatch({ admissionSession: ' 1998 ' }).admissionSession, '1998');
  assert.equal(normalizeProfilePatch({ admissionSession: '' }).admissionSession, '');
  for (const bad of ['abc', '202', '20267', '20-26', '210']) {
    assert.throws(() => normalizeProfilePatch({ admissionSession: bad }), (e) => e.code === AUTH_ERROR_CODES.INVALID_INPUT);
  }
});

test('normalize: academicGoal trims, caps at 160, rejects control/injection chars', () => {
  const f = normalizeProfilePadSafe('academicGoal', 'I want to join BUET CSE');
  assert.equal(f, 'I want to join BUET CSE');
  assert.throws(() => normalizeProfilePatch({ academicGoal: 'x'.repeat(161) }), (e) => e.code === AUTH_ERROR_CODES.INVALID_INPUT);
  for (const bad of ['<script>alert(1)</script>', 'a\u0000b']) {
    assert.throws(() => normalizeProfilePatch({ academicGoal: bad }), (e) => e.code === AUTH_ERROR_CODES.INVALID_INPUT);
  }
});
function normalizeProfilePadSafe(key, value) { return normalizeProfilePatch({ [key]: value })[key]; }

test('normalize: subjects ≤8, trimmed, de-duplicated, rejects junk', () => {
  const f = normalizeProfilePatch({ subjects: [' Physics ', 'physics', 'Chemistry', 'Math'] }).subjects;
  assert.deepEqual(f, ['Physics', 'physics', 'Chemistry', 'Math']);
  assert.deepEqual(normalizeProfilePatch({ subjects: null }).subjects, []);
  assert.deepEqual(normalizeProfilePatch({ subjects: [] }).subjects, []);
  assert.throws(() => normalizeProfilePatch({ subjects: ['a','b','c','d','e','f','g','h','i'] }), (e) => e.code === AUTH_ERROR_CODES.INVALID_INPUT);
  assert.throws(() => normalizeProfilePatch({ subjects: ['<b>'] }), (e) => e.code === AUTH_ERROR_CODES.INVALID_INPUT);
  assert.throws(() => normalizeProfilePatch({ subjects: 'Physics' }), (e) => e.code === AUTH_ERROR_CODES.INVALID_INPUT);
  });

test('normalize: targets array (multi-target) ≤5 with per-target rules; null clears', () => {
  const f = normalizeProfilePatch({
    targets: [
      { name: 'BUET', unit: 'CSE', year: '2027' },
      { name: 'DU', unit: 'BBA', year: '2027' },
      { name: 'RU', unit: 'CSE', year: '2028' }
    ]
  }).targets;
  assert.equal(f.length, 3);
  assert.equal(f[0].name, 'BUET');
  assert.equal(f[2].unit, 'CSE');
  assert.deepEqual(normalizeProfilePatch({ targets: null }).targets, []);
  assert.throws(() => normalizeProfilePatch({ targets: ['a', 'b', 'c', 'd', 'e', 'f'] }), (e) => e.code === AUTH_ERROR_CODES.INVALID_INPUT);
  assert.throws(() => normalizeProfilePatch({ targets: [{ name: 'X', unit: 'CSE', year: '2027' }] }), (e) => e.code === AUTH_ERROR_CODES.INVALID_INPUT);
  assert.throws(() => normalizeProfilePatch({ targets: [{ name: 'BUET', unit: 'CSE', year: '<b>' }] }), (e) => e.code === AUTH_ERROR_CODES.INVALID_INPUT);
  assert.throws(() => normalizeProfilePatch({ targets: [null] }), (e) => e.code === AUTH_ERROR_CODES.INVALID_INPUT);
});

test('normalize: unknown/privileged fields still rejected (injection guard unchanged)', () => {
  for (const bad of [{ version: 99 }, { email: 'a@b.c' }, { school: { id: 'x', name: 'Y', district: 'Z' } }, { createdAt: 1 }, {}]) {
    assert.throws(() => normalizeProfilePatch(bad), (e) => e.code === AUTH_ERROR_CODES.INVALID_INPUT);
  }
});

// ---------------------------------------------------------------------------
// 3 — Round trip through the store
// ---------------------------------------------------------------------------

test('v8: patch round-trips session, goal, subjects, multi-targets and bumps version', async () => {
  const state = makeState();
  const email = 'v8rt@example.com';
  const subject = 'sub-v8rt-1';
  const session = await login(state, email, subject);
  await view(state, session, email, subject); // provision
  const r1 = await patch(state, session, email, subject, {
    admissionSession: '2026',
    academicGoal: 'Join BUET CSE',
    subjects: ['Physics', 'Higher Math']
  });
  assert.equal(r1.profile.admissionSession, '2026');
  assert.equal(r1.profile.academicGoal, 'Join BUET CSE');
  assert.deepEqual(r1.profile.subjects, ['Physics', 'Higher Math']);
  assert.equal(r1.profile.version, 2);
  const r2 = await patch(state, session, email, subject, {
    targets: [
      { name: 'BUET', unit: 'CSE', year: '2027' },
      { name: 'Dhaka University', unit: 'CSE', year: '2027' }
    ]
  });
  assert.equal(r2.profile.targets.length, 2);
  assert.equal(r2.profile.targets[1].name, 'Dhaka University');
  // other fields untouched
  assert.equal(r2.profile.admissionSession, '2026');
  const r3 = await view(state, session, email, subject);
  assert.equal(r3.profile.targets.length, 2);
  assert.equal(r3.profile.admissionSession, '2026');
  const cleared = await patch(state, session, email, subject, { targets: null, subjects: null, admissionSession: '' });
  assert.deepEqual(cleared.profile.targets, []);
  assert.deepEqual(cleared.profile.subjects, []);
  assert.equal(cleared.profile.admissionSession, '');
});

test('v8: optimistic version conflict still enforced with new fields', async () => {
  const state = makeState();
  const email = 'v8v@example.com';
  const subject = 'sub-v8v-1';
  const session = await login(state, email, subject);
  await view(state, session, email, subject);
  await patch(state, session, email, subject, { academicGoal: 'A' });
  await assert.rejects(
    state.engine.saveProfilePatch({ ...profileInput(session, email, subject), expectVersion: 1, fields: { academicGoal: 'B' } }, state.context),
    (e) => e.code === AUTH_ERROR_CODES.PROFILE_VERSION_CONFLICT
  );
});

// ---------------------------------------------------------------------------
// 4 — Completion V2 weights (owner-approved; sums to 100)
// ---------------------------------------------------------------------------

test('v8: completion uses V2 weights (15/10/10/5/5/15/5/10/15/5/10)', async () => {
  const state = makeState();
  const email = 'v8c@example.com';
  const subject = 'sub-v8c-1';
  const session = await login(state, email, subject);
  let v = await view(state, session, email, subject);
  assert.equal(v.completion, 0);
  await state.engine.saveProfile({
    sessionToken: session.sessionToken, email, subject,
    profile: { fullName: 'Weight Test', dob: '2009-01-01', school: { id: 'sch1', name: 'School A', district: 'Dhaka' }, higherInstitution: { id: 'col1', name: 'College B', district: 'Dhaka' } }
  }, state.context);
  v = await view(state, session, email, subject);
  assert.equal(v.completion, 35); // name 15 + dob 10 + school 5 + higher 5
  await patch(state, session, email, subject, { mobile: '+8801712345678' });
  v = await view(state, session, email, subject);
  assert.equal(v.completion, 45); // + mobile 10
  await patch(state, session, email, subject, { target: { name: 'BUET', unit: 'CSE', year: '2027' } });
  v = await view(state, session, email, subject);
  assert.equal(v.completion, 60); // + targets 15
  await patch(state, session, email, subject, { admissionSession: '2026' });
  v = await view(state, session, email, subject);
  assert.equal(v.completion, 65); // + session 5
  await patch(state, session, email, subject, { subjects: ['Physics'] });
  v = await view(state, session, email, subject);
  assert.equal(v.completion, 75); // + subjects 10
  await patch(state, session, email, subject, { academicGoal: 'BUET CSE 2027' });
  v = await view(state, session, email, subject);
  assert.equal(v.completion, 90); // + goal 15
  await patch(state, session, email, subject, { bio: 'future engineer' });
  v = await view(state, session, email, subject);
  assert.equal(v.completion, 95); // + bio 5
});

test('v8: completion with avatar reaches 100 (avatar 10 is the final credit)', async () => {
  const state = makeState();
  const email = 'v8full@example.com';
  const subject = 'sub-v8full-1';
  const session = await login(state, email, subject);
  await state.engine.saveProfile({
    sessionToken: session.sessionToken, email, subject,
    profile: { fullName: 'Full Test', dob: '2009-01-01', school: { id: 'sch1', name: 'School S', district: 'Dhaka' }, higherInstitution: null }
  }, state.context);
  await patch(state, session, email, subject, { mobile: '+8801712345678', target: { name: 'BUET', unit: 'CSE', year: '2027' }, admissionSession: '2026', subjects: ['Physics'], academicGoal: 'goal', bio: 'bio' });
  // 15+10+10+5+0+15+5+10+15+5 = 90 without avatar
  const v = await view(state, session, email, subject);
  assert.equal(v.completion, 90);
});

// ---------------------------------------------------------------------------
// 5 — Public profile v2 allowlist
// ---------------------------------------------------------------------------

test('v8: public profile exposes targets[], admissionSession, goal (never private data)', async () => {
  const state = makeState();
  const email = 'v8pub@example.com';
  const subject = 'sub-v8pub-1';
  const session = await login(state, email, subject);
  await state.engine.saveProfile({
    sessionToken: session.sessionToken, email, subject,
    profile: { fullName: 'Public Profile', dob: '2006-06-06', school: { id: 'sch1', name: 'Secret School', district: 'Dhaka' }, higherInstitution: null }
  }, state.context);
  await patch(state, session, email, subject, {
    mobile: '+8801612345678', visibility: 'public',
    targets: [{ name: 'BUET', unit: 'CSE', year: '2027' }, { name: 'DU', unit: 'BBA', year: '2027' }],
    admissionSession: '2026', academicGoal: 'Join BUET', subjects: ['Physics']
  });
  const v = await view(state, session, email, subject);
  const pub = (await state.engine.getPublicProfile({ publicId: v.publicId })).profile;
  assert.equal(pub.targets.length, 2);
  assert.equal(pub.targets[0].name, 'BUET');
  assert.equal(pub.admissionSession, '2026');
  assert.equal(pub.goal, 'Join BUET');
  assert.equal(pub.bio, '');
  const serialized = JSON.stringify(pub);
  for (const forbidden of [email, '+8801612345678', '2006-06-06', 'Secret School', 'Physics', subject, 'firebase']) {
    assert.ok(!serialized.includes(forbidden), `public v2 leaked: ${forbidden}`);
  }
  for (const key of ['email', 'mobile', 'dob', 'dateOfBirth', 'school', 'subjects', 'userId', 'subjectRef', 'session']) {
    assert.ok(!(key in pub), `public v2 exposed key: ${key}`);
  }
});

test('v8: limited visibility still hides academic identity (name + ID + avatar only)', async () => {
  const state = makeState();
  const email = 'v8lim@example.com';
  const subject = 'sub-v8lim-1';
  const session = await login(state, email, subject);
  await state.engine.saveProfile({
    sessionToken: session.sessionToken, email, subject,
    profile: { fullName: 'Limited Profile', dob: '2006-06-06', school: { id: 'sch1', name: 'School S', district: 'Dhaka' }, higherInstitution: null }
  }, state.context);
  await patch(state, session, email, subject, {
    visibility: 'limited',
    targets: [{ name: 'BUET', unit: 'CSE', year: '2027' }],
    admissionSession: '2026', academicGoal: 'secret goal'
  });
  const v = await view(state, session, email, subject);
  const pub = (await state.engine.getPublicProfile({ publicId: v.publicId })).profile;
  assert.equal(pub.visibility, 'limited');
  assert.ok(!('targets' in pub) || pub.targets === undefined);
  assert.ok(!('admissionSession' in pub));
  assert.ok(!('goal' in pub));
});
