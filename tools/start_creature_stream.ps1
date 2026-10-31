param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [ValidateRange(200, 500)][int]$IntervalMs = 300,
    [ValidateRange(1000, 2147483647)][int]$DiscoveryMs = 10000,
    [string]$Output = $null,
    [string]$PlayerName = "Nobutdopai",
    [string]$Python = 'python',
    [int]$IdOffset = 0x5C,
    [int]$HpOffset = 0xC0,
    [int]$CanAttackOffset = 0xC4,
    [string[]]$ScannerArgs = @()
)

$ErrorActionPreference = 'Stop'
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Output) { $Output = Join-Path $scriptDir '..\live-creatures.json' }
$outputPath = [IO.Path]::GetFullPath($Output)
$parentPath = Split-Path -Parent $outputPath
[IO.Directory]::CreateDirectory($parentPath) | Out-Null
$arguments = @((Join-Path $scriptDir 'scan_creatures.py'), '--pid', "$ProcessId",
    '--stream', '--interval-ms', "$IntervalMs", '--discovery-ms', "$DiscoveryMs",
    '--output', $outputPath, '--id-offset', "$IdOffset", '--hp-offset', "$HpOffset",
    '--canattack-offset', "$CanAttackOffset")
if ($PlayerName) {
    $arguments += @('--player-name', $PlayerName)
}
$arguments += $ScannerArgs
foreach ($argument in $arguments) {
    if ($argument.Contains('"') -or $argument.Contains("`n") -or $argument.EndsWith('\')) {
        throw 'Scanner arguments cannot contain quotes, newlines or a trailing backslash.'
    }
}
$process = Start-Process -FilePath $Python -ArgumentList $arguments -WindowStyle Hidden `
    -WorkingDirectory (Split-Path -Parent $scriptDir) -PassThru `
    -RedirectStandardOutput ($outputPath + '.stdout.log') `
    -RedirectStandardError ($outputPath + '.stderr.log')
[PSCustomObject]@{ ScannerPid = $process.Id; TargetPid = $ProcessId; Output = $outputPath;
    IntervalMs = $IntervalMs; ErrorLog = ($outputPath + '.stderr.log') }
