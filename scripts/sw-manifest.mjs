/* Generates the ASSET_DIGESTS block in sw.js.
   Run after ANY asset that is listed in APP_SHELL changes:
       node scripts/sw-manifest.mjs
   The SW precache verifies each download's SHA-256 against this manifest,
   so a truncated/corrupt download can never poison the shell cache. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const swPath = join(root, 'sw.js');
const sw = readFileSync(swPath, 'utf8');

const startMark = '/* sw-manifest:start */';
const endMark = '/* sw-manifest:end */';
const i = sw.indexOf(startMark);
const j = sw.indexOf(endMark);
if (i < 0 || j < 0) throw new Error('sw-manifest markers missing in sw.js');

const shellBlock = sw.slice(sw.indexOf('const APP_SHELL'), sw.indexOf('];', sw.indexOf('const APP_SHELL')));
const assets = [...shellBlock.matchAll(/^\s*['"](\.\/[^'"]+)['"],?\s*$/gm)].map(m => m[1]);
if (!assets.length) throw new Error('no APP_SHELL assets parsed');

const lines = [];
for (const asset of assets) {
  const filePath = asset.split('?')[0];
  const abs = join(root, filePath.slice(2));
  if (!existsSync(abs)) throw new Error(`missing asset for digest: ${filePath}`);
  const hex = createHash('sha256').update(readFileSync(abs)).digest('hex');
  lines.push(`  ${JSON.stringify(asset)}: "${hex}",`);
}

const next = sw.slice(0, i + startMark.length) + '\n' + lines.join('\n') + '\n' + sw.slice(j);
writeFileSync(swPath, next);
console.log(`sw-manifest: ${assets.length} asset digests written to sw.js`);
