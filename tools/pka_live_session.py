"""Live session provider for PokeAlliance_dx.exe (read-only).

Keeps a snapshot JSON fresh with the CURRENT player position/floor so the
walker/cavebot reads live coordinates instead of a frozen file.

Resolution strategy, cheapest first:
  1. Cached entity VA (validated by name + coords) - ~microseconds. The object
     address is stable while the creature lives.
  2. Static pointer chain inside the game module image (--chain-rva) - a few
     reads. Useful on a fresh start, but the slot can be transient.
  3. Relocate by name (full read-only scan) - seconds, throttled. Used only when
     both above fail; during the rescan the snapshot is NOT refreshed, so the
     consumer sees it age and treats it as stale instead of trusting old bytes.

Nothing is written to the target process.

Usage:
  python tools/pka_live_session.py --watch --player-name Nobutdopai --output live-snapshot-27964.json
  python tools/pka_live_session.py --once --pid 27964
  python tools/pka_live_session.py --selftest
"""

from __future__ import annotations

import argparse
import ctypes
import datetime
import json
import os
import struct
import sys
import threading
import time
from ctypes import wintypes
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scan_creatures as sc
import pointer_scan_entities as pe

DEFAULT_CHAIN_RVA = 0x392E9C0
DEFAULT_CHAINS = (
    (0x392E9C0, ()), (0x392E9B8, (0x10,)), (0x392E9F8, (0x1A8,)),
    (0x392EA00, (0x1B8,)), (0x3938930, (0x110,)), (0x3938938, (0x120,)),
)
PLAYER_ID_MIN, PLAYER_ID_MAX = 0x10000000, 0x10010000
MONSTER_ID_MIN, MONSTER_ID_MAX = 0x40000000, 0x40100000
CREATURE_ID_MIN, CREATURE_ID_MAX = 0x80000000, 0x80010000


_TITLE_CACHE = {}

def client_window_title(pid):
    user = ctypes.WinDLL('user32', use_last_error=True)
    try:
        hDesk = user.OpenDesktopW('Default', 0, False, 0x1FF)
        if hDesk:
            user.SetThreadDesktop(hDesk)
    except Exception:
        pass
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    user.EnumWindows.restype = wintypes.BOOL
    user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user.GetWindowThreadProcessId.restype = wintypes.DWORD
    user.IsWindowVisible.argtypes = [wintypes.HWND]
    user.IsWindowVisible.restype = wintypes.BOOL
    user.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
    user.GetWindow.restype = wintypes.HWND
    user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user.GetWindowTextW.restype = ctypes.c_int
    titles = []

    @callback_type
    def visit(hwnd, _parameter):
        owner = wintypes.DWORD()
        user.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid and user.IsWindowVisible(hwnd) and not user.GetWindow(hwnd, 4):
            title = ctypes.create_unicode_buffer(1024)
            user.GetWindowTextW(hwnd, title, len(title))
            titles.append(title.value)
        return True

    if not user.EnumWindows(visit, 0) or not titles:
        # A single failed enumeration (busy desktop, focus transition, heavy
        # client load) must not mark a valid session offline mid-movement.
        cached = _TITLE_CACHE.get(pid)
        if cached and (time.monotonic() - cached[1]) <= 2.0:
            return cached[0]
        return None
    matching = [t for t in titles if t and t.startswith('PokeAlliance')]
    if matching:
        result = matching[0]
    else:
        non_empty = [t for t in titles if t.strip()]
        result = non_empty[0] if non_empty else titles[0]
    _TITLE_CACHE[pid] = (result, time.monotonic())
    return result


def in_id_family(ident) -> bool:
    """True for the id families observed in real telemetry (players 0x1000xxxx, NPCs/creatures 0x8000xxxx)."""
    return isinstance(ident, int) and (
        PLAYER_ID_MIN <= ident < PLAYER_ID_MAX or MONSTER_ID_MIN <= ident < MONSTER_ID_MAX or CREATURE_ID_MIN <= ident < CREATURE_ID_MAX)


def read_entity(read, va, layout, filters):
    """Read one creature struct (name + position). Returns None if implausible."""
    if not va:
        return None
    name = read(va + layout.name_offset, layout.name_max)
    position = read(va + layout.pos_offset, 10)
    if not name or not position or len(position) < 10:
        return None
    name = name.split(b"\x00", 1)[0]
    if not sc.plausible_name(name, filters):
        return None
    x, y, z = struct.unpack("<iih", position)
    if not sc.plausible_coords(x, y, z, filters):
        return None
    hp_raw = read(va + layout.hp_offset, 1)
    hp = hp_raw[0] if (hp_raw and len(hp_raw) == 1 and hp_raw[0] <= 100) else 100
    return {"name": name.decode("ascii", "replace"),
            "pos": {"x": x, "y": y, "z": z}, "hp": hp, "healthPercent": hp, "struct_va": hex(va)}


def resolve_chain(read, module_base, chain_rva, offsets, layout, filters):
    if module_base is None:
        return None
    raw = read(module_base + chain_rva, 8)
    if not raw or len(raw) < 8:
        return None
    value = struct.unpack("<Q", raw)[0]
    for offset in offsets:
        raw = read(value + offset, 8)
        if not raw or len(raw) < 8:
            return None
        value = struct.unpack("<Q", raw)[0]
    return read_entity(read, value, layout, filters)


def resolve_chains(read, module_base, chains, layout, filters, expected=None):
    for chain_rva, offsets in chains:
        candidate = resolve_chain(read, module_base, chain_rva, list(offsets), layout, filters)
        if candidate and (expected is None or candidate["name"].lower() == expected.lower()):
            return candidate
    return None


def read_existing(path) -> dict:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def write_snapshot(path, snapshot: dict) -> None:
    text = json.dumps(snapshot, indent=2, ensure_ascii=False)
    target = Path(path)
    temporary = target.with_suffix(target.suffix + ".tmp")
    try:
        temporary.write_text(text, encoding="utf-8")
        os.replace(temporary, target)
    except OSError:
        target.write_text(text, encoding="utf-8")


def build_snapshot(pid, image, player, template, chains, module_base, source) -> dict:
    snapshot = dict(template) if isinstance(template, dict) else {}
    snapshot["schema"] = 2
    snapshot.setdefault("tool", {"name": "pka_live_session", "version": 1})
    snapshot["pid"] = pid
    snapshot["image"] = image
    snapshot["generatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    snapshot["player"] = player
    snapshot.setdefault("creatures", [])
    snapshot["live"] = {"source": source, "chains": [hex(rva) for rva, _o in chains],
                        "module_base": hex(module_base) if module_base else None}
    return snapshot


def module_image(pid, name):
    for module in pe.enum_modules(pid):
        if module["name"].lower() == name.lower():
            return module
    return None


def open_target(pid, process_name):
    if pid is None:
        pid = sc.find_pid_by_name(process_name)
        if pid is None:
            return None, None, None
    handle = sc.k32.OpenProcess(sc.PROCESS_QUERY_INFORMATION | sc.PROCESS_VM_READ, False, pid)
    if not handle:
        error = ctypes.get_last_error()
        raise OSError(error, 'OpenProcess falhou para o PID ' + str(pid))
    return pid, handle, sc.image_for_pid(handle)


def process_failure(pid, error=None):
    code = getattr(error, 'winerror', None) or getattr(error, 'errno', None)
    denied = code == 5
    return {'ok': False, 'pid': pid, 'errorCode': 'process-access-denied' if denied else 'process-unavailable',
            'win32Error': code,
            'error': ('Acesso negado ao ler o cliente (Win32 5). Verifique se jogo e bot estao no mesmo nivel de privilegio.'
                      if denied else 'Cliente indisponivel para leitura RPM.')}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Live session provider (read-only)")
    parser.add_argument("--pid", type=int, default=None)
    parser.add_argument("--process-name", default=sc.IMAGE_NAME)
    parser.add_argument("--player-name", default=None, help="expected local player name")
    parser.add_argument("--chain-rva", type=lambda t: int(t, 0), default=None,
                        help="override the default chain set with a single direct chain rva")
    parser.add_argument("--id-offset", type=lambda t: int(t, 0), default=0x5C)
    parser.add_argument("--hp-offset", type=lambda t: int(t, 0), default=0xC0)
    parser.add_argument("--output", type=Path, default=Path("live-snapshot-27964.json"))
    parser.add_argument("--interval-ms", type=int, default=250)
    parser.add_argument("--module-refresh-s", type=float, default=5.0)
    parser.add_argument("--relocate-min-interval-s", type=float, default=5.0)
    parser.add_argument("--creatures-interval-s", type=float, default=30.0,
                        help="background creature-list refresh; 0 disables it")
    parser.add_argument("--creatures-max-mib", type=int, default=2560)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--watch", action="store_true", help="run continuously (default unless --once)")
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--probe-access", action="store_true", help="check RPM access without scanning or sending inputs")
    args = parser.parse_args(argv)

    if args.selftest:
        return run_selftest()

    if args.probe_access:
        try:
            target_pid, target_handle, image = open_target(args.pid, args.process_name)
        except OSError as error:
            print(json.dumps(process_failure(args.pid, error)), flush=True)
            return 2
        if not target_handle:
            print(json.dumps(process_failure(args.pid)), flush=True)
            return 2
        sc.k32.CloseHandle(target_handle)
        print(json.dumps({'ok': True, 'pid': target_pid, 'rpmAccess': True, 'commandsSent': 0}), flush=True)
        return 0

    layout, filters = sc.Layout(), sc.Filters()
    chains = DEFAULT_CHAINS if args.chain_rva is None else ((args.chain_rva, ()),)
    handle = pid = image = module_base = None
    module_at = 0.0
    cached_va = None
    expected = args.player_name
    last_relocate = 0.0

    def ensure_open():
        nonlocal handle, pid, image, module_base
        if handle:
            return True
        pid, handle, image = open_target(args.pid, args.process_name)
        if not handle:
            return False
        module = module_image(pid, args.process_name)
        module_base = module["base"] if module else None
        return True

    creature_layout = sc.Layout(id_offset=args.id_offset, hp_offset=args.hp_offset, canattack_offset=0xC4, type_offset=0x0C)
    creature_filters = sc.Filters()
    creature_holder = {"snapshot": None}

    def creature_worker():
        while True:
            if not handle:
                time.sleep(1.0)
                continue
            started = time.monotonic()
            try:
                options = sc.default_options(argparse.Namespace(
                    max_mib=args.creatures_max_mib, chunk_mib=16, overlap=0x400,
                    coords_lane=False, player_name=None, player=None))
                result = sc.scan_process(handle, pid, image, creature_layout, creature_filters, options)
                creatures = [
                    {"id": c["id"], "name": c["name"], "type": c["type"],
                     "healthPercent": c["healthPercent"], "canAttack": c["canAttack"],
                     "pos": c["pos"], "struct_va": c["struct_va"]}
                    for c in result["candidates"] if in_id_family(c["id"])]
                creature_holder["snapshot"] = {
                    "creatures": creatures,
                    "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                }
                print(json.dumps({"creatures": len(creatures)}),
                      file=sys.stderr, flush=True)
            except Exception as error:  # noqa: BLE001 - keep the previous list on any scan error
                print(json.dumps({"worker_error": str(error)}), file=sys.stderr, flush=True)
            time.sleep(max(1.0, args.creatures_interval_s - (time.monotonic() - started)))

    if args.creatures_interval_s > 0:
        threading.Thread(target=creature_worker, name="creature-refresh", daemon=True).start()

    while True:
        try:
            opened = ensure_open()
            failure = process_failure(args.pid)
        except OSError as error:
            opened = False
            failure = process_failure(args.pid, error)
        if not opened:
            print(json.dumps(failure), flush=True)
            if args.once:
                return 2
            time.sleep(max(0.2, args.interval_ms / 1000))
            continue

        read = lambda va, n: sc.read_mem(handle, va, n)
        now = time.monotonic()
        if module_base is None or now - module_at > args.module_refresh_s:
            module = module_image(pid, args.process_name)
            module_base = module["base"] if module else None
            module_at = now

        player = None
        source = None
        candidate = read_entity(read, cached_va, layout, filters)
        if candidate and (expected is None or candidate["name"].lower() == expected.lower()):
            player, source = candidate, "cached-va"
        if player is None:
            candidate = resolve_chains(read, module_base, chains, layout, filters, expected)
            if candidate:
                player, source = candidate, "pointer-chain"
                cached_va = int(candidate["struct_va"], 16)
        if player is None and now - last_relocate >= args.relocate_min_interval_s:
            last_relocate = now
            if args.player_name:
                va = pe.locate_by_name(handle, args.player_name, layout, filters,
                                       args.id_offset, None)
                if va:
                    cached_va = va
                    candidate = read_entity(read, va, layout, filters)
                    if candidate:
                        player, source = candidate, "relocated"

        if player is None:
            print(json.dumps({"ok": False, "pid": pid, "error": "player unresolved",
                              "module_base": hex(module_base) if module_base else None}), flush=True)
            if args.once:
                return 3
            time.sleep(max(0.2, args.interval_ms / 1000))
            continue

        template = read_existing(args.output)
        creature_snapshot = creature_holder["snapshot"]
        if creature_snapshot is not None:
            template["creatures"] = creature_snapshot["creatures"]
            template["creaturesGeneratedAt"] = creature_snapshot["generatedAt"]
        snapshot = build_snapshot(pid, image, player, template, chains, module_base, source)
        snapshot['clientWindowTitle'] = client_window_title(pid)
        snapshot['online'] = snapshot['clientWindowTitle'] is not None and (
            snapshot['clientWindowTitle'].casefold() in ('pokealliance', ('pokealliance - ' + player['name']).casefold()))
        write_snapshot(args.output, snapshot)
        print(json.dumps({"ok": True, "pid": pid, "player": player, "source": source,
                          "generatedAt": snapshot["generatedAt"]}), flush=True)
        if args.once:
            return 0
        time.sleep(max(0.05, args.interval_ms / 1000))


def run_selftest() -> int:
    MODULE_BASE, MODULE_SIZE = 0x140000000, 0x4000000
    direct_rva, indirect_rva = 0x392E9C0, 0x392E9F8
    obj, entity = 0x200006000, 0x200008000

    static = bytearray(MODULE_SIZE)
    struct.pack_into("<Q", static, direct_rva, entity)
    struct.pack_into("<Q", static, indirect_rva, obj)
    heap = bytearray(0x10000)

    def read(va, n):
        if MODULE_BASE <= va and va + n <= MODULE_BASE + MODULE_SIZE:
            return bytes(static[va - MODULE_BASE:va - MODULE_BASE + n])
        if 0x200000000 <= va and va + n <= 0x200000000 + len(heap):
            return bytes(heap[va - 0x200000000:va - 0x200000000 + n])
        return None

    layout, filters = sc.Layout(), sc.Filters()
    name = b"Charizard\x00"
    heap[entity - 0x200000000 + layout.name_offset:entity - 0x200000000 + layout.name_offset + len(name)] = name
    struct.pack_into("<i", heap, entity - 0x200000000 + layout.pos_offset, 3299)
    struct.pack_into("<i", heap, entity - 0x200000000 + layout.pos_offset + 4, 2219)
    struct.pack_into("<h", heap, entity - 0x200000000 + layout.z_offset, 7)
    struct.pack_into("<Q", heap, obj - 0x200000000 + 0x1A8, entity)

    direct = read_entity(read, entity, layout, filters)
    assert direct and direct["name"] == "Charizard" and direct["pos"] == {"x": 3299, "y": 2219, "z": 7}, direct
    assert read_entity(read, 0x200009000, layout, filters) is None  # empty slot rejected

    one = resolve_chain(read, MODULE_BASE, indirect_rva, [0x1A8], layout, filters)
    assert one == direct, one
    two = resolve_chains(read, MODULE_BASE, ((direct_rva, ()), (indirect_rva, (0x1A8,))),
                         layout, filters, "charizard")
    assert two == direct, two

    template = {"creatures": [{"id": 1, "name": "Keep", "pos": {"x": 1, "y": 1, "z": 7}}]}
    snapshot = build_snapshot(4242, "selftest", direct, template, ((direct_rva, ()),), MODULE_BASE, "pointer-chain")
    assert snapshot["player"] == direct and snapshot["creatures"] == template["creatures"]
    assert snapshot["live"]["source"] == "pointer-chain" and snapshot["live"]["chains"] == [hex(direct_rva)]
    assert in_id_family(0x1000049F) and in_id_family(0x40002A32) and in_id_family(0x80000001)
    assert not in_id_family(0) and not in_id_family(32759) and not in_id_family(None)
    print(json.dumps({"selftest": "ok", "player": direct, "chains": snapshot["live"]["chains"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
