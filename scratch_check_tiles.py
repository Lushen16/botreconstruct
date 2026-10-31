import sys
import json
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(r"C:\Users\yago\Documents\Clone\RECONSTRUÇAO OFIcial\tools")))
import scan_creatures as sc
import pointer_scan_entities as pe
import otclient_rtti as rtti
import probe_tilemap as pt

pid = 25492
handle = sc.k32.OpenProcess(sc.PROCESS_QUERY_INFORMATION | sc.PROCESS_VM_READ, False, pid)
if not handle:
    print("Failed to open process")
    sys.exit(1)

try:
    module = next(m for m in pe.enum_modules(pid) if m["name"].lower() == sc.IMAGE_NAME.lower())
    image = rtti.read_module_image(handle, module["base"], module["size"])
    resolved = {}
    for name in ("Tile", "Item"):
        resolved[name] = rtti.resolve_class(image, module["base"], name)
    tile_vtable = resolved["Tile"]["vtable"] if resolved["Tile"] else rtti.KNOWN_VTABLES.get("Tile")
    item_vtable = resolved["Item"]["vtable"] if resolved["Item"] else rtti.KNOWN_VTABLES.get("Item")
    
    tile_vas = rtti.scan_instances(handle, tile_vtable)
    
    # Let's inspect tiles on z=9, z=8, z=7
    print("Scanning tiles with things...")
    results = []
    for va in tile_vas:
        pos = pt.read_position(handle, va, pt.TILE_POS_OFF)
        if not pos or pos["z"] not in (7, 8, 9):
            continue
        entry = pt.read_tile(handle, va, tile_vtable, item_vtable, with_items=True)
        if not entry:
            continue
        # Check flags or items
        things = entry.get("things", [])
        item_ids = [t.get("client_id_u16_30") for t in things if "client_id_u16_30" in t]
        flags = entry.get("flags")
        results.append({
            "pos": pos,
            "flags": flags,
            "thing_count": len(things),
            "items": item_ids
        })
        
    print(f"Total entries scanned: {len(results)}")
    # Find tiles where flags != 0 or items has unusual ids
    interesting = [r for r in results if r["flags"] not in (0, None) or len(r["items"]) > 2]
    print(f"Interesting tiles: {len(interesting)}")
    for r in interesting[:30]:
        print(f"z={r['pos']['z']} ({r['pos']['x']}, {r['pos']['y']}): flags={hex(r['flags']) if r['flags'] else 0}, items={r['items']}")
finally:
    sc.k32.CloseHandle(handle)
