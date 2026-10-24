import { claimsAuthPath } from './public-auth-handler.mjs';

/**
 * F-04 phase 2: send the auth surface to its own Worker, without ever leaving
 * the student without a working login.
 *
 * The switch is a var, not a deploy: `AUTH_ROUTE = "service"` forwards, anything
 * else (including a typo, or a missing binding) keeps the in-process handler that
 * has been serving these routes all along. Flipping it back is instant and needs
 * no code change, which is the whole point of doing the move this way.
 */
export const AUTH_ROUTE_MODES = Object.freeze({ local: 'local', service: 'service' });

export function authRouteMode(env) {
  const requested = String(env?.AUTH_ROUTE || '').trim().toLowerCase();
  if (requested !== AUTH_ROUTE_MODES.service) return AUTH_ROUTE_MODES.local;
  const binding = env?.AUTH_WORKER;
  // A named mode with no usable binding is a configuration mistake, not an
  // instruction to stop logging people in.
  return binding && typeof binding.fetch === 'function' ? AUTH_ROUTE_MODES.service : AUTH_ROUTE_MODES.local;
}

/**
 * @param local   the in-process handler; its contract is unchanged (it returns
 *                null for paths it does not own)
 * @param forward optional override used by tests; defaults to the binding
 */
export async function routeAuthRequest({ request, env, ctx, local, forward = null }) {
  if (authRouteMode(env) === AUTH_ROUTE_MODES.local) return local(request, env, ctx);

  let pathname;
  try {
    pathname = new URL(request.url).pathname;
  } catch (_) {
    return local(request, env, ctx);
  }
  // Only what the auth Worker owns is forwarded. Everything else has to keep
  // falling through the app's own chain exactly as it does today, and the one
  // shared predicate is what guarantees the two sides cannot disagree.
  if (!claimsAuthPath(pathname)) return local(request, env, ctx);

  try {
    // Clone first: a service binding reads the body, and the fallback below has
    // to be able to send the very same POST (signup is a POST with a body).
    const response = await (forward ? forward(request.clone()) : env.AUTH_WORKER.fetch(request.clone()));
    if (response) return response;
  } catch (_) {
    // Transport failure: fall through and answer in process rather than fail a
    // login that the old path can still complete.
  }
  return local(request, env, ctx);
}
