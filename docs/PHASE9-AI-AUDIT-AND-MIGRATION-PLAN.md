# PHASE 9 — AI AUDIT & MIGRATION PLAN (STOP POINT)

> Status: **AUDIT ONLY — awaiting owner approval**
> Scope: Phase 9 blueprint, migration steps M1–M4. No code changed in this PR.
> Baseline preserved: `AGENT_VERSION = agent-f1`, `SYSTEM_PROMPT_V = sys-f1-3-ai-personalization`.
> Baseline tests: `ai-agent-f1.test.mjs` **44/44 pass** (run before auditing).

---

## 1. Inventory (§4) — what already exists

| Question (§4) | Finding |
|---|---|
| AI UI | `ai-agent-chat.js` (client, SSE), `ai-agent.js` (agent core, worker-side) |
| AI endpoints | `POST /api/ai` (non-stream), `POST /api/ai/chat` (SSE), `GET /api/ai/status`, `GET\|POST /api/ai/prefs` |
| Gateway | Single entry, both routes funnel into `agentChat()` |
| Provider adapters | `geminiStream()`, `groqStream()` — generator interface with shared `ProviderError` |
| Providers | Google Gemini (primary, multi-key), Groq (fallback, text-only) |
| Model router | `routerChain(env, tier, badSet)` → `GEMINI_MODELS.FAST/SMART` + Groq pair |
| Prompts | `buildSystemPrompt()` composed per-request; versioned by `SYSTEM_PROMPT_V` |
| Context | `buildSystemPrompt({stats, examMode, quiz, onboarding, prefs})` + `sanitizeOnboardingContext()` allowlist |
| Memory | `chatmem:<uid>` (KV), client-supplied history, `summarizeTo()` compaction |
| Personalization | `aiprefs:<uid>` (KV), `sanitizeAiPrefs()` allowlist, memory on/off honoured |
| Rate limit | `airl:<uid>:<day>` — `AGENT_DAILY_CAP` (default 80/day) |
| Failover | `aibad:<provider>:<model>` mark, 24h TTL, per-request chain exclusion |
| Error handling | `ProviderError` → 429 backoff, 502 retryable, 503 no-key |
| Streaming | SSE parser `sseParse()` + `geminiTextFromChunk()` |
| Safety gates | `safetyGate()` (mock-exam integrity), `authVerificationGuidance()`, `onboardingSecretDetected()` |
| Secrets | `GEMINI_KEYS`, `GROQ_API_KEY` — worker env only, never in client |
| Tests | `ai-agent-f1.test.mjs` (44), `p21-ai-agent-ui.test.mjs`, `startup-ai-regression.test.mjs` |

## 2. Capability map (§5)

| Capability | State |
|---|---|
| Chat + streaming | **WORKING** |
| Intent classification (`classifyIntent`) | **WORKING** |
| Model routing (FAST/SMART) | **WORKING** |
| Provider failover (Gemini → Groq) | **WORKING** |
| Per-user rate limit | **WORKING** |
| Exam-integrity gate | **WORKING** |
| Onboarding assistant (strict mode) | **WORKING** |
| Per-user AI preferences | **WORKING** |
| Conversation memory | **PARTIALLY WORKING** — session-scoped, no explicit long-term layer |
| Context engine | **PARTIALLY WORKING** — flat stats/onboarding/prefs, no typed context categories |
| Prompt registry | **PARTIALLY WORKING** — single version constant, no registry with `promptId/version/status` |
| Cost/quota tracking | **PARTIALLY WORKING** — only a daily request counter |
| Tool registry | **MISSING** |
| Action permission layer (READ/WRITE/EXECUTE) | **MISSING** |
| Action confirmation + audit trail | **MISSING** |
| Response schema/validation layer | **MISSING** (free text except quiz JSON mode) |
| Memory metadata (reason/source/permission/timestamp/confidence) | **MISSING** |
| Formal short/long-term memory split | **MISSING** |

## 3. Existing AI → target mapping (§6, §7, §30)

```
CURRENT                                   TARGET (Phase 9)
POST /api/ai, /api/ai/chat        →       AI Gateway (keep both paths)
agentChat()                       →       AI Orchestrator
routerChain()                     →       Model Router (behind adapter)
geminiStream/groqStream           →       Provider Adapters (keep signature)
buildSystemPrompt()               →       Context Engine + Prompt Registry
chatmem:<uid>                     →       Memory Engine (short-term first)
aiprefs:<uid>                     →       Personalization Bridge (keep)
airl:<uid>:<day>                  →       Rate/Cost layer (extend)
```

Backward compatibility is required: `chat()` / `ask()` / `generate()`-style callers and the
`/api/ai*` response shape (`text`, `intent`, `pv`, `agent`, `authoritative`) must not change.

## 4. Security findings (§28, §45, §47)

| # | Finding | Severity |
|---|---|---|
| S1 | AI provider keys are worker-env only; client requests carry no key (`ai-agent-chat.js` header note confirms). **PASS** | — |
| S2 | Outbound Gemini key sits in a URL query string (`:streamGenerateContent?alt=sse&key=…`). Never logged by this code, but URL-borne secrets can leak via proxy/error logs. Recommend header-based auth (`x-goog-api-key`) before Phase 9 hardening. | **MEDIUM** |
| S3 | `firebase-messaging-sw.js` embeds a Firebase web `apiKey`. This is a **public Firebase config key**, not a secret — it is required client-side and safe by design. Flagged only because the Phase 9 §28 checklist mentions client-visible keys. **No action required**; documented so the checklist item is explicitly closed. | INFO |
| S4 | Memory and prefs are keyed by `identity.uid` from `aiRequestIdentity`; `tests assert no shared/leaked keys between users`. **PASS** | — |
| S5 | Onboarding secret detection fails closed before the model/rate/memory path. **PASS** | — |
| S6 | No cross-user context path exists today because tools do not exist yet. This risk must be designed in **at** M6, not retrofitted. | **HIGH (future)** |

## 5. Phase 9 gap analysis (§52 target vs today)

Missing → required before Phase 9 completes:

1. **AI Gateway formalisation** — extract an adapter boundary so callers stop touching providers.
2. **Context Engine** — typed categories (Identity/Profile/Academic/Performance/Activity/Preference) with minimum-necessary + permission scope (NONE→FULL_ALLOWED).
3. **Prompt Registry** — `promptId / version / purpose / createdAt / status`, existing `SYSTEM_PROMPT_V` becomes `v1` (never deleted).
4. **Tool Registry** — name/description/permission/inputSchema/outputSchema/riskLevel/enabled.
5. **READ / WRITE / EXECUTE separation** — default READ-ONLY; no write/execute enabled by default.
6. **Action confirmation + audit trail** — for any future write action.
7. **Response validation layer** — schema/safety/data/action validation before UI render; structured `{type,message,insights,recommendations,actions,confidence}` where needed.
8. **Memory Engine** — short-term + long-term with reason/source/permission/timestamp/confidence; long-term default empty.
9. **Cost/quota engine** — token usage, request count, estimated cost, provider quota.
10. **Observability** — request id, provider, model, latency, tokens, fallback reason, context/prompt version.

## 6. Migration plan (§48) — one step at a time, approval-gated

| Step | Deliverable | Risk | Reversible | Status |
|---|---|---|---|---|
| **M1** | This audit | none | n/a | **DONE** |
| **M2** | Adapter boundary — normalized provider interface; zero behaviour change | low | yes | **DONE** (see §7) |
| **M2.5** | Cloudflare Workers AI backup — first non-Gemini/Groq provider on the new boundary | low | yes | **DONE** (see §8) |
| **M3** | Formal Gateway — single internal entry with feature flag `USE_AI_GATEWAY` | low | yes | pending |
| **M4** | Context Engine — typed, permission-scoped, minimum-necessary; legacy path kept | medium | yes | pending |
| **M5** | Prompt Registry — existing prompt becomes `v1`; A/B before replacing | low | yes | pending |
| **M6** | Tool Registry — READ-ONLY tools only; cross-user isolation enforced at the tool boundary | high | yes | pending |
| **M7** | Memory Engine — long-term layer, default OFF, explicit consent | medium | yes | pending |
| **M8** | Response validation + structured output | medium | yes | pending |
| **M9** | Write/Execute actions — disabled by default, confirmation required | high | yes | pending |
| **M10** | Observability, cost engine, full regression + hardening | low | yes | pending |

Rule (§49): no step starts until the previous step is stable and approved.

## 7. M2 completion record — Provider Adapter layer

**Where:** `ai-agent.js` (stays with the orchestrator deliberately — a separate module
would create a circular import, since adapters reuse `geminiStream` / `groqStream` /
`ProviderError` / `routerChain`, which live here).

**What was added:**

| Symbol | Purpose |
|---|---|
| `GEMINI_ADAPTER` | `chatOnce()` (one-shot) + `chatStream()`; owns the `generateContent` URL and status→`ProviderError` mapping |
| `GROQ_ADAPTER` | `chatStream()` only; `chatOnce()` deliberately rejects (`oneShot: false`) because the non-stream route has always been Gemini-only |
| `PROVIDER_ADAPTERS` / `adapterFor(entry)` | registry + chain-entry → adapter lookup; unknown providers return `null` instead of misrouting |
| `providerChain(env, tier, badSet)` | non-stream chain = router chain ∩ adapters with a one-shot path |

**What changed at the call sites:** the orchestrator now dispatches via
`adapterFor(c)` / `GEMINI_ADAPTER.chatOnce()` / `adapter.chatStream()` instead of
touching provider URLs. The payload builders (`payloadG` / `payloadO`), the retry
loop, the bad-set marking and the response shapes are unchanged.

**Deliberate non-changes (preserve-first):**

- Public API and response shapes identical (`text`, `model`, `intent`, `pv`, `agent`, `authoritative`).
- Error codes and user-facing messages identical (`no_providers` 503, `provider_failed` 502/SSE, `mock_refused` 403).
- Prompt text, `SYSTEM_PROMPT_V`, `AGENT_VERSION`, model names and `GEMINI_KEYS`/`GROQ_API_KEY` handling identical.
- `routerChain` untouched and still exported (baseline test #16–18 depend on it).
- One internal detail line changed: a failed non-stream Gemini call now reports
  `detail: "Gemini HTTP 500 (<model>)"` instead of `"HTTP 500 <model>"`. This is a
  diagnostic-only field, not asserted by any test and not shown to students.

**Verification:**

- `ai-agent-f1.test.mjs` — **44/44 pass** (baseline, unchanged).
- `ai-provider-adapters.test.mjs` — **17/17 pass** (new: registry contract, chain
  filtering, honest Groq failure, structural "no raw URL in the orchestrator",
  and 3 E2E behaviour-parity checks).
- `startup-ai-regression.test.mjs` — 22/22; `p21-ai-agent-ui.test.mjs`, `phase23-core.test.mjs`,
  `auth-protection.test.mjs`, `account-retirement.test.mjs` — pass.
- `npm run build:worker` + `npm run check:worker-bundle` — bundle in sync (738.2 kb).
- `npm run check:sw-manifest` — sw.js digests regenerated.

**Rollback:** revert this one commit; the adapter layer is additive and nothing
else in the repo imports it.

**Next gate:** M3 (formal Gateway with `USE_AI_GATEWAY` feature flag) — awaiting approval.

## 8. M2.5 completion record — Cloudflare Workers AI backup

Added the first non-Gemini/Groq provider on top of the M2 boundary, to prove the
boundary actually makes provider expansion cheap.

**What was added:**

| Symbol | Purpose |
|---|---|
| `openAiCompatStream({url,key,model,payload,signal})` | one shared SSE reader for every OpenAI-wire-format provider; the next such provider is a URL + model list, not another copy-pasted reader |
| `CLOUDFLARE_ADAPTER` | `chatStream()` against `api.cloudflare.com/client/v4/accounts/<id>/ai/v1/chat/completions`; `chatOnce()` rejects (`oneShot: false`), same honesty rule as Groq |

**Router:** Cloudflare is appended **after** Gemini and Groq, and only when
**both** `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_API_KEY` are bound. Either
missing → the slot is simply absent, exactly like a missing `GEMINI_KEYS`.
`AGENT_CLOUDFLARE_MODELS` (in `[vars]`, comma-separated) overrides the model
list because Cloudflare rotates its catalogue.

**Secrets:** account id and API token go in via `wrangler secret put` or the
dashboard (encrypted) — never in `[vars]`. Test M2.5-৯ asserts the token never
appears in the request URL.

**Verification:** `ai-provider-adapters.test.mjs` 27/27 (10 new M2.5 cases,
including an E2E where Gemini *and* Groq both return 500 and Cloudflare streams
the answer); `ai-agent-f1.test.mjs` 44/44; bundle + sw-manifest clean.

**Known, unrelated:** `startup-ai-regression.test.mjs` case ১৫ fails on the
current `origin/main` base as well — reproduced with every M2.5 change stashed,
so it is pre-existing and not caused by this work.

**To activate:** bind the two secrets **and** make sure the dispatcher in
`gk-agent-worker.js` forwards them. `/api/ai/*` is served by `public-worker.js`,
which the `gk` worker invokes with a narrow `envPub` allowlist; a provider whose
bindings are not on that list is invisible however many secrets are bound. The
Cloudflare pair plus `AGENT_CLOUDFLARE_MODELS` are forwarded there, and
`account-retirement` guards the list. Then the provider joins the chain
automatically.



## 9. Mandatory STOP (§54)

Per the blueprint, implementation must not begin without owner approval. M2 was
implemented only after that approval; **M3 onward is not started**.

**Awaiting decision:** approve M3 (formal Gateway behind `USE_AI_GATEWAY`),
reorder the plan, jump to M4 (Context Engine, the "AI must recognise the student"
work), or stop here.
