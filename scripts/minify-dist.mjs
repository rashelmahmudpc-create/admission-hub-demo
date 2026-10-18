#!/usr/bin/env node
/* Minify the publishable bundle in dist/ — run AFTER dist/ is built and BEFORE
   `wrangler pages deploy dist`. Source files in the repo are never touched, so
   code stays readable and every *.test.mjs keeps reading the original files.

   Safety rules (do not loosen without a browser pass):
   - Only .js / .mjs / .css inside dist/ are rewritten. HTML is left as-is
     (CI greps dist/index.html for SEO/meta strings).
   - No output format is set, so esbuild does NOT rename top-level names —
     classic <script> files that share globals keep working.
   - keepNames is deliberately OFF: in transform mode it injects a helper
     (`var o=(e,t)=>a(e,"name",...)`) at the TOP of every file, and in a classic
     <script> those minified helper names become shared globals that clobber
     each other across files (seen live: experience-studio-hooks.js threw
     "Property description must be an object"). No shipped code reads fn.name.
   - charset=utf8 keeps Bangla text as real characters (no \uXXXX bloat).
   - Guard: a minified file must not introduce a new top-level `var`/`let`/
     `const`/`function`/`class` name, or drop one (checked with acorn, classic
     scripts only); if it would, the original file is kept.
   - sw.js and firebase-messaging-sw.js are skipped (sw.js carries the
     sw-manifest markers). After minifying, the ASSET_DIGESTS block in
     dist/sw.js is regenerated from the minified files, so the SW precache
     SHA-256 check still matches exactly what is served.
   - A file that fails to parse, or would not get smaller, is kept unchanged.

   Usage: node scripts/minify-dist.mjs [distDir]   (default: dist) */
import { transform } from 'esbuild';
import { parse } from 'acorn';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';

const dist = process.argv[2] || 'dist';
if (!existsSync(join(dist, 'index.html'))) throw new Error(`${dist}/index.html missing — build dist first`);

const SKIP = new Set(['sw.js', 'firebase-messaging-sw.js']);
const LOADER = { '.js': 'js', '.mjs': 'js', '.css': 'css' };

/* Top-level names a CLASSIC script puts on the global object. ES modules
   (import/export) have their own scope, so renaming inside them is safe and
   they are not checked. Parsed with acorn, not a regex. */
const topLevelNames = code => {
  const names = new Set();
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
  const addPattern = p => {
    if (!p) return;
    if (p.type === 'Identifier') names.add(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach(q => addPattern(q.value || q.argument));
    else if (p.type === 'ArrayPattern') p.elements.forEach(addPattern);
    else if (p.type === 'AssignmentPattern') addPattern(p.left);
    else if (p.type === 'RestElement') addPattern(p.argument);
  };
  for (const node of ast.body) {
    if (node.type === 'VariableDeclaration') node.declarations.forEach(d => addPattern(d.id));
    else if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) names.add(node.id.name);
  }
  return names;
};
const isModule = code => {
  try { parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true }); return false; }
  catch { parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }); return true; }
};
const newTopLevelNames = (before, after) => {
  if (isModule(before)) return [];
  const a = topLevelNames(before);
  const b = topLevelNames(after);
  return [...new Set([...a, ...b])].filter(n => a.has(n) !== b.has(n));
};

const files = [];
const walk = dir => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p); continue; }
    if (LOADER[extname(name)] && !SKIP.has(basename(name))) files.push(p);
  }
};
walk(dist);

let before = 0, after = 0, changed = 0;
const kept = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  before += Buffer.byteLength(src);
  try {
    const { code } = await transform(src, {
      loader: LOADER[extname(file)],
      minify: true,
      charset: 'utf8',
      legalComments: 'inline',
      sourcefile: relative(dist, file),
    });
    const drift = LOADER[extname(file)] === 'js' ? newTopLevelNames(src, code) : [];
    if (drift.length) {
      kept.push(`${relative(dist, file)} (global names would change: ${drift.slice(0, 8).join(', ')})`);
    } else if (Buffer.byteLength(code) < Buffer.byteLength(src)) {
      writeFileSync(file, code);
      after += Buffer.byteLength(code);
      changed += 1;
      continue;
    }
  } catch (error) {
    kept.push(`${relative(dist, file)} (${String(error.message).split('\n')[0]})`);
  }
  after += Buffer.byteLength(src);
}

/* Regenerate the SW precache digests from the files actually being served. */
const swPath = join(dist, 'sw.js');
if (existsSync(swPath)) {
  const sw = readFileSync(swPath, 'utf8');
  const startMark = '/* sw-manifest:start */';
  const endMark = '/* sw-manifest:end */';
  const i = sw.indexOf(startMark), j = sw.indexOf(endMark);
  if (i < 0 || j < 0) throw new Error('sw-manifest markers missing in dist/sw.js');
  const shellStart = sw.indexOf('const APP_SHELL');
  const shellBlock = sw.slice(shellStart, sw.indexOf('];', shellStart));
  const assets = [...shellBlock.matchAll(/^\s*['"](\.\/[^'"]+)['"],?\s*$/gm)].map(m => m[1]);
  const lines = assets.map(asset => {
    const abs = join(dist, asset.split('?')[0].slice(2));
    if (!existsSync(abs)) throw new Error(`missing asset for digest: ${asset}`);
    return `  ${JSON.stringify(asset)}: "${createHash('sha256').update(readFileSync(abs)).digest('hex')}",`;
  });
  writeFileSync(swPath, sw.slice(0, i + startMark.length) + '\n' + lines.join('\n') + '\n' + sw.slice(j));
  console.log(`minify-dist: ${assets.length} SW digests regenerated`);
}

const kb = n => (n / 1024).toFixed(0) + ' KB';
console.log(`minify-dist: ${changed}/${files.length} files minified, ${kb(before)} -> ${kb(after)} (${(100 - after / before * 100).toFixed(1)}% smaller)`);
if (kept.length) console.log('minify-dist: kept unchanged:\n  ' + kept.join('\n  '));
