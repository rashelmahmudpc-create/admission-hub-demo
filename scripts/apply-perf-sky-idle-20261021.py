"""Perf step 1 (2026-10-21): load the Sky AI chat group off the critical path.

Moves sky-smalltalk, sky-faq (x5), sky-tools-client and ai-agent-chat (~183 KB)
from <script defer> to the existing x-ah-idle loader, placed FIRST in the idle
queue so Sky is ready right after the first frame. The router already waits for
window.renderAiAgentPage (LAZY_RENDERER / waitForRenderer), so opening #ai early
re-renders as soon as the script arrives. Idempotent: safe to run twice.
"""
import json

SRCS = [
    './sky-smalltalk.js?v=st2',
    './sky-faq.js?v=faq1',
    './sky-faq-bn.js?v=faq1',
    './sky-faq-en.js?v=faq1',
    './sky-faq-sci.js?v=faq1',
    './sky-faq-gk.js?v=faq1',
    './sky-tools-client.js?v=tools1',
    './ai-agent-chat.js?v=agent-f1-ui-skyv13',
]


def edit(path, pairs):
    s = open(path, encoding='utf8', newline='').read()
    for old, new in pairs:
        if s.count(new) == 1 and s.count(old) == 0:
            continue  # already applied
        assert s.count(old) == 1, (path, old)
        s = s.replace(old, new)
    open(path, 'w', encoding='utf8', newline='').write(s)


pairs = [(f'<script defer src="{x}"></script>',
          f'<script type="application/x-ah-idle" data-ah-src="{x}"></script>') for x in SRCS]
pairs.append((' const sources=["experience-studio-store.js?v=2"',
              ' const sources=[' + ','.join(json.dumps(x) for x in SRCS) + ',"experience-studio-store.js?v=2"'))
edit('index.html', pairs)

edit('startup-fast.test.mjs', [(
    "assert.equal(tags.length,14);",
    "assert.equal(tags.length,22);\n assert.ok(tags.findIndex(x=>x.includes('sky-faq.js'))<tags.findIndex(x=>x.includes('ai-agent-chat')));",
)])

edit('pr3-shared-answers.test.mjs', [(
    """html.includes('<script defer src="./' + f + '?v=faq1"></script>')""",
    """html.includes('<script type="application/x-ah-idle" data-ah-src="./' + f + '?v=faq1"></script>') && html.includes('"./' + f + '?v=faq1"')""",
)])
print('perf step 1 applied')
