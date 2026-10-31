"""PID-bound keyboard input for the independent RPM Walker backend."""

import argparse
import ctypes
import json
import os
import time
from ctypes import wintypes


class FocusLostError(ValueError):
    pass


def focus_window(user, hwnd, timeout=0.5):
    if user.GetForegroundWindow() == hwnd:
        return True, True
    user.keybd_event(0x12, 0, 0, 0)
    user.keybd_event(0x12, 0, 2, 0)
    user.ShowWindow(hwnd, 5) # SW_SHOW (preserve maximized state)
    accepted = bool(user.SetForegroundWindow(hwnd))
    deadline = time.monotonic() + timeout
    # Give the window manager a beat to apply the activation before polling.
    time.sleep(0.01)
    while user.GetForegroundWindow() != hwnd:
        if time.monotonic() >= deadline:
            return False, accepted
        time.sleep(0.01)
    return True, accepted


def send_tap(user, events, release, input_size):
    sent = user.SendInput(1, events, input_size)
    try:
        if sent != 1:
            raise ValueError('Keydown rejeitado; execucao interrompida.')
        time.sleep(0.04)
    finally:
        sent += user.SendInput(1, release, input_size)
    if sent != 2:
        raise ValueError('Envio de teclado incompleto; execucao interrompida.')
    return sent


def movement_scan(direction):
    if type(direction) is not int or direction not in range(4):
        raise ValueError('Walker teclado aceita somente setas cardinais.')
    return (0x48, 0x4D, 0x50, 0x4B)[direction], True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pid', type=int, required=True)
    operation = parser.add_mutually_exclusive_group(required=True)
    operation.add_argument('--direction', type=int, choices=range(4))
    operation.add_argument('--probe', action='store_true')
    operation.add_argument('--focus', action='store_true')
    args = parser.parse_args()
    if args.pid <= 0 or os.name != 'nt':
        raise ValueError('Windows e PID positivo sao obrigatorios.')
    user = ctypes.WinDLL('user32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)

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
    user.GetForegroundWindow.restype = wintypes.HWND
    user.SetForegroundWindow.argtypes = [wintypes.HWND]
    user.SetForegroundWindow.restype = wintypes.BOOL
    user.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user.GetClientRect.restype = wintypes.BOOL
    user.GetAsyncKeyState.argtypes = [ctypes.c_int]
    user.GetAsyncKeyState.restype = ctypes.c_short
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel.QueryFullProcessImageNameW.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    handle = kernel.OpenProcess(0x1000, False, args.pid)
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
    windows = []

    @callback_type
    def visit(hwnd, _parameter):
        owner = wintypes.DWORD()
        user.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == args.pid and user.IsWindowVisible(hwnd) and not user.GetWindow(hwnd, 4):
            windows.append(hwnd)
        return True

    if not user.EnumWindows(visit, 0) or not windows:
        raise ValueError('Falha ao enumerar janelas do cliente.')
    if len(windows) > 1:
        def client_area(h):
            r = wintypes.RECT()
            user.GetClientRect(h, ctypes.byref(r))
            return (r.right - r.left) * (r.bottom - r.top)
        windows.sort(key=client_area, reverse=True)
    hwnd = windows[0]
    activation_accepted = None
    if args.focus or args.direction is not None:
        foreground, activation_accepted = focus_window(user, hwnd)
    else:
        foreground = user.GetForegroundWindow() == hwnd
    if not args.probe and not foreground:
        raise FocusLostError('Cliente sem foco; Walker pausado. Use Continuar para retomar a rota. '
                         + 'activation=' + str(activation_accepted) + ', foreground=' + hex(user.GetForegroundWindow() or 0))
    sent = 0
    if args.direction is not None:
        if any(user.GetAsyncKeyState(key) & 0x8000 for key in (0x10, 0x11, 0x12, 0x5B, 0x5C)):
            raise ValueError('Solte Shift, Ctrl, Alt e Windows antes de andar.')

        class MouseInput(ctypes.Structure):
            _fields_ = [('dx', wintypes.LONG), ('dy', wintypes.LONG), ('mouseData', wintypes.DWORD),
                        ('dwFlags', wintypes.DWORD), ('time', wintypes.DWORD), ('dwExtraInfo', ctypes.c_size_t)]

        class KeyboardInput(ctypes.Structure):
            _fields_ = [('wVk', wintypes.WORD), ('wScan', wintypes.WORD), ('dwFlags', wintypes.DWORD),
                        ('time', wintypes.DWORD), ('dwExtraInfo', ctypes.c_size_t)]

        class InputData(ctypes.Union):
            _fields_ = [('mi', MouseInput), ('ki', KeyboardInput)]

        class Input(ctypes.Structure):
            _anonymous_ = ('data',)
            _fields_ = [('type', wintypes.DWORD), ('data', InputData)]

        scan, extended = movement_scan(args.direction)
        flags = 0x0008 | (0x0001 if extended else 0)
        events = (Input * 2)()
        for index in range(2):
            events[index].type = 1
            events[index].ki = KeyboardInput(0, scan, flags | (0x0002 if index else 0), 0, 0)
        user.SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(Input), ctypes.c_int]
        user.SendInput.restype = wintypes.UINT
        if user.GetForegroundWindow() != hwnd:
            raise FocusLostError('Foco mudou antes do envio; Walker pausado. Use Continuar para retomar a rota.')
        release = (Input * 1)()
        release[0] = events[1]
        sent = send_tap(user, events, release, ctypes.sizeof(Input))
    print(json.dumps({'success': True, 'pid': args.pid, 'hwnd': hex(hwnd),
                      'foreground': foreground, 'eventsSent': sent}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = 'WALKER_FOCUS_LOST' if isinstance(error, FocusLostError) else None
        print(json.dumps({'success': False, 'error': str(error), 'errorCode': code, 'eventsSent': 0}))
        raise SystemExit(1)
