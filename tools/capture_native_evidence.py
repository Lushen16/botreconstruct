import hashlib
import json
import struct

from analyze_capture_native import ROOT, IMAGE_BASE, TEXT_RVA, EXPECTED_SHA256, analyze


def make_evidence():
    content = (ROOT / 'dumps/msftedit_text_32336.bin').read_bytes()
    if hashlib.sha256(content).hexdigest() != EXPECTED_SHA256:
        raise ValueError('Native dump identity changed')

    def read(rva, length):
        offset = rva - TEXT_RVA
        if offset < 0 or offset + length > len(content):
            raise ValueError('Read outside recorded dump')
        return content[offset:offset + length]

    def rtti(vtable, expected):
        col = struct.unpack('<Q', read(vtable - 8, 8))[0] - IMAGE_BASE
        signature, _, _, descriptor, _, self_rva = struct.unpack('<6I', read(col, 24))
        if signature != 1 or self_rva != col:
            raise ValueError('Invalid x64 RTTI locator')
        name_rva = descriptor + 16
        name = read(name_rva, 1800).split(b'\0')[0].decode('ascii')
        if expected not in name:
            raise ValueError('RTTI method mismatch')
        return {'vtable_rva': hex(vtable), 'locator_rva': hex(col),
                'locator_bytes': read(col, 24).hex(), 'type_descriptor_rva': hex(descriptor),
                'name_rva': hex(name_rva), 'name': name,
                'slots': [hex(struct.unpack('<Q', read(vtable + index * 8, 8))[0] - IMAGE_BASE)
                          for index in range(6)]}

    def descriptor(rva):
        pointer, length, seed, arity = struct.unpack('<QQII', read(rva, 24))
        encoded = read(pointer - IMAGE_BASE, length)
        decoded = bytearray()
        for index, byte in enumerate(encoded):
            mixed = (seed - index * 0x61C88647) & 0xFFFFFFFF
            mixed = ((mixed ^ (mixed >> 16)) * 0x85EBCA6B) & 0xFFFFFFFF
            decoded.append(byte ^ ((mixed >> 13) & 255) ^ (mixed & 255))
        return {'descriptor_rva': hex(rva), 'descriptor_bytes': read(rva, 24).hex(),
                'code_rva': hex(pointer - IMAGE_BASE), 'length': length, 'seed': seed,
                'arity': arity, 'encoded_hex': encoded.hex(), 'decoded_hex': decoded.hex()}

    ranges = [(0xA46E0, 0xA60C4), (0x4A880, 0x4AD58), (0x84340, 0x848E2),
              (0x5D0F0, 0x5D210), (0x60A20, 0x61130), (0x46D70, 0x46DCC),
              (0x4E440, 0x4E45B)]
    instructions = {row['rva']: row for start, end in ranges for row in analyze(start, end)['instructions']}
    anchors = {
        'items': 0xA4BE2, 'fresh_attempts': 0xA4FD1, 'fresh_failures': 0xA4FD8,
        'fresh_compare': 0xA5020, 'attempt_time': 0xA5029, 'older_time': 0xA50E6,
        'rank_descriptor': 0xA50B4, 'rank_vm_call': 0xA50C2, 'replace_best': 0xA50F1,
        'distance_max': 0x5D1E5, 'range_descriptor': 0xA4EC0,
        'payload_position': 0xA54EB, 'payload_item_id': 0xA5553,
        'payload_target_id': 0xA55B1, 'payload_target_key': 0xA55ED,
        'payload_stack': 0xA5640, 'loot_closure': 0xA56D5,
        'use_with': 0xA575B, 'dispatch_argument_300': 0xA577E, 'send_call': 0xA57AD,
        'clock_call': 0xA57C5, 'write_attempt_time': 0xA57C8, 'write_cooldown': 0xA57D1,
        'failure_increment': 0xA57E6, 'attempt_increment': 0xA58F6, 'failure_reset': 0xA58FD,
        'guard_id': 0x4AA36, 'guard_stack': 0x4AA6F, 'guard_distance': 0x4AAE0,
        'guard_zero': 0x4AAE5, 'guard_key': 0x4AB04, 'guard_key_compare': 0x4AB41,
        'send_closure': 0x84522, 'dispatch_service': 0x845FD, 'dispatch_virtual_call': 0x8461A,
        'guard_thunk_call': 0x4E44D,
        'instance_key': 0x46D9D, 'vm_seed': 0x60B3D, 'vm_mix_multiply': 0x60B5D,
        'vm_stack_right': 0x60C0E, 'vm_stack_left': 0x60C1E,
        'vm_less': 0x60CA0, 'vm_less_set': 0x60CA7, 'vm_less_equal': 0x60CB4,
        'vm_equal': 0x60CC8, 'vm_and': 0x60CD5, 'vm_or': 0x60CDF,
        'vm_load_gate': 0x60B6D, 'vm_return_gate': 0x60B7D,
    }
    return {
        'source': 'dumps/msftedit_text_32336.bin', 'sha256': EXPECTED_SHA256,
        'image_base': hex(IMAGE_BASE), 'text_rva': hex(TEXT_RVA),
        'coordinate_rule': 'file offset = RVA - 0x1000; VA = image_base + RVA',
        'authority': 'derived-static-dump', 'target_executed': False,
        'identities': {'tickLoot': rtti(0xEB750, '??tickLoot@Runtime'),
                       'send': rtti(0xEB520, '??send@Runtime')},
        'anchors': {label: instructions[hex(rva)] for label, rva in anchors.items()},
        'predicates': [descriptor(rva) for rva in (0xE6368, 0xE6380, 0xE6398)],
        'binary_opcode_targets': {
            hex(opcode): hex(struct.unpack('<I', read(0x61130 + read(0x61164 + opcode - 1, 1)[0] * 4, 4))[0])
            for opcode in (0x01, 0x8C, 0x49, 0x48, 0x42)},
        'rank': {'history_offsets': {'lastAttemptAt': '0x0', 'lastSeenAt': '0x8',
                                     'attempts': '0x10', 'failures': '0x14'},
                 'order': ['attempts == 0 && failures < 3 (true first)',
                           'lastAttemptAt ascending', 'Chebyshev distance ascending',
                           'item.stack descending', 'original items iteration order'],
                 'domain': 'Already eligible candidates, finite numeric distances/times; internal history, not telemetry JSON.'},
        'dispatch': {'method': 'useWith', 'send_rva': '0x84340',
                     'argument_300': 'Fourth trailing uint32 argument to send; unit/meaning unresolved.',
                     'payload': 'Copy corpse.pos; itemId = chosen ball; targetId = corpse.id; stack = corpse.stack.',
                     'boundary': 'call [vtable + 0x10] on [Runtime + 0x78] at RVA 0x8461a'},
        'limitations': [
            'RTTI proves method context of constructed closures, not original source or global binary identity.',
            'Rank covers the deterministic candidate comparison, not random capture mode or upstream eligibility.',
            'No direct route/adjacency gate is established here; absence of a direct call does not exclude downstream navigation.',
            'Final client implementation behind the dispatch virtual call remains unresolved.',
            'Fallback item key uses a position hash whose semantics have not been reconstructed; require a supplied key resolver.',
            'No live capture action, server result, ACK lifecycle or native timing equivalence is claimed.'
        ]}


if __name__ == '__main__':
    evidence = make_evidence()
    (ROOT / 'native_capture_evidence.json').write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'anchors': len(evidence['anchors']), 'predicates': len(evidence['predicates']),
                      'sha256': evidence['sha256']}))
