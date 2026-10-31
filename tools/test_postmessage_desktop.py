import ctypes, time
from ctypes import wintypes
u32 = ctypes.WinDLL('user32', use_last_error=True)

hDesk = u32.OpenDesktopW('Default', 0, False, 0x01FF)
print(f'OpenDesktop: {hex(hDesk)} (err={ctypes.get_last_error()})')
if hDesk:
    u32.SetThreadDesktop(hDesk)

hwnd = 0x709d2
WM_KEYDOWN = 0x0100
WM_KEYUP = 0x0101
VK_F1 = 0x70

res1 = u32.PostMessageW(hwnd, WM_KEYDOWN, VK_F1, 0)
err1 = ctypes.get_last_error()
time.sleep(0.05)
res2 = u32.PostMessageW(hwnd, WM_KEYUP, VK_F1, 0xC0000001)
err2 = ctypes.get_last_error()
print(f'Result: keydown={res1} (err={err1}), keyup={res2} (err={err2})')
