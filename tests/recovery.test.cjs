const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const { readAsar, bytecodeFacts, ipcFacts } = require('../tools/prepare.cjs');
const { literalEvaluator, defaults } = require('../tools/schema.cjs');

function fixture(header, payload = Buffer.from('hello')) {
  const json = Buffer.from(JSON.stringify(header));
  const aligned = Math.ceil(json.length / 4) * 4;
  const preamble = Buffer.alloc(16 + aligned);
  preamble.writeUInt32LE(4, 0);
  preamble.writeUInt32LE(8 + aligned, 4);
  preamble.writeUInt32LE(4 + aligned, 8);
  preamble.writeUInt32LE(json.length, 12);
  json.copy(preamble, 16);
  return Buffer.concat([preamble, payload]);
}

test('ASAR preserva bytes e verifica hash de integridade', () => {
  const hash = crypto.createHash('sha256').update('hello').digest('hex');
  const result = readAsar(fixture({ files: { 'a.js': { size: 5, offset: '0',
    integrity: { algorithm: 'SHA256', hash } } } }));
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].bytes.toString(), 'hello');
  assert.equal(result.entries[0].sha256, hash);
});

for (const name of ['..', '.', '../bad', 'bad\\name']) {
  test('ASAR rejeita nome inseguro ' + name, () => {
    assert.throws(() => readAsar(fixture({ files: { [name]: { size: 5, offset: '0' } } })));
  });
}
for (const entry of [{ size: 100, offset: '0' }, { size: 5, offset: '-1' },
  { size: 1.5, offset: '0' }, { size: 5, offset: '0', link: 'a' },
  { size: 5, offset: '0', unpacked: true },
  { size: 5, offset: '0', integrity: { algorithm: 'SHA256', hash: 'wrong' } }]) {
  test('ASAR rejeita intervalo, entrada externa ou integridade inválida ' + JSON.stringify(entry), () => {
    assert.throws(() => readAsar(fixture({ files: { file: entry } })));
  });
}
test('ASAR rejeita header truncado', () => {
  assert.throws(() => readAsar(Buffer.alloc(8)));
  const data = fixture({ files: {} });
  data.writeUInt32LE(0xffffffff, 4);
  assert.throws(() => readAsar(data));
});
test('Inventário de bytecode mantém offset, sem alegar decompilação', () => {
  const bytes = Buffer.concat([Buffer.alloc(28), Buffer.from('NativeRuntime\0PipeBridge')]);
  const result = bytecodeFacts({ relative: 'native.jsc', bytes, sha256: 'fixture' });
  assert.equal(result.header.length, 7);
  assert.equal(result.strings[0].file_offset, 28);
  assert.equal(result.strings[0].value, 'NativeRuntime');
  assert.equal(result.source_recovered, false);
  assert.equal(result.control_flow_recovered, false);
});
test('DSL extrai defaults aninhados sem confundir lista com objeto', () => {
  const result = defaults([{ key: 'target', type: 'object', fields: [
    { key: 'enabled', type: 'boolean', default: false },
    { key: 'monsters', type: 'list', fields: [{ key: 'name', default: '*' }] }] }]);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { target: { enabled: false, monsters: [] } });
});
test('DSL bloqueia require e chamadas de métodos', () => {
  const evaluate = literalEvaluator();
  assert.throws(() => evaluate({ type: 'CallExpression', callee: { type: 'Identifier', name: 'require' }, arguments: [] }, new Map()));
  assert.throws(() => evaluate({ type: 'CallExpression', callee: { type: 'MemberExpression' }, arguments: [] }, new Map()));
});
test('DSL bloqueia acesso a protótipos', () => {
  assert.throws(() => literalEvaluator()({ type: 'MemberExpression', computed: false,
    object: { type: 'Literal', value: {} }, property: { name: 'constructor' } }, new Map()));
});
test('Contrato IPC inclui send sem alegar handler main observado', () => {
  const ast = { type: 'CallExpression', loc: { start: { line: 1 } },
    callee: { type: 'MemberExpression', object: { name: 'ipcRenderer' }, property: { name: 'send' } },
    arguments: [{ type: 'Literal', value: 'pka-look:close', start: 0, end: 1 }] };
  const result = ipcFacts(ast, 'x', 'look-preload.cjs');
  assert.equal(result.operations[0].operation, 'send');
  assert.equal(result.operations[0].channel, 'pka-look:close');
});
