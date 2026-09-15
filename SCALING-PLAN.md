# Scaling Plan — storage growth to 1–5M students (2026-09-15)

Owner direction: dream scale is **1–5M students**, budget starts at **$0**,
everything stays on Cloudflare. This is the growth ladder — each step is a
deliberate, reversible swap; nothing is needed until the step is actually hit.

## What each student costs at rest

| Data | Size | Where |
|---|---|---|
| Profile core (name, DOB, mobile, school, target, bio) | ~2–4 KB | DO SQLite (`auth_profiles`) |
| Public identity (AH-ID row) | ~0.1 KB | DO SQLite (`auth_public_identities`) |
| Avatar (512px JPEG, q0.85) | ~40–100 KB | D1 `avatars` (→ R2 later) |
| 1 month of learning data (exam snapshots, mistakes, streaks) | ~100–250 KB | IndexedDB (device) + future DO tables |

The heavy long-term data is **learning data**, not profiles.

## Ladder

### Stage 0 — 0 → ~50K students — $0/mo (today)
- DO SQLite: profile core, sessions, security events, public IDs.
- D1 free (5 GB): avatars. 5 GB ≈ 50–100K avatars at 50–100 KB — the avatar
  column is the first thing to fill.
- Learning data stays on-device (IndexedDB) — zero server cost.
- Pages free + Worker paid-plan free tier + DO/D1 free tiers.

**Signal to move:** D1 storage > ~4 GB, or p95 latency drift on avatar reads.

### Stage 1 — ~250K students — ~$1–5/mo
- **Avatars → R2** (swap point already built: `D1ProfileStore` is the only
  consumer; an `R2ProfileStore` implements the same interface — no engine
  change). R2 free tier: 10 GB storage, 10 M class-A requests, 10 M free
  egress/month. 250K × ~80 KB ≈ 20 GB → ~$1.5/mo overage.
- DO SQLite unchanged (core data for 250K ≈ ~1 GB — well inside free).

**Signal to move:** D1/DO write rate approaching free-tier daily caps
(D1: 5 M reads / 100 K writes per day).

### Stage 2 — 1M students — ~$15–50/mo
- R2: 1M avatars ≈ 80 GB → ~$1.2/mo storage (egress mostly free within tier
  growth; CDN cache handles the rest).
- D1 core growth: 1M students ≈ 2–4 GB of profile/session core → still near
  free; learning data, once server-side, becomes its own table family with
  its own budget (the big lever: it is the only component that grows
  ~100–250 KB/student).
- Budget envelope: **$15–50/mo** covers DO/D1 growth + R2 + headroom.

### Stage 3 — 5M students — plan, don't pre-buy
- DO SQLite is the constraint to revisit first (single-DB row count, write
  rate). Options in order of preference: partition by year/region in D1
  (schema is already portable), or a managed Postgres on CF's ecosystem with
  the same repository interface.
- R2: 5M avatars ≈ 400 GB → ~$6/mo.
- Learning data server-side at 5M active: 500 GB–1.2 TB → this is where a
  dedicated database (D1 partition or Postgres) pays for itself; budget
  stays in the low hundreds of $/mo, no card-required tiers needed before
  that point.

## Rules of the ladder

1. **No card, no new provider** until the stage is actually hit; the owner
   rejects speculative spend.
2. Every swap goes through an existing interface (repository / avatar store)
   — engine and UI never change for a storage move.
3. Multi-provider "free stacking" (separate free DBs glued together) is
   rejected: ToS risk + operational surface. Cloudflare is the single
   platform.
4. Avatars are the only binary blob in the hot path; everything else is
   structured rows and stays in SQL as long as it fits.
5. Telegram/Render stay out of storage (Telegram = OTP + notifications only;
   Render free Postgres deletes after 30 days — verified in research).
