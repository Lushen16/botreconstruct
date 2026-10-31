'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fixtures = require('../protocol_vectors.json');
const protocol = require('../reconstruction/protocol.cjs');
const { pack, unpack, invoke, sha256, loadOriginal } = require('../tools/probe_protocol_vectors.cjs');

test('captured fixture digest and protocol identity', () => {
  assert.equal(fixtures.hashes.protocol, '56522f34578706292530ee7c05f8774b221b6d2e862a55f51e78700cfe10a48e');
  assert.equal(sha256(JSON.stringify(fixtures.cases)), fixtures.cases_sha256);
});
test('public constants match original', () => {
  const constants = Object.fromEntries(Object.entries(protocol).filter(([, value]) => typeof value !== 'function'));
  assert.deepEqual(pack(constants), fixtures.constants);
});
test('independent implementation matches every captured vector', () => {
  const failures = [];
  for (const [index, entry] of fixtures.cases.entries()) {
    const actual = invoke(protocol, entry.name, unpack(entry.args));
    try { assert.deepEqual(actual, entry.observed); } catch { failures.push({ index, name: entry.name, args: entry.args, actual, expected: entry.observed }); }
  }
  assert.deepEqual(failures.slice(0, 20), [], `${failures.length} mismatched vectors: ${JSON.stringify(failures.slice(0, 12))}`);
});
test('live original differential under stock Electron', { skip: !process.versions.electron }, () => {
  const { protocol: original, hashes } = loadOriginal();
  assert.deepEqual(hashes, fixtures.hashes);
  for (const [index, entry] of fixtures.cases.entries()) {
    const args = unpack(entry.args);
    assert.deepEqual(invoke(protocol, entry.name, args), invoke(original, entry.name, args), `vector ${index}`);
  }
});
