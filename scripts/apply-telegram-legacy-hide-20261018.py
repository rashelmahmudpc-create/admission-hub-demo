#!/usr/bin/env python3
"""Owner 2026-10-18: the native (fallback) "Continue with Telegram" anchor in
account-access.js showed up on top of / before the Welcome Story. The old
Facebook anchor was kept out by `.ah-welcome-view > .ah-account-facebook
{display:none!important}`; the Telegram anchor needs the same rule. Telegram
stays on the Welcome Story (welcome-story.js) and the Sky login step only.

Idempotent. Run from the repo root, then `npm run sw:manifest`.
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

js = ROOT / 'account-access.js'
text = js.read_text(encoding='utf-8')
old = "      telegramHost.hidden = !state.capabilities.telegramLogin.available;\n"
new = "      telegramHost.hidden = true; /* Owner 2026-10-18: Telegram lives on the Welcome Story, never above it. */\n"
if new not in text:
    if text.count(old) != 1:
        sys.exit('account-access.js: anchor not found exactly once')
    text = text.replace(old, new)
    js.write_text(text, encoding='utf-8')

css = ROOT / 'account-access.css'
rule = '.ah-welcome-view > .ah-account-telegram,.ah-account-telegram.ah-welcome-telegram{display:none!important}\n'
c = css.read_text(encoding='utf-8')
if rule not in c:
    css.write_text(c.rstrip('\n') + '\n/* Owner 2026-10-18: native Telegram anchor never shows above the Welcome Story. */\n' + rule, encoding='utf-8')
print('telegram legacy anchor hidden')
