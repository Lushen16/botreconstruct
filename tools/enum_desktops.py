import ctypes
from ctypes import wintypes
u32 = ctypes.windll.user32

def enum_win_cb(hwnd, lparam):
    p = wintypes.DWORD()
    u32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
    if p.value == 27964:
        length = u32.GetWindowTextLengthW(hwnd)
        t = ''
        if length > 0:
            b = ctypes.create_unicode_buffer(length + 1)
            u32.GetWindowTextW(hwnd, b, length + 1)
            t = b.value
        c = ctypes.create_unicode_buffer(256)
        u32.GetClassNameW(hwnd, c, 256)
        print(f'MATCH: HWND {hex(hwnd)} Class {c.value} Title {t}')
    return True

WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

def desk_cb(desk_name, lparam):
    print(f'Desktop: {desk_name}')
    hDesk = u32.OpenDesktopW(desk_name, 0, False, 0x0100)
    if hDesk:
        u32.EnumDesktopWindows(hDesk, WNDENUMPROC(enum_win_cb), 0)
        u32.CloseDesktop(hDesk)
    return True

DESKENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.LPCWSTR, wintypes.LPARAM)
hWinsta = u32.GetProcessWindowStation()
print(f'WindowStation: {hex(hWinsta)}')
u32.EnumDesktopsW(hWinsta, DESKENUMPROC(desk_cb), 0)
