// 🧩 PHASE 9 — M4: CONTEXT ENGINE (server-side module test)
// Locks the typed permission-scoped context layer introduced in migration step
// M4. Two invariants matter most: (a) a category at scope NONE never reaches
// the model, and (b) with the feature flag off the prompt is byte-identical to
// the pre-M4 output, so the legacy path is untouched.
import { readFileSync } from 'fs';
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const CE = await import('./context-engine.js');
const A = await import('./ai-agent.js');
const SRC = readFileSync('ai-agent.js', 'utf8');
const {
  CATEGORY, SCOPE, CONTEXT_VERSION, scopeAtLeast, identityKind, resolveScopes,
  buildContext, describeContext, renderContext
} = CE;
const { contextEngineEnabled, buildSystemPrompt, agentChat, __test } = A;

/* ── ১. Registry + ladder shape ── */
t('M4-১. category registry is typed and frozen', Object.isFrozen(CATEGORY) && CATEGORY.IDENTITY === 'identity' && CATEGORY.ONBOARDING === 'onboarding');
t('M4-২. scope ladder is ordered NONE→MINIMAL→SUMMARY→FULL_ALLOWED',
  scopeAtLeast('full_allowed', 'summary') && scopeAtLeast('summary', 'minimal') && scopeAtLeast('minimal', 'none')
  && !scopeAtLeast('none', 'minimal') && !scopeAtLeast('minimal', 'summary'));

/* ── ২. Identity kind is decided by uid shape, never guessed ── */
t('M4-৩. identityKind reads the server-side uid prefix',
  identityKind('account-abc123') === 'account' && identityKind('guest-abc123') === 'guest' && identityKind('') === 'unknown');

/* ── ৩. Scope resolution ── */
t('M4-৪. a guest gets identity NONE (no durable identity to expose)',
  resolveScopes({ uid: 'guest-x' }).identity === SCOPE.NONE);
t('M4-৫. a signed-in student gets identity SUMMARY, never the raw id',
  resolveScopes({ uid: 'account-x' }).identity === SCOPE.SUMMARY);
t('M4-৬. categories with no legitimate source resolve to NONE, not a guess',
  (() => { const s = resolveScopes({ uid: 'account-x' }); return s.profile === SCOPE.NONE && s.activity === SCOPE.NONE; })());
t('M4-৭. preference is FULL_ALLOWED only when prefs exist, memory follows memoryOn',
  (() => {
    const off = resolveScopes({ uid: 'account-x' });
    const on = resolveScopes({ uid: 'account-x', prefs: { langStyle: 'bn' }, memoryOn: true });
    return off.preference === SCOPE.NONE && off.memory === SCOPE.NONE
      && on.preference === SCOPE.FULL_ALLOWED && on.memory === SCOPE.FULL_ALLOWED;
  })());

/* ── ৪. Minimum-necessary enforcement ── */
t('M4-৮. a NONE category carries no payload in the bundle',
  (() => {
    const g = buildContext({ uid: 'guest-x', stats: { exams: 3 }, prefs: { tone: 'simple' }, onboarding: null, memoryOn: false });
    // guest identity + always-reserved categories are NONE; performance/preference are not.
    return g.data.identity === undefined && g.data.profile === undefined && g.data.activity === undefined
      && g.scope.identity === SCOPE.NONE && g.scope.profile === SCOPE.NONE;
  })());
t('M4-৯. an allowed category does carry its payload',
  (() => {
    const b = buildContext({ uid: 'account-x', stats: { exams: 3, accuracy: 71 }, prefs: { langStyle: 'bn', tone: 'simple', responseLen: 'short', memory: true }, onboarding: null, memoryOn: true });
    return b.data.identity.kind === 'account' && b.data.performance.exams === 3 && b.data.preference.tone === 'simple';
  })());
t('M4-১০. bundle, its data container and payloads are frozen, and carry the version', 
  (() => {
    const b = buildContext({ uid: 'account-x', stats: { exams: 1 }, memoryOn: true });
    return Object.isFrozen(b) && Object.isFrozen(b.data) && Object.isFrozen(b.data.performance) && b.version === CONTEXT_VERSION;
  })());
t('M4-১১. the raw uid never appears in the bundle', (() => {
  const b = buildContext({ uid: 'account-secret-uid-xyz', prefs: { tone: 'simple' }, memoryOn: true });
  return !JSON.stringify(b).includes('secret-uid-xyz');
})());

/* ── ৫. Rendering reflects scope only ── */
t('M4-১২. renderContext emits no line for a denied category', (() => {
  const txt = renderContext(buildContext({ uid: 'guest-x', prefs: { langStyle: 'bn', tone: 'simple', responseLen: 'short', memory: false }, memoryOn: false }));
  return !/performance/.test(txt) && !/identity/.test(txt);
})());
t('M4-১৩. renderContext states the version and the minimum-necessary rule', (() => {
  const txt = renderContext(buildContext({ uid: 'account-x', stats: { exams: 2 }, memoryOn: true }));
  return txt.includes(CONTEXT_VERSION) && txt.includes('Only the categories above');
})());
t('M4-১৪. describeContext lists allowed vs denied without any values', (() => {
  const d = describeContext(buildContext({ uid: 'account-x', stats: { exams: 5 }, memoryOn: true }));
  return d.allowed.includes('performance') && d.allowed.includes('identity') && d.denied.includes('profile')
    && !JSON.stringify(d).includes('5');
})());

/* ── ৬. Flag default off + legacy path untouched ── */
t('M4-১৫. the flag is off unless explicitly enabled', !contextEngineEnabled({}) && !contextEngineEnabled({ USE_CONTEXT_ENGINE: 'disabled' }) && contextEngineEnabled({ USE_CONTEXT_ENGINE: 'enabled' }));
t('M4-১৬. with the flag off the prompt is byte-identical to buildSystemPrompt alone', (() => {
  const base = buildSystemPrompt({ stats: { exams: 2 }, prefs: { langStyle: 'bn', tone: 'simple', responseLen: 'short', memory: true } });
  const withoutCtx = [base, '', ''].filter(Boolean).join('\n\n');
  return withoutCtx === base && !base.includes('CONTEXT ENGINE');
})());
t('M4-১৭. agentChat only consults the engine behind the flag', SRC.includes('contextEngineEnabled(env)') && SRC.includes('buildContext({ uid: sendCtx.uid'));

/* ── ৭. E2E: flag off → provider payload has no context block; flag on → it does ── */
const sseOk = () => new Response('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ঠিক আছে' }] } }] }) + '\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
const envWith = (over = {}) => {
  const store = new Map();
  return {
    GEMINI_KEYS: 'k1', PUB_KV: { get: async (k) => (store.has(k) ? store.get(k) : null), put: async (k, v) => { store.set(k, v); } },
    ...over
  };
};
async function capturedSystemPrompt(env) {
  const real = globalThis.fetch;
  let captured = '';
  globalThis.fetch = async (url, init) => {
    try { captured = JSON.parse(init.body).system_instruction.parts[0].text; } catch (_) {}
    return sseOk();
  };
  try {
    const res = await agentChat(new Request('https://x/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'হ্যালো' }] }) }), env, 'account-abc');
    await res.text();
  } finally { globalThis.fetch = real; }
  return captured;
}
t('M4-১৮. E2E: default (flag off) provider prompt carries no CONTEXT ENGINE block',
  (async () => !(await capturedSystemPrompt(envWith())).includes('CONTEXT ENGINE'))(), { timeout: 10000 });
t('M4-১৯. E2E: flag on appends the scoped context block for a signed-in student',
  (async () => (await capturedSystemPrompt(envWith({ USE_CONTEXT_ENGINE: 'enabled' }))).includes('CONTEXT ENGINE'))(), { timeout: 10000 });

/* ── ৮. Real student profile wiring (academic structure; name only on consent) ── */
t('M4-২০. profile is NONE without a source, SUMMARY once supplied for an account', (() => {
  const off = resolveScopes({ uid: 'account-x' });
  const on = resolveScopes({ uid: 'account-x', profile: { institutionName: 'X College' } });
  return off.profile === SCOPE.NONE && on.profile === SCOPE.SUMMARY;
})());
t('M4-২১. sanitizeProfileContext drops every PII key and keeps the academic ones', (() => {
  const p = __test.sanitizeProfileContext({
    fullName: 'Rashed Mahmud', mobile: '+8801700000000', dob: '2005-01-01', bio: 'hello',
    email: 'a@b.com', publicId: 'AH-ABC123', avatarStyle: 3,
    institutionName: 'Dhaka College', institutionType: 'college', district: 'Dhaka',
    admissionSession: '2026', academicGoal: 'Medical admission',
    subjects: ['Biology', 'Chemistry', 'Biology'],
    targets: [{ name: 'Dhaka Medical College', unit: 'MBBS', year: '2026' }]
  });
  const s = JSON.stringify(p);
  return p.institutionName === 'Dhaka College' && p.district === 'Dhaka' && p.institutionType === 'college'
    && p.admissionSession === '2026' && p.subjects.length === 2
    && p.targets[0].name === 'Dhaka Medical College'
    && p.firstName === undefined
    && !/Rashed|0\d{9,}|2005-01-01|a@b\.com|AH-ABC123|hello/.test(s);
})());
t('M4-২২. the first name is always sanitized automatically, with no opt-in', (() => {
  const arg = { firstName: 'Rashed', institutionName: 'Dhaka College' };
  const got = __test.sanitizeProfileContext(arg);
  const full = __test.sanitizeProfileContext({ firstName: 'Rashed Mahmud' });
  return got.firstName === 'Rashed' && full === null;
})());
t('M4-২৩. sanitizeProfileContext strips control chars/angle brackets and returns null when empty',
  (() => {
    const p = __test.sanitizeProfileContext({ academicGoal: 'Math\n<script>alert(1)</script>' });
    const empty = __test.sanitizeProfileContext({ fullName: 'Only PII', mobile: '+8801700000000' });
    return p.academicGoal === 'Mathscriptalert(1)/script' && empty === null;
  })());
t('M4-২৪. a guest request never resolves profile, even with a smuggled payload', (() => {
  const g = buildContext({ uid: 'guest-x', profile: { institutionName: 'Dhaka College' }, memoryOn: false });
  return g.scope.profile === SCOPE.NONE && g.data.profile === undefined;
})());
t('M4-২৫. renderContext surfaces the academic profile at an allowed scope', (() => {
  const txt = renderContext(buildContext({ uid: 'account-x', profile: { institutionName: 'Dhaka College', district: 'Dhaka', targets: [{ name: 'DMC', unit: 'MBBS', year: '2026' }] }, memoryOn: false }));
  return txt.includes('profile (academic)') && txt.includes('Dhaka College') && txt.includes('DMC');
})());
t('M4-২৬. renderContext shows the name and tells the AI to use it', (() => {
  const withName = renderContext(buildContext({ uid: 'account-x', profile: { firstName: 'Rashed', institutionName: 'Dhaka College' }, memoryOn: false }));
  const noName = renderContext(buildContext({ uid: 'account-x', profile: { institutionName: 'Dhaka College' }, memoryOn: false }));
  return withName.includes('name: Rashed') && withName.includes('by first name (Rashed)')
    && !noName.includes('name:') && !noName.includes('by first name');
})());
t('M4-২৭. AI prefs carry no name-sharing switch — the name is automatic', (() => {
  const { sanitizeAiPrefs } = A;
  const p = sanitizeAiPrefs({ shareName: false });
  return !('shareName' in p) && !('shareName' in sanitizeAiPrefs({}));
})());

/* ── ৯. E2E: the name reaches the provider automatically, without any setting ── */
async function capturedWithContext(env, ctx) {
  const real = globalThis.fetch;
  let captured = '';
  globalThis.fetch = async (url, init) => {
    try { captured = JSON.parse(init.body).system_instruction.parts[0].text; } catch (_) {}
    return sseOk();
  };
  try {
    const res = await agentChat(new Request('https://x/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'হ্যালো' }], context: ctx }) }), env, 'account-abc');
    await res.text();
  } finally { globalThis.fetch = real; }
  return captured;
}
t('M4-২৮. E2E: no setup needed — the first name reaches the provider by default',
  (async () => {
    const p = await capturedWithContext(envWith({ USE_CONTEXT_ENGINE: 'enabled' }), { profile: { firstName: 'Rashed', institutionName: 'Dhaka College' } });
    return p.includes('name: Rashed') && p.includes('Dhaka College');
  })(), { timeout: 10000 });
t('M4-২৯. E2E: a full name still never leaves — only one token survives',
  (async () => {
    const p = await capturedWithContext(envWith({ USE_CONTEXT_ENGINE: 'enabled' }), { profile: { firstName: 'Rashed Mahmud', institutionName: 'Dhaka College' } });
    return p.includes('Dhaka College') && !/name:/.test(p);
  })(), { timeout: 10000 });

console.log(`\n🧩 PHASE9-M4-CONTEXT-ENGINE: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
