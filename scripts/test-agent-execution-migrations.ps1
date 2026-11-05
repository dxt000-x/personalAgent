[CmdletBinding()]
param([switch]$KeepSupabaseRunning)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $root
$started = $false
function Invoke-Native {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}
function Invoke-LocalDatabaseFile {
  param([string]$Container, [string]$SourcePath, [string]$ContainerFile)
  Invoke-Native "docker" @("cp", $SourcePath, "$($Container):/tmp/$ContainerFile")
  Invoke-Native "docker" @("exec", $Container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "/tmp/$ContainerFile")
}
try {
  foreach ($command in @("supabase", "docker")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Missing prerequisite: $command" }
  }
  docker info | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is unavailable." }

  Invoke-Native "supabase" @("start", "-x", "studio,imgproxy,edge-runtime,logflare,vector,supavisor")
  $started = $true
  Invoke-Native "supabase" @("db", "reset", "--local")

  $dbContainer = "supabase_db_personal-agent-local"
  $runningContainers = & docker ps --filter "name=^/$dbContainer$" --filter "status=running" --format "{{.Names}}"
  if ($LASTEXITCODE -ne 0 -or $runningContainers -notcontains $dbContainer) {
    throw "Expected local database container '$dbContainer' is not running. Check supabase/config.toml project_id."
  }

  Invoke-LocalDatabaseFile $dbContainer (Join-Path $root "supabase/tests/fixtures/agent_execution_retirement_setup.sql") "agent_execution_retirement_setup.sql"
  Invoke-LocalDatabaseFile $dbContainer (Join-Path $root "supabase/migrations/20261105120000_retire_read_app_status_execution.sql") "retire_read_app_status_execution.sql"
  Invoke-Native "supabase" @("test", "db", "--local")
  Write-Host "PASS: local migration, permissions, inheritance, and audit retention checks completed."
} finally {
  if ($started -and -not $KeepSupabaseRunning) { & supabase stop --no-backup | Out-Null }
  Pop-Location
}
