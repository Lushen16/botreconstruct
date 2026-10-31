import ctypes
from ctypes import wintypes
u32 = ctypes.windll.user32
pid = 27964
windows = []
def cb(hwnd, lparam):
    p = wintypes.DWORD()
    u32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
    if p.value == pid:
        length = u32.GetWindowTextLengthW(hwnd)
        t = ''
        if length > 0:
            b = ctypes.create_unicode_buffer(length + 1)
            u32.GetWindowTextW(hwnd, b, length + 1)
            t = b.value
        c = ctypes.create_unicode_buffer(256)
        u32.GetClassNameW(hwnd, c, 256)
        windows.append((hwnd, bool(u32.IsWindowVisible(hwnd)), t, c.value))
    return True
WNDPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
u32.EnumWindows(WNDPROC(cb), 0)
print(f'Windows found: {len(windows)}')
for h, v, t, c in windows:
    print(f'HWND: {hex(h)} Visible: {v} Class: {c} Title: {t}')
