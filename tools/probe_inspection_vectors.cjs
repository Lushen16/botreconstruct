'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pack, unpack, sha256 } = require('./probe_protocol_vectors.cjs');
const fixturePath = path.resolve(__dirname, '../reconstruction/fixtures/telemetry-schema2-inspection-redacted.json');

function buildCases() {
  const baseline = JSON.parse(fs.readFileSync(fixturePath, 'utf8')).inspection;
  const cases = [];
  const add = (id, inspection) => cases.push({ id, inspection: pack(inspection) });
  add('observed', baseline);
  for (const [index, value] of [null, [], {}, false, 0, 'item'].entries()) add('shape/' + index, value);
  const fields = {
    kind: [undefined, null, 'item', 'creature', 'unknown'],
    revision: [undefined, null, -1, 0, 1, 1.5, 2147483647, 2147483648, 4294967295, 4294967296,
      Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1],
    id: [undefined, null, 0, 1, 65535, 65536, '4029'],
    container: [undefined, null, true, false, 0, 'true'],
    pos: [undefined, null, [], {}, { x: 0, y: 65534, z: 15 }, { x: -1, y: 0, z: 0 },
      { x: 65535, y: 0, z: 0 }, { x: 0, y: 0, z: 16 }, { x: 0.5, y: 0, z: 0 }],
  };
  for (const [field, values] of Object.entries(fields)) {
    for (const [index, value] of values.entries()) add(field + '/' + index, { ...baseline, [field]: value });
  }
  add('creature/missing-container', { ...baseline, kind: 'creature', container: undefined });
  add('extra-field', { ...baseline, syntheticExtra: true });
  return cases;
}

function materialize(entry) {
  const baseline = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  return Buffer.from(JSON.stringify({ ...baseline, inspection: unpack(entry.inspection) }));
}

function observe(decoder, bytes) {
  try { return { accepted: true, outputSha256: sha256(JSON.stringify(decoder(bytes))) }; }
  catch (error) { return { accepted: false, error: { name: error.name, message: error.message } }; }
}

if (require.main === module) {
  if (process.versions.electron !== '44.7.2') throw Error('Inspection probes require bundled Electron 44.7.2 in Node mode.');
  const { telemetry, hashes, blockedCalls } = require('./probe_bridge_exports.cjs');
  const cases = buildCases().map(entry => ({ ...entry, observed: observe(telemetry.decodeTelemetry, materialize(entry)) }));
  if (blockedCalls.length) throw Error('Unexpected external operation attempted.');
  const report = { generatedAt: new Date().toISOString(), authority: 'controlled-original-module-redacted-fixture',
    hashes, fixtureSha256: sha256(fs.readFileSync(fixturePath)), casesSha256: sha256(JSON.stringify(cases)), cases,
    limitations: ['Finite mutations of an existing redacted fixture, not a new memory capture.',
      'Decoder acceptance does not establish CaptureRank, CaptureApproach or native capture execution.',
      'No original main, process-memory scan, live pipe or credential access in this probe.'] };
  fs.writeFileSync(path.resolve(__dirname, '../inspection_vectors.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ cases: cases.length, accepted: cases.filter(entry => entry.observed.accepted).length, blockedCalls: blockedCalls.length }));
}

module.exports = { buildCases, materialize, observe, fixturePath };
