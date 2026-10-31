import sys
from pathlib import Path

sys.path.insert(0, str(Path(r"C:\Users\yago\Documents\Clone\RECONSTRUÇAO OFIcial\tools")))
import scan_creatures as sc
import pointer_scan_entities as pe

pid = 25492
handle = sc.k32.OpenProcess(sc.PROCESS_QUERY_INFORMATION | sc.PROCESS_VM_READ, False, pid)
if not handle:
    print("OpenProcess failed")
    sys.exit(1)

try:
    va = 0x1e6021f8b30 # gameRootPanel
    buf = sc.read_mem(handle, va, 0x180)
    import struct
    # Let's inspect fields of gameRootPanel
    # Rect is usually m_rect: x, y, width, height (int32)
    for off in range(0, 0x180, 4):
        val = struct.unpack_from("<i", buf, off)[0]
        if val in (800, 640, 1920, 1080, 1009):
            print(f"Possible dimension at +0x{off:02x}: {val}")
            
    # Search for pointers to children
    for off in range(0, 0x100, 8):
        ptr = struct.unpack_from("<Q", buf, off)[0]
        if 0x1e000000000 <= ptr <= 0x1ffffffffff:
            # check if it points to a widget
            head = sc.read_mem(handle, ptr, 64)
            if head:
                name = head[32:64].split(b"\x00")[0]
                if name:
                    print(f"Child/Ref at +0x{off:02x} -> {hex(ptr)}: {name}")
finally:
    sc.k32.CloseHandle(handle)
