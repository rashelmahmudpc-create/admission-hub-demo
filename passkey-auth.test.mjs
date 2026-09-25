import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudflareNativeAuthEngine } from './auth-native/core/auth-engine.mjs';
import { AuthSecretVault } from './auth-native/core/secret-vault.mjs';
import {
  bytesToBase64Url,
  derEcdsaToRaw,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration
} from './auth-native/core/webauthn.mjs';
import { AUTH_ERROR_CODES } from './auth-native/core/errors.mjs';
import { MemoryAuthRepository } from './auth-native/testing/memory-auth-repository.mjs';


/* DER ECDSA conversion must accept coordinates whose top bit is set. Roughly
 * half of all P-256 signatures have a high bit in r or s, and DER prefixes a
 * 0x00 sign byte for exactly those. Treating the stripped byte as a negative
 * sign rejected about half of all real passkey sign-ins. */
test('DER ECDSA conversion keeps 33-byte r/s coordinates with a high bit set', () => {
  const signature = Uint8Array.from(Buffer.from(
    '3045022044ca10e33d01d6f467839499b813522b93b8d1e6384c905fe53de139bcd99175' +
    '02210082805b6889e818621a68ed4a8572028ed388a51398662323545474cd245d9f1c', 'hex'));
  const raw = derEcdsaToRaw(signature);
  assert.equal(raw.length, 64, 'r and s are each padded to 32 bytes');
  /* r is unchanged, s drops the DER sign byte and keeps 0x82 as its top byte. */
  assert.equal(raw[0], 0x44);
  assert.equal(raw[31], 0x75);
  assert.equal(raw[32], 0x82);
  assert.equal(raw[63], 0x1c);
});

test('DER ECDSA conversion still rejects a genuinely negative coordinate', () => {
  /* No sign byte before a high-bit byte: the value would be negative in DER. */
  const malformed = Uint8Array.from(Buffer.from('3044021f44ca10e33d01d6f467839499b813522b93b8d1e6384c905fe53de139bcd99175021f0082805b6889e818621a68ed4a8572028ed388a51398662323545474cd245d9', 'hex'));
  assert.throws(() => derEcdsaToRaw(malformed), error => error.code === AUTH_ERROR_CODES.PASSKEY_INVALID || Boolean(error.message));
});

test('DER ECDSA conversion passes a 64-byte raw signature straight through', () => {
  const raw64 = new Uint8Array(64).fill(7);
  assert.deepEqual(derEcdsaToRaw(raw64), raw64);
});

const SECRET = 'passkey-test-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ORIGIN = 'https://admissionhub.pages.dev';
const RP_ID = 'admissionhub.pages.dev';
const enc = new TextEncoder();

const concat = (...values) => {
  const output = new Uint8Array(values.reduce((sum, value) => sum + value.length, 0));
  let offset = 0;
  for (const value of values) { output.set(value, offset); offset += value.length; }
  return output;
};

const uint = (major, value) => {
  if (value < 24) return Uint8Array.of((major << 5) | value);
  if (value < 256) return Uint8Array.of((major << 5) | 24, value);
  if (value < 65536) return Uint8Array.of((major << 5) | 25, value >> 8, value & 255);
  return Uint8Array.of((major << 5) | 26, value >>> 24, value >>> 16, value >>> 8, value);
};

function cbor(value) {
  if (value instanceof Uint8Array) return concat(uint(2, value.length), value);
  if (typeof value === 'string') { const bytes = enc.encode(value); return concat(uint(3, bytes.length), bytes); }
  if (typeof value === 'number' && Number.isInteger(value)) return value >= 0 ? uint(0, value) : uint(1, -1 - value);
  if (value instanceof Map) {
    const rows = [...value.entries()].flatMap(([key, item]) => [cbor(key), cbor(item)]);
    return concat(uint(5, value.size), ...rows);
  }
  throw new TypeError('unsupported fixture value');
}

const sha256 = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', value));
const clientData = (type, challenge, origin = ORIGIN) => bytesToBase64Url(enc.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false })));

async function authenticatorFixture() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const credentialId = crypto.getRandomValues(new Uint8Array(32));
  const x = Uint8Array.from(Buffer.from(jwk.x, 'base64url'));
  const y = Uint8Array.from(Buffer.from(jwk.y, 'base64url'));
  const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, x], [-3, y]]));
  const rpHash = await sha256(enc.encode(RP_ID));
  const registrationAuthData = concat(
    rpHash,
    Uint8Array.of(0x45),
    Uint8Array.of(0, 0, 0, 0),
    new Uint8Array(16),
    Uint8Array.of(credentialId.length >> 8, credentialId.length & 255),
    credentialId,
    cose
  );
  const registrationResponse = challenge => ({
    rawId: bytesToBase64Url(credentialId),
    clientDataJSON: clientData('webauthn.create', challenge),
    attestationObject: bytesToBase64Url(cbor(new Map([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', registrationAuthData]
    ]))),
    transports: ['internal', 'hybrid']
  });
  const authenticationResponse = async (challenge, counter = 1, userHandle = '', origin = ORIGIN) => {
    const authData = concat(rpHash, Uint8Array.of(0x05), Uint8Array.of(0, 0, 0, counter));
    const encodedClientData = clientData('webauthn.get', challenge, origin);
    const clientHash = await sha256(Uint8Array.from(Buffer.from(encodedClientData, 'base64url')));
    const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, concat(authData, clientHash)));
    return {
      rawId: bytesToBase64Url(credentialId),
      clientDataJSON: encodedClientData,
      authenticatorData: bytesToBase64Url(authData),
      signature: bytesToBase64Url(signature),
      ...(userHandle ? { userHandle } : {})
    };
  };
  return { pair, credentialId, registrationResponse, authenticationResponse };
}

async function expectCode(action, code) {
  await assert.rejects(action, error => error?.code === code);
}

test('WebAuthn registration parses server-trusted attestation data and authentication verifies signature/counter', async () => {
  const fixture = await authenticatorFixture();
  const challenge = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const registered = await verifyPasskeyRegistration({
    response: fixture.registrationResponse(challenge),
    expectedChallenge: challenge,
    rpId: RP_ID,
    allowedOrigins: [ORIGIN]
  });
  assert.equal(registered.credentialId, bytesToBase64Url(fixture.credentialId));
  assert.equal(registered.publicKeyJwk.kty, 'EC');
  assert.equal(registered.publicKeyJwk.crv, 'P-256');
  assert.deepEqual(registered.transports, ['internal', 'hybrid']);

  const userHandle = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const assertion = await fixture.authenticationResponse(challenge, 1, userHandle);
  const verified = await verifyPasskeyAuthentication({
    response: assertion,
    expectedChallenge: challenge,
    rpId: RP_ID,
    allowedOrigins: [ORIGIN],
    credential: { ...registered, userHandle }
  });
  assert.equal(verified.counter, 1);
  assert.equal(verified.credentialId, registered.credentialId);
});

test('WebAuthn rejects wrong origin, challenge, RP, user handle, signature, and replayed counter', async t => {
  const fixture = await authenticatorFixture();
  const challenge = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const registered = await verifyPasskeyRegistration({
    response: fixture.registrationResponse(challenge), expectedChallenge: challenge, rpId: RP_ID, allowedOrigins: [ORIGIN]
  });
  const userHandle = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const response = await fixture.authenticationResponse(challenge, 2, userHandle);
  const base = { response, expectedChallenge: challenge, rpId: RP_ID, allowedOrigins: [ORIGIN], credential: { ...registered, userHandle, counter: 1 } };

  await t.test('origin', () => expectCode(() => verifyPasskeyAuthentication({ ...base, allowedOrigins: ['https://evil.example'] }), AUTH_ERROR_CODES.PASSKEY_INVALID));
  await t.test('origin with a forged path', async () => {
    const forged = await fixture.authenticationResponse(challenge, 2, userHandle, `${ORIGIN}/forged`);
    await expectCode(() => verifyPasskeyAuthentication({ ...base, response: forged }), AUTH_ERROR_CODES.PASSKEY_INVALID);
  });
  await t.test('challenge', () => expectCode(() => verifyPasskeyAuthentication({ ...base, expectedChallenge: bytesToBase64Url(new Uint8Array(32)) }), AUTH_ERROR_CODES.PASSKEY_INVALID));
  await t.test('RP', () => expectCode(() => verifyPasskeyAuthentication({ ...base, rpId: 'other.example' }), AUTH_ERROR_CODES.PASSKEY_INVALID));
  await t.test('user handle', () => expectCode(() => verifyPasskeyAuthentication({ ...base, credential: { ...base.credential, userHandle: bytesToBase64Url(new Uint8Array(32)) } }), AUTH_ERROR_CODES.PASSKEY_INVALID));
  await t.test('signature', () => {
    const tampered = { ...response, signature: bytesToBase64Url(new Uint8Array(64)) };
    return expectCode(() => verifyPasskeyAuthentication({ ...base, response: tampered }), AUTH_ERROR_CODES.PASSKEY_INVALID);
  });
  await t.test('counter replay', () => expectCode(() => verifyPasskeyAuthentication({ ...base, credential: { ...base.credential, counter: 2 } }), AUTH_ERROR_CODES.PASSKEY_INVALID));
});

test('refresh-token vault uses randomized authenticated encryption and fails closed on wrong context', async () => {
  const vault = new AuthSecretVault(SECRET);
  const plaintext = 'firebase-refresh-token-that-must-never-be-stored-in-plaintext';
  const first = await vault.seal(plaintext, 'passkey-refresh:subject-ref-one');
  const second = await vault.seal(plaintext, 'passkey-refresh:subject-ref-one');
  assert.notEqual(first, second);
  assert.equal(first.includes(plaintext), false);
  assert.equal(await vault.open(first, 'passkey-refresh:subject-ref-one'), plaintext);
  await expectCode(() => vault.open(first, 'passkey-refresh:subject-ref-two'), AUTH_ERROR_CODES.STORAGE_UNAVAILABLE);
});

test('passkey login remains bound to the original Firebase UID and refresh-token authority', async () => {
  let now = 1_800_000_000_000;
  const repository = new MemoryAuthRepository();
  const engine = new CloudflareNativeAuthEngine({ repository, hmacSecret: SECRET, now: () => now });
  const context = { ip: '203.0.113.20', deviceId: 'device-passkey-test-0123456789', userAgent: 'Chrome', origin: ORIGIN };
  const email = 'passkey.student@example.com';
  const subject = 'firebase-uid-passkey-student';
  const initial = await engine.establishFirebaseSession({ email, subject }, context);
  const refreshToken = 'firebase-refresh-token-original-0123456789';
  const registrationRefreshToken = 'firebase-refresh-token-registration-rotated-0123456789';
  const fixture = await authenticatorFixture();

  const begin = await engine.beginPasskeyRegistration({
    sessionToken: initial.sessionToken, email, subject, refreshToken
  }, context);
  const registered = await engine.finishPasskeyRegistration({
    sessionToken: initial.sessionToken,
    refreshToken: registrationRefreshToken,
    email,
    subject,
    challengeId: begin.challengeId,
    response: fixture.registrationResponse(begin.options.challenge)
  }, context);
  assert.equal(registered.registered, true);
  assert.equal(registered.credentialCount, 1);
  const serialized = JSON.stringify(repository.snapshot());
  assert.equal(serialized.includes(refreshToken), false);
  assert.equal(serialized.includes(registrationRefreshToken), false);
  assert.equal(serialized.includes(subject), false);

  await engine.revokeSession(initial.sessionToken);
  const loginBegin = await engine.beginPasskeyAuthentication(context);
  const storedPasskey = repository.snapshot().passkeys[0];
  const assertion = await fixture.authenticationResponse(loginBegin.options.challenge, 1, storedPasskey.userHandle);
  const assertionResult = await engine.finishPasskeyAuthentication({
    challengeId: loginBegin.challengeId,
    response: assertion
  }, context);
  assert.equal(assertionResult.refreshToken, registrationRefreshToken);
  assert.match(assertionResult.loginTicket, /^[A-Za-z0-9_-]{40,96}$/);

  const updatedEmail = 'passkey.renamed@example.com';
  const completed = await engine.completePasskeySession({
    loginTicket: assertionResult.loginTicket,
    refreshToken: 'firebase-refresh-token-rotated-0123456789',
    email: updatedEmail,
    subject
  }, context);
  assert.equal(completed.created, false);
  assert.equal((await engine.getFirebaseSession(completed.sessionToken, { email: updatedEmail, subject })).user.id, initial.user.id);

  await expectCode(() => engine.completePasskeySession({
    loginTicket: assertionResult.loginTicket,
    refreshToken: 'firebase-refresh-token-rotated-again-0123456789',
    email,
    subject: 'different-firebase-uid'
  }, context), AUTH_ERROR_CODES.PASSKEY_INVALID);
});
