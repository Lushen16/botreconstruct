const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadOriginal } = require('./probe_protocol_vectors.cjs');
if (process.versions.electron !== '44.7.2') throw Error('Use the bundled Electron 44.7.2 in ELECTRON_RUN_AS_NODE mode.');
const original = path.resolve(__dirname, '../../Extracted_Source');
const runtime = require(path.join(original, 'bytecode-runtime.cjs'));
const imports = [];
const blockedCalls = [];
const hashes = {};
const protocol = loadOriginal().protocol;
const deny = operation => (...args) => {
  blockedCalls.push({ operation, argumentsRetained: false });
  throw Error('Probe blocked external operation: ' + operation);
};
function load(name, expected, dependencies) {
  const filename = path.join(original, 'lib', name + '.jsc');
  const bytes = fs.readFileSync(filename);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (hash !== expected) throw Error('Module identity changed: ' + name);
  hashes[name] = hash;
  const record = { exports: {} };
  const selectedRequire = dependency => {
    imports.push({ module: name, dependency });
    if (!Object.hasOwn(dependencies, dependency)) throw Error('Unlisted dependency: ' + dependency);
    return dependencies[dependency];
  };
  runtime.runBytecode(Buffer.from(bytes)).call(record.exports, record.exports, selectedRequire,
    record, filename, path.dirname(filename), Object.freeze({ platform: 'win32', env: {} }), global);
  return record.exports;
}
function describe(exports) {
  return Object.fromEntries(Object.entries(exports).map(([name, value]) => [name,
    typeof value !== 'function' ? { type: typeof value } : { type: 'function', arity: value.length,
      prototype: Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(value.prototype || {}))
        .filter(([key]) => key !== 'constructor').map(([key, descriptor]) => [key,
          typeof descriptor.value === 'function' ? { type: 'function', arity: descriptor.value.length } : { type: 'property' }])) }]));
}
const telemetry = load('telemetry', '0f308a9d7fd4a89f537a61a076dd68aae5ef8b3fdf668f128152c3d6475456c8', { './protocol.cjs': protocol });
const net = new Proxy({}, { get: (target, key) => deny('net.' + String(key)) });
const fakeFs = new Proxy({}, { get: (target, key) => deny('fs.' + String(key)) });
const bridge = load('pipe-bridge', 'f2047593c12388a5bb09286d010fa7422b7e626fb8ea60c0268023be310114b4', {
  'node:net': net, 'node:fs/promises': fakeFs,
  'node:path': path, 'node:events': require('node:events'), 'node:crypto': crypto,
  './protocol.cjs': protocol, './telemetry.cjs': telemetry,
});
const report = { generatedAt: new Date().toISOString(), authority: 'controlled-module-initialization',
  hashes, imports, exports: { telemetry: describe(telemetry), bridge: describe(bridge) },
  constants: { KIND: bridge.KIND, MAX_FRAME: bridge.MAX_FRAME },
  blockedCalls, operationalMethodsInvoked: false, connectionsOpened: false,
  originalMainExecuted: false, credentialsRead: false,
  limitations: ['Export names are observed; operational behavior is not inferred from names.',
    'Only selected original modules initialized, with filesystem and network imports replaced.',
    'This import harness is not an operating-system security sandbox.'] };
if (require.main === module) {
  fs.writeFileSync(path.resolve(__dirname, '../bridge-module-observation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
module.exports = { bridge, telemetry, imports, blockedCalls, hashes };
