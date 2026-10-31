'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.resolve(root, '../Extracted_Source');
const HASHES = {
  protocol: '56522f34578706292530ee7c05f8774b221b6d2e862a55f51e78700cfe10a48e',
  telemetry: '0f308a9d7fd4a89f537a61a076dd68aae5ef8b3fdf668f128152c3d6475456c8',
  'pipe-bridge': 'f2047593c12388a5bb09286d010fa7422b7e626fb8ea60c0268023be310114b4',
};

function sha256(bytes) { return require('node:crypto').createHash('sha256').update(bytes).digest('hex'); }

function run(name, deps) {
  const file = path.join(source, 'lib', name + '.jsc');
  const bytes = fs.readFileSync(file);
  if (sha256(bytes) !== HASHES[name]) throw new Error('Artifact identity changed: ' + name);
  const runtime = require(path.join(source, 'bytecode-runtime.cjs'));
  const record = { exports: {} };
  const selectedRequire = dependency => {
    if (!Object.hasOwn(deps, dependency)) throw new Error('Unlisted ' + name + ' dependency: ' + dependency);
    return deps[dependency];
  };
  runtime.runBytecode(Buffer.from(bytes)).call(record.exports, record.exports, selectedRequire,
    record, file, path.dirname(file), Object.freeze({ platform: 'win32', env: {} }), global);
  return record.exports;
}

function loadOriginalBridge(overrides = {}) {
  const crypto = overrides.crypto || require('node:crypto');
  const net = overrides.net || require('node:net');
  const fsp = overrides.fsp || require('node:fs/promises');
  const schema = require(path.join(source, 'shared/schema.js'));
  const protocol = run('protocol', { '../shared/schema.js': schema });
  const telemetry = run('telemetry', { './protocol.cjs': protocol });
  const bridge = run('pipe-bridge', {
    'node:net': net, 'node:fs/promises': fsp, 'node:path': path,
    'node:events': require('node:events'), 'node:crypto': crypto,
    './protocol.cjs': protocol, './telemetry.cjs': telemetry,
  });
  return { bridge, protocol, telemetry, hashes: { ...HASHES } };
}

module.exports = { loadOriginalBridge, HASHES, source };
