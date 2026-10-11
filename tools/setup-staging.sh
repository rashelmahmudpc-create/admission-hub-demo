#!/usr/bin/env bash
# 🧪 PHASE 19 — create the staging resources and fill wrangler.staging.toml.
#
# This is the one P19 step that needs the owner: it creates cloud resources
# (KV namespaces, a D1 database, an R2 bucket) and therefore needs a Cloudflare
# API token. Nothing here touches production — every resource it makes has the
# -staging suffix, and the isolation guard refuses a deploy that points at a
# production id.
#
# Run:
#   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... bash tools/setup-staging.sh
#
# It is safe to run twice: an existing resource is reused, not recreated.
set -euo pipefail

CONFIG="wrangler.staging.toml"
SUFFIX="staging"

need() { command -v "$1" >/dev/null 2>&1 || { echo "setup-staging: '$1' is required" >&2; exit 2; }; }
need npx

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "setup-staging: CLOUDFLARE_API_TOKEN is not set." >&2
  echo "  Create a token with Workers KV:Edit, D1:Edit and R2:Edit, then re-run." >&2
  exit 2
fi

echo "==> KV namespaces"
# One KV namespace per binding. wrangler prints the id; we capture it.
make_kv() {
  local name="$1"
  local out id
  out=$(npx --yes wrangler@4.35.0 kv namespace create "$name" 2>&1 || true)
  id=$(printf '%s' "$out" | grep -oE '[0-9a-f]{32}' | head -1)
  if [ -z "$id" ]; then
    # Already exists: list and match by title.
    id=$(npx --yes wrangler@4.35.0 kv namespace list 2>/dev/null \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);const m=a.find(x=>x.title===process.argv[1]);process.stdout.write(m?m.id:"")}catch(_){}})' "$name")
  fi
  [ -n "$id" ] || { echo "setup-staging: could not create or find KV '$name'" >&2; exit 1; }
  printf '%s' "$id"
}

GK_KV_ID=$(make_kv "admission-gk-${SUFFIX}")
PUB_KV_ID=$(make_kv "admission-gk-${SUFFIX}-pub")
OLD_KV_ID=$(make_kv "admission-gk-${SUFFIX}-old")

echo "==> D1 database"
D1_OUT=$(npx --yes wrangler@4.35.0 d1 create "admission-profile-${SUFFIX}" 2>&1 || true)
D1_ID=$(printf '%s' "$D1_OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
if [ -z "$D1_ID" ]; then
  D1_ID=$(npx --yes wrangler@4.35.0 d1 list 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);const m=a.find(x=>x.name===process.argv[1]);process.stdout.write(m?m.uuid||m.id:"")}catch(_){}})' "admission-profile-${SUFFIX}")
fi
[ -n "$D1_ID" ] || { echo "setup-staging: could not create or find D1 'admission-profile-${SUFFIX}'" >&2; exit 1; }

echo "==> R2 bucket"
# Creating an existing bucket is an error, so treat a failed create as "look for
# it" rather than "give up". The bucket is a hard requirement: the staging Worker
# binds FILE_BUCKET to it, and wrangler refuses to deploy a binding that points at
# a bucket that does not exist. Fail here with a clear message instead of letting
# the deploy fail later with a less obvious one.
R2_CREATE=$(npx --yes wrangler@4.35.0 r2 bucket create "admission-hub-${SUFFIX}" 2>&1 || true)
if ! printf '%s' "$R2_CREATE" | grep -qiE "created|already exists"; then
  R2_LIST=$(npx --yes wrangler@4.35.0 r2 bucket list 2>&1 || true)
  if ! printf '%s' "$R2_LIST" | grep -q "admission-hub-${SUFFIX}"; then
    echo "setup-staging: could not create or find R2 bucket 'admission-hub-${SUFFIX}'." >&2
    echo "  The Cloudflare token likely lacks R2:Edit. Add that permission to" >&2
    echo "  CLOUDFLARE_API_TOKEN and re-run; KV and D1 above were already made." >&2
    printf '%s\n' "$R2_CREATE" >&2
    exit 1
  fi
fi
echo "    admission-hub-${SUFFIX} ready"

echo "==> Filling $CONFIG"
node -e '
const fs=require("fs");
const [file,gk,pub,old,d1]=process.argv.slice(1);
let t=fs.readFileSync(file,"utf8");
t=t.replace("REPLACE_WITH_STAGING_GK_KV_ID",gk)
   .replace("REPLACE_WITH_STAGING_PUB_KV_ID",pub)
   .replace("REPLACE_WITH_STAGING_OLD_KV_ID",old)
   .replace("REPLACE_WITH_STAGING_D1_ID",d1);
fs.writeFileSync(file,t);
' "$CONFIG" "$GK_KV_ID" "$PUB_KV_ID" "$OLD_KV_ID" "$D1_ID"

echo "==> Verifying isolation"
node scripts/check-staging-isolation.mjs "$CONFIG"

cat <<EOF

Staging resources are ready and $CONFIG is filled in.

Next:
  1. Set the secrets staging actually needs (start with ADMIN_TOKEN):
       npx wrangler secret put ADMIN_TOKEN --config $CONFIG
  2. Deploy:
       npx wrangler deploy --config $CONFIG
  3. The Worker answers at:
       https://admission-gk-staging.<your-subdomain>.workers.dev/health

Production is untouched: no production id or name is present in $CONFIG.
EOF
