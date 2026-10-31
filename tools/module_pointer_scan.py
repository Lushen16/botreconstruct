import ctypes, struct
from ctypes import wintypes

PROCESS_VM_READ = 0x0010
PROCESS_QUERY_INFORMATION = 0x0400
pid = 27964
module_base = 0x7ff716620000
module_size = 61468672 # ~58.6 MB
target_va = 0x1f8de6a3b30

k32 = ctypes.WinDLL('kernel32', use_last_error=True)
hProcess = k32.OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, False, pid)

buf = (ctypes.c_char * module_size)()
nread = ctypes.c_size_t()
if k32.ReadProcessMemory(hProcess, ctypes.c_void_p(module_base), buf, module_size, ctypes.byref(nread)):
    raw = bytes(buf[:nread.value])
    target_bytes = struct.pack('<Q', target_va)
    idx = 0
    direct = []
    while True:
        idx = raw.find(target_bytes, idx)
        if idx == -1:
            break
        direct.append(module_base + idx)
        idx += 8
    print(f'Direct pointers from main module to 0x{target_va:x}: {len(direct)}')
    for d in direct:
        print(f'  [PokeAlliance_dx.exe + 0x{d - module_base:x}] -> 0x{target_va:x}')
