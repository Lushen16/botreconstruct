import argparse
import hashlib
import json
from pathlib import Path

from capstone import Cs, CS_ARCH_X86, CS_MODE_64, CS_OP_MEM, CS_OP_IMM
from capstone.x86_const import X86_REG_RIP


ROOT = Path(__file__).resolve().parent.parent
IMAGE_BASE = 0x7FF85C470000
TEXT_RVA = 0x1000
EXPECTED_SHA256 = '7c0fd219dc24f3fa273ded518eca8ea840d3395f00d14e78beacb4ffd7c50ea4'


def analyze(start, end):
    source = ROOT / 'dumps/msftedit_text_32336.bin'
    content = source.read_bytes()
    digest = hashlib.sha256(content).hexdigest()
    if digest != EXPECTED_SHA256:
        raise ValueError('Native dump identity changed')
    if not TEXT_RVA <= start < end <= len(content) + TEXT_RVA:
        raise ValueError('Range outside recorded text')
    decoder = Cs(CS_ARCH_X86, CS_MODE_64)
    decoder.detail = True
    rows = []
    for instruction in decoder.disasm(content[start - TEXT_RVA:end - TEXT_RVA], IMAGE_BASE + start):
        row = {'rva': hex(instruction.address - IMAGE_BASE),
               'offset': hex(instruction.address - IMAGE_BASE - TEXT_RVA),
               'bytes': instruction.bytes.hex(), 'mnemonic': instruction.mnemonic,
               'operands': instruction.op_str}
        for operand in instruction.operands:
            if operand.type == CS_OP_MEM and operand.mem.base == X86_REG_RIP:
                target = instruction.address + instruction.size + operand.mem.disp
                row['rip_target_rva'] = hex(target - IMAGE_BASE)
                offset = target - IMAGE_BASE - TEXT_RVA
                if 0 <= offset < len(content):
                    text = content[offset:offset + 180].split(bytes([0]))[0]
                    if len(text) > 2 and all(byte >= 32 for byte in text):
                        try:
                            row['string_candidate'] = text.decode('utf8')
                        except UnicodeDecodeError:
                            pass
            if operand.type == CS_OP_IMM and instruction.mnemonic in ('call', 'jmp'):
                row['direct_target_rva'] = hex(operand.imm - IMAGE_BASE)
        rows.append(row)
    return {'source': str(source.relative_to(ROOT)), 'sha256': digest,
            'image_base': hex(IMAGE_BASE), 'text_rva': hex(TEXT_RVA),
            'range': [hex(start), hex(end)], 'capstone': __import__('capstone').__version__,
            'limitations': ['Linear disassembly of a caller-selected range, not function or CFG recovery.',
                            'A string candidate or direct call address is not a recovered function name.',
                            'File offset = RVA - 0x1000; no target execution or live process access.'],
            'instructions': rows}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--start', type=lambda value: int(value, 0), default=0xA46E0)
    parser.add_argument('--end', type=lambda value: int(value, 0), default=0xA60C4)
    parser.add_argument('--stem', choices=['native_capture', 'native_capture_vm', 'native_capture_distance',
                                         'native_capture_guard', 'native_capture_send'], default='native_capture')
    arguments = parser.parse_args()
    result = analyze(arguments.start, arguments.end)
    (ROOT / (arguments.stem + '_static.json')).write_text(json.dumps(result, indent=2) + '\n', encoding='utf8')
    lines = []
    for row in result['instructions']:
        suffix = ' ; ' + row['string_candidate'] if 'string_candidate' in row else ''
        lines.append(row['rva'] + ' ' + row['bytes'].ljust(28) + ' ' + row['mnemonic'].ljust(8) + ' ' + row['operands'] + suffix)
    (ROOT / (arguments.stem + '_disasm.txt')).write_text('\n'.join(lines) + '\n', encoding='utf8')
    print(json.dumps({'sha256': result['sha256'], 'range': result['range'], 'instructions': len(result['instructions'])}))
