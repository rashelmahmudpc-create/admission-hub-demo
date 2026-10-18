import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { normalizeProfilePatch } from './auth-native/core/auth-engine.mjs';

const PAGE = readFileSync(new URL('./profile-v2.html', import.meta.url), 'utf8');

const PROFILE = {
  fullName: 'রাশেল জায়ান', mobile: '01712345678', dob: '2005-06-15', bio: 'ক',
  school: null, higherInstitution: null, targets: [], subjects: [],
  admissionSession: '2026', academicGoal: '', visibility: 'private', version: 1,
};
const student = { publicId: 'AH-AUDIT', email: 'audit@example.com', profile: PROFILE, avatar: { present: false }, ts: Date.now() };

/* Boot the real built page, capture every patch body the adapter emits, and run
   it through the real server-side validator. This is the only way to prove a
   field "saves" — the page can toast success without the request being accepted. */
function harness(overrides) {
  const calls = [];
  const dom = new JSDOM(PAGE, {
    url: 'https://admissionhub.pages.dev/profile-v2.html',
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.fetch = (path, opts) => {
        const method = (opts && opts.method) || 'GET';
        calls.push({ path: String(path), method, body: opts && opts.body });
        if (String(path).includes('/profile/patch')) {
          let fields = {};
          let refused = null;
          try {
            fields = normalizeProfilePatch(JSON.parse(opts.body).fields);
          } catch (e) {
            refused = e;
          }
          if (refused) {
            return Promise.resolve({
              ok: false, status: 400,
              json: () => Promise.resolve({ ok: false, error: { code: 'INVALID_INPUT', message: 'তথ্য সঠিক নয়' } }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ok: true, saved: true, profile: Object.assign({}, PROFILE, fields, { version: 2 }) }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, ...student, ...overrides }) });
      };
    },
  });
  return { dom, win: dom.window, calls };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function patchBody(calls) {
  const p = calls.filter((c) => c.path.includes('/profile/patch')).pop();
  return p ? JSON.parse(p.body) : null;
}

/* Every field the owner can edit, with a realistic value a student would enter. */
const EDITS = [
  ['name', 'রাশেল জায়ান'],
  ['mobile', '01712345678'],
  ['bio', 'ভালো ছেলে'],
  ['dob', '2005-06-15'],
  ['goal', 'ঢাকা বিশ্ববিদ্যালয়ে ভর্তি হওয়া'],
  ['session', '2026'],
  ['school', 'নটর ডেম কলেজ'],
  ['college', 'নটর ডেম কলেজ'],
  ['targets', ['ঢাকা বিশ্ববিদ্যালয়', 'BUET']],
  ['subjects', ['পদার্থবিজ্ঞান', 'রসায়ন']],
];

for (const [field, value] of EDITS) {
  test(`saves: ${field}`, async () => {
    const { win, calls, dom } = harness();
    await wait(90);
    calls.length = 0;
    win.document.dispatchEvent(new win.CustomEvent('app:action', {
      detail: { action: 'profile.update', field, value },
    }));
    await wait(60);
    const body = patchBody(calls);
    assert.ok(body, `${field} sent a patch`);
    /* The real validator is the judge: if it throws, the save would have failed. */
    const accepted = normalizeProfilePatch(body.fields);
    assert.ok(accepted, `${field} was accepted by the backend validator`);
    assert.equal(Object.keys(accepted).length, 1, `${field} sends exactly its own field`);
    dom.window.close();
  });
}

/* Edge cases a real student hits, not happy-path values. */
const EDGES = [
  ['session', 'এখনো ঠিক করিনি', 'the "not decided" label must not fail the patch'],
  ['targets', ['ঢাকা বিশ্ববিদ্যালয়'], 'a single target'],
  ['targets', [], 'clearing every target'],
  ['subjects', [], 'clearing every subject'],
  ['bio', '', 'clearing the bio'],
  ['goal', '', 'clearing the goal'],
  ['school', '', 'clearing the school'],
];

for (const [field, value, why] of EDGES) {
  test(`edge: ${field} — ${why}`, async () => {
    const { win, calls, dom } = harness();
    await wait(90);
    calls.length = 0;
    win.document.dispatchEvent(new win.CustomEvent('app:action', {
      detail: { action: 'profile.update', field, value },
    }));
    await wait(60);
    const body = patchBody(calls);
    assert.ok(body, `${field} sent a patch`);
    normalizeProfilePatch(body.fields);
    dom.window.close();
  });
}

/* The backend caps a target name at 120 chars and requires >= 2. A longer or
   1-char name must be trimmed or dropped, never sent to fail the whole patch. */
test('edge: targets with a 1-char name and a 400-char name still save', async () => {
  const { win, calls, dom } = harness();
  await wait(90);
  calls.length = 0;
  win.document.dispatchEvent(new win.CustomEvent('app:action', {
    detail: { action: 'profile.update', field: 'targets', value: ['ঢাকা', 'ক', 'ঢ'.repeat(400)] },
  }));
  await wait(60);
  const accepted = normalizeProfilePatch(patchBody(calls).fields);
  assert.ok(accepted.targets.every((t) => t.name.length >= 2 && t.name.length <= 120));
  dom.window.close();
});

test('edge: more than 5 targets is capped, not rejected', async () => {
  const { win, calls, dom } = harness();
  await wait(90);
  calls.length = 0;
  win.document.dispatchEvent(new win.CustomEvent('app:action', {
    detail: { action: 'profile.update', field: 'targets', value: ['একই১', 'দুই২', 'তিন৩', 'চার৪', 'পাঁচ৫', 'ছয়৬', 'সাত৭'] },
  }));
  await wait(60);
  const accepted = normalizeProfilePatch(patchBody(calls).fields);
  assert.equal(accepted.targets.length, 5);
  dom.window.close();
});

/* A refused save must tell the student, and must NOT claim success. */
test('a save the backend refuses shows an error, never a success toast', async () => {
  const { win, dom } = harness();
  await wait(90);
  win.document.dispatchEvent(new win.CustomEvent('app:action', {
    detail: { action: 'profile.update', field: 'name', value: 'ক' },
  }));
  await wait(70);
  const toast = win.document.getElementById('toast');
  assert.match(toast.textContent, /তথ্য সঠিক নয়|সংরক্ষণ করা যায়নি/);
  dom.window.close();
});

/* ── AVATAR ──────────────────────────────────────────────────────────────── */

/* The design crops to a JPEG data URL. The adapter must strip the data: prefix
   (the backend decodes base64 and then checks the magic bytes) and send
   { mime, data } — anything else is refused and the photo never lands. */
test('avatar: a real cropped JPEG is accepted by the backend magic-byte rules', async () => {
  /* A real 96x96 JPEG, inline so the test needs no fixture file. */
  const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCABgAGADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDzGiiiv20+HCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9k=';
  const dataUrl = 'data:image/jpeg;base64,' + jpeg;
  const { win, calls, dom } = harness();
  await wait(90);
  win.localStorage.setItem('as.profile.v4', JSON.stringify({ photo: dataUrl, avatarSet: true }));
  calls.length = 0;
  win.document.dispatchEvent(new win.CustomEvent('app:action', {
    detail: { action: 'profile.update', field: 'avatar', value: 1 },
  }));
  await wait(80);
  const post = calls.find((c) => c.method === 'POST' && c.path.includes('/profile/avatar'));
  assert.ok(post, 'the photo bytes were actually sent');
  const sent = JSON.parse(post.body);
  assert.equal(sent.mime, 'image/jpeg');
  assert.ok(!/^data:/.test(sent.data), 'the data: prefix is stripped');
  /* Reproduce the server check exactly. */
  const bytes = Uint8Array.from(Buffer.from(sent.data, 'base64'));
  assert.ok(bytes.length >= 64 && bytes.length <= 2 * 1024 * 1024, 'within the size window');
  assert.deepEqual([...bytes.slice(0, 3)], [0xff, 0xd8, 0xff], 'JPEG magic bytes');
  dom.window.close();
});

/* Picking a mascot colour with no photo must remove the old picture, not leave
   a stale one on the server. */
test('avatar: choosing a colour with no photo sends a delete', async () => {
  const { win, calls, dom } = harness();
  await wait(90);
  win.localStorage.setItem('as.profile.v4', JSON.stringify({ photo: '', avatarSet: true }));
  calls.length = 0;
  win.document.dispatchEvent(new win.CustomEvent('app:action', {
    detail: { action: 'profile.update', field: 'avatar', value: 3 },
  }));
  await wait(80);
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.path.includes('/profile/avatar')));
  dom.window.close();
});

/* A data URL the adapter cannot parse must not be sent as a doomed request. */
test('avatar: an unparseable photo is not sent to the backend', async () => {
  const { win, calls, dom } = harness();
  await wait(90);
  win.localStorage.setItem('as.profile.v4', JSON.stringify({ photo: 'data:image/gif;base64,R0lGODlh' }));
  calls.length = 0;
  win.document.dispatchEvent(new win.CustomEvent('app:action', {
    detail: { action: 'profile.update', field: 'avatar', value: 1 },
  }));
  await wait(80);
  assert.equal(calls.filter((c) => c.method === 'POST' && c.path.includes('/profile/avatar')).length, 0);
  dom.window.close();
});


/* ── BULK EDIT (the "সব সম্পাদনা" form) ──────────────────────────────────── */

/* The edit-all form sends the whole profile in one patch. The backend rejects
   the ENTIRE patch on one bad field, so this is the highest-risk save on the
   page: a single bad value silently loses every edit the student made. */
test('bulk: a full profile.save is accepted whole', async () => {
  const { win, calls, dom } = harness();
  await wait(90);
  calls.length = 0;
  win.document.dispatchEvent(new win.CustomEvent('app:action', {
    detail: {
      action: 'profile.save',
      profile: {
        name: 'রাশেল জায়ান', mobile: '01712345678', bio: 'ভালো ছেলে', dob: '2005-06-15',
        school: 'নটর ডেম কলেজ', college: 'ঢাকা কলেজ', session: '2026',
        goal: 'ঢাকা বিশ্ববিদ্যালয়ে ভর্তি', targets: ['ঢাকা বিশ্ববিদ্যালয়'], subjects: ['পদার্থ'],
      },
    },
  }));
  await wait(80);
  const accepted = normalizeProfilePatch(patchBody(calls).fields);
  assert.equal(accepted.fullName, 'রাশেল জায়ান');
  assert.equal(accepted.mobile, '01712345678');
  assert.equal(accepted.school.name, 'নটর ডেম কলেজ');
  assert.equal(accepted.higherInstitution.name, 'ঢাকা কলেজ');
  assert.equal(accepted.admissionSession, '2026');
  assert.deepEqual(accepted.targets, [{ name: 'ঢাকা বিশ্ববিদ্যালয়', unit: '', year: '' }]);
  dom.window.close();
});

/* The bulk form starts from the values already on screen. An empty optional
   field (a student who never filled it) must clear, not poison the patch. */
test('bulk: empty optional fields do not fail the whole save', async () => {
  const { win, calls, dom } = harness();
  await wait(90);
  calls.length = 0;
  win.document.dispatchEvent(new win.CustomEvent('app:action', {
    detail: {
      action: 'profile.save',
      profile: {
        name: 'রাশেল জায়ান', mobile: '', bio: '', dob: '', school: '', college: '',
        session: '', goal: '', targets: [], subjects: [],
      },
    },
  }));
  await wait(80);
  const accepted = normalizeProfilePatch(patchBody(calls).fields);
  assert.equal(accepted.fullName, 'রাশেল জায়ান');
  assert.equal(accepted.school, null);
  dom.window.close();
});

/* A bulk save that contains one bad field must tell the student, and must not
   report success — otherwise they walk away believing it saved. */
test('bulk: one bad field in a full save surfaces an error', async () => {
  const { win, dom } = harness();
  await wait(90);
  win.document.dispatchEvent(new win.CustomEvent('app:action', {
    detail: {
      action: 'profile.save',
      profile: { name: 'ক', mobile: '01712345678', bio: '', dob: '', school: '', college: '', session: '', goal: '', targets: [], subjects: [] },
    },
  }));
  await wait(80);
  assert.match(win.document.getElementById('toast').textContent, /তথ্য সঠিক নয়|সংরক্ষণ করা যায়নি/);
  dom.window.close();
});


/* ── LOADING ─────────────────────────────────────────────────────────────── */

/* The owner's report: tapping the profile tab re-loaded every time. The cause
   was that nothing wrote the persistent cache on this route, so the read below
   always missed. This asserts the write, which is what makes the second visit
   instant — without it the page is correct but slow, and slow is what he
   noticed. */
test('cache: a successful read is persisted for the next visit', async () => {
  const { win, dom } = harness();
  await wait(120);
  const raw = win.localStorage.getItem('ah-profile-cache:AH-AUDIT');
  assert.ok(raw, 'the profile read wrote the persistent cache');
  const entry = JSON.parse(raw);
  assert.equal(entry.publicId, 'AH-AUDIT');
  assert.equal(entry.profile.fullName, 'রাশেল জায়ান', 'the real profile is cached');
  assert.ok(entry.ts > 0, 'stamped with a time, so the 30-day rule can apply');
  dom.window.close();
});

/* A patch response carries no avatar, so a naive cache write would drop the
   photo and the dashboard header would fall back to the mascot after every
   edit. The last known avatar must survive a save. */
test('cache: an edit keeps the known avatar instead of clearing it', async () => {
  const { win, dom, calls } = harness({ avatar: { present: true, updatedAt: 1700000000123 } });
  await wait(120);
  calls.length = 0;
  win.document.dispatchEvent(new win.CustomEvent('app:action', {
    detail: { action: 'profile.update', field: 'bio', value: 'ভালো ছেলে' },
  }));
  await wait(120);
  const entry = JSON.parse(win.localStorage.getItem('ah-profile-cache:AH-AUDIT'));
  assert.equal(entry.avatar.present, true, 'the photo survived the save');
  assert.equal(entry.avatar.updatedAt, 1700000000123);
  dom.window.close();
});

/* The owner's rule: the cache is good for 30 days, then counts as stale so a
   change made on another device cannot hide forever on this one. */
test('cache: an entry older than 30 days is not used', async () => {
  const stale = Object.assign({}, student, { ts: Date.now() - (31 * 24 * 60 * 60 * 1000) });
  const dom = new JSDOM(PAGE, {
    url: 'https://admissionhub.pages.dev/profile-v2.html',
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.localStorage.setItem('ah-profile-cache-key', 'AH-AUDIT');
      win.localStorage.setItem('ah-profile-cache:AH-AUDIT', JSON.stringify(stale));
      win.fetch = () => new Promise(() => {});
    },
  });
  await wait(120);
  const data = dom.window.PROFILE_DATA || {};
  assert.notEqual(data.name, 'রাশেল জায়ান', 'a stale entry must not paint');
  dom.window.close();
});

/* And the boundary: 29 days old is still good, so the rule is a window and not
   a blanket refusal that would make the cache pointless. */
test('cache: an entry inside 30 days is still used', async () => {
  const fresh = Object.assign({}, student, { ts: Date.now() - (29 * 24 * 60 * 60 * 1000) });
  const dom = new JSDOM(PAGE, {
    url: 'https://admissionhub.pages.dev/profile-v2.html',
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.localStorage.setItem('ah-profile-cache-key', 'AH-AUDIT');
      win.localStorage.setItem('ah-profile-cache:AH-AUDIT', JSON.stringify(fresh));
      win.fetch = () => new Promise(() => {});
    },
  });
  await wait(120);
  assert.equal((dom.window.PROFILE_DATA || {}).name, 'রাশেল জায়ান', 'a 29-day-old entry still paints');
  dom.window.close();
});

/* A cache entry paints the student's own data on the first frame, before the
   network answers, so the page is never blank on a slow connection. */
test('loading: cached data paints before the network responds', async () => {
  const dom = new JSDOM(PAGE, {
    url: 'https://admissionhub.pages.dev/profile-v2.html',
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.localStorage.setItem('ah-profile-cache-key', 'AH-AUDIT');
      win.localStorage.setItem('ah-profile-cache:AH-AUDIT', JSON.stringify(student));
      win.fetch = () => new Promise(() => {}); // never resolves
    },
  });
  await wait(120);
  const data = dom.window.PROFILE_DATA || {};
  assert.equal(data.name, 'রাশেল জায়ান', 'cached name painted');
  assert.equal(data.ahid, 'AH-AUDIT');
  dom.window.close();
});

/* A dead network must not leave the page blank or unusable. */
test('loading: a failed profile read still renders an interactive page', async () => {
  const dom = new JSDOM(PAGE, {
    url: 'https://admissionhub.pages.dev/profile-v2.html',
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.fetch = () => Promise.reject(new Error('network down'));
    },
  });
  await wait(120);
  assert.ok(dom.window.document.getElementById('toast'), 'page rendered');
  assert.ok(typeof dom.window.setProfile === 'function', 'UI is wired and interactive');
  dom.window.close();
});

/* A 401 (no session) must not show another student's data. */
test('loading: an unauthenticated read shows the honest empty state', async () => {
  const dom = new JSDOM(PAGE, {
    url: 'https://admissionhub.pages.dev/profile-v2.html',
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.fetch = () => Promise.resolve({
        ok: false, status: 401,
        json: () => Promise.resolve({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'লগইন করুন' } }),
      });
    },
  });
  await wait(120);
  const data = dom.window.PROFILE_DATA || {};
  assert.notEqual(data.name, 'রাশেল জায়ান', 'no stale name shown');
  dom.window.close();
});

/* Switching accounts on one device must not inherit the previous student. */
test('loading: a different AH-ID clears the previous student\'s saved values', async () => {
  const dom = new JSDOM(PAGE, {
    url: 'https://admissionhub.pages.dev/profile-v2.html',
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.localStorage.setItem('as.profile.v4', JSON.stringify({ ahid: 'AH-OLD', name: 'পুরনো ছেলে' }));
      win.fetch = (path) => {
        if (String(path).includes('/profile')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(Object.assign({}, student, { publicId: 'AH-NEW', profile: Object.assign({}, PROFILE, { fullName: 'নতুন ছেলে' }) })),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      };
    },
  });
  await wait(150);
  const saved = JSON.parse(dom.window.localStorage.getItem('as.profile.v4'));
  assert.equal(saved.ahid, 'AH-NEW');
  assert.equal(saved.name, 'নতুন ছেলে');
  dom.window.close();
});

/* Every field the design can edit must be offered to the backend, or the edit
   is silently device-local and vanishes on the student's next device. */
test('loading: no editable field is left un-mapped', async () => {
  const src = readFileSync(new URL('./scripts/build-profile-v2.mjs', import.meta.url), 'utf8');
  const design = readFileSync(new URL('./design/profile-v2-source.html', import.meta.url), 'utf8');
  const committed = new Set([...design.matchAll(/commit\('([a-zA-Z]+)'\)/g)].map((m) => m[1]));
  /* FIELD_MAP packs several keys on one line, so parse the object body, not
     one key per line. */
  const body = src.match(/var FIELD_MAP = \{([\s\S]*?)\};/)[1];
  const mapped = new Set([...body.matchAll(/(\w+)\s*:/g)].map((m) => m[1]));
  for (const k of ['school', 'college', 'targets', 'subjects']) mapped.add(k); // handled by toBackend
  /* avatar has its own upload path; lang and ai are device-local app settings
     the backend validator rejects by design. */
  const exempt = new Set(['avatar', 'lang', 'ai']);
  const missing = [...committed].filter((k) => !exempt.has(k) && !mapped.has(k));
  assert.deepEqual(missing, [], `un-mapped editable fields: ${missing.join(', ')}`);
});

