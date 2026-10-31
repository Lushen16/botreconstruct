'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fixtures = require('../inspection_vectors.json');
const { sha256 } = require('../tools/probe_protocol_vectors.cjs');
const { materialize, observe, fixturePath } = require('../tools/probe_inspection_vectors.cjs');
const { decodeTelemetry } = require('../reconstruction/telemetry.cjs');
const { FrameDecoder } = require('../reconstruction/frame-decoder.cjs');
const { KIND, frame } = require('../reconstruction/framing.cjs');
const { selectCaptureCandidate, chooseBall, nextCaptureAt } = require('../reconstruction/engines/capture-engine.cjs');

test('inspection vectors bind the source module and redacted fixture', () => {
  assert.equal(fixtures.hashes.telemetry, '0f308a9d7fd4a89f537a61a076dd68aae5ef8b3fdf668f128152c3d6475456c8');
  assert.equal(fixtures.fixtureSha256, sha256(fs.readFileSync(fixturePath)));
  assert.equal(fixtures.casesSha256, sha256(JSON.stringify(fixtures.cases)));
  const evidence = require('../reconstruction/inspection-snapshot-evidence.json');
  assert.equal(evidence.redacted_sha256, fixtures.fixtureSha256);
  assert.equal(evidence.redacted_bytes, fs.statSync(fixturePath).size);
});

test('inspection decoder matches captured acceptance and rejection vectors', () => {
  for (const entry of fixtures.cases) assert.deepEqual(observe(decodeTelemetry, materialize(entry)), entry.observed, entry.id);
});

test('fragmented telemetry envelopes feed offline capture decisions', () => {
  const snapshot = fs.readFileSync(fixturePath);
  const bytes = frame(KIND.telemetry, snapshot);
  const decoder = new FrameDecoder();
  const frames = [];
  for (let offset = 0; offset < bytes.length; offset += 127) frames.push(...decoder.push(bytes.subarray(offset, offset + 127)));
  decoder.end();
  assert.equal(frames.length, 1);
  assert.equal(frames[0].kind, KIND.telemetry);
  const telemetry = decodeTelemetry(frames[0].payload);
  const stocked = telemetry.itemCounts.find(entry => entry.count > 0);
  assert.ok(stocked);
  const config = { looting: { captureEnabled: true, maxCaptureDist: 30, captureAfterCombat: false,
    captureEntries: [{ corpseId: telemetry.inspection.id, ballId: stocked.id }] } };
  const nearby = { ...telemetry, position: { ...telemetry.inspection.pos } };
  const candidate = selectCaptureCandidate(nearby, config);
  assert.equal(candidate.eligible, true);
  assert.equal(candidate.distance, 0);
  assert.equal(chooseBall(candidate.entry, telemetry.itemCounts).ballId, stocked.id);
  assert.equal(nextCaptureAt(1000, 300), 1300);
  assert.equal(selectCaptureCandidate({ ...nearby, inspection: null }, config).reason, 'no-inspection');
});

test('nullable inspection positions decode but do not produce capture candidates', () => {
  const snapshot = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  snapshot.inspection.pos = null;
  const telemetry = decodeTelemetry(Buffer.from(JSON.stringify(snapshot)));
  const config = { looting: { captureEnabled: true, captureEntries: [{ corpseId: snapshot.inspection.id }] } };
  assert.equal(telemetry.inspection.pos, null);
  assert.equal(selectCaptureCandidate(telemetry, config).reason, 'inspection-position');
  const rules = require('../reconstruction/spec/capture-v1.json').rules;
  for (const id of ['CaptureRank', 'CaptureApproach']) {
    const rule = rules.find(entry => entry.id === id);
    assert.equal(rule.status, 'implementable');
    assert.equal(rule.coverage, 'partial');
    assert.ok(rule.residualUnknowns.length > 0);
  }
});

test('live original inspection differential in compatible Electron', { skip: process.versions.electron !== '44.7.2' }, () => {
  const { telemetry, blockedCalls } = require('../tools/probe_bridge_exports.cjs');
  for (const entry of fixtures.cases) {
    const bytes = materialize(entry);
    assert.deepEqual(observe(telemetry.decodeTelemetry, bytes), entry.observed, entry.id);
    assert.deepEqual(observe(decodeTelemetry, bytes), entry.observed, entry.id);
  }
  assert.equal(blockedCalls.length, 0);
});
