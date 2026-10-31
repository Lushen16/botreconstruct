"""PKA runtime mock server (verified contract).

Contract source: reconstruction/transport.cjs, reconstruction/framing.cjs,
reconstruction/protocol.cjs and the original PipeBridge differential test.
This is a local test server; it is not the native DLL.

env:
  PKA_PID    target pid encoded in the pipe name (default 49001)
  PKA_KEY    channel key string (default "00112233445566778899aabbccddeeff")
  PKA_NONCE  32-byte challenge nonce as hex (optional; random otherwise)

usage: python tools/pka_runtime_server.py
"""

from __future__ import annotations

import ctypes
from ctypes import wintypes
import hashlib
import hmac
import json
import os
import secrets
import struct
import sys

MAX_FRAME = 2105344
CLIENT_DOMAIN = b"PKA2/client\x00"
SERVER_DOMAIN = b"PKA2/server\x00"

KIND = {
    "challenge": 1, "authenticate": 2, "welcome": 3, "state": 4, "telemetry": 5,
    "automation": 6, "startup": 7, "automation_revoked": 8, "manual": 9,
    "ack": 10, "automation_control": 11, "automation_lease": 12,
}

PIPE_ACCESS_DUPLEX = 0x00000003
PIPE_TYPE_BYTE = 0x00000000
PIPE_READMODE_BYTE = 0x00000000
PIPE_WAIT = 0x00000000
ERROR_PIPE_CONNECTED = 535
BUFFER_SIZE = 65536
INVALID_HANDLE_VALUE = wintypes.HANDLE(-1).value

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
CreateNamedPipeW = kernel32.CreateNamedPipeW
CreateNamedPipeW.restype = wintypes.HANDLE
CreateNamedPipeW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD,
                             wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p]
ConnectNamedPipe = kernel32.ConnectNamedPipe
ConnectNamedPipe.restype = wintypes.BOOL
ConnectNamedPipe.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
ReadFile = kernel32.ReadFile
ReadFile.restype = wintypes.BOOL
ReadFile.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD,
                     ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
WriteFile = kernel32.WriteFile
WriteFile.restype = wintypes.BOOL
WriteFile.argtypes = [wintypes.HANDLE, wintypes.LPCVOID, wintypes.DWORD,
                      ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
CloseHandle = kernel32.CloseHandle
CloseHandle.restype = wintypes.BOOL
CloseHandle.argtypes = [wintypes.HANDLE]


def pipe_path(pid: int) -> str:
    return "\\\\.\\pipe\\pka-runtime-2-" + str(pid)


def frame(kind: int, payload: bytes) -> bytes:
    if not isinstance(payload, (bytes, bytearray)):
        raise TypeError("payload must be bytes")
    if len(payload) > MAX_FRAME:
        raise ValueError("payload exceeds MAX_FRAME")
    return struct.pack("<II", len(payload), kind) + bytes(payload)


def proof(domain: bytes, key: str, nonce: bytes, pid: int) -> bytes:
    message = domain + nonce + struct.pack("<I", pid)
    return hmac.new(key.encode("utf-8"), message, hashlib.sha256).digest()


def state_bytes(health: int = 90) -> bytes:
    data = bytearray(48)
    struct.pack_into("<I", data, 0, 1)
    struct.pack_into("<I", data, 4, 1)
    struct.pack_into("<I", data, 8, health)
    struct.pack_into("<d", data, 12, 100.0)
    struct.pack_into("<d", data, 20, 50.0)
    struct.pack_into("<d", data, 28, 150.0)
    struct.pack_into("<I", data, 36, 0)
    struct.pack_into("<I", data, 40, 0)
    struct.pack_into("<I", data, 44, 1)
    return bytes(data)


def telemetry_document(pid: int) -> dict:
    return {
        "schema": 2, "nativeVerified": True, "pulseVersion": 3, "tick": 1, "playerId": 1,
        "fightMode": 0, "chaseMode": 0, "clockMs": 0, "position": {"x": 100, "y": 100, "z": 7},
        "activeSlot": 1, "moves": [], "nativeSequence": [],
        "pokemonName": "Charizard", "comboPokemonName": "Charizard",
        "conditionEvents": True, "conditionsKnown": True, "conditions": [],
        "roster": [{"slot": 1, "uuid": "mock-uuid", "name": "Charizard", "healthPercent": 100, "moves": None}],
        "creatures": [{"id": 1, "name": "Wild", "type": 1, "healthPercent": 100, "canAttack": True,
                       "pos": {"x": 101, "y": 100, "z": 7}}],
        "items": [], "tiles": [], "clientPid": pid, "healthPercent": 90,
    }


class Session:
    def __init__(self, handle: int, pid: int, key: str, nonce: bytes) -> None:
        self.handle = handle
        self.pid = pid
        self.key = key
        self.nonce = nonce
        self.authenticated = False
        self.buffer = bytearray()

    def write(self, kind: int, payload: bytes) -> None:
        raw = frame(kind, payload)
        written = wintypes.DWORD()
        if not WriteFile(self.handle, raw, len(raw), ctypes.byref(written), None):
            raise OSError("WriteFile failed: %d" % ctypes.get_last_error())
        if written.value != len(raw):
            raise OSError("short pipe write")

    def ack(self, command_id: int, command_type: int, status: int = 0) -> None:
        self.write(KIND["ack"], struct.pack("<III", command_id, command_type, status))

    def dispatch(self, kind: int, payload: bytes) -> None:
        if not self.authenticated:
            if kind != KIND["authenticate"]:
                raise PermissionError("expected authenticate, got kind %d" % kind)
            expected = proof(CLIENT_DOMAIN, self.key, self.nonce, self.pid)
            if len(payload) != len(expected) or not hmac.compare_digest(expected, payload):
                raise PermissionError("invalid client proof")
            self.authenticated = True
            welcome = struct.pack("<I", self.pid) + proof(SERVER_DOMAIN, self.key, self.nonce, self.pid)
            self.write(KIND["welcome"], welcome)
            self.write(KIND["state"], state_bytes())
            self.write(KIND["telemetry"], json.dumps(telemetry_document(self.pid)).encode("utf-8"))
            print("PKA_AUTH pid=%d" % self.pid, flush=True)
            return
        if kind in (KIND["manual"], KIND["automation"]):
            command_id = struct.unpack_from("<I", payload, 0)[0] if len(payload) >= 4 else 0
            command_type = struct.unpack_from("<I", payload, 4)[0] if len(payload) >= 8 else 0
            print("PKA_COMMAND id=%d type=%d bytes=%d" % (command_id, command_type, len(payload)), flush=True)
            self.ack(command_id, command_type, 0)
            return
        if kind == KIND["startup"]:
            print("PKA_STARTUP %s" % payload.decode("utf-8", "replace"), flush=True)
            return
        print("PKA_FRAME kind=%d bytes=%d" % (kind, len(payload)), flush=True)

    def read_once(self) -> bool:
        chunk = ctypes.create_string_buffer(BUFFER_SIZE)
        read = wintypes.DWORD()
        if not ReadFile(self.handle, chunk, BUFFER_SIZE, ctypes.byref(read), None):
            return False
        if read.value == 0:
            return False
        self.buffer.extend(chunk.raw[: read.value])
        if len(self.buffer) > MAX_FRAME + 65536:
            raise ValueError("buffer exceeded MAX_FRAME")
        while len(self.buffer) >= 8:
            length, kind = struct.unpack_from("<II", self.buffer, 0)
            if length > MAX_FRAME:
                raise ValueError("frame exceeded MAX_FRAME")
            if len(self.buffer) < 8 + length:
                break
            payload = bytes(self.buffer[8:8 + length])
            del self.buffer[:8 + length]
            self.dispatch(kind, payload)
        return True


def serve(pid: int, key: str, nonce: bytes) -> None:
    path = pipe_path(pid)
    print("PKA_READY pid=%d pipe=%s" % (pid, path), flush=True)
    while True:
        handle = CreateNamedPipeW(path, PIPE_ACCESS_DUPLEX, PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                                  1, BUFFER_SIZE, BUFFER_SIZE, 0, None)
        if handle in (INVALID_HANDLE_VALUE, None):
            print("PKA_ERROR CreateNamedPipeW=%d" % ctypes.get_last_error(), flush=True)
            raise SystemExit(1)
        connected = ConnectNamedPipe(handle, None)
        if not connected:
            error = ctypes.get_last_error()
            if error != ERROR_PIPE_CONNECTED:
                print("PKA_WAIT error=%d" % error, flush=True)
                CloseHandle(handle)
                continue
        print("PKA_CLIENT", flush=True)
        session = Session(handle, pid, key, nonce)
        try:
            session.write(KIND["challenge"], nonce)
            while session.read_once():
                pass
        except Exception as error:  # noqa: BLE001 - mock server reports and restarts
            print("PKA_SESSION_END %s" % error, flush=True)
        finally:
            CloseHandle(handle)
        print("PKA_DISCONNECT", flush=True)


def main() -> None:
    pid = int(os.environ.get("PKA_PID", "49001"))
    key = os.environ.get("PKA_KEY", "00112233445566778899aabbccddeeff")
    nonce_hex = os.environ.get("PKA_NONCE", "")
    nonce = bytes.fromhex(nonce_hex) if nonce_hex else secrets.token_bytes(32)
    if len(nonce) < 16 or len(nonce) > 64:
        raise SystemExit("PKA_NONCE must be 16..64 bytes")
    try:
        serve(pid, key, nonce)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
