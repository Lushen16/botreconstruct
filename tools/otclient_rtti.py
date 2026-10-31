"""OTClient RTTI class/vtable/instance locator for PokeAlliance_dx.exe (read-only).

The client is an OTClient-derived build (RTTI names: Tile, MapView, Creature,
Item, UIMap, UIMinimap, ProtocolGame, ...). This tool turns those names into
live objects and lets a caller inspect them:

  1. Reads the game module image.
  2. Finds the MSVC type descriptor for a class name (".?AV<Name>@@").
  3. Resolves the RTTI Complete Object Locator and the vtable.
  4. Scans committed memory for objects whose first pointer equals the vtable
     (live instances) and reports them.

Nothing is written to the target.

Usage:
  python tools/otclient_rtti.py --pid 27964 --class MapView --class Tile
  python tools/otclient_rtti.py --pid 27964 --class MapView --dump 0x1f8a5736020
  python tools/otclient_rtti.py --selftest
"""

from __future__ import annotations

import argparse
import ctypes
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scan_creatures as sc
import pointer_scan_entities as pe

# Fallback vtables for one known build (2026-10-27, module base 0x7ff7c62b0000).
# These are ONLY used when RTTI resolution fails. Prefer the live resolution
# above (resolve_class), which regenerates them for whatever build is running.
# Note: `Map` and `Minimap` are non-polymorphic globals (g_map / g_minimap) and
# have no RTTI/vtable; they cannot be found here.
KNOWN_VTABLES = {
    "MapView": 0x7FF7C81F5210,
    "Tile": 0x7FF7C81EBF48,
    "Creature": 0x7FF7C81EC578,
    "Item": 0x7FF7C81EFCD0,
    "ProtocolGame": 0x7FF7C81FDD48,
    "ItemType": 0x7FF7C81F36A8,
    "CreatureType": 0x7FF7C81F2218,
}


def read_module_image(handle, base, size, chunk=0x400000):
    buf = bytearray(size)
    offset = 0
    while offset < size:
        length = min(chunk, size - offset)
        data = sc.read_mem(handle, base + offset, length)
        if data:
            buf[offset:offset + len(data)] = data
        offset += length
    return bytes(buf)


def find_all(data: bytes, needle: bytes):
    out = []
    start = 0
    while True:
        index = data.find(needle, start)
        if index < 0:
            return out
        out.append(index)
        start = index + 1


def find_type_descriptor(image: bytes, class_name: str):
    return [index - 0x10 for index in find_all(image, b".?AV" + class_name.encode() + b"@@")]


def find_locator(image: bytes, td_rva: int):
    cols = []
    for index in find_all(image, struct.pack("<I", td_rva)):
        column = index - 12
        if column >= 0 and struct.unpack_from("<I", image, column)[0] == 1:
            cols.append(column)
    return cols


def find_vtable(image: bytes, base: int, col_rva: int):
    index = image.find(struct.pack("<Q", base + col_rva))
    return base + index + 8 if index >= 0 else None


def scan_instances(handle, vtable_va: int):
    needle = struct.pack("<Q", vtable_va)
    hits = []
    for base, size in pe.iter_search_regions(handle):
        offset = 0
        while offset < size:
            length = min(0x100000, size - offset)
            data = sc.read_mem(handle, base + offset, length)
            if data:
                start = 0
                while True:
                    index = data.find(needle, start)
                    if index < 0:
                        break
                    va = base + offset + index
                    if va % 8 == 0:
                        hits.append(va)
                    start = index + 1
            offset += length
    return hits


def resolve_class(image: bytes, base: int, class_name: str):
    for td_rva in find_type_descriptor(image, class_name):
        for col_rva in find_locator(image, td_rva):
            vtable = find_vtable(image, base, col_rva)
            if vtable is not None:
                return {"type_descriptor_rva": hex(td_rva), "col_rva": hex(col_rva),
                        "vtable": vtable}
    return None


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="OTClient RTTI class/vtable/instance locator")
    parser.add_argument("--pid", type=int, default=None)
    parser.add_argument("--process-name", default=sc.IMAGE_NAME)
    parser.add_argument("--class", dest="classes", action="append", default=None)
    parser.add_argument("--dump", type=lambda t: int(t, 0), default=None)
    parser.add_argument("--dump-bytes", type=lambda t: int(t, 0), default=0x100)
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args(argv)

    if args.selftest:
        return run_selftest()

    pid = args.pid or sc.find_pid_by_name(args.process_name)
    if pid is None:
        print(json.dumps({"error": "process not found"}))
        return 2
    handle = sc.k32.OpenProcess(sc.PROCESS_QUERY_INFORMATION | sc.PROCESS_VM_READ, False, pid)
    if not handle:
        print(json.dumps({"error": "OpenProcess failed", "pid": pid}))
        return 3
    try:
        module = next(m for m in pe.enum_modules(pid)
                      if m["name"].lower() == args.process_name.lower())
        if args.dump is not None:
            data = sc.read_mem(handle, args.dump, args.dump_bytes)
            print(sc.hexdump(data or b"", args.dump))
            return 0
        report = {"pid": pid, "module_base": hex(module["base"]), "classes": {}}
        for name in (args.classes or []):
            image = read_module_image(handle, module["base"], module["size"])
            resolved = resolve_class(image, module["base"], name)
            entry = {"resolved": resolved}
            vtable = resolved["vtable"] if resolved else KNOWN_VTABLES.get(name)
            if vtable:
                hits = scan_instances(handle, vtable)
                entry["vtable"] = hex(vtable)
                entry["instances"] = len(hits)
                entry["sample"] = [hex(x) for x in hits[:args.limit]]
            report["classes"][name] = entry
        print(json.dumps(report, indent=2))
    finally:
        sc.k32.CloseHandle(handle)
    return 0


def run_selftest() -> int:
    BASE = 0x140000000
    image = bytearray(0x2000)
    name = b".?AVWidget@@\x00"
    td_off = 0x100
    image[td_off:td_off + len(name)] = name
    td_rva = td_off - 0x10
    col_off = 0x500
    struct.pack_into("<I", image, col_off, 1)
    struct.pack_into("<I", image, col_off + 12, td_rva)
    vt_off = 0x700
    struct.pack_into("<Q", image, vt_off, BASE + col_off)
    assert find_type_descriptor(bytes(image), "Widget") == [td_rva]
    assert find_locator(bytes(image), td_rva) == [col_off]
    assert find_vtable(bytes(image), BASE, col_off) == BASE + vt_off + 8
    resolved = resolve_class(bytes(image), BASE, "Widget")
    assert resolved and resolved["vtable"] == BASE + vt_off + 8, resolved
    print(json.dumps({"selftest": "ok", "vtable": hex(resolved["vtable"])}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
