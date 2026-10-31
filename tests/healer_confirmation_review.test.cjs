'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSimulation } = require('../reconstruction/local-runtime.cjs');
const { createHealerEngine } = require('../reconstruction/engines/healer-engine.cjs');
const { createAutomation, createRecorder } = require('../reconstruction/automation.cjs');

function setup() {
  const sim = createSimulation({ pid: 777, activeSlot: 2 });
  const config = { target: { monsters: [], maxDistance: 8, combo: { enabled: false } },
    healer: { healHpPercent: 0, returnPokemonName: 'Charizard' }, hoenn: {},
    walker: { waypoints: [{ action: 'walk', pos: { x: 3325, y: 2264, z: 9 } }] } };
  const healer = createHealerEngine(config);
  const commands = [];
  const sink = { command(name, parameter, extra) { commands.push({ name, parameter, extra }); } };
  return { sim, config, healer, commands, sink };
}

test('Healer retains a pending switch while acknowledgement and telemetry are delayed', async () => {
  const { sim, healer, sink, commands } = setup();
  const adapter = await sim.open({ pid: 777 });
  const initial = healer.step(sim.snapshot().telemetry, sink, 0);
  assert.equal(initial.waiting, true);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].name, 'switchPokemon');
  assert.equal(commands[0].parameter, 'Charizard');
  for (const now of [250, 1000, 3001, 60000]) {
    const result = healer.step(sim.snapshot().telemetry, sink, now);
    assert.equal(result.waiting, true);
    assert.equal(result.action, 'heal');
    assert.equal(commands.length, 1);
    assert.equal(sim.state.activeSlot, 2);
  }
  await adapter.command(commands[0].name, commands[0].parameter, { pid: 777 });
  const confirmed = healer.step(adapter.getSnapshot().telemetry, sink, 60001);
  assert.equal(confirmed.waiting, false);
  assert.equal(confirmed.action, 'idle');
  await adapter.close();
});

for (const [label, patch] of [
  ['empty roster', { roster: [] }],
  ['empty active name', { pokemonName: '' }],
  ['wrong active slot', { activeSlot: 2 }],
  ['client switching flag', { isSwitching: true }],
  ['client pending flag', { switchPending: true }],
  ['duplicate roster name', { roster: [
    { slot: 1, uuid: 'one', name: 'Charizard' },
    { slot: 3, uuid: 'two', name: 'Charizard' } ] }],
]) {
  test('Healer does not confirm a switch with ' + label, () => {
    const { sim, healer, sink, commands } = setup();
    healer.step(sim.snapshot().telemetry, sink, 0);
    const telemetry = { ...sim.snapshot().telemetry, pokemonName: 'Charizard', activeSlot: 1, ...patch };
    const result = healer.step(telemetry, sink, 60000);
    assert.equal(result.waiting, true);
    assert.equal(result.action, 'heal');
    assert.equal(commands.length, 1);
  });
}

test('automation keeps Walker stopped until the requested Pokemon is confirmed', async () => {
  const { sim, config } = setup();
  const adapter = await sim.open({ pid: 777 });
  let now = 0;
  const automation = createAutomation(config, { now: () => now,
    isEnabled: name => ['healer', 'walker'].includes(name) });
  const first = createRecorder();
  automation.tick(sim.snapshot(), first);
  const request = first.events.find(event => event.name === 'switchPokemon');
  assert.ok(request);
  for (const timestamp of [100, 250, 3001, 60000]) {
    now = timestamp;
    const recorder = createRecorder();
    const result = automation.tick(sim.snapshot(), recorder);
    assert.equal(result.status, 'heal');
    assert.equal(recorder.events.some(event => event.name === 'walk'), false);
  }
  await adapter.command(request.name, request.parameter, { pid: 777, extra: request.extra });
  now += 250;
  const recorder = createRecorder();
  const result = automation.tick(adapter.getSnapshot(), recorder);
  assert.equal(result.status, 'walking');
  assert.ok(recorder.events.some(event => event.name === 'walk'));
  await adapter.close();
});
