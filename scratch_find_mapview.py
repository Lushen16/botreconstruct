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
    res = rtti.resolve_class(image, module["base"], "MapView")
    if res:
        vas = rtti.scan_instances(handle, res["vtable"])
        print(f"Class MapView: vtable={hex(res['vtable'])}, instances={len(vas)}")
        for va in vas:
            buf = sc.read_mem(handle, va, 0x200)
            import struct
            # Dump first 256 bytes in 32-bit/64-bit chunks
            print(f"MapView at {hex(va)}:")
            for offset in range(0, 0x100, 16):
                words = struct.unpack_from("<4I", buf, offset)
                print(f"  +0x{offset:02x}: {words[0]:10} {words[1]:10} {words[2]:10} {words[3]:10}  | {hex(words[0])} {hex(words[1])}")
finally:
    sc.k32.CloseHandle(handle)
