#!/usr/bin/env python3
"""Inspect Container instances and Items in PokeAlliance_dx.exe."""

import struct
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import otclient_rtti as rtti
import scan_creatures as sc

CONTAINER_VTABLE = 0x7ff718ebfc98
ITEM_VTABLE = 0x7ff718ebfcd0
PLAYER_VA = 0x1e64c6de4a0

def inspect_containers(h):
    conts = rtti.scan_instances(h, CONTAINER_VTABLE)
    print(f"Active Containers: {len(conts)}")
    for c in conts:
        buf = sc.read_mem(h, c, 0x100)
        if not buf:
            continue
        cid = struct.unpack_from('<i', buf, 0x20)[0]
        cap = struct.unpack_from('<i', buf, 0x24)[0]
        name_len = struct.unpack_from('<Q', buf, 0x48)[0]
        if name_len < 16:
            name = buf[0x38:0x38+name_len].decode('latin1', 'ignore')
        else:
            name_ptr = struct.unpack_from('<Q', buf, 0x38)[0]
            nbuf = sc.read_mem(h, name_ptr, name_len)
            name = nbuf.decode('latin1', 'ignore') if nbuf else ''
        
        # Read items vector in container (std::vector<ItemPtr>)
        # Let's inspect pointers around 0x60..0xA0
        print(f"  Container VA={hex(c)} id={cid} cap={cap} name='{name}'")
        
        # Let's check offsets 0x28, 0x30, 0x50, 0x58, 0x60, 0x68
        for off in range(0x18, 0x80, 8):
            val = struct.unpack_from('<Q', buf, off)[0]
            # check if it points to valid heap
            if 0x10000000000 <= val <= 0x20000000000:
                print(f"    +{hex(off)}: heap ptr {hex(val)}")

def inspect_items_near_player(h, px, py, pz):
    items = rtti.scan_instances(h, ITEM_VTABLE)
    print(f"Total Item instances: {len(items)}")
    near = []
    for it in items:
        buf = sc.read_mem(h, it + 0x20, 0x20)
        if not buf:
            continue
        x, y = struct.unpack_from('<ii', buf, 0)
        z = struct.unpack_from('<H', buf, 8)[0]
        if z == pz and abs(x - px) <= 4 and abs(y - py) <= 4:
            item_id = struct.unpack_from('<H', buf, 0x18)[0]
            near.append((it, x, y, z, item_id))
    print(f"Items near player ({px}, {py}, {pz}): {len(near)}")
    for it, x, y, z, item_id in near:
        print(f"  Item VA={hex(it)} id={item_id} pos=({x}, {y}, {z}) (d={max(abs(x-px), abs(y-py))})")

if __name__ == '__main__':
    pid = 25492
    h = sc.k32.OpenProcess(sc.PROCESS_QUERY_INFORMATION | sc.PROCESS_VM_READ, False, pid)
    if not h:
        print(f"Failed to open pid {pid}")
        sys.exit(1)
    
    # Read player pos
    pbuf = sc.read_mem(h, PLAYER_VA + 0x30, 10)
    px, py, pz = struct.unpack('<iih', pbuf)
    print(f"Player Nobutdopai at ({px}, {py}, {pz})")
    
    inspect_containers(h)
    inspect_items_near_player(h, px, py, pz)
