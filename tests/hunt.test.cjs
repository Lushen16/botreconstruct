'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAutomation, createRecorder } = require('../reconstruction/automation.cjs');

function setup() {
  let now = 1000;
  const automation = createAutomation({
    target: { monsters: ['Wild'], maxDistance: 8, skills: [{ key: 'f1', cooldownMs: 1000 }] },
    hoenn: { perfectLure: true, minWildsToEngage: 8, potionHpPercent: 80, potionHotkey: 'f12' },
    healer: {},
    walker: { waypoints: [{ action: 'walk', pos: { x: 110, y: 100, z: 7 } }] },
  }, { hunt: { healBelow: 80, resumeAbove: 90 }, now: () => now });
  const creature = { id: 7, name: 'Wild', canAttack: true, healthPercent: 100, pos: { x: 101, y: 100, z: 7 } };
  function tick(healthPercent, creatures = [], patch = {}) {
    const recorder = createRecorder();
    const result = automation.tick({ pid: 10, online: true, ageMs: 0,
      telemetry: { nativeVerified: true, pulseVersion: 3, position: { x: 100, y: 100, z: 7 },
        playerName: 'Player', healthPercent, creatures }, ...patch }, recorder);
    now += 200;
    return { ...result, events: recorder.events };
  }
  return { automation, creature, tick };
}

test('hunt prioritizes combat and holds healing across cooldown until recovery', () => {
  const { creature, tick, automation } = setup();
  const combat = tick(50, [creature]);
  assert.equal(combat.status, 'combat');
  assert.equal(combat.pauseWalker, true);
  assert.ok(combat.events.some(event => event.parameter === 'f1'));
  assert.ok(!combat.events.some(event => event.parameter === 'f12' || event.name === 'walk'));
  assert.equal(tick(50).status, 'heal');
  assert.equal(tick(50).pauseWalker, true);
  assert.equal(tick(85).pauseWalker, true);
  assert.equal(automation.state.walker.index, 0);
  assert.equal(tick(91).pauseWalker, false);
});

test('new enemy interrupts healing and unknown data never releases walker', () => {
  const { creature, tick } = setup();
  tick(50);
  assert.equal(tick(50, [creature]).status, 'combat');
  for (const health of [null, undefined, NaN, '90', -1, 101]) {
    const result = tick(health);
    assert.equal(result.status, 'blocked');
    assert.equal(result.pauseWalker, true);
    assert.deepEqual(result.events, []);
  }
  assert.equal(tick(100, [{ ...creature, canAttack: null }]).status, 'blocked');
  assert.equal(tick(100, [], { stale: true }).pauseWalker, true);
});

test('only configured living same-floor in-range targets stop walking', () => {
  const { creature, tick } = setup();
  for (const patch of [{ healthPercent: 0 }, { canAttack: false }, { name: 'Ignored' },
    { pos: { x: 101, y: 100, z: 8 } }, { pos: { x: 109, y: 100, z: 7 } }]) {
    assert.equal(tick(100, [{ ...creature, ...patch }]).pauseWalker, false);
  }
  assert.equal(tick(100, [{ ...creature, pos: { x: 108, y: 100, z: 7 } }]).pauseWalker, true);
  assert.equal(tick(100, [creature]).pauseWalker, true);
});

test('healing threshold is inclusive and unavailable healing holds indefinitely', () => {
  const { tick } = setup();
  assert.equal(tick(80).pauseWalker, true);
  assert.equal(tick(80).pauseWalker, true);
  assert.equal(tick(90).pauseWalker, true);
  assert.equal(tick(91).pauseWalker, false);
  const automation = createAutomation({ target: { maxDistance: 8 }, hoenn: {}, healer: {}, walker: {} },
    { hunt: { healBelow: 80 }, now: () => 1000 });
  const result = automation.tick({ online: true, telemetry: { nativeVerified: true, pulseVersion: 3,
    position: { x: 100, y: 100, z: 7 }, healthPercent: 80, creatures: [] } });
  assert.equal(result.status, 'heal');
  assert.equal(result.pauseWalker, true);
  assert.deepEqual(result.emitted, []);
});

test('hunt revives after the last skill and waits for active roster confirmation', () => {
  let now = 1000;
  const automation = createAutomation({
    target: { monsters: ['Wild'], maxDistance: 8, skills: [{ key: 'f1', cooldownMs: 1000 }],
      autoRevive: { enabled: true, hotkey: 'f9', interval: 500, waitForPokemon: true } },
    hoenn: {}, healer: {},
    walker: { waypoints: [{ action: 'walk', pos: { x: 110, y: 100, z: 7 } }] },
  }, { hunt: { healBelow: 80, resumeAbove: 90 }, now: () => now });
  const creature = { id: 7, name: 'Wild', canAttack: true, healthPercent: 100, pos: { x: 101, y: 100, z: 7 } };
  const tick = (time, creatures, active = false) => {
    now = time;
    return automation.tick({ pid: 10, online: true, ageMs: 0,
      telemetry: { nativeVerified: true, pulseVersion: 3, position: { x: 100, y: 100, z: 7 },
        playerName: 'Player', healthPercent: 100, creatures, activeSlot: active ? 1 : 0,
        pokemonName: active ? 'Fighter' : '', roster: active ? [{ slot: 1, name: 'Fighter', uuid: 'fighter' }] : [] } });
  };
  const finalSkill = tick(1000, [creature], true);
  assert.equal(finalSkill.status, 'revive');
  assert.ok(finalSkill.emitted.some(([name, key]) => name === 'hotkey' && key === 'f1'));
  assert.deepEqual(tick(1499, [creature], true).emitted, []);
  assert.deepEqual(tick(1500, [creature], true).emitted, [['hotkey', 'f9']]);
  assert.equal(tick(5000, []).status, 'revive');
  const walking = tick(5001, [], true);
  assert.equal(walking.status, 'walking');
  assert.equal(walking.pauseWalker, false);
});
