import sys
from pathlib import Path
import json

sys.path.insert(0, str(Path(r"C:\Users\yago\Documents\Clone\RECONSTRUÇAO OFIcial\tools")))
import scan_creatures as sc
import otclient_rtti as rtti
import struct

pid = 25492
h = sc.k32.OpenProcess(sc.PROCESS_QUERY_INFORMATION | sc.PROCESS_VM_READ, False, pid)
if not h:
    sys.exit(1)

try:
    # Creature vtable: 0x7ff718ebc578
    vas = rtti.scan_instances(h, 0x7ff718ebc578)
    creatures = []
    for va in vas:
        pos_raw = sc.read_mem(h, va + 0x30, 10)
        if not pos_raw: continue
        x, y, z = struct.unpack_from("<iih", pos_raw, 0)
        if not (1000 <= x <= 5000 and 1000 <= y <= 5000 and 0 <= z <= 15):
            continue
        cid = struct.unpack_from("<I", sc.read_mem(h, va + 0x5C, 4), 0)[0]
        name_raw = sc.read_mem(h, va + 0x80, 32)
        name = name_raw.split(b"\x00")[0].decode("ascii", "ignore")
        hp = sc.read_mem(h, va + 0xC0, 1)[0]
        ctype = sc.read_mem(h, va + 0x186, 1)[0]
        creatures.append({
            "va": hex(va),
            "id": cid,
            "name": name,
            "pos": {"x": x, "y": y, "z": z},
            "hp": hp,
            "creatureType": ctype
        })
    print(json.dumps(creatures, indent=2))
finally:
    sc.k32.CloseHandle(h)
