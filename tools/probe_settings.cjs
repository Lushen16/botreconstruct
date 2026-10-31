const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../Extracted_Source');
const bytes = fs.readFileSync(path.join(root, 'lib/settings.jsc'));
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
if (digest !== 'f521bf39c4a05dca206a0861c5d5b904870a57ca946f0e3cbbef849dbfdbd2aa') throw Error('Identity mismatch');
const runtime = require(path.join(root, 'bytecode-runtime.cjs'));
const wrapper = runtime.runBytecode(Buffer.from(bytes));
const moduleRecord = { exports: {} };
const imports = [];
const selectedRequire = name => {
  imports.push(name);
  if (['node:path', 'node:crypto'].includes(name)) return require(name);
  if (name === 'node:fs/promises') return new Proxy({}, { get(target, property) {
    return () => { throw Error('Filesystem access not enabled in probe: ' + String(property)); };
  } });
  if (name === 'node:timers/promises') return { setTimeout: () => { throw Error('Timer not enabled'); } };
  if (['../shared/schema.js', '../shared/walker.js'].includes(name)) return require(path.resolve(root, 'lib', name));
  throw Error('Unexpected dependency: ' + name);
};
wrapper.call(moduleRecord.exports, moduleRecord.exports, selectedRequire, moduleRecord,
  path.join(root, 'lib/settings.jsc'), path.join(root, 'lib'), process, global);
const settings = moduleRecord.exports;
const exportView = Object.fromEntries(Object.entries(settings).map(([name, value]) => [name,
  typeof value === 'function' ? { type: 'function', arity: value.length,
    prototype: Object.getOwnPropertyNames(value.prototype || {}) } : value]));
const attempts = [];
for (const [name, args] of [['validateConfig', [require(path.join(root, 'shared/schema.js')).createConfig()]],
  ['profileName', ['Default']], ['characterKey', ['Alice']], ['characterDirectory', ['Alice']]]) {
  try { attempts.push({ function: name, args, result: settings[name](...args) }); }
  catch (error) { attempts.push({ function: name, error: error.message }); }
}
console.log(JSON.stringify({ sha256: digest, imports, exports: exportView, attempts }, null, 2));
