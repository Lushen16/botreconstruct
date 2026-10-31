const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { inspectPe } = require('./audit_native.cjs');
const root = path.resolve(__dirname, '..');
const query = [
  "$ErrorActionPreference='Stop'",
  "$processes=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*\\ShibaLauncher\\*' -or $_.Name -eq 'PokeAlliance_dx.exe' } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath)",
  "$clients=@($processes | Where-Object { $_.Name -eq 'PokeAlliance_dx.exe' })",
  "$modules=@(foreach($client in $clients) { try { (Get-Process -Id $client.ProcessId).Modules | Where-Object { $_.FileName -notlike 'C:\\Windows\\*' } | Select-Object @{Name='ProcessId';Expression={$client.ProcessId}},ModuleName,FileName,ModuleMemorySize } catch { [pscustomobject]@{ProcessId=$client.ProcessId;Error=$_.Exception.Message} } })",
  "$pipes=@(Get-ChildItem -LiteralPath '\\\\.\\pipe\\' | Where-Object {$_.Name -like 'pka-runtime-2-*'} | Select-Object -ExpandProperty Name)",
  "[pscustomobject]@{processes=$processes;visibleClientModules=$modules;pipeNames=$pipes} | ConvertTo-Json -Depth 5",
].join('\n');
const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query],
  { encoding: 'utf8', timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024 });
const metadata = JSON.parse(output.trimStart());
const scanned = new Set();
const clientFiles = metadata.processes.filter(item => item.Name === 'PokeAlliance_dx.exe').flatMap(item => {
  if (scanned.has(item.ExecutablePath)) return [];
  scanned.add(item.ExecutablePath);
  const bytes = fs.readFileSync(item.ExecutablePath);
  return [{ path: item.ExecutablePath, pe: inspectPe(bytes),
    literalMarkers: ['pka-runtime-2-', 'PKA2/', 'automation_control', 'automation_lease', 'shiba_bots.dll'].map(value => ({
      value, asciiOffset: bytes.indexOf(Buffer.from(value)), utf16Offset: bytes.indexOf(Buffer.from(value, 'utf16le')) })) }];
});
const report = { generatedAt: new Date().toISOString(), ...metadata, clientFiles,
  connectionsOpened: false, commandsSent: false, processMemoryDumped: false,
  credentialsRead: false, originalFilesModified: false,
  limitations: ['Pipe names do not establish server ownership or authenticated protocol state.',
    'Visible module enumeration does not cover all possible in-memory code.',
    'Absent ASCII/UTF-16 literals do not establish absence of an implementation.',
    'REA objdump section inspection was unavailable on this Windows host (ERR_REA_WINDOWS_NATIVE).'] };
fs.writeFileSync(path.join(root, 'connected-runtime-observation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ processes: metadata.processes.length, pipeNames: metadata.pipeNames,
  clientFiles: clientFiles.map(item => ({ path: item.path, sha256: item.pe.sha256 })), commandsSent: false }, null, 2));
