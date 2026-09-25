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
| Conversation memory | **WORKING** — short-term (`chatmem:<uid>`) plus a typed long-term `mem-v1` layer |
| Context engine | **PARTIALLY WORKING** ‚Äî flat stats/onboarding/prefs, no typed context categories |
| Prompt registry | **PARTIALLY WORKING** ‚Äî single version constant, no registry with `promptId/version/status` |
| Cost/quota tracking | **PARTIALLY WORKING** ‚Äî only a daily request counter |
| Tool registry | **MISSING** |
| Action permission layer (READ/WRITE/EXECUTE) | **MISSING** |
| Action confirmation + audit trail | **MISSING** |
| Response schema/validation layer | **MISSING** (free text except quiz JSON mode) |
| Memory metadata (reason/source/permission/timestamp/confidence) | **WORKING** — every `mem-v1` record carries source/confidence/reason/ts/ownerUid |
| Formal short/long-term memory split | **WORKING** — `chatmem:<uid>` short-term + typed `mem-v1` long-term |

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
| **M6** | Tool Registry ‚Äî READ-ONLY tools only; cross-user isolation enforced at the tool boundary | high | yes | **DONE** (see ¬ß13) |
| **M7** | Memory Engine — long-term layer (owner override: automatic, no toggle) | medium | yes | **DONE** (see §14) |
| **M8** | Response validation + structured output | medium | yes | **DONE** (see §15) |
| **M9** | Write/Execute actions ‚Äî disabled by default, confirmation required | high | yes | **DONE** (see §16) |
| **M10** | Observability, cost engine, full regression + hardening | low | yes | **DONE** (see §18) |

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

**Next gate:** M7 (Memory Engine — long-term, default OFF) — awaiting approval.

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

**Next gate:** M7 (Memory Engine — long-term layer, default OFF) — awaiting owner approval.

## 13. M6 completion record — Tool Registry

**Deliverable:** `tool-registry.js` — a typed tool declaration layer plus the
cross-user isolation guard that finding S6 required at M6 rather than later.
`tool-registry.js` is pure data and pure guards: no `env`, no I/O, no worker API,
and **nothing executes**. One tool is declared —
`student.progress.read`, READ-only, owner-scoped, low risk, schema'd on both
sides — and registered as enabled because READ-only is the one class Phase 9
permits. Enabled is not wired: the chat path in `ai-agent.js` never calls the
registry, so no capability is reachable at runtime.

**Public surface:** `PERMISSION`, `RISK`, `REQUIRED_TOOL_FIELDS`,
`getTool`, `listTools`, `validateToolRegistry`, `resolveToolOwner`,
`authorizeToolCall`, `guardToolResult`, `TOOL_REGISTRY_VERSION`.

**Cross-user isolation (the high-risk part).** The owner of a tool call is
derived from the server-validated uid alone, never merged with anything the model
or the request body supplied:

- `resolveToolOwner(uid)` returns the uid only for an `account-` prefix; a guest
  returns `null`, so a guest can never own a call.
- `authorizeToolCall()` denies unless the tool exists, is enabled, is READ-only,
  has a resolvable owner, **and** the arguments carry no owner-ish key
  (`uid`/`ownerUid`/`owner`/`userId`/`accountId`/`user`/`account`/`deviceId`).
  The `owner` it returns is always the caller.
- `guardToolResult()` is the second gate: a result whose `ownerUid` is missing or
  differs from the caller is treated as a leak and blocked, not trusted.

**No behaviour change.** The prompt text and its SHA-256 are untouched
(`29f59a3e…01b7e`), and no new env binding is required — `agentStatus` now also
advertises the declared tools under `tools: { version, declared }`, metadata only.

**Verification:** `phase9-m6-tool-registry.test.mjs` **15/15** — M6-৭/৮ deny a
guest and an unknown tool, M6-৯ rejects all eight owner-ish argument keys, M6-১০
proves the returned owner is the caller, M6-১১/১২ block a mismatched or empty
result, and M6-১৩ asserts the chat path wires no execution. M4 29/29, M5 10/10,
`ai-agent-f1` 44/44, guards and `check:worker-bundle` stay green; the full
native-auth suite keeps its two pre-existing, unrelated failures.

**Next gate:** M7 (Memory Engine) — awaiting owner approval.

## 14. M7 completion record — Memory Engine (long-term layer)

**Deliverable:** `memory-engine.js` — the long-term half of the memory split the
audit flagged as missing (finding: *"Formal short/long-term memory split —
MISSING"*, *"Memory metadata (reason/source/permission/timestamp/confidence) —
MISSING"*). The short-term layer is unchanged (`chatmem:<uid>`, rolling window,
`summarizeTo` compaction). The long-term layer is typed: every record carries
`kind / key / value / source / confidence / reason / ts / ownerUid`.

**Owner decision — deliberate deviation from the plan.** The plan's M7 gate read
*"long-term layer, default OFF, explicit consent"*. The owner overrode it: memory
is **automatic** for a signed-in student, with **no toggle, no consent prompt and
no expiry**. That is what `mem-v1` implements. The change is a product decision,
not a relaxation of the safety boundary — everything below still holds.

**Public surface:** `MEMORY_VERSION`, `KIND`, `SOURCE`, `CONFIDENCE_MIN`,
`MAX_RECORDS`, `RENDER_LIMIT`, `getKinds`, `sanitizeMemoryText`, `isPiiFree`,
`resolveMemoryOwner`, `makeMemory`, `upsertMemory`, `parseMemory`,
`guardMemoryRecord`, `validateMemoryEngine`, `isRetentionRequest`,
`extractMemoryCandidates`, `renderMemory`.

**What is remembered.** Exactly three kinds — `studies` (weak/strong topics,
goals), `preference` (answer style), `habit` (study routine). Nothing else is
storable, and `makeMemory()` rejects anything outside that set.

**How memory gets in.** Both triggers the owner asked for are recognised in
`extractMemoryCandidates()`: an explicit *"মনে রাখো"* (source `user_stated`,
confidence ≥ 0.8) and a study/preference/habit fact stated in passing (source
`ai_inferred`, confidence 0.7–0.8). A candidate still has to clear
`makeMemory()` — weak signals never store.

**Boundaries that did not change with the owner override.**

- **Guests have no memory at all.** A guest has no durable identity, so
  `resolveMemoryOwner()` returns `null` for anything that is not `account-`.
  Guest AI is now refused outright: `agentChat` returns `401 sign_in_required`
  before any parsing, and the chat client plus the quiz generator both stop
  before the request. `identity.uid` alone is the owner — nothing the request
  body or the model claims can set it.
- **No PII, ever.** `isPiiFree()` flags email, BD mobile, long digit runs, ISO
  and slash dates, and password/OTP/PIN/CVV wording. A record whose value or
  reason trips any pattern is refused at both write and read.
- **Cross-user isolation is a second gate.** `parseMemory()`,
  `upsertMemory()` and `guardMemoryRecord()` all drop a record whose `ownerUid`
  is not the caller; `upsertMemory` never merges a foreign record.
- **Bounded storage, not a retention policy.** Records never expire; a safety
  valve trims the oldest beyond `MAX_RECORDS` (500) so a KV value cannot grow
  without bound. Rendering caps at `RENDER_LIMIT` (24) so the prompt stays clean.

**No toggle, no metadata surface.** M7 is invisible by design: the AI
Personalization sheet's MEMORY switch and its `memory` preference field are
removed (`sanitizeAiPrefs` no longer accepts `memory`), and `agentStatus` merely
advertises `memory: { version: 'mem-v1', mode: 'auto', scope: 'account-only' }`.
The base prompt text and its SHA-256 are untouched (`29f59a3e…01b7e`).

**Verification:** `phase9-m7-memory-engine.test.mjs` **33/33** — the engine
shape (M7-১/২), PII rejection (M7-৪/১১), guest/foreign isolation (M7-৬/৭/৮/১৩/
১৪/১৫), confidence and kind gates (M7-৯/১০), both extraction triggers
(M7-১৭…২২), the removal of the toggle (M7-২৪), the unchanged prompt hash
(M7-২৭), and end-to-end store/recall plus a refused guest write (M7-২৯…৩৩).
M4 29/29, M5 10/10, M6 15/15, `ai-agent-f1` 44/44, `account-data-isolation`
3/3, guards and `check:worker-bundle` stay green; the full native-auth suite
keeps its two pre-existing, unrelated failures (`profile-core`,
`session-recovery-chaos`).

**Next gate:** awaiting owner direction for the milestone after M7.


## 15. M8 completion record — Response Validation + Structured Output

**Where:** `response-validator.js` (pure data + pure guards — no `env`, no I/O, no
model call). `ai-agent.js` calls it in `finalize()` for the persist decision and
again around the provider loop for the returned text; `ai-agent-chat.js` learned
one new SSE frame.

**What it does (§52 gap 7).** Every model response is checked on four dimensions
before it reaches the UI or memory:

1. **Schema** — non-empty string, bounded length (`MAX_RESPONSE_LEN` 24000).
2. **Safety** — internal-leak, credential-request, secret-material, false-success
   and action-claim classes (see `VIOLATION`).
3. **Data** — a sentence that attributes a number to the student's own stats and
   contradicts the stat the caller supplied is flagged as `invented-stats`.
4. **Action** — a claimed save/delete/update is an `action-claim`; the envelope's
   `actions` array is hard-empty until M9.

The structured envelope is `{version, type, message, insights, recommendations,
actions, confidence}`. `type` follows the *request context* (answer / analysis /
quiz / guidance / refusal), never the model's own claim. `insights` and
`recommendations` are derived only from stats the caller actually provided, each
capped at 3 bullets; with no stats both are empty. `confidence` starts from the
intent classifier and drops 0.1 per violation.

**High-precision only — the deliberate boundary.** A guard that rewrites a
legitimate academic answer is worse than the risk it covers, so only six classes
replace the text (`BLOCKING`): schema, internal-leak, credential-request,
secret-material, action-claim, false-success. Everything else is recorded and the
answer passes through byte-identical. This is why the patterns are self-disclosure
shaped rather than keyword-shaped:

- "My system prompt is ..." is blocked; *"System prompt কী?"* passes — asking about
  prompts is legitimate study.
- "তোমার OTP দাও" is blocked; "লগইন করতে password দাও" passes — the sentence
  points at the app's own field (`APP_TARGET_RE`), not at the assistant.
- "ভেরিফিকেশন হয়ে গেছে" is blocked; "ভেরিফিকেশন সফল হলে ইমেইল পাবে" passes —
  a conditional is not a claim.
- An `invented-stats` flag needs a *provided* value to contradict. With no stats
  the claim is a guess, not proof, so it is never rewritten.

**No new Worker variable.** The plan mentioned a feature flag, but `wrangler.toml`
already sits on the 64-variable cap, so enforcement is the module constant
`ENFORCE` (currently `true`) — reversible in one place, no new binding.

**Guests and memory are unchanged.** Validation runs *inside* `agentChat`, after
the guest `401` gate, so a guest is still refused before anything is parsed. A
blocked response is never persisted: `finalize()` returns early unless
`validateResponse(...).persistable` is true, so an unsafe reply cannot become a
conversation turn or a long-term memory record.

**Streaming.** Text is already on the wire by the time the full reply is known, so
the server emits a new `event: replace` frame carrying the safe text; the client
replaces what it rendered (via `textContent`, never `innerHTML`) before the
`event: done` frame. A clean stream emits no `replace` frame at all.

**Backward compatibility.** The response shape is unchanged — `text`, `intent`,
`pv`, `agent`, `authoritative` all still present; `structured` is additive. The
prompt text and its SHA-256 are untouched.

**Verification:** `phase9-m8-response-validation.test.mjs` **33/33** — envelope
shape and bounded confidence (M8-৩...৭), schema (M8-৮/৯), each safety class with its
passing counterpart (M8-১০...১৯), data contradictions (M8-২০...২২), the quiz contract
(M8-২৩/২৪), the high-precision enforcement policy and byte-identical clean answer
(M8-২৫...২৭), end-to-end non-stream replace + no-store (M8-২৮/২৯), end-to-end
stream `replace` frame (M8-৩০/৩১), and client/status wiring (M8-৩২/৩৩). M4 29/29,
M5 10/10, M6 15/15, M7 33/33, `ai-agent-f1` 44/44, adapters 27/27, guards and
`check:worker-bundle` stay green; the full native-auth suite keeps its two
pre-existing, unrelated failures (`profile-core`, `session-recovery-chaos`).

**Next gate:** awaiting owner direction for the milestone after M8 (M9 is
write/execute actions — high risk, disabled by default).

## 16. M9 completion record — Write / Execute Actions

**Where:** `action-engine.js` (pure data + pure guards — no `env`, no I/O, no
model call). `public-worker.js` owns the three routes and the only KV writes;
`ai-agent.js` exposes the metadata through `agentStatus`.

**The layer is OFF.** `ENABLED` is `false`, exactly as the blueprint demands
("no write/execute enabled by default"). This milestone ships the *mechanism* —
declaration, proposal, single-use confirmation, audit trail — without granting a
live capability. Turning it on is a separate, owner-approved step: flip `ENABLED`
in one place. `validateActionEngine()` encodes the rule, so a future addition
cannot be live while the switch is off.

**WRITE and EXECUTE are separate classes.** `PERMISSION` carries both; `read` is
deliberately absent (READ lives in the M6 tool registry). `prefs.write` is the one
declared WRITE action; no EXECUTE action is declared yet.

**Confirmation is mandatory, short-lived and single-use.**
`makeProposal()` refuses to build anything unless authorization passes, and stamps
`expiresAt = now + 5 min`. `confirmProposal()` checks the layer, the caller's
ownership, the token match and the expiry before approving. The Worker deletes the
stored proposal *before* performing the write, so a replayed token finds nothing
(`already-consumed` → `no-proposal`). An old "yes" can never act on a stale
proposal.

**Owner is the server-validated uid, never the body.** `resolveActionOwner()`
returns a uid only for an `account-` prefix, so a guest owns nothing and is
refused before any argument is read. `sanitizeActionArgs()` rejects — rather than
silently strips — a payload naming an owner, keeping only declared argument keys,
so the attempt stays visible.

**Every attempt is audited.** `makeAuditRecord()` stamps the owner and bounds the
summary; `parseAudit()` keeps only the caller's own records and treats corrupt
history as empty; `appendAudit()` keeps the newest `MAX_AUDIT` (200). The pipeline
records `proposed`, then `confirmed` (or `denied` / `expired` / `failed`).

**Guests leave no trace.** All three routes (`/api/ai/actions/propose`,
`/confirm`, `/audit`) return `401 sign_in_required` for a guest before reading a
body or touching KV — the same gate M7 added for chat.

**Verification:** `phase9-m9-action-engine.test.mjs` **40/40** — engine shape and
the default-OFF rule (M9-১…৫), authorization including the layer-off refusal
(M9-৬…৮), owner isolation (M9-৯…১৩), proposal construction and expiry
(M9-১৪…১৭), the confirmation gates — layer, owner, token, expiry, missing,
replay (M9-১৮…২৪), the audit trail (M9-২৫…৩০), route wiring (M9-৩১…৩৩), and
end-to-end route behaviour while the layer is off (M9-৩৪…৩৯). M8 33/33, M7 33/33,
M6 15/15, M5 10/10, M4 29/29, `ai-agent-f1` 44/44, adapters 27/27, guards and
`check:worker-bundle` stay green; the full native-auth suite keeps its two
pre-existing, unrelated failures (`profile-core`, `session-recovery-chaos`).

**Next gate:** M9 ships inert. Enabling `prefs.write` (or adding an EXECUTE
action) is a separate owner decision, and needs a confirmation UI in the chat
before it can be used live.

## 17. M9 enablement — the layer is now live (with a config kill-switch)

The owner enabled M9 on 2026-09-24. `ENABLED` is now `true`, so `/api/ai/actions/*`
works for signed-in students. Every safety property from §16 is unchanged: a write
still needs a single-use confirmation, the proposal is consumed before the write,
the owner is the server-validated uid, guests are refused, and every attempt is
audited.

**Why the switch lives in code, not `wrangler.toml`.** The Worker already sits on
the Workers Free ceiling of 64 variables (secrets + text); adding
`USE_WRITE_ACTIONS` made the deploy 65 and Cloudflare rejected it
(`code: 10055`). So the default is in code and the *off* switch is
`USE_WRITE_ACTIONS = "disabled"`, which `actionsEnabled(env)` reads: any value
other than `disabled` keeps the layer on. Turning the layer off now needs no code
change — bind that one variable.

**Verification:** `phase9-m9-action-engine.test.mjs` **47/47**, including the
kill-switch cases (config-off refuses propose/confirm/audit and reports
`enabled: false`) and the live flow (propose → confirm → write → audit).


## 18. M10 completion record — Observability + Cost / Quota

The last two audit gaps (§52 items 9 and 10). New module `observability.js`,
wired into `ai-agent.js` at the two places a request actually finishes: the
one-shot reply and the streaming `done` event, plus both provider-failure paths.

**What was added:**

| Symbol | Purpose |
|---|---|
| `makeTrace()` / `sanitizeTrace()` | one record per request: `rid`, `callerRef`, provider, model, intent, tier, latency, token estimate, cost, fallback reason, prompt/context/agent versions |
| `renderTrace()` | single-line JSON for the Worker log sink; newlines stripped so a trace cannot forge extra log lines |
| `estimateTokens()` | ~4-chars-per-token approximation — reported as an estimate, never as a tokeniser |
| `estimateCost()` / `costFor()` | rate-sheet lookup; returns `priced: false` when no rate exists |
| `addUsage()` / `emptyUsage()` | fold traces into totals, counting unpriced requests separately |
| `appendTrace()` / `parseTraces()` | bounded history (200), corrupt-safe parse, caller-scoped filter |
| `quotaState()` | used / remaining / exhausted / 80% warning view over the existing `airl:` counter |
| `describeObservability()` | shape advertised by `agentStatus` |

**Two rules that shaped it, and why they are the point:**

1. **A trace is not a transcript.** It carries ids, counts and durations — never
   message text, prompt text, keys or a raw uid. `FORBIDDEN_TRACE_KEYS` is checked
   twice (on build *and* on render), so a call site that passes a whole message
   object by mistake still cannot leak content. The caller is identified by an
   8-hex `callerRef`, which groups traces without logging an account uid.
2. **A cost is never invented.** `PRICING` ships **empty on purpose**: the Gemini
   aliases in `GEMINI_MODELS` are preview/lite and their public rates move, so a
   guessed rate would silently corrupt every total derived from it. An unpriced
   model reports `costUsd: null, priced: false`; totals count those requests
   separately so a figure is never read as complete when part of it is unknown.
   Fill `PRICING.<provider>.<model> = { in, out }` when the owner has the current
   sheet — nothing else changes.

**Why this adds no KV write.** The chat path already spends its two-write budget
on the rate counter and memory. Traces go to the Worker's log sink instead, so M10
does not raise the per-chat cost the module header documents. A test asserts no
`obs`-prefixed KV write appears in the orchestrator.

**Deliberate non-changes (preserve-first):** every response shape is untouched —
`text`, `model`, `intent`, `pv`, `agent`, `latencyMs`, `structured` all keep their
names and values. The rate-limit reply still answers `429` with the same
`rate_limited` code and `cap`; it only gains a `remaining` field. The `airl:` key
format is unchanged, so the existing counter tests still pass.

**Verification:**

- `phase9-m10-observability.test.mjs` — **32/32** (whitelist/forbidden-key
  leakage, unpriced-cost honesty, half-filled rate rejection, exact arithmetic
  *when* a rate is injected, bounded history, corrupt-safe parse, quota edges).
- Full Phase 9 regression: `ai-agent-f1` 44/44, `ai-provider-adapters` 27/27,
  M4 29/29, M5 10/10, M6 15/15, M7 33/33, M8 33/33, M9 engine 47/47, M9 UI 21/21.
- `p21-ai-agent-ui` 83/83, `startup-ai-regression` 22/22, `account-retirement`
  31/31, `dead-handler-guard` 4/4.
- `npm run build:worker` + `check:worker-bundle` — in sync (868.5 kb).
- `npm run check:sw-manifest` — digests regenerated.

**Rollback:** revert this one commit. The module is additive; `ai-agent.js` gains
one import, one trace emitter and five call sites. Nothing else imports it.

### 18a. Per-student daily cap = 10, on a rolling 24h window (M11)

The owner asked for a hard daily ceiling: **one student sends 10 messages, then 10
more 24 hours after the first of the window.** Two changes meet that.

- **Cap default 80 → 10.** `AGENT_DAILY_CAP` still overrides it, but the code
  default is now 10, so no new Worker variable is needed (the Worker sits on the
  Workers Free 64-variable ceiling). The floor also dropped from 10 to 1, so a
  smaller cap can be set deliberately instead of being silently raised to 10.
- **Window is rolling, not calendar.** The counter key changed from
  `airl:<uid>:<yyyy-mm-dd>` to `airl:<uid>`, and the value from a bare integer to
  `{"n":<count>,"start":<epoch-ms>}`. `readQuota()` returns the count as long as
  `now - start < 24h`, and otherwise resets to `0` with a fresh `start`. The old
  key reset at **UTC midnight**, which is 6am in Dhaka — a student could send 10
  in the morning, get another 10 at 6am the next day, i.e. a ~24h gap measured
  from nothing in particular. The rolling window measures from the first message,
  which is what "24 ঘণ্টা পর আবার ১০টি" means. Legacy integer values and fresh
  objects both parse; corrupt JSON is treated as empty (never throws).

**Storage:** still exactly one KV write per chat (`expirationTtl` 172800 s = 48h,
so a window always expires before the key does). The per-anonymous-network public
cap in `public-worker.js` is unchanged.

**Message:** the `429` body keeps `error: 'rate_limited'` and `cap`, adds
`remaining`, and now says "২৪ ঘণ্টা পর আবার চেষ্টা করো" rather than "কাল".

**Verification:** `ai-agent-f1` grew from 44 to **48** tests, including
`readQuota` parsing/reset and an end-to-end 11th-message `429` on the default cap.

**Phase 9 is complete.** M1–M10 are all DONE. The remaining near-term work in the
blueprint (passkey-gated admin sessions, one config surface for caps, a single
context/permission matrix doc) is out of Phase 9 scope.
