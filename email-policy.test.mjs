import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALLOWED_EMAIL_DOMAINS, DISPOSABLE_DOMAINS_LIST, isDisposableEmail, emailDomain } from './email-policy.js';

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

test('only the five owner domains are allowed', () => {
  assert.deepEqual([...ALLOWED_EMAIL_DOMAINS], ['gmail.com', 'yahoo.com', 'icloud.com', 'hotmail.com', 'outlook.com']);
  for (const email of ['student@gmail.com', 'Student@Yahoo.com', 'student@icloud.com', 'student@hotmail.com', 'student@outlook.com']) {
    assert.equal(isDisposableEmail(email), false, `${email} should be allowed`);
  }
});

test('every other domain is refused, including school, college and work mail', () => {
  for (const email of [
    'student@protonmail.com', 'student@school.edu.bd', 'student@university.ac.bd',
    'student@college.gov.bd', 'student@notmailinator.com.evil.com', 'student@sub.gmail.com',
    'student@gmail.co', 'student@googlemail.com', 'student@randomtemp.xyz'
  ]) {
    assert.equal(isDisposableEmail(email), true, `${email} should be refused`);
  }
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
  const allowStart = clientSource.indexOf('ADMISSION_HUB_ALLOWED_EMAIL_DOMAINS = Object.freeze(');
  const allowed = JSON.parse(clientSource.slice(clientSource.indexOf('[', allowStart), clientSource.indexOf(']', allowStart) + 1).replace(/'/g, '"'));
  assert.deepEqual(allowed, [...ALLOWED_EMAIL_DOMAINS]);
});
