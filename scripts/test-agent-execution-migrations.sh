#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for command in supabase docker; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing prerequisite: $command" >&2; exit 1; }
done

docker info >/dev/null
cleanup() {
  if [[ "${KEEP_SUPABASE_RUNNING:-0}" != "1" ]]; then supabase stop --no-backup >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor
supabase db reset --local

DB_CONTAINER="supabase_db_personal-agent-local"
if ! docker ps --filter "name=^/${DB_CONTAINER}$" --filter "status=running" --format '{{.Names}}' | grep -Fxq "$DB_CONTAINER"; then
  echo "Expected local database container '$DB_CONTAINER' is not running. Check supabase/config.toml project_id." >&2
  exit 1
fi

docker cp supabase/tests/fixtures/agent_execution_retirement_setup.sql "$DB_CONTAINER:/tmp/agent_execution_retirement_setup.sql"
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/agent_execution_retirement_setup.sql

docker cp supabase/migrations/20261105120000_retire_read_app_status_execution.sql "$DB_CONTAINER:/tmp/retire_read_app_status_execution.sql"
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/retire_read_app_status_execution.sql

supabase test db --local
echo "PASS: local migration, permissions, inheritance, and audit retention checks completed."
