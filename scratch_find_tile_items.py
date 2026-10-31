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
    for va in vas:
        buf = sc.read_mem(h, va, 0x60)
        if not buf: continue
        # Find pos: x, y, z
        for off in range(8, 0x40, 4):
            x, y, z = struct.unpack_from("<iih", buf, off)
            if x == 3294 and y == 2220 and z == 8:
                print(f"Tile (3294, 2220, 8) at {hex(va)}, pos at +0x{off:02x}")
                # Dump 0x80 bytes
                full = sc.read_mem(h, va, 0x80)
                # Find std::vector of things: pointers between 0x1e000000000 and 0x1ffffffffff
                for voff in range(0x10, 0x70, 8):
                    b, e, cap = struct.unpack_from("<QQQ", full, voff)
                    if 0x1e000000000 <= b < e <= cap <= 0x1ffffffffff and (e - b) <= 2048:
                        cnt = (e - b) // 8
                        print(f"  Things vector at +0x{voff:02x}: count={cnt}")
                        tptrs = struct.unpack(f"<{cnt}Q", sc.read_mem(h, b, e - b))
                        for i, tp in enumerate(tptrs):
                            tbuf = sc.read_mem(h, tp, 0x40)
                            tvt = struct.unpack_from("<Q", tbuf, 0)[0]
                            # Read item id
                            # In OTClient Item: m_id is at +0x18 or +0x20
                            words = struct.unpack_from("<8H", tbuf, 8)
                            print(f"    Thing[{i}] va={hex(tp)} vt={hex(tvt)} words={words}")
                break
finally:
    sc.k32.CloseHandle(h)
