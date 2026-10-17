#!/usr/bin/env python3
"""Fresh Start phase 1 (owner 2026-10-17).

The `email-intro-continue` button still called beginEmailVerification, which
posts /account-verification/email/start and sends the Firebase link directly,
skipping the OTP chain (Brevo first). Route it through beginEmailOwnership
whenever the server publishes emailOwnership as available; that endpoint runs
the OTP chain and falls back to the Firebase link only when every slot fails.
When emailOwnership is unavailable the old Firebase path stays as before.

Idempotent: each anchor must match exactly once, already-applied edits skip.
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

def edit(rel, pairs):
    path = ROOT / rel
    text = path.read_text(encoding='utf-8')
    changed = False
    for old, new in pairs:
        if new in text:
            print(f'skip (applied): {rel}')
            continue
        if text.count(old) != 1:
            sys.exit(f'anchor count {text.count(old)} != 1 in {rel}: {old[:70]!r}')
        text = text.replace(old, new, 1)
        changed = True
    if changed:
        path.write_text(text, encoding='utf-8')
        print(f'patched: {rel}')

edit('account-access.js', [(
    "$('[data-role=\"email-intro-continue\"]').addEventListener('click', beginEmailVerification);",
    "// Fresh Start phase 1: the OTP chain (Brevo first) owns the email button; the\n"
    "    // Worker falls back to the Firebase link itself when every slot fails.\n"
    "    $('[data-role=\"email-intro-continue\"]').addEventListener('click', () => (\n"
    "      state.capabilities.emailOwnership?.available ? beginEmailOwnership() : beginEmailVerification()\n"
    "    ));",
)])

edit('docs/fresh-start-plan.md', [(
    "- [ ] Phase 1: `email-intro-continue`",
    "- [x] Phase 1: `email-intro-continue`",
)])
