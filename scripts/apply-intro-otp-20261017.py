#!/usr/bin/env python3
"""Fresh Start phase 1 (2026-10-17): the email-intro-continue button goes
through the OTP chain (/email-ownership/start) instead of sending the Firebase
link directly. The Worker still falls back to the Firebase link by itself when
every OTP provider is exhausted. Idempotent: running twice changes nothing."""
from pathlib import Path

root = Path(__file__).resolve().parent.parent


def patch(rel, old, new, done_marker):
    p = root / rel
    s = p.read_text(encoding='utf-8')
    if done_marker in s:
        print(f'{rel}: already applied')
        return
    if s.count(old) != 1:
        raise SystemExit(f'{rel}: anchor not found exactly once')
    p.write_text(s.replace(old, new), encoding='utf-8')
    print(f'{rel}: patched')


# 1. account-access.js: new router + rebind the intro button.
patch('account-access.js',
      "  const openEmailInbox = () => {",
      """  // The email-intro button used to call beginEmailVerification directly, which
  // sent the Firebase link and skipped every OTP provider. Route it through the
  // OTP chain like created-continue does; the Worker itself falls back to the
  // Firebase link when every provider is exhausted. Only when the OTP family is
  // unavailable does the button still request the link directly.
  const beginEmailIntro = async () => {
    if (state.capabilities?.emailOwnership?.available) { await beginEmailOwnership(); return; }
    await beginEmailVerification();
  };

  const openEmailInbox = () => {""",
      "const beginEmailIntro = async")
patch('account-access.js',
      """$('[data-role="email-intro-continue"]').addEventListener('click', beginEmailVerification);""",
      """$('[data-role="email-intro-continue"]').addEventListener('click', beginEmailIntro);""",
      """addEventListener('click', beginEmailIntro);""")

# 2. signup-autosave.test.mjs: configurable emailOwnership + two new tests.
patch('signup-autosave.test.mjs',
      "function setup({ pendingFailures = 0 } = {}) {",
      "function setup({ pendingFailures = 0, emailOwnership = false } = {}) {",
      "emailOwnership = false } = {}")
patch('signup-autosave.test.mjs',
      "          telegramVerification: { available: true },\n          backup: { available: false }\n",
      "          telegramVerification: { available: true },\n          emailOwnership: { available: emailOwnership },\n          backup: { available: false }\n",
      "emailOwnership: { available: emailOwnership }")

TESTS = """

// Fresh Start phase 1: the email-intro button must go through the OTP chain
// (/email-ownership/start) whenever it is available. The Firebase link is only
// the Worker's own last resort, never a direct client shortcut.
test('email-intro-continue starts the OTP chain, not the Firebase link, when email ownership is available', async () => {
  const app = setup({ emailOwnership: true });
  const { document } = app;
  await openSignup(app);
  await fillSignup(app);
  submitSignup(app);
  await waitFor(() => document.querySelector('[data-view="created"]')?.hidden === false, 'created view');
  document.querySelector('[data-role="created-continue"]').click();
  await waitFor(() => document.querySelector('[data-view="email-ownership"]')?.hidden === false, 'ownership view');
  const ownershipCalls = () => app.calls.filter(c => c.path.includes('/email-ownership/start')).length;
  assert.equal(ownershipCalls(), 1);
  document.querySelector('[data-role="ownership-back"]').click();
  await waitFor(() => document.querySelector('[data-view="verify"]')?.hidden === false, 'verify view');
  await waitFor(() => document.querySelector('[data-role="email-verification-start"]')?.disabled === false, 'email start enabled');
  document.querySelector('[data-role="email-verification-start"]').click();
  await waitFor(() => document.querySelector('[data-view="email-intro"]')?.hidden === false, 'email intro view');
  document.querySelector('[data-role="email-intro-continue"]').click();
  await waitFor(() => ownershipCalls() === 2, 'second ownership start from email-intro');
  await waitFor(() => document.querySelector('[data-view="email-ownership"]')?.hidden === false, 'ownership view again');
  await wait(50);
  assert.equal(app.calls.some(c => c.path.includes('/account-verification/email/start')), false);
  app.dom.window.close();
});

test('email-intro-continue still sends the Firebase link when the OTP family is unavailable', async () => {
  const app = setup({ emailOwnership: false });
  const { document } = app;
  await openSignup(app);
  await fillSignup(app);
  submitSignup(app);
  await waitFor(() => document.querySelector('[data-view="created"]')?.hidden === false, 'created view');
  document.querySelector('[data-role="created-continue"]').click();
  await waitFor(() => document.querySelector('[data-view="verify"]')?.hidden === false, 'verify view');
  await waitFor(() => document.querySelector('[data-role="email-verification-start"]')?.disabled === false, 'email start enabled');
  document.querySelector('[data-role="email-verification-start"]').click();
  await waitFor(() => document.querySelector('[data-view="email-intro"]')?.hidden === false, 'email intro view');
  document.querySelector('[data-role="email-intro-continue"]').click();
  await waitFor(() => app.calls.some(c => c.path.includes('/account-verification/email/start')), 'firebase link start');
  await waitFor(() => document.querySelector('[data-role="verification-email-panel"]')?.hidden === false, 'link waiting panel');
  await wait(50);
  assert.equal(app.calls.some(c => c.path.includes('/email-ownership/start')), false);
  app.dom.window.close();
});
"""
p = root / 'signup-autosave.test.mjs'
s = p.read_text(encoding='utf-8')
if 'email-intro-continue starts the OTP chain' not in s:
    p.write_text(s.rstrip('\n') + TESTS, encoding='utf-8')
    print('signup-autosave.test.mjs: tests appended')

# 3. docs/fresh-start-plan.md: tick phase 1.
patch('docs/fresh-start-plan.md',
      "- [ ] Phase 1: `email-intro-continue`",
      "- [x] Phase 1 (2026-10-17): `email-intro-continue`",
      "- [x] Phase 1")
