const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const original = path.resolve(root, '../Extracted_Source');
const target = path.join(original, 'lib/protocol.jsc');
const bytes = fs.readFileSync(target);
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
if (digest !== '56522f34578706292530ee7c05f8774b221b6d2e862a55f51e78700cfe10a48e') {
  throw new Error('Protocol artifact identity changed');
}
const runtime = require(path.join(original, 'bytecode-runtime.cjs'));
const wrapper = runtime.runBytecode(Buffer.from(bytes));
const moduleRecord = { exports: {} };
const imports = [];
function selectedRequire(name) {
  imports.push(name);
  if (name === '../shared/schema.js') return require(path.join(original, 'shared/schema.js'));
  throw new Error('Unexpected protocol dependency: ' + name);
}
wrapper.call(moduleRecord.exports, moduleRecord.exports, selectedRequire, moduleRecord,
  target, path.dirname(target), process, global);
const protocol = moduleRecord.exports;
const exportsView = Object.fromEntries(Object.entries(protocol).map(([name, value]) =>
  [name, typeof value === 'function' ? { type: 'function', arity: value.length } : value]));
const attempts = [];
for (const name of ['decodeState', 'decodeAck']) {
  for (const size of [0, 12, 48]) {
    try { attempts.push({ function: name, input_hex: Buffer.alloc(size).toString('hex'),
      result: protocol[name](Buffer.alloc(size)) }); }
    catch (error) { attempts.push({ function: name, size, error: error.message }); }
  }
}
console.log(JSON.stringify({ authority: 'controlled-module-execution', sha256: digest,
  runtime: process.versions, imports, exports: exportsView, attempts,
  limitations: ['Only the protocol module is invoked with allowlisted imports.',
    'No main process, native bridge, game commands or session authentication is invoked.'] }, null, 2));
