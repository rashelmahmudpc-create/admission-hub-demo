/* i18n guard — the command center's translation table must label each string
 * with the language it is actually written in, and never repeat a key.
 *
 * t() reads `e.bn` for Bangla and `e.en` for English, so a mislabeled entry
 * fails silently: a Bangla string stored under `en:` shows up in English mode
 * (or a duplicate `en:` key means the string vanishes in Bangla).
 *
 * Regressions this guards: t_empty / t_empty_desc / t_used / h_banner /
 * sys_tokens / sys_signout / sys_signout_ok / live_empty_desc all had a
 * Bangla value under `en:`; six more entries had their two languages fully
 * swapped; live_empty_bn had Bengali under both keys. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILE = 'notification-command-center.html';
const BENGALI = /[\u0980-\u09FF]/;

/* Pull `const T = { ... };` out of the page and split it into top-level
 * `key:{...}` entries with brace counting (values may contain braces). */
function parseTable(src) {
  const start = src.search(/const\s+T\s*=\s*\{/);
  assert.ok(start >= 0, 'translation table T not found');
  let i = src.indexOf('{', start);
  const open = i;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = src.slice(open + 1, i);

  const entries = [];
  const keyRe = /(?:^|,)\s*([A-Za-z_$][\w$]*)\s*:\s*\{/g;
  let m;
  while ((m = keyRe.exec(body))) {
    const key = m[1];
    let j = body.indexOf('{', m.index);
    let d = 0, k = j;
    for (; k < body.length; k++) {
      if (body[k] === '{') d++;
      else if (body[k] === '}') { d--; if (d === 0) break; }
    }
    entries.push({ key, raw: body.slice(j + 1, k) });
    keyRe.lastIndex = k;
  }
  return entries;
}

/* Read the first string literal bound to `field` in a raw entry body. */
function fieldValue(raw, field) {
  const m = raw.match(new RegExp('\\b' + field + '\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
  return m ? m[1] : null;
}

const entries = parseTable(readFileSync(FILE, 'utf8'));

test('i18n: the translation table was found and parsed', () => {
  assert.ok(entries.length > 200, `expected a large table, got ${entries.length}`);
});

test('i18n: no English value contains Bengali script', () => {
  const bad = entries
    .map(e => ({ key: e.key, en: fieldValue(e.raw, 'en') }))
    .filter(x => x.en != null && BENGALI.test(x.en));
  assert.deepEqual(bad, [], `English entries holding Bengali text: ${JSON.stringify(bad)}`);
});

test('i18n: no entry repeats a language key', () => {
  const bad = [];
  for (const e of entries) {
    const en = (e.raw.match(/\ben\s*:/g) || []).length;
    const bn = (e.raw.match(/\bbn\s*:/g) || []).length;
    if (en > 1 || bn > 1) bad.push({ key: e.key, en, bn });
  }
  assert.deepEqual(bad, [], `entries with duplicate language keys: ${JSON.stringify(bad)}`);
});

test('i18n: swapped pairs are gone (Bangla entry never mirrors the English one)', () => {
  const bad = [];
  for (const e of entries) {
    const en = fieldValue(e.raw, 'en');
    const bn = fieldValue(e.raw, 'bn');
    if (en == null || bn == null || !bn) continue;
    /* If the two values are identical and one is a translated pair, that is
     * the swap signature (identical English + Bangla). Placeholders such as
     * "—" or "SAMPLE" legitimately match in both languages. */
    if (en === bn && BENGALI.test(en)) bad.push({ key: e.key, value: en });
  }
  assert.deepEqual(bad, [], `entries with identical Bengali en/bn values: ${JSON.stringify(bad)}`);
});
