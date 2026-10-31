import sys
from pathlib import Path

sys.path.insert(0, str(Path(r"C:\Users\yago\Documents\Clone\RECONSTRUÇAO OFIcial\tools")))
import scan_creatures as sc
import pointer_scan_entities as pe
import otclient_rtti as rtti

pid = 25492
handle = sc.k32.OpenProcess(sc.PROCESS_QUERY_INFORMATION | sc.PROCESS_VM_READ, False, pid)
if not handle:
    print("OpenProcess failed")
    sys.exit(1)

try:
    module = next(m for m in pe.enum_modules(pid) if m["name"].lower() == sc.IMAGE_NAME.lower())
    image = rtti.read_module_image(handle, module["base"], module["size"])
    res = rtti.resolve_class(image, module["base"], "UIWidget")
    if res:
        vas = rtti.scan_instances(handle, res["vtable"])
        print(f"Total UIWidgets: {len(vas)}")
        import struct
        found = []
        for va in vas:
            # In OTClient UIWidget: m_id is std::string
            # Let's read first 128 bytes
            buf = sc.read_mem(handle, va, 128)
            if not buf:
                continue
            # Search for string 'gameMapPanel' or 'map' or 'pokebar'
            for offset in range(8, 96, 4):
                try:
                    s = buf[offset:offset+16].split(b"\x00")[0].decode("ascii")
                    if s in ("gameMapPanel", "map", "gameRootPanel", "gameBottomPanel", "gameLeftPanel"):
                        found.append((va, s, offset))
                        break
                except:
                    pass
        print("Found widgets:", found)
        for va, s, off in found:
            buf = sc.read_mem(handle, va, 256)
            print(f"Widget {s} at {hex(va)}")
finally:
    sc.k32.CloseHandle(handle)
