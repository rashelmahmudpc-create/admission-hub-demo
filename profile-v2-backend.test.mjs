import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const PAGE = readFileSync(new URL('./profile-v2.html', import.meta.url), 'utf8');
const BUILDER = readFileSync(new URL('./scripts/build-profile-v2.mjs', import.meta.url), 'utf8');

/* The owner's original file must stay untouched: the build reads it and never
   writes it. Guard that the demo identity lives only in the source backup. */
test('the demo identity is stripped from the built page', () => {
  assert.doesNotMatch(PAGE, /Zayan Rashel/);
  assert.doesNotMatch(PAGE, /AH-MUDWXS/);
  assert.doesNotMatch(PAGE, /rashelzayan3@gmail\.com/);
  assert.doesNotMatch(PAGE, /solved:266/);
  assert.match(PAGE, /var SAMPLE=window\.PROFILE_STATS/);
});

test('the built page boots and renders honest empty state with no session', async () => {
  const dom = new JSDOM(PAGE, {
    url: 'https://admissionhub.pages.dev/profile-v2.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.fetch = () => Promise.reject(new Error('offline'));
    },
  });
  const win = dom.window;
  await new Promise((r) => setTimeout(r, 60));

  // No session, no cache: nothing fake may appear.
  assert.equal(win.document.querySelector('#nm').textContent, '—');
  assert.equal(win.document.querySelector('#ahid').textContent, '');
  assert.ok(win.ProfileV2, 'adapter exposes its API');
  // Compare fields: the object comes from the jsdom realm, so a structural
  // deep-equal would trip on prototype identity rather than on a real value.
  const stats = win.ProfileV2.stats();
  assert.equal(stats.solved, 0);
  assert.equal(stats.mockDone, false);
  dom.window.close();
});

/* The heart of the owner's request: real, per-student data. Two different
   students must render their own values, never a shared or sample one. */
test('each student renders their own real profile, never another student', async () => {
  const students = [
    {
      publicId: 'AH-AAA222',
      email: 'rahim@example.com',
      profile: {
        fullName: 'রহিম উদ্দিন', mobile: '01711111111', dob: '2007-03-04',
        bio: 'ঢাবি-তে CSE পড়তে চাই', school: { name: 'নটর ডেম কলেজ' },
        higherInstitution: null, targets: [{ name: 'DU', unit: 'A' }], subjects: ['পদার্থ'],
        admissionSession: '২০২৫-২৬', academicGoal: 'DU A Unit', visibility: 'public', version: 3,
      },
      avatar: { present: false },
    },
    {
      publicId: 'AH-BBB333',
      email: 'karim@example.com',
      profile: {
        fullName: 'করিম মিয়া', mobile: '01822222222', dob: '2006-11-19',
        bio: '', school: { name: 'ঢাকা কলেজ' },
        higherInstitution: { name: 'বুয়েট' }, targets: [], subjects: [],
        admissionSession: '২০২৪-২৫', academicGoal: '', visibility: 'private', version: 9,
      },
      avatar: { present: false },
    },
  ];

  for (const student of students) {
    const dom = new JSDOM(PAGE, {
      url: 'https://admissionhub.pages.dev/profile-v2.html',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(win) {
        win.fetch = (path) => {
          if (String(path).includes('/profile/patch')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, saved: true, profile: student.profile }) });
          }
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, ...student }) });
        };
      },
    });
    const win = dom.window;
    await new Promise((r) => setTimeout(r, 80));

    const doc = win.document;
    assert.equal(doc.querySelector('#nm').textContent, student.profile.fullName,
      `${student.publicId} shows its own name`);
    assert.equal(doc.querySelector('#ahid').textContent, student.publicId,
      `${student.publicId} shows its own AH-ID`);

    // The other student's identity must not leak in.
    const other = students.find((s) => s.publicId !== student.publicId);
    assert.doesNotMatch(doc.body.textContent, new RegExp(other.profile.fullName));
    assert.doesNotMatch(doc.body.textContent, new RegExp(other.publicId));
    assert.doesNotMatch(doc.body.textContent, new RegExp(other.email));

    dom.window.close();
  }
});

test('a saved edit is sent to the backend under the backend field names', async () => {
  const sent = [];
  const student = {
    publicId: 'AH-CCC444',
    email: 's@example.com',
    profile: {
      fullName: 'শিক্ষার্থী', mobile: '', dob: '', bio: '', school: null,
      higherInstitution: null, targets: [], subjects: [], admissionSession: '',
      academicGoal: '', visibility: 'private', version: 1,
    },
    avatar: { present: false },
  };
  const dom = new JSDOM(PAGE, {
    url: 'https://admissionhub.pages.dev/profile-v2.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.fetch = (path, opts) => {
        if (String(path).includes('/profile/patch')) {
          sent.push(JSON.parse(opts.body));
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, saved: true, profile: { ...student.profile, version: 2 } }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, ...student }) });
      };
    },
  });
  const win = dom.window;
  await new Promise((r) => setTimeout(r, 80));

  // Exactly what the owner's UI emits on an edit.
  win.document.dispatchEvent(new win.CustomEvent('app:action', {
    detail: { action: 'profile.update', field: 'name', value: 'নতুন নাম' },
  }));
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(sent.length, 1, 'one patch sent');
  assert.deepEqual(sent[0].fields, { fullName: 'নতুন নাম' });
  assert.equal(sent[0].expectVersion, 1, 'optimistic version carried');
  dom.window.close();
});

test('visibility toggle maps to the backend visibility field', async () => {
  const sent = [];
  const student = {
    publicId: 'AH-DDD555', email: 'd@example.com',
    profile: { fullName: 'ঘ', mobile: '', dob: '', bio: '', school: null, higherInstitution: null, targets: [], subjects: [], admissionSession: '', academicGoal: '', visibility: 'private', version: 4 },
    avatar: { present: false },
  };
  const dom = new JSDOM(PAGE, {
    url: 'https://admissionhub.pages.dev/profile-v2.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.fetch = (path, opts) => {
        if (String(path).includes('/profile/patch')) {
          sent.push(JSON.parse(opts.body));
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, saved: true, profile: student.profile }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, ...student }) });
      };
    },
  });
  await new Promise((r) => setTimeout(r, 80));
  dom.window.document.dispatchEvent(new dom.window.CustomEvent('app:action', {
    detail: { action: 'profile.public', value: true },
  }));
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].fields, { visibility: 'public' });
  dom.window.close();
});

test('the build is reproducible and the source stays read-only', () => {
  // The builder must read the owner's file and never write to it.
  assert.match(BUILDER, /readFileSync\(SRC/);
  assert.doesNotMatch(BUILDER, /writeFileSync\(SRC/);
  assert.match(BUILDER, /writeFileSync\(join\(root, 'profile-v2\.html'\)/);
});
