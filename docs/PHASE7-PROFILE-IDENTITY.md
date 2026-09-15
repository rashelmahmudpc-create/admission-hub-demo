# Phase 7 — Profile & Personal Identity (v257-prep, 2026-09-15)

Owner-approved scope. Storage: **all on Cloudflare** — profile core in the DO
SQLite database (`auth_users`/`auth_profiles`/`auth_public_identities`), avatar
BLOBs in **D1** (`admission-profile`, binding `PROFILE_DB`). No external
services. Email/Telegram remain verification channels only.

## What shipped (chunks)

| Chunk | Content | Commit |
|---|---|---|
| 1 | Schema v7 (additive, PRAGMA-guarded), PATCH + optimistic `profile_version`, AH public IDs (base-31, 31⁶), completion weights, auto-provisioning state machine, avatar store (D1) + engine + 6 internal routes, public projection, 35 tests | `6e81f35` |
| 3 | Public avatar route — visibility-gated, byte-exact, private/unknown → 404 | `534820d` |
| 4 | Profile UI (6th nav tab 👤), bottom-sheet edits, avatar upload/downscale/remove, gentle completion, dynamic context greeting + section order, public `/AH-XXXXXX` page, dashboard avatar upgrade, 14 UI contract tests | `3fed1cf` |

Test gate: `npm run test:production-auth` = **381/381** (includes 35 profile-core
+ 14 profile-ui tests), identity 36, session 22, worker bundle check.

## Public URL & ID

- URL: `https://admissionhub.pages.dev/AH-XXXXXX` — `_redirects` (`/AH-* / 200`)
  serves the SPA; `render()` in `index.html` detects the pathname and calls
  `renderPublicProfilePage`.
- ID: `AH-` + 6 chars of `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 symbols, no
  lookalikes). Deterministic: SHA-256(`ah-public-id-v1|userId|attempt`) → first
  4 bytes → sequential base-31 digits. Collisions retry deterministically.
  Stored once in `auth_public_identities`, never reassigned.

## Visibility boundary (invariant — do not loosen without owner approval)

| Field | private | limited | public |
|---|---|---|---|
| publicId + displayName | ✗ (404) | ✓ | ✓ |
| avatar | ✗ | ✓ | ✓ |
| target | ✗ | ✗ | ✓ |
| bio, completion band, joinedYear | ✗ | ✗ | ✓ |
| email / mobile / DOB / school / higher / internal refs | **never** | **never** | **never** |

- Suspended accounts (`auth_account_state.status='suspended'`) disappear from
  every public surface (projection query joins account state).
- Public endpoints are unauthenticated and rate-limited
  (`public-profile-read`).

## API surface

- `GET /api/auth/v1/profile` — v2 (additive: `publicId`, `mobile`, `bio`,
  `targets`, `visibility`, `completion`, `context`, `avatar`, `version`)
- `POST /api/auth/v1/profile/patch` — `{fields, expectVersion}` optimistic
  concurrency → 409 `PROFILE_VERSION_CONFLICT`
- `POST|GET|DELETE /api/auth/v1/profile/avatar` — jpeg/png/webp, magic-byte
  validated, 64 B–2 MB (3.5 MB wire cap on DO); absent D1 binding →
  `STORAGE_UNAVAILABLE` (save) / `avatar:{present:false}` (reads) — failure
  isolation, profile never breaks
- `GET /api/public/profile/:publicId` and `.../avatar` — public projection
- Audit events: `profile-patched`, `profile-visibility-changed`,
  `profile-avatar-changed`, `profile-avatar-removed`

## Context engine (rule-based, no AI)

Precedence: `PROFILE_INCOMPLETE` (<60%) → `NEW_USER` (<7 days) → `GOAL_SET`
(has target) → `RETURNING` (gap >14 days) → `DEFAULT`. Supplies greeting +
section order only; never content.

## Protection rules

**Protected (change only via owner-approved phase):**
- Identity core (`auth-native/core/identity*`, subject refs, session tokens)
- Public/private visibility allowlist (table above)
- Public ID derivation scheme + stored-once semantics
- Zero-raster rule for all chrome (default avatar = generated SVG)
- No credentials in localStorage/sessionStorage/cookies
- Email is not a profile field; Telegram is not storage

**Free to extend:**
- UI polish (labels, spacing, sheets), completion copy
- New read-only profile consumers (stats, etc.) — must go through the
  projection, never raw `auth_profiles`
- Avatar store swap point: `D1ProfileStore` (R2-compatible interface)

## Release (owner, protected)

1. CF token with **D1 Edit** scope (current token lacks it).
2. D1: `wrangler d1 create admission-profile`, add to `wrangler.toml`
   (worker `admission-gk`):
   `[[d1_databases]] binding = "PROFILE_DB" database_name = "admission-profile" …`
   No manual SQL needed — `D1ProfileStore` runs `CREATE TABLE IF NOT EXISTS
   avatars` on first use (idempotent self-migration).
3. Version strings are already bumped in main to `v257-profile-core-20260915`
   (index.html ×3, sw.js BUILD_ID, all pinned tests, canary workflow, dist
   mirror). Publish via the protected workflow (environment
   `email-gateway-production`) with the D1-capable token.
4. Verify: live `/AH-<id>` 404s before any user goes public; after a test
   user sets visibility=public, URL + avatar render; private user → 404.

## Rollback

- Worker: previous deployment stays in CF dashboard history (one-click
  rollback, as with v256 `6c5ba2f2…`).
- Pages: previous production deployment selectable in dashboard.
- Schema v7 is additive only → no data rollback needed; old code ignores the
  new columns (PRAGMA-guarded).
