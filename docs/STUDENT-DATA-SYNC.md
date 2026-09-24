# Student Data — Server-Backed, Per-Account (D+E+F)

Rule (owner): from the moment a student logs in, every student-owned record
lives on our server for life. Losing the phone, clearing the browser, or
switching devices must never lose data; logging in restores everything.

IndexedDB remains the fast/offline working copy. It is no longer the only
permanent record.

## Storage split

| Tier | Free | Holds |
|---|---|---|
| D1 (`PROFILE_DB`) | 5 GB / account (500 MB per database) | auth, profile, notification state, and every student row — the queryable source of truth |
| R2 (`FILE_BUCKET`) | 10 GB, $0 egress | heavy write-once exam payloads (gzipped), media, backups |

Note: the 5 GB D1 limit is **per account, not per database** — a second D1 does
not add storage. Durable Objects SQLite has a separate 5 GB free budget.

### Exam results: summary in D1, snapshot in R2

An exam result carries `snapshot`, `timing`, `timeAnalysis`, `configuration`,
`topicBreakdown`, `subjectBreakdown`. At 30–60 KB each these would exhaust D1.
They are write-once and read-rarely, so the server spills them to R2
(`examResults/{userId}/{id}.json.gz`) and keeps the small queryable summary in
D1. The split is invisible to the client — pull rehydrates the full document.
If an R2 write fails, the heavy fields stay in D1 rather than being lost.

## API

```
POST /api/userdata/sync   { device, ops:[{store,id,op,doc,updated_at}] }
GET  /api/userdata/pull   ?store=&since=&limit=&cursor=
GET  /api/userdata/bootstrap
```

- Ownership is resolved **only** from the `__Host-ah_session` cookie. A forged
  `user_id` in the body is ignored; cross-account access is impossible.
- Idempotent: replaying a batch is a no-op.
- Conflict: last-write-wins on `updated_at`. The loser gets `applied:false` with
  the authoritative `updated_at`, so the client re-pulls that store instead of
  retrying forever.
- Deletes are tombstones, so a pull can never resurrect a deleted row.

## Client engine (`student-data-sync.js`)

- `dbPut` / `dbDel` mirror a write by dispatching `admissionhub:local-write`;
  the engine queues and flushes it (debounced, batched, offline-safe). The write
  itself never waits on the network.
- First login: existing local rows upload once per account (`migrateLocal`),
  in batches, without ever clearing local data first.
- A new device pulls everything (`pullAll`), land rows into IndexedDB, then
  rebuilds the in-memory cache once and re-renders.
- Pulled rows carry `syncedAt` and are written while the engine raises
  `admissionhub:sync-apply-start/end`, so a pull can never echo back as a push.
- Signing out clears the queue so another account cannot inherit it.

## Tests

`npm run test:sync` — 28 tests. Server contract: isolation, replay, LWW,
tombstones, pagination, R2 spill/rehydrate, archive-failure fallback.
Client engine: offline retention, coalescing, 401 handling, logout safety,
migration-once, pull idempotence, no-echo guarantee.

## Follow-ups

- Phase G: notification engine reads server-side learning state (revision due,
  mistakes, streak, inactivity) with per-user preferences.
- Consider Workers Paid ($5/mo → 1 TB D1) past the free-tier row-write limit.
- Long-term: archive old exam summaries to R2 and prune D1 by age.
