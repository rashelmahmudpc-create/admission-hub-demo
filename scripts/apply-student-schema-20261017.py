#!/usr/bin/env python3
"""Fresh Start phase 2 (2026-10-17): wire the versioned student-directory
schema (auth-native/storage/student-directory-schema.mjs) into the
AUTH_AUTHORITY Durable Object start-up, add its test to test:native-auth and
tick the plan. Purely additive. Idempotent: running twice changes nothing."""
from pathlib import Path

root = Path(__file__).resolve().parent.parent


def patch(rel, old, new, done_marker):
    p = root / rel
    s = p.read_text(encoding='utf-8')
    if done_marker in s:
        print(f'{rel}: already applied')
        return
    if s.count(old) != 1:
        raise SystemExit(f'{rel}: anchor not found exactly once')
    p.write_text(s.replace(old, new), encoding='utf-8')
    print(f'{rel}: patched')


DO = 'auth-native/worker/auth-authority-do.mjs'
patch(DO,
      "import { D1ProfileStore } from '../storage/d1-profile-repository.mjs';\n",
      "import { D1ProfileStore } from '../storage/d1-profile-repository.mjs';\n"
      "import { migrateStudentDirectory } from '../storage/student-directory-schema.mjs';\n",
      "import { migrateStudentDirectory }")
patch(DO,
      "      this.verificationRepository.migrate();\n",
      "      this.verificationRepository.migrate();\n"
      "      // Fresh Start phase 2: additive, versioned student-directory schema.\n"
      "      // Isolated so a problem here can never take sign-in down.\n"
      "      try {\n"
      "        this.studentDirectorySchema = migrateStudentDirectory(state.storage);\n"
      "      } catch (error) {\n"
      "        this.studentDirectorySchema = { version: 0, applied: [], error: String(error?.message || error).slice(0, 200) };\n"
      "      }\n",
      "this.studentDirectorySchema = migrateStudentDirectory(state.storage);")

# The auth runtime must not log (native-auth-protection.test.mjs): the failure
# is kept on this.studentDirectorySchema.error instead.
_do = root / DO
_s = _do.read_text(encoding='utf-8')
_line = "        console.error('student directory migration failed', error);\n"
if _line in _s:
    _do.write_text(_s.replace(_line, ''), encoding='utf-8')
    print(f'{DO}: logging line removed')

patch('package.json',
      "signup-autosave.test.mjs passkey-once.test.mjs",
      "signup-autosave.test.mjs student-directory-schema.test.mjs passkey-once.test.mjs",
      "student-directory-schema.test.mjs")

patch('docs/fresh-start-plan.md',
      "- [ ] Phase 2: new versioned schema",
      "- [x] Phase 2 (2026-10-17): new versioned schema",
      "- [x] Phase 2")

PLAN = root / 'docs/fresh-start-plan.md'
s = PLAN.read_text(encoding='utf-8')
if '## Phase 2 schema' not in s:
    s = s.rstrip('\n') + """

## Phase 2 schema
- Code: `auth-native/storage/student-directory-schema.mjs`, test `student-directory-schema.test.mjs` (in `test:native-auth`).
- Where: same Durable Object SQLite as auth (`AUTH_AUTHORITY`). Runs on every DO start, after the auth_* migrations, inside try/catch (never blocks sign-in).
- Versioning: `schema_migrations(version, name, applied_at)`. v1 = `student_directory_v1`. New change = new version; never edit an applied one. Each version runs in one transaction.
- Tables (v1): students (email + email_normalized UNIQUE, trim+NFKC+lowercase, plus-aliases kept; status pending/active/disabled; auth_user_id UNIQUE), login_methods (password/google/facebook/telegram/passkey; one identity -> one student), email_verifications (otp/firebase-link/telegram/oauth), otp_attempts (provider, outcome, latency; no codes), devices, sessions (opaque id, no tokens), profiles, activity_log (json_valid). All children ON DELETE CASCADE -> deleting a student removes everything.
- Purely additive: no auth_* table touched, old data not migrated, new tables start empty. Writes/reads come in Phase 3 (Control Center) -- nothing writes into them yet.
"""
    PLAN.write_text(s + '\n', encoding='utf-8')
    print('docs/fresh-start-plan.md: phase 2 section added')
