param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 2147483647)]
  [int]$ClientPid,
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$PlayerName,
  [switch]$Elevate,
  [switch]$LiveAudit
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($Elevate -and -not $isAdministrator) {
  $scriptLiteral = "'" + $PSCommandPath.Replace("'", "''") + "'"
  $playerLiteral = "'" + $PlayerName.Replace("'", "''") + "'"
  $command = '& ' + $scriptLiteral + ' -ClientPid ' + $ClientPid + ' -PlayerName ' + $playerLiteral + ' -Elevate'
  if ($LiveAudit) { $command += ' -LiveAudit' }
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-EncodedCommand', $encoded) -Verb RunAs -WindowStyle Hidden
  return
}
$env:PKA_PID = [string]$ClientPid
$env:PKA_PLAYER_NAME = $PlayerName.Trim()
if (-not $env:PKA_PLAYER_NAME) { throw 'Informe o nome do jogador.' }
$env:PKA_WALKER_BACKEND = 'keyboard'
$env:PKA_SESSION_FILE = Join-Path $PSScriptRoot ('live-walker-' + $ClientPid + '.json')
Remove-Item Env:PKA_SIMULATE -ErrorAction SilentlyContinue
Remove-Item Env:PKA_DIAGNOSTICS -ErrorAction SilentlyContinue
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:ELECTRON_NO_ASAR -ErrorAction SilentlyContinue
node -e "require('./reconstruction/live-client.cjs').selectPid(require('./reconstruction/live-client.cjs').discoverProcesses(),process.env.PKA_PID)"
if ($LASTEXITCODE -ne 0) { throw 'Selecao de cliente invalida.' }
$python = if ($env:PKA_PYTHON) { $env:PKA_PYTHON } else { 'python' }
& $python tools/pka_live_session.py --pid $ClientPid --probe-access
if ($LASTEXITCODE -ne 0) {
  throw 'Leitura RPM bloqueada. Se o jogo estiver como administrador, execute este launcher com -Elevate e confirme o UAC, ou reinicie o jogo sem elevacao.'
}
node tools/build_app.cjs
if ($LASTEXITCODE -ne 0) { throw 'Falha ao montar os assets da interface.' }
& $python tools/walker_input.py --pid $ClientPid --probe
if ($LASTEXITCODE -ne 0) { throw 'Janela do cliente indisponivel para o Walker.' }
Write-Host 'Walker independente: selecione uma rota Walk/Wait e clique em Iniciar. O cliente recebera foco.'
Write-Host 'Ao mudar de janela, o proximo movimento interrompe o Walker. Nenhuma chave do canal nativo e utilizada.'
Write-Host 'Target RPM integrado: aguarde o scanner e confira calibracao/hotkeys/protecao do roster em local-data/keyboard-combat.json. Limites: TARGET_RPM_VALIDACAO.md.'
$electron = Join-Path $PSScriptRoot 'runtime\electron-v44.7.2\electron.exe'
$application = Join-Path $PSScriptRoot 'reconstruction\app'
$applicationArguments = '"' + $application + '"'
if ($LiveAudit) { $applicationArguments += ' --live-ui-audit' }
Start-Process -FilePath $electron -ArgumentList $applicationArguments -WorkingDirectory $PSScriptRoot -WindowStyle Normal
