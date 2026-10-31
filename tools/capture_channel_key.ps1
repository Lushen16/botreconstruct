#Requires -Version 5.1
<#
  Captura a PKA_CHANNEL_KEY do menu PKA Tools em execucao.
  Leitura somente: abre o processo com PROCESS_QUERY_LIMITED_INFORMATION | VM_READ,
  le o bloco de ambiente do PEB e grava key/pid em PKARecon\channel-key.json.
  Nao injeta, nao altera e nao fecha o processo.
#>
param(
  [int]$ProcessId = 0,
  [string]$ProcessName = 'PKA Tools',
  [int]$TimeoutSeconds = 300,
  [string]$OutputDirectory = "$env:LOCALAPPDATA\PKARecon"
)

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class PkaPeb {
  [StructLayout(LayoutKind.Sequential)]
  public struct PBI { public IntPtr ExitStatus; public IntPtr PebBaseAddress; public IntPtr AffinityMask; public IntPtr BasePriority; public IntPtr UniqueProcessId; public IntPtr InheritedFromUniqueProcessId; }
  [DllImport("ntdll.dll")]
  static extern int NtQueryInformationProcess(IntPtr process, int infoClass, ref PBI info, int length, out int returnLength);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr OpenProcess(uint access, bool inherit, int processId);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] buffer, int size, out IntPtr read);
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr handle);
  public static string[] Read(int processId) {
    IntPtr handle = OpenProcess(0x1000 | 0x0010, false, processId);
    if (handle == IntPtr.Zero) throw new Exception("OpenProcess falhou: " + Marshal.GetLastWin32Error());
    try {
      PBI info = new PBI(); int returned;
      int status = NtQueryInformationProcess(handle, 0, ref info, Marshal.SizeOf(info), out returned);
      if (status != 0) throw new Exception("NtQueryInformationProcess falhou: 0x" + status.ToString("x"));
      byte[] pointer = new byte[8]; IntPtr read;
      if (!ReadProcessMemory(handle, (IntPtr)((long)info.PebBaseAddress + 0x20), pointer, 8, out read)) throw new Exception("PEB falhou: " + Marshal.GetLastWin32Error());
      long parameters = BitConverter.ToInt64(pointer, 0);
      if (!ReadProcessMemory(handle, (IntPtr)(parameters + 0x80), pointer, 8, out read)) throw new Exception("ProcessParameters falhou: " + Marshal.GetLastWin32Error());
      long environment = BitConverter.ToInt64(pointer, 0);
      List<byte> collected = new List<byte>();
      for (int offset = 0; offset < 262144; offset += 4096) {
        byte[] chunk = new byte[4096]; IntPtr got;
        if (!ReadProcessMemory(handle, (IntPtr)(environment + offset), chunk, chunk.Length, out got)) break;
        int length = (int)(long)got;
        if (length <= 0) break;
        collected.AddRange(new ArraySegment<byte>(chunk, 0, length));
        if (length < chunk.Length) break;
      }
      string text = Encoding.Unicode.GetString(collected.ToArray());
      List<string> list = new List<string>();
      int start = 0;
      while (start < text.Length) {
        int end = text.IndexOf('\0', start);
        if (end <= start) break;
        list.Add(text.Substring(start, end - start));
        start = end + 1;
      }
      return list.ToArray();
    } finally { CloseHandle(handle); }
  }
}
'@ -Language CSharp -ErrorAction Stop

function Find-Target {
  if ($ProcessId -gt 0) { return Get-Process -Id $ProcessId -ErrorAction SilentlyContinue }
  return Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
}

Write-Host "Aguardando '$ProcessName' (timeout ${TimeoutSeconds}s)..." -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$target = $null
while ((Get-Date) -lt $deadline) {
  $target = Find-Target
  if ($target) { break }
  Start-Sleep -Milliseconds 500
}
if (-not $target) { Write-Host "Processo nao encontrado." -ForegroundColor Red; exit 2 }

$targetPid = $target.Id
$commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$targetPid" -ErrorAction SilentlyContinue).CommandLine
Write-Host "Processo $targetPid encontrado. Lendo ambiente..." -ForegroundColor Cyan
$vars = [PkaPeb]::Read($targetPid)
$channelKey = $vars | Where-Object { $_ -like 'PKA_CHANNEL_KEY=*' } | Select-Object -First 1
$related = $vars | Where-Object { $_ -match '^PKA' }

if (-not $channelKey) {
  Write-Host "PKA_CHANNEL_KEY ausente neste processo." -ForegroundColor Yellow
  if ($related) { "Variaveis PKA presentes:"; $related }
  exit 3
}

$key = $channelKey.Substring('PKA_CHANNEL_KEY='.Length)
if (-not (Test-Path -LiteralPath $OutputDirectory)) { New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null }
$record = [ordered]@{
  capturedAt = (Get-Date).ToUniversalTime().ToString('o')
  pid = $targetPid
  key = $key
  keyLength = $key.Length
  commandLine = $commandLine
  relatedVariables = @($related | Where-Object { $_ -ne $channelKey })
}
$file = Join-Path $OutputDirectory 'channel-key.json'
$record | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $file -Encoding UTF8

Write-Host "Chave capturada ($($key.Length) chars)." -ForegroundColor Green
Write-Host "Arquivo: $file" -ForegroundColor Green
Write-Host "PID: $targetPid" -ForegroundColor Green
if ($related | Where-Object { $_ -ne $channelKey }) {
  Write-Host "Outras variaveis PKA:" -ForegroundColor Cyan
  $related | Where-Object { $_ -ne $channelKey }
}
exit 0
