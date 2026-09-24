/* Notification Command Center (standalone page) — real backend wiring.
 *
 * The owner's v2 Command Center UI ships as a self-contained page
 * (notification-command-center.html). This test loads that exact file in jsdom
 * with a stubbed transport and asserts the data layer is the REAL Worker API:
 * admin auth is a live GET, send/schedule/cancel hit the real endpoints with the
 * documented payload, and no fake setTimeout "send" remains.
 *
 * It exercises real code paths in the page, not mocks of the page's own logic:
 * only `fetch` (the network boundary) is stubbed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync('notification-command-center.html', 'utf8');

function boot({ token } = {}) {
  const calls = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://admissionhub.pages.dev/notification-command-center.html',
    beforeParse(window) {
      if (token) window.sessionStorage.setItem('ahAdminTok', token);
      window.fetch = (url, init = {}) => {
        calls.push({ url: String(url), init });
        const path = String(url).replace(/^https?:\/\/[^/]+/, '');
        let body = { ok: true };
        if (path === '/api/notifications/history') {
          body = {
            ok: true,
            items: [{
              id: 'gn-abcdef123456', type: 'announcement', title: 'Live title', body: 'Live body',
              audience: 'all_students', topic: 'all', status: 'sent',
              scheduledAt: null, sentAt: Date.now() - 3600e3, reachEstimate: 120,
              delivered: 118, clicks: 9, error: null, createdAt: Date.now() - 7200e3
            }],
            analytics: { totals: { notifications: 1, sent: 1, failed: 0, delivered: 118, opened: 40, clicked: 9, invalidTokens: 0, ctr: 7, engagement: 33 } },
            reachEstimate: 5000, dailyCap: 10
          };
        } else if (path === '/api/notifications/global/send') {
          body = { ok: true, id: 'gn-newone00001', status: 'sent' };
        } else if (path === '/api/notifications/global/schedule') {
          body = { ok: true, id: 'gn-newone00002', status: 'scheduled' };
        } else if (path === '/api/notifications/global/cancel') {
          body = { ok: true, id: 'gn-abcdef123456', status: 'cancelled' };
        } else if (path === '/api/notifications/templates') {
          body = { ok: true, templates: [] };
        }
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve(body)
        });
      };
    }
  });
  return { dom, calls, window: dom.window };
}

const settle = () => new Promise(r => setTimeout(r, 30));
const postPaths = calls => calls.filter(c => c.init && c.init.method === 'POST')
  .map(c => c.url.replace(/^https?:\/\/[^/]+/, ''));

test('admin token verifies against the real history endpoint with a Bearer header', async () => {
  const { window, calls } = boot();
  await settle();

  window.document.getElementById('nsToken').value = 'real-admin-token-123';
  window.document.querySelector('[data-action="auth-verify"]').click();
  await settle();

  const hist = calls.find(c => c.url.includes('/api/notifications/history'));
  assert.ok(hist, 'history endpoint is called on verify');
  assert.equal(hist.init.method, 'GET');
  assert.equal(hist.init.headers.Authorization, 'Bearer real-admin-token-123');
  assert.equal(window.NotificationStudio.state.authenticated, true, 'gate opens only after a live 200');
});

test('a rejected token keeps the gate closed and clears the stored token', async () => {
  const { window, calls } = boot();
  await settle();
  window.fetch = (url, init = {}) => {
    calls.push({ url: String(url), init });
    return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: 'forbidden' }) });
  };
  window.document.getElementById('nsToken').value = 'wrong-token-999';
  window.document.querySelector('[data-action="auth-verify"]').click();
  await settle();
  assert.equal(window.NotificationStudio.state.authenticated, false);
  assert.equal(window.sessionStorage.getItem('ahAdminTok'), null, 'bad token is not retained');
});

test('an existing session token is re-verified on load (no gate shown again)', async () => {
  const { window, calls } = boot({ token: 'session-token-abc' });
  await settle();
  assert.ok(calls.some(c => c.url.includes('/api/notifications/history')), 'bootstrap fetch runs');
  assert.equal(window.NotificationStudio.state.authenticated, true);
});

test('live history hydrates sent + queue from real records', async () => {
  const { window } = boot({ token: 'session-token-abc' });
  await settle();
  const st = window.NotificationStudio.state;
  assert.equal(st.sent.length, 1, 'sent row comes from the API, not SAMPLE_DATA');
  assert.equal(st.sent[0].id, 'gn-abcdef123456');
  assert.equal(st.sent[0].title.bn, 'Live title');
  assert.equal(st.analytics.reach.estimated, 5000, 'reach estimate is the live device count');
});

test('sending posts the documented payload to global/send', async () => {
  const { window, calls } = boot({ token: 'session-token-abc' });
  await settle();
  const NS = window.NotificationStudio;
  NS.setState({ tab: 'compose', compose: {
    type: 'announcement', lang: 'bn', segmentId: 'all_students',
    bn: { title: 'হ্যালো', body: 'টেস্ট বডি' }, en: { title: '', body: '' },
    imageUrl: '', targetUrl: '', schedule: { mode: 'now' }
  } });
  NS.setState({ approval: 'approved' });
  const btn = window.document.querySelector('[data-action="send-final"]');
  assert.ok(btn, 'send button renders once approved');
  btn.click();
  await settle();

  const path = postPaths(calls).find(p => p.endsWith('/global/send'));
  assert.ok(path, 'send endpoint is hit');
  const send = calls.find(c => c.url.endsWith('/global/send'));
  const payload = JSON.parse(send.init.body);
  assert.equal(payload.type, 'announcement');
  assert.equal(payload.title, 'হ্যালো');
  assert.equal(payload.body, 'টেস্ট বডি');
  assert.equal(payload.audience, 'all_students');
  assert.equal(send.init.headers.Authorization, 'Bearer session-token-abc');
});

test('a future schedule posts scheduledAt epoch ms to global/schedule', async () => {
  const { window, calls } = boot({ token: 'session-token-abc' });
  await settle();
  const NS = window.NotificationStudio;
  const when = new Date(Date.now() + 3600e3);
  NS.setState({ tab: 'compose', compose: {
    type: 'announcement', lang: 'bn', segmentId: 'all_students',
    bn: { title: 'শিডিউল', body: 'পরে যাবে' }, en: { title: '', body: '' },
    imageUrl: '', targetUrl: '', schedule: { mode: 'later', when }
  } });
  NS.setState({ approval: 'approved' });
  const btn = window.document.querySelector('[data-action="send-final"]');
  assert.ok(btn, 'send button renders once approved');
  btn.click();
  await settle();

  const send = calls.find(c => c.url.endsWith('/global/schedule'));
  assert.ok(send, 'schedule endpoint is hit');
  assert.equal(JSON.parse(send.init.body).scheduledAt, when.getTime());
});

test('source no longer contains a fake setTimeout send path', () => {
  const js = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.match(js, /NS\.api\.post\(path,body\)/, 'real POST transport is wired');
  assert.match(js, /NS\.api\.get\('\/api\/notifications\/history'\)/, 'real history read is wired');
  assert.match(js, /\/api\/notifications\/global\/send/, 'real send endpoint referenced');
  assert.match(js, /\/api\/notifications\/global\/schedule/, 'real schedule endpoint referenced');
  assert.match(js, /\/api\/notifications\/global\/cancel/, 'real cancel endpoint referenced');
  assert.doesNotMatch(js, /state\.sent\.unshift\(newRow\)/, 'demo send-into-state removed');
  assert.doesNotMatch(js, /Recorded send approval and started delivery \(SAMPLE\)/, 'demo audit copy removed');
  assert.match(js, /scheduled_ok|sent_ok/, 'real result toasts are used');
});
