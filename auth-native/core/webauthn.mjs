import { AUTH_ERROR_CODES, NativeAuthError } from './errors.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_CLIENT_DATA_BYTES = 4096;
const MAX_ATTESTATION_BYTES = 16 * 1024;
const MAX_AUTHENTICATOR_BYTES = 4096;
const MAX_CREDENTIAL_BYTES = 1024;
const MAX_SIGNATURE_BYTES = 1024;

const fail = (code = AUTH_ERROR_CODES.PASSKEY_INVALID) => { throw new NativeAuthError(code); };

export function bytesToBase64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 32768)));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(value, maximum = MAX_ATTESTATION_BYTES) {
  const raw = String(value || '');
  if (!raw || raw.length > Math.ceil(maximum * 4 / 3) + 4 || !/^[A-Za-z0-9_-]+$/.test(raw)) fail();
  const padding = raw.length % 4 ? '='.repeat(4 - (raw.length % 4)) : '';
  let binary;
  try { binary = atob(raw.replace(/-/g, '+').replace(/_/g, '/') + padding); } catch { fail(); }
  if (binary.length > maximum) fail();
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (bytesToBase64Url(bytes) !== raw) fail();
  return bytes;
}

function timingSafeBytes(left, right) {
  const a = left instanceof Uint8Array ? left : new Uint8Array(left);
  const b = right instanceof Uint8Array ? right : new Uint8Array(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index % (a.length || 1)] || 0) ^ (b[index % (b.length || 1)] || 0);
  return difference === 0;
}

function concatBytes(...values) {
  const size = values.reduce((total, value) => total + value.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const value of values) { result.set(value, offset); offset += value.length; }
  return result;
}

function readLength(bytes, state, additional) {
  if (additional < 24) return additional;
  const width = additional === 24 ? 1 : additional === 25 ? 2 : additional === 26 ? 4 : additional === 27 ? 8 : 0;
  if (!width || state.offset + width > bytes.length) fail();
  let value = 0;
  for (let index = 0; index < width; index += 1) value = value * 256 + bytes[state.offset++];
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function decodeCborValue(bytes, state, depth = 0) {
  if (depth > 16 || state.offset >= bytes.length || state.items++ > 512) fail();
  const first = bytes[state.offset++];
  const major = first >> 5;
  const length = readLength(bytes, state, first & 31);
  if (major === 0) return length;
  if (major === 1) return -1 - length;
  if (major === 2) {
    if (state.offset + length > bytes.length) fail();
    const value = bytes.slice(state.offset, state.offset + length);
    state.offset += length;
    return value;
  }
  if (major === 3) {
    if (state.offset + length > bytes.length) fail();
    let value;
    try { value = decoder.decode(bytes.slice(state.offset, state.offset + length)); } catch { fail(); }
    state.offset += length;
    return value;
  }
  if (major === 4) {
    if (length > 128) fail();
    return Array.from({ length }, () => decodeCborValue(bytes, state, depth + 1));
  }
  if (major === 5) {
    if (length > 128) fail();
    const value = new Map();
    for (let index = 0; index < length; index += 1) {
      const key = decodeCborValue(bytes, state, depth + 1);
      if (!['string', 'number'].includes(typeof key) || value.has(key)) fail();
      value.set(key, decodeCborValue(bytes, state, depth + 1));
    }
    return value;
  }
  if (major === 6) return decodeCborValue(bytes, state, depth + 1);
  if (major === 7) {
    if (length === 20) return false;
    if (length === 21) return true;
    if (length === 22) return null;
  }
  fail();
}

export function decodeCbor(bytes, offset = 0) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const state = { offset: Number(offset), items: 0 };
  if (!Number.isInteger(state.offset) || state.offset < 0 || state.offset >= value.length) fail();
  const decoded = decodeCborValue(value, state);
  return Object.freeze({ value: decoded, offset: state.offset });
}

async function sha256(bytes, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) fail(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
  return new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes));
}

function normalizeRpId(value) {
  const rpId = String(value || '').toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(rpId)) fail(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
  return rpId;
}

function normalizeOrigins(origins) {
  const values = Array.isArray(origins) ? origins : [origins];
  const result = new Set();
  for (const value of values) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
      result.add(url.origin);
    } catch (error) {
      if (error instanceof NativeAuthError) throw error;
      fail(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
    }
  }
  if (!result.size) fail(AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE);
  return result;
}

export function readPasskeyClientChallenge(encoded, expectedType) {
  const bytes = base64UrlToBytes(encoded, MAX_CLIENT_DATA_BYTES);
  let data;
  try { data = JSON.parse(decoder.decode(bytes)); } catch { fail(); }
  if (!data || typeof data !== 'object' || data.type !== expectedType || typeof data.challenge !== 'string') fail();
  base64UrlToBytes(data.challenge, 128);
  return data.challenge;
}

function parseClientData(encoded, type, challenge, origins) {
  const bytes = base64UrlToBytes(encoded, MAX_CLIENT_DATA_BYTES);
  let data;
  try { data = JSON.parse(decoder.decode(bytes)); } catch { fail(); }
  if (!data || typeof data !== 'object' || data.type !== type || data.crossOrigin === true) fail();
  const expected = base64UrlToBytes(challenge, 128);
  const supplied = base64UrlToBytes(data.challenge, 128);
  if (!timingSafeBytes(expected, supplied)) fail();
  let origin;
  try {
    const suppliedOrigin = String(data.origin || '');
    const parsedOrigin = new URL(suppliedOrigin);
    if (parsedOrigin.protocol !== 'https:' || parsedOrigin.username || parsedOrigin.password || parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash || suppliedOrigin !== parsedOrigin.origin) fail();
    origin = parsedOrigin.origin;
  } catch (error) {
    if (error instanceof NativeAuthError) throw error;
    fail();
  }
  if (!origins.has(origin)) fail();
  if (data.topOrigin) {
    let topOrigin;
    try {
      const suppliedTopOrigin = String(data.topOrigin);
      const parsedTopOrigin = new URL(suppliedTopOrigin);
      if (parsedTopOrigin.protocol !== 'https:' || parsedTopOrigin.username || parsedTopOrigin.password || parsedTopOrigin.pathname !== '/' || parsedTopOrigin.search || parsedTopOrigin.hash || suppliedTopOrigin !== parsedTopOrigin.origin) fail();
      topOrigin = parsedTopOrigin.origin;
    } catch (error) {
      if (error instanceof NativeAuthError) throw error;
      fail();
    }
    if (!origins.has(topOrigin)) fail();
  }
  return Object.freeze({ bytes, data: Object.freeze({ type: data.type, origin }) });
}

async function parseAuthenticatorData(bytes, { rpId, registration, cryptoImpl }) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 37) fail();
  const expectedRpHash = await sha256(encoder.encode(rpId), cryptoImpl);
  if (!timingSafeBytes(bytes.slice(0, 32), expectedRpHash)) fail();
  const flags = bytes[32];
  const userPresent = Boolean(flags & 0x01);
  const userVerified = Boolean(flags & 0x04);
  const backupEligible = Boolean(flags & 0x08);
  const backupState = Boolean(flags & 0x10);
  const attested = Boolean(flags & 0x40);
  const extensions = Boolean(flags & 0x80);
  if (!userPresent || !userVerified || (backupState && !backupEligible) || registration !== attested) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const counter = view.getUint32(33, false);
  let offset = 37;
  let credentialId = null;
  let publicKeyJwk = null;
  if (registration) {
    if (bytes.length < offset + 18) fail();
    offset += 16;
    const credentialLength = view.getUint16(offset, false);
    offset += 2;
    if (!credentialLength || credentialLength > MAX_CREDENTIAL_BYTES || offset + credentialLength >= bytes.length) fail();
    credentialId = bytes.slice(offset, offset + credentialLength);
    offset += credentialLength;
    const cose = decodeCbor(bytes, offset);
    offset = cose.offset;
    if (!(cose.value instanceof Map)) fail();
    const kty = cose.value.get(1);
    const alg = cose.value.get(3);
    const crv = cose.value.get(-1);
    const x = cose.value.get(-2);
    const y = cose.value.get(-3);
    if (kty !== 2 || alg !== -7 || crv !== 1 || !(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) fail();
    publicKeyJwk = Object.freeze({ kty: 'EC', crv: 'P-256', x: bytesToBase64Url(x), y: bytesToBase64Url(y), ext: true });
  }
  if (extensions) {
    if (offset >= bytes.length) fail();
    const decoded = decodeCbor(bytes, offset);
    offset = decoded.offset;
    if (!(decoded.value instanceof Map)) fail();
  }
  if (offset !== bytes.length) fail();
  return Object.freeze({ flags, counter, backupEligible, backupState, credentialId, publicKeyJwk });
}

function derIntegerTo32(bytes) {
  let value = bytes;
  /* DER may prefix a 0x00 sign byte when the magnitude's top bit is set. Strip
   * it and the remaining bytes are the unsigned coordinate: after stripping, a
   * high bit is a legitimate part of the magnitude, not a negative sign.
   * Rejecting it here failed roughly half of all P-256 assertions. */
  while (value.length > 32 && value[0] === 0) value = value.slice(1);
  if (!value.length || value.length > 32) fail();
  const output = new Uint8Array(32);
  output.set(value, 32 - value.length);
  return output;
}

export function derEcdsaToRaw(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (bytes.length === 64) return bytes;
  if (bytes.length < 8 || bytes[0] !== 0x30) fail();
  let offset = 1;
  let sequenceLength = bytes[offset++];
  if (sequenceLength & 0x80) {
    const width = sequenceLength & 0x7f;
    if (width < 1 || width > 2 || offset + width > bytes.length) fail();
    sequenceLength = 0;
    for (let index = 0; index < width; index += 1) sequenceLength = sequenceLength * 256 + bytes[offset++];
  }
  if (offset + sequenceLength !== bytes.length || bytes[offset++] !== 0x02) fail();
  const rLength = bytes[offset++];
  if (!rLength || offset + rLength > bytes.length) fail();
  const r = derIntegerTo32(bytes.slice(offset, offset + rLength));
  offset += rLength;
  if (bytes[offset++] !== 0x02) fail();
  const sLength = bytes[offset++];
  if (!sLength || offset + sLength !== bytes.length) fail();
  const s = derIntegerTo32(bytes.slice(offset, offset + sLength));
  return concatBytes(r, s);
}

function normalizeTransportList(value) {
  const allowed = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);
  return Object.freeze((Array.isArray(value) ? value : [])
    .map(item => String(item || ''))
    .filter(item => allowed.has(item))
    .slice(0, 8));
}

export async function verifyPasskeyRegistration({ response, expectedChallenge, rpId, allowedOrigins, cryptoImpl = globalThis.crypto } = {}) {
  const normalizedRpId = normalizeRpId(rpId);
  const origins = normalizeOrigins(allowedOrigins);
  const rawId = base64UrlToBytes(response?.rawId, MAX_CREDENTIAL_BYTES);
  const client = parseClientData(response?.clientDataJSON, 'webauthn.create', expectedChallenge, origins);
  const attestationBytes = base64UrlToBytes(response?.attestationObject, MAX_ATTESTATION_BYTES);
  const decoded = decodeCbor(attestationBytes);
  if (decoded.offset !== attestationBytes.length || !(decoded.value instanceof Map)) fail();
  const fmt = decoded.value.get('fmt');
  const authData = decoded.value.get('authData');
  const attStmt = decoded.value.get('attStmt');
  if (fmt !== 'none' || !(authData instanceof Uint8Array) || !(attStmt instanceof Map) || attStmt.size !== 0) fail();
  const parsed = await parseAuthenticatorData(authData, { rpId: normalizedRpId, registration: true, cryptoImpl });
  if (!timingSafeBytes(rawId, parsed.credentialId)) fail();
  return Object.freeze({
    credentialId: bytesToBase64Url(rawId),
    publicKeyJwk: parsed.publicKeyJwk,
    counter: parsed.counter,
    backupEligible: parsed.backupEligible,
    backupState: parsed.backupState,
    transports: normalizeTransportList(response?.transports),
    origin: client.data.origin
  });
}

export async function verifyPasskeyAuthentication({ response, expectedChallenge, rpId, allowedOrigins, credential, cryptoImpl = globalThis.crypto } = {}) {
  const normalizedRpId = normalizeRpId(rpId);
  const origins = normalizeOrigins(allowedOrigins);
  const rawId = base64UrlToBytes(response?.rawId, MAX_CREDENTIAL_BYTES);
  const expectedCredentialId = base64UrlToBytes(credential?.credentialId, MAX_CREDENTIAL_BYTES);
  if (!timingSafeBytes(rawId, expectedCredentialId)) fail(AUTH_ERROR_CODES.PASSKEY_NOT_FOUND);
  const client = parseClientData(response?.clientDataJSON, 'webauthn.get', expectedChallenge, origins);
  const authenticatorData = base64UrlToBytes(response?.authenticatorData, MAX_AUTHENTICATOR_BYTES);
  const parsed = await parseAuthenticatorData(authenticatorData, { rpId: normalizedRpId, registration: false, cryptoImpl });
  const signature = derEcdsaToRaw(base64UrlToBytes(response?.signature, MAX_SIGNATURE_BYTES));
  if (response?.userHandle) {
    const supplied = base64UrlToBytes(response.userHandle, 128);
    const expected = base64UrlToBytes(credential?.userHandle, 128);
    if (!timingSafeBytes(supplied, expected)) fail();
  }
  let key;
  try {
    key = await cryptoImpl.subtle.importKey('jwk', credential?.publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  } catch { fail(); }
  const clientHash = await sha256(client.bytes, cryptoImpl);
  let verified = false;
  try {
    verified = await cryptoImpl.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, concatBytes(authenticatorData, clientHash));
  } catch { fail(); }
  if (!verified) fail();
  const storedCounter = Math.max(0, Number(credential?.counter || 0));
  if (storedCounter > 0 && parsed.counter > 0 && parsed.counter <= storedCounter) fail();
  return Object.freeze({
    credentialId: bytesToBase64Url(rawId),
    counter: parsed.counter,
    backupEligible: parsed.backupEligible,
    backupState: parsed.backupState,
    origin: client.data.origin
  });
}

export const PASSKEY_ALGORITHM = -7;
