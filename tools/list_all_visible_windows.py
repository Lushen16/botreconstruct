import ctypes
from ctypes import wintypes
u32 = ctypes.windll.user32
windows = []
def cb(hwnd, lparam):
    if u32.IsWindowVisible(hwnd):
        p = wintypes.DWORD()
        u32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
        length = u32.GetWindowTextLengthW(hwnd)
        t = ''
        if length > 0:
            b = ctypes.create_unicode_buffer(length + 1)
            u32.GetWindowTextW(hwnd, b, length + 1)
            t = b.value
        c = ctypes.create_unicode_buffer(256)
        u32.GetClassNameW(hwnd, c, 256)
        if t:
            windows.append((hwnd, p.value, t, c.value))
    return True
WNDPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
u32.EnumWindows(WNDPROC(cb), 0)
for h, p, t, c in windows:
    print(f'PID: {p:<6} HWND: {hex(h):<10} Class: {c:<25} Title: {t}')
