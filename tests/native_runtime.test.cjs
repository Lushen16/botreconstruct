'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const evidence = JSON.parse(fs.readFileSync(path.join(root, 'native_runtime_evidence.json'), 'utf8'));
const dump = fs.readFileSync(path.join(root, evidence.source));
const imageBase = BigInt(evidence.image_base);
const offsetOf = rva => Number(rva) - 0x1000;
const asciiAt = rva => {
  const start = offsetOf(rva);
  return dump.subarray(start, dump.indexOf(0, start)).toString('ascii');
};
const { sampleInclusiveInteger, nativeRandomDeadline, unitSampleFromNativeWords } = require('../reconstruction/engines/native-random.cjs');

test('runtime evidence binds all instruction bytes to the preserved dump', () => {
  assert.equal(crypto.createHash('sha256').update(dump).digest('hex'), evidence.sha256);
  assert.equal(evidence.target_executed, false);
  assert.equal(evidence.live_memory_read, false);
  for (const anchor of Object.values(evidence.anchors)) {
    const expected = Buffer.from(anchor.bytes, 'hex');
    assert.equal(Number(anchor.offset), offsetOf(anchor.rva));
    assert.deepEqual(dump.subarray(Number(anchor.offset), Number(anchor.offset) + expected.length), expected);
  }
});

test('quoted file offsets differ from RVA and compare resolves through the memcmp import', () => {
  const anchors = evidence.anchors;
  assert.equal(anchors.virtual_send.rva, '0x8461a');
  assert.equal(anchors.virtual_send.bytes, 'ff5010');
  assert.equal(anchors.compare_call.rva, '0x85633');
  assert.equal(anchors.compare_call.offset, '0x84633');
  const displacement = dump.readInt32LE(offsetOf(anchors.compare_call.rva) + 1);
  assert.equal(Number(anchors.compare_call.rva) + 5 + displacement, 0xd6e76);
  assert.equal(anchors.compare_thunk.rip_target_rva, '0xe2438');
  assert.equal(asciiAt(anchors.compare_key.rip_target_rva), 'creatureType');
  const imported = evidence.memcmp_import;
  const descriptor = offsetOf(imported.descriptor_rva);
  const intBase = dump.readUInt32LE(descriptor);
  const iatBase = dump.readUInt32LE(descriptor + 16);
  assert.equal(intBase, Number(imported.int_base_rva));
  assert.equal(iatBase, Number(imported.iat_base_rva));
  const name = Number(dump.readBigUInt64LE(offsetOf(intBase) + imported.index * 8));
  assert.equal(name, Number(imported.hint_name_rva));
  assert.equal(asciiAt(name + 2), 'memcmp');
  assert.equal(asciiAt(dump.readUInt32LE(descriptor + 12)), 'VCRUNTIME140.dll');
  assert.equal(iatBase + imported.index * 8, Number(imported.iat_slot_rva));
});

test('worker callback binding resolves to a Failure/Command adapter, not the string comparator', () => {
  for (const identity of Object.values(evidence.identities)) {
    const locator = Number(dump.readBigUInt64LE(offsetOf(identity.vtable_rva) - 8) - imageBase);
    assert.equal(locator, Number(identity.locator_rva));
    const descriptor = dump.readUInt32LE(offsetOf(locator) + 12);
    assert.equal(descriptor, Number(identity.type_descriptor_rva));
    assert.equal(asciiAt(descriptor + 16), identity.name);
    for (const [index, slot] of identity.slots.entries()) {
      assert.equal(dump.readBigUInt64LE(offsetOf(identity.vtable_rva) + index * 8) - imageBase, BigInt(slot));
    }
  }
  const anchors = evidence.anchors;
  assert.equal(anchors.send_binding_table.rip_target_rva, evidence.identities.send_callback.vtable_rva);
  assert.equal(anchors.send_binding_function.rip_target_rva, '0xcfe40');
  assert.equal(evidence.identities.send_callback.slots[2], '0xc6360');
  assert.equal(anchors.send_adapter_call.bytes, 'ff5008');
  assert.equal(anchors.runtime_ctor.direct_target_rva, '0x3dc20');
  assert.equal(anchors.bundle_move.direct_target_rva, '0x3e0e0');
  assert.match(evidence.identities.send_callback.name, /Failure.*Command/u);
  assert.equal(anchors.command_parse.direct_target_rva, '0xc8db0');
  assert.equal(anchors.pending_command.rva, '0xd04ea');
});

test('navigation and travel anchors preserve distinct planning and dispatch boundaries', () => {
  const anchors = evidence.anchors;
  assert.equal(anchors.route_tiles.string_candidate, 'tiles');
  assert.equal(anchors.route_walkable.string_candidate, 'walkable');
  assert.equal(anchors.route_creatures.string_candidate, 'creatures');
  assert.equal(anchors.route_search.direct_target_rva, '0x613e0');
  assert.equal(anchors.search_distance.direct_target_rva, '0x5d0f0');
  assert.equal(anchors.search_score_add.mnemonic, 'addsd');
  assert.equal(anchors.plan_closure.rip_target_rva, evidence.identities.plan.vtable_rva);
  assert.equal(anchors.plan_sides.direct_target_rva, '0x622b0');
  assert.equal(anchors.travel_route.direct_target_rva, '0x7df00');
  assert.equal(anchors.travel_walk_name.string_candidate, 'walk');
  assert.equal(anchors.travel_walk_send.direct_target_rva, '0x84340');
  assert.equal(anchors.tick_loot_jump.direct_target_rva, '0xa46e0');
});

test('inclusive random formula samples integer seconds rather than millisecond noise', () => {
  assert.equal(sampleInclusiveInteger(45, 100, 0), 45);
  assert.equal(sampleInclusiveInteger(45, 100, 0.5), 73);
  assert.equal(sampleInclusiveInteger(45, 100, 1 - Number.EPSILON), 100);
  assert.deepEqual(nativeRandomDeadline({}, 250, 0.5), { seconds: 73, until: 73250 });
  assert.deepEqual(nativeRandomDeadline({ randomMinSeconds: -3, randomMaxSeconds: 0 }, 100, 0), { seconds: 1, until: 1100 });
  assert.deepEqual(nativeRandomDeadline({ randomMinSeconds: 7.9, randomMaxSeconds: 3.8 }, 0, 0.9), { seconds: 7, until: 7000 });
  for (const invalid of [-1, 1, NaN, Infinity]) assert.throws(() => sampleInclusiveInteger(1, 2, invalid), RangeError);
  assert.throws(() => nativeRandomDeadline({ randomMinSeconds: 2147484 }, 0, 0), RangeError);
  assert.throws(() => sampleInclusiveInteger(-0x80000000, 0x7fffffff, 0.5), RangeError);
  for (const constant of evidence.constants) {
    assert.equal(dump.readDoubleLE(offsetOf(constant.rva)), constant.double);
    assert.equal(dump.subarray(offsetOf(constant.rva), offsetOf(constant.rva) + 8).toString('hex'), constant.bytes);
  }
  assert.equal(evidence.constants[0].double, 45);
  assert.equal(evidence.constants[1].double, 100);
});

test('recorded word conversion uses two generator words and the native 2^-53 scale', () => {
  assert.equal(evidence.constants[2].double, 2 ** -53);
  assert.equal(unitSampleFromNativeWords(0, 0), 0);
  assert.equal(unitSampleFromNativeWords(0, 0x80000000), 0.5);
  assert.equal(unitSampleFromNativeWords(0xffffffff, 0xffffffff), 1 - 2 ** -53);
  assert.throws(() => unitSampleFromNativeWords(-1, 0), RangeError);
  assert.throws(() => unitSampleFromNativeWords(0, 0x100000000), RangeError);
  assert.equal(evidence.anchors.word_first.direct_target_rva, '0xc5d50');
  assert.equal(evidence.anchors.word_second.direct_target_rva, '0xc5d50');
  assert.equal(evidence.anchors.random_sample.direct_target_rva, '0x64ea0');
  assert.equal(evidence.anchors.random_seconds_to_ms.bytes, '69c8e8030000');
});

test('local lure window consumes the recovered integer-second deadline helper', () => {
  const { createLureEngine } = require('../reconstruction/engines/lure-engine.cjs');
  const engine = createLureEngine({ target: { luring: { randomEnabled: true } } }, { rng: () => 0.5 });
  engine.step({}, { command() { throw new Error('No live dispatch expected'); } }, 250);
  assert.equal(engine.state.randomUntil, 73250);
  assert.equal(engine.state.nextCycleAt, 73250);
});

test('best tile construction and preflight are not evidence of a complete score formula', () => {
  const anchors = evidence.anchors;
  assert.equal(anchors.best_tile_closure_ctor.direct_target_rva, '0x2c7b0');
  assert.equal(anchors.best_tile_vtable.rip_target_rva, evidence.identities.best_tile.vtable_rva);
  assert.equal(anchors.best_tile_preflight_call.direct_target_rva, '0x41f00');
  assert.equal(anchors.best_tile_order.string_candidate, 'order');
  assert.equal(anchors.best_tile_send.direct_target_rva, '0x84340');
  assert.equal(anchors.random_binding_table.rip_target_rva, evidence.identities.random_double.vtable_rva);
  const contracts = JSON.parse(fs.readFileSync(path.join(root, 'reconstruction/spec/remaining-rules-v1.json'), 'utf8'));
  const matrix = JSON.parse(fs.readFileSync(path.join(root, 'reconstruction/spec/decision-rules-v1.json'), 'utf8'));
  for (const id of ['BestTileScore', 'NextTeam', 'HealerDeployReady', 'ComboBuffDone']) {
    assert.equal(contracts.rules.find(rule => rule.id === id).status, 'implementable');
    const decision = matrix.rules.find(rule => rule.id === id);
    assert.equal(decision.status, 'partial');
    assert.ok(decision.evidence.includes('native_remaining_rules_evidence.json'));
  }
});
