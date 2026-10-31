import datetime
import json
from pathlib import Path
import re
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import creature_identity as identity


def recorded_dump(name):
    raw = (ROOT / "captures" / name).read_bytes()
    text = raw.decode("utf-16" if raw.startswith(b"\xff\xfe") else "utf-8-sig")
    chunks = []
    for line in text.splitlines():
        match = re.match(r"0x[0-9a-f]+\s+((?:[0-9a-f]{2} ){15}[0-9a-f]{2})", line, re.I)
        if match:
            chunks.append(bytes.fromhex(match.group(1)))
    return b"".join(chunks)


class IdentityChecks(unittest.TestCase):
    def setUp(self):
        evidence = json.loads((ROOT / "captures/ownership-types-before-28460.json").read_text(encoding="utf-8"))
        base = int(evidence["module"]["base"], 16)
        self.profile = {"creatureVtable": base + identity.CREATURE_VTABLE_RVA,
                        "playerVtable": base + identity.PLAYER_VTABLE_RVA}
        self.wild = bytearray(recorded_dump("wild-rattata-28460.txt"))
        self.own = bytearray(recorded_dump("own-charmander-28460.txt"))
        self.player = bytearray(self.wild)
        struct.pack_into("<Q", self.player, 0x10, self.profile["playerVtable"])
        self.player[identity.TYPE_OFFSET] = 0
        self.player[0x80:0x90] = b"Ash" + b"\x00" * 13
        struct.pack_into("<QQ", self.player, 0x90, 3, 15)
        struct.pack_into("<I", self.player, 0x5C, 0x10000001)
        self.player[0xC0] = 100
        self.memory = {0x1000: self.player, 0x2000: self.own, 0x3000: self.wild}
        self.read = lambda address, size: bytes(self.memory.get(address, b"")[:size])
        self.clock = 10000
        self.guard = {"pid": 42, "playerName": "Ash",
                      "generatedAt": datetime.datetime.fromtimestamp(10, datetime.timezone.utc).isoformat()}
        for role, address in (("player", 0x1000), ("own", 0x2000), ("target", 0x3000)):
            self.guard[role] = identity.read_identity(self.read, address, self.profile)

    def validate(self):
        return identity.validate_guard(self.guard, 42, self.read, self.profile, lambda: self.clock)

    def test_recorded_own_and_wild_have_distinct_identity_not_names(self):
        self.assertEqual(self.guard["own"]["creatureType"], 3)
        self.assertTrue(self.guard["own"]["isOwnPokemon"])
        self.assertFalse(self.guard["own"]["canAttack"])
        self.assertEqual(self.guard["target"]["creatureType"], 1)
        self.assertTrue(self.guard["target"]["canAttack"])
        self.validate()

    def test_same_species_does_not_change_wild_ownership(self):
        self.wild[0x80:0x90] = b"Charmander" + b"\x00" * 6
        struct.pack_into("<QQ", self.wild, 0x90, 10, 15)
        self.guard["target"] = identity.read_identity(self.read, 0x3000, self.profile)
        self.assertEqual(self.guard["target"]["name"], self.guard["own"]["name"])
        self.validate()

    def test_own_type_before_dispatch_is_rejected(self):
        self.wild[identity.TYPE_OFFSET] = 3
        with self.assertRaisesRegex(ValueError, "posse incerta"):
            self.validate()

    def test_old_refcount_offset_is_not_type(self):
        self.assertEqual(self.own[0x0C], self.wild[0x0C])
        self.assertNotEqual(self.own[identity.TYPE_OFFSET], self.wild[identity.TYPE_OFFSET])

    def test_expired_future_and_naive_timestamps_are_rejected(self):
        for clock in (10501, 9999):
            self.clock = clock
            with self.assertRaisesRegex(ValueError, "expirada"):
                self.validate()
        self.guard["generatedAt"] = "1970-01-01T00:00:10"
        with self.assertRaisesRegex(ValueError, "invalido"):
            self.validate()

    def test_recycled_object_and_changed_summon_are_rejected(self):
        self.own[0x10:0x18] = b"\x00" * 8
        with self.assertRaisesRegex(ValueError, "posse incerta"):
            self.validate()

    def test_identity_id_change_is_rejected(self):
        struct.pack_into("<I", self.own, 0x5C, 12345)
        with self.assertRaisesRegex(ValueError, "posse incerta"):
            self.validate()

    def test_overlap_with_own_pokemon_is_rejected(self):
        self.own[0x30:0x3A] = self.wild[0x30:0x3A]
        with self.assertRaisesRegex(ValueError, "tile do alvo"):
            self.validate()

    def test_target_movement_is_rejected(self):
        struct.pack_into("<i", self.wild, 0x30, 1)
        with self.assertRaisesRegex(identity.TargetMovedError, "mudou de tile"):
            self.validate()

    def test_changed_floor_is_not_recoverable_movement(self):
        struct.pack_into("<h", self.wild, 0x38, self.guard["player"]["pos"]["z"] + 1)
        with self.assertRaises(ValueError) as result:
            self.validate()
        self.assertNotIsInstance(result.exception, identity.TargetMovedError)

    def test_movement_does_not_override_ownership_rejection(self):
        struct.pack_into("<i", self.wild, 0x30, 1)
        self.wild[identity.TYPE_OFFSET] = 3
        with self.assertRaisesRegex(ValueError, "posse incerta") as result:
            self.validate()
        self.assertNotIsInstance(result.exception, identity.TargetMovedError)

    def test_movement_does_not_override_expiry(self):
        struct.pack_into("<i", self.wild, 0x30, 1)
        self.clock = 10501
        with self.assertRaisesRegex(ValueError, "expirada") as result:
            self.validate()
        self.assertNotIsInstance(result.exception, identity.TargetMovedError)

    def test_movement_does_not_override_own_tile_overlap(self):
        struct.pack_into("<i", self.wild, 0x30, 1)
        self.own[0x30:0x3A] = self.wild[0x30:0x3A]
        with self.assertRaisesRegex(ValueError, "tile do alvo") as result:
            self.validate()
        self.assertNotIsInstance(result.exception, identity.TargetMovedError)

    def test_destroyed_control_block_is_rejected(self):
        struct.pack_into("<i", self.own, 8, 0)
        with self.assertRaisesRegex(ValueError, "posse incerta"):
            self.validate()

    def test_own_pokemon_on_another_floor_is_rejected(self):
        struct.pack_into("<h", self.own, 0x38, 7)
        with self.assertRaisesRegex(ValueError, "fora do andar"):
            self.validate()

    def test_timestamp_is_checked_again_after_reading(self):
        clocks = iter((10000, 10501))
        with self.assertRaisesRegex(ValueError, "expirada"):
            identity.validate_guard(self.guard, 42, self.read, self.profile, lambda: next(clocks))


if __name__ == "__main__":
    unittest.main(verbosity=2)
