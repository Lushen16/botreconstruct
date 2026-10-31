"""Read-only memory scan: find PKA markers and intact payload PE copies.

Scans a target process by VirtualQueryEx + ReadProcessMemory, locates the
PKA markers, and reports candidate regions that look like an intact payload
PE (MZ/PE signature + PKA strings). Never writes to the target.
Usage: python tools/scan_payload_memory.py --pid 37152 [--dump DIR]
"""
from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
import re
import struct
import sys

PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010
MEM_COMMIT = 0x1000
MEM_MAPPED = 0x40000
MEM_PRIVATE = 0x20000
PAGE_NOACCESS = 0x01
PAGE_GUARD = 0x100
PAGE_EXECUTE_READWRITE = 0x40
PAGE_EXECUTE_READ = 0x20
PAGE_READWRITE = 0x04
PAGE_READONLY = 0x02

k32 = ctypes.WinDLL("kernel32", use_last_error=True)


class MBI(ctypes.Structure):
    _fields_ = [
        ("BaseAddress", ctypes.c_void_p),
        ("AllocationBase", ctypes.c_void_p),
        ("AllocationProtect", wintypes.DWORD),
        ("RegionSize", ctypes.c_size_t),
        ("State", wintypes.DWORD),
        ("Protect", wintypes.DWORD),
        ("Type", wintypes.DWORD),
    ]


k32.OpenProcess.restype = wintypes.HANDLE
k32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
k32.VirtualQueryEx.restype = ctypes.c_size_t
k32.VirtualQueryEx.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.POINTER(MBI), ctypes.c_size_t]
k32.ReadProcessMemory.restype = wintypes.BOOL
k32.ReadProcessMemory.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t,
                                  ctypes.POINTER(ctypes.c_size_t)]
k32.CloseHandle.argtypes = [wintypes.HANDLE]

CTypesBase = type(ctypes.c_void_p())


def _field(obj, name):
    value = getattr(obj, name)
    if value is None:
        return 0
    return int(value)


MARKERS = [b"PKA-INIT-NATIVE", b"PKA-INIT-SESSION", b"PKA-INIT", b"pka-runtime-2-",
           b"pka-security-", b"PKAengine", b"Debugger detected", b"tickBestTile",
           b"comboTick", b"bestTileMaxWaitMs"]


def readable(protect: int) -> bool:
    if protect & (PAGE_NOACCESS | PAGE_GUARD):
        return False
    return True


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def scan(pid: int, dump_dir: str | None) -> dict:
    handle = k32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
    if not handle:
        raise OSError(f"OpenProcess failed: {ctypes.get_last_error()}")
    try:
        regions = []
        addr = ctypes.c_void_p(0)
        while True:
            mbi = MBI()
            if k32.VirtualQueryEx(handle, addr, ctypes.byref(mbi), ctypes.sizeof(MBI)) == 0:
                break
            if mbi.State == MEM_COMMIT and readable(mbi.Protect) and mbi.RegionSize > 0:
                regions.append((int(ctypes.cast(mbi.BaseAddress, ctypes.c_void_p).value or 0),
                                int(mbi.RegionSize), int(mbi.Protect), int(mbi.Type)))
            addr = ctypes.c_void_p((mbi.BaseAddress or 0) + mbi.RegionSize)

        hits = []
        for base, size, prot, typ in regions:
            if size > 64 * 1024 * 1024:  # skip giant regions for marker scan; still scan head
                scan_len = 64 * 1024 * 1024
            else:
                scan_len = size
            chunk = ctypes.create_string_buffer(scan_len)
            read = ctypes.c_size_t()
            ok = k32.ReadProcessMemory(handle, base, chunk, scan_len, ctypes.byref(read))
            if not ok or read.value == 0:
                continue
            data = chunk.raw[: read.value]
            baddr = int(base)
            for marker in MARKERS:
                for m in re.finditer(re.escape(marker), data):
                    va = baddr + m.start()
                    hits.append({
                        "va": hex(va),
                        "marker": marker.decode("latin1"),
                        "region_base": hex(baddr),
                        "region_size": hex(size),
                        "protect": hex(prot),
                        "type": "MAPPED" if typ == MEM_MAPPED else "PRIVATE",
                        "offset_in_region": hex(m.start()),
                    })

        # Cluster hits into regions and look for MZ/PE in each hit region window
        by_region = {}
        for h in hits:
            by_region.setdefault(h["region_base"], []).append(h)
        candidates = []
        for rbase, rhits in by_region.items():
            region_size = next(r[1] for r in regions if r[0] == int(rbase, 16))
            window = min(region_size, 0x20000)  # read up to 128KB around
            buf = ctypes.create_string_buffer(window)
            read = ctypes.c_size_t()
            ok = k32.ReadProcessMemory(handle, ctypes.c_void_p(int(rbase, 16)), buf, window, ctypes.byref(read))
            if not ok:
                continue
            data = buf.raw[: read.value]
            mz_offsets = [m.start() for m in re.finditer(b"MZ", data)]
            pe_offsets = [m.start() for m in re.finditer(b"PE\x00\x00", data)]
            has_intact = False
            for mo in mz_offsets:
                # PE signature should be within first 0x1000 of a valid image
                for po in pe_offsets:
                    if 0 <= po - mo <= 0x1000:
                        has_intact = True
                        break
                if has_intact:
                    break
            if has_intact:
                candidates.append({
                    "region_base": rbase,
                    "markers": [h["marker"] for h in rhits][:8],
                    "mz_offsets": [hex(o) for o in mz_offsets[:6]],
                    "pe_offsets": [hex(o) for o in pe_offsets[:6]],
                })
            if dump_dir and (mz_offsets or len(rhits) > 1):
                path = os.path.join(dump_dir, f"region_{rbase}.bin")
                with open(path, "wb") as fh:
                    fh.write(data)
        return {"pid": pid, "regions_committed": len(regions), "hits": hits,
                "intact_pe_candidates": candidates}
    finally:
        k32.CloseHandle(handle)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--dump", default=None)
    args = parser.parse_args()
    if args.dump:
        os.makedirs(args.dump, exist_ok=True)
    report = scan(args.pid, args.dump)
    if args.dump:
        report_path = os.path.join(args.dump, "scan_report.json")
        with open(report_path, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2)
    print(json.dumps({"pid": args.pid, "regions_committed": report["regions_committed"],
                      "hits": len(report["hits"]), "intact_pe_candidates": len(report["intact_pe_candidates"])}))
    for c in report["intact_pe_candidates"]:
        print("  INTACT PE candidate:", c)
    for h in report["hits"][:20]:
        print("  hit", h["va"], h["marker"], h["type"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
