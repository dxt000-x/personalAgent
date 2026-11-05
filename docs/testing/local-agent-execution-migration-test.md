# Local Agent execution migration test

This test uses a local Supabase stack only. It does not link to or modify a hosted project.

## Prerequisites

- Docker Desktop running
- Supabase CLI installed
- PowerShell on Windows, or Bash on macOS/Linux/Git Bash

The scripts use the psql binary inside the local Supabase database container, so a host PostgreSQL installation is not required.

The local database major version is pinned to PostgreSQL 17 to match the isolated hosted project's PostgreSQL 17.11.

## Windows PowerShell

From the repository root:

```powershell
.\scripts\test-agent-execution-migrations.ps1
```

To keep the local stack running:

```powershell
.\scripts\test-agent-execution-migrations.ps1 -KeepSupabaseRunning
```

## macOS, Linux, or Git Bash

```bash
bash scripts/test-agent-execution-migrations.sh
```

Set KEEP_SUPABASE_RUNNING=1 to keep the local stack running.

## What it validates

1. Starts local Supabase with PostgreSQL 17 and resets the local database.
2. Applies all checked-in migrations in timestamp order.
3. Inserts synthetic legacy data: two read_app_status authorizations and eight audit events.
4. Re-runs the retirement migration with the historical fixture present.
5. Runs pgTAP assertions proving:
   - the retired issue/consume overloads are not executable by the writer role or its login member;
   - all three read_current_time functions remain executable by the writer and inherited login;
   - writer membership and legacy function definitions remain;
   - both historical authorization rows and all eight events remain unchanged.

The setup fixture lives in `supabase/fixtures/`, outside `supabase/tests/`, so the Supabase pgTAP runner does not execute it as a test. It uses synthetic IDs and no production data or credentials.

## Safety boundary

- Do not run the fixture or migration against a linked/hosted project.
- The scripts do not call supabase link, supabase db push, or any hosted project API.
- The local stack is stopped automatically unless the keep-running option is selected.
- A local PASS proves local PostgreSQL behavior only. It does not authorize applying the migration to the hosted project.
