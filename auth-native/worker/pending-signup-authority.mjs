// AUTH-ROADMAP step 1 (করণীয় ৩): Durable Object routes for the account-less
// signup. The DO only holds the pending row and sends/checks the code; the
// public handler creates the Firebase account after `verify` succeeds.
import { AUTH_ERROR_CODES, NativeAuthError } from '../core/errors.mjs';
import { normalizeAuthEmail } from '../core/crypto.mjs';
import { recordEmailOwnership } from '../verification/email-ownership-record.mjs';
import { requestPendingSignupCode, verifyPendingSignupCode } from './pending-signup.mjs';

export const PENDING_SIGNUP_ROUTE_PREFIX = '/internal/signup/pending/';
const ACTIONS = new Set(['begin', 'profile', 'request', 'verify', 'ownership', 'consume']);
const fail = code => { throw new NativeAuthError(code); };
const plain = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

export const isPendingSignupRoute = pathname => typeof pathname === 'string'
  && pathname.startsWith(PENDING_SIGNUP_ROUTE_PREFIX)
  && ACTIONS.has(pathname.slice(PENDING_SIGNUP_ROUTE_PREFIX.length));

// `authority` is the AdmissionAuthAuthority instance (pendingSignups,
// verification, verificationRepository, engine).
export async function handlePendingSignupRoute(authority, pathname, body = {}) {
  const store = authority.pendingSignups;
  if (!store) fail(AUTH_ERROR_CODES.STORAGE_UNAVAILABLE);
  const action = pathname.slice(PENDING_SIGNUP_ROUTE_PREFIX.length);
  const input = plain(body?.input);
  const context = plain(body?.context);
  const ticket = String(input.ticket || '');
  if (action === 'begin') {
    return store.begin({ email: input.email, password: input.password, profile: input.profile || null, context });
  }
  if (action === 'profile') return store.saveProfile(ticket, plain(input.profile), context);
  if (action === 'request') {
    const held = await store.material(ticket, context);
    const recipientName = String(held.profile?.fullName || '').slice(0, 80);
    try {
      return await requestPendingSignupCode({ store, orchestrator: authority.verification, ticket, context, recipientName });
    } catch (cause) {
      // Every OTP provider is down: hand the held credentials back once so the
      // handler can create the account and fall back to the Firebase link.
      if (!(cause instanceof NativeAuthError) || cause.code !== AUTH_ERROR_CODES.BACKUP_UNAVAILABLE) throw cause;
      return Object.freeze({ accepted: false, fallback: true, email: held.email, password: held.password, profile: held.profile, emailMasked: held.emailMask });
    }
  }
  if (action === 'verify') {
    return verifyPendingSignupCode({
      store, orchestrator: authority.verification, ticket, context,
      attemptId: input.attemptId, code: input.code
    });
  }
  if (action === 'ownership') {
    const held = await store.material(ticket, context);
    if (!held.verified) fail(AUTH_ERROR_CODES.OTP_INVALID);
    if (normalizeAuthEmail(input.email) !== held.email) fail(AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID);
    const account = await authority.engine.getFirebaseAccountVerification(
      input.verificationTicket, { email: input.email, subject: input.subject }, context
    );
    const result = await recordEmailOwnership(authority.verificationRepository, {
      userId: account.userId,
      subjectRef: account.subjectRef,
      emailRef: account.emailRef,
      providerId: held.challenge?.providerId || 'otp'
    });
    if (result?.error) fail(result.error);
    return Object.freeze({ recorded: true, emailOwnershipProven: true });
  }
  return store.consume(ticket, context);
}
