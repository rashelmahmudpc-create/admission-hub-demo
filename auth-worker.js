// F-04 phase 1: the admission-auth Worker.
//
// This script is the auth surface on its own. It answers exactly the routes
// `createNativeAuthHandler` claims and nothing else — any other path is a 404,
// so it can never turn into a second copy of the app by accident.
//
// It deliberately owns no data. AUTH_AUTHORITY is bound cross-script to
// `admission-gk` (wrangler.auth.toml), so the Durable Object keeps its storage,
// its sessions and its pending OTPs exactly where they are: a Durable Object id
// is scoped to the script that declares the class, so redeclaring the class here
// would have handed every student a blank authority.
//
// Phase 1 has no traffic: nothing routes to this Worker yet. Phase 2 flips
// `AUTH_ROUTE` on admission-gk to `service` once this script is verified.
import { createNativeAuthHandler } from './auth-native/worker/public-auth-handler.mjs';

const nativeAuthHandler = createNativeAuthHandler();

export default {
  async fetch(request, env, ctx) {
    const response = await nativeAuthHandler(request, env, ctx);
    if (response) return response;
    return new Response('Not found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }
};
