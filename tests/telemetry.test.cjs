'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fixtures = require('../telemetry_vectors.json');
const edges = require('../telemetry_edges.json');
const telemetry = require('../reconstruction/telemetry.cjs');
const { materialize, invoke } = require('../tools/probe_telemetry_vectors.cjs');
const { sha256 } = require('../tools/probe_protocol_vectors.cjs');

function compare(cases) {
  const failures = [];
  for (const entry of cases) {
    const actual = invoke(telemetry.decodeTelemetry, materialize(entry));
    try { assert.deepEqual(actual, entry.observed); } catch { failures.push({ id: entry.id ?? null, actual, expected: entry.observed }); }
  }
  return failures;
}

test('captured telemetry fixtures preserve identity and digest', () => {
  assert.equal(fixtures.hashes.telemetry, '0f308a9d7fd4a89f537a61a076dd68aae5ef8b3fdf668f128152c3d6475456c8');
  assert.equal(sha256(JSON.stringify(fixtures.cases)), fixtures.cases_sha256);
  assert.equal(edges.hashes.telemetry, fixtures.hashes.telemetry);
  assert.equal(sha256(JSON.stringify(edges.cases)), edges.cases_sha256);
});

test('independent implementation matches every captured vector', () => {
  assert.equal(fixtures.cases.length, 1993);
  const failures = compare(fixtures.cases);
  assert.deepEqual(failures.slice(0, 12), [], `${failures.length} mismatched vectors`);
});

test('independent implementation matches captured boundary vectors', () => {
  assert.equal(edges.cases.length, 119);
  const failures = compare(edges.cases);
  assert.deepEqual(failures.slice(0, 12), [], `${failures.length} mismatched edges`);
});

test('oversized payloads fail before JSON parsing', () => {
  assert.throws(() => telemetry.decodeTelemetry(Buffer.alloc(1048577, 32)), /1 MB/u);
  assert.throws(() => telemetry.decodeTelemetry(Buffer.alloc(1048576, 32)), SyntaxError);
  assert.throws(() => telemetry.decodeTelemetry(undefined), TypeError);
  assert.throws(() => telemetry.decodeTelemetry(null), TypeError);
});

test('valid baseline survives with unknown keys preserved', () => {
  const input = { ...fixtures.cases[0].input, syntheticExtra: { nested: 'retained' } };
  const decoded = telemetry.decodeTelemetry(Buffer.from(JSON.stringify(input)));
  assert.deepEqual(decoded.syntheticExtra, { nested: 'retained' });
  assert.equal(decoded.schema, 2);
});

test('unsupported blocks fail closed instead of guessing', () => {
  const base = fixtures.cases[0].input;
  const expect = (patch, message) => assert.throws(
    () => telemetry.decodeTelemetry(Buffer.from(JSON.stringify({ ...base, ...patch }))),
    error => error instanceof Error && error.message === message,
  );
  expect({ captureVersion: 1, itemInspectorAvailable: true, itemCounts: [] }, 'Inspeção de item inválida.');
  expect({ guildDailies: [{ tier: 'normal', element: 'fire' }] }, 'Progresso da daily guild inválido.');
  expect({
    alertSignals: { chat: true, gm_message: true, pokemon_capture: true, gm_arrow: true, camera_viewers: true },
    alertEvents: [{ kind: 'talk' }], alertEventRevision: 0, alertEventsDropped: 0,
  }, 'Evento de alerta inválido.');
});

test('live original differential under stock Electron', { skip: process.versions.electron !== '44.7.2' }, () => {
  const { telemetry: original, hashes, blockedCalls } = require('../tools/probe_bridge_exports.cjs');
  assert.equal(hashes.telemetry, fixtures.hashes.telemetry);
  for (const entry of [...fixtures.cases, ...edges.cases]) {
    assert.deepEqual(
      invoke(telemetry.decodeTelemetry, materialize(entry)),
      invoke(original.decodeTelemetry, materialize(entry)),
      entry.id ?? `vector ${entry.i}`,
    );
  }
  assert.equal(blockedCalls.length, 0);
});
