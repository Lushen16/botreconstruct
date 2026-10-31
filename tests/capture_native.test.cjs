'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const evidence = require('../native_capture_evidence.json');
const { compareCaptureCandidates } = require('../reconstruction/engines/capture-engine.cjs');
const dump = fs.readFileSync(path.join(__dirname, '..', evidence.source));
const imageBase = BigInt(evidence.image_base);
const offsetOf = rva => Number(rva) - 0x1000;

function evaluatePredicate(bytes, args) {
  const stack = [];
  for (let cursor = 0; cursor < bytes.length; cursor += 1) {
    const opcode = bytes[cursor];
    if (opcode === 0x56) stack.push(args[bytes[++cursor]]);
    else if (opcode === 0x45) { stack.push(bytes.readDoubleLE(cursor + 1)); cursor += 8; }
    else if (opcode === 0x1b) stack.push(Number(!stack.pop()));
    else if (opcode === 0x5c) {
      assert.equal(stack.length, 1);
      assert.equal(cursor, bytes.length - 1);
      return Boolean(stack[0]);
    } else {
      assert.ok(stack.length >= 2);
      const right = stack.pop();
      const left = stack.pop();
      const operations = { 0x01: () => left <= right, 0x8c: () => left < right,
        0x49: () => left === right, 0x48: () => Boolean(left) && Boolean(right),
        0x42: () => Boolean(left) || Boolean(right) };
      assert.ok(operations[opcode], 'Unexpected static predicate opcode');
      stack.push(Number(operations[opcode]()));
    }
  }
  throw new Error('Missing static predicate return');
}

test('native capture evidence pins dump identity, coordinates and all assembly anchors', () => {
  assert.equal(crypto.createHash('sha256').update(dump).digest('hex'), evidence.sha256);
  assert.equal(evidence.target_executed, false);
  for (const anchor of Object.values(evidence.anchors)) {
    const expected = Buffer.from(anchor.bytes, 'hex');
    assert.equal(Number(anchor.offset), offsetOf(anchor.rva));
    assert.deepEqual(dump.subarray(Number(anchor.offset), Number(anchor.offset) + expected.length), expected);
  }
  assert.equal(evidence.anchors.distance_max.mnemonic, 'maxsd');
  assert.equal(evidence.anchors.send_call.direct_target_rva, '0x84340');
  assert.equal(evidence.identities.tickLoot.slots[2], '0x4e440');
  assert.equal(evidence.anchors.guard_thunk_call.direct_target_rva, '0x4a880');
  assert.equal(evidence.anchors.dispatch_virtual_call.bytes, 'ff5010');
  assert.equal(evidence.anchors.loot_closure.rip_target_rva, evidence.identities.tickLoot.vtable_rva);
  assert.equal(evidence.anchors.send_closure.rip_target_rva, evidence.identities.send.vtable_rva);
  const targets = { 0x01: '0x60cb4', 0x8c: '0x60ca0', 0x49: '0x60cc8', 0x48: '0x60cd5', 0x42: '0x60cdf' };
  for (const [opcode, target] of Object.entries(targets)) {
    const slot = dump[offsetOf(0x61164) + Number(opcode) - 1];
    assert.equal(dump.readUInt32LE(offsetOf(0x61130) + slot * 4), Number(target));
    assert.equal(evidence.binary_opcode_targets['0x' + Number(opcode).toString(16)], target);
  }
});

test('tickLoot and send identities follow vtable to complete object locator and RTTI', () => {
  for (const [name, identity] of Object.entries(evidence.identities)) {
    const locator = Number(dump.readBigUInt64LE(offsetOf(identity.vtable_rva) - 8) - imageBase);
    assert.equal(locator, Number(identity.locator_rva));
    assert.equal(dump.readUInt32LE(offsetOf(locator)), 1);
    const descriptor = dump.readUInt32LE(offsetOf(locator) + 12);
    assert.equal(descriptor, Number(identity.type_descriptor_rva));
    const start = offsetOf(descriptor) + 16;
    assert.equal(dump.subarray(start, dump.indexOf(0, start)).toString('ascii'), identity.name);
    assert.ok(identity.name.includes('??' + name + '@Runtime'));
  }
});

test('native predicate descriptors decrypt from preserved bytes without executing native code', () => {
  const expected = ['560056015602014856031b485c', '560045000000000000000056018c485c', '560056028c5600560249560356018c48425c'];
  for (const [index, predicate] of evidence.predicates.entries()) {
    const descriptor = offsetOf(predicate.descriptor_rva);
    const codeOffset = Number(dump.readBigUInt64LE(descriptor) - imageBase) - 0x1000;
    const length = Number(dump.readBigUInt64LE(descriptor + 8));
    const seed = dump.readUInt32LE(descriptor + 16);
    const decoded = Buffer.alloc(length);
    for (let cursor = 0; cursor < length; cursor += 1) {
      let mixed = (seed - Math.imul(cursor, 0x61c88647)) >>> 0;
      mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b) >>> 0;
      decoded[cursor] = dump[codeOffset + cursor] ^ ((mixed >>> 13) & 255) ^ (mixed & 255);
    }
    assert.equal(decoded.toString('hex'), expected[index]);
    assert.equal(decoded.toString('hex'), predicate.decoded_hex);
  }
});

test('distance and stack comparator matches the decoded native predicate over 1296 pairs', () => {
  const bytecode = Buffer.from(evidence.predicates[2].decoded_hex, 'hex');
  const history = { lastAttemptAt: 0, attempts: 0, failures: 0 };
  let checked = 0;
  for (const distance of [0, 1, 2, 3, 10, 30]) for (const stack of [0, 1, 2, 3, 254, 255]) {
    for (const bestDistance of [0, 1, 2, 3, 10, 30]) for (const bestStack of [0, 1, 2, 3, 254, 255]) {
      const candidate = { item: { stack }, distance, history };
      const best = { item: { stack: bestStack }, distance: bestDistance, history };
      assert.equal(compareCaptureCandidates(candidate, best) < 0,
        evaluatePredicate(bytecode, [distance, stack, bestDistance, bestStack]));
      checked += 1;
    }
  }
  assert.equal(checked, 1296);
});

test('decoded range gate includes the boundary and is not an adjacency-only check', () => {
  const bytecode = Buffer.from(evidence.predicates[0].decoded_hex, 'hex');
  assert.equal(evaluatePredicate(bytecode, [1, 3, 3, 0]), true);
  assert.equal(evaluatePredicate(bytecode, [1, 4, 3, 0]), false);
  assert.equal(evaluatePredicate(bytecode, [0, 1, 3, 0]), false);
});
