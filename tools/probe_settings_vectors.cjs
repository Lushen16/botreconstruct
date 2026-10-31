const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../Extracted_Source');
const digest = 'f521bf39c4a05dca206a0861c5d5b904870a57ca946f0e3cbbef849dbfdbd2aa';
function loadOracle() {
  const bytes = fs.readFileSync(path.join(root, 'lib/settings.jsc'));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== digest) throw Error('Identity mismatch');
  const files = new Map();
  const calls = [];
  const fakeFs = new Proxy({}, { get(target, method) { return async (...args) => {
    calls.push([method, ...args]);
    if (method === 'mkdir') return;
    if (method === 'copyFile') { if (!files.has(String(args[0]))) throw Object.assign(Error('Missing'), { code: 'ENOENT' }); files.set(String(args[1]), files.get(String(args[0]))); return; }
    if (method === 'open') return { writeFile: async value => { files.set(String(args[0]), value); }, sync: async () => {}, close: async () => {} };
    if (method === 'readFile') {
      if (!files.has(String(args[0]))) throw Object.assign(Error('Missing'), { code: 'ENOENT' });
      return files.get(String(args[0]));
    }
    if (method === 'writeFile') { files.set(String(args[0]), args[1]); return; }
    if (method === 'rename') { files.set(String(args[1]), files.get(String(args[0]))); files.delete(String(args[0])); return; }
    if (method === 'unlink' || method === 'rm') { files.delete(String(args[0])); return; }
    if (method === 'stat') return { size: Buffer.byteLength(files.get(String(args[0])) || ''), isFile: () => true };
    if (method === 'readdir') return [];
    throw Error('Unimplemented mock fs: ' + method);
  }; } });
  const record = { exports: {} };
  const requireAllowed = name => {
    if (name === 'node:fs/promises') return fakeFs;
    if (['node:path', 'node:crypto'].includes(name)) return require(name);
    if (name === 'node:timers/promises') return { setTimeout: async () => {} };
    if (['../shared/schema.js', '../shared/walker.js'].includes(name)) return require(path.resolve(root, 'lib', name));
    throw Error('Disallowed require: ' + name);
  };
  require(path.join(root, 'bytecode-runtime.cjs')).runBytecode(Buffer.from(bytes)).call(record.exports,
    record.exports, requireAllowed, record, path.join(root, 'lib/settings.jsc'), path.join(root, 'lib'), process, global);
  return { settings: record.exports, files, calls };
}
async function inspect() {
  const { settings, calls, files } = loadOracle();
  const attempts = [];
  const attempt = async (name, callable) => { try { attempts.push({ name, result: await callable() }); } catch (error) { attempts.push({ name, error: error.message }); } };
  const store = new settings.SettingsStore('C:/oracle-owned');
  console.log('EXPORTS', Object.fromEntries(Object.entries(settings).map(([name, value]) => [name, typeof value === 'function' ? value.length : value])));
  console.log('STORE', store);
  console.log('METHODS', Object.getOwnPropertyNames(settings.SettingsStore.prototype).map(name => [name, typeof settings.SettingsStore.prototype[name] === 'function' ? settings.SettingsStore.prototype[name].length : 'other']));
  for (const name of ['snapshot', 'current', 'load', 'snapshot', 'current', 'initialize', 'snapshot', 'persist', 'save', 'select', 'remove']) await attempt(name, () => store[name]());
  console.log(JSON.stringify({ attempts, calls, files: [...files] }, null, 2));
}
module.exports = { loadOracle, digest };
if (require.main === module) (process.argv.includes('--vectors') ? generateVectors() : inspect()).catch(error => { console.error(error); process.exitCode = 1; });

async function generateVectors() {
  const { settings } = loadOracle();
  const schema = require(path.join(root, 'shared/schema.js'));
  const cases = [];
  const capture = (method, args) => {
    try { cases.push({ method, args, result: settings[method](...args) }); }
    catch (error) { cases.push({ method, args, error: error.message }); }
  };
  for (const method of ['profileName', 'characterKey']) for (const value of [null, '', ' Alice ', '../A/B', 'a\n', 'a\u007f', 'a'.repeat(81), 'a'.repeat(201), 42]) capture(method, [value]);
  for (const status of [null, {}, { online: true, telemetry: { playerName: ' Alice ' } }, { online: true, stale: true, telemetry: { playerName: 'Alice' } }, { online: false, telemetry: { playerName: 'Alice' } }]) capture('characterName', [status]);
  for (const type of ['boolean', 'text', 'code', 'number', 'select', 'list', 'object', 'parameter']) for (const value of [null, true, 'a', 2, 2.5, [], {}]) capture('validateFields', [[{ key: 'x', type, fields: [], options: ['a'], min: 0, max: 3 }], { x: value }, 'L']);
  for (const change of [config => {}, config => { config.foo = 1; }, config => { config.target.luring.frontRegroupMargin = 999; }, config => { delete config.target.luring; }, config => { delete config.tools.consumable4; }, config => { config.walker.waypoints = [{ action: 'wait', pos: { x: 1, y: 2, z: 3 }, param: '-1', stairCheckMonsters: false }]; }, config => { config.walker.waypoints = [{ action: 'say', pos: { x: 1, y: 2, z: 3 }, param: '', stairCheckMonsters: false }]; }]) {
    const config = schema.createConfig(); change(config); capture('validateConfig', [config]);
  }
  capture('validateConfig', [{}]); capture('validateConfig', [null]);
  const oracle = loadOracle();
  const store = new oracle.settings.SettingsStore('C:/oracle-owned');
  const trace = [];
  for (const [method, args] of [['load', []], ['save', [' Test ', schema.createConfig()]], ['save', ['test', schema.createConfig()]], ['select', ['Default']], ['remove', ['missing']], ['remove', ['Default']], ['remove', ['Test']], ['remove', ['test']]]) {
    try { const result = await store[method](...args); trace.push({ method, args, result }); }
    catch (error) { trace.push({ method, args, error: error.message }); }
  }
  const output = {
    provenance: { settingsSha256: digest, authority: 'controlled original pure-module execution; all filesystem calls mocked in memory', command: 'ELECTRON_RUN_AS_NODE=1 runtime/electron-v44.7.2/electron.exe tools/probe_settings_vectors.cjs --vectors' },
    originalDerived: ['Version 1 snapshot with activeProfile and ordered profiles', 'Fresh Default profile uses shared createConfig', 'Save trims names, is case-sensitive, activates profile; remove active picks first remaining', 'current and snapshot return detached copies', 'Generic validation, tools migration, luring normalization and exact errors in cases', 'Original filename root/electron/settings.json; lock, temp rename and backup observed'],
    designChoices: ['Explicit absolute root required; no automatic original user directories', 'Reject symlink directories/files and oversized on-disk settings', 'Serialized local operations plus bounded exclusive lock acquisition; stale locks require manual intervention', 'Backup is first-existing-file copy, not overwritten, to avoid following preexisting backup links', 'Validation behavior outside these fixtures remains unverified; no native/game or original main execution'],
    cases, trace,
  };
  const target = path.resolve(__dirname, '../settings_vectors.json');
  fs.writeFileSync(target, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({ vectors: cases.length, trace: trace.length, target }));
}
