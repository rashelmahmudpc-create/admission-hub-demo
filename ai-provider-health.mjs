/**
 * P28 — provider chain health (owner voice note 2026-10-16: "বর্তমানে এআই উত্তর
 * দিচ্ছে না কেন").
 *
 * TWO DEFECTS FOUND BY MEASURING THE LIVE PATH, NOT BY GUESSING
 * -------------------------------------------------------------
 * Gemini's streaming endpoint (`streamGenerateContent`) was answering **503
 * UNAVAILABLE** — "high demand, try again later" — while its *non-streaming*
 * endpoint answered 200 for the same model seconds apart. That is a transient
 * capacity blip, not a dead key.
 *
 * 1. A transient 503 poisoned the model for a whole day. The adapters set
 *    `bad: status >= 500`, and a `bad` entry is remembered under
 *    `aibad:<key>:<model>:<day>` with a 24-hour TTL, then filtered out of every
 *    later request that day. Both Gemini models were split across 17 keys, so
 *    one short outage could mark the entire Gemini tier — the first 34 entries
 *    of a 52-entry chain — as unusable. With every Gemini entry filtered the
 *    chain held only the fallbacks; if those were bad too (OpenRouter answered
 *    402 here), the chain was empty and the route failed instantly with
 *    "AI-সেবা এখন কনফিগার করা নেই" — which reads as "the AI is switched off",
 *    not "a model was briefly busy".
 *
 * 2. Nothing ever brought a model back. The only thing that clears a bad mark is
 *    the day-boundary key rollover, so a five-minute blip could disable the
 *    primary tier until midnight.
 *
 * THE FIX
 * -------
 * A 5xx is transient and gets a short cooldown; only a genuine credential
 * problem (401/402/403) keeps the day-long ban, and 429 keeps its own short
 * window because quota refills. A cooled-down model is retried automatically
 * once the cooldown passes, so recovery needs no operator action.
 *
 * The chain is also made never-empty whenever any key exists: if every entry is
 * cooling down, the least-recently-failed entries come back for one attempt
 * rather than the request failing outright. The half-open retry lives here, in
 * the chain builder, so the streaming loop (which learns only by throwing) is
 * untouched.
 */

export const HEALTH = Object.freeze({
  /* A 5xx means "busy right now", not "broken". Two minutes is long enough to
     stop hammering an overloaded model and short enough that a blip heals
     inside the same session. */
  TRANSIENT_COOLDOWN_S: 120,
  /* 429 is a quota clock: refills are usually per-minute. */
  RATE_LIMIT_COOLDOWN_S: 60,
  /* Bad credentials (401/402/403) genuinely need a human, so they keep the long
     window. The adapter already 403/401s a revoked key. */
  CREDENTIAL_BAN_S: 86400
});

/** Classify an HTTP status into the cooldown it earns, or null for no ban. */
export function cooldownForStatus(status) {
  const s = Number(status);
  if (!Number.isFinite(s)) return null;
  if (s === 401 || s === 402 || s === 403) return HEALTH.CREDENTIAL_BAN_S;
  if (s === 429) return HEALTH.RATE_LIMIT_COOLDOWN_S;
  if (s >= 500 && s <= 599) return HEALTH.TRANSIENT_COOLDOWN_S;
  return null;
}

/**
 * Is this entry healthy enough to try?
 *
 * `marker` is the value stored under the bad key. Older deployments stored the
 * string '1' with no expiry; those keep the original day-long behaviour so an
 * upgrade cannot resurrect a key that was deliberately banned. A JSON marker
 * carries `until`, and once that passes the entry is retried.
 */
export function isEntryHealthy(marker, now) {
  if (!marker) return true;
  if (marker === '1' || marker === 1 || marker === true) return false;
  let parsed = marker;
  if (typeof marker === 'string') {
    try { parsed = JSON.parse(marker); } catch (_) { return false; }
  }
  if (!parsed || typeof parsed !== 'object') return false;
  const until = Number(parsed.until) || 0;
  return until <= now;
}

/**
 * Build the chain that will actually be walked.
 *
 * Entries whose cooldown has passed come back first, then — only when nothing at
 * all is healthy — the whole list returns so the request is retried rather than
 * refused. That last part is what stops a transient outage from reading to the
 * student as "the AI is turned off".
 */
export function healthyChain(entries, badMap, now) {
  const list = Array.isArray(entries) ? entries : [];
  const fresh = list.filter(e => isEntryHealthy(badMap[e.sig], now));
  if (fresh.length) return fresh;
  return list.slice();
}

/** The value to store for a failed entry. */
export function failureMarker(status, now) {
  const cooldown = cooldownForStatus(status);
  if (cooldown == null) return null;
  return JSON.stringify({ until: now + cooldown * 1000, status: Number(status) });
}
