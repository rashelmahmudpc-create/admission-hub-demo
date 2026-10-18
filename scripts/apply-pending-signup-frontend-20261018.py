#!/usr/bin/env python3
"""AUTH step 1 (করণীয় ৪ frontend): the signup request opts in to the held
(pending) signup with one header; cache tokens bumped so browsers fetch the new
account-access.js. Idempotent."""
import pathlib, re, sys

OLD_TOKEN = '20261018-logout-otp-v1'
NEW_TOKEN = '20261018-pending-signup-v1'

def edit(path, fn):
    p = pathlib.Path(path)
    text = p.read_text(encoding='utf-8')
    new = fn(text)
    if new != text:
        p.write_text(new, encoding='utf-8')

def account_access(text):
    if "'X-AH-Signup-Flow'" in text:
        return text
    old = "          'X-AH-Auth-UI': 'auth-premium-v6',  \n"
    if text.count(old) != 1:
        sys.exit('account-access.js: header anchor not found exactly once')
    return text.replace(old, old +
        "          // AUTH step 1: no account until the emailed code is proven.\n"
        "          ...(String(path || '').split('?')[0] === '/signup' ? { 'X-AH-Signup-Flow': 'pending-v1' } : {}),\n")

edit('account-access.js', account_access)
for path in ('index.html', 'sw.js', 'account-retirement.test.mjs'):
    edit(path, lambda t: t.replace(OLD_TOKEN, NEW_TOKEN))

print('pending signup frontend opt-in applied')
