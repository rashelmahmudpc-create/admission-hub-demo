# PHASE 9 ‚Äî AI AUDIT & MIGRATION PLAN (STOP POINT)

> Status: **AUDIT ONLY ‚Äî awaiting owner approval**
> Scope: Phase 9 blueprint, migration steps M1‚ÄìM4. No code changed in this PR.
> Baseline preserved: `AGENT_VERSION = agent-f1`, `SYSTEM_PROMPT_V = sys-f1-3-ai-personalization`.
> Baseline tests: `ai-agent-f1.test.mjs` **44/44 pass** (run before auditing).

---

## 1. Inventory (¬ß4) ‚Äî what already exists

| Question (¬ß4) | Finding |
|---|---|
| AI UI | `ai-agent-chat.js` (client, SSE), `ai-agent.js` (agent core, worker-side) |
| AI endpoints | `POST /api/ai` (non-stream), `POST /api/ai/chat` (SSE), `GET /api/ai/status`, `GET\|POST /api/ai/prefs` |
| Gateway | Single entry, both routes funnel into `agentChat()` |
| Provider adapters | `geminiStream()`, `groqStream()` ‚Äî generator interface with shared `ProviderError` |
| Providers | Google Gemini (primary, multi-key), Groq (fallback, text-only) |
| Model router | `routerChain(env, tier, badSet)` ‚Üí `GEMINI_MODELS.FAST/SMART` + Groq pair |
| Prompts | `buildSystemPrompt()` composed per-request; versioned by `SYSTEM_PROMPT_V` |
| Context | `buildSystemPrompt({stats, examMode, quiz, onboarding, prefs})` + `sanitizeOnboardingContext()` allowlist |
| Memory | `chatmem:<uid>` (KV), client-supplied history, `summarizeTo()` compaction |
| Personalization | `aiprefs:<uid>` (KV), `sanitizeAiPrefs()` allowlist, memory on/off honoured |
| Rate limit | `airl:<uid>:<day>` ‚Äî `AGENT_DAILY_CAP` (default 80/day) |
| Failover | `aibad:<provider>:<model>` mark, 24h TTL, per-request chain exclusion |
| Error handling | `ProviderError` ‚Üí 429 backoff, 502 retryable, 503 no-key |
| Streaming | SSE parser `sseParse()` + `geminiTextFromChunk()` |
| Safety gates | `safetyGate()` (mock-exam integrity), `authVerificationGuidance()`, `onboardingSecretDetected()` |
| Secrets | `GEMINI_KEYS`, `GROQ_API_KEY` ‚Äî worker env only, never in client |
| Tests | `ai-agent-f1.test.mjs` (44), `p21-ai-agent-ui.test.mjs`, `startup-ai-regression.test.mjs` |

## 2. Capability map (¬ß5)

| Capability | State |
|---|---|
| Chat + streaming | **WORKING** |
| Intent classification (`classifyIntent`) | **WORKING** |
| Model routing (FAST/SMART) | **WORKING** |
| Provider failover (Gemini ‚Üí Groq) | **WORKING** |
| Per-user rate limit | **WORKING** |
| Exam-integrity gate | **WORKING** |
| Onboarding assistant (strict mode) | **WORKING** |
| Per-user AI preferences | **WORKING** |
| Conversation memory | **PARTIALLY WORKING** ‚Äî session-scoped, no explicit long-term layer |
| Context engine | **PARTIALLY WORKING** ‚Äî flat stats/onboarding/prefs, no typed context categories |
| Prompt registry | **PARTIALLY WORKING** ‚Äî single version constant, no registry with `promptId/version/status` |
| Cost/quota tracking | **PARTIALLY WORKING** ‚Äî only a daily request counter |
| Tool registry | **MISSING** |
| Action permission layer (READ/WRITE/EXECUTE) | **MISSING** |
| Action confirmation + audit trail | **MISSING** |
| Response schema/validation layer | **MISSING** (free text except quiz JSON mode) |
| Memory metadata (reason/source/permission/timestamp/confidence) | **MISSING** |
| Formal short/long-term memory split | **MISSING** |

## 3. Existing AI ‚Üí target mapping (¬ß6, ¬ß7, ¬ß30)

```
CURRENT                                   TARGET (Phase 9)
POST /api/ai, /api/ai/chat        ‚Üí       AI Gateway (keep both paths)
agentChat()                       ‚Üí       AI Orchestrator
routerChain()                     ‚Üí       Model Router (behind adapter)
geminiStream/groqStream           ‚Üí       Provider Adapters (keep signature)
buildSystemPrompt()               ‚Üí       Context Engine + Prompt Registry
chatmem:<uid>                     ‚Üí       Memory Engine (short-term first)
aiprefs:<uid>                     ‚Üí       Personalization Bridge (keep)
airl:<uid>:<day>                  ‚Üí       Rate/Cost layer (extend)
```

Backward compatibility is required: `chat()` / `ask()` / `generate()`-style callers and the
`/api/ai*` response shape (`text`, `intent`, `pv`, `agent`, `authoritative`) must not change.

## 4. Security findings (¬ß28, ¬ß45, ¬ß47)

| # | Finding | Severity |
|---|---|---|
| S1 | AI provider keys are worker-env only; client requests carry no key (`ai-agent-chat.js` header note confirms). **PASS** | ‚Äî |
| S2 | Outbound Gemini key sits in a URL query string (`:streamGenerateContent?alt=sse&key=‚Ä¶`). Never logged by this code, but URL-borne secrets can leak via proxy/error logs. Recommend header-based auth (`x-goog-api-key`) before Phase 9 hardening. | **MEDIUM** |
| S3 | `firebase-messaging-sw.js` embeds a Firebase web `apiKey`. This is a **public Firebase config key**, not a secret ‚Äî it is required client-side and safe by design. Flagged only because the Phase 9 ¬ß28 checklist mentions client-visible keys. **No action required**; documented so the checklist item is explicitly closed. | INFO |
| S4 | Memory and prefs are keyed by `identity.uid` from `aiRequestIdentity`; `tests assert no shared/leaked keys between users`. **PASS** | ‚Äî |
| S5 | Onboarding secret detection fails closed before the model/rate/memory path. **PASS** | ‚Äî |
| S6 | No cross-user context path exists today because tools do not exist yet. This risk must be designed in **at** M6, not retrofitted. | **HIGH (future)** |

## 5. Phase 9 gap analysis (¬ß52 target vs today)

Missing ‚Üí required before Phase 9 completes:

1. **AI Gateway formalisation** ‚Äî extract an adapter boundary so callers stop touching providers.
2. **Context Engine** ‚Äî typed categories (Identity/Profile/Academic/Performance/Activity/Preference) with minimum-necessary + permission scope (NONE‚ÜíFULL_ALLOWED).
3. **Prompt Registry** ‚Äî `promptId / version / purpose / createdAt / status`, existing `SYSTEM_PROMPT_V` becomes `v1` (never deleted).
4. **Tool Registry** ‚Äî name/description/permission/inputSchema/outputSchema/riskLevel/enabled.
5. **READ / WRITE / EXECUTE separation** ‚Äî default READ-ONLY; no write/execute enabled by default.
6. **Action confirmation + audit trail** ‚Äî for any future write action.
7. **Response validation layer** ‚Äî schema/safety/data/action validation before UI render; structured `{type,message,insights,recommendations,actions,confidence}` where needed.
8. **Memory Engine** ‚Äî short-term + long-term with reason/source/permission/timestamp/confidence; long-term default empty.
9. **Cost/quota engine** ‚Äî token usage, request count, estimated cost, provider quota.
10. **Observability** ‚Äî request id, provider, model, latency, tokens, fallback reason, context/prompt version.

## 6. Migration plan (¬ß48) ‚Äî one step at a time, approval-gated

| Step | Deliverable | Risk | Reversible | Status |
|---|---|---|---|---|
| **M1** | This audit | none | n/a | **DONE** |
| **M2** | Adapter boundary ‚Äî normalized provider interface; zero behaviour change | low | yes | **DONE** (see ¬ß7) |
| **M2.5** | Cloudflare Workers AI backup ‚Äî first non-Gemini/Groq provider on the new boundary | low | yes | **DONE** (see ¬ß8) |
| **M3** | Formal Gateway ‚Äî single internal entry with feature flag `USE_AI_GATEWAY` | low | yes | superseded by M4 |
| **M4** | Context Engine ‚Äî typed, permission-scoped, minimum-necessary; legacy path kept | medium | yes | **DONE** (see ¬ß10) |
| **M5** | Prompt Registry ‚Äî existing prompt becomes `v1`; A/B before replacing | low | yes | **DONE** (see ¬ß12) |
| **M6** | Tool Registry ‚Äî READ-ONLY tools only; cross-user isolation enforced at the tool boundary | high | yes | pending |
| **M7** | Memory Engine ‚Äî long-term layer, default OFF, explicit consent | medium | yes | pending |
| **M8** | Response validation + structured output | medium | yes | pending |
| **M9** | Write/Execute actions ‚Äî disabled by default, confirmation required | high | yes | pending |
| **M10** | Observability, cost engine, full regression + hardening | low | yes | pending |

Rule (¬ß49): no step starts until the previous step is stable and approved.

## 7. M2 completion record ‚Äî Provider Adapter layer

**Where:** `ai-agent.js` (stays with the orchestrator deliberately ‚Äî a separate module
would create a circular import, since adapters reuse `geminiStream` / `groqStream` /
`ProviderError` / `routerChain`, which live here).

**What was added:**

| Symbol | Purpose |
|---|---|
| `GEMINI_ADAPTER` | `chatOnce()` (one-shot) + `chatStream()`; owns the `generateContent` URL and status‚Üí`ProviderError` mapping |
| `GROQ_ADAPTER` | `chatStream()` only; `chatOnce()` deliberately rejects (`oneShot: false`) because the non-stream route has always been Gemini-only |
| `PROVIDER_ADAPTERS` / `adapterFor(entry)` | registry + chain-entry ‚Üí adapter lookup; unknown providers return `null` instead of misrouting |
| `providerChain(env, tier, badSet)` | non-stream chain = router chain ‚à© adapters with a one-shot path |

**What changed at the call sites:** the orchestrator now dispatches via
`adapterFor(c)` / `GEMINI_ADAPTER.chatOnce()` / `adapter.chatStream()` instead of
touching provider URLs. The payload builders (`payloadG` / `payloadO`), the retry
loop, the bad-set marking and the response shapes are unchanged.

**Deliberate non-changes (preserve-first):**

- Public API and response shapes identical (`text`, `model`, `intent`, `pv`, `agent`, `authoritative`).
- Error codes and user-facing messages identical (`no_providers` 503, `provider_failed` 502/SSE, `mock_refused` 403).
- Prompt text, `SYSTEM_PROMPT_V`, `AGENT_VERSION`, model names and `GEMINI_KEYS`/`GROQ_API_KEY` handling identical.
- `routerChain` untouched and still exported (baseline test #16‚Äì18 depend on it).
- One internal detail line changed: a failed non-stream Gemini call now reports
  `detail: "Gemini HTTP 500 (<model>)"` instead of `"HTTP 500 <model>"`. This is a
  diagnostic-only field, not asserted by any test and not shown to students.

**Verification:**

- `ai-agent-f1.test.mjs` ‚Äî **44/44 pass** (baseline, unchanged).
- `ai-provider-adapters.test.mjs` ‚Äî **17/17 pass** (new: registry contract, chain
  filtering, honest Groq failure, structural "no raw URL in the orchestrator",
  and 3 E2E behaviour-parity checks).
- `startup-ai-regression.test.mjs` ‚Äî 22/22; `p21-ai-agent-ui.test.mjs`, `phase23-core.test.mjs`,
  `auth-protection.test.mjs`, `account-retirement.test.mjs` ‚Äî pass.
- `npm run build:worker` + `npm run check:worker-bundle` ‚Äî bundle in sync (738.2 kb).
- `npm run check:sw-manifest` ‚Äî sw.js digests regenerated.

**Rollback:** revert this one commit; the adapter layer is additive and nothing
else in the repo imports it.

**Next gate:** M3 (formal Gateway with `USE_AI_GATEWAY` feature flag) ‚Äî awaiting approval.

## 8. M2.5 completion record ‚Äî Cloudflare Workers AI backup

Added the first non-Gemini/Groq provider on top of the M2 boundary, to prove the
boundary actually makes provider expansion cheap.

**What was added:**

| Symbol | Purpose |
|---|---|
| `openAiCompatStream({url,key,model,payload,signal})` | one shared SSE reader for every OpenAI-wire-format provider; the next such provider is a URL + model list, not another copy-pasted reader |
| `CLOUDFLARE_ADAPTER` | `chatStream()` against `api.cloudflare.com/client/v4/accounts/<id>/ai/v1/chat/completions`; `chatOnce()` rejects (`oneShot: false`), same honesty rule as Groq |

**Router:** Cloudflare is appended **after** Gemini and Groq, and only when
**both** `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_API_KEY` are bound. Either
missing ‚Üí the slot is simply absent, exactly like a missing `GEMINI_KEYS`.
`AGENT_CLOUDFLARE_MODELS` (in `[vars]`, comma-separated) overrides the model
list because Cloudflare rotates its catalogue.

**Secrets:** account id and API token go in via `wrangler secret put` or the
dashboard (encrypted) ‚Äî never in `[vars]`. Test M2.5-ýßØ asserts the token never
appears in the request URL.

**Verification:** `ai-provider-adapters.test.mjs` 27/27 (10 new M2.5 cases,
including an E2E where Gemini *and* Groq both return 500 and Cloudflare streams
the answer); `ai-agent-f1.test.mjs` 44/44; bundle + sw-manifest clean.

**Known, unrelated:** `startup-ai-regression.test.mjs` case ýßßýß´ fails on the
current `origin/main` base as well ‚Äî reproduced with every M2.5 change stashed,
so it is pre-existing and not caused by this work.

**To activate:** bind the two secrets **and** make sure the dispatcher in
`gk-agent-worker.js` forwards them. `/api/ai/*` is served by `public-worker.js`,
which the `gk` worker invokes with a narrow `envPub` allowlist; a provider whose
bindings are not on that list is invisible however many secrets are bound. The
Cloudflare pair plus `AGENT_CLOUDFLARE_MODELS` are forwarded there, and
`account-retirement` guards the list. Then the provider joins the chain
automatically.



## 9. Mandatory STOP (¬ß54)

Per the blueprint, implementation must not begin without owner approval. The
owner approved continuing, so **M4 was implemented** while M3 (a formal Gateway
entry point) was folded into it: the Context Engine, not a renamed entry
function, is what the "AI must recognise the student" capability actually needs,
and the flag pattern M3 called for (`USE_AI_GATEWAY`) is carried by
`USE_CONTEXT_ENGINE` instead.

**Next gate:** M6 (Tool Registry — READ-ONLY tools) — awaiting approval.

## 10. M4 completion record ‚Äî Context Engine

**Deliverable:** `context-engine.js` ‚Äî a typed, permission-scoped, minimum-necessary
context layer, wired into `agentChat` behind `USE_CONTEXT_ENGINE` (default
`disabled`).

**What was added:**

| Symbol | Purpose |
|---|---|
| `CATEGORY` | typed categories: identity / profile / academic / performance / activity / preference / onboarding / memory |
| `SCOPE` + `scopeAtLeast` | ordered permission ladder NONE ‚Üí MINIMAL ‚Üí SUMMARY ‚Üí FULL_ALLOWED |
| `identityKind(uid)` | reads the server-side uid prefix (`account-` / `guest-`); the client can never claim a kind |
| `resolveScopes({uid, prefs, stats, onboarding, memoryOn})` | decides each category's scope; a category with no legitimate source resolves to NONE rather than being guessed at |
| `buildContext(input)` | immutable bundle; a NONE category carries no payload at all; the raw uid is never included, only its kind |
| `renderContext(bundle)` | renders only the allowed lines, and states the minimum-necessary rule to the model |
| `describeContext(bundle)` | PII-free allowed/denied summary, surfaced in `agentStatus.context` |

**Scopes today:** a signed-in `account-` uid gets identity SUMMARY (the AI knows
it is talking to a signed-in student, never who); a `guest-` uid gets identity
NONE. `profile` and `activity` are NONE until a real source exists. `preference`
and `onboarding` are FULL_ALLOWED only when they were actually supplied.

**Legacy path preserved:** with the flag `disabled`, `buildSystemPrompt` output is
byte-identical to the pre-M4 prompt ‚Äî asserted by test M4-ýßßýß¨ and the E2E pair
M4-ýßßýßÆ/ýßßýßØ (flag off ‚Üí no context block reaches the provider; flag on ‚Üí it does).

**Variables:** `USE_CONTEXT_ENGINE = "disabled"` in `[vars]`. The Worker sits on
the Workers Free 64-variable ceiling, so `AGENT_CLOUDFLARE_MODELS` was removed
from `[vars]` in exchange ‚Äî the router falls back to the identical default
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, so the Cloudflare backup is unaffected.

**Verification:** `phase9-m4-context-engine.test.mjs` **19/19**; regression
`ai-agent-f1` 44/44, `ai-provider-adapters` 27/27, `account-retirement` 31/31;
bundle in sync; deployed version `e950512f` reports
`providers.cloudflare: true` and `context: { enabled: false }`; guest chat E2E OK.

## 11. M4.1 — real student profile wiring

**Deliverable:** the signed-in student's academic profile now reaches the Context
Engine at SUMMARY scope, with identity fields stripped by two independent gates.
`profile` was NONE in M4 ("no source yet"); it is SUMMARY now that a source exists.

**Two gates, both required:**

1. **Client** (`ai-agent-chat.js`) — `localProfile()` projects the cached profile
   to an academic-only shape. It never reads `fullName`/`email`/`mobile`/`dob`/
   `bio`/`publicId`/avatar beyond the first-name token; `profilePayload()` then
   sends that shape as-is. Guests get `null`.
2. **Server** (`ai-agent.js`) — `sanitizeProfileContext(payload)` re-sanitizes the
   request body with an allowlist (unknown keys are dropped, not filtered), and
   the payload is only built when `uid.startsWith('account-')`.

**Name is automatic (no setting):** the AI learns the student's first name with
no setup at all — there is no toggle to switch on. Only a single name token
passes; a full name is rejected. Everything else in the profile (institution,
district, session, goal, subjects, targets) is shared at SUMMARY alongside it.
Other identity fields (mobile, email, DOB, bio, public AH-ID) never leave the
device.

**Scope + rendering:** `resolveScopes` resolves `profile: SUMMARY` only for an
`account-` uid carrying a sanitized payload — a guest stays NONE even if a payload
is smuggled in. `renderContext` emits one `profile (academic)` line.

**Verification:** `phase9-m4-context-engine.test.mjs` **29/29** (M4-২৮ proves the
name reaches the provider with no setup; M4-২৯ proves a full name still cannot);
`language-engine.test.mjs` 11/11; `ai-agent-f1` 44/44; full native-auth suite
497/499 — the two failures (`profile-core`, `session-recovery-chaos`) also fail on
a clean tree (better-sqlite3/Node v24 native crash), unrelated to this change.

## 12. M5 completion record — Prompt Registry

**Deliverable:** `prompt-registry.js` — the master system prompt text now lives in
a frozen registry entry instead of an inline template literal, carrying
`promptId / version / purpose / createdAt / status` plus a `legacyVersion` alias
back to `SYSTEM_PROMPT_V`. Old revisions are never deleted, so a future wording
change adds a new entry rather than overwriting `v1`.

**Public surface:** `getPrompt(id)`, `getPromptText(id)`, `listPrompts()`,
`validatePromptRegistry()`, `BASE_PROMPT_ID`, `PROMPT_REGISTRY_VERSION`.

**Zero behaviour change (the whole point).** `buildSystemPrompt()` now starts from
`getPromptText(BASE_PROMPT_ID)`; every conditional block (onboarding, exam mode,
quiz, prefs, stats) still appends on top, byte-for-byte as before. The composed
base prompt is SHA-256 `29f59a3e48ab27a7d284004cb784d457a7cd8f6378f3618ff724c1c2bcd01b7e`
(2044 bytes) — unchanged from the pre-M5 output, and pinned by a test so drift
fails loudly. The provider model, `SYSTEM_PROMPT_V`, `AGENT_VERSION` and the
`pv/agent` fields in every response are all untouched.

No A/B switch is exposed yet: M5 only establishes the registry and records `v1` as
active. An A/B harness is a later, separately-approved step.

**Verification:** `phase9-m5-prompt-registry.test.mjs` **10/10** — M5-৭/৮ lock the
byte-identical output and its hash, M5-৯ proves conditional blocks still extend
the shared base, M5-১০ counts the twelve hard rules. `ai-agent-f1` 44/44 and the
M4 suite 29/29 stay green; the full native-auth suite keeps its two pre-existing,
unrelated failures.

**Next gate:** M6 (Tool Registry — READ-ONLY) — awaiting owner approval.

