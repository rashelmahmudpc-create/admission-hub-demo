import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateRecords,
  evaluateLogo,
  summarize
} from './auth-native/operations/verify-email-branding.mjs';

// Real record text, so the parser faces the quoting and spacing it meets live.
const CNN_SPF = '"v=spf1 include:cnn.com._nspf.vali.email include:%{i}._ip.%{h}._ehlo.%{d}._spf.vali.email ~all"';
const CNN_DMARC = '"v=DMARC1; p=reject; rua=mailto:dmarc_agg@vali.email; ruf=mailto:Njk3@ruf.vali.email"';
const CNN_BIMI = '"v=BIMI1; l=https://amplify.valimail.com/bimi/time-warner/R4Ezf5xK5ac-CNN.svg; a=https://amplify.valimail.com/bimi/time-warner/R4Ezf5xK5ac-CNN.pem"';

const NET_DMARC = '"v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;"';

const find = (checks, label) => checks.find(check => check.label === label);

test('a fully configured domain passes every check', () => {
  const checks = evaluateRecords({
    txt: [CNN_SPF, '"google-site-verification=abc"'],
    dmarc: [CNN_DMARC],
    bimi: [CNN_BIMI],
    dkim: ['"v=DKIM1; k=rsa; p=MIIBIjANBg"']
  });

  const { failed, gating, total, passed } = summarize(checks);
  assert.deepEqual(failed, []);
  assert.equal(gating, true);
  assert.equal(passed, total);
  assert.equal(gating, true);
});

test('an unconfigured domain fails the gating checks', () => {
  const checks = evaluateRecords({ txt: ['"google-site-verification=abc"'] });
  const { gating, failed } = summarize(checks);

  assert.equal(gating, false);
  assert.equal(find(checks, 'SPF published').ok, false);
  assert.equal(find(checks, 'DMARC published').ok, false);
  assert.equal(find(checks, 'BIMI record at default._bimi').ok, false);
  // Both of these are reported but must not gate the exit code.
  assert.equal(find(checks, 'BIMI carries a mark certificate').ok, false);
  assert.equal(find(checks, 'DKIM selector google._domainkey').ok, false);
  assert.ok(failed.length >= 6);
});

test('DMARC at p=none does not satisfy the policy check', () => {
  const checks = evaluateRecords({
    dmarc: ['"v=DMARC1; p=none; rua=mailto:x@example.com"']
  });

  const policy = find(checks, 'DMARC policy enforces');
  assert.equal(policy.ok, false);
  assert.equal(policy.detail, 'p=none');
  assert.equal(summarize(checks).gating, false);
});

test('DMARC at p=quarantine enforces and keeps relaxed alignment', () => {
  const checks = evaluateRecords({ dmarc: [NET_DMARC] });

  const policy = find(checks, 'DMARC policy enforces');
  assert.equal(policy.ok, true);
  assert.equal(policy.detail, 'p=quarantine');
  assert.equal(find(checks, 'DMARC alignment').detail, 'adkim=r aspf=r');
});

test('SPF missing an all qualifier is reported as permissive', () => {
  const checks = evaluateRecords({ txt: ['"v=spf1 include:_spf.google.com"'] });

  assert.equal(find(checks, 'SPF published').ok, true);
  const qualifier = find(checks, 'SPF qualifier');
  assert.equal(qualifier.ok, false);
  assert.match(qualifier.detail, /permissive/);
});

test('BIMI without a certificate is flagged but stays non-gating', () => {
  const checks = evaluateRecords({
    txt: [CNN_SPF],
    dmarc: [CNN_DMARC],
    bimi: ['"v=BIMI1; l=https://admissionhub.pages.dev/email-preview/admissionhub-bimi.svg"'],
    dkim: ['"v=DKIM1; k=rsa; p=MIIBIjANBg"']
  });

  const certificate = find(checks, 'BIMI carries a mark certificate');
  assert.equal(certificate.ok, false);
  assert.match(certificate.detail, /VMC or CMC/);
  assert.equal(find(checks, 'BIMI logo served over HTTPS').ok, true);
  // The missing certificate must not fail the run; it is a purchase, not a setting.
  assert.equal(summarize(checks).gating, true);
});

test('a BIMI logo on plain HTTP is rejected', () => {
  const checks = evaluateRecords({ bimi: ['"v=BIMI1; l=http://example.com/logo.svg"'] });
  assert.equal(find(checks, 'BIMI logo served over HTTPS').ok, false);
  assert.equal(find(checks, 'BIMI logo served over HTTPS').detail, 'http://example.com/logo.svg');
});

test('a conforming SVG Tiny PS logo passes the logo checks', () => {
  const logo = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" version="1.2" baseProfile="tiny-ps"><path d="M0 0h1v1z"/></svg>';
  const checks = evaluateLogo(logo, { status: 200, contentType: 'image/svg+xml' });

  assert.deepEqual(checks.map(check => check.ok), [true, true, true, true, true]);
  assert.equal(find(checks, 'BIMI logo has a viewBox').detail, '0 0 512 512');
});

test('a raster, scripted, or embedded logo is rejected', () => {
  const raster = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><image href="data:image/png;base64,AAAA"/></svg>';
  const rasterChecks = evaluateLogo(raster, { status: 200, contentType: 'image/svg+xml' });
  assert.equal(find(rasterChecks, 'BIMI logo free of scripts and rasters').ok, false);

  const scripted = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><script>alert(1)</script></svg>';
  assert.equal(find(evaluateLogo(scripted), 'BIMI logo free of scripts and rasters').ok, false);

  const external = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><use xlink:href="#a"/></svg>';
  assert.equal(find(evaluateLogo(external), 'BIMI logo free of scripts and rasters').ok, false);
});

test('a logo served as the wrong content type or not at all is rejected', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" baseProfile="tiny-ps"/>';

  const wrongType = evaluateLogo(svg, { status: 200, contentType: 'text/html' });
  assert.equal(find(wrongType, 'BIMI logo is SVG').ok, false);

  const missing = evaluateLogo('', { status: 404, contentType: 'text/html' });
  assert.equal(find(missing, 'BIMI logo reachable').ok, false);
  assert.equal(find(missing, 'BIMI logo uses SVG Tiny PS').ok, false);
});

test('a logo declaring only SVG 1.2 still counts as Tiny PS', () => {
  const versionOnly = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" version="1.2"><path d="M0 0h1v1z"/></svg>';
  assert.equal(find(evaluateLogo(versionOnly), 'BIMI logo uses SVG Tiny PS').ok, true);

  const undeclared = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M0 0h1v1z"/></svg>';
  const checks = evaluateLogo(undeclared);
  assert.equal(find(checks, 'BIMI logo uses SVG Tiny PS').ok, false);
  assert.equal(find(checks, 'BIMI logo uses SVG Tiny PS').detail, 'profile not declared');
});
