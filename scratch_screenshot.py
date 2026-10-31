import ctypes
from ctypes import wintypes
import sys
from pathlib import Path

pid = 25492
hwnd = 0x4e07b2

user = ctypes.windll.user32
gdi = ctypes.windll.gdi32

try:
    hDesk = user.OpenDesktopW('Default', 0, False, 0x1FF)
    if hDesk: user.SetThreadDesktop(hDesk)
except: pass

rect = wintypes.RECT()
user.GetClientRect(hwnd, ctypes.byref(rect))
w = rect.right - rect.left
h = rect.bottom - rect.top

hdc_win = user.GetDC(hwnd)
hdc_mem = gdi.CreateCompatibleDC(hdc_win)
hbm = gdi.CreateCompatibleBitmap(hdc_win, w, h)
gdi.SelectObject(hdc_mem, hbm)

user.PrintWindow(hwnd, hdc_mem, 2)

class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ('biSize', wintypes.DWORD),
        ('biWidth', wintypes.LONG),
        ('biHeight', wintypes.LONG),
        ('biPlanes', wintypes.WORD),
        ('biBitCount', wintypes.WORD),
        ('biCompression', wintypes.DWORD),
        ('biSizeImage', wintypes.DWORD),
        ('biXPelsPerMeter', wintypes.LONG),
        ('biYPelsPerMeter', wintypes.LONG),
        ('biClrUsed', wintypes.DWORD),
        ('biClrImportant', wintypes.DWORD),
    ]

bmi = BITMAPINFOHEADER()
bmi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
bmi.biWidth = w
bmi.biHeight = -h # top-down
bmi.biPlanes = 1
bmi.biBitCount = 24
bmi.biCompression = 0

buf_size = w * h * 3
buf = (ctypes.c_char * buf_size)()
gdi.GetDIBits(hdc_mem, hbm, 0, h, ctypes.byref(buf), ctypes.byref(bmi), 0)

with open("captures/screen_now.bmp", "wb") as f:
    f.write(b"BM")
    f.write((14 + 40 + buf_size).to_bytes(4, "little"))
    f.write((0).to_bytes(4, "little"))
    f.write((54).to_bytes(4, "little"))
    f.write(bytes(bmi))
    f.write(bytes(buf))

gdi.DeleteObject(hbm)
gdi.DeleteDC(hdc_mem)
user.ReleaseDC(hwnd, hdc_win)
print(f"Saved screen_now.bmp: {w}x{h}")
