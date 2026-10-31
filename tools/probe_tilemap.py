"""Read-only live tile-engine probe for PokeAlliance_dx.exe (MapView -> Tile).

The client is an OTClient-derived build. The rendered tile grid is NOT owned by
the MapView widget (MapView only holds the camera/view state); it lives in the
`g_map` singleton (`extern Map g_map`, non-polymorphic -> no RTTI). Each `Tile`
object, however, is polymorphic (RTTI name `Tile`) and stores its own
`m_position` inline, so the tile grid can be reconstructed from the live `Tile`
instances alone.

This tool:
  1. Resolves the `Tile` / `Item` / `MapView` vtables through MSVC RTTI.
  2. Scans committed memory for live `Tile` instances.
  3. Reads each tile position and the ground item pointer (`m_things[0]`).
  4. Emits a JSON snapshot: tiles, positions, ground-item vtable/id candidates.

Nothing is written to the target process.

Layout note (this build, module base 0x7ff7c62b0000, verified 2026-10-27):
    Tile + 0x68  Position.x  int32
    Tile + 0x6c  Position.y  int32
    Tile + 0x70  Position.z  int16
    Tile + 0x50  std::vector<std::shared_ptr<Thing>> m_things  (begin,end,cap)

Usage:
  python tools/probe_tilemap.py --pid 8456 --limit 40
  python tools/probe_tilemap.py --pid 8456 --near 3320,2264,9 --dump-items
  python tools/probe_tilemap.py --selftest
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scan_creatures as sc
import pointer_scan_entities as pe
import otclient_rtti as rtti

# --------------------------------------------------------------------------- #
# Offsets for THIS build. Regenerate the vtables with otclient_rtti on a new
# build; the Tile member offsets are stable across the OTClient lineage.
# --------------------------------------------------------------------------- #
TILE_POS_OFF = 0x68          # int32 x, int32 y, int16 z
TILE_THINGS_OFF = 0x50       # std::vector<std::shared_ptr<Thing>> {begin,end,cap}
ITEM_POS_OFF = 0x20          # Thing::m_position
SHARED_PTR = 16              # sizeof(std::shared_ptr<void>) on MSVC x64


def sptr_target(handle, address: int):
    """Read a std::shared_ptr<void> at `address`; return the object pointer or None."""
    raw = sc.read_mem(handle, address, SHARED_PTR)
    if not raw or len(raw) < 8:
        return None
    ptr = struct.unpack_from("<Q", raw, 0)[0]
    return ptr or None


def vector_begin(handle, address: int):
    raw = sc.read_mem(handle, address, 24)
    if not raw or len(raw) < 24:
        return None, None
    begin, end, cap = struct.unpack_from("<QQQ", raw, 0)
    return begin, end


def read_position(handle, address: int, offset: int):
    raw = sc.read_mem(handle, address + offset, 12)
    if not raw or len(raw) < 12:
        return None
    x, y, z = struct.unpack_from("<iih", raw, 0)
    return {"x": x, "y": y, "z": z}


def read_tile(handle, va: int, tile_vtable: int, item_vtable, with_items: bool):
    head = sc.read_mem(handle, va, 0x80)
    if not head or len(head) < 0x78:
        return None
    candidate = {"tile_va": hex(va)}
    pos = read_position(handle, va, TILE_POS_OFF)
    candidate["pos"] = pos
    candidate["minimap_color_byte"] = head[0x73]
    candidate["flags"] = struct.unpack_from("<I", head, 0x74)[0] if len(head) >= 0x78 else None
    if pos:
        candidate["plausible"] = 0 <= pos["z"] <= 15 and 0 < pos["x"] < 65535 and 0 < pos["y"] < 65535
    if not with_items:
        return candidate
    begin, end = vector_begin(handle, va + TILE_THINGS_OFF)
    items = []
    if begin and end and end >= begin and (end - begin) <= SHARED_PTR * 64:
        for slot in range(begin, end, SHARED_PTR):
            obj = sptr_target(handle, slot)
            if not obj:
                continue
            vm = sc.read_mem(handle, obj, 8)
            vt = struct.unpack_from("<Q", vm, 0)[0] if vm else 0
            entry = {"thing_va": hex(obj), "vtable": hex(vt) if vt else None}
            if item_vtable is not None and vt == item_vtable:
                entry["kind"] = "item"
                entry["client_id_u16_2c"] = struct.unpack_from("<H", sc.read_mem(handle, obj + 0x2C, 2) or b"\x00\x00", 0)[0]
                entry["client_id_u16_30"] = struct.unpack_from("<H", sc.read_mem(handle, obj + 0x30, 2) or b"\x00\x00", 0)[0]
                entry["item_pos"] = read_position(handle, obj, ITEM_POS_OFF)
            items.append(entry)
    candidate["things"] = items
    return candidate


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Read-only live tile-engine probe (MapView -> Tile)")
    parser.add_argument("--pid", type=int, default=None)
    parser.add_argument("--process-name", default=sc.IMAGE_NAME)
    parser.add_argument("--limit", type=int, default=40)
    parser.add_argument("--near", default=None, help="x,y,z filter: keep tiles within 20 of this position")
    parser.add_argument("--dump-items", action="store_true")
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args(argv)

    if args.selftest:
        return run_selftest()

    pid = args.pid or sc.find_pid_by_name(args.process_name)
    if pid is None:
        print(json.dumps({"error": "process not found", "name": args.process_name}))
        return 2
    handle = sc.k32.OpenProcess(sc.PROCESS_QUERY_INFORMATION | sc.PROCESS_VM_READ, False, pid)
    if not handle:
        print(json.dumps({"error": "OpenProcess failed", "pid": pid}))
        return 3
    try:
        module = next(m for m in pe.enum_modules(pid)
                      if m["name"].lower() == args.process_name.lower())
        image = rtti.read_module_image(handle, module["base"], module["size"])
        resolved = {}
        for name in ("Tile", "Item", "MapView", "Creature"):
            resolved[name] = rtti.resolve_class(image, module["base"], name)
        tile_vtable = resolved["Tile"]["vtable"] if resolved["Tile"] else rtti.KNOWN_VTABLES.get("Tile")
        item_vtable = resolved["Item"]["vtable"] if resolved["Item"] else rtti.KNOWN_VTABLES.get("Item")
        mapview_vtable = resolved["MapView"]["vtable"] if resolved["MapView"] else rtti.KNOWN_VTABLES.get("MapView")

        tiles = rtti.scan_instances(handle, tile_vtable)
        near = None
        if args.near:
            px, py, pz = (int(v) for v in args.near.split(","))
            near = {"x": px, "y": py, "z": pz}

        parsed = []
        for va in tiles:
            entry = read_tile(handle, va, tile_vtable, item_vtable, args.dump_items)
            if entry is None:
                continue
            if near and entry.get("pos"):
                p = entry["pos"]
                if abs(p["x"] - near["x"]) > 20 or abs(p["y"] - near["y"]) > 20 or p["z"] != near["z"]:
                    continue
            parsed.append(entry)

        report = {
            "pid": pid,
            "module_base": hex(module["base"]),
            "vtables": {
                "Tile": hex(tile_vtable) if tile_vtable else None,
                "Item": hex(item_vtable) if item_vtable else None,
                "MapView": hex(mapview_vtable) if mapview_vtable else None,
            },
            "tile_instances": len(tiles),
            "tile_size": 0x130,
            "near": near,
            "tiles": parsed[: args.limit],
            "parsed_count": len(parsed),
        }
        text = json.dumps(report, indent=2)
        if args.output:
            args.output.write_text(text, encoding="utf-8")
            print(json.dumps({"pid": pid, "tile_instances": len(tiles),
                              "parsed_count": len(parsed), "output": str(args.output)}))
        else:
            print(text)
    finally:
        sc.k32.CloseHandle(handle)
    return 0


def run_selftest() -> int:
    # Pure offset arithmetic on a synthetic tile buffer (no process access).
    buf = bytearray(0x80)
    struct.pack_into("<iih", buf, TILE_POS_OFF, 3320, 2264, 9)
    buf[TILE_THINGS_OFF] = 0
    x, y, z = struct.unpack_from("<iih", buf, TILE_POS_OFF)
    assert (x, y, z) == (3320, 2264, 9), (x, y, z)
    print(json.dumps({"selftest": "ok", "pos": {"x": x, "y": y, "z": z}}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
