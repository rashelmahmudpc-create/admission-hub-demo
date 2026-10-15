from pathlib import Path
import json, re

wrangler = Path('wrangler.toml')
providers = Path('auth-native/verification/providers.mjs')
text = wrangler.read_text()
source = providers.read_text()
marker = '  // Compact public Logto settings share the existing orchestrator binding.'
if marker not in source:
    match = re.search(r"^VERIFICATION_ORCHESTRATOR_CONFIG = '(.*)'$", text, re.M)
    if not match:
        raise SystemExit('Missing orchestrator configuration; refusing to change deployment')
    config = json.loads(match.group(1))
    slot = next(row for row in config['providers'] if row['id'] == 'otp-h')
    names = {'LOGTO_ENDPOINT': 'endpoint', 'LOGTO_APP_ID': 'appId', 'LOGTO_REDIRECT_URI': 'redirectUri', 'OTP_H_DAILY_QUOTA': 'dailyQuota'}
    for name, field in names.items():
        row = re.search(r'^' + name + r' = "([^"\n]+)"$', text, re.M)
        if not row:
            raise SystemExit('Expected public configuration is absent; refusing partial migration')
        value = int(row.group(1)) if field == 'dailyQuota' else row.group(1)
        if field == 'dailyQuota' and value != slot['dailyQuota']:
            raise SystemExit('Quota mismatch; refusing to change provider capacity')
        slot[field] = value
        text = re.sub(r'^' + name + r' = "[^"\n]+"\n', '', text, flags=re.M)
    packed = json.dumps(config, separators=(',', ':'), ensure_ascii=False)
    text = re.sub(r"^VERIFICATION_ORCHESTRATOR_CONFIG = '.*'$", lambda _: "VERIFICATION_ORCHESTRATOR_CONFIG = '" + packed + "'", text, flags=re.M)
    start = 'export function createConfiguredVerificationProviders(env = {}, { fetchImpl = globalThis.fetch } = {}) {\n'
    assert source.count(start) == 1
    prelude = '''  // Compact public Logto settings share the existing orchestrator binding.
  // Explicit environment overrides still win; malformed config fails closed.
  let logtoSettings = {};
  try {
    const raw = env.VERIFICATION_ORCHESTRATOR_CONFIG;
    const config = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const row = Array.isArray(config?.providers) ? config.providers.find(item => item?.id === 'otp-h') : null;
    if (config?.enabled === true && row?.enabled === true) logtoSettings = row;
  } catch { /* no implicit provider activation */ }
'''
    source = source.replace(start, start + prelude)
    replacements = {
        'endpoint: env.LOGTO_ENDPOINT,': 'endpoint: env.LOGTO_ENDPOINT ?? logtoSettings.endpoint,',
        'appId: env.LOGTO_APP_ID,': 'appId: env.LOGTO_APP_ID ?? logtoSettings.appId,',
        'redirectUri: env.LOGTO_REDIRECT_URI,': 'redirectUri: env.LOGTO_REDIRECT_URI ?? logtoSettings.redirectUri,',
        'declaredDailyQuota: env.OTP_H_DAILY_QUOTA,': 'declaredDailyQuota: env.OTP_H_DAILY_QUOTA ?? logtoSettings.dailyQuota,'
    }
    for before, after in replacements.items():
        assert source.count(before) == 1, before
        source = source.replace(before, after)
    wrangler.write_text(text)
    providers.write_text(source)
    print('Compacted four public settings without deleting secrets or changing provider quotas')
else:
    print('Configuration already compacted')

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
