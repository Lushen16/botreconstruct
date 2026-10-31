'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const TargetEngine = require('../target-engine.cjs');

const player = { x: 100, y: 100, z: 7, name: 'Player' };
const creature = (id, patch = {}) => ({
  id, name: 'Dragonite', pos: { x: 102, y: 102, z: 7 }, healthPercent: 80, ...patch,
});

test('UI monster rows accept priorities, prefix wildcards and per-row ranges', () => {
  const engine = new TargetEngine({ priorityMode: 'highestPriorityList', maxDistance: 20,
    monsters: [{ name: 'Shiny *', priority: 1, range: 4 }, { name: 'Dragonite', priority: 2, range: 2 }] });
  const shiny = creature(1, { name: 'Shiny Dragonite', pos: { x: 104, y: 100, z: 7 } });
  assert.equal(engine.selectTarget(player, [creature(2), shiny]), shiny);
  assert.equal(engine.selectTarget(player, [{ ...shiny, pos: { x: 105, y: 100, z: 7 } }, creature(2)]).id, 2);
});

test('filters malformed snapshots, self, dead, floor, distance and monster names', () => {
  const engine = new TargetEngine({ monsters: ['DRAGONITE'], maxDistance: 2 });
  const valid = creature(10);
  assert.equal(engine.selectTarget(player, [null, {}, creature(1, { name: 'PLAYER' }),
    creature(2, { healthPercent: 0 }), creature(3, { healthPercent: NaN }),
    creature(4, { pos: { x: 100, y: 100, z: 8 } }),
    creature(5, { pos: { x: 103, y: 100, z: 7 } }),
    creature(6, { name: 'Charizard' }), creature(7, { id: null }), valid]), valid);
  assert.equal(engine.isFighting(), true);
  assert.equal(engine.selectTarget(null, [valid]), null);
  assert.equal(engine.isFighting(), false);
  assert.equal(engine.selectTarget(player, null), null);
  assert.equal(engine.selectTarget(player, [valid], { monsters: [] }), null);
  assert.equal(engine.selectTarget(player, [valid], { maxDistance: NaN }), null);
});

test('supports all priorities, wildcard and nearest tie breaks', () => {
  const near = creature(1, { pos: { x: 101, y: 100, z: 7 } });
  const low = creature(2, { healthPercent: 10 });
  const priority = creature(3, { name: 'Shiny Charizard' });
  const monsters = ['Shiny Charizard', 'Dragonite', '*'];
  for (const [priorityMode, expected] of [
    ['nearest', near], ['lowestHp', low], ['highestPriorityList', priority],
  ]) {
    const engine = new TargetEngine({ monsters, priorityMode });
    assert.equal(engine.selectTarget(player, [low, priority, near]), expected);
  }
  assert.equal(new TargetEngine({ monsters: ['*'] })
    .selectTarget(player, [creature(4, { name: 'Other' })]).id, 4);
});

test('refreshes lock by ID and releases on death, disappearance, distance or floor', () => {
  for (const invalid of [null, { healthPercent: 0 },
    { pos: { x: 109, y: 100, z: 7 } }, { pos: { x: 100, y: 100, z: 8 } }]) {
    const engine = new TargetEngine();
    engine.selectTarget(player, [creature(1)]);
    const refreshed = creature(1, { healthPercent: 15 });
    const closer = creature(2, { pos: { x: 100, y: 101, z: 7 } });
    assert.equal(engine.selectTarget(player, [closer, refreshed]), refreshed);
    assert.equal(engine.selectTarget(player, invalid ? [creature(1, invalid), closer] : [closer]), closer);
    engine.selectTarget(player, []);
    assert.equal(engine.isFighting(), false);
  }
});

test('GCD, per-key cooldown, circular rotation and exact timing boundaries', () => {
  let now = 0;
  const engine = new TargetEngine({ globalCooldownMs: 250, skills: [
    { key: 'F1', cooldownMs: 1000 }, { key: 'f2', cooldownMs: 500 },
  ] }, { now: () => now });
  engine.selectTarget(player, [creature(1)]);
  assert.deepEqual(engine.getCombatAction(player), { type: 'key', key: 'f1', targetId: 1 });
  now = 249;
  assert.equal(engine.getCombatAction(player), null);
  now = 250;
  assert.equal(engine.getCombatAction(player).key, 'f2');
  now = 500;
  assert.equal(engine.getCombatAction(player), null);
  now = 750;
  assert.equal(engine.getCombatAction(player).key, 'f2');
  now = 1000;
  assert.equal(engine.getCombatAction(player).key, 'f1');
  now = 900;
  assert.equal(engine.getCombatAction(player), null);
});

test('skips invalid range/health rules without consuming GCD', () => {
  const config = { skills: [null, {}, { key: 'bad', cooldownMs: -1 },
    { key: 'bad', minDistance: 3 }, { key: 'bad', maxDistance: 1 },
    { key: 'bad', onlyIfHpAbove: 80 }, { key: 'bad', onlyIfHpBelow: 80 },
    { key: 'bad', onlyIfHpBelow: NaN }, { key: 'bad', minDistance: 4, maxDistance: 2 },
  ] };
  const engine = new TargetEngine(config, { now: () => 0 });
  engine.selectTarget(player, [creature(1)]);
  assert.equal(engine.getCombatAction(player), null);
  config.skills.push({ key: '1', minDistance: 2, maxDistance: 2,
    onlyIfHpAbove: 79, onlyIfHpBelow: 81 });
  assert.equal(engine.getCombatAction(player).key, '1');
});

test('cooldowns persist across targets and keys normalize case', () => {
  let now = 0;
  const engine = new TargetEngine({ globalCooldownMs: 0, skills: [
    { key: 'F1', cooldownMs: 1000 }, { key: ' f1 ', cooldownMs: 1000 },
  ] }, { now: () => now });
  engine.selectTarget(player, [creature(1)]);
  assert.equal(engine.getCombatAction(player).targetId, 1);
  engine.clearTarget();
  assert.equal(engine.isFighting(), false);
  engine.selectTarget(player, [creature(2)]);
  now = 999;
  assert.equal(engine.getCombatAction(player), null);
  now = 1000;
  assert.equal(engine.getCombatAction(player).targetId, 2);
});

test('action validates floor again and copies isolate caller mutations', () => {
  const engine = new TargetEngine({ skills: [{ key: 'f1' }] });
  const target = creature(1);
  engine.selectTarget(player, [target]);
  target.pos.z = 8;
  assert.equal(engine.getCombatAction(player).targetId, 1);
  assert.equal(engine.getCombatAction({ ...player, z: 8 }), null);
  assert.equal(engine.isFighting(), false);
  assert.equal(engine.getCombatAction(player), null);
});

test('invalid clocks, config and GCD produce no action', () => {
  for (const now of [() => NaN, () => { throw new Error('clock'); }]) {
    const engine = new TargetEngine({ skills: [{ key: 'f1' }] }, { now });
    engine.selectTarget(player, [creature(1)]);
    assert.equal(engine.getCombatAction(player), null);
  }
  const engine = new TargetEngine();
  engine.selectTarget(player, [creature(1)]);
  assert.equal(engine.getCombatAction(player, { globalCooldownMs: -1, skills: [{ key: 'f1' }] }), null);
  assert.equal(engine.getCombatAction(player, null), null);
  assert.equal(engine.isFighting(), false);
});

test('circular rotation gives every ready skill a turn', () => {
  const engine = new TargetEngine({ globalCooldownMs: 0,
    skills: [{ key: '1' }, { key: '2' }, { key: '3' }] }, { now: () => 0 });
  engine.selectTarget(player, [creature(0)]);
  assert.deepEqual(Array.from({ length: 5 }, () => engine.getCombatAction(player).key),
    ['1', '2', '3', '1', '2']);
});

test('refreshed locked HP determines skill gates without switching to a weaker target', () => {
  const engine = new TargetEngine({ priorityMode: 'lowestHp',
    skills: [{ key: 'f1', onlyIfHpBelow: 20 }] });
  engine.selectTarget(player, [creature(1)]);
  assert.equal(engine.getCombatAction(player), null);
  engine.selectTarget(player, [creature(2, { healthPercent: 1 }), creature(1, { healthPercent: 10 })]);
  assert.deepEqual(engine.getCombatAction(player), { type: 'key', key: 'f1', targetId: 1 });
});

test('ties preserve scanner order and changed allowlist invalidates the lock', () => {
  const engine = new TargetEngine();
  const first = creature(1);
  assert.equal(engine.selectTarget(player, [first, creature(2)]), first);
  assert.equal(engine.selectTarget(player, [first], { monsters: ['Charizard'] }), null);
  assert.equal(engine.isFighting(), false);
});

test('shared candidate filter rejects player and attack flags without changing the lock', () => {
  const engine = new TargetEngine();
  const valid = creature(7, { canAttack: true, is_player: false });
  engine.selectTarget(player, [valid]);
  assert.deepEqual(engine.filterCandidates(player, [creature(1, { is_player: true }),
    creature(2, { canAttack: false }), valid]), [valid]);
  assert.deepEqual(engine.filterCandidates(null, [valid]), []);
  assert.deepEqual(engine.filterCandidates(player, null), []);
  assert.deepEqual(engine.filterCandidates(player, [valid], null), []);
  assert.deepEqual(engine.filterCandidates(player, [valid], { maxDistance: NaN }), []);
  assert.deepEqual(engine.filterCandidates(player, [valid], { monsters: null }), []);
  assert.equal(engine.isFighting(), true);
});
