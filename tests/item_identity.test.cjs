'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('synthetic RPM Item identity and scanner fail closed without game inputs', t => {
  const python = (process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'])
    .find(command => spawnSync(command, ['-B', '-c', 'print(1)'], { encoding: 'utf8' }).status === 0);
  if (!python) { t.skip('Python unavailable'); return; }
  const source = String.raw`
import copy
import datetime
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, 'tools')
import item_identity as ident
import scan_items as scanner

BASE = 0x140000000
PLAYER, TILE, ITEM, OTHER, VECTOR = 0x200000, 0x201000, 0x202000, 0x203000, 0x204000
NOW = 1793404800000
STAMP = datetime.datetime.fromtimestamp(NOW / 1000, datetime.timezone.utc).isoformat()
PROFILE = {'pid': 42, 'processStartedAt': '123456789012345', 'moduleBase': hex(BASE),
           'executablePath': 'synthetic/PokeAlliance_dx.exe', 'schemaVersion': 1,
           'executableSha256': ident.EXECUTABLE_SHA256, 'layoutId': ident.LAYOUT_ID,
           'playerVtableRvas': list(ident.PLAYER_VTABLE_RVAS)}


class Memory:
    def __init__(self):
        self.data = {}
        self.calls = []
        self.session_value = {key: PROFILE[key] for key in
                              ('pid', 'processStartedAt', 'executablePath', 'moduleBase')}
        self.put(PLAYER, 0x190)
        self.pack(PLAYER, 0, '<Q', BASE + ident.PLAYER_VTABLE_RVAS[1])
        self.pack(PLAYER, 0x30, '<iih', 100, 100, 7)
        self.pack(PLAYER, 0x5C, '<I', 321)
        self.data[PLAYER][0x80:0x85] = b'Test\x00'
        self.put(TILE, 0x72)
        self.pack(TILE, 0, '<Q', BASE + ident.TILE_VTABLE_RVA)
        self.pack(TILE, 0x68, '<iih', 101, 100, 7)
        self.pack(TILE, 0x50, '<QQQ', VECTOR, VECTOR + 32, VECTOR + 32)
        self.put(ITEM, 0xD6)
        self.pack(ITEM, 0, '<Q', BASE + ident.ITEM_VTABLE_RVA)
        self.pack(ITEM, 0x20, '<iih', 101, 100, 7)
        self.pack(ITEM, 0xD4, '<H', 65432)
        self.put(OTHER, 8)
        self.pack(OTHER, 0, '<Q', BASE + 0x1234)
        self.put(VECTOR, 32)
        self.pack(VECTOR, 0, '<QQQQ', OTHER, 123, ITEM, 456)

    def put(self, location, size):
        self.data[location] = bytearray(size)

    def pack(self, location, offset, fmt, *values):
        struct.pack_into(fmt, self.data[location], offset, *values)

    def read(self, location, size):
        self.calls.append((location, size))
        for base, data in self.data.items():
            if base <= location and location + size <= base + len(data):
                return bytes(data[location - base:location - base + size])
        return None

    def session(self):
        return self.session_value.copy()


def guard_for(memory):
    return {'pid': 42, 'generatedAt': STAMP, 'profile': copy.deepcopy(PROFILE), 'maxDistance': 3,
            'player': ident.read_player(memory.read, PLAYER, PROFILE),
            'item': ident.read_tile_items(memory.read, TILE, PROFILE)[1][0]}


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.memory = Memory()
        self.guard = guard_for(self.memory)

    def validate(self, guard=None):
        with patch.object(ident, 'resolve_profile', return_value=copy.deepcopy(PROFILE)):
            return ident.validate_guard_with_memory(self.memory, guard or self.guard, NOW)

    def test_unsigned_id_and_all_things_stack(self):
        item = self.guard['item']
        self.assertEqual(item['id'], 65432)
        self.assertEqual(item['stack'], 1)
        self.assertEqual(item['tile_va'], hex(TILE))
        self.memory.calls.clear()
        self.assertTrue(self.validate()['verified'])
        self.assertEqual(self.memory.calls.count((VECTOR, 32)), 4)

    def test_short_reads_are_unknown(self):
        for failed in (PLAYER, TILE, ITEM, VECTOR, OTHER):
            with self.subTest(failed=failed):
                original = self.memory.read
                self.memory.read = lambda location, size: b'' if location == failed else original(location, size)
                with self.assertRaises(ident.IdentityUnknown):
                    self.validate()
                self.memory.read = original

    def test_invalid_vectors(self):
        for vector in ((0, 32, 32), (VECTOR + 32, VECTOR, VECTOR + 32),
                       (VECTOR, VECTOR + 17, VECTOR + 32), (VECTOR, VECTOR + 32, VECTOR + 16),
                       (VECTOR, VECTOR + 32, VECTOR + 16 * 4097)):
            with self.subTest(vector=vector):
                self.memory.pack(TILE, 0x50, '<QQQ', *vector)
                with self.assertRaises(ident.IdentityUnknown):
                    self.validate()

    def test_zero_id_is_unknown_not_death(self):
        self.memory.pack(ITEM, 0xD4, '<H', 0)
        with self.assertRaises(ident.IdentityUnknown):
            self.validate()

    def test_tile_position_must_match_item(self):
        self.memory.pack(ITEM, 0x20, '<iih', 102, 100, 7)
        with self.assertRaisesRegex(ident.IdentityUnknown, 'disagrees'):
            self.validate()

    def test_membership_and_stack_change(self):
        for fmt, values in (('<QQQ', (VECTOR, VECTOR + 16, VECTOR + 32)),):
            self.memory.pack(TILE, 0x50, fmt, *values)
            with self.assertRaises(ident.IdentityUnknown):
                self.validate()
        self.memory = Memory()
        self.memory.pack(VECTOR, 0, '<QQQQ', ITEM, 456, OTHER, 123)
        with self.assertRaisesRegex(ident.IdentityUnknown, 'membership'):
            self.validate()

    def test_vector_mutation_between_reads(self):
        original = self.memory.read
        vector_reads = 0
        def read(location, size):
            nonlocal vector_reads
            if location == VECTOR:
                vector_reads += 1
                if vector_reads == 2:
                    self.memory.pack(VECTOR, 0, '<Q', ITEM)
            return original(location, size)
        self.memory.read = read
        with self.assertRaisesRegex(ident.IdentityUnknown, 'vector changed'):
            self.validate()

    def test_item_mutation_between_membership_passes(self):
        original = self.memory.read
        item_reads = 0
        def read(location, size):
            nonlocal item_reads
            if location == ITEM and size == 0xD6:
                item_reads += 1
                if item_reads == 3:
                    self.memory.pack(ITEM, 0xD4, '<H', 321)
            return original(location, size)
        self.memory.read = read
        with self.assertRaisesRegex(ident.IdentityUnknown, 'membership'):
            self.validate()

    def test_player_identity_changes(self):
        for offset, fmt, values in ((0x30, '<iih', (99, 100, 7)), (0x5C, '<I', (322,)),
                                    (0, '<Q', (BASE + 0x1234,)), (0x186, '<B', (1,))):
            with self.subTest(offset=offset):
                self.memory = Memory()
                self.memory.pack(PLAYER, offset, fmt, *values)
                with self.assertRaises(ident.IdentityUnknown):
                    self.validate()
        self.memory = Memory()
        self.memory.data[PLAYER][0x80] = ord('B')
        with self.assertRaises(ident.IdentityUnknown):
            self.validate()

    def test_session_and_profile_binding(self):
        for key, wrong in (('pid', 43), ('processStartedAt', 'new-session'),
                           ('moduleBase', hex(BASE + 65536)), ('executableSha256', '0' * 64),
                           ('layoutId', 'guessed'), ('playerVtableRvas', [])):
            with self.subTest(key=key):
                changed = copy.deepcopy(self.guard)
                changed['profile'][key] = wrong
                with self.assertRaises(ident.IdentityUnknown):
                    self.validate(changed)
        self.memory.session_value['processStartedAt'] = 'reused-pid'
        with self.assertRaisesRegex(ident.IdentityUnknown, 'session'):
            self.validate()

    def test_expired_future_and_invalid_times(self):
        for stamp in ('invalid', None, '2026-10-31T00:00:00',
                      datetime.datetime.fromtimestamp((NOW - 501) / 1000, datetime.timezone.utc).isoformat(),
                      datetime.datetime.fromtimestamp((NOW + 1) / 1000, datetime.timezone.utc).isoformat()):
            with self.subTest(stamp=stamp):
                changed = copy.deepcopy(self.guard)
                changed['generatedAt'] = stamp
                with self.assertRaises(ident.IdentityUnknown):
                    self.validate(changed)

    def test_guard_rechecks_age_after_work(self):
        with patch.object(ident.time, 'monotonic', side_effect=[1, 2]):
            with self.assertRaisesRegex(ident.IdentityUnknown, 'expired'):
                self.validate()

    def test_guard_rejects_remote_or_other_floor(self):
        for coordinates in ((104, 100, 7), (101, 100, 8)):
            self.memory.pack(TILE, 0x68, '<iih', *coordinates)
            self.memory.pack(ITEM, 0x20, '<iih', *coordinates)
            changed = copy.deepcopy(self.guard)
            changed['item']['pos'] = dict(zip(('x', 'y', 'z'), coordinates))
            with self.assertRaisesRegex(ident.IdentityUnknown, 'maxDistance'):
                self.validate(changed)

    def test_configured_distance_and_invalid_limits(self):
        self.memory.pack(TILE, 0x68, '<iih', 102, 100, 7)
        self.memory.pack(ITEM, 0x20, '<iih', 102, 100, 7)
        changed = copy.deepcopy(self.guard)
        changed['item']['pos']['x'] = 102
        self.assertTrue(self.validate(changed)['verified'])
        for limit in (1, 0, 31, True, 3.0, None):
            with self.subTest(limit=limit):
                changed['maxDistance'] = limit
                with self.assertRaisesRegex(ident.IdentityUnknown, 'maxDistance'):
                    self.validate(changed)

    def test_empty_vector_is_only_empty_when_stable(self):
        self.memory.pack(TILE, 0x50, '<QQQ', 0, 0, 0)
        self.assertEqual(ident.read_tile_items(self.memory.read, TILE, PROFILE)[1], [])
        with self.assertRaisesRegex(ident.IdentityUnknown, 'membership'):
            self.validate()

    def test_public_guard_uses_process_memory(self):
        with patch.object(ident, 'ProcessMemory', return_value=self.memory) as factory:
            with patch.object(ident, 'resolve_profile', return_value=copy.deepcopy(PROFILE)):
                self.assertTrue(ident.validate_capture_guard(999, self.guard, NOW)['verified'])
            factory.assert_called_once_with(999)


class ScannerTests(unittest.TestCase):
    def setUp(self):
        self.memory = Memory()
        self.patcher = patch.object(ident, 'resolve_profile', return_value=copy.deepcopy(PROFILE))
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def create(self, regions=None):
        regions = regions or (lambda: [(PLAYER, 0x190), (TILE, 0x72)])
        return scanner.ItemScanner(self.memory, 'Test', regions)

    def test_snapshot_contract_and_cache(self):
        scan = self.create()
        snapshot = scan.snapshot()
        self.assertTrue(snapshot['complete'])
        self.assertFalse(snapshot['truncated'])
        self.assertEqual(snapshot['readErrors'], [])
        self.assertEqual(snapshot['schemaVersion'], 1)
        self.assertEqual(snapshot['items'][0]['id'], 65432)
        self.assertTrue(snapshot['player']['ownershipVerified'])
        self.assertEqual(snapshot['itemIdentityProfile'], PROFILE)
        self.memory.calls.clear()
        self.assertTrue(scan.snapshot()['complete'])
        self.assertEqual(self.memory.calls.count((PLAYER, 0x190)), 2)

    def test_discovery_is_bounded_and_partial_is_explicit(self):
        scan = self.create()
        scan.discover(byte_budget=1, seconds_budget=1)
        self.assertFalse(scan.discovered)
        self.assertIsNotNone(scan.pending)
        scan.discover(byte_budget=10000, seconds_budget=1)
        self.assertTrue(scan.discovered)

    def test_new_tile_is_not_claimed_covered_by_cached_discovery(self):
        regions = [(PLAYER, 0x190), (TILE, 0x72)]
        scan = self.create(lambda: regions)
        first = scan.snapshot()
        self.assertTrue(first['complete'])
        self.assertFalse(first['inventoryComplete'])
        self.assertFalse(first['discovery']['currentInventoryComplete'])
        tile_two, item_two, vector_two = 0x205000, 0x206000, 0x207000
        self.memory.data[tile_two] = bytearray(self.memory.data[TILE])
        self.memory.pack(tile_two, 0x68, '<iih', 102, 100, 7)
        self.memory.pack(tile_two, 0x50, '<QQQ', vector_two, vector_two + 16, vector_two + 16)
        self.memory.data[item_two] = bytearray(self.memory.data[ITEM])
        self.memory.pack(item_two, 0x20, '<iih', 102, 100, 7)
        self.memory.pack(item_two, 0xD4, '<H', 777)
        self.memory.put(vector_two, 16)
        self.memory.pack(vector_two, 0, '<QQ', item_two, 123)
        regions.append((tile_two, 0x72))
        cached = scan.snapshot()
        self.assertEqual(len(cached['items']), 1)
        self.assertFalse(cached['inventoryComplete'])
        self.assertEqual(cached['discovery']['generation'], first['discovery']['generation'])
        self.assertGreaterEqual(cached['discovery']['ageMs'], 0)
        scan.next_scan = 0
        refreshed = scan.snapshot()
        self.assertEqual(len(refreshed['items']), 2)
        self.assertGreater(refreshed['discovery']['generation'], first['discovery']['generation'])

    def test_discovery_rpm_failure_is_not_empty_complete(self):
        snapshot = self.create(lambda: [(PLAYER, 0x190), (0x999000, 16)]).snapshot()
        self.assertFalse(snapshot['complete'])
        self.assertTrue(snapshot['truncated'])
        self.assertTrue(snapshot['readErrors'])

    def test_item_read_error_is_unknown(self):
        scan = self.create()
        scan.snapshot()
        del self.memory.data[ITEM]
        snapshot = scan.snapshot()
        self.assertFalse(snapshot['complete'])
        self.assertTrue(snapshot['readErrors'])

    def test_missing_player_is_unknown(self):
        scan = self.create()
        scan.snapshot()
        del self.memory.data[PLAYER]
        snapshot = scan.snapshot()
        self.assertIsNone(snapshot['player'])
        self.assertFalse(snapshot['complete'])
        self.assertTrue(snapshot['readErrors'])

    def test_atomic_output_and_failure_contract(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'items.json'
            scanner.atomic_output(target, {'old': True})
            snapshot = self.create().snapshot()
            scanner.atomic_output(target, snapshot)
            self.assertEqual(json.loads(target.read_text(encoding='utf-8')), snapshot)
            self.assertEqual(list(Path(temporary).glob('*.tmp')), [])
            with patch.object(scanner.os, 'replace', side_effect=PermissionError('locked')):
                with self.assertRaises(PermissionError):
                    scanner.atomic_output(target, {'new': True})
            self.assertEqual(json.loads(target.read_text(encoding='utf-8')), snapshot)
            self.assertEqual(list(Path(temporary).glob('*.tmp')), [])
        failed = scanner.failure_snapshot(42, 'unknown')
        self.assertFalse(failed['complete'])
        self.assertTrue(failed['readErrors'])


class AnchorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        image = bytearray(0x2000000)
        image[:2] = b'MZ'
        image[ident.GETTER_RVA:ident.GETTER_RVA + len(ident.GETTER_BYTES)] = ident.GETTER_BYTES
        for rva in (ident.ITEM_VTABLE_RVA, ident.TILE_VTABLE_RVA, *ident.PLAYER_VTABLE_RVAS):
            for offset in range(0, 64, 8):
                struct.pack_into('<Q', image, rva + offset, BASE + 0x1000 + offset)
        for index, (rva, name) in enumerate(zip(ident.PLAYER_VTABLE_RVAS, ('Player', 'LocalPlayer'))):
            locator, descriptor = 0x10000 + index * 256, 0x11000 + index * 256
            struct.pack_into('<Q', image, rva - 8, BASE + locator)
            struct.pack_into('<IIIIII', image, locator, 1, 0, 0, descriptor, 0x12000, locator)
            encoded = ('.?AV' + name + '@@\x00').encode('ascii')
            image[descriptor + 16:descriptor + 16 + len(encoded)] = encoded
        cls.image = bytes(image)

    def setUp(self):
        self.runtime_base = BASE + 0x10000000
        self.memory = Memory()
        self.memory.data[self.runtime_base] = bytearray(self.image[:64])
        self.memory.data[self.runtime_base + ident.GETTER_RVA] = bytearray(ident.GETTER_BYTES)
        for rva in (ident.ITEM_VTABLE_RVA, ident.TILE_VTABLE_RVA, *ident.PLAYER_VTABLE_RVAS):
            self.memory.data[self.runtime_base + rva] = bytearray().join(
                struct.pack('<Q', self.runtime_base + 0x1000 + offset) for offset in range(0, 64, 8))

    def check(self):
        ident.runtime_anchors(self.memory.read, self.runtime_base, self.image, BASE, ident.PLAYER_VTABLE_RVAS)

    def test_aslr_rebased_runtime_anchors(self):
        self.check()

    def test_runtime_anchors_fail_closed(self):
        for location in (self.runtime_base, self.runtime_base + ident.GETTER_RVA,
                         self.runtime_base + ident.ITEM_VTABLE_RVA,
                         self.runtime_base + ident.TILE_VTABLE_RVA):
            with self.subTest(location=location):
                self.setUp()
                self.memory.data[location][0] ^= 1
                with self.assertRaises(ident.IdentityUnknown):
                    self.check()

    def test_disk_hash_mismatch_fails_before_offsets(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'wrong.exe'
            target.write_bytes(b'MZwrong')
            with self.assertRaisesRegex(ident.IdentityUnknown, 'SHA256'):
                ident.verified_image(target)

    def test_player_rtti_is_verified_not_a_fallback(self):
        self.assertEqual(ident.player_vtable_rvas(self.image, BASE), ident.PLAYER_VTABLE_RVAS)
        changed = bytearray(self.image)
        changed[0x11010] ^= 1
        with self.assertRaisesRegex(ident.IdentityUnknown, 'RTTI mismatch'):
            ident.player_vtable_rvas(bytes(changed), BASE)

    def test_resolve_profile_always_checks_real_session_and_anchors(self):
        self.memory.session_value['moduleBase'] = hex(self.runtime_base)
        with patch.object(ident, 'verified_image', return_value=(self.image, BASE)):
            with patch.object(ident, 'player_vtable_rvas', return_value=ident.PLAYER_VTABLE_RVAS):
                profile = ident.resolve_profile(self.memory)
                self.assertEqual(profile['moduleBase'], hex(self.runtime_base))
                self.memory.data[self.runtime_base + ident.GETTER_RVA][0] ^= 1
                with self.assertRaises(ident.IdentityUnknown):
                    ident.resolve_profile(self.memory)


unittest.main(argv=['synthetic-item-identity'], verbosity=1)
`;
  const result = spawnSync(python, ['-B', '-c', source], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /Ran (?:27|28) tests/u);
});
