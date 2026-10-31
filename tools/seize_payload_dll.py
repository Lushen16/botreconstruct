"""Watch a folder for the payload DLL being extracted, and seize it with a
delete-lock before the injector removes it.

The injector writes shiba_bots.dll (or *.tmp) to its dll folder, injects it,
then deletes it. This watcher polls the folder, and the moment a candidate
appears it opens the file with GENERIC_READ and WITHOUT FILE_SHARE_DELETE,
which makes the injector's DeleteFile fail, then copies the bytes.

Read/write only on the watched folder output copy; does not touch the target
process. Run it before triggering the injection.

Usage:
  python tools/seize_payload_dll.py --dir "C:\\...\\dll" --out dumps --pattern "shiba_bots"
"""
from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
import os
import sys
import time

GENERIC_READ = 0x80000000
FILE_SHARE_READ = 0x1
FILE_SHARE_WRITE = 0x2
OPEN_EXISTING = 3
FILE_ATTRIBUTE_NORMAL = 0x80

k32 = ctypes.WinDLL("kernel32", use_last_error=True)
k32.CreateFileW.restype = wintypes.HANDLE
k32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                            ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
k32.ReadFile.restype = wintypes.BOOL
k32.ReadFile.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD,
                         ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
k32.CloseHandle.argtypes = [wintypes.HANDLE]


def seize(path: str) -> bytes | None:
    """Open with no FILE_SHARE_DELETE so DeleteFile fails while we hold it."""
    h = k32.CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                        None, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, None)
    if h in (None, ctypes.c_void_p(-1).value, 0xFFFFFFFFFFFFFFFF):
        return None
    try:
        chunks = []
        total = 0
        while True:
            buf = ctypes.create_string_buffer(65536)
            read = wintypes.DWORD(0)
            ok = k32.ReadFile(h, buf, 65536, ctypes.byref(read), None)
            if not ok or read.value == 0:
                break
            chunks.append(buf.raw[: read.value])
            total += read.value
        return b"".join(chunks) if total else None
    finally:
        k32.CloseHandle(h)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--pattern", default="shiba_bots")
    parser.add_argument("--max-size", type=int, default=30 * 1024 * 1024)
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)
    start = time.time()
    seen = set()
    captured = 0
    while time.time() - start < args.timeout:
        try:
            names = os.listdir(args.dir)
        except OSError:
            names = []
        for name in names:
            if name in seen:
                continue
            low = name.lower()
            if args.pattern.lower() not in low and not low.endswith((".tmp", ".dll")):
                continue
            full = os.path.join(args.dir, name)
            if not os.path.isfile(full):
                continue
            try:
                size = os.path.getsize(full)
            except OSError:
                size = 0
            seen.add(name)
            if size > args.max_size:
                continue
            data = seize(full)
            if data and len(data) > 4096:
                out_path = os.path.join(args.out, "seized_" + name + ".bin")
                with open(out_path, "wb") as fh:
                    fh.write(data)
                print(f"SEIZED {full} ({len(data)} bytes) -> {out_path}", flush=True)
                captured += 1
            elif data:
                print(f"small file {name}: {len(data)} bytes (still growing?)", flush=True)
        time.sleep(0.002)
    print(f"done, captured {captured} files", flush=True)
    return 0 if captured else 2


if __name__ == "__main__":
    sys.exit(main())
