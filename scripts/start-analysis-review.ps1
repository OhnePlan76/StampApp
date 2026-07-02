param(
  [int]$Port = 5791,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
Set-Location -LiteralPath $projectRoot

$env:ANALYSIS_REVIEW_PORT = "$Port"
$url = "http://127.0.0.1:$Port"

Write-Host "StampApp Analyse-Review"
Write-Host "Projekt: $projectRoot"
Write-Host "URL:     $url"
Write-Host ""
Write-Host "Zum Beenden dieses Fenster mit Ctrl+C stoppen."
Write-Host ""

if (-not $NoBrowser) {
  Start-Process $url
}

& npm.cmd run review:analysis
