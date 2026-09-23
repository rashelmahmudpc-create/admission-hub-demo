#!/usr/bin/env node
// Mirror the publishable shell into dist/ exactly like the Pages workflows do,
// using the same exclude list, for machines without rsync.
import { cpSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');

const EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', 'docs', 'AGENT_RESUME', 'ai-proxy', 'auth',
  'auth-native', 'email-gateway', 'apps-script', 'uploads', '.github', 'dist'
]);
const EXCLUDED_FILES = new Set([
  'gk-agent-worker.js', 'public-worker.js', 'ai-agent.js', 'worker-bundle.mjs',
  'voice-worker.js', 'notification-worker.js', 'fcm-notification.mjs',
  'wrangler.toml', 'package.json', 'package-lock.json'
]);
const isExcluded = name =>
  EXCLUDED_DIRS.has(name) || EXCLUDED_FILES.has(name) ||
  name.endsWith('.test.mjs') || name.endsWith('.md');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

let copied = 0;
const walk = dir => {
  for (const name of readdirSync(dir)) {
    if (isExcluded(name)) continue;
    const from = join(dir, name);
    const to = join(dist, relative(root, from));
    if (statSync(from).isDirectory()) {
      mkdirSync(to, { recursive: true });
      walk(from);
    } else {
      cpSync(from, to);
      copied += 1;
    }
  }
};
walk(root);
console.log(`dist: ${copied} files`);
