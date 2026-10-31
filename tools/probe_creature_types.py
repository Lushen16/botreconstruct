"""Record live RTTI-backed Creature objects and candidate type bytes, read-only."""

import argparse
import datetime
import hashlib
import json
import struct

import capstone
import otclient_rtti as rtti
import pointer_scan_entities as pe
import scan_creatures as sc


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    handle = sc.k32.OpenProcess(sc.PROCESS_QUERY_INFORMATION | sc.PROCESS_VM_READ, False, args.pid)
    if not handle:
        raise OSError("OpenProcess failed")
    try:
        module = next(entry for entry in pe.enum_modules(args.pid) if entry["name"].lower() == sc.IMAGE_NAME.lower())
        image = rtti.read_module_image(handle, module["base"], module["size"])
        report = {"pid": args.pid, "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  "module": {**module, "base": hex(module["base"])}, "classes": {}, "code": []}
        with open(sc.image_for_pid(handle), "rb") as executable:
            report["executableSha256"] = hashlib.file_digest(executable, "sha256").hexdigest()
        disassembler = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
        for relative, length in ((0x3F27F0, 64), (0x3F3A60, 80), (0x790E10, 160)):
            report["code"].append({"rva": hex(relative), "bytes": image[relative:relative + length].hex(),
                                   "assembly": [entry.mnemonic + " " + entry.op_str for entry in
                                                disassembler.disasm(image[relative:relative + length], module["base"] + relative)]})
        for class_name in ("LocalPlayer", "Monster"):
            resolved = rtti.resolve_class(image, module["base"], class_name)
            if not resolved:
                raise ValueError("RTTI unresolved: " + class_name)
            rows = []
            for address in rtti.scan_instances(handle, resolved["vtable"]):
                data = sc.read_mem(handle, address - 16, 0x200)
                if not data or len(data) != 0x200:
                    continue
                candidate = sc.extract_candidate(data, 0, address - 16, sc.Layout(), sc.Filters(), {}, "rtti")
                if candidate:
                    rows.append({**candidate, "object": hex(address), "candidateType": data[0x186], "bytes": data.hex()})
            report["classes"][class_name] = {"resolved": resolved, "objects": rows}
        sc.atomic_write_snapshot(args.output, report)
        print(json.dumps({"pid": args.pid, "objects": {key: len(value["objects"]) for key, value in report["classes"].items()}}))
    finally:
        sc.k32.CloseHandle(handle)


if __name__ == "__main__":
    main()
