import { CloudflareNativeAuthEngine } from '../core/auth-engine.mjs';
import { asNativeAuthError, AUTH_ERROR_CODES, NativeAuthError } from '../core/errors.mjs';
import { reconcileIdentitySnapshot, summarizeIdentityHealth } from '../core/identity-reconciliation.mjs';
import { SqliteAuthRepository } from '../storage/sqlite-auth-repository.mjs';
import { VerificationOrchestrator } from '../verification/orchestrator.mjs';
import { createConfiguredVerificationProviders } from '../verification/providers.mjs';
import { SqliteVerificationRepository } from '../verification/sqlite-verification-repository.mjs';

const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff'
});

const response = (status, body, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { ...JSON_HEADERS, ...extraHeaders }
});

async function readJson(request) {
  const raw = await request.text();
  if (!raw || raw.length > 32_768) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);
  try { return JSON.parse(raw); } catch { throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT); }
}

export class AdmissionAuthAuthority {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.ready = state.blockConcurrencyWhile(async () => {
      this.repository = new SqliteAuthRepository(state.storage);
      this.repository.migrate();
      this.verificationRepository = new SqliteVerificationRepository(state.storage);
      this.verificationRepository.migrate();
      this.engine = new CloudflareNativeAuthEngine({
        repository: this.repository,
        hmacSecret: env.AUTH_HMAC_SECRET,
        securityConfigRaw: env.SECURITY_CONFIG_JSON
      });
      const persistedVerificationConfig = await this.verificationRepository.getRuntimeConfig();
      this.verification = new VerificationOrchestrator({
        repository: this.verificationRepository,
        hmacSecret: env.AUTH_HMAC_SECRET,
        config: persistedVerificationConfig || env.VERIFICATION_ORCHESTRATOR_CONFIG,
        providers: createConfiguredVerificationProviders(env),
        activated: ['canary', 'enabled'].includes(String(env.VERIFICATION_AUTH_ACTIVATION || ''))
      });
      // Phase 6 — the engine's security challenges reuse this orchestrator
      // for email/Telegram delivery.
      this.engine.bindVerification(this.verification);
    });
  }

  async #scheduleExpiry() {
    const expiries = await Promise.all([this.engine.nextExpiry(), this.verification.nextExpiry()]);
    const next = expiries.filter(Boolean).sort((left, right) => left - right)[0] || null;
    if (!next) return;
    const scheduled = await this.state.storage.getAlarm();
    if (!scheduled || next < scheduled) await this.state.storage.setAlarm(next);
  }

  async #verificationIdentity(input = {}) {
    const session = await this.engine.getFirebaseSession(input.sessionToken, {
      email: input.email,
      subject: input.subject
    });
    return { ...input, userId: session.user.id };
  }

  async #preverificationIdentity(input = {}, context = {}) {
    const material = await this.engine.getFirebaseAccountVerification(
      input.verificationTicket,
      input.email && input.subject ? { email: input.email, subject: input.subject } : {},
      context
    );
    return {
      material,
      verificationInput: {
        purpose: 'account-backup',
        trustedIdentity: {
          userId: material.userId,
          sessionRef: material.sessionRef,
          subjectRef: material.subjectRef,
          emailRef: material.emailRef
        }
      }
    };
  }

  async fetch(request) {
    try {
      await this.ready;
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/internal/ping') {
        return response(200, { ok: true, ...(await this.engine.ping()) });
      }
      if (request.method !== 'POST') return response(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED' } }, { Allow: 'POST' });
      const body = await readJson(request);
      if (url.pathname === '/internal/firebase/rate') {
        const result = await this.engine.consumeFirebaseOperation(body.input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/firebase/session/create') {
        const result = await this.engine.establishFirebaseSession(body.input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/firebase/session/get') {
        const result = await this.engine.getFirebaseSession(body.sessionToken, body.input);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/firebase/account-verification/begin') {
        const result = await this.engine.beginFirebaseAccountVerification(body.input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/firebase/account-verification/material') {
        const result = await this.engine.getFirebaseAccountVerification(body.verificationTicket, body.input || {}, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/firebase/account-verification/complete') {
        const result = await this.engine.completeFirebaseAccountVerification(body.input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/profile/save-pending') {
        const result = await this.engine.savePendingProfile(body.verificationTicket, body.input, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/profile/save') {
        const result = await this.engine.saveProfile(body.input, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/profile/get') {
        const result = await this.engine.getProfile(body.input, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/account/state') {
        const session = await this.engine.getFirebaseSession(body.sessionToken, body.input);
        const state = await this.repository.getAccountState({ userId: session.user.id, now: Date.now() });
        if (state.error) throw new NativeAuthError(state.error);
        return response(200, { ok: true, account: state });
      }
      if (url.pathname === '/internal/account/identities') {
        const session = await this.engine.getFirebaseSession(body.sessionToken, body.input);
        const identities = await this.repository.listLinkedIdentities({ userId: session.user.id });
        return response(200, { ok: true, identities });
      }
      if (url.pathname === '/internal/account/state/set') {
        const result = await this.repository.setAccountState({
          userId: String(body?.userId || '').slice(0, 256),
          toStatus: String(body?.status || ''),
          now: Date.now()
        });
        if (result.error) throw new NativeAuthError(result.error);
        await this.#scheduleExpiry();
        return response(200, { ok: true, account: result });
      }
      if (url.pathname === '/internal/identity/health') {
        const snapshot = await this.repository.identitySnapshot();
        const health = summarizeIdentityHealth(reconcileIdentitySnapshot(snapshot));
        return response(200, { ok: true, health });
      }
      if (url.pathname === '/internal/passkey/registration/begin') {
        const result = await this.engine.beginPasskeyRegistration(body.input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/passkey/registration/finish') {
        const result = await this.engine.finishPasskeyRegistration(body.input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/passkey/authentication/begin') {
        const result = await this.engine.beginPasskeyAuthentication(body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/passkey/authentication/finish') {
        const result = await this.engine.finishPasskeyAuthentication(body.input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/passkey/session/complete') {
        const result = await this.engine.completePasskeySession(body.input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/passkey/status') {
        const result = await this.engine.getPasskeyStatus(body.input, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/passkey/remove') {
        const result = await this.engine.removePasskey(body.input, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/capabilities') {
        const result = await this.verification.capabilities();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/request') {
        const input = await this.#verificationIdentity(body.input);
        const result = await this.verification.requestVerification(input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/preauth/request') {
        const prepared = await this.#preverificationIdentity(body.input, body.context);
        const result = await this.verification.requestVerification(prepared.verificationInput, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/preauth/pending') {
        const prepared = await this.#preverificationIdentity(body.input, body.context);
        const result = await this.verification.pendingVerification(prepared.verificationInput, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/preauth/verify') {
        const prepared = await this.#preverificationIdentity(body.input, body.context);
        const result = await this.verification.verify({
          ...prepared.verificationInput,
          attemptId: body.input.attemptId,
          code: body.input.code
        }, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/telegram/status') {
        const identity = await this.engine.getFirebaseIdentity(body.input, body.context);
        const result = await this.verification.isTelegramLinked({
          purpose: 'account-backup',
          trustedIdentity: {
            userId: identity.userId,
            sessionRef: identity.subjectRef,
            subjectRef: identity.subjectRef,
            emailRef: identity.emailRef
          }
        }, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/verify') {
        const input = await this.#verificationIdentity(body.input);
        const result = await this.verification.verify(input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/telegram/webhook') {
        const result = await this.verification.confirmTelegramWebhook(body.input);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/telegram/activate') {
        if (!['canary', 'enabled'].includes(this.env.VERIFICATION_AUTH_ACTIVATION)) throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
        await this.verification.updateConfig(this.env.VERIFICATION_ORCHESTRATOR_CONFIG);
        const result = await this.verification.configureTelegramWebhook();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/telegram/deactivate') {
        if (!['canary', 'enabled'].includes(this.env.VERIFICATION_AUTH_ACTIVATION)) throw new NativeAuthError(AUTH_ERROR_CODES.BACKUP_UNAVAILABLE);
        const result = await this.verification.removeTelegramWebhook();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/admin/status') {
        const result = await this.verification.adminStatus();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/verification/admin/config') {
        const result = await this.verification.updateConfig(body.config);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/session/get') {
        const result = await this.engine.getSession(body.sessionToken);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/session/revoke') {
        const result = await this.engine.revokeSession(body.sessionToken);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/session/revoke-all') {
        // Phase 6 — step-up-gated: the engine enforces recent-session or a
        // verified step-up challenge before any session is revoked.
        const result = await this.engine.revokeAllSessions({ ...(body.input || {}), sessionToken: body.sessionToken }, body.context);
        return response(200, { ok: true, result });
      }
      // Phase 6 — device trust + security state (internal; the public
      // /security/* surface lands with its own auth+shape in Chunk 4).
      if (url.pathname === '/internal/firebase/login/failure') {
        const result = await this.engine.recordLoginFailure(body.input, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/security/device/trust') {
        const result = await this.engine.trustCurrentDevice(body.input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/security/device/revoke') {
        const result = await this.engine.revokeTrustedDevice(body.input, body.context);
        await this.#scheduleExpiry();
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/security/state') {
        const result = await this.engine.getSecurityState(body.input, body.context);
        return response(200, { ok: true, result });
      }
      // Phase 6 — purpose-bound security challenges (§11-§12).
      if (url.pathname === '/internal/security/challenge/request') {
        const result = await this.engine.requestChallenge(body.input, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/security/challenge/verify') {
        const result = await this.engine.verifyChallenge(body.input, body.context);
        return response(200, { ok: true, result });
      }
      if (url.pathname === '/internal/security/challenge/cancel') {
        const result = await this.engine.cancelChallenge(body.input, body.context);
        return response(200, { ok: true, result });
      }
      return response(404, { ok: false, error: { code: 'NOT_FOUND' } });
    } catch (cause) {
      const error = asNativeAuthError(cause);
      return response(error.status, { ok: false, error: error.toPublic() }, error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {});
    }
  }

  async alarm() {
    try {
      await this.ready;
      await Promise.all([this.engine.cleanup(), this.verification.cleanup()]);
      const expiries = await Promise.all([this.engine.nextExpiry(), this.verification.nextExpiry()]);
      const next = expiries.filter(Boolean).sort((left, right) => left - right)[0] || null;
      if (next) await this.state.storage.setAlarm(next);
    } catch {
      await this.state.storage.setAlarm(Date.now() + 60 * 60 * 1000);
    }
  }
}
