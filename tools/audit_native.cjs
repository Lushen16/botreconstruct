const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readAsar } = require('./prepare.cjs');
const { probe } = require('./probe_preload.cjs');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function inspectPe(bytes) {
  const result = { bytes: bytes.length, sha256: sha256(bytes), valid_headers: false };
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') {
    return { ...result, error: 'missing-dos-header' };
  }
  const offset = bytes.readUInt32LE(0x3c);
  result.e_lfanew = offset;
  result.e_lfanew_raw_hex = bytes.subarray(0x3c, 0x40).toString('hex');
  if (offset < 64 || offset > bytes.length - 24) return { ...result, error: 'pe-header-out-of-file' };
  if (!bytes.subarray(offset, offset + 4).equals(Buffer.from([0x50, 0x45, 0, 0]))) {
    return { ...result, error: 'invalid-pe-signature' };
  }
  const optionalSize = bytes.readUInt16LE(offset + 20);
  const optionalOffset = offset + 24;
  const sections = bytes.readUInt16LE(offset + 6);
  const table = optionalOffset + optionalSize;
  if (optionalSize < 2 || table > bytes.length || sections < 1 || sections > 96 ||
      sections * 40 > bytes.length - table) return { ...result, error: 'invalid-header-ranges' };
  const magic = bytes.readUInt16LE(optionalOffset);
  if (![0x10b, 0x20b].includes(magic) || optionalSize < (magic === 0x20b ? 112 : 96)) {
    return { ...result, error: 'invalid-optional-header' };
  }
  for (let index = 0; index < sections; index++) {
    const start = table + index * 40;
    const size = bytes.readUInt32LE(start + 16);
    const fileOffset = bytes.readUInt32LE(start + 20);
    if (size && (fileOffset > bytes.length || size > bytes.length - fileOffset)) {
      return { ...result, error: 'section-out-of-file' };
    }
  }
  return { ...result, valid_headers: true, machine: bytes.readUInt16LE(offset + 4), sections };
}

async function audit(root = path.resolve(__dirname, '../..')) {
  const analysis = path.join(root, path.basename(path.resolve(__dirname, '..')));
  const archive = path.join(root, 'Shiba_Bots_App/dll/resources/app.asar');
  const bytes = fs.readFileSync(archive);
  const { entries } = readAsar(bytes);
  const inventory = JSON.parse(fs.readFileSync(path.join(analysis, 'inventory.json')));
  const manifestMatches = sha256(bytes) === inventory.sha256 && entries.length === inventory.entries.length &&
    entries.every(entry => inventory.entries.some(record => record.path === entry.relative && record.sha256 === entry.sha256));
  const extractedMatches = entries.filter(entry => {
    const file = path.join(root, 'Extracted_Source', entry.relative);
    return fs.existsSync(file) && sha256(fs.readFileSync(file)) === entry.sha256;
  }).length;
  const candidates = ['Shiba_Bots_App/libs/d3d9.dll', 'Shiba_Bots_App/libs/lpeg.dll',
    'Shiba_Bots_App/a497a7a52bf97c5bcc5fad69c7958ce6.exe', 'Shiba_Bots_App/dll/PKA Tools.exe'];
  const native = candidates.map(relative => ({ path: relative, ...inspectPe(fs.readFileSync(path.join(root, relative))) }));
  const desktopCopy = path.resolve(root, '../../Desktop/Shiba Bots - Poke Alliance v2.6.6/libs/d3d9.dll');
  if (fs.existsSync(desktopCopy)) native.push({ path: desktopCopy, ...inspectPe(fs.readFileSync(desktopCopy)) });
  const needles = ['PKA2/', '\\\\.\\pipe\\pka-runtime-2-', 'Estado IPC deve ter exatamente 48 bytes.',
    'ACK IPC deve ter exatamente 12 bytes.', 'automation_control', 'automation_lease', 'nativeVerified'];
  const markers = entries.filter(entry => entry.relative.endsWith('.jsc')).flatMap(entry =>
    needles.flatMap(marker => {
      const offset = entry.bytes.indexOf(Buffer.from(marker));
      return offset < 0 ? [] : [{ file: entry.relative, sha256: entry.sha256, marker,
        bytecode_file_offset: offset, asar_file_offset: entry.file_offset + offset,
        authority: 'literal-bytes-only', control_flow_recovered: false }];
    }));
  return { generated_at: new Date().toISOString(), archive: { path: archive, sha256: sha256(bytes),
    files: entries.length, manifest_matches: manifestMatches, extracted_matches: extractedMatches },
    native_candidates: native, bytecode_markers: markers, preload_probe: await probe(),
    limitations: ['PE header validation is not disassembly or an identification of the native automation module.',
      'An invalid header does not establish how the file became invalid.',
      'Bytecode literals do not establish field offsets, command IDs, frame encoding or authentication semantics.',
      'No PokeBot modules were imported. No client commands or process writes were performed.'] };
}

if (require.main === module) audit().then(result => {
  const output = path.resolve(__dirname, '../audit_20261022.json');
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output, archive: result.archive, native_candidates: result.native_candidates.length,
    bytecode_markers: result.bytecode_markers.length }));
}).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { inspectPe, audit };
