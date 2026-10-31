param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 2147483647)]
  [int]$ClientPid,
  [string]$PlayerName,
  [switch]$ObserveOnly
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if ($env:PKA_SIMULATE -eq '1') { throw 'Remova PKA_SIMULATE antes de testar o cliente real.' }
$env:PKA_PID = [string]$ClientPid
if ($PlayerName) { $env:PKA_PLAYER_NAME = $PlayerName }
node tools/live_preflight.cjs --verify
if ($LASTEXITCODE -ne 0 -and -not $ObserveOnly) {
  throw 'Prontidao nativa pendente. Consulte live-preflight.json. Nenhum motor foi iniciado.'
}
if ($ObserveOnly) { Write-Host 'Somente observacao RPM; combate, cura e caminhada ainda dependem do canal nativo.' }
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:ELECTRON_NO_ASAR -ErrorAction SilentlyContinue
$electron = Join-Path $PSScriptRoot 'runtime\electron-v44.7.2\electron.exe'
$application = Join-Path $PSScriptRoot 'reconstruction\app'
Start-Process -FilePath $electron -ArgumentList ('"' + $application + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
