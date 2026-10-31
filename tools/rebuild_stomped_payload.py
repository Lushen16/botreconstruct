"""Reconstruct a clean PE image of a module-stomped payload.

The automation payload lives inside msftedit.dll's loaded image (PID 32336):
its .text section is replaced by payload code, while .rdata/.data/.pdata/
.didat/.rsrc/.reloc stay (nearly) identical to the on-disk DLL. The header
is zeroed, so the original PE identity is gone.

This tool rebuilds a loadable PE for the payload by taking the on-disk
msftedit.dll as template and overwriting its .text with the dumped payload
bytes. Imports, section table and characteristics are inherited from the
template. The .reloc directory is cleared by default so a loader never
applies the template's stale relocations over payload bytes.

Read-only against the target; only reads dumps and the on-disk DLL.
Usage:
  python tools/rebuild_stomped_payload.py \
      --disk C:/Windows/System32/msftedit.dll \
      --memory dumps/pid32336_msftedit.dll.memory.bin \
      --base 0x7ff85c470000 --entry 0x15590 \
      --out dumps/payload_reconstructed.dll
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import struct
import sys

import pefile

from dump_stomped_module import apply_relocations, disk_image


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def section_bounds(pe: pefile.PE, name: str):
    for section in pe.sections:
        if section.Name.rstrip(b"\x00").decode("latin1") == name:
            return section.VirtualAddress, section.Misc_VirtualSize
    return None


def rebased_disk(pe: pefile.PE, base: int) -> bytearray:
    """Disk image rebased to the observed load base (relocs applied)."""
    image = disk_image(pe)
    apply_relocations(pe, image, base - pe.OPTIONAL_HEADER.ImageBase)
    return image


def rebuild(disk: str, memory: str, base: int, entry: int, out: str,
            keep_relocs: bool) -> dict:
    pe = pefile.PE(disk)
    disk_bytes = open(disk, "rb").read()
    mem = open(memory, "rb").read()
    o = pe.OPTIONAL_HEADER

    text_va, text_vsz = section_bounds(pe, ".text")
    if text_va is None:
        raise SystemExit("template has no .text section")
    text_section = pe.sections[0] if pe.sections and pe.sections[0].Name.rstrip(b"\x00").decode("latin1") == ".text" else None
    for section in pe.sections:
        if section.Name.rstrip(b"\x00").decode("latin1") == ".text":
            text_section = section
            break
    if text_section is None:
        raise SystemExit("template has no .text section")
    raw_ptr = text_section.PointerToRawData
    raw_sz = text_section.SizeOfRawData
    text_slice = mem[text_va:text_va + raw_sz]
    if len(text_slice) != raw_sz:
        raise SystemExit(f".text slice short: {len(text_slice)} != {raw_sz}")

    image = bytearray(disk_bytes)
    image[raw_ptr:raw_ptr + raw_sz] = text_slice

    e_lfanew = struct.unpack_from("<I", image, 0x3C)[0]
    magic = struct.unpack_from("<H", image, e_lfanew + 24)[0]
    if magic != 0x20B:
        raise SystemExit(f"template magic {magic:#x}; expected PE32+")
    opt = e_lfanew + 24
    struct.pack_into("<Q", image, opt + 24, base)      # ImageBase
    struct.pack_into("<I", image, opt + 16, entry)     # AddressOfEntryPoint
    struct.pack_into("<I", image, opt + 68, 0)         # Checksum

    changed_rdata = changed_data = 0
    for section in pe.sections:
        name = section.Name.rstrip(b"\x00").decode("latin1")
        if name not in (".rdata", ".data"):
            continue
        ra = section.PointerToRawData
        rw = section.SizeOfRawData
        dmem = mem[ra:ra + rw]
        dsrc = disk_bytes[ra:ra + rw]
        if name == ".rdata":
            changed_rdata = sum(1 for a, b in zip(dsrc, dmem) if a != b)
        else:
            changed_data = sum(1 for a, b in zip(dsrc, dmem) if a != b)

    if not keep_relocs:
        for index in range(pe.OPTIONAL_HEADER.NumberOfRvaAndSizes):
            rva, size = struct.unpack_from("<II", image, opt + 112 + index * 8)
            if index == 5:  # BaseReloc
                struct.pack_into("<II", image, opt + 112 + index * 8, 0, 0)
            if index == 11:  # LoadConfig pointer cleanup
                struct.pack_into("<II", image, opt + 112 + index * 8, 0, 0)
            _ = (rva, size)

    with open(out, "wb") as handle:
        handle.write(image)

    rebuilt = pefile.PE(out)
    section_rows = []
    for section in rebuilt.sections:
        section_rows.append({
            "name": section.Name.rstrip(b"\x00").decode("latin1"),
            "virtualAddress": section.VirtualAddress,
            "virtualSize": section.Misc_VirtualSize,
            "rawSize": section.SizeOfRawData,
            "characteristics": hex(section.Characteristics),
        })

    report = {
        "tool": "tools/rebuild_stomped_payload.py",
        "template_disk": os.path.abspath(disk),
        "template_sha256": sha256(disk_bytes),
        "memory_dump": os.path.abspath(memory),
        "memory_sha256": sha256(mem),
        "base": hex(base),
        "entry": hex(entry),
        "out": os.path.abspath(out),
        "out_sha256": sha256(image),
        "size_of_image": hex(o.SizeOfImage),
        "text_raw_slice_hash": sha256(bytes(text_slice)),
        "text_expected_hash": "7c0fd219dc24f3fa273ded518eca8ea840d3395f00d14e78beacb4ffd7c50ea4",
        "text_matches_expected": sha256(bytes(text_slice)) ==
            "7c0fd219dc24f3fa273ded518eca8ea840d3395f00d14e78beacb4ffd7c50ea4",
        "rdata_template_diff_bytes": changed_rdata,
        "data_template_diff_bytes": changed_data,
        "keep_relocs": keep_relocs,
        "sections": section_rows,
        "imports": len(rebuilt.DIRECTORY_ENTRY_IMPORT)
            if hasattr(rebuilt, "DIRECTORY_ENTRY_IMPORT") else 0,
        "image_base_rebuilt": hex(rebuilt.OPTIONAL_HEADER.ImageBase),
        "entry_rebuilt": hex(rebuilt.OPTIONAL_HEADER.AddressOfEntryPoint),
        "limitations": [
            "Payload identity (original name/base) is unrecoverable: header is zeroed.",
            "Absolute references inside .text assume load base = observed base; rehost at that base or patch them.",
            "No PDB/symbols; function addresses are candidates from static analysis.",
            "Rebuilt image is analysis/rehost material, not proof of original file identity.",
        ],
    }
    evidence_path = out + ".evidence.json"
    with open(evidence_path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--disk", required=True)
    parser.add_argument("--memory", required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--entry", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--keep-relocs", action="store_true")
    args = parser.parse_args()

    report = rebuild(args.disk, args.memory, int(args.base, 16),
                     int(args.entry, 16), args.out, args.keep_relocs)
    print(json.dumps({k: report[k] for k in (
        "base", "entry", "out_sha256", "text_matches_expected",
        "rdata_template_diff_bytes", "data_template_diff_bytes", "imports",
        "image_base_rebuilt", "entry_rebuilt")}, indent=2))
    print("evidence:", args.out + ".evidence.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
