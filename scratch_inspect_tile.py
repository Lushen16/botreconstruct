import sys
from pathlib import Path

sys.path.insert(0, str(Path(r"C:\Users\yago\Documents\Clone\RECONSTRUÇAO OFIcial\tools")))
import scan_creatures as sc
import pointer_scan_entities as pe
import otclient_rtti as rtti
import struct

pid = 25492
handle = sc.k32.OpenProcess(sc.PROCESS_QUERY_INFORMATION | sc.PROCESS_VM_READ, False, pid)
if not handle:
    print("OpenProcess failed")
    sys.exit(1)

try:
    module = next(m for m in pe.enum_modules(pid) if m["name"].lower() == sc.IMAGE_NAME.lower())
    image = rtti.read_module_image(handle, module["base"], module["size"])
    tile_class = rtti.resolve_class(image, module["base"], "Tile")
    vas = rtti.scan_instances(handle, tile_class["vtable"])
    for va in vas:
        buf = sc.read_mem(handle, va, 0x80)
        if not buf: continue
        # Pos is usually at +0x20 or +0x28 or +0x30
        for off in (0x18, 0x20, 0x28, 0x30, 0x38):
            x, y, z = struct.unpack_from("<iih", buf, off)
            if x == 3294 and y == 2220 and z == 8:
                print(f"Found Tile (3294, 2220, 8) at {hex(va)}, pos at +0x{off:02x}")
                # Dump things vector
                # In std::vector: begin, end, capacity are 3 pointers
                for voff in range(off + 12, off + 64, 8):
                    b, e = struct.unpack_from("<QQ", buf, voff)
                    if 0x1e000000000 <= b <= e <= 0x1ffffffffff and (e - b) <= 1024:
                        count = (e - b) // 8
                        print(f"  Things vector at +0x{voff:02x}: count={count}")
                        things_buf = sc.read_mem(handle, b, e - b)
                        for ti in range(count):
                            tptr = struct.unpack_from("<Q", things_buf, ti * 8)[0]
                            # Read thing ID (Item ID)
                            tb = sc.read_mem(handle, tptr, 64)
                            if tb:
                                tvt = struct.unpack_from("<Q", tb, 0)[0]
                                # Check item id at +0x18, +0x20, etc.
                                w = struct.unpack_from("<4H", tb, 16)
                                print(f"    Thing[{ti}] at {hex(tptr)}: vt={hex(tvt)} words={w}")
                break
finally:
    sc.k32.CloseHandle(handle)
