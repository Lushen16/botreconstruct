const crypto = require('node:crypto');
const { frame, MAX_FRAME } = require('../reconstruction/framing.cjs');
const MAX_BUFFERED = 2170888;
const describe = bytes => ({ bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
function materialize(specification) {
  if (typeof specification === 'string') return Buffer.from(specification, 'hex');
  const result = Buffer.alloc(specification.bytes);
  if (specification.header) {
    result.writeUInt32LE(specification.header.length, 0);
    result.writeUInt32LE(specification.header.kind, 4);
  }
  return result;
}
function buildCases() {
  const cases = [{ name: 'empty', chunks: [''] }];
  const sample = frame(4, Buffer.from('synthetic-state'));
  for (let split = 0; split <= sample.length; split++) {
    cases.push({ name: 'every-split-' + split, chunks: [sample.subarray(0, split).toString('hex'), '', sample.subarray(split).toString('hex')] });
  }
  const sequence = Buffer.concat([frame(4, Buffer.alloc(48, 127)), frame(13, Buffer.from([1, 0, 255])), frame(10, Buffer.alloc(12, 165)), frame(0, Buffer.alloc(0))]);
  for (const size of [1, 2, 3, 7, 8, 9, 16, 31, 1024]) {
    const chunks = [];
    for (let offset = 0; offset < sequence.length; offset += size) chunks.push(sequence.subarray(offset, offset + size).toString('hex'));
    cases.push({ name: 'coalesced-and-fragmented-' + size, chunks });
  }
  for (let size = 1; size <= 7; size++) cases.push({ name: 'incomplete-header-' + size, chunks: [sample.subarray(0, size).toString('hex')] });
  cases.push({ name: 'incomplete-body', chunks: [sample.subarray(0, sample.length - 1).toString('hex')] });
  cases.push({ name: 'zero-payload', chunks: [frame(13, Buffer.alloc(0)).toString('hex')] });
  cases.push({ name: 'maximum-kind', chunks: [frame(4294967295, Buffer.from([255])).toString('hex')] });
  cases.push({ name: 'maximum-declared-incomplete', chunks: [{ bytes: 8, header: { length: MAX_FRAME, kind: 4 } }] });
  cases.push({ name: 'maximum-complete', chunks: [{ bytes: MAX_FRAME + 8, header: { length: MAX_FRAME, kind: 4 } }] });
  cases.push({ name: 'payload-over-limit', chunks: [{ bytes: 8, header: { length: MAX_FRAME + 1, kind: 4 } }] });
  cases.push({ name: 'maximum-buffer-header-invalid', chunks: [{ bytes: MAX_BUFFERED, header: { length: MAX_FRAME + 1, kind: 4 } }] });
  cases.push({ name: 'buffer-over-limit', chunks: [{ bytes: MAX_BUFFERED + 1, header: { length: MAX_FRAME + 1, kind: 4 } }] });
  cases.push({ name: 'buffer-over-limit-across-chunks', chunks: ['00', { bytes: MAX_BUFFERED }] });
  return cases;
}
module.exports = { buildCases, materialize, describe };
