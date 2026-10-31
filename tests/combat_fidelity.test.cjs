'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAutomation, createRecorder } = require('../reconstruction/automation.cjs');
const { createTargetEngine } = require('../reconstruction/engines/target-engine.cjs');
const { encodeCommand } = require('../reconstruction/protocol.cjs');

const party = [{ slot: 1, name: 'Fighter', uuid: 'fighter' }, { slot: 2, name: 'Healer', uuid: 'healer' }];
const wild = { id: 7, name: 'Wild', canAttack: true, healthPercent: 100, pos: { x: 101, y: 100, z: 7 } };
function telemetry(patch = {}) {
  return { position: { x: 100, y: 100, z: 7 }, nativeVerified: true, pulseVersion: 3,
    healthPercent: 100, playerName: 'Player', activeSlot: 1, pokemonName: 'Fighter',
    roster: party, creatures: [wild], conditions: [], ...patch };
}
function setup({ hunt = false, waitForPokemon = true, healer = {}, target = {} } = {}) {
  let now = 0;
  const settings = { target: { maxDistance: 8, combo: { enabled: true, sequenceText: 'm1, m2', stepDelay: 250 },
    autoRevive: { enabled: true, hotkey: 'F9', interval: 1500, waitForPokemon }, ...target },
    hoenn: {}, healer, walker: { waypoints: [{ action: 'walk', pos: { x: 110, y: 100, z: 7 } }] } };
  const automation = createAutomation(settings, { now: () => now, ...(hunt ? { hunt: { healBelow: 80 } } : {}) });
  return { automation, tick(time, patch = {}) {
    now = time;
    const recorder = createRecorder();
    const result = automation.tick({ pid: 10, online: true, ageMs: 0, telemetry: telemetry(patch) }, recorder);
    for (const event of recorder.events) encodeCommand(1, event.name, event.parameter, event.extra);
    return { ...result, events: recorder.events };
  } };
}

test('native fallback accepts the exact identity envelope in the encoder', () => {
  const engine = createTargetEngine({ target: { combo: { enabled: true, useNativeSequence: true } } });
  const sink = createRecorder();
  engine.step(telemetry(), sink, 0);
  const command = sink.events.find(event => event.name === 'combo');
  assert.deepEqual(command.extra, { expectedUuid: 'fighter' });
  assert.doesNotThrow(() => encodeCommand(1, command.name, command.parameter, command.extra));
});

for (const hunt of [false, true]) {
  test('completed combo revives with enemies visible in ' + (hunt ? 'hunt' : 'main pipeline'), () => {
    const { tick } = setup({ hunt });
    assert.ok(tick(0).emitted.some(([name, value]) => name === 'talk' && value === 'm1'));
    assert.ok(tick(250).emitted.some(([name, value]) => name === 'talk' && value === 'm2'));
    assert.equal(tick(1749).status, 'revive');
    assert.deepEqual(tick(1750).emitted, [['hotkey', 'F9']]);
    assert.ok(tick(1751).emitted.some(([name, value]) => name === 'talk' && value === 'm1'));
  });
}

test('revive waits for a matching active roster, not an elapsed fixed delay', () => {
  const { tick } = setup();
  tick(0); tick(250); tick(1750);
  for (const patch of [{ pokemonName: '', activeSlot: 0, roster: [] }, { roster: [] },
    { activeSlot: 2 }, { roster: [...party, party[0]] }, { switchPending: true }]) {
    const result = tick(5000, { creatures: [], ...patch });
    assert.equal(result.status, 'revive');
    assert.deepEqual(result.emitted, []);
  }
  assert.equal(tick(5001, { creatures: [] }).status, 'walking');
});

test('revive without waitForPokemon continues next tick without a synthetic delay', () => {
  const { tick } = setup({ waitForPokemon: false });
  tick(0); tick(250); tick(1750);
  assert.equal(tick(1751, { creatures: [], pokemonName: '', roster: [] }).status, 'walking');
});

test('revive state clears on reset and does not start merely because enemies disappear', () => {
  const { tick, automation } = setup();
  tick(0); tick(250);
  automation.reset();
  const result = tick(5000, { creatures: [] });
  assert.equal(result.status, 'walking');
  assert.ok(!result.events.some(event => event.parameter === 'F9'));
  const fresh = setup();
  fresh.tick(0);
  assert.ok(!fresh.tick(5000, { creatures: [] }).events.some(event => event.parameter === 'F9'));
});

test('healer return stays pending until active name, slot and roster agree', () => {
  const { tick } = setup({ healer: { returnPokemonName: 'Fighter' },
    target: { combo: { enabled: false }, autoRevive: { enabled: false } } });
  assert.ok(tick(0, { creatures: [], pokemonName: 'Healer', activeSlot: 2 }).events.some(event => event.name === 'switchPokemon'));
  for (const patch of [{ pokemonName: '', roster: [], activeSlot: 0 }, { roster: [] }, { activeSlot: 2 }]) {
    const result = tick(6000, { creatures: [], ...patch });
    assert.equal(result.status, 'heal');
    assert.ok(!result.events.some(event => event.name === 'walk'));
  }
  assert.equal(tick(6001, { creatures: [] }).status, 'walking');
});

test('opaque native dispatch does not fabricate a completed rotation', () => {
  const { tick } = setup({ target: { combo: { enabled: true, useNativeSequence: true } } });
  assert.ok(tick(0).events.some(event => event.name === 'combo'));
  const result = tick(10000);
  assert.ok(!result.events.some(event => event.parameter === 'F9'));
});


test('revive interval follows actual final-skill dispatch time', () => {
  const { tick, automation } = setup();
  tick(0); tick(250);
  automation.recordDispatch('talk', 'm2', 1000);
  assert.deepEqual(tick(2499).emitted, []);
  assert.deepEqual(tick(2500).emitted, [['hotkey', 'F9']]);
});

test('revive respects shared GCD even when its own interval is zero', () => {
  const { tick } = setup({ target: { skills: [{ key: 'F1' }],
    autoRevive: { enabled: true, hotkey: 'F9', interval: 0, waitForPokemon: false } } });
  const first = tick(0);
  assert.deepEqual(first.emitted.filter(([name]) => name === 'hotkey'), [['hotkey', 'f1']]);
  assert.deepEqual(tick(249).emitted, []);
  assert.deepEqual(tick(250).emitted, [['hotkey', 'F9']]);
});

for (const hunt of [false, true]) {
  test('pending healer switch holds Walker during hotkey GCD in ' + (hunt ? 'hunt' : 'main'), () => {
    const { tick, automation } = setup({ hunt, healer: { returnPokemonName: 'Fighter' },
      target: { combo: { enabled: false }, autoRevive: { enabled: false } } });
    tick(0, { creatures: [], pokemonName: 'Healer', activeSlot: 2 });
    automation.recordDispatch('hotkey', 'F12', 6000);
    const pending = tick(6001, { creatures: [], pokemonName: '', roster: [], activeSlot: 0 });
    assert.equal(pending.status, 'heal');
    assert.ok(!pending.events.some(event => event.name === 'walk'));
  });
}


test('a recovered healer without a separate reset move releases the main Walker', () => {
  const { tick } = setup({ healer: { healHpPercent: 80, healPokemonName: 'Fighter', healMoveSlot: 1, healResetSlot: 1 },
    target: { combo: { enabled: false }, autoRevive: { enabled: false } } });
  assert.equal(tick(0, { healthPercent: 50, creatures: [] }).status, 'heal');
  assert.equal(tick(1000, { healthPercent: 100, creatures: [] }).status, 'walking');
});
