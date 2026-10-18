#!/usr/bin/env python3
"""AUTH step 1 (করণীয় ৩–৪): wire the pending signup into the DO and the public
handler with a few anchored lines. Logic lives in pending-signup-authority.mjs and
pending-signup-public.mjs. Idempotent: a second run changes nothing."""
import pathlib, sys

def patch(path, edits):
    p = pathlib.Path(path)
    text = p.read_text(encoding='utf-8')
    for marker, old, new, count in edits:
        if marker in text:
            continue
        found = text.count(old)
        if found != count:
            sys.exit(f'{path}: anchor found {found}x, expected {count}: {old[:70]!r}')
        text = text.replace(old, new)
    p.write_text(text, encoding='utf-8')

DO = 'auth-native/worker/auth-authority-do.mjs'
patch(DO, [
    ("from './pending-signup-authority.mjs'",
     "import { normalizeAuthEmail } from '../core/crypto.mjs';\n",
     "import { normalizeAuthEmail } from '../core/crypto.mjs';\n"
     "import { PendingSignupStore } from './pending-signup.mjs';\n"
     "import { handlePendingSignupRoute, isPendingSignupRoute } from './pending-signup-authority.mjs';\n", 1),
    ("this.pendingSignups = new PendingSignupStore",
     "      this.engine.bindVerification(this.verification);\n",
     "      this.engine.bindVerification(this.verification);\n"
     "      // AUTH-ROADMAP step 1: account-less signup rows (DO KV, prefix psu:).\n"
     "      try { this.pendingSignups = new PendingSignupStore({ storage: state.storage, hmacSecret: env.AUTH_HMAC_SECRET }); } catch { this.pendingSignups = null; }\n", 1),
    ("this.pendingSignups?.nextExpiry()",
     "await Promise.all([this.engine.nextExpiry(), this.verification.nextExpiry()]);",
     "await Promise.all([this.engine.nextExpiry(), this.verification.nextExpiry(), this.pendingSignups?.nextExpiry() ?? null]);", 2),
    ("this.pendingSignups?.cleanup()",
     "await Promise.all([this.engine.cleanup(), this.verification.cleanup()]);",
     "await Promise.all([this.engine.cleanup(), this.verification.cleanup(), this.pendingSignups?.cleanup()]);", 1),
    ("isPendingSignupRoute(url.pathname)",
     "      if (url.pathname === '/internal/firebase/rate') {\n",
     "      if (isPendingSignupRoute(url.pathname)) {\n"
     "        const result = await handlePendingSignupRoute(this, url.pathname, body);\n"
     "        await this.#scheduleExpiry();\n"
     "        return response(200, { ok: true, result });\n"
     "      }\n"
     "      if (url.pathname === '/internal/firebase/rate') {\n", 1),
])

H = 'auth-native/worker/public-auth-handler.mjs'
patch(H, [
    ("from './pending-signup-public.mjs'",
     "} from '../verification/telegram-login.mjs';\n",
     "} from '../verification/telegram-login.mjs';\n"
     "import { isPendingSignupTicket } from './pending-signup.mjs';\n"
     "import * as pendingSignup from './pending-signup-public.mjs';\n", 1),
    ("const pendingDeps = ",
     "export function createNativeAuthHandler(",
     "const pendingDeps = () => ({ callAuthority, json, authSuccess, verificationCookie, deviceCookie, providerError });\n\n"
     "export function createNativeAuthHandler(", 1),
    ("pendingSignup.beginPendingSignup(",
     "        const prepared = await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'signup', email: input.email }, context });\n",
     "        const prepared = await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'signup', email: input.email }, context });\n"
     "        // AUTH-ROADMAP step 1: an opted-in dual-choice signup holds the credentials; no account until the code is proven.\n"
     "        if (telegramRequested && pendingSignup.pendingSignupRequested(request)) return pendingSignup.beginPendingSignup({ request, env, context, prepared, password: input.password, deps: pendingDeps() });\n", 1),
    ("pendingSignup.startPendingSignupCode(",
     "        const magicLink = startBody?.method === 'magic-link';\n"
     "        await verifyTurnstile({ env, token: startBody?.turnstileToken, ip: context.ip, fetchImpl });\n",
     "        const magicLink = startBody?.method === 'magic-link';\n"
     "        await verifyTurnstile({ env, token: startBody?.turnstileToken, ip: context.ip, fetchImpl });\n"
     "        if (isPendingSignupTicket(verificationTicket)) return pendingSignup.startPendingSignupCode({ request, env, provider, context, ticket: verificationTicket, magicLink, deps: pendingDeps() });\n", 1),
    ("pendingSignup.verifyPendingSignupCodeAndCreate(",
     "        if (!codeOk || !/^[A-Za-z0-9_-]{24,96}$/.test(attemptId)) {\n"
     "          throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);\n"
     "        }\n",
     "        if (!codeOk || !/^[A-Za-z0-9_-]{24,96}$/.test(attemptId)) {\n"
     "          throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);\n"
     "        }\n"
     "        if (isPendingSignupTicket(verificationTicket)) {\n"
     "          if (magicToken) throw new NativeAuthError(AUTH_ERROR_CODES.INVALID_INPUT);\n"
     "          return pendingSignup.verifyPendingSignupCodeAndCreate({ request, env, provider, context, ticket: verificationTicket, attemptId, code, deps: pendingDeps() });\n"
     "        }\n", 1),
    ("x-ah-auth-ui, x-ah-signup-flow",
     "'Access-Control-Allow-Headers': 'content-type, x-ah-admin-token, x-ah-auth-ui',",
     "'Access-Control-Allow-Headers': 'content-type, x-ah-admin-token, x-ah-auth-ui, x-ah-signup-flow',", 1),
    ("pendingSignup.savePendingSignupProfile(",
     "        await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'pending-profile-write' }, context });\n",
     "        await callAuthority(env, '/internal/firebase/rate', { input: { operation: 'pending-profile-write' }, context });\n"
     "        if (isPendingSignupTicket(verificationTicket)) return pendingSignup.savePendingSignupProfile({ request, env, context, ticket: verificationTicket, profile, deps: pendingDeps() });\n", 1),
])

patch('package.json', [
    ("verification-orchestrator.test.mjs pending-signup.test.mjs",
     "verification-orchestrator.test.mjs verification-providers.test.mjs",
     "verification-orchestrator.test.mjs pending-signup.test.mjs pending-signup-wire.test.mjs verification-providers.test.mjs", 1),
])
print('pending signup wired')
