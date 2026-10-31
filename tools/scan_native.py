from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
from pathlib import Path


MARKERS = (b"pka-runtime-2-", b"PKA2/", b"nativeVerified", b"HealerTimeout", b"TargetMinimum")


class MemoryInformation(ctypes.Structure):
    _fields_ = [
        ("BaseAddress", ctypes.c_void_p), ("AllocationBase", ctypes.c_void_p),
        ("AllocationProtect", wintypes.DWORD), ("PartitionId", wintypes.WORD),
        ("RegionSize", ctypes.c_size_t), ("State", wintypes.DWORD),
        ("Protect", wintypes.DWORD), ("Type", wintypes.DWORD),
    ]


def observe(pid, expected_image, max_bytes):
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD,
                                                 wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel.QueryFullProcessImageNameW.restype = wintypes.BOOL
    kernel.VirtualQueryEx.argtypes = [wintypes.HANDLE, ctypes.c_void_p,
                                      ctypes.POINTER(MemoryInformation), ctypes.c_size_t]
    kernel.VirtualQueryEx.restype = ctypes.c_size_t
    kernel.ReadProcessMemory.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p,
                                         ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
    kernel.ReadProcessMemory.restype = wintypes.BOOL
    handle = kernel.OpenProcess(0x0400 | 0x0010, False, pid)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        image_buffer = ctypes.create_unicode_buffer(32768)
        image_size = wintypes.DWORD(len(image_buffer))
        if not kernel.QueryFullProcessImageNameW(handle, 0, image_buffer, ctypes.byref(image_size)):
            raise ctypes.WinError(ctypes.get_last_error())
        image = Path(image_buffer.value).resolve()
        if image != Path(expected_image).resolve():
            raise ValueError("O PID selecionado corresponde a outro executável")
        result = {
            "pid": pid, "image": str(image), "image_sha256": hashlib.sha256(image.read_bytes()).hexdigest(),
            "access": "PROCESS_QUERY_INFORMATION | PROCESS_VM_READ",
            "mutated_process": False, "bytes_read": 0, "regions_read": 0,
            "read_failures": 0, "coverage": "partial", "limit_reached": False,
            "hits": [], "limits": ["Marker matches are candidates, not decoded functions or module identities",
                                      "No process memory bodies, writable data or credentials are saved"],
        }
        address = 0
        overlap = max(map(len, MARKERS)) - 1
        while address < 0x7FFFFFFFFFFF:
            info = MemoryInformation()
            if not kernel.VirtualQueryEx(handle, address, ctypes.byref(info), ctypes.sizeof(info)):
                break
            base = int(info.BaseAddress or 0)
            next_address = base + info.RegionSize
            if next_address <= address:
                break
            address = next_address
            if info.State != 0x1000 or info.Protect & 0x100 or info.Protect & 0xFF not in (2, 4, 8, 0x20, 0x40, 0x80):
                continue
            if info.RegionSize > 128 * 1024 * 1024:
                continue
            result["regions_read"] += 1
            offset = 0
            previous = b""
            while offset < info.RegionSize:
                length = min(1024 * 1024, info.RegionSize - offset, max_bytes - result["bytes_read"])
                if length <= 0:
                    result["limit_reached"] = True
                    return result
                buffer = ctypes.create_string_buffer(length)
                received = ctypes.c_size_t()
                ok = kernel.ReadProcessMemory(handle, base + offset, buffer, length, ctypes.byref(received))
                if not ok:
                    result["read_failures"] += 1
                block = buffer.raw[:received.value]
                combined = previous + block
                for marker in MARKERS:
                    search_at = 0
                    while True:
                        found = combined.find(marker, search_at)
                        if found < 0:
                            break
                        result["hits"].append({
                            "marker": marker.decode(), "address": hex(base + offset - len(previous) + found),
                            "allocation_base": hex(int(info.AllocationBase or 0)),
                            "region_base": hex(base), "region_size": info.RegionSize,
                            "protection": hex(info.Protect), "memory_type": hex(info.Type),
                        })
                        search_at = found + len(marker)
                previous = combined[-overlap:]
                result["bytes_read"] += received.value
                offset += length
        return result
    finally:
        kernel.CloseHandle(handle)


def main():
    parser = argparse.ArgumentParser(description="Observar marcadores do runtime PKA sem alterar o cliente")
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-mib", type=int, default=512)
    args = parser.parse_args()
    if not 1 <= args.max_mib <= 2048:
        parser.error("max-mib deve estar entre 1 e 2048")
    if args.output.exists():
        parser.error("O arquivo de observação já existe; selecione outro nome")
    result = observe(args.pid, args.image, args.max_mib * 1024 * 1024)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
    print(json.dumps({key: result[key] for key in ("pid", "bytes_read", "regions_read", "read_failures", "limit_reached")}))
    print(json.dumps({"marker_hits": len(result["hits"]), "report": str(args.output)}))


if __name__ == "__main__":
    main()
