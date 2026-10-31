"""PID-bound background transport; queued messages never verify game effects."""

import argparse
import ctypes
import json
import os
import time
from ctypes import wintypes


class DispatchError(ValueError):
    def __init__(self, message, result):
        super().__init__(message)
        self.result = result


def configure_user(user):
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    signatures = {
        'EnumWindows': ([callback_type, wintypes.LPARAM], wintypes.BOOL),
        'GetWindowThreadProcessId': ([wintypes.HWND, ctypes.POINTER(wintypes.DWORD)], wintypes.DWORD),
        'IsWindowVisible': ([wintypes.HWND], wintypes.BOOL),
        'GetWindow': ([wintypes.HWND, wintypes.UINT], wintypes.HWND),
        'GetForegroundWindow': ([], wintypes.HWND),
        'GetClientRect': ([wintypes.HWND, ctypes.POINTER(wintypes.RECT)], wintypes.BOOL),
        'GetWindowTextW': ([wintypes.HWND, wintypes.LPWSTR, ctypes.c_int], ctypes.c_int),
        'MapVirtualKeyW': ([wintypes.UINT, wintypes.UINT], wintypes.UINT),
        'PostMessageW': ([wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM], wintypes.BOOL),
    }
    for name, (arguments, result) in signatures.items():
        function = getattr(user, name)
        function.argtypes = arguments
        function.restype = result
    return callback_type


def validate_process(kernel, pid):
    kernel.ReadProcessMemory.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
    kernel.ReadProcessMemory.restype = wintypes.BOOL
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel.QueryFullProcessImageNameW.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        raise ValueError('Processo do cliente indisponivel.')
    try:
        image = ctypes.create_unicode_buffer(32768)
        size = wintypes.DWORD(len(image))
        if not kernel.QueryFullProcessImageNameW(handle, 0, image, ctypes.byref(size)):
            raise ValueError('Falha ao identificar o executavel do cliente.')
        if os.path.basename(image.value).lower() != 'pokealliance_dx.exe':
            raise ValueError('PID nao pertence ao cliente PokeAlliance_dx.exe.')
    finally:
        kernel.CloseHandle(handle)


def window_details(user, hwnd, pid):
    owner = wintypes.DWORD()
    if not user.GetWindowThreadProcessId(hwnd, ctypes.byref(owner)) or owner.value != pid:
        raise ValueError('Identidade HWND/PID mudou antes do envio.')
    title = ctypes.create_unicode_buffer(1024)
    if not user.GetWindowTextW(hwnd, title, len(title)) or 'pokealliance' not in title.value.lower():
        raise ValueError('Titulo da janela do cliente invalido.')
    rect = wintypes.RECT()
    if not user.GetClientRect(hwnd, ctypes.byref(rect)):
        raise ValueError('Dimensoes do cliente indisponiveis.')
    width, height = rect.right - rect.left, rect.bottom - rect.top
    if width <= 0 or height <= 0 or width > 32767 or height > 32767:
        raise ValueError('Dimensoes do cliente invalidas.')
    return title.value, width, height


def find_window(user, pid, callback_type):
    windows = []

    @callback_type
    def visit(hwnd, _parameter):
        owner = wintypes.DWORD()
        user.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid and user.IsWindowVisible(hwnd) and not user.GetWindow(hwnd, 4):
            try:
                title, width, height = window_details(user, hwnd, pid)
                windows.append((width * height, hwnd, title))
            except ValueError:
                pass
        return True

    if not user.EnumWindows(visit, 0) or not windows:
        raise ValueError('Falha ao enumerar janelas do cliente.')
    windows.sort(reverse=True)
    return windows[0][1]


def movement_scan(direction):
    if type(direction) is not int or direction not in range(4):
        raise ValueError('Walker teclado aceita somente setas cardinais.')
    return (0x48, 0x4D, 0x50, 0x4B)[direction], True


def key_messages(vk, scan, extended=False):
    if not scan or scan > 0xFF:
        raise ValueError('Scan code de teclado invalido.')
    lparam = 1 | (scan << 16) | (int(extended) << 24)
    return [(0x0100, vk, lparam), (0x0101, vk, lparam | 0xC0000000)]


def post_checked(user, hwnd, message, result, counter):
    if result.get('pid') is not None:
        owner = wintypes.DWORD()
        if not user.GetWindowThreadProcessId(hwnd, ctypes.byref(owner)) or owner.value != result['pid']:
            raise ValueError('Identidade HWND/PID mudou durante o envio.')
    ctypes.set_last_error(0)
    accepted = bool(user.PostMessageW(hwnd, *message))
    error = ctypes.get_last_error()
    if not accepted:
        result['win32Error'] = error
        raise ValueError(f'PostMessageW rejeitado: Win32 error {error}.')
    result[counter] += 1


def send_tap(user, hwnd, messages, result, pointer=None, validate=None):
    try:
        if validate is not None:
            validate()
        if pointer is not None:
            post_checked(user, hwnd, pointer, result, 'pointerEventsSent')
        post_checked(user, hwnd, messages[0], result, 'eventsSent')
        try:
            time.sleep(0.04)
        finally:
            post_checked(user, hwnd, messages[1], result, 'eventsSent')
    except Exception as error:
        result.update(success=False, error=str(error), errorCode='INPUT_DISPATCH_FAILED', retrySafe=False)
        raise DispatchError(str(error), result) from error
    result['queuedAtMs'] = time.time_ns() // 1000000
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pid', type=int, required=True)
    operation = parser.add_mutually_exclusive_group(required=True)
    operation.add_argument('--direction', type=int, choices=range(4))
    operation.add_argument('--probe', action='store_true')
    operation.add_argument('--focus', action='store_true')
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
        title, width, height = window_details(user, hwnd, args.pid)
        result.update(hwnd=hex(hwnd), title=title, width=width, height=height,
                      foreground=user.GetForegroundWindow() == hwnd)
        if args.direction is not None:
            scan, extended = movement_scan(args.direction)
            messages = key_messages((0x26, 0x27, 0x28, 0x25)[args.direction], scan, extended)
            def validate():
                if window_details(user, hwnd, args.pid) != (title, width, height):
                    raise ValueError('Janela mudou antes do envio.')
            result['startedAtMs'] = time.time_ns() // 1000000
            send_tap(user, hwnd, messages, result, validate=validate)
        result['success'] = True
    except Exception as error:
        result.update(success=False, error=str(error), uncertain=result['eventsSent'] > 0 or result['pointerEventsSent'] > 0)
    return result


if __name__ == '__main__':
    outcome = main()
    print(json.dumps(outcome))
    raise SystemExit(0 if outcome['success'] else 1)
