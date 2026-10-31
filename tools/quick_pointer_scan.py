import ctypes, struct
from ctypes import wintypes

PROCESS_VM_READ = 0x0010
PROCESS_QUERY_INFORMATION = 0x0400
pid = 27964
target_va = 0x1f8de6a3b30
target_bytes = struct.pack('<Q', target_va)

k32 = ctypes.WinDLL('kernel32', use_last_error=True)
OpenProcess = k32.OpenProcess
OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
OpenProcess.restype = wintypes.HANDLE

VirtualQueryEx = k32.VirtualQueryEx
ReadProcessMemory = k32.ReadProcessMemory

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

hProcess = OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, False, pid)
if not hProcess:
    print('Failed to open process')
    exit(1)

mbi = MEMORY_BASIC_INFORMATION64()
address = 0
found = []
MEM_COMMIT = 0x1000

while VirtualQueryEx(hProcess, ctypes.c_void_p(address), ctypes.byref(mbi), ctypes.sizeof(mbi)):
    if mbi.State == MEM_COMMIT and (mbi.Protect & 0xEE) != 0 and (mbi.Protect & 0x101) == 0:
        size = mbi.RegionSize
        base = mbi.BaseAddress
        buf = (ctypes.c_char * size)()
        nread = ctypes.c_size_t()
        if ReadProcessMemory(hProcess, ctypes.c_void_p(base), buf, size, ctypes.byref(nread)):
            raw = bytes(buf[:nread.value])
            idx = 0
            while True:
                idx = raw.find(target_bytes, idx)
                if idx == -1:
                    break
                found_va = base + idx
                found.append((found_va, mbi.Type, mbi.Protect))
                idx += 8
    address = mbi.BaseAddress + mbi.RegionSize
    if address >= 0x7FFFFFFFFFFF:
        break

print(f'Pointers found pointing to 0x{target_va:x}: {len(found)}')
for fva, mtype, prot in found[:30]:
    print(f'  0x{fva:016x} (type=0x{mtype:x}, prot=0x{prot:x})')
