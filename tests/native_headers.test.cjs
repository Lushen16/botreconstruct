const assert = require('node:assert/strict');
const test = require('node:test');
const { inspectPe } = require('../tools/audit_native.cjs');
function fixture() {
  const bytes = Buffer.alloc(512);
  bytes.write('MZ'); bytes.writeUInt32LE(64, 0x3c);
  bytes.write('PE\0\0', 64, 'binary'); bytes.writeUInt16LE(0x8664, 68);
  bytes.writeUInt16LE(1, 70); bytes.writeUInt16LE(112, 84); bytes.writeUInt16LE(0x20b, 88);
  bytes.write('.text', 200); bytes.writeUInt32LE(16, 216); bytes.writeUInt32LE(256, 220);
  return bytes;
}
test('PE fixture reports file-backed headers', () => {
  const result = inspectPe(fixture());
  assert.equal(result.valid_headers, true); assert.equal(result.machine, 0x8664);
});
test('invalid PE offset is reported without modifying source', () => {
  const bytes = fixture(); bytes.writeUInt32LE(0x202020f0, 0x3c);
  const original = Buffer.from(bytes);
  assert.equal(inspectPe(bytes).error, 'pe-header-out-of-file');
  assert.deepEqual(bytes, original);
});
test('PE rejects invalid signature, section ranges and short optional headers', () => {
  const signature = fixture(); signature[64] = 0;
  assert.equal(inspectPe(signature).error, 'invalid-pe-signature');
  const section = fixture(); section.writeUInt32LE(500, 220);
  assert.equal(inspectPe(section).error, 'section-out-of-file');
  const optional = fixture(); optional.writeUInt16LE(1, 84);
  assert.equal(inspectPe(optional).error, 'invalid-header-ranges');
  assert.equal(inspectPe(Buffer.alloc(4)).error, 'missing-dos-header');
});
