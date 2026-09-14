import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { JSDOM } from 'jsdom';
import { SqliteAuthRepository } from './auth-native/storage/sqlite-auth-repository.mjs';
import { CloudflareNativeAuthEngine, SESSION_TTL_MS, REMEMBER_OFF_TTL_MS } from './auth-native/core/auth-engine.mjs';
import { AUTH_ERROR_CODES } from './auth-native/core/errors.mjs';
import { MemoryAuthRepository } from './auth-native/testing/memory-auth-repository.mjs';

const SECRET = 'session-recovery-chaos-secret-0123456789-ABCDEFGHIJKLMNOP';
const DAY = 24 * 60 * 60 * 1000;

// ============================== server (engine + sqlite) ==============================

function makeEngine() {
  let now = 1_800_000_000_000;
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  const sql = {
    exec(statement, ...bindings) {
      const prepared = database.prepare(statement);
      if (prepared.reader) return prepared.all(...bindings);
      prepared.run(...bindings);
      return [];
    }
  };
  const repository = new SqliteAuthRepository({ sql, transactionSync(work) { return database.transaction(work)(); } });
  repository.migrate();
  const engine = new CloudflareNativeAuthEngine({ repository, hmacSecret: SECRET, now: () => now });
  const context = { ip: '203.0.113.9', deviceId: 'device-chaos-0123456789ab', userAgent: 'Mozilla/5.0 Chrome/140' };
  return {
    database,
    repository,
    engine,
    context,
    now: () => now,
    advance: ms => { now += ms; }
  };
}

test('chaos: expired session forces re-login, identity stays intact', async () => {
  const { engine, context, advance } = makeEngine();
  const identity = { email: 'chaos@example.com', subject: 'sub-chaos-1' };
  const established = await engine.establishFirebaseSession(identity, context);
  advance(SESSION_TTL_MS + 60 * 1000);
  await assert.rejects(() => engine.getFirebaseSession(established.sessionToken, identity), error => error?.code === AUTH_ERROR_CODES.SESSION_INVALID);
  const relogin = await engine.establishFirebaseSession(identity, context);
  assert.equal(relogin.created, false, 're-login must reuse the existing identity');
  assert.notEqual(relogin.sessionToken, established.sessionToken);
  await assert.doesNotReject(() => engine.getFirebaseSession(relogin.sessionToken, identity));
});

test('chaos: logout-all revokes every device, each re-login works, identity intact', async () => {
  const { engine, repository, context, advance, database } = makeEngine();
  const a = await engine.establishFirebaseSession({ email: 'chaos@example.com', subject: 'sub-chaos-2' }, context);
  advance(1000);
  const b = await engine.establishFirebaseSession({ email: 'chaos@example.com', subject: 'sub-chaos-2' }, { ...context, deviceId: 'device-other-012345678901ab' });
  const revoked = await repository.revokeUserSessions({ userId: a.user.id, now: engine.now() });
  assert.ok(revoked.revoked >= 2);
  for (const token of [a.sessionToken, b.sessionToken]) {
    await assert.rejects(() => engine.getFirebaseSession(token, { email: 'chaos@example.com', subject: 'sub-chaos-2' }), error => error?.code === AUTH_ERROR_CODES.SESSION_INVALID);
  }
  const again = await engine.establishFirebaseSession({ email: 'chaos@example.com', subject: 'sub-chaos-2' }, context);
  assert.equal(again.created, false);
  const users = database.prepare('SELECT user_id, status FROM auth_users').all();
  assert.equal(users.length, 1);
  assert.equal(users[0].status, 'active');
});

test('chaos: suspended account loses its session (401), identity never destroyed', async () => {
  const { engine, context, database, repository } = makeEngine();
  const identity = { email: 'chaos@example.com', subject: 'sub-chaos-3' };
  const established = await engine.establishFirebaseSession(identity, context);
  const userId = database.prepare('SELECT user_id FROM auth_users').get().user_id;
  const suspended = await repository.setAccountState({ userId, toStatus: 'suspended', now: engine.now() });
  assert.equal(suspended.revokedSessions, 1, 'suspending revokes the live session');
  // the device holding the old session gets a 401-class error, not a crash
  await assert.rejects(() => engine.getFirebaseSession(established.sessionToken, identity), error => error?.code === AUTH_ERROR_CODES.SESSION_INVALID);
  // identity rows are intact: user exists, account state remembers the suspension
  const users = database.prepare('SELECT user_id, status FROM auth_users').all();
  assert.equal(users.length, 1);
  assert.equal(users[0].user_id, userId);
  const accountState = database.prepare('SELECT status FROM auth_account_state WHERE user_id=?').get(userId);
  assert.equal(accountState.status, 'suspended');
});

test('chaos: non-active user row blocks both session use and re-login with 403-class code', async () => {
  const { engine, context, database } = makeEngine();
  const identity = { email: 'chaos-2@example.com', subject: 'sub-chaos-5' };
  const established = await engine.establishFirebaseSession(identity, context);
  const row = database.prepare('SELECT user_id FROM auth_users').all().at(-1);
  database.prepare("UPDATE auth_users SET status='suspended' WHERE user_id=?").run(row.user_id);
  // existing session becomes unusable even though the session row is still open
  await assert.rejects(() => engine.getFirebaseSession(established.sessionToken, identity), error => error?.code === AUTH_ERROR_CODES.ACCOUNT_DISABLED);
  // re-login is blocked too
  await assert.rejects(() => engine.establishFirebaseSession(identity, context), error => error?.code === AUTH_ERROR_CODES.ACCOUNT_DISABLED);
});

test('chaos: 10 parallel session reads on one session all succeed, no corruption', async () => {
  const { engine, context, database } = makeEngine();
  const established = await engine.establishFirebaseSession({ email: 'chaos@example.com', subject: 'sub-chaos-4' }, context);
  const results = await Promise.all(Array.from({ length: 10 }, () => engine.getFirebaseSession(established.sessionToken, { email: 'chaos@example.com', subject: 'sub-chaos-4' })));
  assert.equal(results.length, 10);
  for (const result of results) assert.equal(result.user.status, 'active');
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE revoked_at IS NULL').get().n, 1);
});

test('chaos: remember-me off shortens the session to 7 days, on keeps 30 days', async () => {
  const now = 1_800_000_000_000;
  const engine = new CloudflareNativeAuthEngine({ repository: new MemoryAuthRepository(), hmacSecret: SECRET, now: () => now });
  const context = { ip: '203.0.113.9', deviceId: 'device-chaos-0123456789ab', userAgent: 'Mozilla/5.0 Chrome/140' };
  const remembered = await engine.establishFirebaseSession({ email: 'remember@example.com', subject: 'sub-remember' }, context);
  assert.equal(remembered.sessionExpiresAt, now + SESSION_TTL_MS);
  const notRemembered = await engine.establishFirebaseSession({ email: 'remember@example.com', subject: 'sub-remember', remember: false }, context);
  assert.equal(notRemembered.sessionExpiresAt, now + REMEMBER_OFF_TTL_MS);
  assert.equal(remembered.sessionExpiresAt - notRemembered.sessionExpiresAt, 23 * DAY);
});

// ============================== client (JSDOM, account-access.js) ==============================

const UI_SCRIPT = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');
const uiReply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  async json() { return body; }
});
const uiSleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function uiWait(predicate, timeout = 3000, label = 'UI state') {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (predicate()) return;
    await uiSleep(10);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}
const SIGNED = { authenticated: true, emailVerified: true, user: { id: 'usr-chaos', emailMasked: 'u***@example.com' } };
const SESSION_INVALID = { error: { code: 'SESSION_INVALID', message: 'no session' } };

// In-process BroadcastChannel polyfill shared across JSDOM "tabs" of one origin.
// Mirrors the real cross-tab semantics: a message reaches every other open
// channel of the same name; closed windows stop receiving.
const BC_CHANNELS = new Map();
class TestBroadcastChannel {
  constructor(name, win) {
    this.name = name;
    this.onmessage = null;
    this._win = win;
    if (!BC_CHANNELS.has(name)) BC_CHANNELS.set(name, new Set());
    this._peers = BC_CHANNELS.get(name);
    this._peers.add(this);
  }
  postMessage(data) {
    for (const peer of [...this._peers]) {
      if (peer === this) continue;
      // jsdom: a torn-down window's document becomes undefined; prune it.
      if (!peer._win?.document) { this._peers.delete(peer); continue; }
      try { peer.onmessage?.({ data: { ...data } }); } catch (_) {}
    }
  }
  close() { this._peers.delete(this); }
}

function setupClient({ pageUrl = 'https://admissionhub.pages.dev/', route } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: pageUrl, runScripts: 'dangerously', pretendToBeVisual: true });
  // Per-window subclass so each channel records its own window for teardown pruning.
  dom.window.BroadcastChannel = class extends TestBroadcastChannel {
    constructor(name) { super(name, dom.window); }
  };
  const calls = [];
  dom.window.fetch = async (url, options = {}) => {
    const path = String(url);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method || 'GET', body });
    if (path.includes('/config')) return uiReply(200, {
      auth: {
        available: true,
        methods: {
          google: { available: false },
          passkey: { available: false },
          telegramVerification: { available: false },
          backup: { available: false },
          emailPassword: { available: true }
        },
        verificationEmail: { resendCooldownSeconds: 60 }
      }
    });
    if (route) {
      const result = await route(path, { method: options.method || 'GET', body }, calls);
      if (result !== undefined) return result;
    }
    return uiReply(404, { error: { message: 'not found' } });
  };
  dom.window.eval(UI_SCRIPT);
  return {
    dom,
    window: dom.window,
    document: dom.window.document,
    calls,
    sessionState: () => dom.window.document.querySelector('.ah-account-page')?.dataset.sessionState,
    count: (pathPart, method) => calls.filter(call => call.path.includes(pathPart) && (method ? call.method === method : true)).length,
    close() { dom.window.close(); }
  };
}

function loginForm(app, { email = 'chaos@example.com', password = 'safe-password-123', remember = true } = {}) {
  const document = app.document;
  const loginView = document.querySelector('[data-view="login"]');
  if (loginView.hidden) {
    const welcomeLogin = document.querySelector('[data-role="welcome-login"]');
    if (welcomeLogin && !welcomeLogin.hidden) welcomeLogin.click();
  }
  document.querySelector('#ah-login-email').value = email;
  document.querySelector('#ah-login-password').value = password;
  document.querySelector('#ah-login-remember').checked = remember;
  document.querySelector('[data-view="login"]').dispatchEvent(new app.window.Event('submit', { cancelable: true, bubbles: true }));
}

test('chaos-ui: bootstrap with a valid session reaches AUTHENTICATED', async () => {
  const app = setupClient({
    route: (path, { method }) => {
      if (path.includes('/session') && !path.includes('/session/') && method === 'GET') return uiReply(200, SIGNED);
    }
  });
  await uiWait(() => app.sessionState() === 'AUTHENTICATED', 3000, 'AUTHENTICATED bootstrap');
  assert.equal(app.count('/session', 'GET'), 1);
  app.close();
});

test('chaos-ui: 10 concurrent refreshes share exactly one /session call', async () => {
  let sessionRequests = 0;
  const app = setupClient({
    route: (path, { method }) => {
      if (path.includes('/session') && !path.includes('/session/') && method === 'GET') {
        sessionRequests += 1;
        return new Promise(resolve => setTimeout(() => resolve(uiReply(200, SIGNED)), 60));
      }
    }
  });
  await uiWait(() => app.sessionState() === 'AUTHENTICATED', 3000, 'AUTHENTICATED bootstrap');
  const bootstrapCalls = app.count('/session', 'GET');
  await Promise.all(Array.from({ length: 10 }, () => app.window.AdmissionAccount.refresh()));
  await uiWait(() => sessionRequests === bootstrapCalls + 1, 3000, 'single-flight refresh');
  assert.equal(app.count('/session', 'GET'), bootstrapCalls + 1);
  assert.equal(app.sessionState(), 'AUTHENTICATED');
  app.close();
});

test('chaos-ui: network failure keeps the signed session and stays bounded', async () => {
  let sessionAttempts = 0;
  const app = setupClient({
    route: (path, { method }) => {
      if (path.includes('/session') && !path.includes('/session/') && method === 'GET') {
        sessionAttempts += 1;
        if (sessionAttempts === 1) return uiReply(200, SIGNED);
        return Promise.reject(Object.assign(new Error('offline'), { status: 0 }));
      }
    }
  });
  await uiWait(() => app.sessionState() === 'AUTHENTICATED', 3000, 'AUTHENTICATED bootstrap');
  const before = app.window.AdmissionAccount.getSession();
  assert.ok(before);
  await app.window.AdmissionAccount.refresh();
  assert.equal(app.window.AdmissionAccount.getSession(), before, 'offline refresh must keep the session');
  assert.equal(app.sessionState(), 'AUTHENTICATED', 'offline refresh must not log out');
  assert.equal(app.count('/session', 'GET'), 4, 'bootstrap + 1 attempt + 2 bounded retries, no loop');
  app.close();
});

test('chaos-ui: terminal 401 refresh is bounded and lands on the login view', async () => {
  let sessionAttempts = 0;
  const app = setupClient({
    route: (path, { method }) => {
      if (path.includes('/session') && !path.includes('/session/') && method === 'GET') {
        sessionAttempts += 1;
        return sessionAttempts === 1 ? uiReply(200, SIGNED) : uiReply(401, SESSION_INVALID);
      }
    }
  });
  await uiWait(() => app.sessionState() === 'AUTHENTICATED', 3000, 'AUTHENTICATED bootstrap');
  await app.window.AdmissionAccount.refresh();
  assert.equal(app.sessionState(), 'UNAUTHENTICATED');
  assert.equal(app.document.querySelector('[data-view="login"]').hidden, false, 'login view must be shown');
  assert.equal(app.count('/session', 'GET'), 2, 'no retry loop on terminal 401');
  const beforeSecond = app.count('/session', 'GET');
  await app.window.AdmissionAccount.refresh();
  assert.equal(app.count('/session', 'GET'), beforeSecond + 1, 'second refresh still bounded to one call');
  assert.equal(app.window.AdmissionAccount.getSession(), null);
  app.close();
});

test('chaos-ui: stale 401 on a protected route triggers one refresh, then the request retries', async () => {
  let logoutAllAttempts = 0;
  let sessionAttempts = 0;
  const app = setupClient({
    route: (path, { method, body }) => {
      if (path.includes('/session') && !path.includes('/session/') && method === 'GET') {
        sessionAttempts += 1;
        return uiReply(200, SIGNED);
      }
      if (path.endsWith('/session/logout-all') && method === 'POST') {
        logoutAllAttempts += 1;
        return logoutAllAttempts === 1
          ? uiReply(401, SESSION_INVALID)
          : uiReply(200, { ok: true, authenticated: false, revoked: 1 });
      }
    }
  });
  await uiWait(() => app.sessionState() === 'AUTHENTICATED', 3000, 'AUTHENTICATED bootstrap');
  const button = app.document.querySelector('[data-role="logout-all"]');
  button.click();
  await uiWait(() => button.dataset.armed === '1', 1000, 'logout-all armed');
  button.click();
  await uiWait(() => app.sessionState() === 'UNAUTHENTICATED', 3000, 'recovered logout-all complete');
  assert.equal(logoutAllAttempts, 2, 'original request retried exactly once');
  assert.equal(sessionAttempts, 2, 'exactly one recovery refresh (bootstrap + recovery)');
  assert.equal(app.document.querySelector('[data-view="login"]').hidden, false);
  app.close();
});

test('chaos-ui: logout-all success clears the session and reports revoked count', async () => {
  const app = setupClient({
    route: (path, { method }) => {
      if (path.includes('/session') && !path.includes('/session/') && method === 'GET') return uiReply(200, SIGNED);
      if (path.endsWith('/session/logout-all') && method === 'POST') return uiReply(200, { ok: true, authenticated: false, revoked: 3 });
    }
  });
  await uiWait(() => app.sessionState() === 'AUTHENTICATED', 3000, 'AUTHENTICATED bootstrap');
  const button = app.document.querySelector('[data-role="logout-all"]');
  button.click();
  await uiWait(() => button.dataset.armed === '1', 1000, 'logout-all armed');
  button.click();
  await uiWait(() => app.sessionState() === 'UNAUTHENTICATED', 3000, 'logout-all complete');
  assert.equal(app.count('/session/logout-all', 'POST'), 1);
  assert.equal(app.window.AdmissionAccount.getSession(), null);
  assert.equal(app.document.querySelector('[data-view="login"]').hidden, false);
  app.close();
});

test('chaos-ui: logout in one tab signs out the other tab (BroadcastChannel)', async () => {
  const alpha = setupClient({
    route: (path, { method }) => {
      if (path.includes('/session') && !path.includes('/session/') && method === 'GET') return uiReply(200, SIGNED);
      if (path.endsWith('/session/logout') && method === 'POST') return uiReply(200, { ok: true, authenticated: false });
    }
  });
  const beta = setupClient({
    route: (path, { method }) => {
      if (path.includes('/session') && !path.includes('/session/') && method === 'GET') return uiReply(200, SIGNED);
    }
  });
  await uiWait(() => alpha.sessionState() === 'AUTHENTICATED', 3000, 'alpha bootstrap');
  await uiWait(() => beta.sessionState() === 'AUTHENTICATED', 3000, 'beta bootstrap');
  const betaBefore = beta.window.AdmissionAccount.getSession();
  assert.ok(betaBefore);
  // alpha logs out through the real UI; beta must follow automatically
  alpha.document.querySelector('[data-role="logout"]').click();
  await uiWait(() => alpha.sessionState() === 'UNAUTHENTICATED', 3000, 'alpha logged out');
  await uiWait(() => beta.sessionState() === 'UNAUTHENTICATED', 3000, 'beta signed out by other tab');
  assert.equal(beta.window.AdmissionAccount.getSession(), null);
  assert.equal(beta.document.querySelector('[data-view="login"]').hidden, false);
  await uiSleep(80);
  alpha.close();
  beta.close();
});

test('chaos-ui: login in one tab refreshes the unsigned other tab', async () => {
  const alpha = setupClient({
    route: (path, { method }) => {
      if (path.includes('/session') && !path.includes('/session/') && method === 'GET') return uiReply(401, SESSION_INVALID);
      if (path.endsWith('/login') && method === 'POST') return uiReply(200, SIGNED);
    }
  });
  await uiWait(() => alpha.sessionState() === 'UNAUTHENTICATED', 3000, 'alpha unsigned bootstrap');
  // beta starts signed, logs out, then logs back in; alpha must pick it up
  const beta = setupClient({
    route: (path, { method }) => {
      if (path.includes('/session') && !path.includes('/session/') && method === 'GET') return uiReply(200, SIGNED);
      if (path.endsWith('/session/logout') && method === 'POST') return uiReply(200, { ok: true, authenticated: false });
      if (path.endsWith('/login') && method === 'POST') return uiReply(200, SIGNED);
    }
  });
  await uiWait(() => beta.sessionState() === 'AUTHENTICATED', 3000, 'beta bootstrap');
  const before = alpha.count('/session', 'GET'); // only alpha's own bootstrap so far
  beta.document.querySelector('[data-role="logout"]').click();
  await uiWait(() => beta.sessionState() === 'UNAUTHENTICATED', 3000, 'beta logged out');
  loginForm(beta);
  await uiWait(() => beta.sessionState() === 'AUTHENTICATED', 3000, 'beta logged back in');
  // alpha was unsigned; the login broadcast must make it re-check the server
  // (alpha's /session mock returns 401, so it stays unsigned but must have attempted)
  await uiSleep(150);
  assert.ok(alpha.count('/session', 'GET') > before, 'alpha re-checked the session after other tab login');
  assert.equal(alpha.sessionState(), 'UNAUTHENTICATED', 'alpha cannot become signed while the server says 401');
  await uiSleep(80);
  alpha.close();
  beta.close();
});

test('chaos-ui: deep-link anchor is remembered while logged out and restored after re-login', async () => {
  const app = setupClient({
    pageUrl: 'https://admissionhub.pages.dev/#dashboard-exam',
    route: (path, { method, body }) => {
      if (path.includes('/session') && !path.includes('/session/') && method === 'GET') {
        return app.window.AdmissionAccount.getSession() ? uiReply(200, SIGNED) : uiReply(401, SESSION_INVALID);
      }
      if (path.endsWith('/login') && method === 'POST') return uiReply(200, SIGNED);
    }
  });
  await uiWait(() => app.sessionState() === 'UNAUTHENTICATED', 3000, 'unsigned bootstrap');
  assert.equal(app.window.location.hash, '#dashboard-exam');
  app.window.history.replaceState(null, '', 'https://admissionhub.pages.dev/');
  assert.equal(app.window.location.hash, '');
  loginForm(app);
  await uiWait(() => app.sessionState() === 'AUTHENTICATED', 3000, 'login');
  await uiWait(() => app.window.location.hash === '#dashboard-exam', 3000, 'deep-link restore');
  const page = app.document.querySelector('#ah-account-page');
  assert.equal(page.hidden, true, 'account page closed after restoring the destination');
  app.close();
});

test('chaos-ui: remember-me checkbox is passed through to the login request', async () => {
  let lastLoginBody = null;
  const app = setupClient({
    route: (path, { method, body }) => {
      if (path.includes('/session') && !path.includes('/session/') && method === 'GET') return uiReply(401, SESSION_INVALID);
      if (path.endsWith('/login') && method === 'POST') {
        lastLoginBody = body;
        return uiReply(200, SIGNED);
      }
    }
  });
  await uiWait(() => app.sessionState() === 'UNAUTHENTICATED', 3000, 'unsigned bootstrap');
  loginForm(app, { remember: true });
  await uiWait(() => lastLoginBody, 3000, 'login request (remember on)');
  assert.equal(lastLoginBody.remember, true);
  app.close();

  let lastBody = null;
  const app2 = setupClient({
    route: (path, { method, body }) => {
      if (path.includes('/session') && !path.includes('/session/') && method === 'GET') return uiReply(401, SESSION_INVALID);
      if (path.endsWith('/login') && method === 'POST') {
        lastBody = body;
        return uiReply(200, SIGNED);
      }
    }
  });
  await uiWait(() => app2.sessionState() === 'UNAUTHENTICATED', 3000, 'unsigned bootstrap 2');
  loginForm(app2, { remember: false });
  await uiWait(() => lastBody, 3000, 'login request (remember off)');
  assert.equal(lastBody.remember, false);
  await uiWait(() => app2.sessionState() === 'AUTHENTICATED', 3000, 'app2 authenticated after login');
  app2.close();
});
