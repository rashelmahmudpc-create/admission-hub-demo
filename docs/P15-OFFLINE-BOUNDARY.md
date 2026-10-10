# P15 — Offline data boundary

This is the contract for what Admission Hub can and cannot do without a network.
It exists so the offline promise stays honest: we never claim a write is safe
unless it is, and never claim a feature works offline when it needs the server.

## The two guarantees

1. **A local write is never lost to a network failure.** Every student write
   lands in IndexedDB first and is mirrored to the account through a durable
   queue. If the network is down the write succeeds locally and the op waits.
2. **The queue converges.** Ops are coalesced per record (newest wins), persisted
   in `localStorage`, flushed on reconnect, and retried via Background Sync. A
   failed push is kept and retried — it is never silently dropped.

## Works with no network

- The **app shell**: `index.html`, styles, scripts and icons are precached by the
  service worker, so the app opens and renders offline.
- **Reading and practicing**: questions, topics and vocabulary ship with the app
  or are already cached; practice and exams run against local data.
- **Taking an exam**: results are written to IndexedDB locally and queued for the
  server. Finishing an exam offline is safe.
- **Local edits**: notes, plans, daily stats, mistakes, settings — all queued.

## Needs the network

- **Sign-in / registration / OTP**: auth APIs are never cached. A student cannot
  create an account or sign in offline.
- **Server sync**: push (`POST /api/userdata/sync`) and pull happen only online.
- **Notifications**: FCM registration and delivery need the network.
- **AI chat**, the **verification control center**, and the **first fetch of a
  profile photo** are online-only.

## Honest limits

- **Safari / iOS has no Background Sync.** A fully closed app on iOS cannot be
  woken by the OS. Those queued writes flush the next time the app is opened with
  a connection. The page-side `online` listener is the fallback everywhere else.
- **Clearing site data deletes unsent writes.** The queue lives in the browser's
  storage; wiping it removes anything not yet synced. Signing in on a new device
  pulls everything already synced.
- **Ownership is the server's decision.** The client never sends a user id; the
  server resolves the account from the session cookie. A queue is retained for its
  account and is not inherited by a different sign-in.

## Where this lives

- Service worker: `sw.js` (precache, bounded network-first, `sync` handler).
- Sync engine: `student-data-sync.js` (`AHStudentSync`), store list and queue.
- Indicator: `offline-status.js` / `offline-status.css` (honest online/pending pill).
- Tests: `p15-pwa-offline.test.mjs` (`npm run test:p15`).
