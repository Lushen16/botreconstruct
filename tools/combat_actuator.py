"""PID-bound background combat messages. Success means queued, not applied."""

import argparse
import ctypes
import json
import hashlib
import os
from pathlib import Path
import time
from ctypes import wintypes
from creature_identity import TargetMovedError
from walker_input import configure_user, validate_process, find_window, window_details, key_messages, send_tap


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


def dispatch(user, kernel, pid, hwnd, request, result):
    title, width, height = window_details(user, hwnd, pid)
    player_name = request.get('playerName')
    if player_name is not None and (not isinstance(player_name, str) or not player_name.strip()
                                    or title != 'PokeAlliance - ' + player_name):
        raise ValueError('Titulo da janela diverge do jogador esperado.')
    result.update(hwnd=hex(hwnd), title=title, width=width, height=height,
                  foreground=user.GetForegroundWindow() == hwnd)

    def validate_window():
        if window_details(user, hwnd, pid) != (title, width, height):
            raise ValueError('Janela mudou antes do envio.')

    kind = request.get('kind', 'key')
    result['kind'] = kind
    if kind == 'probe':
        result['success'] = True
        return result
    if kind not in ('key', 'attack', 'click', 'useWith'):
        raise ValueError(f'Tipo desconhecido: {kind}')
    if kind in ('attack', 'click', 'useWith'):
        x, y = request.get('x'), request.get('y')
        expected_width, expected_height = request.get('width'), request.get('height')
        if ((expected_width is not None and expected_width != width)
                or (expected_height is not None and expected_height != height)):
            raise ValueError('Janela redimensionada; recalibre o viewport antes de atacar.')
        if type(x) is not int or type(y) is not int or not (0 <= x < width and 0 <= y < height):
            raise ValueError('Coordenadas invalidas para o viewport.')
        lparam = (y << 16) | x
        click_messages = ([(0x0204, 2, lparam), (0x0205, 0, lparam)] if kind == 'attack'
                          else [(0x0201, 1, lparam), (0x0202, 0, lparam)])
        result.update(x=x, y=y)
    if kind in ('key', 'useWith'):
        key = request.get('key')
        vk = key_code(key) if isinstance(key, str) else None
        if vk is None or (kind == 'useWith' and not (0x70 <= vk <= 0x7B or key.strip().isascii()
                                                   and len(key.strip()) == 1 and key.strip().isalnum())):
            raise ValueError(f'Tecla invalida: {key}')
        messages = key_messages(vk, user.MapVirtualKeyW(vk, 0), vk in (0x25, 0x26, 0x27, 0x28))
        result['key'] = key
    if kind == 'useWith' and (not player_name or request.get('width') is None or request.get('height') is None
                              or not isinstance(request.get('itemGuard'), dict)):
        raise ValueError('useWith exige playerName, dimensoes e itemGuard.')
    if kind == 'useWith' and (type(request.get('itemId')) is not int or not 1 <= request['itemId'] <= 65535
                              or type(request.get('targetId')) is not int
                              or request['targetId'] != request['itemGuard'].get('item', {}).get('id')):
        raise ValueError('IDs useWith invalidos ou divergentes do corpo observado.')

    def validate_ball():
        guard = request.get('ballGuard')
        if (not isinstance(guard, dict) or guard.get('itemId') != request.get('itemId')
                or guard.get('key') != request.get('key') or guard.get('mode') != 'useWith'
                or guard.get('source') != 'live-confirmation'):
            raise ValueError('Bola/hotkey sem associacao confirmada.')
        filename = Path(guard['configFile'])
        if not filename.is_file() or filename.stat().st_size > 4 * 1024 * 1024:
            raise ValueError('Configuracao da bola indisponivel.')
        if hashlib.sha256(filename.read_bytes()).hexdigest() != guard.get('configSha256'):
            raise ValueError('Configuracao da bola mudou antes do envio.')

    def validate_target():
        validate_window()
        if request.get('targetGuard') is not None:
            from creature_identity import validate_guard
            memory = kernel.OpenProcess(0x0410, False, pid)
            if not memory:
                raise ValueError('Leitura de memoria indisponivel para targetGuard.')
            try:
                def read(address, size):
                    buffer = ctypes.create_string_buffer(size)
                    count = ctypes.c_size_t()
                    if not kernel.ReadProcessMemory(memory, address, buffer, size, ctypes.byref(count)):
                        return None
                    return buffer.raw[:count.value]
                result['identityGuard'] = validate_guard(request['targetGuard'], pid,
                    read, {'typeOffset': 0x186})
            finally:
                kernel.CloseHandle(memory)
        validate_window()

    result['startedAtMs'] = time.time_ns() // 1000000
    if kind == 'useWith':
        from item_identity import validate_capture_guard
        guard = request['itemGuard']
        if type(guard.get('pid')) is not int or guard['pid'] != pid:
            raise ValueError('itemGuard de outro PID ou ausente.')
        memory = kernel.OpenProcess(0x0410, False, pid)
        if not memory:
            raise ValueError('Leitura de memoria indisponivel para itemGuard.')
        try:
            def validate_item():
                validate_window()
                validate_ball()
                validate_capture_guard(memory, guard, time.time_ns() // 1000000)
                validate_window()
            send_tap(user, hwnd, messages, result, validate=validate_item)
            result.pop('queuedAtMs', None)
            time.sleep(0.08)
            send_tap(user, hwnd, click_messages, result, pointer=(0x0200, 0, lparam), validate=validate_item)
        finally:
            kernel.CloseHandle(memory)
    elif kind == 'key':
        send_tap(user, hwnd, messages, result, validate=validate_target)
    else:
        send_tap(user, hwnd, click_messages, result, pointer=(0x0200, 0, lparam), validate=validate_target)
    result['success'] = True
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('pid', type=int)
    parser.add_argument('key', nargs='?')
    parser.add_argument('--request')
    parser.add_argument('--probe', action='store_true')
    args = parser.parse_args()
    result = {'success': False, 'pid': args.pid, 'eventsSent': 0, 'pointerEventsSent': 0,
              'transport': 'PostMessageW', 'effectVerified': False, 'retrySafe': False}
    try:
        if args.pid <= 0 or os.name != 'nt':
            raise ValueError('Windows e PID positivo sao obrigatorios.')
        user = ctypes.WinDLL('user32', use_last_error=True)
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        callback_type = configure_user(user)
        validate_process(kernel, args.pid)
        hwnd = find_window(user, args.pid, callback_type)
        request = ({'kind': 'probe'} if args.probe else json.loads(args.request) if args.request
                   else {'kind': 'key', 'key': args.key})
        if not isinstance(request, dict):
            raise ValueError('Request deve ser objeto JSON.')
        dispatch(user, kernel, args.pid, hwnd, request, result)
    except Exception as error:
        result.update(success=False, error=str(error), uncertain=result['eventsSent'] > 0 or result['pointerEventsSent'] > 0)
        if (isinstance(error, TargetMovedError) or isinstance(error.__cause__, TargetMovedError)) and result['eventsSent'] == 0 and result['pointerEventsSent'] == 0:
            result['errorCode'] = 'COMBAT_TARGET_MOVED'
    return result


if __name__ == '__main__':
    outcome = main()
    print(json.dumps(outcome))
    raise SystemExit(0 if outcome['success'] else 1)
