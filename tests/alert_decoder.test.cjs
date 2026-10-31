'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vectors = require('../alert_vectors.json');
const { sha256 } = require('../tools/probe_protocol_vectors.cjs');
const { buildCases, materialize, observe, fixturePath } = require('../tools/probe_alert_vectors.cjs');
const { decodeTelemetry } = require('../reconstruction/telemetry.cjs');
const { FrameDecoder } = require('../reconstruction/frame-decoder.cjs');
const { KIND, frame } = require('../reconstruction/framing.cjs');
const { createAlertsEngine } = require('../reconstruction/engines/alerts-engine.cjs');

test('alert vectors bind the original decoder, source fixture and complete case inventory', () => {
  assert.equal(vectors.hashes.telemetry, '0f308a9d7fd4a89f537a61a076dd68aae5ef8b3fdf668f128152c3d6475456c8');
  assert.equal(vectors.fixtureSha256, sha256(fs.readFileSync(fixturePath)));
  assert.equal(vectors.casesSha256, sha256(JSON.stringify(vectors.cases)));
  assert.deepEqual(vectors.cases.map(({ id, patch }) => ({ id, patch })), buildCases());
  assert.equal(new Set(vectors.cases.map(entry => entry.id)).size, vectors.cases.length);
});

test('alert decoder matches original acceptance, error text and decoded bytes', () => {
  const failures = [];
  for (const entry of vectors.cases) {
    const actual = observe(decodeTelemetry, materialize(entry));
    try { assert.deepEqual(actual, entry.observed); }
    catch { failures.push({ id: entry.id, expected: entry.observed, actual }); }
  }
  assert.deepEqual(failures, []);
});

test('original alert boundaries distinguish UTF-8 bytes, queue capacity and event ordering', () => {
  for (const [id, accepted] of [
    ['event/name-bytes/95', true], ['event/name-bytes/96', false],
    ['event/name-utf8/95', true], ['event/name-utf8/96', false],
    ['events/full-count/32', true], ['events/full-count/33', false],
    ['event/value-boundary/65535', true], ['event/value-boundary/65536', false],
    ['event/id-equal-revision', true], ['event/id-above-revision', false],
    ['event/id-zero-with-high-revision', false], ['event/duplicate-id', false],
    ['event/reversed-order', false], ['event/id-boundary/9007199254740991', true],
  ]) {
    const entry = vectors.cases.find(candidate => candidate.id === id);
    assert.ok(entry, id);
    assert.equal(entry.observed.accepted, accepted, id);
    assert.equal(observe(decodeTelemetry, materialize(entry)).accepted, accepted, id);
  }
});

test('fragmented snapshot frames preserve captured alert rows without reclassification', () => {
  const snapshot = fs.readFileSync(fixturePath);
  const bytes = frame(KIND.telemetry, snapshot);
  const decoder = new FrameDecoder();
  const frames = [];
  for (let offset = 0; offset < bytes.length; offset += 127) frames.push(...decoder.push(bytes.subarray(offset, offset + 127)));
  decoder.end();
  assert.equal(frames.length, 1);
  const decoded = decodeTelemetry(frames[0].payload);
  const source = JSON.parse(snapshot);
  for (const field of ['alertEvents', 'alertSignals', 'alertEventRevision', 'alertEventsDropped']) {
    assert.deepEqual(decoded[field], source[field]);
  }
});

test('capability flags alone do not fabricate alert triggers', () => {
  const telemetry = decodeTelemetry(fs.readFileSync(fixturePath));
  const types = Object.keys(telemetry.alertSignals);
  const engine = createAlertsEngine({ alerts: { rules: types.map(type => ({ name: type, type, enabled: true })) } });
  const result = engine.step({ online: true }, { ...telemetry, alertEvents: [] }, 0);
  assert.deepEqual(result.actions, []);
  const blocked = result.states.filter(entry => entry.type !== 'chat');
  assert.equal(blocked.length, 4);
  assert.ok(blocked.every(entry => entry.phase === 'unsupported'));
});

test('live original alert differential in compatible Electron', { skip: process.versions.electron !== '44.7.2' }, () => {
  const { telemetry, blockedCalls } = require('../tools/probe_bridge_exports.cjs');
  for (const entry of vectors.cases) {
    const bytes = materialize(entry);
    assert.deepEqual(observe(telemetry.decodeTelemetry, bytes), entry.observed, entry.id);
    assert.deepEqual(observe(decodeTelemetry, bytes), entry.observed, entry.id);
  }
  assert.equal(blockedCalls.length, 0);
});
