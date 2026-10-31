const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { FrameDecoder, MAX_BUFFERED } = require('../reconstruction/frame-decoder.cjs');
const { frame, MAX_FRAME } = require('../reconstruction/framing.cjs');
const { materialize, describe } = require('../tools/receiver_cases.cjs');
const fixtures = require('../receiver_vectors.json');

function observeIndependent(specification) {
  const decoder = new FrameDecoder();
  const steps = [];
  for (const input of specification.chunks) {
    try {
      const frames = decoder.push(materialize(input)).map(item => ({ kind: item.kind, payload: describe(item.payload) }));
      steps.push({ frames, pendingBytes: decoder.pendingBytes });
    } catch (error) { steps.push({ frames: [], error: error.message }); break; }
  }
  return steps;
}
test('receiver fixtures preserve module identity and digest', () => {
  assert.equal(fixtures.hashes['pipe-bridge'], 'f2047593c12388a5bb09286d010fa7422b7e626fb8ea60c0268023be310114b4');
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(fixtures.cases)).digest('hex'), fixtures.casesSha256);
  assert.equal(fixtures.maximumFrame, MAX_FRAME);
  assert.equal(fixtures.maximumBuffered, MAX_BUFFERED);
});
test('incremental decoder matches finite original consumption vectors', () => {
  for (const specification of fixtures.cases) assert.deepEqual(observeIndependent(specification), specification.observed, specification.name);
});
test('one-byte chunks and caller mutation preserve an independent payload', () => {
  const payload = Buffer.alloc(65536, 165);
  const decoder = new FrameDecoder();
  const outputs = [];
  const bytes = frame(4, payload);
  for (const byte of bytes) {
    const chunk = Buffer.from([byte]);
    outputs.push(...decoder.push(chunk));
    chunk.fill(0);
  }
  assert.equal(outputs.length, 1);
  assert.deepEqual(outputs[0], { kind: 4, payload });
  assert.equal(decoder.pendingBytes, 0);
  decoder.end();
});
test('bad length clears partial state and requires explicit reset', () => {
  const decoder = new FrameDecoder();
  const header = Buffer.alloc(8);
  header.writeUInt32LE(MAX_FRAME + 1, 0);
  assert.throws(() => decoder.push(header), /Frame inv/u);
  assert.equal(decoder.pendingBytes, 0);
  assert.equal(decoder.payload, null);
  assert.throws(() => decoder.push(frame(4, Buffer.alloc(0))), /reset is required/u);
  decoder.reset();
  assert.equal(decoder.push(frame(4, Buffer.alloc(0))).length, 1);
});
test('truncated streams fail closed and complete streams end cleanly', () => {
  for (const length of [1, 7, 8, 9]) {
    const decoder = new FrameDecoder();
    decoder.push(frame(4, Buffer.alloc(2)).subarray(0, length));
    assert.throws(() => decoder.end(), /Truncated frame/u);
    assert.equal(decoder.pendingBytes, 0);
  }
  const decoder = new FrameDecoder();
  decoder.push(frame(4, Buffer.alloc(0)));
  decoder.end();
  assert.throws(() => decoder.push(Buffer.alloc(0)), /closed/u);
});
test('invalid chunk types do not alter buffered bytes', () => {
  const decoder = new FrameDecoder();
  decoder.push(Buffer.from([1]));
  for (const value of [null, [], 'bytes', new Uint8Array(3)]) assert.throws(() => decoder.push(value), TypeError);
  assert.equal(decoder.pendingBytes, 1);
});
test('buffer limit is enforced before processing coalesced input', () => {
  const decoder = new FrameDecoder();
  assert.throws(() => decoder.push(Buffer.alloc(MAX_BUFFERED + 1)), /Frame excedeu/u);
  assert.equal(decoder.pendingBytes, 0);
});
test('an invalid trailing header discards the current push and buffered state', () => {
  const decoder = new FrameDecoder();
  const invalid = Buffer.alloc(8);
  invalid.writeUInt32LE(MAX_FRAME + 1, 0);
  assert.throws(() => decoder.push(Buffer.concat([frame(4, Buffer.from('synthetic')), invalid])), /Frame inv/u);
  assert.equal(decoder.pendingBytes, 0);
  assert.throws(() => decoder.push(Buffer.alloc(0)), /reset is required/u);
  decoder.reset();
  assert.deepEqual(decoder.push(frame(4, Buffer.from('fresh'))), [{ kind: 4, payload: Buffer.from('fresh') }]);
});
test('live original byte consumption matches fixtures in compatible Electron', { skip: process.versions.electron !== '44.7.2' }, () => {
  const { observe } = require('../tools/probe_receive_vectors.cjs');
  const { blockedCalls } = require('../tools/probe_bridge_exports.cjs');
  for (const specification of fixtures.cases) assert.deepEqual(observe(specification), specification.observed, specification.name);
  assert.equal(blockedCalls.length, 0);
});
