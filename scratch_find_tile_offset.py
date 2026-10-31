import sys
from pathlib import Path

sys.path.insert(0, str(Path(r"C:\Users\yago\Documents\Clone\RECONSTRUÇAO OFIcial\tools")))
import scan_creatures as sc
import otclient_rtti as rtti
import struct

pid = 25492
h = sc.k32.OpenProcess(sc.PROCESS_QUERY_INFORMATION | sc.PROCESS_VM_READ, False, pid)
if not h:
    sys.exit(1)

try:
    vas = rtti.scan_instances(h, 0x7ff718ebbf48)
    print(f"Total Tile instances: {len(vas)}")
    found = 0
    for va in vas:
        buf = sc.read_mem(h, va, 0x50)
        if not buf: continue
        for off in range(0, 0x40, 2):
            x, y, z = struct.unpack_from("<iih", buf, off)
            if x == 3294 and y == 2220 and z == 8:
                print(f"Found at {hex(va)} off=0x{off:02x}")
                found += 1
                break
            elif 3290 <= x <= 3300 and 2215 <= y <= 2225 and z in (7, 8, 9):
                if found == 0:
                    print(f"Candidate tile at {hex(va)} off=0x{off:02x}: ({x}, {y}, {z})")
                    found = 1
finally:
    sc.k32.CloseHandle(h)
