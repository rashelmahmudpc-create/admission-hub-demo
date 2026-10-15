// Preserve the no-credential-storage invariant while recognizing the two
// existing, non-secret OAuth boolean flags introduced by the Google redirect fix.
import {readFileSync,writeFileSync} from 'node:fs';
const file='native-auth-protection.test.mjs';
let source=readFileSync(file,'utf8');
const old=String.raw`  assert.doesNotMatch(client, /localStorage|sessionStorage|Authorization\s*:\s*['"\x60]Bearer/i);`.replace('\\x60',String.fromCharCode(96));
const line=source.split('\n').find(line=>line.includes('assert.doesNotMatch(client, /localStorage|sessionStorage|Authorization'));
if(!line){if(source.includes('Only fixed, non-secret OAuth flags'))process.exit(0);throw Error('Credential guard changed; review required');}
const replacement=String.raw`  // Only fixed, non-secret OAuth flags may use tab storage. All credentials
  // remain in server-managed HttpOnly cookies; no browser identity cache.
  assert.doesNotMatch(client, /localStorage|Authorization\s*:\s*['"BEARERTICK]Bearer/i);
  assert.match(client, /const OAUTH_REDIRECT_FLAG = 'ah-oauth-redirect'/);
  assert.match(client, /const DIRECT_GOOGLE_OFF = 'ah-google-direct-off'/);
  const storageCalls = [...client.matchAll(/sessionStorage\.(setItem|getItem|removeItem)\(([^)]*)\)/g)];
  assert.equal((client.match(/sessionStorage/g) || []).length, storageCalls.length,
    'all tab storage use must be an explicitly checked direct method call');
  assert.equal(storageCalls.length, 5, 'only the five existing OAuth boolean flag accesses are permitted');
  for (const [, method, args] of storageCalls) {
    const permitted = method === 'setItem'
      ? /^(?:OAUTH_REDIRECT_FLAG|DIRECT_GOOGLE_OFF),\s*'1'$/
      : /^(?:OAUTH_REDIRECT_FLAG|DIRECT_GOOGLE_OFF)$/;
    assert.match(args.trim(), permitted, 'tab storage must never hold a token, profile or session');
  }`.replace('BEARERTICK',String.fromCharCode(96));
source=source.replace(line,replacement);
writeFileSync(file,source);
console.log('Auth storage protection retains exact whitelist of existing non-secret boolean flags.');
