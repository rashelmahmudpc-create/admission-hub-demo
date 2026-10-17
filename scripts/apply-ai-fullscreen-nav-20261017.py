#!/usr/bin/env python3
"""AI screen stays full screen: no bottom dock there (owner 2026-10-17).

Symptom: after PR #63 (nav-dock.js) the AI chat screen shows the floating
bottom dock and extra empty space at the bottom. Before, AI was full screen.

Cause: ai-agent-chat.js hides the bar with an inline style
(.bottomnav style.display='none'), but nav-dock.js forces
`display:block!important` on the dock host, and `#app:not(.no-nav)` gets
`padding-bottom:112px!important`. An !important stylesheet rule beats a plain
inline style, so the dock (and its padding) came back on the AI screen.

Fix (nav-dock.js only):
* while html.ai-chat-open is set, the dock host is display:none!important.
* the 112px bottom padding rule skips html.ai-chat-open, so the AI screen's
  own padding (and keyboard handling) works as before.
* index.html loads nav-dock.js?v=dock-v2-20261017 (cache bust).
* nav-dock.test.mjs gets a guard test.

Idempotent. Then run `npm run sw:manifest`.
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

def patch(rel, old, new, done_marker):
    p = ROOT / rel
    s = p.read_text(encoding='utf-8')
    if done_marker in s:
        print(f'skip {rel}: already applied'); return
    n = s.count(old)
    if n != 1:
        sys.exit(f'ERROR {rel}: anchor found {n} times (need 1)')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')
    print(f'patched {rel}')

HIDE = "    /* AI chat is full screen (owner 2026-10-17): no dock there. ai-agent-chat.js hides .bottomnav with an inline style, which the !important rule above would beat. */\n    'html.ai-chat-open body #navRoot .bottomnav.ahd-host{display:none!important}',\n"
HOST_TAIL = "-webkit-backdrop-filter:none!important}',\n    'html body #navRoot .bottomnav.ahd-host:hover{transform:none!important}',\n"
patch('nav-dock.js', HOST_TAIL, HOST_TAIL + HIDE, 'html.ai-chat-open body #navRoot .bottomnav.ahd-host{display:none!important}')

patch('nav-dock.js',
      "    'html body #app:not(.no-nav){padding-bottom:calc(112px + var(--safe-b,0px))!important}',\n",
      "    'html:not(.ai-chat-open) body #app:not(.no-nav){padding-bottom:calc(112px + var(--safe-b,0px))!important}',\n",
      "html:not(.ai-chat-open) body #app:not(.no-nav)")

patch('index.html',
      '<script defer src="nav-dock.js?v=dock-v1-20261017"></script>',
      '<script defer src="nav-dock.js?v=dock-v2-20261017"></script>',
      'nav-dock.js?v=dock-v2-20261017')

TEST = r"""
test('AI chat stays full screen: no dock and no dock padding there (owner 2026-10-17)', () => {
  assert.ok(SRC.includes("'html.ai-chat-open body #navRoot .bottomnav.ahd-host{display:none!important}'"), 'dock hidden on the AI screen');
  assert.ok(SRC.includes("'html:not(.ai-chat-open) body #app:not(.no-nav){padding-bottom:calc(112px + var(--safe-b,0px))!important}'"), 'dock padding skipped on the AI screen');
  assert.ok(!SRC.includes("'html body #app:not(.no-nav){padding-bottom"), 'old unconditional padding rule is gone');
  assert.ok(HTML.includes('src="nav-dock.js?v=dock-v2-20261017"'), 'cache-busted script tag');
});
"""
p = ROOT / 'nav-dock.test.mjs'
s = p.read_text(encoding='utf-8')
if 'AI chat stays full screen: no dock' in s:
    print('skip nav-dock.test.mjs: already applied')
else:
    p.write_text(s.rstrip('\n') + '\n' + TEST, encoding='utf-8'); print('patched nav-dock.test.mjs')
