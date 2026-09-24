/* Dead-handler guard — every inline event attribute in shipped client code
 * must call something that actually exists. A handler that references an
 * undefined global is a button that silently does nothing (owner complaint:
 * "many buttons don't work"). Regression: Question Bank "Show Answer" called
 * openQuestionDetail(), which was defined nowhere. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const ATTR = /on(?:click|input|change|submit|keyup|keydown|blur|focus|load|error|pointerdown|touchstart)="((?:[^"\\]|\\.)*)"/g;
/* Keywords that look like a call when followed by `(` (e.g. `async()=>`). */
const KEYWORDS = new Set(['async', 'await', 'function', 'new', 'typeof', 'void', 'delete',
  'return', 'if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'in', 'of', 'yield', 'case']);
const CALL = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g;
const BUILTINS = new Set(('if for while return typeof new void switch catch else do try this ' +
  'window document console history navigator fetch alert confirm prompt open close print ' +
  'status name length top self parent frames String Number Boolean Object Array JSON Math ' +
  'Date parseInt parseFloat isNaN encodeURIComponent decodeURIComponent setTimeout ' +
  'clearTimeout setInterval clearInterval requestAnimationFrame CustomEvent Event').split(/\s+/));

const clientFiles = readdirSync('.').filter(f =>
  f.endsWith('.js') && !f.endsWith('.test.mjs') && !f.startsWith('gk-agent') &&
  !f.includes('worker') && f !== 'sw.js');

function collect() {
  const defined = new Set();
  const usages = [];
  for (const file of [...clientFiles, 'index.html']) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(ATTR)) usages.push([file, m[1]]);
    const stripped = src.replace(ATTR, 'onx=""');
    for (const m of stripped.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
    for (const m of stripped.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);
    for (const m of stripped.matchAll(/(?:window|globalThis|self)\.([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);
  }
  return { defined, usages };
}

test('no inline handler calls an undefined function', () => {
  const { defined, usages } = collect();
  const missing = new Map();
  for (const [file, attr] of usages) {
    for (const m of attr.matchAll(CALL)) {
      const name = m[1];
      if (defined.has(name) || BUILTINS.has(name) || KEYWORDS.has(name)) continue;
      if (!missing.has(name)) missing.set(name, new Set());
      missing.get(name).add(file);
    }
  }
  const report = [...missing].map(([n, f]) => `${n} (${[...f].join(', ')})`).join('; ');
  assert.equal(missing.size, 0, `inline handlers call undefined functions: ${report}`);
});

test('Question Bank "Show Answer" routes to a real detail modal', () => {
  const urgent = readFileSync('urgent-fix.js', 'utf8');
  assert.match(urgent, /window\.openQuestionDetail\s*=/, 'openQuestionDetail must be defined');
  assert.match(urgent, /onclick="openQuestionDetail\('\$\{q\.id\}'\)"/, 'card keeps the handler');
  assert.match(urgent, /openModal\(/, 'the detail view uses the shared modal');
});

test('detail modal shows the correct option and closes cleanly', () => {
  const urgent = readFileSync('urgent-fix.js', 'utf8');
  assert.match(urgent, /is-correct/, 'correct option is marked');
  assert.match(urgent, /onclick="closeModal\(\)"/, 'modal can be closed');
});

test('clicking "Show Answer" really opens the modal with the right answer', () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="modalRoot"></div></body></html>', {
    url: 'https://admissionhub.pages.dev/#question-bank', runScripts: 'outside-only'
  });
  const { window } = dom;
  /* Minimal app surface the handler reads: cache, modal helpers, escapers. */
  window.CACHE = {
    questions: [{ id: 'q1', question: '2+2?', options: ['3', '4', '5', '6'], answerIndex: 1, explanation: 'Basic sum', subjectId: 's1', topicId: 't1' }],
    subjects: [{ id: 's1', name: 'Math' }],
    topics: [{ id: 't1', name: 'Arithmetic' }]
  };
  window.BankAnswers = { q1: { selected: 0 } };
  window.subjectName = id => (window.CACHE.subjects.find(s => s.id === id) || {}).name || '—';
  window.topicName = id => (window.CACHE.topics.find(t => t.id === id) || {}).name || '—';
  window.openModal = html => {
    window.document.getElementById('modalRoot').innerHTML =
      `<div class="modal-bg"><div class="modal">${html}</div></div>`;
  };
  window.closeModal = () => { window.document.getElementById('modalRoot').innerHTML = ''; };

  const src = readFileSync('urgent-fix.js', 'utf8');
  window.Router = { path: 'question-bank' };
  window.renderShell = () => {};
  window.toast = () => {};
  window.eval(src);

  window.openQuestionDetail('q1');
  const root = window.document.getElementById('modalRoot');
  assert.ok(root.querySelector('.modal'), 'a modal is rendered');
  const opts = [...root.querySelectorAll('.ah-detail-opt')];
  assert.equal(opts.length, 4, 'all four options shown');
  assert.match(opts[1].className, /is-correct/, 'the correct option (B) is marked');
  assert.match(opts[0].className, /is-wrong/, 'the picked but wrong option (A) is marked');
  assert.match(root.textContent, /Basic sum/, 'explanation is shown');

  window.closeModal();
  assert.equal(window.document.getElementById('modalRoot').innerHTML, '', 'modal closes');
  window.close();
});
