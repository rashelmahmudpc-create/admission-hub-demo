// Checks the records that decide whether a sender logo can appear in an inbox.
//
// Run against each sending domain:
//   node auth-native/operations/verify-email-branding.mjs admissionhub.net
//
// Uses DNS-over-HTTPS because the runtime has no resolver tooling. Exit code is
// 0 when every gating requirement is met, 1 otherwise, so it can gate a
// checklist.

const DOH = 'https://cloudflare-dns.com/dns-query';

const strip = value => String(value).replace(/^"|"$/g, '');

const firstWith = (records, prefix) => records.map(strip).find(record => record.startsWith(prefix)) || '';

// A selector name is provider-specific, so DKIM presence is reported but never
// gates the result. The certificate is a purchase rather than configuration, so
// it is reported on its own line too.
const NON_GATING = ['BIMI carries a mark certificate', 'DKIM selector google._domainkey'];

// Pure: turns already-fetched record text into the checklist. Kept free of I/O
// so the classification can be tested against fixtures.
export const evaluateRecords = ({ txt = [], dmarc = [], bimi = [], dkim = [] }) => {
  const checks = [];
  const add = (ok, label, detail) => checks.push({ ok, label, detail });

  const spf = firstWith(txt, 'v=spf1');
  add(!!spf, 'SPF published', spf || 'no v=spf1 record');
  add(
    /-all\s*$/.test(spf) || /~all\s*$/.test(spf),
    'SPF qualifier',
    /-all\s*$/.test(spf) ? '-all (hard fail)' : /~all\s*$/.test(spf) ? '~all (soft fail)' : 'missing or permissive'
  );

  const dmarcRecord = firstWith(dmarc, 'v=DMARC1');
  const policy = (dmarcRecord.match(/p=(\w+)/) || [])[1] || '';
  add(!!dmarcRecord, 'DMARC published', dmarcRecord || 'no v=DMARC1 record');
  add(
    ['quarantine', 'reject'].includes(policy),
    'DMARC policy enforces',
    policy ? `p=${policy}` : 'none set'
  );
  const adkim = (dmarcRecord.match(/adkim=(\w+)/) || [])[1] || 'relaxed';
  const aspf = (dmarcRecord.match(/aspf=(\w+)/) || [])[1] || 'relaxed';
  add(!!dmarcRecord, 'DMARC alignment', dmarcRecord ? `adkim=${adkim} aspf=${aspf}` : 'n/a');

  add(!!dkim.length, 'DKIM selector google._domainkey', dkim.length ? 'present' : 'absent (selector may differ)');

  const bimiRecord = firstWith(bimi, 'v=BIMI1');
  const logo = (bimiRecord.match(/l=([^;]*)/) || [])[1] || '';
  const certificate = (bimiRecord.match(/a=([^;]*)/) || [])[1] || '';
  add(!!bimiRecord, 'BIMI record at default._bimi', bimiRecord || 'absent');
  add(logo.startsWith('https://'), 'BIMI logo served over HTTPS', logo || 'no l= value');
  add(
    !!certificate,
    'BIMI carries a mark certificate',
    certificate || 'no a= value; Gmail will not display the logo without a VMC or CMC'
  );

  return checks;
};

// Pure: validates the fetched logo against the SVG Tiny PS expectations.
export const evaluateLogo = (body, { status = 200, contentType = '' } = {}) => {
  const checks = [];
  const add = (ok, label, detail) => checks.push({ ok, label, detail });

  add(status >= 200 && status < 300, 'BIMI logo reachable', `${status} ${contentType}`);
  add(contentType.includes('svg'), 'BIMI logo is SVG', contentType || 'unknown content type');
  add(
    /baseProfile="tiny-ps"/.test(body) || /version="1\.2"/.test(body),
    'BIMI logo uses SVG Tiny PS',
    /baseProfile="tiny-ps"/.test(body) ? 'baseProfile="tiny-ps"' : 'profile not declared'
  );
  add(
    /viewBox="[^"]+"/.test(body),
    'BIMI logo has a viewBox',
    (body.match(/viewBox="([^"]*)"/) || [])[1] || 'missing'
  );
  add(
    !/<script|<image|xlink:href|data:image/i.test(body),
    'BIMI logo free of scripts and rasters',
    'static vector only'
  );

  return checks;
};

export const summarize = checks => {
  const failed = checks.filter(item => !item.ok);
  return {
    failed,
    passed: checks.length - failed.length,
    total: checks.length,
    gating: failed.filter(item => !NON_GATING.includes(item.label)).length === 0
  };
};

const lookup = async (name, type) => {
  const url = `${DOH}?name=${encodeURIComponent(name)}&type=${type}`;
  const response = await fetch(url, { headers: { accept: 'application/dns-json' } });
  if (!response.ok) throw new Error(`${type} ${name}: resolver returned ${response.status}`);
  const body = await response.json();
  return (body.Answer || []).map(record => record.data);
};

const bimiLogoUrl = records => (firstWith(records, 'v=BIMI1').match(/l=([^;]*)/) || [])[1] || '';

export const report = async (domain, log = console.log) => {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    throw new Error('usage: node verify-email-branding.mjs <sending-domain>');
  }

  const [txt, dmarc, bimi, dkim, ns] = await Promise.all([
    lookup(domain, 'TXT'),
    lookup(`_dmarc.${domain}`, 'TXT'),
    lookup(`default._bimi.${domain}`, 'TXT'),
    lookup(`google._domainkey.${domain}`, 'TXT'),
    lookup(domain, 'NS')
  ]);

  log(`\nDomain: ${domain}`);
  log(`Nameservers: ${ns.map(strip).join(', ') || 'none published'}\n`);

  const checks = evaluateRecords({ txt, dmarc, bimi, dkim });
  const logoUrl = bimiLogoUrl(bimi);

  if (logoUrl.startsWith('https://')) {
    const response = await fetch(logoUrl);
    checks.push(...evaluateLogo(await response.text(), {
      status: response.status,
      contentType: response.headers.get('content-type') || ''
    }));
  }

  for (const item of checks) {
    log(`  ${item.ok ? 'PASS' : 'FAIL'}  ${item.label}${item.detail ? `\n          ${item.detail}` : ''}`);
  }

  const { failed, passed, total, gating } = summarize(checks);
  log(`\n${passed}/${total} checks pass.`);
  if (failed.some(item => item.label === 'DKIM selector google._domainkey')) {
    log("DKIM: selector names vary per provider, so inspect your provider's actual selector.");
  }
  if (failed.some(item => item.label === 'BIMI carries a mark certificate')) {
    log('Mark certificate is outstanding: Gmail requires a VMC or CMC for BIMI.');
  }
  if (!failed.length) {
    log('All requirements met. Gmail should render the logo once caches expire.');
  }
  return gating;
};

if (process.argv[1] && process.argv[1].endsWith('verify-email-branding.mjs')) {
  report(process.argv[2])
    .then(ok => { process.exitCode = ok ? 0 : 1; })
    .catch(error => { console.error(error.message); process.exitCode = 2; });
}
