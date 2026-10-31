"""Version-bound RPM Item identity; unknown reads raise, never mean absent."""

import ctypes
from ctypes import wintypes
import datetime
from functools import lru_cache
import hashlib
import math
import os
from pathlib import Path
import struct
import time

EXECUTABLE_SHA256 = '473df25c1edd23e7464ad3ba9b923a603051a8b4ae8004a95c06402f678294e6'
EXECUTABLE_SIZE = 37755952
IMAGE_NAME = 'PokeAlliance_dx.exe'
LAYOUT_ID = 'pka-item-d4-v1'
ITEM_VTABLE_RVA = 0x1F3FCD0
TILE_VTABLE_RVA = 0x1F3BF48
PLAYER_VTABLE_RVAS = (0x1F3EC58, 0x1F44628)
GETTER_RVA = 0x706010
GETTER_BYTES = bytes.fromhex('0fb781d4000000c3')
MAX_THINGS = 4096
MAX_AGE_MS = 500
_VERIFIED_IMAGE = None


class IdentityUnknown(ValueError):
    pass


def address(value):
    try:
        parsed = int(value, 0) if isinstance(value, str) else value
    except (TypeError, ValueError) as error:
        raise IdentityUnknown('Invalid address') from error
    if type(parsed) is not int or not 0x10000 <= parsed < 0x7FFFFFFFFFFF:
        raise IdentityUnknown('Invalid address')
    return parsed


def exact(read, location, size):
    try:
        data = read(address(location), size)
    except Exception as error:
        raise IdentityUnknown('RPM failed at ' + str(location)) from error
    if not isinstance(data, bytes) or len(data) != size:
        raise IdentityUnknown('RPM short/unavailable at ' + hex(location))
    return data


def position(data, offset=0):
    pos_x, pos_y, pos_z = struct.unpack_from('<iih', data, offset)
    if not (1 <= pos_x < 65535 and 1 <= pos_y < 65535 and 0 <= pos_z <= 15):
        raise IdentityUnknown('Invalid world position')
    return {'x': pos_x, 'y': pos_y, 'z': pos_z}


def verified_image(path):
    global _VERIFIED_IMAGE
    data = Path(path).read_bytes()
    if len(data) != EXECUTABLE_SIZE or hashlib.sha256(data).hexdigest() != EXECUTABLE_SHA256:
        raise IdentityUnknown('Unsupported executable SHA256/size')
    if _VERIFIED_IMAGE is not None:
        return _VERIFIED_IMAGE
    pe_offset = struct.unpack_from('<I', data, 0x3C)[0]
    if data[:2] != b'MZ' or data[pe_offset:pe_offset + 6] != b'PE\x00\x00\x64\x86':
        raise IdentityUnknown('Unsupported PE architecture')
    sections = struct.unpack_from('<H', data, pe_offset + 6)[0]
    optional_size = struct.unpack_from('<H', data, pe_offset + 20)[0]
    optional = pe_offset + 24
    if struct.unpack_from('<H', data, optional)[0] != 0x20B:
        raise IdentityUnknown('Unsupported PE optional header')
    preferred = struct.unpack_from('<Q', data, optional + 24)[0]
    image_size, header_size = struct.unpack_from('<II', data, optional + 56)
    if not 0 < image_size <= 128 * 1024 * 1024:
        raise IdentityUnknown('Invalid PE image size')
    image = bytearray(image_size)
    image[:header_size] = data[:header_size]
    for index in range(sections):
        section = optional + optional_size + index * 40
        virtual_size, rva, raw_size, raw_offset = struct.unpack_from('<IIII', data, section + 8)
        if rva + max(virtual_size, raw_size) > image_size or raw_offset + raw_size > len(data):
            raise IdentityUnknown('Invalid PE section')
        image[rva:rva + raw_size] = data[raw_offset:raw_offset + raw_size]
    if image[GETTER_RVA:GETTER_RVA + len(GETTER_BYTES)] != GETTER_BYTES:
        raise IdentityUnknown('Disk Item getter mismatch')
    _VERIFIED_IMAGE = (bytes(image), preferred)
    return _VERIFIED_IMAGE


@lru_cache(maxsize=2)
def player_vtable_rvas(image, preferred):
    for rva, name in zip(PLAYER_VTABLE_RVAS, ('Player', 'LocalPlayer')):
        locator = struct.unpack_from('<Q', image, rva - 8)[0] - preferred
        if not 0 <= locator <= len(image) - 24:
            raise IdentityUnknown('Player RTTI locator unavailable')
        signature, offset, constructor, descriptor, hierarchy, self_rva = struct.unpack_from('<IIIIII', image, locator)
        expected_name = ('.?AV' + name + '@@\x00').encode('ascii')
        if (signature != 1 or offset != 0 or constructor != 0 or self_rva != locator
                or image[descriptor + 16:descriptor + 16 + len(expected_name)] != expected_name):
            raise IdentityUnknown('Player RTTI mismatch in verified executable')
    return PLAYER_VTABLE_RVAS


def runtime_anchors(read, base, image, preferred, player_rvas):
    if exact(read, base, 64) != image[:64]:
        raise IdentityUnknown('Runtime image header mismatch')
    if exact(read, base + GETTER_RVA, len(GETTER_BYTES)) != GETTER_BYTES:
        raise IdentityUnknown('Runtime Item getter mismatch')
    for rva in (ITEM_VTABLE_RVA, TILE_VTABLE_RVA, *player_rvas):
        expected = bytearray()
        for offset in range(0, 64, 8):
            pointer = struct.unpack_from('<Q', image, rva + offset)[0]
            if not preferred <= pointer < preferred + len(image):
                raise IdentityUnknown('Vtable points outside verified executable')
            expected.extend(struct.pack('<Q', base + pointer - preferred))
        if exact(read, base + rva, 64) != bytes(expected):
            raise IdentityUnknown('Runtime vtable anchor mismatch')


def read_player(read, location, profile):
    location = address(location)
    data = exact(read, location, 0x190)
    vtable = struct.unpack_from('<Q', data)[0]
    if vtable not in [address(profile['moduleBase']) + rva for rva in profile['playerVtableRvas']]:
        raise IdentityUnknown('Player vtable mismatch')
    player_id = struct.unpack_from('<I', data, 0x5C)[0]
    raw_name = data[0x80:0xA0]
    try:
        name = raw_name.split(b'\x00', 1)[0].decode('ascii')
    except UnicodeDecodeError as error:
        raise IdentityUnknown('Invalid player name') from error
    if not player_id or not name.strip() or b'\x00' not in raw_name or data[0x186] != 0:
        raise IdentityUnknown('Player identity unavailable')
    return {'id': player_id, 'name': name, 'pos': position(data, 0x30), 'struct_va': hex(location),
            'creatureType': 0, 'ownershipVerified': True}


def read_tile_items(read, tile_va, profile):
    tile_va = address(tile_va)
    base = address(profile['moduleBase'])
    head = exact(read, tile_va, 0x72)
    if struct.unpack_from('<Q', head)[0] != base + TILE_VTABLE_RVA:
        raise IdentityUnknown('Tile vtable mismatch')
    tile_pos = position(head, 0x68)
    begin, end, capacity = struct.unpack_from('<QQQ', head, 0x50)
    if begin == end == capacity == 0:
        payload = b''
    else:
        address(begin)
        if (not begin <= end <= capacity or (end - begin) % 16 or (capacity - begin) % 16
                or (capacity - begin) // 16 > MAX_THINGS):
            raise IdentityUnknown('Invalid Tile Thing vector')
        payload = exact(read, begin, end - begin) if end != begin else b''
    items, observed = [], set()
    for offset in range(0, len(payload), 16):
        thing_va = struct.unpack_from('<Q', payload, offset)[0]
        thing_vtable = struct.unpack('<Q', exact(read, thing_va, 8))[0]
        if thing_va in observed:
            raise IdentityUnknown('Duplicate Thing membership')
        observed.add(thing_va)
        if thing_vtable != base + ITEM_VTABLE_RVA:
            continue
        item_head = exact(read, thing_va, 0xD6)
        if struct.unpack_from('<Q', item_head)[0] != base + ITEM_VTABLE_RVA:
            raise IdentityUnknown('Item vtable changed')
        item_pos = position(item_head, 0x20)
        item_id = struct.unpack_from('<H', item_head, 0xD4)[0]
        if item_pos != tile_pos or item_id == 0:
            raise IdentityUnknown('Item position/id unavailable or disagrees with Tile')
        items.append({'id': item_id, 'stack': offset // 16, 'pos': item_pos,
                      'struct_va': hex(thing_va), 'tile_va': hex(tile_va)})
    if exact(read, tile_va, len(head)) != head:
        raise IdentityUnknown('Tile changed during read')
    if payload and exact(read, begin, len(payload)) != payload:
        raise IdentityUnknown('Thing vector changed during read')
    for item in items:
        check = exact(read, address(item['struct_va']), 0xD6)
        if (struct.unpack_from('<Q', check)[0] != base + ITEM_VTABLE_RVA
                or position(check, 0x20) != item['pos']
                or struct.unpack_from('<H', check, 0xD4)[0] != item['id']):
            raise IdentityUnknown('Item changed during read')
    return tile_pos, items


def freshness(generated_at, now):
    try:
        timestamp = datetime.datetime.fromisoformat(generated_at.replace('Z', '+00:00'))
        age = float(now) - timestamp.timestamp() * 1000
        if timestamp.tzinfo is None or not math.isfinite(age) or not 0 <= age <= MAX_AGE_MS:
            raise ValueError('expired')
    except (AttributeError, TypeError, ValueError, OverflowError) as error:
        raise IdentityUnknown('Capture identity expired/invalid (500ms maximum)') from error


class ProcessMemory:
    def __init__(self, handle):
        if os.name != 'nt':
            raise IdentityUnknown('Windows RPM required')
        self.handle = handle
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        signatures = {
            'GetProcessId': ([wintypes.HANDLE], wintypes.DWORD),
            'GetProcessTimes': ([wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4, wintypes.BOOL),
            'GetExitCodeProcess': ([wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)], wintypes.BOOL),
            'QueryFullProcessImageNameW': ([wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR,
                                           ctypes.POINTER(wintypes.DWORD)], wintypes.BOOL),
            'ReadProcessMemory': ([wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p,
                                   ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)], wintypes.BOOL),
        }
        for name, (arguments, result) in signatures.items():
            function = getattr(self.kernel, name)
            function.argtypes, function.restype = arguments, result

    def read(self, location, size):
        buffer = ctypes.create_string_buffer(size)
        count = ctypes.c_size_t()
        if not self.kernel.ReadProcessMemory(self.handle, location, buffer, size, ctypes.byref(count)):
            return None
        return buffer.raw[:count.value]

    def session(self):
        pid = self.kernel.GetProcessId(self.handle)
        exit_code = wintypes.DWORD()
        times = [wintypes.FILETIME() for _ in range(4)]
        path = ctypes.create_unicode_buffer(32768)
        length = wintypes.DWORD(len(path))
        if (not pid or not self.kernel.GetExitCodeProcess(self.handle, ctypes.byref(exit_code))
                or exit_code.value != 259
                or not self.kernel.GetProcessTimes(self.handle, *[ctypes.byref(value) for value in times])
                or not self.kernel.QueryFullProcessImageNameW(self.handle, 0, path, ctypes.byref(length))):
            raise IdentityUnknown('Process/session identity unavailable')
        if Path(path.value).name.lower() != IMAGE_NAME.lower():
            raise IdentityUnknown('Wrong process image')
        import pointer_scan_entities as pe
        pe.sc.k32.CloseHandle.argtypes = [wintypes.HANDLE]
        pe.sc.k32.CloseHandle.restype = wintypes.BOOL
        modules = [module for module in pe.enum_modules(pid) if module['name'].lower() == IMAGE_NAME.lower()]
        if len(modules) != 1:
            raise IdentityUnknown('Main module unavailable/ambiguous')
        started = (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
        return {'pid': pid, 'processStartedAt': str(started), 'executablePath': path.value,
                'moduleBase': hex(modules[0]['base'])}


def resolve_profile(memory):
    session = memory.session()
    image, preferred = verified_image(session['executablePath'])
    player_rvas = player_vtable_rvas(image, preferred)
    runtime_anchors(memory.read, address(session['moduleBase']), image, preferred, player_rvas)
    if memory.session() != session:
        raise IdentityUnknown('Process changed while verifying executable anchors')
    return {**session, 'schemaVersion': 1, 'layoutId': LAYOUT_ID,
            'executableSha256': EXECUTABLE_SHA256, 'playerVtableRvas': list(player_rvas)}


def validate_capture_guard(handle, guard, now):
    return validate_guard_with_memory(ProcessMemory(handle), guard, now)


def validate_guard_with_memory(memory, guard, now):
    if not isinstance(guard, dict):
        raise IdentityUnknown('Missing capture guard')
    freshness(guard.get('generatedAt'), now)
    began = time.monotonic()
    expected_profile = guard.get('profile')
    player, item = guard.get('player'), guard.get('item')
    max_distance = guard.get('maxDistance')
    if type(max_distance) is not int or not 1 <= max_distance <= 30:
        raise IdentityUnknown('Capture maxDistance must be an integer in 1..30')
    if not all(isinstance(value, dict) for value in (expected_profile, player, item)):
        raise IdentityUnknown('Incomplete capture guard')
    actual_profile = resolve_profile(memory)
    if (type(guard.get('pid')) is not int or guard['pid'] != actual_profile['pid']
            or any(expected_profile.get(key) != value for key, value in actual_profile.items())):
        raise IdentityUnknown('Capture process/session/profile changed')
    if (type(item.get('id')) is not int or not 1 <= item['id'] <= 65535
            or type(item.get('stack')) is not int or not 0 <= item['stack'] < MAX_THINGS):
        raise IdentityUnknown('Invalid expected Item identity')
    for _ in range(2):
        current_player = read_player(memory.read, player.get('struct_va'), actual_profile)
        if any(current_player[key] != player.get(key) for key in current_player):
            raise IdentityUnknown('Player identity/position changed')
        tile_pos, members = read_tile_items(memory.read, item.get('tile_va'), actual_profile)
        if (tile_pos['z'] != current_player['pos']['z']
                or max(abs(tile_pos[axis] - current_player['pos'][axis]) for axis in ('x', 'y')) > max_distance):
            raise IdentityUnknown('Capture Item exceeds maxDistance or differs from player floor')
        if not any(all(candidate[key] == item.get(key) for key in candidate) for candidate in members):
            raise IdentityUnknown('Capture Item membership/stack/id changed')
    if memory.session() != {key: actual_profile[key] for key in
                            ('pid', 'processStartedAt', 'executablePath', 'moduleBase')}:
        raise IdentityUnknown('Process session changed during guard')
    if read_player(memory.read, player['struct_va'], actual_profile) != current_player:
        raise IdentityUnknown('Player moved during capture guard')
    freshness(guard['generatedAt'], now + (time.monotonic() - began) * 1000)
    return {'verified': True, 'layoutId': LAYOUT_ID, 'itemId': item['id'], 'stack': item['stack']}
