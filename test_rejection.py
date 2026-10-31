import sys
import json
import time
import datetime
from pathlib import Path

sys.path.insert(0, str(Path(r"C:\Users\yago\Documents\Clone\RECONSTRUÇAO OFIcial\tools")))
import combat_actuator as ca

pid = 25492
now_iso = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(milliseconds=50)).isoformat()

request = {
    "kind": "attack",
    "allowBackground": True,
    "x": 400,
    "y": 300,
    "width": 800,
    "height": 640,
    "targetGuard": {
        "pid": pid,
        "playerName": "Nobutdopai",
        "generatedAt": now_iso,
        "player": {
            "name": "Nobutdopai",
            "pos": {"x": 3319, "y": 2261, "z": 9},
            "struct_va": "0x1e630d01040",
            "id": 268446710,
            "creatureType": 0,
            "ownershipVerified": True
        },
        "own": {
            "id": 1083138919,
            "name": "Oddish",
            "type": 3,
            "pos": {"x": 3317, "y": 2261, "z": 9},
            "struct_va": "0x1e6527bcec0",
            "creatureType": 3,
            "isOwnPokemon": True,
            "ownershipVerified": True
        },
        "target": {
            "id": 1083138919,
            "name": "Oddish",
            "type": 3,
            "pos": {"x": 3317, "y": 2261, "z": 9},
            "struct_va": "0x1e6527bcec0",
            "creatureType": 3,
            "isOwnPokemon": True,
            "ownershipVerified": True
        }
    }
}

print("Running negative test: attempting to attack own Oddish...")
sys.argv = ["combat_actuator.py", str(pid), "--request", json.dumps(request)]
try:
    outcome = ca.main()
    print("Outcome:", json.dumps(outcome))
except Exception as e:
    print("Caught exception:", e)
except SystemExit as e:
    print("SystemExit code:", e.code)
