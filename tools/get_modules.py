import ctypes, struct
from ctypes import wintypes

PROCESS_ALL_ACCESS = 0x1F0FFF
PROCESS_VM_READ = 0x0010
PROCESS_QUERY_INFORMATION = 0x0400
pid = 27964

k32 = ctypes.WinDLL('kernel32', use_last_error=True)
psapi = ctypes.WinDLL('psapi', use_last_error=True)

hProcess = k32.OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, False, pid)

class MODULEINFO(ctypes.Structure):
    _fields_ = [
        ('lpBaseOfDll', ctypes.c_void_p),
        ('SizeOfImage', wintypes.DWORD),
        ('EntryPoint', ctypes.c_void_p),
    ]

hMods = (wintypes.HMODULE * 1024)()
cbNeeded = wintypes.DWORD()
if psapi.EnumProcessModules(hProcess, hMods, ctypes.sizeof(hMods), ctypes.byref(cbNeeded)):
    nMods = int(cbNeeded.value / ctypes.sizeof(wintypes.HMODULE))
    modName = (ctypes.c_char * 260)()
    for i in range(nMods):
        hMod = hMods[i]
        psapi.GetModuleBaseNameA(hProcess, hMod, modName, ctypes.sizeof(modName))
        name = modName.value.decode('utf-8', errors='ignore')
        if 'PokeAlliance' in name or i == 0:
            mi = MODULEINFO()
            psapi.GetModuleInformation(hProcess, hMod, ctypes.byref(mi), ctypes.sizeof(mi))
            print(f'Main Module: {name} Base: 0x{mi.lpBaseOfDll:x} Size: 0x{mi.SizeOfImage:x}')
