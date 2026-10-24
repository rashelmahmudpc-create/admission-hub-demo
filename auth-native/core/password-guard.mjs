// Password guard (P29): escalating lockout after repeated wrong passwords.
//
// Two scales, because the two surfaces carry different risk. An ordinary
// login tolerates a burst of typos; an admin surface does not. The frozen
// defaults are the owner's numbers (2026-10-24):
//
//   user  - 3 wrong passwords in a minute -> 5 hours. After the block two
//           more chances; wrong again -> 1 day.
//   admin - every wrong password escalates: 5 min, 7 h, 2 days, 7 days.
//
// The module decides, it does not store. Wire it to KV with
// createKvPasswordGuard, or to anything exposing { get, put }.
//
// A block is deliberately not resettable by a correct password: otherwise an
// attacker who guesses right learns that the guess was right by the fact that
// the block lifted. Only the clock (or the recovery path in the handler)
// clears it.

export const PASSWORD_GUARD_POLICY_VERSION = 'password-guard-v1';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const PASSWORD_GUARD_SCALES = Object.freeze({
  user: Object.freeze({
    name: 'user',
    windowMs: MINUTE,
    triggers: Object.freeze([3, 2]),
    stepsMs: Object.freeze([5 * HOUR, 1 * DAY])
  }),
  admin: Object.freeze({
    name: 'admin',
    windowMs: 0,
    triggers: Object.freeze([1, 1, 1, 1]),
    stepsMs: Object.freeze([5 * MINUTE, 7 * HOUR, 2 * DAY, 7 * DAY])
  })
});

export function resolvePasswordGuardScale(scale) {
  if (typeof scale === 'string') return PASSWORD_GUARD_SCALES[scale] || PASSWORD_GUARD_SCALES.user;
  if (scale && typeof scale === 'object' && Array.isArray(scale.stepsMs) && scale.stepsMs.length) {
    const windowMs = Number.isFinite(scale.windowMs) && scale.windowMs > 0 ? scale.windowMs : 0;
    const triggers = (Array.isArray(scale.triggers) && scale.triggers.length ? scale.triggers : [1])
      .map(value => Math.max(1, Math.floor(Number(value) || 1)));
    return { name: String(scale.name || 'custom'), windowMs, triggers, stepsMs: scale.stepsMs.slice() };
  }
  return PASSWORD_GUARD_SCALES.user;
}

export function emptyGuardState() {
  return { fails: 0, windowStartedAt: 0, strikes: 0, until: 0, lastAt: 0 };
}

// Never trust a stored record: KV entries can be old, hand-edited or written
// by an earlier policy version, and a malformed one must fail closed to the
// empty state rather than to a negative block.
export function normalizeGuardState(raw) {
  if (!raw) return emptyGuardState();
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return emptyGuardState();
    }
  }
  if (!value || typeof value !== 'object') return emptyGuardState();
  const number = key => {
    const n = Math.floor(Number(value[key]));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return {
    fails: number('fails'),
    windowStartedAt: number('windowStartedAt'),
    strikes: number('strikes'),
    until: number('until'),
    lastAt: number('lastAt')
  };
}

function triggerFor(strikes, scale) {
  const list = scale.triggers;
  return list[Math.min(Math.max(strikes, 0), list.length - 1)];
}

function stepFor(strikes, scale) {
  const list = scale.stepsMs;
  return list[Math.min(Math.max(strikes - 1, 0), list.length - 1)] || 0;
}

export function guardDecision(state, now, scale = PASSWORD_GUARD_SCALES.user) {
  const resolved = resolvePasswordGuardScale(scale);
  const current = normalizeGuardState(state);
  const blocked = current.until > now;
  const needed = triggerFor(current.strikes, resolved);
  return Object.freeze({
    policyVersion: PASSWORD_GUARD_POLICY_VERSION,
    scale: resolved.name,
    blocked,
    retryAfterMs: blocked ? current.until - now : 0,
    retryAfterSeconds: blocked ? Math.ceil((current.until - now) / 1000) : 0,
    strikes: current.strikes,
    fails: current.fails,
    attemptsRemaining: Math.max(0, needed - current.fails),
    // The recovery path is the handler's job; the guard only states that a
    // blocked identity must be offered one.
    recoveryRequired: blocked
  });
}

export function recordPasswordFailure(state, now, scale = PASSWORD_GUARD_SCALES.user) {
  const resolved = resolvePasswordGuardScale(scale);
  const current = normalizeGuardState(state);

  // Inside an active block a further wrong guess must not extend the block:
  // otherwise an attacker (or the owner mistyping) turns 5 minutes into
  // forever, and the delay stops being predictable.
  if (current.until > now) {
    return Object.freeze({ state: current, decision: guardDecision(current, now, resolved), escalated: false });
  }

  const windowExpired = resolved.windowMs > 0 && now - current.windowStartedAt > resolved.windowMs;
  const fails = (windowExpired ? 0 : current.fails) + 1;
  const windowStartedAt = windowExpired || !current.windowStartedAt ? now : current.windowStartedAt;

  let next = { fails, windowStartedAt, strikes: current.strikes, until: current.until, lastAt: now };
  let escalated = false;

  if (fails >= triggerFor(current.strikes, resolved)) {
    const strikes = current.strikes + 1;
    next = { fails: 0, windowStartedAt: 0, strikes, until: now + stepFor(strikes, resolved), lastAt: now };
    escalated = true;
  }

  return Object.freeze({ state: next, decision: guardDecision(next, now, resolved), escalated });
}

export function recordPasswordSuccess(state, now, scale = PASSWORD_GUARD_SCALES.user) {
  const resolved = resolvePasswordGuardScale(scale);
  const current = normalizeGuardState(state);
  // A correct password during a block proves nothing: the caller must not be
  // able to clear its own block by guessing right. The handler refuses the
  // login and the state is left untouched.
  if (current.until > now) return current;
  return { ...emptyGuardState(), lastAt: now };
}

// KV-backed store. Cloudflare KV requires expirationTtl >= 60, so a short
// cooldown still gets a minute of life - harmless, the clock governs the
// decision and the record is read again on the next attempt anyway.
export function createKvPasswordGuard(store, options = {}) {
  const prefix = String(options.prefix || 'pwfail');
  const clock = typeof options.now === 'function' ? options.now : () => Date.now();

  const keyFor = (scope, identity) => `${prefix}:${scope}:${identity}`;

  async function read(scope, identity) {
    const raw = await store.get(keyFor(scope, identity));
    return normalizeGuardState(raw);
  }

  async function write(scope, identity, state, scale) {
    const resolved = resolvePasswordGuardScale(scale);
    const ttlMs = Math.max(60_000, state.until - clock(), resolved.windowMs * 2);
    await store.put(keyFor(scope, identity), JSON.stringify(state), { expirationTtl: Math.ceil(ttlMs / 1000) });
  }

  // Two counters per attempt - account and IP - so neither can be attacked
  // through the other: a shared IP must not lock out an account, and a
  // rotating IP must not escape the account counter.
  async function each(identities, run) {
    const results = [];
    for (const entry of identities) {
      if (!entry || !entry.identity) continue;
      results.push(await run(String(entry.scope || 'account'), String(entry.identity)));
    }
    return results;
  }

  return Object.freeze({
    policyVersion: PASSWORD_GUARD_POLICY_VERSION,

    async check(identities, scale) {
      const decisions = await each(identities, async (scope, identity) => guardDecision(await read(scope, identity), clock(), scale));
      return decisions.reduce(
        (worst, current) => (!worst || current.retryAfterMs > worst.retryAfterMs ? current : worst),
        null
      );
    },

    async recordFailure(identities, scale) {
      const decisions = await each(identities, async (scope, identity) => {
        const result = recordPasswordFailure(await read(scope, identity), clock(), scale);
        await write(scope, identity, result.state, scale);
        return result.decision;
      });
      return decisions.reduce(
        (worst, current) => (!worst || current.retryAfterMs > worst.retryAfterMs ? current : worst),
        null
      );
    },

    async recordSuccess(identities, scale) {
      await each(identities, async (scope, identity) => {
        const cleared = recordPasswordSuccess(await read(scope, identity), clock(), scale);
        await write(scope, identity, cleared, scale);
        return cleared;
      });
      return true;
    }
  });
}
