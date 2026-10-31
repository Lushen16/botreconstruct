import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(r"C:\Users\yago\Documents\Clone\RECONSTRUÇAO OFIcial\tools")))
import scan_creatures as sc
import creature_identity as ci
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
    resolved = rtti.resolve_class(image, module["base"], "Creature")
    creature_vtable = resolved["vtable"] if resolved else None
    
    vas = rtti.scan_instances(handle, creature_vtable)
    print(f"Found {len(vas)} creature instances")
    
    for va in vas:
        name_raw = sc.read_mem(handle, va + 0x80, 32)
        if not name_raw:
            continue
        try:
            name = name_raw.split(b"\x00")[0].decode("ascii")
        except:
            continue
        if not name or len(name) < 2:
            continue
        
        pos_raw = sc.read_mem(handle, va + 0x30, 12)
        if not pos_raw:
            continue
        import struct
        x, y, z = struct.unpack_from("<iih", pos_raw, 0)
        
        type_raw = sc.read_mem(handle, va + 0x186, 1)
        ctype = type_raw[0] if type_raw else -1
        
        id_raw = sc.read_mem(handle, va + 0x5c, 4)
        cid = struct.unpack_from("<I", id_raw, 0)[0] if id_raw else 0
        
        hp_raw = sc.read_mem(handle, va + 0xc0, 1)
        hp = hp_raw[0] if hp_raw else 0
        
        if ctype == 3 or name in ("Oddish", "Togepi", "Charmander", "Nobutdopai"):
            print(f"Creature: name={name:12} id={cid:10} pos=({x},{y},{z}) type={ctype} hp={hp}% va={hex(va)}")
finally:
    sc.k32.CloseHandle(handle)
