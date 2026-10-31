const fs = require('fs');
const path = require('path');

const VK_MAP = {
  f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73, f5: 0x74, f6: 0x75,
  f7: 0x76, f8: 0x77, f9: 0x78, f10: 0x79, f11: 0x7A, f12: 0x7B,
  up: 0x26, down: 0x28, left: 0x25, right: 0x27,
  space: 0x20, enter: 0x0D, escape: 0x1B, tab: 0x09
};

function getVirtualKey(keyName) {
  if (!keyName) return null;
  const lower = String(keyName).toLowerCase().trim();
  if (VK_MAP[lower] !== undefined) return VK_MAP[lower];
  if (lower.length === 1) {
    const code = lower.toUpperCase().charCodeAt(0);
    if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5A)) {
      return code;
    }
  }
  return null;
}

const scriptContent = 
const { execSync } = require('child_process');

function sendKeyToPid(pid, keyName) {
  const vk = getVirtualKey(keyName);
  if (!vk) return false;
  // Dispatch via powershell user32 PostMessage
  const psCmd = \
    \\ = Add-Type -MemberDefinition '
      [DllImport( user32.dll)] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
      [DllImport(user32.dll)] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    ' -Name User32_ -Namespace Win32 -PassThru

    \\ = Get-Process -Id 10684 -ErrorAction SilentlyContinue
    if (\\ -and \\.MainWindowHandle -ne [IntPtr]::Zero) {
      \\ = \\.MainWindowHandle
      \\ = 0x0100
      \\ = 0x0101
      [Win32.User32_]::PostMessage(\\, \\, [IntPtr], [IntPtr]0)
      Start-Sleep -Milliseconds 30
      [Win32.User32_]::PostMessage(\\, \\, [IntPtr], [IntPtr]0xC0000001)
    }
  \;
  return true;
}
;

console.log('Testing key mapping:', getVirtualKey('f1'), getVirtualKey('space'), getVirtualKey('m'));
