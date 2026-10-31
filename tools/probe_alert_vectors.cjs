'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pack, unpack, sha256 } = require('./probe_protocol_vectors.cjs');
const { fixturePath, observe } = require('./probe_inspection_vectors.cjs');

function buildCases() {
  const baseline = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const event = baseline.alertEvents[0];
  const cases = [];
  const add = (id, patch) => cases.push({ id, patch: pack(patch) });
  add('observed', {});
  const fields = {
    id: [undefined, null, -1, 0, 1.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, '175'],
    kind: [undefined, null, '', 'talk', 'pinned', 'effect', 'viewers', 'unknown'],
    mode: [undefined, null, -1, 0, 255, 256, 1.5, '7'],
    value: [undefined, null, -1, 0, 4294967295, 4294967296, 1.5, '0'],
    name: [undefined, null, '', 'a'.repeat(255), 'a'.repeat(256), 'é'.repeat(128)],
    text: [undefined, null, '', 'a'.repeat(512), 'a'.repeat(513), 'é'.repeat(257)],
    self: [undefined, null, true, false, 0, 'true'],
    pos: [undefined, null, [], {}, { x: 0, y: 65534, z: 15 }, { x: -1, y: 0, z: 0 },
      { x: 65535, y: 0, z: 0 }, { x: 0, y: 0, z: 16 }],
  };
  for (const [field, values] of Object.entries(fields)) {
    for (const [index, value] of values.entries()) {
      add('event/' + field + '/' + index, { alertEvents: [{ ...event, [field]: value }] });
    }
  }
  for (const [index, value] of [null, [], {}, false, 0, 'talk'].entries()) {
    add('event/shape/' + index, { alertEvents: [value] });
  }
  for (const kind of ['talk', 'pinned', 'effect', 'viewers']) {
    add('event/minimal/' + kind, { alertEvents: [{ id: event.id, kind }] });
  }
  add('event/extra-field', { alertEvents: [{ ...event, syntheticExtra: true }] });
  add('event/duplicate-id', { alertEvents: [event, { ...event }] });
  add('event/reversed-order', { alertEvents: [...baseline.alertEvents].reverse() });
  for (const id of [1, 174, 185, 186, 2147483647, 2147483648, 4294967295, 4294967296, Number.MAX_SAFE_INTEGER]) {
    add('event/id-boundary/' + id, { alertEventRevision: Number.MAX_SAFE_INTEGER, alertEvents: [{ ...event, id }] });
  }
  for (const value of [65535, 65536, 2147483647, 2147483648]) {
    add('event/value-boundary/' + value, { alertEvents: [{ ...event, value }] });
  }
  for (const count of [...Array.from({ length: 65 }, (_, index) => index + 64), 129, 254]) {
    add('event/name-bytes/' + count, { alertEvents: [{ ...event, name: 'a'.repeat(count) }] });
  }
  for (const count of [16, ...Array.from({ length: 34 }, (_, index) => index + 32), 127, 128, 129, 256, 257, 512, 513, 1024, 1025, 2048, 2049]) {
    add('events/full-count/' + count, { alertEventRevision: count,
      alertEvents: Array.from({ length: count }, (_, index) => ({ ...event, id: index + 1 })) });
  }
  add('event/name-utf8/64', { alertEvents: [{ ...event, name: 'é'.repeat(32) }] });
  add('event/name-utf8/66', { alertEvents: [{ ...event, name: 'é'.repeat(33) }] });
  add('event/name-utf8/94', { alertEvents: [{ ...event, name: 'é'.repeat(47) }] });
  add('event/name-utf8/96', { alertEvents: [{ ...event, name: 'é'.repeat(48) }] });
  add('event/name-utf8/95', { alertEvents: [{ ...event, name: 'é'.repeat(47) + 'a' }] });
  add('event/id-boundary/zero', { alertEventRevision: 0, alertEvents: [] });
  add('event/id-zero-with-high-revision', { alertEventRevision: Number.MAX_SAFE_INTEGER, alertEvents: [{ ...event, id: 0 }] });
  add('event/id-equal-revision', { alertEventRevision: event.id, alertEvents: [event] });
  add('event/id-above-revision', { alertEventRevision: event.id - 1, alertEvents: [event] });
  for (const count of [0, 2048, 2049]) {
    add('events/count/' + count, { alertEvents: Array.from({ length: count }, (_, index) => ({ id: index, kind: 'talk' })) });
  }
  for (const field of ['alertEvents', 'alertSignals', 'alertEventRevision', 'alertEventsDropped']) {
    for (const [index, value] of [undefined, null, [], {}, false, -1, 0, 1.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1].entries()) {
      add('block/' + field + '/' + index, { [field]: value });
    }
  }
  add('block/absent', { alertEvents: undefined, alertSignals: undefined, alertEventRevision: undefined, alertEventsDropped: undefined });
  add('signals/extra-field', { alertSignals: { ...baseline.alertSignals, syntheticExtra: true } });
  for (const field of Object.keys(baseline.alertSignals)) {
    for (const [index, value] of [undefined, null, true, false, 0, 'true'].entries()) {
      add('signal/' + field + '/' + index, { alertSignals: { ...baseline.alertSignals, [field]: value } });
    }
  }
  return cases;
}

function materialize(entry) {
  const baseline = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  return Buffer.from(JSON.stringify({ ...baseline, ...unpack(entry.patch) }));
}

if (require.main === module) {
  if (process.versions.electron !== '44.7.2') throw Error('Alert probes require bundled Electron 44.7.2 in Node mode.');
  const { telemetry, hashes, blockedCalls } = require('./probe_bridge_exports.cjs');
  const cases = buildCases().map(entry => ({ ...entry, observed: observe(telemetry.decodeTelemetry, materialize(entry)) }));
  if (blockedCalls.length) throw Error('Unexpected external operation attempted.');
  const report = { generatedAt: new Date().toISOString(), authority: 'controlled-original-module-redacted-fixture',
    hashes, fixtureSha256: sha256(fs.readFileSync(fixturePath)), casesSha256: sha256(JSON.stringify(cases)), cases,
    limitations: ['Only the baseline talk rows are from a captured snapshot; all mutations are synthetic decoder probes.',
      'Accepted kinds, mode values and capability flags do not establish native alert matching or alert occurrence.',
      'No original main, process-memory scan, live pipe, credentials or installed-file writes in this probe.'] };
  fs.writeFileSync(path.resolve(__dirname, '../alert_vectors.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ cases: cases.length, accepted: cases.filter(entry => entry.observed.accepted).length, blockedCalls: blockedCalls.length }));
}

module.exports = { buildCases, materialize, observe, fixturePath };
