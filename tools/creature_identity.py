# creature_identity.py
import datetime
import hashlib
import json
import math
import struct
import time
from pathlib import Path

EXECUTABLE_SHA256 = "473df25c1edd23e7464ad3ba9b923a603051a8b4ae8004a95c06402f678294e6"
TYPE_OFFSET = 0x186
CREATURE_VTABLE = 0x7FF72C721E20
PLAYER_VTABLE = 0x7FF72C7233E8
# Same vtables expressed relative to the recorded module base
# (captures/ownership-types-before-28460.json: 0x7ff72c340000).
RECORDED_MODULE_BASE = 0x7FF72C340000
CREATURE_VTABLE_RVA = CREATURE_VTABLE - RECORDED_MODULE_BASE
PLAYER_VTABLE_RVA = PLAYER_VTABLE - RECORDED_MODULE_BASE

class TargetMovedError(ValueError):
    pass

def resolve_profile(handle, pid):
    import scan_creatures as sc
    import pointer_scan_entities as pe
    import otclient_rtti as rtti

    module = next(m for m in pe.enum_modules(pid) if m["name"].lower() == sc.IMAGE_NAME.lower())
    image = rtti.read_module_image(handle, module["base"], module["size"])
    resolved = {}
    for name in ("Creature", "Player"):
        resolved[name] = rtti.resolve_class(image, module["base"], name)
    c_vt = resolved["Creature"]["vtable"] if resolved["Creature"] else rtti.KNOWN_VTABLES.get("Creature")
    p_vt = resolved["Player"]["vtable"] if resolved["Player"] else rtti.KNOWN_VTABLES.get("Player")
    
    sha = hashlib.sha256(image).hexdigest()
    return {
        "executableSha256": sha,
        "moduleBase": module["base"],
        "typeOffset": TYPE_OFFSET,
        "creatureVtable": c_vt,
        "playerVtable": p_vt
    }

def read_identity(read, va, profile):
    head = read(va, 0x190)
    if not head or len(head) < 0x190:
        return None
    vtable = struct.unpack_from("<Q", head, 0)[0]
    pos_x, pos_y, pos_z = struct.unpack_from("<iih", head, 0x30)
    cid = struct.unpack_from("<I", head, 0x5C)[0]
    
    name_raw = head[0x80:0x80+32].split(b"\x00")[0]
    try:
        name = name_raw.decode("ascii")
    except:
        name = ""
    hp = head[0xC0]
    ctype = head[TYPE_OFFSET]
    
    return {
        "struct_va": hex(va),
        "vtable": hex(vtable),
        "id": cid,
        "name": name,
        "pos": {"x": pos_x, "y": pos_y, "z": pos_z},
        "hp": hp,
        "creatureType": ctype,
        "canAttack": (ctype == 1 and hp > 0),
        "isOwnPokemon": (ctype == 3),
        "is_player": (ctype == 0 and name != "")
    }

def classify_candidates(handle, candidates, profile):
    import scan_creatures as sc
    def read(va, size):
        return sc.read_mem(handle, va, size)
    res = []
    for c in candidates:
        va = int(c["struct_va"], 16) if isinstance(c["struct_va"], str) else c["struct_va"]
        ident = read_identity(read, va, profile)
        if ident:
            c.update(ident)
        res.append(c)
    return res

def _clock_ms(now):
    if now is None:
        return time.time() * 1000.0
    value = now() if callable(now) else now
    return float(value)

def _freshness(guard, now_ms):
    ts = guard.get("generatedAt")
    if not ts:
        raise ValueError("TargetGuard sem generatedAt: posse incerta")
    try:
        dt = datetime.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("Timestamp de identidade invalido.")
    if dt.tzinfo is None:
        raise ValueError("Timestamp de identidade invalido (sem fuso).")
    age = now_ms - dt.timestamp() * 1000.0
    if age < -0.5 or age > 500.0:
        raise ValueError(f"Identidade de combate expirada (limite 500ms). age={age:.3f}ms")

def _va(entry):
    value = entry.get("struct_va")
    return int(value, 16) if isinstance(value, str) else value

def validate_guard(guard, pid, read, profile, now=None):
    if not isinstance(guard, dict):
        raise ValueError("TargetGuard incompleto")
    _freshness(guard, _clock_ms(now))
    if guard.get("pid") is not None and int(guard["pid"]) != int(pid):
        raise ValueError("Identidade de outro PID: posse incerta")
    target = guard.get("target")
    own = guard.get("own")
    player = guard.get("player")
    if not target or not own or not player:
        raise ValueError("TargetGuard incompleto")

    p_va = _va(player)
    p_ident = read_identity(read, p_va, profile) if p_va else None
    if not p_ident or p_ident["creatureType"] != 0 or int(p_ident["vtable"], 16) == 0:
        raise ValueError("Identidade do jogador incerta")

    own_va = _va(own)
    own_ident = read_identity(read, own_va, profile) if own_va else None
    if not own_ident or int(own_ident["vtable"], 16) == 0:
        raise ValueError("Identidade mudou ou posse incerta: own")
    control = read(own_va, 24)
    if (not control or len(control) < 24
            or struct.unpack_from("<I", control, 8)[0] == 0
            or struct.unpack_from("<Q", control, 0x10)[0] == 0):
        raise ValueError("Identidade mudou ou posse incerta: own")
    if own_ident["creatureType"] != 3 or own_ident["id"] != own["id"]:
        raise ValueError("Identidade mudou ou posse incerta: own")
    if own_ident["pos"]["z"] != p_ident["pos"]["z"]:
        raise ValueError("Pokemon proprio fora do andar do jogador")

    tgt_va = _va(target)
    tgt_ident = read_identity(read, tgt_va, profile) if tgt_va else None
    if not tgt_ident or int(tgt_ident["vtable"], 16) == 0:
        raise ValueError("Identidade mudou ou posse incerta: target")
    if tgt_ident["creatureType"] != 1 or tgt_ident["id"] != target["id"]:
        raise ValueError("Identidade mudou ou posse incerta: target")
    if tgt_ident["pos"]["z"] != p_ident["pos"]["z"]:
        raise ValueError("Alvo em andar diferente do jogador")
    if tgt_ident["pos"]["x"] == own_ident["pos"]["x"] and tgt_ident["pos"]["y"] == own_ident["pos"]["y"]:
        raise ValueError("O tile do alvo coincide com o proprio Pokemon")
    if tgt_ident["hp"] == 0:
        raise ValueError("Identidade mudou ou posse incerta: target")
    if tgt_ident["pos"]["x"] != target["pos"]["x"] or tgt_ident["pos"]["y"] != target["pos"]["y"]:
        raise TargetMovedError("Alvo mudou de tile ou andar antes do envio.")

    checked_at = _clock_ms(now)
    _freshness(guard, checked_at)
    return {
        "targetId": tgt_ident["id"],
        "ownPokemonId": own_ident["id"],
        "creatureType": tgt_ident["creatureType"],
        "checkedAtMs": int(checked_at)
    }
