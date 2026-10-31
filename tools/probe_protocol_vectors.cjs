'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const expectedHash = '56522f34578706292530ee7c05f8774b221b6d2e862a55f51e78700cfe10a48e';
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function loadOriginal() {
  const original = path.resolve(root, '../Extracted_Source');
  const target = path.join(original, 'lib/protocol.jsc');
  const bytes = fs.readFileSync(target);
  if (sha256(bytes) !== expectedHash) throw new Error('Protocol artifact identity changed');
  const runtime = require(path.join(original, 'bytecode-runtime.cjs'));
  const record = { exports: {} };
  const imports = [];
  const selectedRequire = name => {
    imports.push(name);
    if (name === '../shared/schema.js') return require(path.join(original, 'shared/schema.js'));
    throw new Error('Unexpected protocol dependency: ' + name);
  };
  runtime.runBytecode(Buffer.from(bytes)).call(record.exports, record.exports, selectedRequire,
    record, target, path.dirname(target), process, global);
  return { protocol: record.exports, imports, hashes: {
    protocol: expectedHash,
    bytecode_runtime: sha256(fs.readFileSync(path.join(original, 'bytecode-runtime.cjs'))),
    schema: sha256(fs.readFileSync(path.join(original, 'shared/schema.js')))
  } };
}
function pack(value) {
  if (Object.is(value, -0)) return { $number: '-0' };
  if (value === undefined) return { $undefined: true };
  if (typeof value === 'number' && !Number.isFinite(value)) return { $number: String(value) };
  if (typeof value === 'bigint') return { $bigint: String(value) };
  if (Buffer.isBuffer(value)) return { $buffer: value.toString('hex') };
  if (Array.isArray(value)) return value.map(pack);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, pack(item)]));
  return value;
}
function unpack(value) {
  if (!value || typeof value !== 'object') return value;
  if (value.$undefined) return undefined;
  if (value.$number) return Number(value.$number);
  if (value.$bigint) return BigInt(value.$bigint);
  if (value.$buffer !== undefined) return Buffer.from(value.$buffer, 'hex');
  if (Array.isArray(value)) return value.map(unpack);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpack(item)]));
}
function invoke(protocol, name, args) {
  try { return { result: pack(protocol[name](...args)) }; }
  catch (error) { return { error: { name: error.name, message: error.message } }; }
}
function buildCases() {
  const cases = [];
  const add = (name, ...args) => cases.push({ name, args: pack(args) });
  const values = [undefined, null, false, true, -1, -0, 0, 1, 2, 3, 4, 7, 8, 15, 16, 50, 51, 100, 101, 255, 256, 65534, 65535, 65536, 0x7fffffff, 0x80000000, 0xffffffff, 0x100000000, 1.5, NaN, Infinity, '1', '', {}, []];
  for (const value of values) { add('uint32', value, 'field'); add('uint32', value); add('uuidHash', value); }
  for (const value of ['abc', 'ABC', '?', '??', 'a\0b', Buffer.from([0, 255, 1]), [1, 2, 255]]) add('uuidHash', value);
  for (const [name, size] of [['decodeState', 48], ['decodeAck', 12]]) {
    for (const value of [undefined, null, {}, [], '', { length: size }, ...[0, 1, 11, 12, 13, 47, 48, 49].map(length => Buffer.alloc(length))]) add(name, value);
    for (let offset = 0; offset < size; offset++) for (const value of [1, 128, 255]) { const bytes = Buffer.alloc(size); bytes[offset] = value; add(name, bytes); }
  }
  for (const offset of [12, 20, 28]) for (const value of [-1, -0, 1.5, Number.MAX_VALUE, NaN, Infinity, -Infinity]) { const bytes = Buffer.alloc(48); bytes.writeDoubleLE(value, offset); add('decodeState', bytes); }
  const commands = ['walk', 'attack', 'follow', 'stop', 'focus', 'talk', 'combo', 'switchPokemon', 'action', 'fight', 'potion', 'revive', 'useWith', 'recallPokemon', 'order', 'turn', 'refreshCombo', 'chase', 'hotkey', 'orderGround', 'guildDaily', 'unknown', 1, null, undefined, ['stop']];
  const texts = ['', ' ', 'hello', ' abc ', '???', 'a\0b', 'a\nb', 'a\tb', 'a\x7fb', 'a'.repeat(255), 'a'.repeat(256), '?'.repeat(127), '?'.repeat(128), '!autocombo', '!autocombo a, b', '!autocombo a,b', '!autocombo ', '!AUTOCOMBO', 'normal:fire', 'primal:fairy', 'wildscape:normal', 'normal:fire:extra', 'NORMAL:FIRE', 'm1', 'm0'];
  const position = { x: 1234, y: 5678, z: 7, summonId: 0x11223344, itemId: 123, targetId: 456, stack: 2 };
  for (const command of commands) {
    add('encodeCommand', 123, command);
    for (const value of [...values, ...texts, position, { direction: 1, pokemon: true }, { direction: 3, pokemon: false }]) add('encodeCommand', 123, command, value);
    const parameter = ['talk', 'hotkey', 'switchPokemon', 'recallPokemon'].includes(command) ? 'm1' : command === 'combo' ? '!autocombo' : command === 'guildDaily' ? 'normal:fire' : ['order', 'orderGround', 'useWith'].includes(command) ? position : command === 'turn' ? { direction: 1, pokemon: true } : ['stop', 'focus', 'refreshCombo', 'walk', 'chase'].includes(command) ? 0 : 1;
    for (const options of [null, 0, 'abc', {}, { expectedUuid: '' }, { expectedUuid: 'abc' }, { expectedUuid: null }, { expectedUuid: 123 }, { expectedAction: 0 }, { expectedAction: 1 }, { expectedAction: 2 }, { expectedUuid: 'abc', expectedAction: 1 }, { attackTargetId: 123 }, { fightMode: 1 }, ...[0, 1, 2, null, '1'].map(fightMode => ({ expectedUuid: 'abc', attackTargetId: 123, fightMode })), { expectedUuid: 'abc', attackTargetId: -1 }]) add('encodeCommand', 123, command, parameter, options);
  }
  for (const commandId of values) add('encodeCommand', commandId, 'stop');
  for (const command of ['order', 'orderGround', 'useWith']) for (const key of Object.keys(position)) for (const value of values) add('encodeCommand', 0xffffffff, command, { ...position, [key]: value });
  for (const direction of values) for (const pokemon of [true, false, 0, 1, undefined]) add('encodeCommand', 1, 'turn', { direction, pokemon });
  return cases;
}
module.exports = { loadOriginal, pack, unpack, invoke, sha256, buildCases };
if (require.main === module) {
  const { protocol, hashes, imports } = loadOriginal();
  if (process.argv[2] === '--eval') {
    const cases = unpack(JSON.parse(process.argv[3]));
    console.log(JSON.stringify(cases.map(entry => ({ ...entry, ...invoke(protocol, entry.name, entry.args) })), null, 2));
  } else if (process.argv[2] === '--capture') {
    const cases = buildCases().map(entry => ({ ...entry, observed: invoke(protocol, entry.name, unpack(entry.args)) }));
    const constants = pack(Object.fromEntries(Object.entries(protocol).filter(([, value]) => typeof value !== 'function')));
    console.log(JSON.stringify({ authority: 'controlled-module-execution', hashes, runtime: process.versions, imports, constants, cases_sha256: sha256(JSON.stringify(cases)), cases,
      limitations: ['Finite synthetic inputs only; no IPC transport or native calls.', 'authExpired trigger remains unknown: all sampled valid states returned false.', 'revive accepted parameter set remains unknown: sampled numeric values were rejected.', 'Exotic getters, proxies, prototype mutations and memory exhaustion are not covered.'] }, null, 2));
  } else {
    console.log(JSON.stringify({ hashes, imports, exports: pack(Object.fromEntries(Object.entries(protocol).filter(([, value]) => typeof value !== 'function'))) }, null, 2));
  }
}
