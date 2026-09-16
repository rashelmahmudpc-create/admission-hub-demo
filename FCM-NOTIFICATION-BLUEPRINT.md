# FCM + Vercel Smart Notification System — 5-Phase Blueprint

**Status: LOCKED — not started.** Owner instruction (2026-09-16): do not begin
implementation; this document is the single source of truth for all agents.
Work proceeds strictly phase-by-phase: one phase is complete only when its
Output/acceptance criteria are met on production, then the next phase starts.

Scope note: this system coexists with — it does not replace — the existing
Telegram channel + in-app `NotificationHub` (notification-hub.js). The FCM
system adds reliable browser/device push at scale; the Phase 4 Notification
Center extends the existing center UI (Today / Yesterday / Earlier).

---

## Phase 1 — Foundation & FCM Setup

Goal: notification infrastructure standing.

- Firebase project + FCM configure
- Web Push / PWA setup
- Service Worker
- Notification permission flow
- FCM registration token collection
- User ↔ Device ↔ Token database structure
- Token refresh/update
- Token revoke/delete
- Notification preferences
- Vercel project setup
- Environment variables & FCM credentials
- Secure server-side FCM communication
- Basic test notification
- Foreground/background notification handling

**Output:** one user who grants permission receives a notification on their
device/browser successfully.

## Phase 2 — 🌍 Global Notification System

Goal: the most efficient system for notifying everyone.

Features:

- FCM Topics: `all_students`, course-specific topics, subject/category topics
- Global announcement
- New lesson notification
- New course notification
- Feature announcement
- Maintenance notification
- Admin notification composer
- Instant send
- Scheduled send
- Notification preview
- Deep linking

Architecture:

```
Admin / Cron
     ↓
Vercel
     ↓
FCM Topic
     ↓
100K / 1M+ Users
```

**Output:** a single global notification reaches a huge audience efficiently.

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

Automation: Vercel Cron — Daily / Weekly / Monthly.

Notification analytics (tracked): Sent, Delivered, Opened, Clicked, Failed,
Disabled, Invalid token, CTR, Engagement.

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
         ┌───────────┐
         │ Database  │
         └──────────┘
               ▼
      ┌───────────────┐
      │    Vercel     │
      │ Functions/Cron│
      └───────┬───────┘
       ┌──────┼──────┐
       ▼      ▼      ▼
    GLOBAL  PERSONAL EVENT
    TOPIC    TOKEN    TOKEN
       └────────────┘
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

FCM delivery may be free, but Vercel / Firebase / database free quotas are
NOT unlimited. Do not architect as if they were. Phase 5 ships
quota-aware batching, topics, limits and fallbacks so backend workload does
not grow pointlessly as users grow.

## Integration notes (existing stack)

- Existing: `notification-hub.js` (in-app toasts, web-push subscribe,
  Telegram fallback, settings: master toggle, quiet hours, dailyCap),
  Notification Center UI, per-user prefs in localStorage — extend, don't
  fork.
- User/device/token mapping must key off the existing auth subject
  (`auth_external_identities` / publicId) so one student = one identity.
- Vercel functions talk to FCM server-side only; the FCM service-account
  secret never ships to the browser.
- Deep links target the existing hash routes / `AH-XXXXXX` public pages.

## Open decisions (owner to confirm before Phase 1)

1. Which database hosts User↔Device↔Token (existing Cloudflare DO/SQLite vs
   a Vercel-side DB)?
2. Which Firebase project + FCM credentials, and where are they stored
   (Vercel env vs CF secrets)?
3. Vercel plan assumption (Hobby free tier) and its cron/invocation limits.
4. Relationship to the Telegram channel after FCM is live (fallback? both?).

## Phase gate

A phase is DONE only when: its Output is verified on production, tests are
added and green, no existing feature broke (gate run), and the owner
confirmed. No phase work before the previous phase's gate.
