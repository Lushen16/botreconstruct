import ctypes, struct
from ctypes import wintypes

PROCESS_VM_READ = 0x0010
PROCESS_QUERY_INFORMATION = 0x0400
pid = 27964
module_base = 0x7ff716620000
module_size = 61468672 # ~58.6 MB
target_va = 0x1f8de6a3b30
target_bytes = struct.pack('<Q', target_va)

k32 = ctypes.WinDLL('kernel32', use_last_error=True)
hProcess = k32.OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, False, pid)

class MEMORY_BASIC_INFORMATION64(ctypes.Structure):
    _fields_ = [
        ('BaseAddress', ctypes.c_uint64),
        ('AllocationBase', ctypes.c_uint64),
        ('AllocationProtect', wintypes.DWORD),
        ('Alignment1', wintypes.DWORD),
        ('RegionSize', ctypes.c_uint64),
        ('State', wintypes.DWORD),
        ('Protect', wintypes.DWORD),
        ('Type', wintypes.DWORD),
        ('Alignment2', wintypes.DWORD),
    ]

# Level 1: Find all pointers to target_va
mbi = MEMORY_BASIC_INFORMATION64()
address = 0
level1 = set()
MEM_COMMIT = 0x1000

while k32.VirtualQueryEx(hProcess, ctypes.c_void_p(address), ctypes.byref(mbi), ctypes.sizeof(mbi)):
    if mbi.State == MEM_COMMIT and (mbi.Protect & 0xEE) != 0 and (mbi.Protect & 0x101) == 0:
        size = mbi.RegionSize
        base = mbi.BaseAddress
        buf = (ctypes.c_char * size)()
        nread = ctypes.c_size_t()
        if k32.ReadProcessMemory(hProcess, ctypes.c_void_p(base), buf, size, ctypes.byref(nread)):
            raw = bytes(buf[:nread.value])
            idx = 0
            while True:
                idx = raw.find(target_bytes, idx)
                if idx == -1:
                    break
                level1.add(base + idx)
                idx += 8
    address = mbi.BaseAddress + mbi.RegionSize
    if address >= 0x7FFFFFFFFFFF:
        break

print(f'Level 1 pointers count: {len(level1)}')

# Read main module raw memory
mod_buf = (ctypes.c_char * module_size)()
nread = ctypes.c_size_t()
if k32.ReadProcessMemory(hProcess, ctypes.c_void_p(module_base), mod_buf, module_size, ctypes.byref(nread)):
    mod_raw = bytes(mod_buf[:nread.value])
    # For each level 1 pointer, check if module points to it directly (offset 0) or nearby (offset 0..0x200)
    found_paths = []
    for l1 in level1:
        # Check direct
        l1_bytes = struct.pack('<Q', l1)
        idx = 0
        while True:
            idx = mod_raw.find(l1_bytes, idx)
            if idx == -1:
                break
            found_paths.append((idx, 0, l1))
            idx += 8

    print(f'Direct 2-level paths from module: {len(found_paths)}')
    for mod_off, l1_off, l1 in found_paths[:10]:
        print(f'  [PokeAlliance_dx.exe + 0x{mod_off:x}] -> [0x{l1:x}] -> target')
