'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeItemSnapshot, EXECUTABLE_SHA256, LAYOUT_ID } = require('../reconstruction/item-source.cjs');

function fixture() {
  const player = { id: 0x10000001, name: 'Ash', creatureType: 0, ownershipVerified: true,
    struct_va: '0x1000', pos: { x: 100, y: 100, z: 7 } };
  const session = { pid: 42, telemetry: { playerName: 'Ash', position: player.pos, nativeVerified: false } };
  const scan = { schemaVersion: 1, pid: 42, generatedAt: new Date(1000).toISOString(),
    executableSha256: EXECUTABLE_SHA256, layoutId: LAYOUT_ID, complete: true, truncated: false,
    processStartedAt: 'one', moduleBase: '0x140000000', readErrors: [], player,
    itemIdentityProfile: { executableSha256: EXECUTABLE_SHA256, layoutId: LAYOUT_ID },
    items: [{ id: 4029, stack: 2, pos: player.pos, struct_va: '0x2000', tile_va: '0x3000' }] };
  return { session, scan };
}

test('item stream preserves RPM authority and never invents inventory counts', () => {
  const { session, scan } = fixture();
  const result = mergeItemSnapshot(session, scan, 1100).telemetry;
  assert.equal(result.nativeVerified, false);
  assert.equal(result.items[0].id, 4029);
  assert.equal(result.itemIdentityProfile.processStartedAt, 'one');
  assert.equal(result.itemCounts, undefined);
  assert.notEqual(result.items, scan.items);
});

test('item stream fails closed for stale, partial, wrong process or incompatible layouts', () => {
  const { session, scan } = fixture();
  for (const changes of [{ pid: 99 }, { schemaVersion: 2 }, { complete: false }, { truncated: true },
    { readErrors: ['failed'] }, { executableSha256: 'unknown' }, { layoutId: 'guessed' },
    { generatedAt: new Date(0).toISOString() }, { generatedAt: new Date(1200).toISOString() },
    { processStartedAt: null }, { items: [{ ...scan.items[0], tile_va: null }] },
    { player: { ...scan.player, pos: { x: 101, y: 100, z: 7 } } },
    { player: { ...scan.player, name: 'Other' } }]) {
    assert.throws(() => mergeItemSnapshot(session, { ...scan, ...changes }, 1100));
  }
});
