"""Read-only UI string discovery; observations are not an ownership contract."""

import argparse
import json
import struct

import otclient_rtti as rtti
import pointer_scan_entities as pe
import scan_creatures as sc


def strings_at(handle, data):
    observations = []
    for offset in range(0, len(data) - 31, 8):
        length, capacity = struct.unpack_from("<QQ", data, offset + 16)
        if not 1 <= length <= 256 or not length <= capacity <= 4096:
            continue
        if capacity < 16:
            if length > 15:
                continue
            raw = data[offset:offset + length]
        else:
            pointer = struct.unpack_from("<Q", data, offset)[0]
            raw = sc.read_mem(handle, pointer, length)
        if raw and len(raw) == length and all(32 <= value < 127 for value in raw):
            observations.append({"offset": hex(offset), "text": raw.decode("ascii")})
    return observations


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--class", dest="class_name", default="UILabel")
    args = parser.parse_args()
    handle = sc.k32.OpenProcess(sc.PROCESS_QUERY_INFORMATION | sc.PROCESS_VM_READ, False, args.pid)
    if not handle:
        raise OSError("OpenProcess failed")
    try:
        module = next(entry for entry in pe.enum_modules(args.pid) if entry["name"].lower() == sc.IMAGE_NAME.lower())
        image = rtti.read_module_image(handle, module["base"], module["size"])
        resolved = rtti.resolve_class(image, module["base"], args.class_name)
        if not resolved:
            raise ValueError("Class RTTI unresolved")
        print(json.dumps({"pid": args.pid, "class": args.class_name, "resolved": resolved}), flush=True)
        for address in rtti.scan_instances(handle, resolved["vtable"]):
            data = sc.read_mem(handle, address, 0x780)
            if data:
                print(json.dumps({"address": hex(address), "strings": strings_at(handle, data),
                                  "bytes": data.hex()}), flush=True)
    finally:
        sc.k32.CloseHandle(handle)


if __name__ == "__main__":
    main()
