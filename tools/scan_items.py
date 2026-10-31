"""Read-only, bounded/cached Tile discovery and atomic RPM Item snapshots."""

import argparse
import ctypes
from ctypes import wintypes
import datetime
import json
import math
import os
from pathlib import Path
import struct
import sys
import tempfile
import time

import item_identity as identity


def timestamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def atomic_output(path, snapshot):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                         prefix=path.name + '.', suffix='.tmp', delete=False) as stream:
            temporary = stream.name
            json.dump(snapshot, stream, ensure_ascii=False, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            os.unlink(temporary)


class ItemScanner:
    def __init__(self, memory, player_name, regions, rescan_seconds=30, max_tiles=100000):
        self.memory, self.player_name, self.regions = memory, player_name, regions
        self.profile = identity.resolve_profile(memory)
        self.tiles, self.players = set(), set()
        self.pending = None
        self.discovered = False
        self.discovery_failed = False
        self.next_scan = 0
        self.discovery_started_at = None
        self.discovery_completed_at = None
        self.discovery_completed_clock = None
        self.discovery_generation = 0
        self.rescan_seconds, self.max_tiles = rescan_seconds, max_tiles

    def discover(self, byte_budget=64 * 1024 * 1024, seconds_budget=0.15):
        now = time.monotonic()
        if self.pending is None and now >= self.next_scan:
            self.discovery_started_at = timestamp()
            self.tiles.clear()
            self.players.clear()
            self.pending = iter(self.discovery_chunks())
            self.discovery_failed = False
            self.discovered = False
        if self.pending is None:
            return
        deadline, consumed = now + seconds_budget, 0
        while consumed < byte_budget and time.monotonic() < deadline:
            try:
                consumed += next(self.pending)
            except StopIteration:
                self.pending = None
                self.discovered = not self.discovery_failed
                self.discovery_completed_at = timestamp()
                self.discovery_completed_clock = time.monotonic()
                self.discovery_generation += 1
                self.next_scan = time.monotonic() + self.rescan_seconds
                break

    def discovery_chunks(self):
        base = identity.address(self.profile['moduleBase'])
        needles = {struct.pack('<Q', base + identity.TILE_VTABLE_RVA): self.tiles}
        for rva in self.profile['playerVtableRvas']:
            needles[struct.pack('<Q', base + rva)] = self.players
        for region_base, region_size in self.regions():
            offset = 0
            while offset < region_size:
                length = min(1024 * 1024, region_size - offset)
                try:
                    data = identity.exact(self.memory.read, region_base + offset, length)
                except identity.IdentityUnknown:
                    self.discovery_failed = True
                    yield length
                    offset += length
                    continue
                for needle, candidates in needles.items():
                    index = data.find(needle)
                    while index >= 0:
                        location = region_base + offset + index
                        if location % 8 == 0:
                            try:
                                if candidates is self.tiles:
                                    head = identity.exact(self.memory.read, location, 0x72)
                                    identity.position(head, 0x68)
                                else:
                                    identity.read_player(self.memory.read, location, self.profile)
                            except identity.IdentityUnknown:
                                index = data.find(needle, index + 1)
                                continue
                            if len(candidates) >= self.max_tiles and location not in candidates:
                                self.discovery_failed = True
                                return
                            candidates.add(location)
                        index = data.find(needle, index + 1)
                offset += length
                yield length

    def snapshot(self):
        errors, items = [], []
        snapshot = {'schemaVersion': 1, 'pid': self.profile['pid'],
                    'processStartedAt': self.profile['processStartedAt'], 'generatedAt': timestamp(),
                    'executableSha256': identity.EXECUTABLE_SHA256, 'layoutId': identity.LAYOUT_ID,
                    'moduleBase': self.profile['moduleBase'], 'complete': False, 'truncated': False,
                    'inventoryComplete': False,
                    'readErrors': errors, 'player': None, 'items': items,
                    'itemIdentityProfile': self.profile}
        try:
            actual_profile = identity.resolve_profile(self.memory)
            if actual_profile != self.profile:
                raise identity.IdentityUnknown('Scanner process/session/profile changed')
            self.discover()
            matches = []
            for location in tuple(self.players):
                try:
                    candidate = identity.read_player(self.memory.read, location, self.profile)
                    if candidate['name'] == self.player_name:
                        matches.append(candidate)
                except identity.IdentityUnknown:
                    self.players.discard(location)
            if len(matches) != 1:
                raise identity.IdentityUnknown('Player unavailable/ambiguous')
            player = matches[0]
            snapshot['player'] = player
            for tile_va in tuple(self.tiles):
                try:
                    head = identity.exact(self.memory.read, tile_va, 0x72)
                    if struct.unpack_from('<Q', head)[0] != identity.address(self.profile['moduleBase']) + identity.TILE_VTABLE_RVA:
                        self.tiles.discard(tile_va)
                        continue
                    tile_pos = identity.position(head, 0x68)
                    if (tile_pos['z'] != player['pos']['z']
                            or max(abs(tile_pos[axis] - player['pos'][axis]) for axis in ('x', 'y')) > 30):
                        continue
                    _, tile_items = identity.read_tile_items(self.memory.read, tile_va, self.profile)
                    items.extend(tile_items)
                except identity.IdentityUnknown as error:
                    errors.append({'address': hex(tile_va), 'error': str(error)})
            if identity.read_player(self.memory.read, player['struct_va'], self.profile) != player:
                raise identity.IdentityUnknown('Player changed during snapshot')
            if self.memory.session() != {key: self.profile[key] for key in
                                         ('pid', 'processStartedAt', 'executablePath', 'moduleBase')}:
                raise identity.IdentityUnknown('Process changed during snapshot')
            if self.discovery_failed:
                errors.append({'error': 'Discovery incomplete: read error or candidate limit'})
            snapshot['complete'] = self.discovered and not errors
            snapshot['truncated'] = not self.discovered
        except Exception as error:
            errors.append({'error': str(error)})
            snapshot['items'] = []
        snapshot['discovery'] = {'scope': 'cached-tiles-near-player', 'radius': 8,
                                 'state': 'scanning' if self.pending is not None else 'cached',
                                 'startedAt': self.discovery_started_at,
                                 'completedAt': self.discovery_completed_at,
                                 'generation': self.discovery_generation,
                                 'ageMs': None if self.discovery_completed_clock is None else
                                 max(0, (time.monotonic() - self.discovery_completed_clock) * 1000),
                                 'currentInventoryComplete': False}
        return snapshot


def failure_snapshot(pid, error):
    return {'schemaVersion': 1, 'pid': pid, 'processStartedAt': None, 'generatedAt': timestamp(),
            'executableSha256': None, 'layoutId': identity.LAYOUT_ID, 'moduleBase': None,
            'complete': False, 'truncated': True, 'inventoryComplete': False, 'discovery': None,
            'readErrors': [{'error': error}],
            'player': None, 'items': [], 'itemIdentityProfile': None}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pid', required=True, type=int)
    parser.add_argument('--player', required=True)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--interval', type=float, default=0.2, help='Polling interval in seconds')
    args = parser.parse_args(argv)
    if (os.name != 'nt' or args.pid <= 0 or not args.player.strip()
            or not math.isfinite(args.interval) or not 0.05 <= args.interval <= 60):
        parser.error('Windows, positive PID, player and interval 0.05..60 seconds required')
    import pointer_scan_entities as pe
    pe.sc.k32.VirtualQueryEx.argtypes = [wintypes.HANDLE, ctypes.c_void_p,
                                        ctypes.POINTER(pe.sc.MEMORY_BASIC_INFORMATION64), ctypes.c_size_t]
    pe.sc.k32.VirtualQueryEx.restype = ctypes.c_size_t
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    handle = kernel.OpenProcess(0x0410, False, args.pid)
    if not handle:
        atomic_output(args.output, failure_snapshot(args.pid, 'OpenProcess read-only failed'))
        return 1
    try:
        memory = identity.ProcessMemory(handle)
        scanner = ItemScanner(memory, args.player, lambda: pe.iter_search_regions(handle))
        if scanner.profile['pid'] != args.pid:
            raise identity.IdentityUnknown('Requested PID mismatch')
        while True:
            started = time.monotonic()
            atomic_output(args.output, scanner.snapshot())
            time.sleep(max(0, args.interval - (time.monotonic() - started)))
    except KeyboardInterrupt:
        atomic_output(args.output, failure_snapshot(args.pid, 'Scanner stopped'))
        return 0
    except Exception as error:
        atomic_output(args.output, failure_snapshot(args.pid, str(error)))
        print(str(error), file=sys.stderr)
        return 1
    finally:
        kernel.CloseHandle(handle)


if __name__ == '__main__':
    raise SystemExit(main())
