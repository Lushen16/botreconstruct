"""Dump a loaded image and diff it against its on-disk PE.

Read-only: OpenProcess + VirtualQueryEx + ReadProcessMemory. No writes to the target.
Usage:
  python tools/dump_stomped_module.py --pid 32336 --base 0x7ff85c470000 \
      --disk C:/Windows/System32/msftedit.dll --out dumps
"""
from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
import struct
import sys

import pefile

PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010
MEM_COMMIT = 0x1000
PAGE_GUARD = 0x100
PAGE_NOACCESS = 0x01

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


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def disk_image(pe: pefile.PE) -> bytearray:
    size = pe.OPTIONAL_HEADER.SizeOfImage
    image = bytearray(size)
    headers = min(size, pe.OPTIONAL_HEADER.SizeOfHeaders)
    with open(pe.path, "rb") as handle:
        image[:headers] = handle.read(headers)
    for section in pe.sections:
        data = section.get_data()
        start = section.VirtualAddress
        end = min(size, start + len(data))
        if start < size:
            image[start:end] = data[: end - start]
    return image


def apply_relocations(pe: pefile.PE, image: bytearray, delta: int) -> int:
    count = 0
    for block in getattr(pe, "DIRECTORY_ENTRY_BASERELOC", []):
        for entry in block.entries:
            rva = entry.rva
            if rva < block.struct.VirtualAddress:
                rva += block.struct.VirtualAddress
            kind = entry.type if hasattr(entry, "type") else 0
            if kind == 10 and rva + 8 <= len(image):
                value = struct.unpack_from("<Q", image, rva)[0]
                struct.pack_into("<Q", image, rva, (value + delta) & 0xFFFFFFFFFFFFFFFF)
                count += 1
            elif kind == 3 and rva + 4 <= len(image):
                value = struct.unpack_from("<I", image, rva)[0]
                struct.pack_into("<I", image, rva, (value + delta) & 0xFFFFFFFF)
                count += 1
    return count


def read_memory(pid: int, base: int, size: int) -> tuple[bytearray, list[dict]]:
    handle = k32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
    if not handle:
        raise OSError(f"OpenProcess failed: {ctypes.get_last_error()}")
    memory = bytearray(size)
    unreadable = []
    try:
        page = 0x1000
        for offset in range(0, size, page):
            length = min(page, size - offset)
            chunk = ctypes.create_string_buffer(length)
            read = ctypes.c_size_t()
            ok = k32.ReadProcessMemory(handle, ctypes.c_void_p(base + offset), chunk, length, ctypes.byref(read))
            if ok and read.value == length:
                memory[offset:offset + length] = chunk.raw[:length]
            else:
                unreadable.append({"offset": offset, "length": length})
                memory[offset:offset + length] = b"\x00" * length
    finally:
        k32.CloseHandle(handle)
    return memory, unreadable


def section_for(pe: pefile.PE, rva: int) -> str:
    for section in pe.sections:
        name = section.Name.rstrip(b"\x00").decode("latin1")
        start = section.VirtualAddress
        end = start + max(section.Misc_VirtualSize, section.SizeOfRawData)
        if start <= rva < end:
            return name
    return "?"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--disk", required=True)
    parser.add_argument("--out", default="dumps")
    parser.add_argument("--min-range", type=int, default=2048)
    args = parser.parse_args()

    base = int(args.base, 16)
    pe = pefile.PE(args.disk)
    pe.path = args.disk
    size = pe.OPTIONAL_HEADER.SizeOfImage
    disk = disk_image(pe)
    delta = base - pe.OPTIONAL_HEADER.ImageBase
    relocations = apply_relocations(pe, disk, delta)
    memory, unreadable = read_memory(args.pid, base, size)

    changed = bytearray(size)
    for index in range(size):
        if memory[index] != disk[index]:
            changed[index] = 1
    ranges = []
    start = None
    for index in range(size):
        if changed[index] and start is None:
            start = index
        elif not changed[index] and start is not None:
            ranges.append((start, index))
            start = None
    if start is not None:
        ranges.append((start, size))

    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    label = f"pid{args.pid}_{os.path.basename(args.disk)}"
    memory_path = os.path.join(out_dir, label + ".memory.bin")
    with open(memory_path, "wb") as handle:
        handle.write(memory)

    interesting = []
    for index, (begin, end) in enumerate(ranges):
        if end - begin < 64:
            continue
        name = section_for(pe, begin)
        blob = bytes(memory[begin:end])
        text = "".join(chr(byte) if 32 <= byte < 127 else "." for byte in blob)
        strings = []
        current = ""
        for char in text:
            if char != ".":
                current += char
            else:
                if len(current) >= 8:
                    strings.append(current)
                current = ""
        if len(current) >= 8:
            strings.append(current)
        item = {
            "rva": begin,
            "length": end - begin,
            "section": name,
            "sha256": sha256(blob),
            "strings": strings[:20],
        }
        interesting.append(item)
        if end - begin >= args.min_range:
            part = os.path.join(out_dir, f"{label}.{begin:08x}.bin")
            with open(part, "wb") as handle:
                handle.write(blob)
            item["dump"] = os.path.abspath(part)

    report = {
        "pid": args.pid,
        "base": hex(base),
        "disk": os.path.abspath(args.disk),
        "disk_sha256": sha256(open(args.disk, "rb").read()),
        "memory_dump": os.path.abspath(memory_path),
        "memory_sha256": sha256(memory),
        "size_of_image": size,
        "delta": hex(delta),
        "relocations_applied": relocations,
        "unreadable_pages": len(unreadable),
        "changed_bytes": sum(end - begin for begin, end in ranges),
        "ranges": interesting,
        "limitations": [
            "Disk image is rebased with PE relocations; IAT and loader writes remain as differences.",
            "Ranges are exact byte differences, not semantic code regions.",
            "Read-only dump; target was not modified or paused.",
        ],
    }
    report_path = os.path.join(out_dir, label + ".json")
    with open(report_path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    print(json.dumps({k: report[k] for k in ("pid", "base", "size_of_image", "delta", "relocations_applied",
                                             "unreadable_pages", "changed_bytes")}, indent=2))
    print(f"ranges >=64 bytes: {len(interesting)}; dumps >= {args.min_range}: "
          f"{sum(1 for item in interesting if 'dump' in item)}")
    for item in interesting[:12]:
        print(f"  {item['rva']:#08x} len={item['length']} section={item['section']} "
              f"sha={item['sha256'][:16]} strings={item['strings'][:3]}")
    print("report:", report_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
