/* Honesty guard — tabs that have no backend must say so on the page.
 *
 * Campaigns and Automations render from SAMPLE_DATA, and their create /
 * activate actions only mutate in-memory state (lost on refresh). The panel
 * must therefore carry an explicit "preview only, no backend" notice, or the
 * owner is misled into thinking those buttons reach real students.
 *
 * This locks the notice in: remove it and the guard fails. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILE = 'notification-command-center.html';
const src = readFileSync(FILE, 'utf8');

/* Return the source of `function <name>(...)` up to its matching closing brace. */
function functionBody(name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, `function ${name} not found`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

/* Each unbacked tab: its view function and the notice key it must render. */
const UNBACKED = [
  { view: 'campaignsViewHTML', key: 'c_preview_note', label: 'Campaigns' },
  { view: 'automationsViewHTML', key: 'au_preview_note', label: 'Automations' },
];

for (const { view, key, label } of UNBACKED) {
  test(`honesty: ${label} tab renders its "preview only" notice`, () => {
    const body = functionBody(view);
    assert.match(body, new RegExp(`\\bt\\('${key}'\\)`),
      `${view} must render t('${key}')`);
    assert.match(body, /ns-note/,
      `${view} must render the notice inside an .ns-note element`);
  });
}

test('honesty: every preview notice key exists with both languages and real content', () => {
  for (const { key, label } of UNBACKED) {
    const m = src.match(new RegExp(key + ':\\{([^}]*)\\}'));
    assert.ok(m, `${key} missing from the translation table`);
    const entry = m[1];
    const en = entry.match(/\ben\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const bn = entry.match(/\bbn\s*:\s*"((?:[^"\\]|\\.)*)"/);
    assert.ok(en && en[1].length > 40, `${key} English notice is missing or too short`);
    assert.ok(bn && bn[1].length > 40, `${key} Bangla notice is missing or too short`);
    assert.match(en[1], /backend/i, `${key} English notice must state there is no backend`);
    assert.match(en[1], /no real (messages|automation)/i,
      `${key} English notice must say nothing real is sent / runs`);
  }
});

test('honesty: the notice keys are not the only backend-less signal left implicit', () => {
  /* The sample-data arrays must stay empty, so no fabricated campaigns or
   * automations appear as if they were real activity. */
  for (const arr of ['campaigns', 'automations', 'queue', 'sent']) {
    const m = src.match(new RegExp(arr + '\\s*:\\s*\\[([^\\]]*)\\]'));
    if (!m) continue;
    const nonEmpty = m[1].replace(/\s|,|;/g, '').length > 0;
    assert.ok(!nonEmpty, `SAMPLE_DATA.${arr} should be empty, found: ${m[1].slice(0, 60)}`);
  }
});
