"""Module string/xref/disasm helper for PokeAlliance_dx.exe (read-only).

Finds a needle in the module image, then scans .text for RIP-relative `lea`
instructions that reference the needle's VA, and can disassemble a range of
code with capstone. Used to anchor non-polymorphic globals (e.g. `g_minimap`,
`g_map`) that have no RTTI.

Usage:
  python tools/find_module_xrefs.py --pid 8456 --needle minimap
  python tools/find_module_xrefs.py --pid 8456 --needle ".otmm"
  python tools/find_module_xrefs.py --pid 8456 --disasm 0x7ff7c6xxxxxx --length 0x80
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scan_creatures as sc
import pointer_scan_entities as pe
import otclient_rtti as rtti

try:
    import capstone
except ImportError:  # pragma: no cover
    capstone = None


def find_needles(image: bytes, needle: bytes):
    out = []
    start = 0
    while True:
        index = image.find(needle, start)
        if index < 0:
            return out
        out.append(index)
        start = index + 1


def sections(image: bytes, base: int):
    """PE section table: list of (name, va_lo, va_hi, characteristics)."""
    e_lfanew = struct.unpack_from("<I", image, 0x3C)[0]
    count = struct.unpack_from("<H", image, e_lfanew + 6)[0]
    size_opt = struct.unpack_from("<H", image, e_lfanew + 20)[0]
    table = e_lfanew + 24 + size_opt
    out = []
    for i in range(count):
        off = table + i * 40
        name = image[off:off + 8].rstrip(b"\x00").decode("latin1")
        vsize = struct.unpack_from("<I", image, off + 8)[0]
        vaddr = struct.unpack_from("<I", image, off + 12)[0]
        chars = struct.unpack_from("<I", image, off + 36)[0]
        out.append((name, base + vaddr, base + vaddr + vsize, chars))
    return out


def section_of(secs, va: int):
    for name, lo, hi, chars in secs:
        if lo <= va < hi:
            return name, chars
    return None, None


def text_range(image: bytes, base: int):
    for name, lo, hi, _ in sections(image, base):
        if name == ".text":
            return lo, hi
    return None, None


def vtable_globals(handle, image: bytes, base: int, vtable_va: int, entries: int, length: int):
    """Disassemble vtable entries; report RIP-relative lea targets outside .text."""
    if capstone is None:
        return []
    secs = sections(image, base)
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    out = []
    for slot in range(entries):
        raw = sc.read_mem(handle, vtable_va + slot * 8, 8)
        if not raw:
            break
        func = struct.unpack_from("<Q", raw, 0)[0]
        if not func:
            break
        code = sc.read_mem(handle, func, length) or b""
        targets = {}
        for ins in md.disasm(code, func):
            if ins.mnemonic != "lea" or len(ins.operands) < 2:
                continue
            mem = ins.operands[1]
            if mem.type != capstone.x86.X86_OP_MEM or mem.mem.base != capstone.x86.X86_REG_RIP:
                continue
            eff = ins.address + ins.size + mem.mem.disp
            name, chars = section_of(secs, eff)
            if name and name != ".text":
                targets.setdefault(eff, name)
        out.append({"slot": slot, "func": hex(func),
                    "globals": [{"va": hex(v), "section": n} for v, n in targets.items()]})
    return out


def lea_xrefs(image: bytes, base: int, target_va: int, text_lo: int, text_hi: int):
    """Find lea r64,[rip+disp32] (48/4C 8D, modrm & 0xC7 == 0x05) whose EA == target_va.

    Byte-pattern scan instead of a linear disassembly pass, which would desync
    on the data blocks embedded in .text.
    """
    lo = text_lo - base
    hi = text_hi - base
    hits = []
    i = lo
    end = hi - 7
    while i < end:
        if (image[i] == 0x48 or image[i] == 0x4C) and image[i + 1] == 0x8D and (image[i + 2] & 0xC7) == 0x05:
            disp = struct.unpack_from("<i", image, i + 3)[0]
            eff = base + i + 7 + disp
            if eff == target_va:
                hits.append(hex(base + i))
            i += 7
        else:
            i += 1
    return hits


def disasm(handle, va: int, length: int):
    if capstone is None:
        return ["capstone not installed"]
    data = sc.read_mem(handle, va, length) or b""
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    lines = []
    for ins in md.disasm(data, va):
        lines.append(f"{ins.address:#x}  {ins.mnemonic:<7} {ins.op_str}")
    return lines


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Module string/xref/disasm helper")
    parser.add_argument("--pid", type=int, default=None)
    parser.add_argument("--process-name", default=sc.IMAGE_NAME)
    parser.add_argument("--needle", default=None)
    parser.add_argument("--disasm", type=lambda t: int(t, 0), default=None)
    parser.add_argument("--length", type=lambda t: int(t, 0), default=0x80)
    parser.add_argument("--vtable", type=lambda t: int(t, 0), default=None)
    parser.add_argument("--entries", type=int, default=12)
    parser.add_argument("--limit", type=int, default=8)
    args = parser.parse_args(argv)

    pid = args.pid or sc.find_pid_by_name(args.process_name)
    if pid is None:
        print(json.dumps({"error": "process not found"}))
        return 2
    handle = sc.k32.OpenProcess(sc.PROCESS_QUERY_INFORMATION | sc.PROCESS_VM_READ, False, pid)
    if not handle:
        print(json.dumps({"error": "OpenProcess failed", "pid": pid}))
        return 3
    try:
        if args.disasm is not None:
            for line in disasm(handle, args.disasm, args.length):
                print(line)
            return 0
        module = next(m for m in pe.enum_modules(pid)
                      if m["name"].lower() == args.process_name.lower())
        image = rtti.read_module_image(handle, module["base"], module["size"])
        base = module["base"]
        if args.vtable is not None:
            report = {"pid": pid, "vtable": hex(args.vtable),
                      "entries": vtable_globals(handle, image, base, args.vtable, args.entries, args.length)}
            print(json.dumps(report, indent=2))
            return 0
        text_lo, text_hi = text_range(image, base)
        report = {"pid": pid, "module_base": hex(base), "needle": args.needle,
                  "text": [hex(text_lo), hex(text_hi)] if text_lo else None, "hits": []}
        for rva in find_needles(image, args.needle.encode()):
            va = base + rva
            report["hits"].append({"rva": hex(rva), "va": hex(va), "xrefs": lea_xrefs(image, base, va, text_lo, text_hi)})
        report["hits"] = report["hits"][: args.limit]
        print(json.dumps(report, indent=2))
    finally:
        sc.k32.CloseHandle(handle)
    return 0


if __name__ == "__main__":
    sys.exit(main())
