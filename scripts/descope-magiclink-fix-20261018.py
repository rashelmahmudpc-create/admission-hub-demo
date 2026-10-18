def rep(p,a,b):
    s=open(p).read()
    if b in s and a not in s: return
    assert s.count(a)==1,(p,a[:60],s.count(a)); open(p,'w').write(s.replace(a,b))
A='account-access.js'
rep(A,"  const MAGIC_KEY = 'ah-magic-attempt-v1';\n","""  // The attemptId rides in a 10-minute first-party cookie (no Web Storage); it is
  // useless without the HttpOnly verification ticket the Worker already holds.
  const MAGIC_COOKIE = 'ah_magic_v1';
  const MAGIC_ATTEMPT = /^[A-Za-z0-9_-]{24,96}$/;
  const writeMagicAttempt = attemptId => {
    const ok = MAGIC_ATTEMPT.test(String(attemptId || ''));
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${MAGIC_COOKIE}=${ok ? attemptId : ''}; Path=/; Max-Age=${ok ? 600 : 0}; SameSite=Lax${secure}`;
  };
  const readMagicAttempt = () => {
    const row = String(document.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${MAGIC_COOKIE}=`));
    const attemptId = row ? row.slice(row.indexOf('=') + 1) : '';
    return MAGIC_ATTEMPT.test(attemptId) ? { attemptId } : null;
  };
""")
rep(A,"      try { localStorage.setItem(MAGIC_KEY, JSON.stringify({ attemptId: result.ownership.attemptId, exp: Date.now() + 10 * 60 * 1000 })); } catch (_) {}\n","      writeMagicAttempt(result.ownership.attemptId);\n")
rep(A,"    let saved = null;\n    try { saved = JSON.parse(localStorage.getItem(MAGIC_KEY) || 'null'); } catch (_) {}\n    try { localStorage.removeItem(MAGIC_KEY); } catch (_) {}\n","    const saved = readMagicAttempt();\n    writeMagicAttempt('');\n")
rep(A,"    if (!saved?.attemptId || Number(saved.exp || 0) < Date.now()) {","    if (!saved?.attemptId) {")
T='code-native-welcome-v1.test.mjs'
rep(T,"""  assert.equal((methods.match(/<button class="ah-method-card/g) || []).length, 5);""","""  assert.equal((methods.match(/<button class="ah-method-card/g) || []).length, 6);""")
rep(T,"""    'email-ownership-start', 'telegram-verification-start', 'whatsapp-info', 'email-verification-start'\n""","""    'email-ownership-start', 'email-magiclink-start', 'telegram-verification-start', 'whatsapp-info', 'email-verification-start'\n""")
N='native-auth-protection.test.mjs'
rep(N,"""  assert.equal((client.match(/document\\.cookie\\s*=/g) || []).length, 2);\n""","""  // +1: the non-secret magic-link attemptId (10 min, useless without the HttpOnly ticket).
  assert.match(client, /MAGIC_COOKIE = 'ah_magic_v1'/);
  assert.equal((client.match(/document\\.cookie\\s*=/g) || []).length, 3);\n""")
