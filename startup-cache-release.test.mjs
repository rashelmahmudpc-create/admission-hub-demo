import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const build=readFileSync('scripts/build-welcome-pages.mjs','utf8');
test('deployed HTML and service worker use the same build identifier',()=>{
 assert.match(build,/const buildId=`welcome-\$\{release\}`/);
 assert.ok(build.includes("const expectedSwVersion = '${buildId}';"));
 assert.ok(build.includes("const cur = 'admission-hub-shell-${buildId}';"));
 assert.ok(build.includes("const BUILD_ID = '${buildId}';"));
 assert.ok(build.includes('Cache version contract missing'));
});
