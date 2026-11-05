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
try {
  foreach ($command in @("supabase", "docker", "psql")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Missing prerequisite: $command" }
  }
  docker info | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is unavailable." }
  Invoke-Native "supabase" @("start", "-x", "studio,imgproxy,edge-runtime,logflare,vector,supavisor")
  $started = $true
  Invoke-Native "supabase" @("db", "reset", "--local")
  $status = & supabase status -o env
  if ($LASTEXITCODE -ne 0) { throw "Could not read local Supabase status." }
  $dbLine = $status | Where-Object { $_ -match "^DB_URL=" } | Select-Object -First 1
  if (-not $dbLine -or $dbLine -notmatch "^DB_URL=`"?(.+?)`"?$") { throw "Could not extract DB_URL." }
  $dbUrl = $Matches[1]
  Invoke-Native "psql" @($dbUrl, "-v", "ON_ERROR_STOP=1", "-f", "supabase/tests/fixtures/agent_execution_retirement_setup.sql")
  Invoke-Native "psql" @($dbUrl, "-v", "ON_ERROR_STOP=1", "-f", "supabase/migrations/20261105120000_retire_read_app_status_execution.sql")
  Invoke-Native "supabase" @("test", "db")
  Write-Host "PASS: local migration, permissions, inheritance, and audit retention checks completed."
} finally {
  if ($started -and -not $KeepSupabaseRunning) { & supabase stop --no-backup | Out-Null }
  Pop-Location
}
