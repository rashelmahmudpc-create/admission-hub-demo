import { AUTH_ERROR_CODES } from '../core/errors.mjs';
import { constantTimeEqual } from '../core/crypto.mjs';
import { transitionAccount, isSessionUsable } from '../core/account-lifecycle.mjs';

const copy = value => value == null ? value : structuredClone(value);

export class MemoryAuthRepository {
  constructor() {
    this.usersByEmail = new Map();
    this.users = new Map();
    this.externalIdentities = new Map();
    this.sessions = new Map();
    this.rates = new Map();
    this.events = [];
    this.passkeyHandles = new Map();
    this.passkeys = new Map();
    this.passkeyChallenges = new Map();
    this.passkeyTickets = new Map();
    this.accountVerificationTickets = new Map();
    this.profiles = new Map();
    this.accountStates = new Map();
  }

  #consume(limits, now) {
    let denied = null;
    for (const limit of limits || []) {
      const start = Math.floor(now / limit.windowMs) * limit.windowMs;
      const id = `${limit.scope}:${limit.key}:${start}`;
      const row = this.rates.get(id) || { count: 0, resetAt: start + limit.windowMs };
      row.count += 1;
      this.rates.set(id, row);
      if (row.count > limit.limit) {
        const retryAfter = Math.max(1, Math.ceil((row.resetAt - now) / 1000));
        if (!denied || retryAfter > denied.retryAfter) denied = { error: AUTH_ERROR_CODES.RATE_LIMITED, retryAfter };
      }
    }
    return denied;
  }

  #canonicalSession({ sessionRef, subjectRef, emailRef, now }) {
    const session = this.sessions.get(sessionRef);
    if (!session || session.revokedAt || session.expiresAt <= now) return { error: AUTH_ERROR_CODES.SESSION_INVALID };
    const user = this.users.get(session.userId);
    const identity = this.externalIdentities.get(`firebase:${subjectRef}`);
    if (!user || !identity || identity.userId !== user.id || user.emailRef !== emailRef) return { error: AUTH_ERROR_CODES.SESSION_INVALID };
    if (user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    return { user };
  }

  #passkeyChallenge({ challengeId, candidateChallengeMac, deviceRef, kind, now }) {
    const row = this.passkeyChallenges.get(challengeId);
    if (!row || row.kind !== kind || row.deviceRef !== deviceRef || !constantTimeEqual(row.challengeMac, candidateChallengeMac) || row.state !== 'active') {
      return { error: AUTH_ERROR_CODES.PASSKEY_INVALID };
    }
    if (row.expiresAt <= now) {
      row.state = 'expired'; row.challengeMac = ''; row.refreshCipher = '';
      return { error: AUTH_ERROR_CODES.PASSKEY_INVALID };
    }
    return { challenge: row };
  }

  async consumeLimits({ limits, now, eventType, subjectRef }) {
    const denied = this.#consume(limits, now);
    if (denied) return denied;
    this.events.push({ type: eventType, subjectRef, at: now });
    return { accepted: true };
  }

  async establishExternalSession(input) {
    const identityKey = `${input.provider}:${input.subjectRef}`;
    const identity = this.externalIdentities.get(identityKey);
    let user = identity ? this.users.get(identity.userId) : this.usersByEmail.get(input.emailRef);
    let created = false;
    if (identity && !user) return { error: AUTH_ERROR_CODES.STORAGE_UNAVAILABLE };
    if (!identity && user) {
      const existing = [...this.externalIdentities.values()].find(row => row.provider === input.provider && row.userId === user.id);
      if (existing && existing.subjectRef !== input.subjectRef) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
    }
    if (!user) {
      user = {
        id: input.userIdCandidate,
        emailRef: input.emailRef,
        emailMask: input.emailMask,
        status: 'active',
        createdAt: input.now,
        lastLoginAt: input.now
      };
      this.usersByEmail.set(input.emailRef, user);
      this.users.set(user.id, user);
      created = true;
    }
    if (user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    if (identity && user.emailRef !== input.emailRef) {
      const emailOwner = this.usersByEmail.get(input.emailRef);
      if (emailOwner && emailOwner.id !== user.id) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
      this.usersByEmail.delete(user.emailRef);
      user.emailRef = input.emailRef;
      user.emailMask = input.emailMask;
      this.usersByEmail.set(input.emailRef, user);
    }
    if (!identity) {
      this.externalIdentities.set(identityKey, {
        provider: input.provider,
        subjectRef: input.subjectRef,
        userId: user.id,
        createdAt: input.now,
        lastVerifiedAt: input.now
      });
    } else identity.lastVerifiedAt = input.now;
    user.lastLoginAt = input.now;
    this.sessions.set(input.sessionRef, {
      sessionRef: input.sessionRef,
      userId: user.id,
      createdAt: input.now,
      expiresAt: input.sessionExpiresAt,
      lastSeenAt: input.now,
      revokedAt: null,
      ipRef: input.ipRef,
      deviceRef: input.deviceRef,
      userAgent: input.userAgent
    });
    this.events.push({ type: created ? 'firebase-account-linked' : 'firebase-login', subjectRef: input.subjectRef, userId: user.id, at: input.now });
    return { established: true, created, user: copy(user) };
  }

  async getExternalSession({ sessionRef, provider, subjectRef, emailRef, now }) {
    const session = this.sessions.get(sessionRef);
    if (!session || session.revokedAt || session.expiresAt <= now) return { error: AUTH_ERROR_CODES.SESSION_INVALID };
    const user = this.users.get(session.userId);
    const identity = this.externalIdentities.get(`${provider}:${subjectRef}`);
    if (!user || !identity || identity.userId !== user.id || user.emailRef !== emailRef) return { error: AUTH_ERROR_CODES.SESSION_INVALID };
    if (user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    if (now - session.lastSeenAt > 6 * 60 * 60 * 1000) session.lastSeenAt = now;
    return { expiresAt: session.expiresAt, user: copy(user) };
  }

  async beginFirebaseAccountVerification(input) {
    const denied = this.#consume(input.limits, input.now);
    if (denied) return denied;
    const identity = this.externalIdentities.get(`firebase:${input.subjectRef}`);
    let user = identity ? this.users.get(identity.userId) : this.usersByEmail.get(input.emailRef);
    if (identity && !user) return { error: AUTH_ERROR_CODES.STORAGE_UNAVAILABLE };
    if (!identity && user) {
      const existing = this.externalIdentities.get(`firebase:${input.subjectRef}`)
        || [...this.externalIdentities.values()].find(row => row.provider === 'firebase' && row.userId === user.id);
      if (existing && existing.subjectRef !== input.subjectRef) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
    }
    if (!user) {
      user = {
        id: input.userIdCandidate,
        emailRef: input.emailRef,
        emailMask: input.emailMask,
        status: 'active',
        createdAt: input.now,
        lastLoginAt: input.now
      };
      this.users.set(user.id, user);
      this.usersByEmail.set(user.emailRef, user);
    }
    if (user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    if (user.emailRef !== input.emailRef) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
    if (!identity) {
      this.externalIdentities.set(`firebase:${input.subjectRef}`, {
        provider: 'firebase', subjectRef: input.subjectRef, userId: user.id,
        createdAt: input.now, lastVerifiedAt: input.now
      });
    }
    for (const row of this.accountVerificationTickets.values()) {
      if (row.userId === user.id && row.state === 'active') { row.state = 'superseded'; row.refreshCipher = ''; }
    }
    this.accountVerificationTickets.set(input.ticketRef, {
      ticketRef: input.ticketRef,
      userId: user.id,
      subjectRef: input.subjectRef,
      emailRef: input.emailRef,
      refreshCipher: input.refreshCipher,
      state: 'active',
      createdAt: input.now,
      expiresAt: input.expiresAt,
      consumedAt: null,
      ipRef: input.ipRef,
      deviceRef: input.deviceRef
    });
    return { prepared: true, user: copy(user) };
  }

  async getFirebaseAccountVerification(input) {
    const row = this.accountVerificationTickets.get(input.ticketRef);
    if (!row || row.deviceRef !== input.deviceRef || row.state !== 'active') return { error: AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID };
    if (row.expiresAt <= input.now) { row.state = 'expired'; row.refreshCipher = ''; return { error: AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID }; }
    const user = this.users.get(row.userId);
    if (!user || user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    return { ...copy(row), emailMask: user.emailMask, status: user.status, createdAt: user.createdAt };
  }

  async completeFirebaseAccountVerification(input) {
    const row = this.accountVerificationTickets.get(input.ticketRef);
    if (!row || row.deviceRef !== input.deviceRef || row.state !== 'active' || row.expiresAt <= input.now
      || row.subjectRef !== input.subjectRef || row.emailRef !== input.emailRef) {
      return { error: AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID };
    }
    const user = this.users.get(row.userId);
    if (!user || user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    row.state = 'consumed'; row.refreshCipher = ''; row.consumedAt = input.now;
    this.sessions.set(input.sessionRef, {
      sessionRef: input.sessionRef, userId: user.id, createdAt: input.now,
      expiresAt: input.sessionExpiresAt, lastSeenAt: input.now, revokedAt: null,
      ipRef: input.ipRef, deviceRef: input.deviceRef, userAgent: input.userAgent
    });
    user.lastLoginAt = input.now;
    return { established: true, user: copy(user) };
  }

  async getFirebaseIdentity(input) {
    const identity = this.externalIdentities.get(`firebase:${input.subjectRef}`);
    const user = identity ? this.users.get(identity.userId) : null;
    if (!user || user.emailRef !== input.emailRef) return { error: AUTH_ERROR_CODES.SESSION_INVALID };
    if (user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    return { user: copy(user) };
  }

  async savePendingProfile(input) {
    const ticket = this.accountVerificationTickets.get(input.ticketRef);
    if (!ticket || ticket.deviceRef !== input.deviceRef || ticket.state !== 'active' || ticket.expiresAt <= input.now) {
      return { error: AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID };
    }
    const user = this.users.get(ticket.userId);
    if (!user || user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    const previous = this.profiles.get(user.id);
    const profile = { ...copy(input.profile), createdAt: previous?.createdAt || input.now, updatedAt: input.now };
    this.profiles.set(user.id, profile);
    return { saved: true, profile: copy(profile) };
  }

  async saveProfile(input) {
    const session = this.#canonicalSession(input);
    if (session.error) return session;
    const previous = this.profiles.get(session.user.id);
    const profile = { ...copy(input.profile), createdAt: previous?.createdAt || input.now, updatedAt: input.now };
    this.profiles.set(session.user.id, profile);
    return { saved: true, profile: copy(profile) };
  }

  async getProfile(input) {
    const session = this.#canonicalSession(input);
    if (session.error) return session;
    return { profile: copy(this.profiles.get(session.user.id) || null) };
  }

  async beginPasskeyRegistration(input) {
    const denied = this.#consume(input.limits, input.now);
    if (denied) return denied;
    const session = this.#canonicalSession(input);
    if (session.error) return session;
    let userHandle = this.passkeyHandles.get(session.user.id);
    if (!userHandle) { userHandle = input.userHandleCandidate; this.passkeyHandles.set(session.user.id, userHandle); }
    for (const row of this.passkeyChallenges.values()) {
      if (row.kind === 'registration' && row.userId === session.user.id && row.state === 'active') {
        row.state = 'superseded'; row.challengeMac = ''; row.refreshCipher = '';
      }
    }
    this.passkeyChallenges.set(input.challengeId, {
      challengeId: input.challengeId,
      challengeMac: input.challengeMac,
      kind: 'registration',
      userId: session.user.id,
      subjectRef: input.subjectRef,
      userHandle,
      refreshCipher: input.refreshCipher,
      state: 'active',
      createdAt: input.now,
      expiresAt: input.expiresAt,
      ipRef: input.ipRef,
      deviceRef: input.deviceRef
    });
    const credentials = [...this.passkeys.values()]
      .filter(row => row.userId === session.user.id && row.status === 'active')
      .map(row => ({ credentialId: row.credentialId, transports: row.transports }));
    return { user: copy(session.user), userHandle, credentials: copy(credentials) };
  }

  async getPasskeyRegistrationChallenge(input) {
    const selected = this.#passkeyChallenge({ ...input, kind: 'registration' });
    if (selected.error) return selected;
    const session = this.#canonicalSession(input);
    if (session.error) return session;
    if (session.user.id !== selected.challenge.userId || input.subjectRef !== selected.challenge.subjectRef) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
    return { ...copy(selected.challenge), user: copy(session.user) };
  }

  async finishPasskeyRegistration(input) {
    const selected = this.#passkeyChallenge({ ...input, kind: 'registration' });
    if (selected.error) return selected;
    const challenge = selected.challenge;
    if (this.passkeys.has(input.credential.credentialId)) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
    this.passkeys.set(input.credential.credentialId, {
      ...copy(input.credential),
      credentialId: input.credential.credentialId,
      userId: challenge.userId,
      subjectRef: challenge.subjectRef,
      userHandle: challenge.userHandle,
      status: 'active',
      createdAt: input.now,
      lastUsedAt: null
    });
    challenge.state = 'consumed'; challenge.challengeMac = ''; challenge.refreshCipher = ''; challenge.consumedAt = input.now;
    const user = this.users.get(challenge.userId);
    const count = [...this.passkeys.values()].filter(row => row.userId === challenge.userId && row.status === 'active').length;
    return { registered: true, credentialCount: count, user: copy(user) };
  }

  async beginPasskeyAuthentication(input) {
    const denied = this.#consume(input.limits, input.now);
    if (denied) return denied;
    for (const row of this.passkeyChallenges.values()) {
      if (row.kind === 'authentication' && row.deviceRef === input.deviceRef && row.state === 'active') {
        row.state = 'superseded'; row.challengeMac = '';
      }
    }
    this.passkeyChallenges.set(input.challengeId, {
      challengeId: input.challengeId,
      challengeMac: input.challengeMac,
      kind: 'authentication',
      userId: null,
      subjectRef: null,
      userHandle: null,
      refreshCipher: '',
      state: 'active',
      createdAt: input.now,
      expiresAt: input.expiresAt,
      ipRef: input.ipRef,
      deviceRef: input.deviceRef
    });
    return { prepared: true };
  }

  async getPasskeyAuthenticationMaterial(input) {
    const selected = this.#passkeyChallenge({ ...input, kind: 'authentication' });
    if (selected.error) return selected;
    const credential = this.passkeys.get(input.credentialId);
    if (!credential || credential.status !== 'active') return { error: AUTH_ERROR_CODES.PASSKEY_NOT_FOUND };
    const user = this.users.get(credential.userId);
    if (!user || user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    return { credential: copy({
      credentialId: credential.credentialId,
      userHandle: credential.userHandle,
      publicKeyJwk: credential.publicKeyJwk,
      counter: credential.counter
    }) };
  }

  async issuePasskeyTicket(input) {
    const selected = this.#passkeyChallenge({ ...input, kind: 'authentication' });
    if (selected.error) return selected;
    const credential = this.passkeys.get(input.credentialId);
    if (!credential || credential.status !== 'active') return { error: AUTH_ERROR_CODES.PASSKEY_NOT_FOUND };
    if (Number(credential.counter || 0) !== Number(input.previousCounter || 0)) return { error: AUTH_ERROR_CODES.PASSKEY_INVALID };
    credential.counter = Math.max(Number(credential.counter || 0), Number(input.nextCounter || 0));
    credential.backupState = Boolean(input.backupState);
    credential.lastUsedAt = input.now;
    selected.challenge.state = 'consumed'; selected.challenge.challengeMac = ''; selected.challenge.consumedAt = input.now;
    for (const ticket of this.passkeyTickets.values()) if (ticket.credentialId === credential.credentialId && ticket.state === 'active') ticket.state = 'expired';
    this.passkeyTickets.set(input.ticketRef, {
      ticketRef: input.ticketRef,
      credentialId: credential.credentialId,
      userId: credential.userId,
      subjectRef: credential.subjectRef,
      deviceRef: input.deviceRef,
      state: 'active',
      createdAt: input.now,
      expiresAt: input.expiresAt
    });
    return { issued: true, refreshCipher: credential.refreshCipher, subjectRef: credential.subjectRef };
  }

  async completePasskeySession(input) {
    const ticket = this.passkeyTickets.get(input.ticketRef);
    if (!ticket || ticket.state !== 'active' || ticket.deviceRef !== input.deviceRef || ticket.subjectRef !== input.subjectRef) return { error: AUTH_ERROR_CODES.PASSKEY_INVALID };
    if (ticket.expiresAt <= input.now) { ticket.state = 'expired'; return { error: AUTH_ERROR_CODES.PASSKEY_INVALID }; }
    const user = this.users.get(ticket.userId);
    const identity = this.externalIdentities.get(`firebase:${input.subjectRef}`);
    if (!user || !identity || identity.userId !== user.id) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
    if (user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    if (user.emailRef !== input.emailRef) {
      const owner = this.usersByEmail.get(input.emailRef);
      if (owner && owner.id !== user.id) return { error: AUTH_ERROR_CODES.ACCOUNT_CONFLICT };
      this.usersByEmail.delete(user.emailRef);
      user.emailRef = input.emailRef;
      user.emailMask = input.emailMask;
      this.usersByEmail.set(input.emailRef, user);
    }
    const credential = this.passkeys.get(ticket.credentialId);
    if (!credential || credential.status !== 'active') return { error: AUTH_ERROR_CODES.PASSKEY_NOT_FOUND };
    ticket.state = 'consumed'; ticket.consumedAt = input.now;
    credential.refreshCipher = input.refreshCipher; credential.lastUsedAt = input.now;
    this.sessions.set(input.sessionRef, {
      sessionRef: input.sessionRef,
      userId: user.id,
      createdAt: input.now,
      expiresAt: input.sessionExpiresAt,
      lastSeenAt: input.now,
      revokedAt: null,
      ipRef: input.ipRef,
      deviceRef: input.deviceRef,
      userAgent: input.userAgent
    });
    user.lastLoginAt = input.now;
    return { established: true, user: copy(user) };
  }

  async getPasskeyStatus(input) {
    const session = this.#canonicalSession(input);
    if (session.error) return session;
    const credentials = [...this.passkeys.values()]
      .filter(row => row.userId === session.user.id && row.subjectRef === input.subjectRef && row.status === 'active')
      .map(row => ({ id: row.credentialId, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt, synced: Boolean(row.backupEligible), backedUp: Boolean(row.backupState) }));
    return { count: credentials.length, credentials: copy(credentials) };
  }

  async removePasskey(input) {
    const session = this.#canonicalSession(input);
    if (session.error) return session;
    const credential = this.passkeys.get(input.credentialId);
    if (!credential || credential.userId !== session.user.id || credential.subjectRef !== input.subjectRef || credential.status !== 'active') return { error: AUTH_ERROR_CODES.PASSKEY_NOT_FOUND };
    credential.status = 'revoked'; credential.refreshCipher = ''; credential.revokedAt = input.now;
    for (const ticket of this.passkeyTickets.values()) if (ticket.credentialId === credential.credentialId && ticket.state === 'active') ticket.state = 'expired';
    const count = [...this.passkeys.values()].filter(row => row.userId === session.user.id && row.status === 'active').length;
    return { removed: true, credentialCount: count };
  }

  async getSession({ sessionRef, now }) {
    const session = this.sessions.get(sessionRef);
    if (!session || session.revokedAt || session.expiresAt <= now) return { error: AUTH_ERROR_CODES.SESSION_INVALID };
    const user = this.users.get(session.userId);
    if (!user) return { error: AUTH_ERROR_CODES.SESSION_INVALID };
    if (user.status !== 'active') return { error: AUTH_ERROR_CODES.ACCOUNT_DISABLED };
    if (now - session.lastSeenAt > 6 * 60 * 60 * 1000) session.lastSeenAt = now;
    return { expiresAt: session.expiresAt, user: copy(user) };
  }

  async revokeSession({ sessionRef, now }) {
    const session = this.sessions.get(sessionRef);
    if (!session || session.revokedAt) return { revoked: false };
    session.revokedAt = now;
    return { revoked: true };
  }

  async identitySnapshot() {
    const users = [...this.users.values()]
      .filter(user => user && user.id)
      .map(user => Object.freeze({ id: user.id, status: user.status }));
    const externalIdentities = [...this.externalIdentities.values()]
      .filter(row => row && row.provider && row.subjectRef)
      .map(row => Object.freeze({ provider: row.provider, subjectRef: row.subjectRef, userId: row.userId }));
    return Object.freeze({ users: Object.freeze(users), externalIdentities: Object.freeze(externalIdentities) });
  }

  async listLinkedIdentities({ userId }) {
    const rows = [...this.externalIdentities.values()]
      .filter(row => row && row.userId === userId)
      .sort((a, b) => String(a.provider).localeCompare(String(b.provider)));
    return Object.freeze(rows.map(row => Object.freeze({
      provider: String(row.provider),
      linked: true,
      verified: Boolean(row.lastVerifiedAt),
      lastVerifiedAt: Number(row.lastVerifiedAt || 0),
      linkedAt: Number(row.createdAt || 0)
    })));
  }

  async getAccountState({ userId, now }) {
    if (!this.users.has(userId)) return { error: AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND };
    const row = this.accountStates.get(userId);
    return Object.freeze({
      userId,
      status: row ? row.status : 'active',
      stateVersion: row ? row.stateVersion : 0,
      updatedAt: row ? row.updatedAt : 0,
      now: Number(now)
    });
  }

  async setAccountState({ userId, toStatus, now }) {
    if (!this.users.has(userId)) return { error: AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND };
    const row = this.accountStates.get(userId);
    const currentStatus = row ? row.status : 'active';
    let target;
    try {
      target = transitionAccount(currentStatus, toStatus);
    } catch {
      return { error: AUTH_ERROR_CODES.ACCOUNT_STATE_INVALID };
    }
    if (target === currentStatus) {
      return Object.freeze({ userId, status: target, stateVersion: row ? row.stateVersion : 0, changed: false, revokedSessions: 0 });
    }
    const version = (row ? row.stateVersion : 0) + 1;
    this.accountStates.set(userId, { status: target, stateVersion: version, createdAt: row ? row.createdAt : now, updatedAt: now });
    let revoked = 0;
    if (!isSessionUsable(target)) {
      for (const session of this.sessions.values()) {
        if (session.userId === userId && !session.revokedAt) {
          session.revokedAt = now;
          revoked += 1;
        }
      }
      this.events.push({ type: 'account-sessions-revoked', userId, at: now });
    }
    this.events.push({ type: 'account-state-changed', userId, at: now });
    return Object.freeze({ userId, status: target, stateVersion: version, changed: true, revokedSessions: revoked });
  }

  async ping() {
    return { ok: true, storage: 'memory-test', schema: 4, users: this.users.size };
  }

  async cleanup(now) {
    for (const row of this.accountVerificationTickets.values()) {
      if (row.state === 'active' && row.expiresAt <= now) { row.state = 'expired'; row.refreshCipher = ''; }
    }
    for (const [id, row] of this.accountVerificationTickets) if (row.expiresAt < now - (24 * 60 * 60 * 1000)) this.accountVerificationTickets.delete(id);
    for (const [id, row] of this.passkeyChallenges) if (row.expiresAt <= now) this.passkeyChallenges.delete(id);
    for (const [id, row] of this.passkeyTickets) if (row.expiresAt <= now) this.passkeyTickets.delete(id);
    for (const [id, row] of this.sessions) if (row.expiresAt <= now || row.revokedAt) this.sessions.delete(id);
    for (const [id, row] of this.rates) if (row.resetAt <= now) this.rates.delete(id);
    return { cleaned: true };
  }

  async nextExpiry(now) {
    const values = [
      ...[...this.accountVerificationTickets.values()].filter(row => row.state === 'active' && row.expiresAt > now).map(row => row.expiresAt),
      ...[...this.passkeyChallenges.values()].filter(row => row.expiresAt > now).map(row => row.expiresAt),
      ...[...this.passkeyTickets.values()].filter(row => row.expiresAt > now).map(row => row.expiresAt),
      ...[...this.sessions.values()].filter(row => row.expiresAt > now && !row.revokedAt).map(row => row.expiresAt),
      ...[...this.rates.values()].filter(row => row.resetAt > now).map(row => row.resetAt)
    ];
    return values.length ? Math.min(...values) : null;
  }

  snapshot() {
    return copy({
      users: [...this.users.values()],
      externalIdentities: [...this.externalIdentities.values()],
      sessions: [...this.sessions.values()],
      rates: [...this.rates.entries()],
      events: this.events,
      passkeyHandles: [...this.passkeyHandles.entries()],
      passkeys: [...this.passkeys.values()],
      passkeyChallenges: [...this.passkeyChallenges.values()],
      passkeyTickets: [...this.passkeyTickets.values()],
      accountVerificationTickets: [...this.accountVerificationTickets.values()],
      profiles: [...this.profiles.entries()]
    });
  }
}
