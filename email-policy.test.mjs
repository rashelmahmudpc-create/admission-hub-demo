import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DISPOSABLE_DOMAINS_LIST, ALLOWED_EMAIL_DOMAINS_LIST, isDisposableEmail, emailDomain } from './email-policy.js';

const root = new URL('.', import.meta.url).pathname;
const clientSource = readFileSync(`${root}email-policy-client.js`, 'utf8');

test('the disposable-email list blocks the services the owner named', () => {
  for (const email of [
    'student@temp-mail.org', 'x@tempmail.com', 'a@yopmail.com', 'b@mailinator.com',
    'c@guerrillamail.com', 'd@10minutemail.com', 'e@sharklasers.com',
    'f@getnada.com', 'g@trashmail.com', 'h@maildrop.cc', 'i@1secmail.com'
  ]) {
    assert.equal(isDisposableEmail(email), true, `${email} should be refused`);
  }
});

test('owner 2026-10-18: only gmail, yahoo, icloud and outlook are accepted', () => {
  for (const email of ['student@gmail.com', 'Student@Yahoo.com', 'student@icloud.com', 'student@outlook.com']) {
    assert.equal(isDisposableEmail(email), false, `${email} should be allowed`);
  }
  for (const email of [
    'student@protonmail.com', 'student@hotmail.com', 'student@school.edu.bd',
    'student@university.ac.bd', 'student@random-temp.xyz', 'student@sub.gmail.com',
    'student@gmail.com.evil.com'
  ]) {
    assert.equal(isDisposableEmail(email), true, `${email} should be refused`);
  }
});

test('the browser mirror enforces the same four-domain allowlist', () => {
  assert.deepEqual([...ALLOWED_EMAIL_DOMAINS_LIST].sort(), ['gmail.com', 'icloud.com', 'outlook.com', 'yahoo.com']);
  for (const domain of ALLOWED_EMAIL_DOMAINS_LIST) assert.ok(clientSource.includes(`'${domain}'`));
  assert.ok(clientSource.includes('ADMISSION_HUB_ALLOWED_EMAIL_DOMAINS.includes(domain)'));
});

test('a subdomain of a blocked provider is refused', () => {
  assert.equal(isDisposableEmail('a@inbox.temp-mail.org'), true);
  assert.equal(isDisposableEmail('a@sub.mailinator.com'), true);
});

test('a malformed address is left to the format check, not marked disposable', () => {
  assert.equal(isDisposableEmail('nobody'), false);
  assert.equal(isDisposableEmail('trailing@'), false);
  assert.equal(emailDomain('Mixed@Case.COM'), 'case.com');
});

test('the browser mirror carries exactly the server list', () => {
  // The Worker is the authority; the mirror only moves the message to the field.
  // This is the assertion that stops the two lists drifting apart.
  const mirrored = JSON.parse(
    clientSource.slice(clientSource.indexOf('['), clientSource.indexOf(']') + 1).replace(/'/g, '"')
  );
  assert.deepEqual([...mirrored].sort(), [...DISPOSABLE_DOMAINS_LIST].sort());
});
