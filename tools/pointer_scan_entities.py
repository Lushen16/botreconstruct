"""Read-only backward pointer scan for PokeAlliance_dx.exe entities.

Given the address of a live entity struct, this tool finds a static pointer
path (Cheat-Engine style) whose root lives inside a loaded module, so the entity
and its visible-creature array can be resolved with a handful of reads instead
of a full ~2 GB memory sweep.

Method:
  1. Locate the entity struct VA (--target, or --locate-name NAME).
  2. Backward BFS: for each address T find every aligned slot L whose 8-byte
     value P satisfies P + off = T with 0 <= off <= --window. The range search
     uses one high-byte needle per target block, so it stays fast.
  3. A slot inside a module image is a static root; otherwise it becomes the
     next address to chase. Repeat up to --max-depth levels.
  4. The contiguous entity-pointer array around the target is reported so the
     whole visible set can be enumerated in one pass.

Nothing is written to the target process.

Usage:
  python tools/pointer_scan_entities.py --pid 27964 --locate-name Nobutdopai
  python tools/pointer_scan_entities.py --pid 27964 --target 0x1f8ef652070
"""

from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
import json
import math
import struct
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scan_creatures as sc

SEARCHABLE_PROTECT = (0x02, 0x04, 0x08, 0x40, 0x80)
TH32CS_SNAPMODULE = 0x00000008


class MODULEENTRY32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD), ("th32ModuleID", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD), ("GlblcntUsage", wintypes.DWORD),
        ("ProccntUsage", wintypes.DWORD), ("modBaseAddr", ctypes.c_void_p),
        ("modBaseSize", wintypes.DWORD), ("hModule", wintypes.HMODULE),
        ("szModule", wintypes.WCHAR * 256), ("szExePath", wintypes.WCHAR * 260),
    ]


def enum_modules(pid: int) -> list:
    k = sc.k32
    k.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    k.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    k.Module32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(MODULEENTRY32W)]
    k.Module32FirstW.restype = wintypes.BOOL
    k.Module32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(MODULEENTRY32W)]
    k.Module32NextW.restype = wintypes.BOOL
    snapshot = k.CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, pid)
    if snapshot in (wintypes.HANDLE(-1).value, None):
        return []
    modules = []
    try:
        entry = MODULEENTRY32W()
        entry.dwSize = ctypes.sizeof(MODULEENTRY32W)
        ok = k.Module32FirstW(snapshot, ctypes.byref(entry))
        while ok:
            modules.append({"name": entry.szModule, "base": int(entry.modBaseAddr or 0),
                            "size": int(entry.modBaseSize)})
            ok = k.Module32NextW(snapshot, ctypes.byref(entry))
    finally:
        k.CloseHandle(snapshot)
    return modules


def module_for(modules, address: int):
    for module in modules:
        if module["base"] <= address < module["base"] + module["size"]:
            return module
    return None


def low_byte_count(window: int) -> int:
    return max(1, math.ceil(window.bit_length() / 8)) if window > 0 else 0


def point_range_search(targets, window: int, read, regions, chunk: int = 0x100000):
    """Return {target: [(slot_va, offset), ...]} for slots holding P in [target-window, target]."""
    count = low_byte_count(window)
    needles: dict = {}
    for target in targets:
        for anchor in {target, max(0, target - window)}:
            needles.setdefault(anchor.to_bytes(8, "little")[count:], set()).add(target)
    results = {target: set() for target in targets}

    for region_base, size in regions():
        offset = 0
        while offset < size:
            length = min(chunk, size - offset)
            data = read(region_base + offset, length)
            if data:
                for key, block_targets in needles.items():
                    start = 0
                    while True:
                        index = data.find(key, start)
                        if index < 0:
                            break
                        slot = region_base + offset + index - count
                        if index >= count and slot >= region_base and (slot & 7) == 0:
                            value = int.from_bytes(data[index - count:index - count + 8], "little")
                            for target in block_targets:
                                delta = target - value
                                if 0 <= delta <= window:
                                    results[target].add((slot, delta))
                        start = index + 1
            offset += length
    return {target: sorted(found) for target, found in results.items()}


def resolve_chain(module_base: int, base_offset: int, offsets: list, read) -> int | None:
    pointer = module_base + base_offset
    for offset in offsets:
        raw = read(pointer, 8)
        if not raw:
            return None
        pointer = struct.unpack("<Q", raw)[0] + offset
    return pointer


def build_chain(reach_map, target, modules):
    seq = []
    current = target
    seen = set()
    while True:
        entries = reach_map.get(current)
        if not entries or current in seen:
            break
        seen.add(current)
        static = [(slot, off) for slot, off in entries if module_for(modules, slot)]
        chosen = static[0] if static else entries[0]
        seq.append(chosen)
        if static:
            break
        current = chosen[0]
    if not seq:
        return None
    root_slot, _ = seq[-1]
    module = module_for(modules, root_slot)
    if module is None:
        return None
    return {"module": module["name"], "module_base": module["base"],
            "base_offset": root_slot - module["base"],
            "offsets": [off for _slot, off in reversed(seq)],
            "chain_length": len(seq),
            "slots": [hex(slot) for slot, _off in reversed(seq)]}


def ptr_value(read, va: int) -> int:
    raw = read(va, 8)
    return struct.unpack("<Q", raw)[0] if raw else 0


def plausible_creature(read, pointer: int, layout, filters) -> bool:
    if pointer <= 0:
        return False
    raw = read(pointer + layout.name_offset, layout.name_max)
    if not raw:
        return False
    return sc.plausible_name(raw.split(b"\x00", 1)[0], filters)


def detect_array(handle, slot: int, layout, filters):
    read = lambda va, n: sc.read_mem(handle, va, n)
    if not plausible_creature(read, ptr_value(read, slot), layout, filters):
        return None
    window = 0x20000
    region = None
    for mbi in sc.iter_regions(handle):
        base = int(mbi.BaseAddress or 0)
        end = base + int(mbi.RegionSize)
        if base <= slot < end and mbi.State == sc.MEM_COMMIT and sc.readable(mbi.Protect):
            start = max(base, slot - window)
            region = (start, min(end, slot + window))
            break
    if region is None:
        return None
    base, stop = region
    data = read(base, stop - base)
    if not data:
        return None
    stop = base + len(data)

    def slot_value(address):
        if base <= address < stop - 7:
            return struct.unpack_from("<Q", data, address - base)[0]
        return None

    left = slot
    while left - 8 >= base and plausible_creature(read, slot_value(left - 8), layout, filters):
        left -= 8
    right = slot
    while right + 8 < stop and plausible_creature(read, slot_value(right + 8), layout, filters):
        right += 8
    addresses = [slot_value(left + 8 * index) for index in range((right - left) // 8 + 1)]
    return {"base": hex(left), "count": len(addresses), "stride": 8,
            "slot_in_array": (slot - left) // 8,
            "struct_vas": [hex(a) for a in addresses]}


def locate_by_name(handle, name: str, layout, filters, id_offset=None, hp_offset=None):
    read = lambda va, n: sc.read_mem(handle, va, n)
    needle = name.encode("ascii") + b"\x00"
    for region_base, size in iter_search_regions(handle):
        offset = 0
        while offset < size:
            length = min(0x100000, size - offset)
            data = read(region_base + offset, length)
            if data:
                start = 0
                while True:
                    index = data.find(needle, start)
                    if index < 0:
                        break
                    base_index = index - layout.name_offset
                    struct_va = region_base + offset + base_index
                    x = sc.read_i32(data, base_index + layout.pos_offset)
                    y = sc.read_i32(data, base_index + layout.pos_offset + 4)
                    z = sc.read_i16(data, base_index + layout.z_offset)
                    if sc.plausible_coords(x, y, z, filters):
                        if id_offset is not None and not sc.read_u32(data, base_index + id_offset):
                            start = index + 1
                            continue
                        if hp_offset is not None:
                            hp = sc.read_u8(data, base_index + hp_offset)
                            if hp is None or not 1 <= hp <= 100:
                                start = index + 1
                                continue
                        return struct_va
                    start = index + 1
            offset += length
    return None


def iter_search_regions(handle):
    for mbi in sc.iter_regions(handle):
        if mbi.State != sc.MEM_COMMIT or not sc.readable(mbi.Protect):
            continue
        if (int(mbi.Protect) & 0xFF) in SEARCHABLE_PROTECT:
            yield int(mbi.BaseAddress or 0), int(mbi.RegionSize)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Backward pointer scan for PokeAlliance_dx.exe entities")
    parser.add_argument("--pid", type=int, default=None)
    parser.add_argument("--process-name", default=sc.IMAGE_NAME)
    parser.add_argument("--target", type=lambda t: int(t, 0), default=None)
    parser.add_argument("--locate-name", dest="locate_name", default=None)
    parser.add_argument("--window", type=lambda t: int(t, 0), default=0x1000)
    parser.add_argument("--id-offset", type=lambda t: int(t, 0), default=0x5C)
    parser.add_argument("--hp-offset", type=lambda t: int(t, 0), default=0xE8)
    parser.add_argument("--max-depth", type=int, default=6)
    parser.add_argument("--max-frontier", type=int, default=64)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args(argv)

    if args.selftest:
        return run_selftest()

    layout, filters = sc.Layout(), sc.Filters()
    pid = args.pid or sc.find_pid_by_name(args.process_name)
    if pid is None:
        print(json.dumps({"error": "process not found"}))
        return 2
    handle = sc.k32.OpenProcess(sc.PROCESS_QUERY_INFORMATION | sc.PROCESS_VM_READ, False, pid)
    if not handle:
        print(json.dumps({"error": "OpenProcess failed", "pid": pid,
                          "winerror": ctypes.get_last_error()}))
        return 3
    report = {"pid": pid, "window": hex(args.window), "max_depth": args.max_depth}
    try:
        modules = enum_modules(pid)
        read = lambda va, n: sc.read_mem(handle, va, n)
        regions = lambda: iter_search_regions(handle)

        target = args.target
        if target is None and args.locate_name:
            target = locate_by_name(handle, args.locate_name, layout, filters,
                                    args.id_offset, args.hp_offset)
        if target is None:
            report["error"] = "no target address (use --target or --locate-name)"
            print(json.dumps(report, indent=2))
            return 4
        report["target"] = hex(target)
        raw_name = read(target + layout.name_offset, layout.name_max)
        report["target_name"] = raw_name.split(b"\x00")[0].decode("ascii", "replace") if raw_name else None

        started = time.perf_counter()
        frontier = {target}
        reach_map: dict = {}
        visited = {target}
        roots = []
        for depth in range(args.max_depth):
            if not frontier:
                break
            current = set(sorted(frontier)[:args.max_frontier])
            results = point_range_search(current, args.window, read, regions)
            next_frontier = set()
            for address in current:
                for slot, offset in results.get(address, []):
                    reach_map.setdefault(address, []).append((slot, offset))
                    if module_for(modules, slot):
                        roots.append((address, slot, offset))
                    elif slot not in visited:
                        visited.add(slot)
                        next_frontier.add(slot)
            report.setdefault("depth_stats", []).append(
                {"depth": depth + 1, "frontier": len(current),
                 "slots_found": sum(len(v) for v in results.values()),
                 "static_roots": len(roots)})
            print(json.dumps(report["depth_stats"][-1]), file=sys.stderr)
            if roots:
                break
            frontier = next_frontier
        report["scan_ms"] = round((time.perf_counter() - started) * 1000, 1)

        chain = build_chain(reach_map, target, modules)
        report["chain"] = chain
        report["references"] = len(reach_map.get(target, []))
        if chain:
            resolved = resolve_chain(chain["module_base"], chain["base_offset"], chain["offsets"], read)
            report["resolved"] = hex(resolved) if resolved is not None else None
            report["resolution_ok"] = resolved == target
            t0 = time.perf_counter()
            for _ in range(1000):
                resolve_chain(chain["module_base"], chain["base_offset"], chain["offsets"], read)
            report["resolve_us_per_call"] = round((time.perf_counter() - t0) * 1e6 / 1000, 3)
            t0 = time.perf_counter()
            for _ in range(1000):
                pointer = resolve_chain(chain["module_base"], chain["base_offset"], chain["offsets"], read)
                if pointer:
                    read(pointer + layout.name_offset, layout.name_max)
                    read(pointer + layout.pos_offset, 10)
            report["resolve_and_extract_us_per_call"] = round(
                (time.perf_counter() - t0) * 1e6 / 1000, 3)

        arrays = []
        seen_bases = set()
        for slot, offset in reach_map.get(target, []):
            if offset != 0:
                continue
            found = detect_array(handle, slot, layout, filters)
            if found and found["base"] not in seen_bases:
                seen_bases.add(found["base"])
                arrays.append(found)

        report["pointer_sites"] = arrays
        report["exact_pointer_sites"] = sum(1 for _slot, offset in reach_map.get(target, []) if offset == 0)
        report["contiguous_arrays"] = [item for item in arrays if item["count"] >= 2]
        if arrays:
            base = int(arrays[0]["base"], 16)
            count = arrays[0]["count"]
            t0 = time.perf_counter()
            values = read(base, count * 8) or b""
            entities = []
            for index in range(count):
                pointer = struct.unpack_from("<Q", values, index * 8)[0]
                name = read(pointer + layout.name_offset, layout.name_max)
                pos = read(pointer + layout.pos_offset, 10)
                if name and pos:
                    entities.append({"name": name.split(b"\x00")[0].decode("ascii", "replace"),
                                     "pos": list(struct.unpack("<iih", pos))})
            report["enumeration_ms"] = round((time.perf_counter() - t0) * 1000, 3)
            report["enumerated_entities"] = entities
    finally:
        sc.k32.CloseHandle(handle)

    text = json.dumps(report, indent=2, ensure_ascii=False)
    if args.output:
        args.output.write_text(text, encoding="utf-8")
    print(json.dumps({"pid": pid, "target": report.get("target"),
                      "target_name": report.get("target_name"),
                      "chain": bool(report.get("chain")),
                      "resolution_ok": report.get("resolution_ok"),
                      "pointer_sites": len(report.get("pointer_sites", [])),
                      "contiguous_arrays": len(report.get("contiguous_arrays", [])),
                      "scan_ms": report.get("scan_ms"),
                      "output": str(args.output) if args.output else None}))
    return 0


def run_selftest() -> int:
    MODULE_BASE, MODULE_SIZE = 0x140000000, 0x1000000
    VEC_OBJECT = 0x200000000
    ARRAY_BASE = 0x200001000
    creature = 0x200010000
    static_slot = MODULE_BASE + 0x5A000
    heap_base, heap_size = 0x200000000, 0x100000

    memory = bytearray(heap_size)
    def write(va, blob):
        memory[va - heap_base:va - heap_base + len(blob)] = blob
    write(static_slot, struct.pack("<Q", VEC_OBJECT))
    write(VEC_OBJECT, struct.pack("<Q", ARRAY_BASE) + struct.pack("<Q", ARRAY_BASE + 8))
    write(ARRAY_BASE, struct.pack("<Q", creature) + struct.pack("<Q", creature + 0x100))
    write(creature + 0x80, b"Charizard\x00")

    def read(va, n):
        if heap_base <= va and va + n <= heap_base + heap_size:
            return bytes(memory[va - heap_base:va - heap_base + n])
        if MODULE_BASE <= va and va + n <= MODULE_BASE + MODULE_SIZE:
            return bytes(n)
        return None

    regions = lambda: [(heap_base, heap_size), (MODULE_BASE, MODULE_SIZE)]
    modules = [{"name": "target.exe", "base": MODULE_BASE, "size": MODULE_SIZE}]

    # The module image must expose the static slot holding VEC_OBJECT.
    def read2(va, n):
        if MODULE_BASE <= va and va + n <= MODULE_BASE + MODULE_SIZE:
            offset = va - MODULE_BASE
            if offset <= static_slot - MODULE_BASE < offset + n:
                out = bytearray(n)
                start = static_slot - va
                out[start:start + 8] = struct.pack("<Q", VEC_OBJECT)
                return bytes(out)
            return bytes(n)
        return read(va, n)

    reach = point_range_search({creature}, 0x1000, read2, regions)
    assert (ARRAY_BASE, 0) in reach[creature], reach[creature]
    reach2 = point_range_search({ARRAY_BASE}, 0x1000, read2, regions)
    assert (VEC_OBJECT, 0) in reach2[ARRAY_BASE], reach2[ARRAY_BASE]
    reach3 = point_range_search({VEC_OBJECT}, 0x1000, read2, regions)
    assert (static_slot, 0) in reach3[VEC_OBJECT], reach3[VEC_OBJECT]

    reach_map = {creature: reach[creature], ARRAY_BASE: reach2[ARRAY_BASE],
                 VEC_OBJECT: reach3[VEC_OBJECT]}
    chain = build_chain(reach_map, creature, modules)
    assert chain is not None, chain
    resolved = resolve_chain(chain["module_base"], chain["base_offset"], chain["offsets"], read2)
    assert resolved == creature, (hex(resolved), hex(creature), chain)
    print(json.dumps({"selftest": "ok", "resolved": hex(resolved), "chain": chain}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
