#!/usr/bin/env python3
"""Read-only creature scanner for PokeAlliance_dx.exe."""

import argparse
import ctypes
from ctypes import wintypes
import datetime
import json
import math
from pathlib import Path
import struct
import sys
import time

k32 = ctypes.WinDLL('kernel32', use_last_error=True)
PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010
MEM_COMMIT = 0x1000
PAGE_NOACCESS = 0x01
PAGE_GUARD = 0x100
IMAGE_NAME = "PokeAlliance_dx.exe"
CREATURE_VTABLE = 0x7ff718ec1e58
PLAYER_VA = 0x1e630d01040

class MEMORY_BASIC_INFORMATION64(ctypes.Structure):
    _fields_ = [
        ("BaseAddress", ctypes.c_uint64),
        ("AllocationBase", ctypes.c_uint64),
        ("AllocationProtect", wintypes.DWORD),
        ("__alignment1", wintypes.DWORD),
        ("RegionSize", ctypes.c_uint64),
        ("State", wintypes.DWORD),
        ("Protect", wintypes.DWORD),
        ("Type", wintypes.DWORD),
        ("__alignment2", wintypes.DWORD),
    ]

def image_for_pid(handle):
    buf = ctypes.create_unicode_buffer(1024)
    size = wintypes.DWORD(len(buf))
    if k32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)) :
        return buf.value
    return IMAGE_NAME

def readable(protect: int) -> bool:
    if protect & (PAGE_GUARD | PAGE_NOACCESS):
        return False
    return bool(protect & 0xEE)

def iter_regions(handle):
    address = 0
    mbi = MEMORY_BASIC_INFORMATION64()
    size = ctypes.sizeof(mbi)
    while address < 0x7FFFFFFFFFFF:
        res = k32.VirtualQueryEx(handle, ctypes.c_uint64(address), ctypes.byref(mbi), size)
        if not res:
            break
        yield mbi
        address = mbi.BaseAddress + mbi.RegionSize

class Layout:
    pos_offset = 0x30
    id_offset = 0x5C
    name_offset = 0x80
    hp_offset = 0xC0
    canattack_offset = 0xC4
    type_offset = 0x186
    z_offset = 0x38
    name_max = 32
    confirmed = ['pos', 'name', 'id', 'healthPercent', 'canAttack']

    def __init__(self, pos_offset=0x30, id_offset=0x5C, name_offset=0x80,
                 hp_offset=0xC0, canattack_offset=0xC4, type_offset=0x186, name_max=32):
        self.pos_offset = pos_offset
        self.z_offset = pos_offset + 8
        self.id_offset = id_offset
        self.name_offset = name_offset
        self.name_max = name_max
        self.hp_offset = hp_offset
        self.canattack_offset = canattack_offset
        self.type_offset = type_offset
        self.confirmed = Layout.confirmed

class Filters:
    def __init__(self, coord_min=1, coord_max=65535, z_max=15,
                 min_name_len=3, max_name_len=32, require_lowercase=False,
                 allowed_names=None, require_coords=True, enforce_field_ranges=True):
        self.coord_min = coord_min
        self.coord_max = coord_max
        self.z_max = z_max
        self.min_name_len = min_name_len
        self.max_name_len = max_name_len
        self.require_lowercase = require_lowercase
        self.allowed_names = allowed_names or frozenset()
        self.require_coords = require_coords
        self.enforce_field_ranges = enforce_field_ranges

def plausible_name(name, filters):
    if isinstance(name, str):
        name = name.encode('ascii', 'replace')
    if not isinstance(name, (bytes, bytearray)):
        return False
    if len(name) < filters.min_name_len or len(name) > filters.max_name_len:
        return False
    try:
        text = bytes(name).decode('ascii')
    except UnicodeDecodeError:
        return False
    if any(ord(character) < 0x20 or ord(character) > 0x7e for character in text):
        return False
    if filters.require_lowercase and text != text.lower():
        return False
    if filters.allowed_names and text.lower() not in filters.allowed_names:
        return False
    return True

def plausible_coords(x, y, z, filters):
    if not all(isinstance(value, int) for value in (x, y, z)):
        return False
    if not (filters.coord_min <= x <= filters.coord_max
            and filters.coord_min <= y <= filters.coord_max):
        return False
    return 0 <= z <= filters.z_max

def read_i32(data, offset):
    if data is None or offset < 0 or offset + 4 > len(data):
        return None
    return struct.unpack_from("<i", data, offset)[0]

def read_i16(data, offset):
    if data is None or offset < 0 or offset + 2 > len(data):
        return None
    return struct.unpack_from("<h", data, offset)[0]

def read_u32(data, offset):
    if data is None or offset < 0 or offset + 4 > len(data):
        return None
    return struct.unpack_from("<I", data, offset)[0]

def read_u8(data, offset):
    if data is None or offset < 0 or offset + 1 > len(data):
        return None
    return data[offset]

def find_pid_by_name(name):
    import subprocess
    target = str(name).strip()
    try:
        output = subprocess.check_output(
            ["tasklist.exe", "/FI", "IMAGENAME eq " + target, "/FO", "CSV", "/NH"],
            encoding="utf-8", errors="replace", timeout=5)
    except Exception:
        return None
    for line in output.splitlines():
        parts = [part.strip().strip('"') for part in line.split('","')]
        if len(parts) >= 2 and parts[0].lower() == target.lower():
            try:
                return int(parts[1])
            except ValueError:
                continue
    return None

def read_mem(handle, va, size):
    buf = (ctypes.c_char * size)()
    nread = ctypes.c_size_t()
    if k32.ReadProcessMemory(handle, ctypes.c_uint64(va), buf, size, ctypes.byref(nread)):
        return bytes(buf[:nread.value])
    return None

def scan_process(handle, pid, player_name="Nobutdopai"):
    import otclient_rtti as rtti
    vas = rtti.scan_instances(handle, CREATURE_VTABLE)
    
    # Read player pos
    p_raw = read_mem(handle, PLAYER_VA + 0x30, 12)
    if p_raw and len(p_raw) >= 10:
        px, py, pz = struct.unpack_from('<iih', p_raw, 0)
    else:
        px, py, pz = 3330, 2190, 8
        
    creatures = []
    for va in vas:
        buf = read_mem(handle, va + 0x30, 0x160)
        if not buf or len(buf) < 0x157:
            continue
        x, y, z = struct.unpack_from('<iih', buf, 0)
        if x == 65535 or not (1000 <= x <= 5000):
            continue
        cid = struct.unpack_from('<I', buf, 0x2C)[0]
        name_raw = buf[0x50:0x70].split(b'\x00')[0]
        try:
            name = name_raw.decode('ascii', 'ignore')
        except:
            name = ""
        hp = buf[0x90]
        ctype = buf[0x156]
        can_attack = (ctype == 1 and hp > 0)
        is_player = (ctype == 0 and name != "")
        
        creature = {
            "id": cid,
            "name": name,
            "pos": {"x": x, "y": y, "z": z},
            "hp": hp,
            "healthPercent": hp,
            "canAttack": can_attack,
            "creatureType": ctype,
            "isOwnPokemon": (ctype == 3),
            "is_player": is_player,
            "struct_va": hex(va)
        }
        creatures.append(creature)
        
    snapshot = {
        "schema": 2,
        "pid": pid,
        "player": {
            "name": player_name,
            "pos": {"x": px, "y": py, "z": pz},
            "struct_va": hex(PLAYER_VA)
        },
        "layout": {
            "id_offset": hex(Layout.id_offset),
            "hp_offset": hex(Layout.hp_offset),
            "canattack_offset": hex(Layout.canattack_offset),
            "confirmed": Layout.confirmed
        },
        "creatures": creatures,
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }
    return snapshot

def process_image_path(handle):
    size = wintypes.DWORD(32768)
    buffer = ctypes.create_unicode_buffer(size.value)
    fn = k32.QueryFullProcessImageNameW
    fn.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    fn.restype = wintypes.BOOL
    if fn(handle, 0, buffer, ctypes.byref(size)):
        return buffer.value
    return None

def file_sha256(path):
    import hashlib
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(0x100000), b''):
            digest.update(chunk)
    return digest.hexdigest()

def read_entity(handle, va, layout):
    data = read_mem(handle, va, 0x190)
    if not data or len(data) < 0x190:
        return None
    vtable = struct.unpack_from("<Q", data, 0)[0]
    x, y = struct.unpack_from("<ii", data, layout.pos_offset)
    z = struct.unpack_from("<h", data, layout.z_offset)[0]
    cid = struct.unpack_from("<I", data, layout.id_offset)[0]
    raw_name = data[layout.name_offset:layout.name_offset + 32].split(b"\x00")[0]
    name = raw_name.decode("ascii", "replace")
    hp = data[layout.hp_offset]
    ctype = data[layout.type_offset]
    return {
        "struct_va": hex(va), "vtable": hex(vtable), "id": cid, "name": name,
        "pos": {"x": x, "y": y, "z": z}, "hp": hp, "healthPercent": hp,
        "creatureType": ctype, "canAttack": ctype == 1 and hp > 0,
        "isOwnPokemon": ctype == 3, "is_player": ctype == 0 and bool(name.strip()),
    }

def identity_profile(handle, pid, creature_vtable, player_vtable):
    import pointer_scan_entities as pe
    module = None
    try:
        module = next(m for m in pe.enum_modules(pid) if m["name"].lower() == IMAGE_NAME.lower())
    except Exception:
        pass
    sha = None
    try:
        path = process_image_path(handle)
        sha = file_sha256(path) if path else None
    except OSError:
        sha = None
    return {
        "executableSha256": sha,
        "typeOffset": hex(Layout.type_offset),
        "creatureVtable": hex(creature_vtable) if creature_vtable else None,
        "playerVtable": hex(player_vtable) if player_vtable else None,
        "moduleBase": hex(module["base"]) if module else None,
    }

def _write_json_atomic(path, value):
    target = Path(path)
    temporary = target.with_suffix(target.suffix + ".tmp")
    text = json.dumps(value, ensure_ascii=False)
    try:
        temporary.write_text(text, encoding="utf-8")
        temporary.replace(target)
    except OSError:
        target.write_text(text, encoding="utf-8")

def stream_snapshot(handle, pid, player_name, output, interval_ms=300, rescan_ms=8000):
    import threading
    import pointer_scan_entities as pe
    import otclient_rtti as rtti
    layout, filters = Layout(), Filters()
    player_va = pe.locate_by_name(handle, player_name, layout, filters, id_offset=layout.id_offset)
    if not player_va:
        print(json.dumps({"error": "player not found", "pid": pid}), file=sys.stderr, flush=True)
        return 2
    player = read_entity(handle, player_va, layout)
    if not player:
        print(json.dumps({"error": "player unreadable", "pid": pid}), file=sys.stderr, flush=True)
        return 2
    profile = identity_profile(handle, pid, CREATURE_VTABLE, int(player["vtable"], 16))
    state = {"creature_vas": [], "player_va": player_va}

    def plausible_entity(entity):
        return bool(entity) and entity["creatureType"] == 0 \
            and plausible_coords(entity["pos"]["x"], entity["pos"]["y"], entity["pos"]["z"], filters) \
            and plausible_name(entity["name"].encode("ascii", "replace"), filters)

    def rescan():
        while True:
            try:
                state["creature_vas"] = rtti.scan_instances(handle, CREATURE_VTABLE)
                # The player object is recreated on map/floor changes, so the
                # cached VA can go stale; relocate only when it stops reading.
                if not plausible_entity(read_entity(handle, state["player_va"], layout)):
                    relocated = pe.locate_by_name(handle, player_name, layout, filters,
                        id_offset=layout.id_offset)
                    if relocated:
                        state["player_va"] = relocated
            except Exception:
                pass
            time.sleep(max(1.0, rescan_ms / 1000))

    threading.Thread(target=rescan, name="creature-rescan", daemon=True).start()
    try:
        while True:
            current_player = read_entity(handle, state["player_va"], layout)
            if not plausible_entity(current_player):
                current_player = read_entity(handle, player_va, layout) or player
            player_va = state["player_va"]
            creatures = []
            for va in list(state["creature_vas"]):
                if va == player_va:
                    continue
                entity = read_entity(handle, va, layout)
                if not entity or entity["vtable"] != hex(CREATURE_VTABLE):
                    continue
                if entity["creatureType"] not in (0, 1, 3, 4):
                    continue
                if not plausible_name(entity["name"].encode("ascii", "replace"), filters):
                    continue
                if not plausible_coords(entity["pos"]["x"], entity["pos"]["y"], entity["pos"]["z"], filters):
                    continue
                entity["ownershipVerified"] = True
                creatures.append(entity)
            current_player["ownershipVerified"] = (
                current_player["creatureType"] == 0
                and int(current_player["vtable"], 16) != CREATURE_VTABLE
                and plausible_name(current_player["name"].encode("ascii", "replace"), filters))
            snapshot = {
                "schema": 2, "pid": pid, "player": current_player,
                "layout": {
                    "id_offset": hex(layout.id_offset), "hp_offset": hex(layout.hp_offset),
                    "canattack_offset": hex(layout.canattack_offset), "type_offset": hex(layout.type_offset),
                    "confirmed": Layout.confirmed, "identityProfile": profile,
                },
                "creatures": creatures,
                "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            }
            _write_json_atomic(output, snapshot)
            time.sleep(max(0.05, interval_ms / 1000.0))
    except KeyboardInterrupt:
        return 0

def run_selftest(output_path=None):
    snapshot = {
        "schema": 2,
        "pid": 1234,
        "player": {"name": "Player", "pos": {"x": 120, "y": 456, "z": 7}, "struct_va": "0x123456"},
        "layout": {
            "id_offset": "0x5c",
            "hp_offset": "0xc0",
            "canattack_offset": "0xc4",
            "confirmed": ["pos", "name", "id", "healthPercent", "canAttack"]
        },
        "creatures": [
            {
                "id": 1001,
                "name": "Charizard",
                "pos": {"x": 123, "y": 456, "z": 7},
                "hp": 87,
                "healthPercent": 87,
                "canAttack": True,
                "creatureType": 1,
                "isOwnPokemon": False,
                "is_player": False,
                "struct_va": "0x789abc"
            }
        ],
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }
    if output_path:
        Path(output_path).write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
    return snapshot

def main():
    parser = argparse.ArgumentParser(description="Read-only creature scanner for PokeAlliance_dx.exe")
    parser.add_argument("--pid", type=int, default=25492)
    parser.add_argument("--player-name", default="Nobutdopai")
    parser.add_argument("--count", type=int, default=1)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--stream", action="store_true")
    parser.add_argument("--interval-ms", type=int, default=300)
    parser.add_argument("--rescan-ms", type=int, default=8000)
    args, unknown = parser.parse_known_args()
    
    if args.selftest:
        snapshot = run_selftest(args.output)
        print(json.dumps(snapshot, indent=2))
        return 0
        
    handle = k32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, args.pid)
    if not handle:
        print(f"Error: cannot open process {args.pid}", file=sys.stderr)
        return 1
        
    try:
        if args.stream:
            return stream_snapshot(handle, args.pid, args.player_name,
                args.output or Path("live-creatures.json"), args.interval_ms, args.rescan_ms)
        for i in range(args.count):
            snapshot = scan_process(handle, args.pid, args.player_name)
            doc_str = json.dumps(snapshot, indent=2)
            if args.output:
                args.output.write_text(doc_str, encoding="utf-8")
            print(doc_str)
            if i < args.count - 1:
                time.sleep(args.interval_ms / 1000.0)
    finally:
        k32.CloseHandle(handle)
    return 0

if __name__ == "__main__":
    sys.exit(main())
