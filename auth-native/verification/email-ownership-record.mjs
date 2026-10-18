// AUTH-ROADMAP step 1: write the email-ownership link for an account that was
// created only after its signup code was proven (pending signup). Same row shape
// and conflict rule as SqliteVerificationRepository's verified-challenge path,
// kept here so the large repository file is not rewritten.
import { AUTH_ERROR_CODES } from '../core/errors.mjs';

const UPSERT = `INSERT INTO auth_email_ownership_links(
  user_id,subject_ref,email_ref,provider_id,method,status,proven_at,last_verified_at,revoked_at
) VALUES(?,?,?,?,'email-otp','active',?,?,NULL)
ON CONFLICT(user_id) DO UPDATE SET
  status='active',provider_id=excluded.provider_id,last_verified_at=excluded.last_verified_at,revoked_at=NULL`;

export async function recordEmailOwnership(repository, input = {}) {
  const row = {
    userId: String(input.userId || ''),
    subjectRef: String(input.subjectRef || ''),
    emailRef: String(input.emailRef || ''),
    providerId: String(input.providerId || 'otp').slice(0, 32),
    now: Number(input.now || Date.now())
  };
  if (!row.userId || !row.subjectRef || !row.emailRef) return { error: AUTH_ERROR_CODES.INVALID_INPUT };
  if (typeof repository?.recordEmailOwnership === 'function') return repository.recordEmailOwnership(row);
  const sql = repository?.sql;
  if (!sql || typeof sql.exec !== 'function') return { error: AUTH_ERROR_CODES.STORAGE_UNAVAILABLE };
  const existing = Array.from(sql.exec(
    'SELECT email_ref AS emailRef,subject_ref AS subjectRef FROM auth_email_ownership_links WHERE user_id=?',
    row.userId
  ))[0];
  if (existing && (existing.subjectRef !== row.subjectRef || existing.emailRef !== row.emailRef)) {
    return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
  }
  sql.exec(UPSERT, row.userId, row.subjectRef, row.emailRef, row.providerId, row.now, row.now);
  return { recorded: true, emailOwnershipProven: true };
}
