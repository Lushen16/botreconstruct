const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const framing = require('../reconstruction/framing.cjs');
const fixtures = require('../framing_vectors.json');
const { unpack } = require('../tools/probe_protocol_vectors.cjs');

test('frame fixture identity and constants are preserved', () => {
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(fixtures.cases)).digest('hex'), fixtures.casesSha256);
  assert.deepEqual(framing.KIND, fixtures.KIND);
  assert.equal(framing.MAX_FRAME, fixtures.MAX_FRAME);
});
test('independent framing matches every captured Buffer vector', () => {
  for (const entry of fixtures.cases) {
    assert.equal(framing.frame(unpack(entry.kind), Buffer.from(entry.payloadHex, 'hex')).toString('hex'), entry.observedHex);
  }
});
test('frame contains payload length, kind and an independent payload copy', () => {
  const payload = Buffer.from('sample');
  const encoded = framing.frame(framing.KIND.state, payload);
  assert.equal(encoded.readUInt32LE(0), payload.length);
  assert.equal(encoded.readUInt32LE(4), framing.KIND.state);
  assert.deepEqual(encoded.subarray(8), payload);
  payload.fill(0);
  assert.equal(encoded.subarray(8).toString(), 'sample');
});
test('non-Buffer payloads are explicitly rejected', () => {
  for (const payload of [null, undefined, 'abc', {}, [], new Uint8Array(3)]) {
    assert.throws(() => framing.frame(4, payload), { name: 'TypeError', message: 'Frame payload must be a Buffer.' });
  }
});
test('invalid kind range is rejected by uint32 encoding', () => {
  for (const kind of [-1, 4294967296, Infinity]) assert.throws(() => framing.frame(kind, Buffer.alloc(0)), RangeError);
});
test('live original frame vectors match in compatible Electron', { skip: process.versions.electron !== '44.7.2' }, () => {
  const { bridge, blockedCalls } = require('../tools/probe_bridge_exports.cjs');
  for (const entry of fixtures.cases) {
    const kind = unpack(entry.kind);
    const payload = Buffer.from(entry.payloadHex, 'hex');
    assert.deepEqual(framing.frame(kind, payload), bridge.frame(kind, payload));
  }
  const large = Buffer.alloc(framing.MAX_FRAME + 1);
  assert.deepEqual(framing.frame(4, large), bridge.frame(4, large));
  assert.equal(blockedCalls.length, 0);
});
