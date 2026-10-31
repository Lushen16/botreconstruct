"""PID-bound Win32 combat input. Success means queued messages, not damage."""

import argparse
import ctypes
import json
import os
import sys
import time
from ctypes import wintypes
from creature_identity import TargetMovedError


def key_code(key):
    normalized = key.strip().lower()
    if normalized.startswith('f') and normalized[1:].isdigit() and 1 <= int(normalized[1:]) <= 12:
        return 0x6F + int(normalized[1:])
    if len(normalized) == 1 and normalized.isascii() and normalized.isalnum():
        return ord(normalized.upper())
    arrows = {'up': 0x26, 'down': 0x28, 'left': 0x25, 'right': 0x27}
    if normalized in arrows:
        return arrows[normalized]
    return {'space': 0x20, 'escape': 0x1B, 'tab': 9}.get(normalized)


def find_target_window(user, pid):
    found = []

    def enum_proc(hwnd, _lparam):
        if not user.IsWindowVisible(hwnd) or user.GetWindow(hwnd, 4):
            return True
        proc_id = wintypes.DWORD()
        user.GetWindowThreadProcessId(hwnd, ctypes.byref(proc_id))
        if proc_id.value == pid:
            buf = ctypes.create_unicode_buffer(1024)
            user.GetWindowTextW(hwnd, buf, 1024)
            title = buf.value.strip()
            if "pokealliance" in title.lower():
                found.append((hwnd, title))
        return True

    cb = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)(enum_proc)
    user.EnumWindows(cb, 0)
    if not found:
        return None, None
    found.sort(key=lambda item: len(item[1]), reverse=True)
    return found[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('pid', type=int)
    parser.add_argument('key', nargs='?')
    parser.add_argument('--request')
    parser.add_argument('--probe', action='store_true')
    args = parser.parse_args()

    if args.pid <= 0 or os.name != 'nt':
        raise ValueError('Windows e PID positivo sao obrigatorios.')

    user = ctypes.WinDLL('user32', use_last_error=True)
    try:
        hDesk = user.OpenDesktopW('Default', 0, False, 0x1FF)
        if hDesk:
            user.SetThreadDesktop(hDesk)
    except Exception:
        pass

    hwnd, title = find_target_window(user, args.pid)
    if not hwnd:
        raise ValueError(f'Janela do PokeAlliance nao encontrada para PID {args.pid}.')

    rect = wintypes.RECT()
    user.GetClientRect(hwnd, ctypes.byref(rect))
    fg = user.GetForegroundWindow()
    is_fg = (fg == hwnd)

    if args.probe:
        return {
            'success': True,
            'pid': args.pid,
            'hwnd': hex(hwnd),
            'title': title,
            'width': rect.right,
            'height': rect.bottom,
            'eventsSent': 0,
            'foreground': is_fg,
            'transport': 'PostMessageW'
        }

    request = {}
    if args.request:
        request = json.loads(args.request)
    elif args.key:
        request = {'kind': 'key', 'key': args.key}
    else:
        raise ValueError('Comando ausente: forneca key ou --request.')

    kind = request.get('kind', 'key')
    background_allowed = request.get('allowBackground', False)

    result = {
        'success': True,
        'pid': args.pid,
        'hwnd': hex(hwnd),
        'title': title,
        'width': rect.right,
        'height': rect.bottom,
        'eventsSent': 0,
        'foreground': is_fg,
        'transport': 'PostMessageW'
    }

    if kind in ('attack', 'click'):
        x = request.get('x')
        y = request.get('y')
        w = request.get('width')
        h = request.get('height')
        if w is not None and w != rect.right or h is not None and h != rect.bottom:
            raise ValueError('Janela redimensionada; recalibre o viewport antes de atacar.')
        if not isinstance(x, int) or not isinstance(y, int) or not (0 <= x < rect.right) or not (0 <= y < rect.bottom):
            raise ValueError(f'Coordenadas invalidas ({x}, {y}) para viewport {rect.right}x{rect.bottom}.')

        lparam = (y << 16) | (x & 0xFFFF)
        if kind == 'click':
            messages = [(0x0201, 1, lparam), (0x0202, 0, lparam)]
        else:
            messages = [(0x0204, 2, lparam), (0x0205, 0, lparam)]
        result.update(kind=kind, x=x, y=y)
    elif kind == 'key':
        key_str = request.get('key')
        vk = key_code(key_str) if isinstance(key_str, str) else None
        if vk is None:
            raise ValueError(f'Tecla invalida: {key_str}')
        scan = user.MapVirtualKeyW(vk, 0)
        messages = [
            (0x0100, vk, 1 | (scan << 16)),
            (0x0101, vk, 0xC0000001 | (scan << 16))
        ]
        result.update(kind='key', key=key_str)
    else:
        raise ValueError(f'Tipo desconhecido: {kind}')

    if not is_fg and not background_allowed:
        user.SetForegroundWindow(hwnd)
        time.sleep(0.02)
        if user.GetForegroundWindow() != hwnd:
            return {
                **result,
                'success': False,
                'errorCode': 'WALKER_FOCUS_LOST',
                'error': 'Foco mudou antes do combate.'
            }

    if request.get('targetGuard') is not None:
        import scan_creatures as sc
        from creature_identity import validate_guard
        memory = sc.k32.OpenProcess(sc.PROCESS_QUERY_INFORMATION | sc.PROCESS_VM_READ, False, args.pid)
        if not memory:
            raise ValueError('Leitura de memoria indisponivel para targetGuard.')
        try:
            # The version/profile gate runs once before the module starts.
            # Re-reading and hashing the whole module image here costs seconds
            # and blows the actuator timeout; the dispatch guard only needs the
            # live struct identity (type/id/pos/floor/control block).
            profile = {"typeOffset": 0x186}
            result['identityGuard'] = validate_guard(
                request['targetGuard'],
                args.pid,
                lambda address, size: sc.read_mem(memory, address, size),
                profile
            )
        finally:
            sc.k32.CloseHandle(memory)

    result['startedAtMs'] = time.time_ns() // 1000000

    if kind in ('attack', 'click'):
        user.PostMessageW(hwnd, 0x0200, 0, messages[0][2])
        result['pointerEventsSent'] = 1

    try:
        if not user.PostMessageW(hwnd, messages[0][0], messages[0][1], messages[0][2]):
            raise ctypes.WinError(ctypes.get_last_error())
        result['eventsSent'] = 1
        time.sleep(0.04)
    finally:
        released = bool(user.PostMessageW(hwnd, messages[1][0], messages[1][1], messages[1][2]))
        result['eventsSent'] += int(released)

    if result['eventsSent'] != 2:
        raise ValueError('Envio incompleto de mensagens Win32.')

    result['queuedAtMs'] = time.time_ns() // 1000000
    result['effectVerified'] = False
    return result


if __name__ == '__main__':
    try:
        outcome = main()
        if outcome is not None:
            print(json.dumps(outcome))
    except Exception as exc:
        print(f"Erro: {exc}", file=sys.stderr)
        sys.exit(1)
