# FCM + Cloudflare Smart Notification System — 5-Phase Blueprint

**Status: Phase 1 IN PROGRESS** (released by owner 2026-09-16, "Ok start").
This document is the single source of truth for all agents. Work proceeds
strictly phase-by-phase: a phase is complete only when its Output/acceptance
criteria are met on production, then the next phase starts.

Phase 1 implementation notes (as built):
- Backend = new module `fcm-notification.mjs` inside the `admission-gk`
  worker (same origin as the app → session cookie auth, no CORS dance).
  Routes: `/api/notifications/{config,status,register-token,
  unregister-token,devices,preferences,test}` +
  `/internal/notifications/health`.
- Storage = D1 `PROFILE_DB` (`fcm_devices` + `notification_settings`),
  KV `GK_KV` for rate limits. Max 12 devices/user, 10 registrations/hour,
  5 tests/10min.
- Frontend = `notification-fcm.js` (lazy Firebase SDK — never on boot;
  idle-time token refresh; foreground delivery via SW postMessage) +
  `sw.js` v108 dual-mode push handler (FCM + legacy admission-notify) with
  deep-link click routing. Settings modal gains an FCM row; hidden dev
  test center at `#notif-dev`.
- Legacy path (Telegram + admission-notify VAPID push) untouched — stays
  as the backup channel.
- **Build status (2026-09-16):** all Phase 1 code committed (`21392e2`),
  gate **659/0** (incl. 12 new FCM contract tests), `node --check` clean on
  every touched file, bundle deterministic. Production deploy DEFERRED:
  the session environment had no Cloudflare API token (repo convention:
  defer rather than guess). Dist is staged. Deploy = 2 wrangler commands
  once a token + the Firebase secrets are available.
- **Firebase credentials VERIFIED (2026-09-16):** project
  `admission-hub-fcm` (sender 298090335130). Service-account JWT → OAuth
  token → FCM `messages:send` all confirmed live from the sandbox.
  Important fix discovered during verification: Google's token endpoint
  now REQUIRES the full RFC 7523 URN
  `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` (the shorthand
  `jwt-bearer` is rejected) — the worker uses the URN, covered by test.
  No custom VAPID key configured — FCM's default web-push VAPID applies
  (the web config the owner provided has no vapidKey field).
- Pending owner action: a Cloudflare API token (cfat_…) in the session
  environment, then the staged deploy runs (6 secrets + worker + Pages +
  verification).
- Pending owner action: Firebase project enablements + service-account
  key → worker secrets (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL /
  FIREBASE_PRIVATE_KEY + public web config vars). Until then the system
  reports `fcmConfigured: false` and degrades gracefully.

## Platform decision (owner, 2026-09-16)

- **No Vercel.** The entire notification backend runs on the existing
  Cloudflare stack (Worker `_worker.js` + Durable Objects SQLite + cron).
- **Database: Cloudflare** — User↔Device↔Token + preferences live in the
  same Durable Objects SQLite as user data (one student = one identity).
- **Telegram channel: stays as backup** (recommended; owner to confirm at
  Phase 2). FCM is primary, Telegram is the fallback channel.
- **Only open item: owner creates the free Firebase project** (10 minutes,
  no credit card) and hands over the service-account key. Everything else
  is agent-doable.

Scope note: this system coexists with — it does not replace — the existing
Telegram channel + in-app `NotificationHub` (notification-hub.js). The FCM
system adds reliable browser/device push at scale; the Phase 4 Notification
Center extends the existing center UI (Today / Yesterday / Earlier).

---

## Phase 1 — FCM Foundation

Goal: secure, production-ready FCM foundation on Cloudflare. When Phase 1
ends: an authenticated student grants permission → token is created →
token registered securely → backend sends an authenticated FCM request →
notification arrives → click routes to the right page → token
refresh/disable/invalid-token handling works.

### 1. Firebase + FCM setup
- Firebase project (owner-created, free, no card): FCM enabled, Web App
  registered, firebase config, VAPID keys, FCM Web SDK, service worker.
- HTTPS + service worker are mandatory for web push — both already exist
  in production.

### 2. PWA / service worker
- Dedicated `firebase-messaging-sw.js` handles background FCM messages →
  system notification, without the app being open.
- Coexists with the existing `sw.js` (precache/asset layer) — message
  handling lives in the messaging SW.

### 3. User permission UX (no intrusive browser popup on load)
```
┌────────────────────────────┐
│ 🔔 Stay on Track           │
│ Get useful reminders about │
│ your learning progress.    │
│ [ Enable Notifications ]   │
│        Maybe later         │
└────────────────────────────┘
```
Flow: user → custom explanation → Enable → browser permission → Allow →
FCM token → register token.

### 4. FCM token management (database)
```
fcm_devices
  id, user_id, fcm_token, platform, browser, device_info,
  created_at, updated_at, last_seen, is_active
```
One user → multiple devices (phone + tablet + laptop) → multiple tokens.
Never assume a single device per user.

### 5. Token registration API
```
FCM Token → POST /api/notifications/register-token → Worker → DB
```
Backend verifies: user authenticated, token format valid, duplicate
handled, correct user linkage.

### 6. Token refresh
App start → check token → changed? update : continue. Old token retired.

### 7. Notification preference state (database)
```
notification_settings
  user_id, push_enabled, global_enabled, personalized_enabled,
  event_enabled, quiet_hours_enabled, quiet_start, quiet_end, updated_at
```
Phase 1 builds the structure; Phase 2–3 rules consume it.

### 8. Cloudflare Worker backend (replaces "Vercel backend")
```
/api/notifications/
  ├── register-token
  ├── unregister-token
  ├── test
  └── preferences
```
The FCM service-account credential is NEVER exposed to the browser:
`Browser → Worker API → (secret in CF) → FCM`.

### 9. Secrets
`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
live in Cloudflare Worker secrets (wrangler `secret put`). `.env` is never
committed.

### 10. FCM HTTP v1
Modern FCM HTTP v1 API called server-side from the Worker, with
server-side Firebase Authentication (RS256 JWT via `crypto.subtle`).

### 11. Test notification
`POST /api/notifications/test` (admin/developer only):
Admin → Worker → FCM HTTP v1 → device → notification
("🔔 Admission Hub Connected — FCM notification system successfully
configured."). This is Phase 1's key verification.

### 12. Foreground + background handling
- App open → foreground handler → in-app notification UI.
- App closed/background → service worker → system notification.
- The same notification must never fire twice (foreground + background).

### 13. Notification click routing (architecture-ready from Phase 1)
Notification → click → deep link → app route
(`/dashboard`, `/course/<course>`, `/lesson/<id>`, `/notifications`).
Used by Phase 2 global notifications.

### 14. Unsubscribe system
Settings → Notifications → OFF → `push_enabled = false`, token
deactivated/removed as appropriate.

### 15. Automatic invalid-token cleanup
FCM `UNREGISTERED` / `INVALID_ARGUMENT` → `is_active = false` or safe
remove. No dead-token accumulation in the DB.

### 16. Security rules (mandatory)
Never: private key in frontend, service account on GitHub, `.env` commit,
public notification API, anonymous arbitrary token registration,
client-side direct FCM server API.
Always: authentication, server-side credentials, input validation, rate
limiting, token ownership verification, secure env/secret handling, error
logging.

### 17. Phase 1 UI
Settings → 🔔 Notifications: Push [ON]; categories (🌍 Platform Updates,
🎯 Learning Reminders, 🏆 Achievements, ⚡ Important Events) each [ON];
Quiet Hours (e.g. 11:00 PM – 7:00 AM). UI now, advanced rules later.

### 18. Developer test panel (hidden/admin route)
```
Notification Test Center
FCM Status        🟢 Connected
Current Device    🟢 Registered
Token             ••••••••••••••
[ Send Test ]
Test Type: ○ Basic  ○ Background  ○ Deep Link  ○ Data Message
```

### 19. Phase 1 testing checklist (before declaring done)
- Devices: iPhone Safari/PWA, Android Chrome, Desktop Chrome, Desktop
  Edge/Safari where supported.
- States: app open / background / closed; permission allowed / denied /
  later; notifications disabled; token refresh; logout→login; multiple
  devices.
- Backend: register / update / removal / invalid-token / auth / rate
  limiting / secret protection / error handling.

### 20. Phase 1 final architecture
```
                         USER
                           │
                           ▼
              ┌──────────────────────┐
              │  Admission Hub PWA   │
              └──────────┬───────────┘
                        Permission
                           ▼
                    ┌──────────┐
                    │  FCM     │
                    │ Web SDK  │
                    └─────┬────┘
                     FCM Token
                           ▼
              ┌──────────────────────┐
              │ Cloudflare Worker API│
              └──────────┬───────────┘
                           ▼
              ┌──────────────────────┐
              │ Durable Objects DB   │
              └──────────────────────┘

Send path:  Admin/Test → Worker → FCM HTTP v1 → device token
            → service worker → 🔔 notification
```

**Output:** one user who grants permission receives a notification on
their device/browser successfully.

## Phase 2 — 🌍 Global Notification System

Goal: the most efficient system for notifying everyone.

Features:

- FCM Topics: `all_students`, course-specific topics, subject/category
  topics
- Global announcement, new lesson, new course, feature announcement,
  maintenance notification
- Admin notification composer
- Instant send, scheduled send, notification preview
- Deep linking

Architecture:

```
Admin / Cron (Cloudflare)
     ↓
Cloudflare Worker
     ↓
FCM Topic
     ↓
100K / 1M+ Users
```

**Output:** a single global notification reaches a huge audience
efficiently.

## Phase 3 — 🎯 Personalized Smart Notification

Goal: notify only the users who actually need the notification.

User signals:

- Last active, study activity, course progress, lesson progress
- Streak, streak risk, practice activity, weak topic, pending lesson
- Achievement progress, notification preferences

Smart rules:

```
IF streak_at_risk        → streak reminder
IF inactive_for_X_days   → comeback reminder
IF course_progress_high  → completion reminder
IF pending_lesson        → lesson reminder
IF achievement_near      → achievement reminder
```

Critical: instead of generating a notification per user —

```
Database
   ↓
Eligibility Engine
   ↓
Limited Audience
   ↓
Batching
   ↓
FCM
```

User-level protection:

- Daily notification limit
- Category limit
- Quiet hours
- Duplicate prevention
- Already-notified check
- Priority system
- Opt-out handling

**Output:** notifications are smart, limited and non-spammy.

## Phase 4 — ⚡ Event + Automation + Analytics

Goal: make the notification system autonomous.

Event notifications: lesson completed → achievement → notification. Also:
level up, streak milestone, course completion, certificate unlocked,
challenge completed, personal best, important account event.

Automation: Cloudflare Worker cron triggers — Daily / Weekly / Monthly.

Notification analytics (tracked): Sent, Delivered, Opened, Clicked,
Failed, Disabled, Invalid token, CTR, Engagement.

Notification history — user-facing Notification Center:

```
🔔 Notification Center
Today
Yesterday
Earlier
```

**Output:** the whole system runs by itself and we can see which
notifications are effective.

## Phase 5 — 🧠 AI + Scale + Production Hardening

The Elite / Production phase.

AI Notification Engine — context-aware messages, only where AI genuinely
adds value (not for every notification):

```
User Data
   ↓
Rule Engine
   ↓
AI
   ↓
Personalized Message
   ↓
Safety Check
   ↓
FCM
```

Example:
"🔥 তোমার JavaScript course 82% complete। আর মাত্র কয়েকটা
lesson—আজ একটু এগোলেই course শেষের খুব কাছে চলে যাবে!"

Scale architecture:

```
            1M+ USERS
               │
               ▼
     ┌─────────────────┐
     │ Durable Objects │
     │     Database    │
     └────────┬────────┘
              ▼
     ┌─────────────────┐
     │  Cloudflare     │
     │ Worker API+Cron │
     └────────┬────────┘
        ┌─────┼─────┐
        ▼     ▼     ▼
     GLOBAL PERSONAL EVENT
     TOPIC   TOKEN    TOKEN
        └─────┬─────┘
              ▼
             FCM
              ▼
        USER DEVICES
```

Production hardening:

- Retry system, failure handling, rate limiting
- Token cleanup, idempotency
- Request authentication, secret protection, abuse prevention
- Monitoring, error logging, backup strategy
- Graceful degradation, cost/quota monitoring

---

## Daily notification model (final product shape)

```
প্রতিদিন
🌍 GLOBAL        → সবাইকে ১টি গুরুত্বপূর্ণ notification
🎯 PERSONALIZED  → সীমিত eligible users-কে ১টি smart notification
⚡ EVENT         → প্রয়োজন হলে individual notification
```

Not more notifications — only relevant ones.

## Quota discipline (owner rule)

FCM delivery may be free, but Cloudflare / Firebase / database free
quotas are NOT unlimited (Workers free tier request limits, DO storage
limits). Do not architect as if they were. Phase 5 ships quota-aware
batching, topics, limits and fallbacks so backend workload does not grow
pointlessly as users grow.

## Integration notes (existing stack)

- Existing: `notification-hub.js` (in-app toasts, web-push subscribe,
  Telegram fallback, settings: master toggle, quiet hours, dailyCap),
  Notification Center UI, per-user prefs in localStorage — extend, don't
  fork.
- User/device/token mapping must key off the existing auth subject
  (`auth_external_identities` / publicId) so one student = one identity.
- Worker talks to FCM server-side only; the FCM service-account secret
  never ships to the browser.
- Telegram channel remains the backup notification channel (FCM primary).
- Deep links target the existing hash routes / `AH-XXXXXX` public pages.

## Open items (only one remains)

1. ~~Database~~ → **Decided: Cloudflare (D1 `PROFILE_DB` — same DB as profiles).**
2. **Firebase project** — owner to create/enable (free, no card, ~10 min),
   then hand over: service-account key (JSON) + web app config
   (apiKey, projectId, messagingSenderId, appId, vapidKey). These go to
   Cloudflare Worker secrets on `admission-gk`. Steps provided.
3. ~~Vercel plan~~ → **Decided: no Vercel; Cloudflare Workers free tier.**
4. **Telegram channel** — kept as backup (recommended; confirm at
   Phase 2 start).

## Phase gate

A phase is DONE only when: its Output is verified on production, tests are
added and green, no existing feature broke (gate run), and the owner
confirmed. No phase work before the previous phase's gate.
