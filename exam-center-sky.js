/* Deliberate no-op stub.
   The exam centre was rolled back on 2026-10-18, but Cloudflare Pages keeps
   serving a deleted file, and an already-installed service worker can hold a
   shell from an older build that still has <script src="exam-center-sky.js">.
   This path therefore has to keep existing and stay harmless: a stale shell
   loads this and does nothing, instead of loading the old exam code and
   crashing on #dots. Do not delete without bumping sw.js BUILD_ID first. */
