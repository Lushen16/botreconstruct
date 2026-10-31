import ctypes
from ctypes import wintypes
u32 = ctypes.windll.user32
k32 = ctypes.windll.kernel32
pid = 27964

class THREADENTRY32(ctypes.Structure):
    _fields_ = [
        ('dwSize', wintypes.DWORD),
        ('cntUsage', wintypes.DWORD),
        ('th32ThreadID', wintypes.DWORD),
        ('th32OwnerProcessID', wintypes.DWORD),
        ('tpBasePri', wintypes.LONG),
        ('tpDeltaPri', wintypes.LONG),
        ('dwFlags', wintypes.DWORD)
    ]

hSnapshot = k32.CreateToolhelp32Snapshot(0x00000004, 0)
te = THREADENTRY32()
te.dwSize = ctypes.sizeof(THREADENTRY32)
tids = []
if k32.Thread32First(hSnapshot, ctypes.byref(te)):
    while True:
        if te.th32OwnerProcessID == pid:
            tids.append(te.th32ThreadID)
        if not k32.Thread32Next(hSnapshot, ctypes.byref(te)):
            break
k32.CloseHandle(hSnapshot)

print(f'TIDs for PID {pid}: {len(tids)}')

windows = []
def cb(hwnd, lparam):
    windows.append(hwnd)
    return True

WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
for tid in tids:
    u32.EnumThreadWindows(tid, WNDENUMPROC(cb), 0)

print(f'Thread windows found: {len(windows)}')
for h in windows:
    length = u32.GetWindowTextLengthW(h)
    t = ''
    if length > 0:
        b = ctypes.create_unicode_buffer(length + 1)
        u32.GetWindowTextW(h, b, length + 1)
        t = b.value
    c = ctypes.create_unicode_buffer(256)
    u32.GetClassNameW(h, c, 256)
    print(f'HWND: {hex(h)} Class: {c.value} Title: {t}')
