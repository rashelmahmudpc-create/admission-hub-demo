#!/usr/bin/env node
// Bump cache-busting versions across the shell in one step, then regenerate the
// service-worker digests. Usage: node scripts/cache-bump.mjs
//
// Keeping this scripted matters because the version string is asserted in
// several tests and duplicated in index.html and sw.js; a manual edit always
// misses one and the mismatch only shows up in a student's stale cache.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const relative = path => new URL(path, root);

// The asset version string shared by account-access.{js,css} and the
// language-engine table. Bump both when either file changes.
const UI_VERSION_FROM = '20260921-email-otp-blank-fix';
const UI_VERSION_TO = '20260921-relogin-device-challenge-fix';
const LANG_VERSION_FROM = 'lang-v3-dashboard';
const LANG_VERSION_TO = 'lang-v4-device-challenge';
const SW_BUILD_FROM = 'v281-auth-error-20260918';
const SW_BUILD_TO = 'v282-device-challenge-20260921';

const targets = [
  'index.html',
  'sw.js',
  'account-retirement.test.mjs',
  'interactive-native-personal-v1.test.mjs',
  'code-native-welcome-v1.test.mjs',
  'startup-ai-regression.test.mjs',
  'profile-ui.test.mjs',
  'fcm-global-contract.test.mjs',
  // The shell version is asserted by these older shell-contract suites too.
  // They were missing from this list, so a bump left them pinned to the
  // previous string and the suite failed on a version that had moved on.
  'idb-hardening.test.mjs',
  'intro.test.mjs',
  'p08-exam-ac3.test.mjs',
  'p08-state-preserve.test.mjs',
  'p10-mistakes.test.mjs',
  'p11-dashboard-v2.test.mjs',
  'p13-dashboard-cache-guard.test.mjs',
  'p16-dashboard-single.test.mjs',
  'p18-legacy-dashboard-kill.test.mjs',
  'p20-voice-sameorigin.test.mjs',
  'p21-ai-agent-ui.test.mjs',
  // The publish workflow greps the deployed shell for these exact literals, so
  // it pins the same version string and must move with it.
  '.github/workflows/telegram-auth-canary-activate.yml'
];

const replacements = [
  [UI_VERSION_FROM, UI_VERSION_TO],
  [LANG_VERSION_FROM, LANG_VERSION_TO],
  [SW_BUILD_FROM, SW_BUILD_TO]
];

let changed = 0;
for (const target of targets) {
  const url = relative(target);
  const before = readFileSync(url, 'utf8');
  let after = before;
  for (const [from, to] of replacements) after = after.split(from).join(to);
  if (after !== before) {
    writeFileSync(url, after);
    changed += 1;
    console.log(`updated ${target}`);
  }
}

console.log(`${changed} file(s) updated; regenerating service-worker digests`);
execFileSync('node', [relative('scripts/sw-manifest.mjs').pathname], { stdio: 'inherit' });
