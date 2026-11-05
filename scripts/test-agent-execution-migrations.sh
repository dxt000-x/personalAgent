#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
for command in supabase docker psql; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing prerequisite: $command" >&2; exit 1; }
done
docker info >/dev/null
cleanup() {
  if [[ "${KEEP_SUPABASE_RUNNING:-0}" != "1" ]]; then supabase stop --no-backup >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor
supabase db reset --local
eval "$(supabase status -o env)"
: "${DB_URL:?Supabase CLI did not return DB_URL}"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/fixtures/agent_execution_retirement_setup.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261105120000_retire_read_app_status_execution.sql
supabase test db
echo "PASS: local migration, permissions, inheritance, and audit retention checks completed."
