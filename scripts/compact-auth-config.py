from pathlib import Path
import re

wrangler = Path('wrangler.toml').read_text()
providers = Path('auth-native/verification/providers.mjs')
source = providers.read_text()
# A concurrent repair already moved the four public values into code defaults.
# Validate and retain it instead of overwriting that repair.
assert not re.search(r'^(?:LOGTO_ENDPOINT|LOGTO_APP_ID|LOGTO_REDIRECT_URI|OTP_H_DAILY_QUOTA)\s*=', wrangler, re.M), 'Public bindings are not compacted'
assert 'LOGTO_PUBLIC_DEFAULTS' in source, 'Missing equivalent public defaults'
assert "endpoint: 'https://dl635v.logto.app'" in source
assert "appId: 'dk00yf3jvdmyy4mduoizp'" in source
assert "redirectUri: 'https://admissionsky.pages.dev/logto-callback'" in source
before = '    const rows = JSON.parse(text)?.providers;'
after = "    const config = JSON.parse(text);\n    if (config?.enabled !== true) return null;\n    const rows = config.providers;"
if before in source:
    assert source.count(before) == 1
    source = source.replace(before, after)
    providers.write_text(source)
else:
    assert 'if (config?.enabled !== true) return null;' in source
print('Equivalent compact configuration retained; explicit disabled state fails closed')

tests = Path('firebase-google-auth.test.mjs')
extra = r'''

test('Google session cookies return before optional profile enrichment completes', async () => {
  const authority = new AuthorityMock();
  const originalFetch = authority.fetch.bind(authority);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  authority.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (new URL(url).pathname === '/internal/profile/get-v2') await gate;
    return originalFetch(input, init);
  };
  const pending = [];
  const handler = createNativeAuthHandler({ fetchImpl: googleFetch() });
  let timer;
  try {
    const result = await Promise.race([
      handler(request(`${AUTH_API_PREFIX}/google`, { idToken: TOKEN('google-id') }), {
        AUTH_AUTHORITY: authority, FIREBASE_WEB_API_KEY: API_KEY, GOOGLE_AUTH_ACTIVATION: 'enabled'
      }, { waitUntil: promise => pending.push(promise) }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Login blocked by optional enrichment')), 1000); })
    ]);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('X-AH-Auth-Stage'), 'SESSION_CREATED');
    assert.match(result.headers.get('Set-Cookie') || '', /__Host-ah_session=/);
    assert.match(result.headers.get('Set-Cookie') || '', /__Host-ah_firebase=/);
    assert.equal((await result.json()).authenticated, true);
    assert.equal(pending.length, 1);
  } finally {
    clearTimeout(timer);
    release();
    await Promise.all(pending);
  }
});
'''
if 'Google session cookies return before optional profile enrichment completes' not in tests.read_text():
    tests.write_text(tests.read_text() + extra)
