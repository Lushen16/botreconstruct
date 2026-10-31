import argparse
import hashlib
import json
import re
import struct
import sys

sys.dont_write_bytecode = True
from analyze_capture_native import ROOT, IMAGE_BASE, TEXT_RVA, EXPECTED_SHA256, analyze


CONTENT = (ROOT / 'dumps/msftedit_text_32336.bin').read_bytes()
if hashlib.sha256(CONTENT).hexdigest() != EXPECTED_SHA256:
    raise ValueError('Native dump identity changed')


def read(rva, length):
    offset = rva - TEXT_RVA
    if offset < 0 or offset + length > len(CONTENT):
        raise ValueError('Outside dump')
    return CONTENT[offset:offset + length]


def occurrences(needle):
    position = CONTENT.find(needle)
    while position >= 0:
        yield position + TEXT_RVA
        position = CONTENT.find(needle, position + 1)


def references(target, calls=False):
    found = []
    expression = rb'\xe8' if calls else rb'[\x48\x4c]\x8d[\x05\x0d\x15\x1d\x25\x2d\x35\x3d]'
    length = 5 if calls else 7
    for match in re.finditer(expression, CONTENT[:0xD5000]):
        position = match.start()
        destination = position + TEXT_RVA + length + struct.unpack_from('<i', CONTENT, position + length - 4)[0]
        if destination == target:
            found.append(hex(position + TEXT_RVA))
    return found


def identities():
    result = []
    for match in re.finditer(rb'\.\?AV[^\x00]{1,1800}\x00', CONTENT):
        name = match.group()[:-1].decode('ascii', errors='replace')
        if not any('??' + method + '@Runtime' in name for method in ('tick', 'tickLoot', 'tickHoenn', 'tickBestTile', 'tickTravelLure', 'comboTick', 'tickRevive')):
            continue
        descriptor = match.start() + TEXT_RVA - 16
        locators = []
        for pointer in occurrences(struct.pack('<I', descriptor)):
            locator = pointer - 12
            values = struct.unpack('<6I', read(locator, 24))
            if values[0] != 1 or values[5] != locator:
                continue
            for table_pointer in occurrences(struct.pack('<Q', IMAGE_BASE + locator)):
                table = table_pointer + 8
                slots = [hex(struct.unpack('<Q', read(table + index * 8, 8))[0] - IMAGE_BASE) for index in range(6)]
                locators.append({'col': hex(locator), 'vtable': hex(table), 'slots': slots, 'lea_references': references(table)})
        result.append({'type_descriptor': hex(descriptor), 'name': name, 'locators': locators})
    return result


def display(start, end):
    for row in analyze(start, end)['instructions']:
        suffix = ' ; ' + row['string_candidate'] if 'string_candidate' in row else ''
        print(row['rva'], row['bytes'].ljust(28), row['mnemonic'].ljust(8), row['operands'] + suffix)


def runtime_functions():
    anchor = next(occurrences(struct.pack('<III', 0xA46E0, 0xA6114, 0x215B6C)))
    start, end = anchor, anchor + 12
    def valid(address):
        begin, finish, unwind = struct.unpack('<III', read(address, 12))
        return 0x1000 <= begin < finish < 0xD5000 and 0x200000 < unwind < 0x220000
    while valid(start - 12):
        start -= 12
    while valid(end):
        end += 12
    return [{'table_rva': hex(address), 'start': hex(begin), 'end': hex(finish), 'unwind': hex(unwind)}
            for address in range(start, end, 12)
            for begin, finish, unwind in [struct.unpack('<III', read(address, 12))]]


def containing(address):
    return [row for row in runtime_functions() if int(row['start'], 16) <= address < int(row['end'], 16)]


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['identities', 'disasm', 'calls', 'refs', 'strings', 'function'])
    parser.add_argument('values', nargs='*')
    arguments = parser.parse_args()
    if arguments.mode == 'identities':
        print(json.dumps(identities(), indent=2))
    elif arguments.mode == 'disasm':
        display(*(int(value, 0) for value in arguments.values))
    elif arguments.mode in ('calls', 'refs'):
        print(json.dumps({value: references(int(value, 0), arguments.mode == 'calls') for value in arguments.values}, indent=2))
    elif arguments.mode == 'strings':
        for value in arguments.values:
            print(value, [hex(address) for address in occurrences(value.encode() + b'\0')])
    elif arguments.mode == 'function':
        for value in arguments.values:
            address = int(value, 0)
            print(value, containing(address))
