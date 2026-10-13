#Requires -RunAsAdministrator
# Excluye el Postgres de Laragon de Windows Defender.
# El sintoma tipico es 0xC0000142 (STATUS_DLL_INIT_FAILED) al crear backends:
# el postmaster mata todo el cluster. Ejecutar una vez en PowerShell como Admin:
#   powershell -ExecutionPolicy Bypass -File backend\scripts\pg-defender-exclusions.ps1

$ErrorActionPreference = "Stop"

$paths = @(
  "C:\laragon\bin\postgresql",
  "C:\laragon\data\postgresql",
  "C:\laragon\tmp"
)
$procs = @("postgres.exe", "pg_ctl.exe", "psql.exe", "initdb.exe")

foreach ($p in $paths) {
  if (Test-Path $p) {
    Add-MpPreference -ExclusionPath $p
    Write-Host "ExclusionPath: $p"
  }
}

foreach ($proc in $procs) {
  Add-MpPreference -ExclusionProcess $proc
  Write-Host "ExclusionProcess: $proc"
}

Write-Host ""
Write-Host "Listo. Reinicia Postgres:"
Write-Host "  npm --prefix backend run db:pg:stop"
Write-Host "  npm --prefix backend run db:pg:start"
Write-Host "O Start All en Laragon."
