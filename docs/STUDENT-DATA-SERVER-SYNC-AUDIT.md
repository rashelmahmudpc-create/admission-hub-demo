# Student Data → Server Sync Migration — Technical Audit (Phase A)

Status: **audit only, no code changed.** Implementation awaits owner approval.

Method: read-only inspection of the current repository (`/tmp/ah`, branch
`fix/push-durable-fanout`). No architectural assumptions were made; every claim
below is traceable to a file/line in the tree.

---

## 1. Current architecture

```
Cloudflare Pages (static PWA)  ──proxy──►  Worker "admission-gk" (admissionhub)
  index.html + ~60 JS modules                  ├─ Durable Object AUTH_AUTHORITY
  IndexedDB "admissionHubPublicDB"             ├─ Durable Object EMAIL_COORDINATOR
  service worker sw.js                         ├─ D1  PROFILE_DB (admission-profile)
  localStorage (16 keys)                       ├─ KV  GK_KV / PUB_KV / OLD_KV
  sessionStorage (admin token)                 └─ R2  FILE_BUCKET
```

- **Frontend**: vanilla JS. No framework, no bundler on the client. `index.html`
  owns the boot path, IndexedDB layer, cache, and most exam logic; other modules
  attach to `window`.
- **Backend**: one Worker. Auth is a Durable Object; the FCM/notification engine
  is a module (`fcm-notification.mjs`), bundled into `worker-bundle.mjs`.
- **Supabase: does not exist in this repository.** `docs/PHASE3-FINAL-REPORT.md`
  and `docs/PHASE8-PLAN.md` record that Supabase was deliberately not bound
  (owner decision, "Option A"). The blueprint reference to Supabase is template
  residue. **Auth is native (email OTP + Telegram + passkey), not Supabase.**
- **No Pages Functions directory.** The worker is the only server-side surface.
- Storage split today: **static/shared content → server (KV/R2/D1)**, but
  **student activity → browser only**.

## 2. Current IndexedDB stores

`index.html`:

- `DB_NAME = 'admissionHubPublicDB'`, `DB_VERSION = 10` (line 948)
- 19 stores (line 949): `appMeta, subjects, topics, questions, deletedQuestions,
  exams, examResults, mistakes, vocabulary, vocabularyMaster, dailyStats,
  activityLogs, settings, notes, ADMISSION_PLANS, PLAN_DAYS, voiceCache,
  notifications, gkBank`
- Migrations: `runSchemaMigrations()` runs `ensureSchema` for v1..v10 (line 999);
  indexes only on `questions, topics, examResults, mistakes, vocabularyMaster,
  PLAN_DAYS`.
- Access helpers: `dbGetAll / dbGet / dbPut / dbPutMany / dbDelete / dbClear`
  (lines 1072–1120), with write serialization (`queueDb`) and a **memory-only
  fallback** when IndexedDB is unavailable.
- **Per-account scoping already exists**: records are stored as
  `${DATA_SCOPE}::${id}` with `__ahOwner`, and `fromScopedRecord` hides rows of
  other accounts (lines 952–956). `DATA_SCOPE` is set from `detail.user.id` on
  the `admissionhub:authchange` event (line 1213).
- **All reads/writes go through the helpers** — no feature writes to IndexedDB
  directly (verified). `cloud-content-sync.js` and `data-protection.js` also use
  the same database but read-only for sync/backup.

## 3. Current student-owned data (migrate candidates)

| Store | Owner | Notes |
|---|---|---|
| `examResults` | student | exam history, scores, accuracy (indexed by date) |
| `exams` | student | in-progress + completed attempts (indexed by date) |
| `mistakes` | student | mistake bank + revision state (`revisionStatus`, `mastered`, `masteredAt`) |
| `dailyStats` | student | per-day questions/correct/wrong/exams/timeMs → streak source |
| `activityLogs` | student | activity timeline (`day`, `ts`, `type`) — streak source |
| `notes` | student | notes |
| `ADMISSION_PLANS`, `PLAN_DAYS` | student | admission plans (indexed) |
| `settings` | student | prefs: theme, language, dailyTarget, revision size |
| `notifications` | student/mixed | client notification inbox; server also has `global_notifications` + `notification_reads` |

**Derived (no table needed):** progress, streak, weak topics, revision-due —
all computed from the rows above.

**Not student-owned (must NOT migrate):**

- `subjects, topics, questions, vocabulary, vocabularyMaster, gkBank` — public
  shared content already served/synced from the server
  (`GLOBAL_STORES` in `cloud-content-sync.js`).
- `deletedQuestions` — admin content moderation.
- `voiceCache` — device-local audio cache.
- `appMeta` — local boot flags.

## 4. Current server/database structure

D1 binding `PROFILE_DB` (= `admission-profile`). Tables created in-repo:

- **Auth**: `auth_users, auth_profiles, auth_account_state, auth_sessions,
  auth_challenges, auth_passkey_*, auth_trusted_devices, auth_external_identities,
  auth_public_identities, auth_email_ownership_links, auth_telegram_identity_links,
  auth_security_events, auth_rate_limits, auth_verification_*` …
- **Notification**: `fcm_devices`, `notification_settings`, `global_notifications`,
  `notification_reads`
- **Other**: `avatars`

`auth_profiles` holds identity/profile: `full_name, date_of_birth, school_id/name/
district, higher_*, admission_session, academic_goal` … (school/college/deadline).
**There are no student learning/activity tables.**

## 5. Existing API endpoints

Worker (`gk-agent-worker.js`):
`/api/health, /api/ask, /api/bank, /api/cloud/publish, /api/content,
/api/content/meta, /api/admin/content, /api/admin/publish, /api/ai, /api/ai/chat,
/api/ai/prefs, /api/ai/status, /api/gk/run, /api/gk/today, /pub/*`

Notification module (`fcm-notification.mjs`, 19 routes):
`/api/notifications/{status, register-token, unregister-token, preferences,
history, templates, global/send, global/cancel, global/schedule, topics/
subscribe, topics/unsubscribe, inbox/*, read/*, click/* …}`

Auth authority internals (DO): `/internal/session/get`, `/internal/session/create`,
`/internal/firebase/*`, `/internal/passkey/*`, `/internal/account/*`,
`/internal/avatar/*`.

There is **no** endpoint that reads or writes student learning data.

## 6. Existing auth flow

- Cookie `__Host-ah_session`, read by the worker (not by JS).
- `sessionUser(env, request)` calls the `AUTH_AUTHORITY` DO at
  `/internal/session/get` and returns `{ user: { id } }` — used by every
  session-guarded route (e.g. `fcm-notification.mjs:939–941`).
- Client: `account-access.js` dispatches `admissionhub:authchange` with
  `detail.user.id`; `index.html` sets `DATA_SCOPE`; all IndexedDB rows are
  scoped to it. On logout, memory is cleared and cache reloads.
- **Identity is always derived server-side from the session** — the client never
  supplies a trusted `user_id`. This is the correct basis for the new API.

## 7. What needs to migrate

Move the §3 student rows to server-backed, per-account storage:
`examResults, exams, mistakes, dailyStats, activityLogs, notes,
ADMISSION_PLANS, PLAN_DAYS, settings`. Leave §3 "not student-owned" content
alone. Add a `sync_queue` (local) and a sync/ack protocol.

## 8. Proposed database schema (D1, normalized)

Ownership via `user_id`; composite primary key so client IDs stay stable and
idempotent; soft delete via `deleted_at`; `updated_at` for LWW + incremental
pull; `origin_device` for diagnostics.

```sql
user_exam_results(user_id, id, exam_id, mode, score, correct, wrong, skipped,
                  time_ms, payload_json, created_at, updated_at, deleted_at,
                  origin_device, PRIMARY KEY(user_id,id))
user_exams       (user_id, id, status, started_at, completed_at, payload_json,
                  created_at, updated_at, deleted_at, origin_device, PK(user_id,id))
user_mistakes    (user_id, id, question_id, subject_id, topic_id, wrong_count,
                  revision_status, mastered, last_wrong_at, payload_json,
                  created_at, updated_at, deleted_at, origin_device, PK(user_id,id))
user_daily_stats (user_id, day, questions, correct, wrong, skipped, exams,
                  time_ms, created_at, updated_at, deleted_at, origin_device,
                  PK(user_id,day))
user_activity    (user_id, id, day, ts, type, exam_id, count, created_at,
                  updated_at, deleted_at, origin_device, PK(user_id,id))
user_notes       (user_id, id, title, body, payload_json, created_at,
                  updated_at, deleted_at, origin_device, PK(user_id,id))
user_plans       (user_id, id, payload_json, created_at, updated_at,
                  deleted_at, origin_device, PK(user_id,id))
user_plan_days   (user_id, id, plan_id, actual_date, payload_json, created_at,
                  updated_at, deleted_at, origin_device, PK(user_id,id))
user_settings    (user_id PRIMARY KEY, payload_json, updated_at, deleted_at,
                  origin_device, synced_at)
user_sync_meta   (user_id PRIMARY KEY, last_pull_at, last_push_at, device_count)
```

Indexes: `(user_id, updated_at)` on every table (incremental pull);
`(user_id, day)` on stats/activity; `(user_id, plan_id)` on plan days.
Explicitly **one table per entity, not one JSON blob per account**.

## 9. Proposed sync architecture

```
Action → dbPut() → IndexedDB (instant, offline-safe)
                 └→ enqueue(store, id, op, payload, updated_at) in sync_queue
                              │  (debounced, batched)
                    online? ──┴─► POST /api/userdata/sync  (batches ≤ 400)
                                     → server upsert by (user_id,id), LWW on updated_at
                                     → returns per-op ack / server_updated_at
                              ┌──────┘
                    mark synced, drop from queue
Pull: GET /api/userdata/pull?since=<cursor> → page → merge (LWW) → cursor
```

- **Idempotent**: composite PK + upsert; replaying a batch is a no-op.
- **Conflict**: last-write-wins on `updated_at`; **deletes are tombstones**, so a
  delete is never resurrected by a stale update.
- **Offline**: queue persists; UI never blocks; sync resumes on `online`/timer.
- **Bootstrap (new device)**: paginated pull → IndexedDB → normal UI.
- **Migration (existing device)**: detect local rows → validate → batch upload →
  ack → mark synced → keep local; never clear local before server confirmation.
- **Resumable**: queue + per-store cursor survive app close.

## 10. Migration risks

1. **Per-account scoping vs composite PK.** Existing rows are `DATA_SCOPE::id`;
   migration must strip the prefix to the real `id` and never merge across users
   (the `__ahOwner` guard already prevents cross-account reads).
2. **Record volume.** `questions`/`exams` can be large; must migrate only
   student-owned stores in batches, with pagination.
3. **`dailyStats` key conflict.** Its client ID is the date string, not a UUID —
   schema must key on `day` and reconcile, not blindly insert.
4. **In-progress exams.** Live exam state changes rapidly; must not upload on
   every keystroke (debounce) and must not let a stale device overwrite a newer
   submission.
5. **`settings` object drift.** Different modules write partial settings objects;
   LWW on a single row can drop fields. Needs a documented merge rule.
6. **Deletes.** Some features remove mistakes/notes; without tombstones a pull
   would bring them back.
7. **Cost.** Many small writes → many sync calls. Needs batching + debounce.
8. **Privacy.** Study data stays private to the account; admin must not get a
   student-data surface without explicit design.
9. **Backup interaction.** `data-protection.js` snapshots local state; restoring
   a stale snapshot must never overwrite newer server data.
10. **Existing offline behavior** must not regress (IDB-in-memory fallback,
    Safari reopen handling, boot-order).

## 11. Files that will be modified

- **New**: `student-data-sync.mjs` (client sync engine), `sync-queue.js`
  (local queue), `userdata-api.mjs` (worker routes + D1 access),
  `student-data-sync.test.mjs`, `docs/STUDENT-DATA-SYNC.md`.
- **Edited (surgical)**: `index.html` (add `sync_queue` store → DB_VERSION 11;
  hook `dbPut`/`dbDelete`; bootstrap pull on `authchange`), `gk-agent-worker.js`
  (register userdata routes), `wrangler.toml` (no new binding — reuse
  `PROFILE_DB`), `data-protection.js` (respect server-newer rule), `sw.js` +
  `index.html` pins (asset version), `package.json` (test script).

## 12. Files that should remain untouched

`account-access.js`, `auth-native/**` (auth DO), `notification-fcm.js`,
`firebase-messaging-sw.js`, `sdk/firebase*`, `cloud-content-sync.js` (public
content path), `vocabulary-master-tool.js`, content/admin tooling, and all exam/
progress rendering logic. The migration adds a sync layer **under** the existing
helpers; UI modules must not need changes.

---

## Next step

Awaiting approval to proceed to **Phase B (data model)** and **Phase C (secure
API)**, then **D (sync engine)** → **E (existing-data migration)** →
**F (multi-device)** → **G (notification integration)** → **H (resilience
tests)**. Nothing will be coded until this audit is accepted.
