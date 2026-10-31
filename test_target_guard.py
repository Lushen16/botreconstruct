import sys
import json
import datetime
from pathlib import Path

sys.path.insert(0, str(Path(r"C:\Users\yago\Documents\Clone\RECONSTRUÇAO OFIcial\tools")))
import scan_creatures as sc
import creature_identity as ci

pid = 25492
memory = sc.k32.OpenProcess(sc.PROCESS_QUERY_INFORMATION | sc.PROCESS_VM_READ, False, pid)
if not memory:
    print("OpenProcess failed")
    sys.exit(1)

try:
    profile = ci.resolve_profile(memory, pid)
    print("Resolved profile:", profile)
    
    # Read own Oddish
    own_id = ci.read_identity(lambda addr, sz: sc.read_mem(memory, addr, sz), 0x1e6527bcec0, profile)
    print("Own Oddish in memory:", own_id)
    
    # Read wild Rattata
    wild_id = ci.read_identity(lambda addr, sz: sc.read_mem(memory, addr, sz), 0x1e681655ff0, profile)
    print("Wild Rattata in memory:", wild_id)
    
    # Test validate_guard with wild target
    guard = {
        "pid": pid,
        "playerName": "Nobutdopai",
        "generatedAt": (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(milliseconds=50)).isoformat(),
        "player": {
            "name": "Nobutdopai",
            "pos": {"x": 3319, "y": 2261, "z": 9},
            "struct_va": "0x1e630d01040",
            "id": 268446710,
            "creatureType": 0,
            "ownershipVerified": True
        },
        "own": own_id,
        "target": wild_id
    }
    
    res = ci.validate_guard(guard, pid, lambda addr, sz: sc.read_mem(memory, addr, sz), profile)
    print("Validation SUCCESS for wild target:", res)
finally:
    sc.k32.CloseHandle(memory)
