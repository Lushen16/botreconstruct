import hashlib
import json
import struct

from analyze_capture_native import ROOT, IMAGE_BASE, TEXT_RVA, EXPECTED_SHA256, analyze
from lifecycle_research import identities, containing


def make_evidence():
    content = (ROOT / 'dumps/msftedit_text_32336.bin').read_bytes()
    if hashlib.sha256(content).hexdigest() != EXPECTED_SHA256:
        raise ValueError('Native dump identity changed')

    def read(rva, length):
        offset = rva - TEXT_RVA
        if offset < 0 or offset + length > len(content):
            raise ValueError('Read outside recorded dump')
        return content[offset:offset + length]

    def cstring(rva):
        return read(rva, 1800).split(b'\0')[0].decode('ascii')

    def rtti(vtable, expected):
        locator = struct.unpack('<Q', read(vtable - 8, 8))[0] - IMAGE_BASE
        signature, _, _, descriptor, _, self_rva = struct.unpack('<6I', read(locator, 24))
        if signature != 1 or self_rva != locator:
            raise ValueError('Invalid recorded RTTI locator')
        name = cstring(descriptor + 16)
        if expected not in name:
            raise ValueError('RTTI selector mismatch')
        return {'vtable_rva': hex(vtable), 'locator_rva': hex(locator),
                'locator_bytes': read(locator, 24).hex(), 'type_descriptor_rva': hex(descriptor),
                'name': name, 'slots': [hex(struct.unpack('<Q', read(vtable + index * 8, 8))[0] - IMAGE_BASE)
                                       for index in range(5)]}

    ranges = {
        'send': (0x84340, 0x848E2), 'corrected_compare': (0x85610, 0x85660),
        'compare_thunk': (0xD6E76, 0xD6E7C), 'callback_ctor': (0x3DC20, 0x3E0E0),
        'callback_move': (0x3E0E0, 0x3E25B), 'callback_copy': (0x3E260, 0x3E369),
        'worker_binding': (0xD2570, 0xD28D6), 'worker_send': (0xCFE40, 0xD0A1A),
        'send_function_adapter': (0xC6360, 0xC6384), 'route': (0x7DF00, 0x7F810),
        'path_search': (0x613E0, 0x621E6), 'travel_plan': (0x6F610, 0x71AC0),
        'travel_sides': (0x622B0, 0x62B1C), 'travel_predicate': (0x455C0, 0x4568E),
        'random_window': (0x8ED30, 0x8F00A), 'random_integer': (0x64EA0, 0x64EE5),
        'random_double': (0xC6400, 0xC6487), 'random_word': (0xC5D50, 0xC5F0D),
        'tick': (0x906B0, 0x9272C), 'tick_adapters': (0x4E460, 0x4E73E),
        'travel_tick': (0xAC180, 0xAD314), 'route_adapter': (0x4E400, 0x4E409),
        'module_tick': (0x93C70, 0x96520), 'walker_tick': (0xAD320, 0xAFCE0),
        'random_move_branch': (0xABCFA, 0xABE50), 'best_tile_context': (0x9D9EF, 0x9DAA0),
        'team_context': (0x9B683, 0x9B700), 'ready_context': (0x9D240, 0x9D2D0),
        'buff_context': (0x9FF0A, 0x9FF70), 'plan_adapter': (0x4E3F0, 0x4E3F9),
        'best_tile_tick': (0x92730, 0x93C63), 'best_tile_ctor': (0x2C7B0, 0x2C7E3),
        'best_tile_adapter': (0x4E200, 0x4E224), 'best_tile_preflight': (0x41F00, 0x421C3),
    }
    blocks = {name: analyze(start, end) for name, (start, end) in ranges.items()}
    rows = {row['rva']: row for block in blocks.values() for row in block['instructions']}
    anchor_addresses = {
        'service_pointer': 0x845FD, 'virtual_send': 0x8461A,
        'compare_key': 0x8562C, 'compare_call': 0x85633, 'compare_thunk': 0xD6E76,
        'send_binding_table': 0xD261C, 'send_binding_function': 0xD262B,
        'bundle_copy': 0xD28A9, 'runtime_ctor': 0xD28B4, 'bundle_move': 0x3DC41,
        'send_copy_source': 0x3E2A4, 'send_copy_destination': 0x3E2B5,
        'send_move_source': 0x3E105, 'send_move_destination': 0x3E11D,
        'send_adapter_call': 0xC6378, 'worker_guard': 0xCFEB0,
        'worker_preflight_call': 0xD0343, 'command_parse': 0xD041E,
        'pending_command': 0xD04EA, 'pending_sequence': 0xD0515,
        'route_tiles': 0x7E02B, 'route_walkable': 0x7E0D2,
        'route_creatures': 0x7E269, 'route_validator': 0x7EB06,
        'route_closure': 0x7EE9D, 'route_search': 0x7EF1E,
        'search_distance': 0x61518, 'search_vm': 0x61541, 'search_score_add': 0x61CD5,
        'plan_closure': 0x70FAE, 'plan_sides': 0x7102B,
        'plan_first_percentile': 0x6FF0E, 'plan_first_threshold': 0x6FF15,
        'plan_second_percentile': 0x70246, 'plan_second_threshold': 0x7024B,
        'random_min': 0x8ED5F, 'random_min_default': 0x8ED71,
        'random_min_clamp': 0x8ED89, 'random_max': 0x8ED8C,
        'random_max_default': 0x8ED9E, 'random_max_clamp': 0x8EDB3,
        'random_sample': 0x8EED3, 'random_seconds_to_ms': 0x8EED8,
        'random_deadline': 0x8EEE6, 'integer_callback': 0x64EBB,
        'integer_span': 0x64EBE, 'integer_inclusive': 0x64EC0,
        'integer_scale': 0x64ECF, 'integer_truncate': 0x64ED3, 'integer_offset': 0x64ED7,
        'word_first': 0xC641A, 'word_second': 0xC6428, 'double_scale': 0xC6464,
        'mt_seed_multiplier': 0xD25C7, 'mt_seed_count': 0xD25D9,
        'mt_twist_mask': 0xC5DA5, 'mt_temper_right11': 0xC5EDB,
        'mt_temper_left7': 0xC5EEE, 'mt_temper_left15': 0xC5EFB,
        'mt_temper_right18': 0xC5F02, 'random_move_send': 0xABD5A,
        'random_move_status': 0xABD64, 'travel_route': 0xAC4CE,
        'travel_order_send': 0xAC700, 'travel_ground_send': 0xACB2E,
        'travel_walk_name': 0xACF0B, 'travel_walk_send': 0xACF46,
        'tick_healer_closure': 0x91347, 'tick_module_closure': 0x91634,
        'tick_loot_closure': 0x91EA5, 'tick_walker_closure': 0x9243C,
        'tick_loot_jump': 0x4E697, 'tick_walker_first': 0x4E6CD,
        'tick_walker_second': 0x4E6E2, 'tick_walker_tail': 0x4E729,
        'module_revive_first': 0x9400C, 'module_revive_second': 0x947C0,
        'module_hoenn': 0x95193, 'module_target_candidate': 0x96269,
        'walker_travel_tick': 0xAF2F2, 'walker_route': 0xAF3F6,
        'side_positive': 0x626AC, 'side_negative': 0x626C3,
        'side_best_compare': 0x628D5, 'side_cross_compare': 0x6293C,
        'best_tile_closure_ctor': 0x93B04, 'best_tile_vtable': 0x2C7B8,
        'best_tile_preflight_call': 0x4E20D, 'best_tile_order': 0x93B48,
        'best_tile_send': 0x93B81, 'random_binding_table': 0xD26A6,
    }
    descriptor = struct.unpack('<5I', read(0x21BDD0, 20))
    int_base, _, _, dll_name, iat_base = descriptor
    name_entry = 0x21C2D0
    name_rva = struct.unpack('<Q', read(name_entry, 8))[0]
    index = (name_entry - int_base) // 8
    if iat_base + index * 8 != 0xE2438 or cstring(name_rva + 2) != 'memcmp':
        raise ValueError('Import linkage changed')
    result = {
        'source': 'dumps/msftedit_text_32336.bin', 'sha256': EXPECTED_SHA256,
        'image_base': hex(IMAGE_BASE), 'text_rva': hex(TEXT_RVA),
        'coordinate_rule': 'file offset = RVA - 0x1000; VA = image_base + RVA',
        'target_executed': False, 'live_memory_read': False,
        'authority': 'derived-static-dump', 'blocks': blocks,
        'anchors': {name: rows[hex(address)] for name, address in anchor_addresses.items()},
        'identities': {
            'send_callback': rtti(0x202C58, 'Command@'),
            'route': rtti(0xEB830, '??route@Runtime'),
            'plan': rtti(0xEB4D8, '??plan@TravelLure'),
            'random_double': rtti(0x202D00, '_Func_impl_no_alloc'),
            'best_tile': rtti(0xEB6E0, '??tickBestTile@Runtime'),
        },
        'memcmp_import': {'descriptor_rva': '0x21bdd0', 'descriptor_bytes': read(0x21BDD0, 20).hex(),
                          'int_base_rva': hex(int_base), 'iat_base_rva': hex(iat_base),
                          'name_entry_rva': hex(name_entry), 'index': index,
                          'hint_name_rva': hex(name_rva), 'name': cstring(name_rva + 2),
                          'dll_name_rva': hex(dll_name), 'dll': cstring(dll_name),
                          'iat_slot_rva': '0xe2438', 'recorded_pointer': hex(struct.unpack('<Q', read(0xE2438, 8))[0])},
        'constants': [{'rva': hex(address), 'bytes': read(address, 8).hex(),
                       'double': struct.unpack('<d', read(address, 8))[0]}
                      for address in [0xECED8, 0xECEF8, 0x202D68]],
        'tick_rtti': identities(),
        'recorded_function_ranges': {hex(address): containing(address) for address in
                                     [0x8461A, 0xD261C, 0xCFE40, 0x7DF00, 0x613E0,
                                      0x6F610, 0x622B0, 0x8ED30, 0x906B0, 0xAC180,
                                      0x92730, 0x41F00]},
        'limitations': [
            'Linear disassembly is not a recovered CFG; table rows are observed candidates, not PE-header authority.',
            'Worker-bound callback destination is conditional on this constructor/bundle; no live receiver was observed.',
            'worker_send invokes the supplied preflight callback at 0xd0343 and stages a command at 0xd04ea; consumer/hook and ACK remain unknown.',
            'Route consumes walkable tiles and creatures, calls a search with Chebyshev; complete A* proof remains open.',
            'Random integer/deadline formulas are recovered; full TravelLure and LureRecovered transitions remain partial.',
            'No new IPC field or opcode is inferred from internal offsets, RTTI or status strings.',
        ],
    }
    return result


if __name__ == '__main__':
    evidence = make_evidence()
    (ROOT / 'native_runtime_evidence.json').write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf8')
    lines = []
    for name, block in evidence['blocks'].items():
        lines.append('\n[' + name + '] ' + ' .. '.join(block['range']))
        for row in block['instructions']:
            suffix = ' ; ' + row['string_candidate'] if 'string_candidate' in row else ''
            lines.append(row['rva'] + ' ' + row['bytes'].ljust(28) + ' ' + row['mnemonic'].ljust(8) + ' ' + row['operands'] + suffix)
    (ROOT / 'native_runtime_disasm.txt').write_text('\n'.join(lines) + '\n', encoding='utf8')
    print(json.dumps({'sha256': evidence['sha256'], 'anchors': len(evidence['anchors']), 'blocks': len(evidence['blocks'])}))
