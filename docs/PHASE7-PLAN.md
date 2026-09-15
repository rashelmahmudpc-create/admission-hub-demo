# 🎓 Phase 7 — Profile & Personal Identity Experience · PLAN

**Status:** DRAFT — awaiting owner approval
**Date:** 2026-09-15 (Asia/Dhaka) · Agent: Arena Agent Mode
**Version target:** `v257-profile-identity-2026MMDD`
**Blueprint:** Phase 7 master blueprint + extra high-dynamic profile blueprint
(owner-supplied, 44 + 44 sections)

---

## 0. Audit findings (what already exists)

| Existing | Where | Phase 7 treatment |
|---|---|---|
| `auth_profiles` (user_id PK, profile_version, full_name, date_of_birth, school_*, higher_*) | `sqlite-auth-repository.mjs` | **Extend** via migration (additive columns only) |
| `GET/POST /profile`, `POST /profile/pending` (onboarding) | `public-auth-handler.mjs` + DO `/internal/profile/*` | Keep; extend response; make save PATCH-style |
| Profile write rate limits + `cleanProfileText` validation | `auth-engine.mjs` | Extend with new-field validators |
| `auth_security_events` + `#event()` helper | repository | Reuse for profile audit events (`profile-*`) |
| Initials avatar (`dv2-avatar`, first letter) | `dashboard-v2.js` | Upgrade: uploaded avatar or deterministic SVG |
| Onboarding "Personal" step (name/DOB/education UI) | `account-access.js` | Untouched (protected by 15+ test files) |
| `auth_meta` (key/value) | repository | Store `schema_version` for migrations |
| Nav pages: dashboard/exam/ai/history (`render()` in index.html, `window.renderAiAgentPage` pattern) | `index.html` | Add `profile` page via new `profile-ui.js` |
| **Avatar storage** | — | **Missing — new R2 binding** |
| **AH public ID, visibility, mobile, bio, target, completion, dynamic context** | — | **Missing — built in Phase 7** |

**Boundaries respected (frozen contracts, read before planning):**
- `docs/IDENTITY-CORE-PROTECTION.md` — profile work adds NEW methods/tables;
  never touches `setAccountState`, account lifecycle, reconciliation, or
  provider set. Provider set stays `['firebase']`.
- `docs/SESSION-CORE-PROTECTION.md` — session validity rules untouched.
- `docs/SECURITY-CORE-PROTECTION.md` — risk engine, device trust, challenge
  flows untouched. Profile endpoints run **after** the existing auth gate
  (same session-verification middleware as other `/api/auth/v1/*` routes).
- Zero-raster owner rule — default avatars are **code-generated SVG**
  (initials + deterministic hue); uploaded avatars are user content only.
- Email stays an authentication field — **no email edit in profile**
  (email-change flow remains a post-Phase-6 follow-up, untouched here).

---

## 1. Architecture (blueprint §1, §24, §42)

```
Authentication → Session → Security → AdmissionHubUserID → Profile System
```
Profile is a **consumer** of identity, never an authority. All profile API
operations derive the user from the verified session — client-supplied user
IDs are never trusted (blueprint §25). Profile data lives in
`auth_profiles` (+ `auth_public_identities`); auth data stays in
`auth_users` (blueprint §2).

**Dynamic layer (high-dynamic blueprint):** a **server-computed rule table**
("profile context engine") turns authorized data (profile fields, account
timestamps, security-event counts) into a deterministic UI context
(`NEW_USER | RETURNING | PROFILE_INCOMPLETE | GOAL_SET | MILESTONE`),
greeting, section priorities, and moments. No AI, no behavior inference,
no new analytics engine, no real-time infra (blueprint §26-27: architecture
ready, implementation minimal). Future sources (progress/achievements/
rank) plug into the same rule table when those phases exist — profile only
ever consumes verified summaries (blueprint §16-19, §29).

---

## 2. Data model (blueprint §3, §4, §12, §13, §14, §31)

### 2.1 Migration (monotonic `schema_version` in `auth_meta`)
- `ALTER TABLE auth_profiles ADD COLUMN` (each guarded, idempotent):
  - `mobile TEXT` — validated BD/intl format, optional
  - `bio TEXT` — ≤ 280 chars, optional
  - `targets TEXT` — JSON array (future-ready multi-goal, §18); Phase 7 UI
    manages a single primary target: `{universityId, universityName, unit, year}`
  - `avatar_key TEXT` — R2 object key, or NULL = default
  - `avatar_updated_at INTEGER`
  - `visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN
    ('private','limited','public'))` (§21)
- New table:
  - `auth_public_identities(user_id TEXT PRIMARY KEY, public_id TEXT NOT
    NULL UNIQUE, created_at INTEGER NOT NULL, FOREIGN KEY → auth_users)`
    (§14 — permanent, non-reusable, separate abstraction)

### 2.2 AH Public ID (§14)
- Format `AH-XXXXXX` — 6 chars, base32 alphabet without ambiguous glyphs
  (no 0/O/1/I), derived via HMAC-SHA256(user_id, key) → prefix, collision
  checked at insertion (retry on the rare clash). Stored once, never
  rotated.

### 2.3 Profile state machine (§4)
`PROFILE_CREATING → PROFILE_INCOMPLETE → PROFILE_ACTIVE` — derived value
(computed from field presence), not a stored column. Provisioning:
first verified session for an account without a profile row → auto-create
minimal profile (name prefilled only if known), never fails the login
(provisioning errors are logged + event `profile-provision-failed`,
session remains valid — blueprint §37).

### 2.4 PATCH semantics + concurrency (§27, §28)
`POST /profile` accepts `{ fields: {...}, expectVersion: n }` — only
provided fields change; `profile_version` increments per save; mismatch →
`PROFILE_VERSION_CONFLICT` (client refetches). Full-record overwrite is
impossible.

---

## 3. API surface (§24, §25, §38)

All under existing auth gate (session-verified) unless marked public:

| Method · Path | Purpose |
|---|---|
| `GET /api/auth/v1/profile` | Profile + `completion` + `context` (dynamic) + `publicId` + `avatarUrl` + `visibility`. No raw security events, no provider IDs. |
| `POST /api/auth/v1/profile` | PATCH-style update (name, mobile, bio, target) + `expectVersion` |
| `POST /api/auth/v1/profile/avatar` | Upload (multipart) → R2 |
| `DELETE /api/auth/v1/profile/avatar` | Remove → back to default |
| `POST /api/auth/v1/profile/visibility` | Set private/limited/public |
| `GET /api/public/u/{publicId}` | **Public, unauthenticated** (rate-limited): display-safe projection only (§22) |

**Public projection allowlist (frozen, §22/§23):** name, avatar, publicId,
primary target (university + unit), joined year, completion band
(e.g. "Mostly complete"), visibility-gated bio. **Never:** email, mobile,
DOB, school details, security data, any internal ID.

**Validation (§26, §11):** length limits (name ≤ 80 via existing
`cleanProfileText`; mobile ≤ 16; bio ≤ 280), sanitization, allowed
characters, structured target validation against the existing institution
dataset, null/empty handling (empty = clear field).

**Avatar pipeline (§9, §11):** client downscales to ≤ 512 px canvas →
multipart upload → server validates MIME (jpeg/png/webp), magic bytes,
≤ 2 MB → stored at R2 `avatars/{user_id}.{ext}` (server-chosen filename,
never client filename) → `avatar_key` set. Serving: private
`GET /api/auth/v1/profile/avatar` (stream, `no-cache`); public path serves
only when `visibility ∈ {limited, public}` (long cache). Delete removes the
object + resets key.

**Audit (§32):** `profile-created`, `profile-provisioned`,
`profile-updated`, `avatar-changed`, `avatar-removed`,
`visibility-changed`, `public-profile-viewed` (sampled) → existing
`auth_security_events`. No sensitive values in events.

---

## 4. Dynamic profile experience (§01-38 high-dynamic blueprint)

**Server context engine (rule table, deterministic):**
```
inputs: profile completeness, fields present, last_login_at gap,
        created_at age, recent security events (counts only)
outputs: { context, greeting, sectionOrder[], moments[], completion }
```
- Contexts (Phase 7 subset, future-extensible): `NEW_USER` (< 7 days),
  `PROFILE_INCOMPLETE`, `GOAL_SET`, `RETURNING` (gap > 14 days),
  `DEFAULT`. Greetings are a fixed rule-based Bengali set (§14 rule-based
  first). Moments only from real state changes (e.g. "Target saved") —
  no spam, no fake achievements (§06: real data only).
- Section order (§13): deterministic per context (e.g. incomplete →
  completion card first; goal set → goal card first).
- Freshness (§30): response carries `freshness: LIVE` (computed at read
  time) — no cached dynamic data; future `CACHED/STALE` states when
  progress sources exist.
- Anti-overpersonalization (§37): no behavioral inference; everything
  shown is user-entered or a count the user caused.

**UI (new file `profile-ui.js` — account-access.js untouched):**
- New nav entry `profile` (icon 👤) in index.html shell; guest →
  sign-in prompt; signed → `window.renderProfilePage`.
- **Identity card (§15):** avatar (upload/preview) · name · `AH-XXXXXX` ·
  goal · joined · completion meter (gentle, non-pressuring, §6).
- **Editing:** bottom-sheet on mobile / inline card on desktop for each
  section (name, mobile, bio, target from existing institution picker,
  avatar, visibility). Save = PATCH with `expectVersion`; conflict toast.
- **Public preview (§22):** "How your public profile looks" live
  preview panel.
- **Empty states (§31, §35):** friendly, never blocking.
- **Loading (§36):** skeleton cards; profile failure → inline fallback,
  app + session stay usable (§37).
- **Mobile-first (§34):** thumb-friendly, compact cards, 320 px safe.
- **Dashboard avatar upgrade:** `dv2-avatar` renders uploaded avatar or
  deterministic SVG (initials + hue from user_id) — zero raster (§10).
- **Micro-animation (§07/§08):** subtle CSS transitions on card state +
  completion meter only; no flashy motion.

---

## 5. Storage: Cloudflare R2

- New binding in `wrangler.toml`: `AVATAR_BUCKET` (R2).
- **Bucket:** `admissionhub-avatars` (new; created via CF API or owner
  dashboard — see open questions).
- Owner-supplied R2 S3 key pair noted for fallback; **primary path =
  worker R2 binding** (simpler, no long-lived S3 secrets in repo).
- R2 costs ~$0 read/write; bucket is private (no public listing).

---

## 6. Chunks (established pattern: build → test → commit → push)

| Chunk | Scope | New tests (target) |
|---|---|---|
| **1 — Profile core** | Migration runner + schema_version; new columns; provisioning on first session; PATCH save + optimistic versioning; completion engine; validators; audit events; GET /profile v2 response | `profile-core.test.mjs` ~30 |
| **2 — Avatar system** | R2 binding (wrangler + tests with mock); upload/replace/delete pipeline; validation + abuse (fake MIME, oversized, path-traversal filename); deterministic SVG default; serving routes + cache headers | `profile-avatar.test.mjs` ~18 |
| **3 — Public identity + privacy** | AH-ID generation + table; public projection endpoint (rate-limited); visibility rules; cross-user/unauthorized/leak tests; public preview data contract | `profile-public.test.mjs` ~20 |
| **4 — Dynamic experience + UI** | Context engine (rule table) + tests; `profile-ui.js` (identity card, bottom sheets, public preview, completion meter, empty/skeleton states, avatar edit); index.html nav + shell marker + sw.js asset list; dashboard avatar upgrade | `profile-dynamic.test.mjs` ~20 + UI assertions |
| **5 — Protection + release** | `docs/PROFILE-CORE-PROTECTION.md` (frozen invariants + AGENT PROFILE RULE); guard workflow paths + CODEOWNERS; v257 bump (sw.js, index.html, test markers, publish workflow verify); full regression (identity/session/auth/email/security + new suites) | regression all green |

**Test registration:** add the 4 new files to `test:native-auth`
(package.json) — CI (guard + publish) picks them up automatically.

---

## 7. Testing gates (blueprint §39-41, §44)

- **New suites:** creation (first login, email signup, auto-provision,
  partial), editing (all fields, empty, invalid), security (cross-user,
  unauthorized update, public/private leakage, avatar abuse, malicious
  input), failure (API down → session survives, upload timeout, duplicate
  update, concurrent tabs via version conflict, migration replay on old
  schema snapshot).
- **Chaos:** profile chaos cases inside each suite (crash-mid-save,
  concurrent provision, R2 failure → fallback to default avatar,
  event-log full).
- **Regression (hard gate):** `test:identity` 36, `test:session` 22,
  `test:auth` 62, `test:email` 108+4, security suites, bundle check —
  all green or Phase 7 does not complete.
- **Visual QA:** no headless browser in the manual-publish sandbox
  (documented v256 limitation) — DOM-contract assertions in tests; owner
  mobile spot-check of the profile page at publish; browser audit runs
  again automatically once GitHub Actions is re-enabled.

---

## 8. Publish (manual, same proven v256 procedure)

GitHub Actions/Pages remain disabled at account level (support pending).
Manual protected publish (owner-authorized): local pre-gates → capture
rollback anchor → `wrangler deploy` (worker) → build sanitized dist →
`wrangler pages deploy` (branch main) → run the workflow's own live
verification script against admissionhub.pages.dev (+ new v257 marker
checks) → cleanup. Telegram canary step skipped (no Telegram changes in
v257; webhook untouched). **Requirement:** the CF API token must also
have **Object Storage (R2): Read/Edit** for the new bucket binding
(owner recreates/extends token — see open questions).

---

## 9. Explicit non-goals (this phase)

- No email-change flow, no password-change endpoint (post-P6 follow-ups).
- No TOTP, no real-time push infra, no progress/leaderboard/reward/
  achievement **engines** (profile consumes only; those are later phases).
- No AI in profile context (rule-based only), no social features,
  no online-status system, no multi-target UI (schema-ready only).
- No Supabase; R2 is the storage provider (provider-agnostic interface
  kept so a swap is a binding change, §9 blueprint).

---

## 10. Completion gate (blueprint §44 — all must hold)

Profile creation ✓ · editing ✓ · academic target ✓ · avatar ✓ ·
AH public ID ✓ · public/private boundary ✓ · authorization ✓ · data
ownership ✓ · API boundary ✓ · failure isolation ✓ · migration
strategy ✓ · security tests ✓ · P3/P4/P5/P6 regression ✓ · no critical
leak ✓ · protected publish + live verify ✓.

---

## 11. Open questions for owner (answer at approval)

1. **R2 bucket:** create new bucket `admissionhub-avatars` — OK? And the
   CF token needs R2 permission added (recreate token with *Object
   Storage (R2): Edit* alongside Workers Edit + Pages Edit) — you'll
   paste the new token at publish time.
2. **Public profile URL:** `admissionhub.pages.dev/u/AH-XXXXXX` — OK?
3. **Default avatar:** generated SVG (initials + deterministic color),
   zero-raster — OK? (matches owner zero-raster rule)
4. **Dashboard nav label:** add a `Profile` tab (👤) — OK?
