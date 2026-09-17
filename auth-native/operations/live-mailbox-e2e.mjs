import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const MAILBOX_API = 'https://api.mail.tm';
const FIREBASE_API = 'https://identitytoolkit.googleapis.com/v1';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const random = length => randomBytes(length).toString('hex');

class LiveCheckError extends Error {
  constructor(stage, status = 0, code = 'CHECK_FAILED') {
    super(code);
    this.stage = stage;
    this.status = status;
    this.code = code;
  }
}

async function jsonRequest(url, options = {}, stage = 'request') {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeoutMs || 20_000) });
  } catch { throw new LiveCheckError(stage, 0, 'NETWORK'); }
  let body = {};
  try { body = await response.json(); } catch {}
  return { response, body };
}

const members = body => Array.isArray(body) ? body : Array.isArray(body?.['hydra:member']) ? body['hydra:member'] : [];

async function createMailbox() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const domains = await jsonRequest(`${MAILBOX_API}/domains?page=1`, { headers: { Accept: 'application/json' } }, 'mailbox-domain');
    if (!domains.response.ok) throw new LiveCheckError('mailbox-domain', domains.response.status, 'MAILBOX_DOMAIN');
    const domain = members(domains.body).find(item => item?.isActive !== false)?.domain;
    if (!domain) throw new LiveCheckError('mailbox-domain', 0, 'NO_DOMAIN');
    const address = `ah-${random(8)}@${domain}`;
    const password = `${random(20)}A!7`;
    const account = await jsonRequest(`${MAILBOX_API}/accounts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, password })
    }, 'mailbox-account');
    if (!account.response.ok) { await sleep(1200); continue; }
    const auth = await jsonRequest(`${MAILBOX_API}/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, password })
    }, 'mailbox-token');
    if (!auth.response.ok || !auth.body?.token || !account.body?.id) throw new LiveCheckError('mailbox-token', auth.response.status, 'MAILBOX_TOKEN');
    return { address, token: auth.body.token, id: account.body.id };
  }
  throw new LiveCheckError('mailbox-account', 0, 'MAILBOX_CREATE');
}

const decodeHtml = value => String(value || '')
  .replace(/&amp;/gi, '&')
  .replace(/&#0*38;/gi, '&')
  .replace(/&#x0*26;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#0*39;|&apos;/gi, "'");

export function verificationAction(content) {
  const decoded = decodeHtml(content);
  const candidates = decoded.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  for (const candidate of candidates) {
    let value = candidate.replace(/[),.;]+$/, '');
    for (let depth = 0; depth < 3; depth += 1) {
      try {
        const url = new URL(value);
        if (url.searchParams.get('mode') === 'verifyEmail' && url.searchParams.get('oobCode')) {
          return {
            oobCode: url.searchParams.get('oobCode'),
            continueUrl: url.searchParams.get('continueUrl') || ''
          };
        }
        const nested = ['continue', 'url', 'q'].map(name => url.searchParams.get(name)).find(Boolean);
        if (!nested) break;
        value = decodeURIComponent(nested);
      } catch { break; }
    }
  }
  return null;
}

const safeDomain = value => {
  const match = String(value || '').toLowerCase().match(/@([a-z0-9.-]+)|^([a-z0-9.-]+)$/);
  const domain = match?.[1] || match?.[2] || '';
  return /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(domain) && domain.includes('.') ? domain : '';
};

const headerDomain = value => safeDomain(String(value || '').match(/<([^>]+)>/)?.[1] || String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+/i)?.[0] || '');

export function liveAuthMethodsReady(methods = {}) {
  const google = methods?.google;
  const telegram = methods?.telegramVerification;
  return methods?.emailPassword?.available === true
    && google?.available === true
    && google?.availabilityCode === 'READY'
    && /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(String(google?.clientId || ''))
    && methods?.passkey?.enrollmentAvailable === true
    && telegram?.available === true
    && telegram?.availabilityCode === 'READY'
    && telegram?.verifiesEmailOwnership === false
    && methods?.backup?.available === false;
}

function mimeHeaders(source) {
  const head = String(source || '').split(/\r?\n\r?\n/, 1)[0];
  const unfolded = head.replace(/\r?\n[ \t]+/g, ' ');
  const result = new Map();
  for (const line of unfolded.split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at < 1) continue;
    const name = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    result.set(name, result.has(name) ? `${result.get(name)}\n${value}` : value);
  }
  return result;
}

async function dnsAnswers(name, type, fetchImpl = globalThis.fetch) {
  if (!safeDomain(name.replace(/^_dmarc\.|^[a-z0-9_-]+\._domainkey\./i, ''))) return [];
  try {
    const response = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload?.Answer) ? payload.Answer.map(answer => String(answer?.data || '')).filter(Boolean) : [];
  } catch { return []; }
}

const authResult = (headers, method) => {
  const source = `${headers.get('authentication-results') || ''}\n${headers.get('arc-authentication-results') || ''}`;
  const match = source.match(new RegExp(`\\b${method}=(pass|fail|softfail|neutral|none|temperror|permerror)\\b`, 'i'));
  if (match) return match[1].toLowerCase();
  if (method === 'spf') {
    const received = String(headers.get('received-spf') || '').match(/^\s*(pass|fail|softfail|neutral|none|temperror|permerror)\b/i);
    if (received) return received[1].toLowerCase();
  }
  return 'unknown';
};

const relaxedAligned = (left, right) => Boolean(left && right && (left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)));

export async function auditVerificationMessage({ message = {}, source = '', fetchImpl = globalThis.fetch } = {}) {
  const headers = mimeHeaders(source);
  const fromAddress = message?.from?.address || headers.get('from') || '';
  const fromDomain = headerDomain(fromAddress);
  const returnPathDomain = headerDomain(headers.get('return-path') || '');
  const dkimHeader = headers.get('dkim-signature') || '';
  const dkimDomain = safeDomain(dkimHeader.match(/(?:^|;)\s*d=([^;\s]+)/i)?.[1] || '');
  const dkimSelector = String(dkimHeader.match(/(?:^|;)\s*s=([^;\s]+)/i)?.[1] || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 63);
  const html = Array.isArray(message?.html) ? message.html.join('\n') : String(message?.html || '');
  const text = String(message?.text || '');
  const visibleHtml = decodeHtml(html)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const visible = `${visibleHtml} ${text}`.trim();
  const hrefs = [...decodeHtml(html).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const verificationLinks = hrefs.filter(match => verificationAction(match[1]));
  const styledCta = verificationLinks.some(match => {
    const label = decodeHtml(match[2]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return /verify|যাচাই/i.test(label) && !/^https?:\/\//i.test(label) && label.length <= 80;
  });
  const rawUrlVisible = /https?:\/\/[^\s<]{8,}/i.test(visible);
  const fallbackPresent = /button.*(?:work|কাজ)|verification link|যাচাইয়ের লিংক|লিংকটি ব্যবহার/i.test(visible);
  const spfDomains = [...new Set([returnPathDomain, fromDomain].filter(Boolean))];
  const spfRecordGroups = (await Promise.all(spfDomains.map(domain => dnsAnswers(domain, 'TXT', fetchImpl))))
    .map(records => records.filter(record => /v=spf1\b/i.test(record)));
  const spfRecordCount = Math.max(0, ...spfRecordGroups.map(records => records.length));
  const dkimName = dkimSelector && dkimDomain ? `${dkimSelector}._domainkey.${dkimDomain}` : '';
  const dkimRecords = dkimName ? [
    ...(await dnsAnswers(dkimName, 'TXT', fetchImpl)),
    ...(await dnsAnswers(dkimName, 'CNAME', fetchImpl))
  ] : [];
  const dmarcCandidates = fromDomain ? [`_dmarc.${fromDomain}`, `_dmarc.${fromDomain.split('.').slice(1).join('.')}`] : [];
  let dmarcRecords = [];
  let dmarcDomain = '';
  for (const name of [...new Set(dmarcCandidates)]) {
    const records = (await dnsAnswers(name, 'TXT', fetchImpl)).filter(record => /v=DMARC1\b/i.test(record));
    if (records.length) { dmarcRecords = records; dmarcDomain = name.replace(/^_dmarc\./, ''); break; }
  }
  const senderName = String(message?.from?.name || '').trim();
  const subject = String(message?.subject || '').trim();
  return Object.freeze({
    senderDomain: fromDomain || 'unknown',
    returnPathDomain: returnPathDomain || 'unknown',
    dkimDomain: dkimDomain || 'unknown',
    senderNameAdmissionHub: /^admission hub$/i.test(senderName),
    subjectAdmissionHub: /admission hub/i.test(subject),
    spfResult: authResult(headers, 'spf'),
    dkimResult: authResult(headers, 'dkim'),
    dmarcResult: authResult(headers, 'dmarc'),
    spfConfigured: spfRecordCount > 0,
    spfRecordCount,
    duplicateSpf: spfRecordGroups.some(records => records.length > 1),
    dkimConfigured: dkimRecords.length > 0,
    dmarcConfigured: dmarcRecords.length > 0,
    dmarcDomain: dmarcDomain || 'unknown',
    spfAligned: relaxedAligned(fromDomain, returnPathDomain),
    dkimAligned: relaxedAligned(fromDomain, dkimDomain),
    hasHtml: Boolean(html),
    messageBytes: Number(message?.size || Buffer.byteLength(`${html}${text}`, 'utf8')),
    verificationLinkCount: verificationLinks.length,
    styledCta,
    rawUrlVisible,
    fallbackPresent,
    brandInBody: /admission hub/i.test(visible),
    securityNotice: /account.*(?:না|not)|ignore|উপেক্ষা|নিরাপদ|secure/i.test(visible)
  });
}

async function readVerificationAction(mailbox, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await jsonRequest(`${MAILBOX_API}/messages?page=1`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${mailbox.token}` }
    }, 'mailbox-poll');
    if (list.response.ok) {
      for (const summary of members(list.body)) {
        const detail = await jsonRequest(`${MAILBOX_API}/messages/${encodeURIComponent(summary.id)}`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${mailbox.token}` }
        }, 'mailbox-read');
        if (!detail.response.ok) continue;
        const content = `${detail.body?.text || ''} ${Array.isArray(detail.body?.html) ? detail.body.html.join(' ') : detail.body?.html || ''}`;
        const action = verificationAction(content);
        if (action) {
          let source = '';
          const sourceUrl = String(detail.body?.sourceUrl || '');
          if (sourceUrl) {
            try {
              const resolved = new URL(sourceUrl, MAILBOX_API);
              if (resolved.origin === new URL(MAILBOX_API).origin) {
                const raw = await jsonRequest(resolved.href, {
                  headers: { Accept: 'application/json', Authorization: `Bearer ${mailbox.token}` }
                }, 'mailbox-source');
                if (raw.response.ok) source = String(raw.body?.data || '');
              }
            } catch { /* Structural evidence remains available from the parsed message. */ }
          }
          return { action, audit: await auditVerificationMessage({ message: detail.body, source }) };
        }
      }
    }
    await sleep(3000);
  }
  throw new LiveCheckError('mailbox-poll', 0, 'VERIFICATION_EMAIL_NOT_RECEIVED');
}

const cookiePair = (response, name) => {
  const value = String(response.headers.get('set-cookie') || '');
  const match = value.match(new RegExp(`(?:^|,\\s*)(${name}=[^;]*)`));
  return match?.[1] || '';
};

async function appRequest(base, path, { method = 'GET', body, cookie = '' } = {}) {
  return jsonRequest(`${base}${path}`, {
    method,
    headers: {
      Origin: base,
      Accept: 'application/json',
      'X-AH-Auth-UI': 'auth-premium-v6',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  }, `app-${path}`);
}

async function firebaseRequest(apiKey, path, body, stage) {
  return jsonRequest(`${FIREBASE_API}${path}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  }, stage);
}

async function deleteFirebaseAccount(apiKey, email, password) {
  if (!apiKey || !email || !password) return;
  try {
    const signed = await firebaseRequest(apiKey, '/accounts:signInWithPassword', {
      email, password, returnSecureToken: true
    }, 'cleanup-signin');
    if (!signed.response.ok || !signed.body?.idToken) return;
    await firebaseRequest(apiKey, '/accounts:delete', { idToken: signed.body.idToken }, 'cleanup-delete');
  } catch {}
}

export async function runLiveMailboxE2E({
  base = process.env.AUTH_LIVE_BASE || 'https://admissionhub.pages.dev',
  apiKey = process.env.FIREBASE_WEB_API_KEY
} = {}) {
  const normalizedBase = String(base).replace(/\/+$/, '');
  const key = String(apiKey || '').trim();
  if (!/^https:\/\/[A-Za-z0-9.-]+$/.test(normalizedBase)) throw new LiveCheckError('configuration', 0, 'INVALID_BASE');
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(key)) throw new LiveCheckError('configuration', 0, 'FIREBASE_KEY_MISSING');
  let mailbox;
  let accountPassword = '';
  try {
    let config = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      config = await appRequest(normalizedBase, '/api/auth/v1/config');
      if (config.response.ok && config.body?.auth?.version === 'firebase-canonical-auth-v3' && config.body?.auth?.available === true) break;
      await sleep(5000);
    }
    if (!config?.response?.ok || config.body?.auth?.version !== 'firebase-canonical-auth-v3' || config.body?.auth?.mode !== 'firebase-canonical-multi-method' || config.body?.auth?.available !== true) {
      throw new LiveCheckError(
        'config',
        config?.body?.auth?.providerStatus || config?.response?.status || 0,
        config?.body?.auth?.availabilityCode || config?.body?.error?.code || 'CONFIG'
      );
    }
    if (config.body?.auth?.verificationEmail?.dailyCapacity !== 1000 || config.body?.auth?.registeredAccountLimit !== 'unlimited') {
      throw new LiveCheckError('config', 0, 'QUOTA_CONTRACT');
    }
    const methods = config.body?.auth?.methods;
    if (!liveAuthMethodsReady(methods)) {
      throw new LiveCheckError('config', 0, 'PUBLIC_METHOD_CONTRACT');
    }

    mailbox = await createMailbox();
    accountPassword = `${random(24)}Z!9`;
    const signup = await appRequest(normalizedBase, '/api/auth/v1/signup', {
      method: 'POST', body: { email: mailbox.address, password: accountPassword }
    });
    if (signup.response.status !== 202 || signup.body?.accountCreated !== true) {
      throw new LiveCheckError('signup', signup.response.status, signup.body?.error?.code || 'SIGNUP');
    }
    if (signup.body?.authenticated !== false || cookiePair(signup.response, '__Host-ah_session')) {
      throw new LiveCheckError('signup', 0, 'UNVERIFIED_SESSION_ISSUED');
    }
    if (JSON.stringify(signup.body).toLowerCase().includes(mailbox.address.toLowerCase())) {
      throw new LiveCheckError('signup', 0, 'RAW_EMAIL_EXPOSED');
    }
    const device = cookiePair(signup.response, '__Host-ah_device');
    if (!device) throw new LiveCheckError('signup', 0, 'DEVICE_COOKIE_MISSING');
    if (signup.body?.verification?.selectionRequired === true) {
      if (signup.body?.verification?.sent !== false
        || signup.body?.verification?.options?.email?.available !== true
        || signup.body?.verification?.options?.telegram?.available !== true) {
        throw new LiveCheckError('signup', 0, 'VERIFICATION_SELECTION_CONTRACT');
      }
      const verification = cookiePair(signup.response, '__Host-ah_verification');
      if (!verification) throw new LiveCheckError('signup', 0, 'VERIFICATION_COOKIE_MISSING');
      const emailStart = await appRequest(normalizedBase, '/api/auth/v1/account-verification/email/start', {
        method: 'POST', cookie: `${verification}; ${device}`, body: {}
      });
      if (emailStart.response.status !== 202 || emailStart.body?.verification?.sent !== true || emailStart.body?.authenticated !== false) {
        throw new LiveCheckError('email-selection', emailStart.response.status, emailStart.body?.error?.code || 'EMAIL_START');
      }
    } else if (signup.body?.verification?.sent !== true) {
      throw new LiveCheckError('signup', 0, 'VERIFICATION_NOT_SENT');
    }

    const denied = await appRequest(normalizedBase, '/api/auth/v1/login', {
      method: 'POST', cookie: device, body: { email: mailbox.address, password: accountPassword }
    });
    const deniedSafely = denied.response.status === 403 && denied.body?.error?.code === 'EMAIL_NOT_VERIFIED'
      || denied.response.status === 202 && denied.body?.authenticated === false && denied.body?.verification?.selectionRequired === true;
    if (!deniedSafely || cookiePair(denied.response, '__Host-ah_session')) {
      throw new LiveCheckError(
        'verified-gate',
        denied.response.status,
        denied.response.headers.get('x-ah-auth-diagnostic') || denied.body?.error?.code || 'UNVERIFIED_ACCESS'
      );
    }

    const received = await readVerificationAction(mailbox);
    const { action, audit: emailAudit } = received;
    if (!action.oobCode) throw new LiveCheckError('verification-link', 0, 'CODE_MISSING');
    if (action.continueUrl) {
      let continueHost = '';
      try { continueHost = new URL(action.continueUrl).hostname; } catch {}
      if (continueHost !== 'admissionhub.pages.dev') throw new LiveCheckError('verification-link', 0, 'CONTINUE_URL_MISMATCH');
    }
    const confirmed = await firebaseRequest(key, '/accounts:update', { oobCode: action.oobCode }, 'verification-confirm');
    if (!confirmed.response.ok || !confirmed.body?.localId) {
      throw new LiveCheckError('verification-confirm', confirmed.response.status, confirmed.body?.error?.message || 'CONFIRM_FAILED');
    }

    const login = await appRequest(normalizedBase, '/api/auth/v1/login', {
      method: 'POST', cookie: device, body: { email: mailbox.address, password: accountPassword }
    });
    if (!login.response.ok || login.body?.authenticated !== true || login.body?.emailVerified !== true || !login.body?.user?.id) {
      throw new LiveCheckError('login', login.response.status, login.body?.error?.code || 'LOGIN');
    }
    if (/sessionToken|refreshToken|idToken/i.test(JSON.stringify(login.body))) throw new LiveCheckError('login', 0, 'CREDENTIAL_EXPOSED');
    const session = cookiePair(login.response, '__Host-ah_session');
    const firebase = cookiePair(login.response, '__Host-ah_firebase');
    const setCookie = String(login.response.headers.get('set-cookie') || '');
    if (!session || !firebase || !/HttpOnly/i.test(setCookie) || !/Secure/i.test(setCookie) || !/SameSite=Strict/i.test(setCookie)) {
      throw new LiveCheckError('login', 0, 'SESSION_COOKIE_POLICY');
    }

    const current = await appRequest(normalizedBase, '/api/auth/v1/session', { cookie: `${session}; ${firebase}; ${device}` });
    if (!current.response.ok || current.body?.emailVerified !== true || current.body?.user?.id !== login.body.user.id) {
      throw new LiveCheckError('session', current.response.status, current.body?.error?.code || 'SESSION');
    }

    const logout = await appRequest(normalizedBase, '/api/auth/v1/session/logout', {
      method: 'POST', cookie: `${session}; ${firebase}`, body: {}
    });
    if (!logout.response.ok || !/Max-Age=0/i.test(String(logout.response.headers.get('set-cookie') || ''))) {
      throw new LiveCheckError('logout', logout.response.status, logout.body?.error?.code || 'LOGOUT');
    }
    const after = await appRequest(normalizedBase, '/api/auth/v1/session', { cookie: `${session}; ${firebase}` });
    if (after.response.status !== 401) throw new LiveCheckError('logout-check', after.response.status, 'SESSION_STILL_ACTIVE');

    return Object.freeze({
      ok: true,
      delivery: 'firebase-external-inbox',
      verifiedGate: 'enforced',
      session: 'verified',
      logout: 'revoked',
      emailAudit
    });
  } finally {
    await deleteFirebaseAccount(key, mailbox?.address, accountPassword);
    if (mailbox?.id && mailbox?.token) {
      try {
        await fetch(`${MAILBOX_API}/accounts/${encodeURIComponent(mailbox.id)}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${mailbox.token}` }, signal: AbortSignal.timeout(10_000)
        });
      } catch {}
    }
  }
}

async function main({ stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const result = await runLiveMailboxE2E();
    const audit = result.emailAudit || {};
    stdout.write(`FIREBASE_AUTH_LIVE_E2E status=PASS delivery=${result.delivery} verifiedGate=${result.verifiedGate} session=${result.session} logout=${result.logout} credentialsPrinted=false\n`);
    stdout.write(`::notice title=Firebase verification email audit::senderDomain=${audit.senderDomain} returnPathDomain=${audit.returnPathDomain} dkimDomain=${audit.dkimDomain} spf=${audit.spfResult} dkim=${audit.dkimResult} dmarc=${audit.dmarcResult} spfDns=${audit.spfConfigured} duplicateSpf=${audit.duplicateSpf} dkimDns=${audit.dkimConfigured} dmarcDns=${audit.dmarcConfigured} spfAligned=${audit.spfAligned} dkimAligned=${audit.dkimAligned} senderBranded=${audit.senderNameAdmissionHub} subjectBranded=${audit.subjectAdmissionHub} html=${audit.hasHtml} styledCta=${audit.styledCta} rawUrlVisible=${audit.rawUrlVisible} fallback=${audit.fallbackPresent} bodyBranded=${audit.brandInBody} securityNotice=${audit.securityNotice} messageBytes=${audit.messageBytes} tokenPrinted=false urlPrinted=false\n`);
  } catch (error) {
    const safe = error instanceof LiveCheckError ? error : new LiveCheckError('unexpected');
    const code = String(safe.code || 'CHECK_FAILED').split(/\s*:\s*/, 1)[0].replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
    stderr.write(`::error title=Firebase Auth live E2E failed::stage=${safe.stage} status=${safe.status} code=${code}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invokedPath === import.meta.url) main();
