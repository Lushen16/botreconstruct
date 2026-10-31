'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EngineRuntime } = require('../reconstruction/engine-runtime.cjs');
const { createSimulation } = require('../reconstruction/local-runtime.cjs');
const { gateReason } = require('../reconstruction/automation.cjs');
const { createAutomation } = require('../reconstruction/automation.cjs');

const configuration = () => ({
  target: { monsters: [], skills: [], maxDistance: 8 },
  healer: { healHpPercent: 0, healPokemonName: 'Charizard', healMoveSlot: 1, healResetSlot: 1 },
  hoenn: { potionHpPercent: 0 },
  walker: { waypoints: [{ action: 'walk', pos: { x: 3305, y: 2264, z: 9 } }] },
});

test('simulation snapshot is a native-verified session that passes the engine gate', () => {
  const sim = createSimulation({ pid: 777 });
  const session = sim.snapshot();
  assert.equal(session.pid, 777);
  assert.equal(session.online, true);
  assert.equal(session.stale, false);
  assert.equal(session.telemetry.nativeVerified, true);
  assert.equal(session.telemetry.pulseVersion, 3);
  assert.equal(session.telemetry.automationVersion, 1);
  assert.deepEqual(session.telemetry.position, { x: 3320, y: 2264, z: 9 });
  assert.equal(gateReason(session), null);
});

test('simulation adapter validates and applies walk commands', async () => {
  const sim = createSimulation({ pid: 777 });
  const adapter = await sim.open({ pid: 777 });
  assert.equal(await adapter.command('walk', 1), true); // east
  assert.deepEqual(adapter.getSnapshot().telemetry.position, { x: 3321, y: 2264, z: 9 });
  await assert.rejects(() => adapter.command('walk', 99), /Comando|param|parametro/i);
  await assert.rejects(() => adapter.command('nope', 0), /suporte/i);
  await adapter.close();
  assert.equal(adapter.getSnapshot(), null);
});

test('EngineRuntime drives the walker over the simulation and the character advances', async () => {
  const sim = createSimulation({ pid: 777 });
  const runtime = new EngineRuntime({ automatic: false, openAdapter: options => sim.open(options) });
  await runtime.setModules('walker', true, 777, configuration());
  const start = runtime.sessions[0].telemetry.position.x;
  for (let step = 0; step < 24; step += 1) await runtime.tick();
  const end = runtime.sessions[0].telemetry.position;
  assert.ok(end.x < start, `expected to walk west, ${start} -> ${end.x}`);
  assert.equal(end.z, 9);
  await runtime.close();
});

test('automation walks the simulated character to the waypoint', async () => {
  const sim = createSimulation({ pid: 777 });
  const automation = createAutomation(configuration());
  const adapter = await sim.open({ pid: 777 });
  for (let step = 0; step < 40; step += 1) {
    const session = adapter.getSnapshot();
    const recorder = { events: [], command(name, parameter, extra) { this.events.push({ name, parameter, extra }); } };
    automation.tick(session, recorder);
    for (const event of recorder.events) await adapter.command(event.name, event.parameter, { pid: 777, extra: event.extra });
  }
  const position = adapter.getSnapshot().telemetry.position;
  assert.deepEqual(position, { x: 3305, y: 2264, z: 9 });
});

test('switchPokemon resolves by name and keeps slot, name and identity coherent', async () => {
  const sim = createSimulation({ pid: 777 });
  const adapter = await sim.open({ pid: 777 });
  assert.equal(adapter.getSnapshot().telemetry.pokemonName, 'Charizard');
  assert.equal(await adapter.command('switchPokemon', 'Blastoise', { pid: 777 }), true);
  assert.equal(adapter.getSnapshot().telemetry.activeSlot, 2);
  assert.equal(adapter.getSnapshot().telemetry.pokemonName, 'Blastoise');
  await adapter.command('switchPokemon', 'Charizard', { pid: 777 });
  assert.equal(adapter.getSnapshot().telemetry.activeSlot, 1);
  assert.equal(adapter.getSnapshot().telemetry.pokemonName, 'Charizard');
  await adapter.close();
});

test('switchPokemon rejects unknown and ambiguous names without mutating state', async () => {
  const roster = [
    { slot: 1, uuid: 'a', name: 'Charizard', healthPercent: 100, moves: null },
    { slot: 2, uuid: 'b', name: 'Charizard', healthPercent: 100, moves: null },
  ];
  const sim = createSimulation({ pid: 777, roster });
  const adapter = await sim.open({ pid: 777 });
  const before = adapter.getSnapshot().telemetry;
  await assert.rejects(() => adapter.command('switchPokemon', 'Pikachu', { pid: 777 }), /desconhecido/i);
  await assert.rejects(() => adapter.command('switchPokemon', 'Charizard', { pid: 777 }), /ambiguo/i);
  const after = adapter.getSnapshot().telemetry;
  assert.deepEqual({ slot: after.activeSlot, name: after.pokemonName, tick: after.tick },
    { slot: before.activeSlot, name: before.pokemonName, tick: before.tick });
  await adapter.close();
});

test('recallPokemon clears the active slot and identity', async () => {
  const sim = createSimulation({ pid: 777 });
  const adapter = await sim.open({ pid: 777 });
  await adapter.command('recallPokemon', 'Blastoise', { pid: 777 });
  assert.equal(adapter.getSnapshot().telemetry.activeSlot, 0);
  assert.equal(adapter.getSnapshot().telemetry.pokemonName, null);
  await adapter.close();
});

test('adapter command validates its context and forwards context.extra to the encoder', async () => {
  const sim = createSimulation({ pid: 777 });
  const adapter = await sim.open({ pid: 777 });
  const before = adapter.getSnapshot().telemetry.tick;
  await assert.rejects(() => adapter.command('walk', 1, { pid: 999 }), /PID divergente/i);
  assert.equal(adapter.getSnapshot().telemetry.tick, before);
  const aborter = new AbortController(); aborter.abort();
  await assert.rejects(() => adapter.command('walk', 1, { pid: 777, signal: aborter.signal }), /cancelado/i);
  assert.equal(adapter.getSnapshot().telemetry.tick, before);
  // talk mN + attackTargetId without a uuid must fail the shared encoder.
  await assert.rejects(() => adapter.command('talk', 'm1', { pid: 777, extra: { attackTargetId: 7 } }),
    /UUID|Alvo/i);
  // A valid envelope preserves expectedUuid + attackTargetId.
  assert.equal(await adapter.command('talk', 'm1',
    { pid: 777, extra: { expectedUuid: 'sim-charizard', attackTargetId: 7 } }), true);
  await adapter.close();
});

const targetOnly = { isEnabled: name => name === 'target' };

test('Target keeps attacking until the simulated creature dies (kill loop)', async () => {
  const sim = createSimulation({ pid: 777, creatureDamage: 50, creatures: [
    { id: 9001, name: 'Wild', type: 1, is_player: false, canAttack: true, healthPercent: 100, pos: { x: 3321, y: 2264, z: 9 } }] });
  const adapter = await sim.open({ pid: 777 });
  let now = 0;
  const automation = createAutomation(configuration(), { ...targetOnly, now: () => now });
  let attacks = 0;
  for (const timestamp of [0, 999, 1000, 2000]) {
    now = timestamp;
    const recorder = { events: [], command(name, parameter, extra) { this.events.push({ name, parameter, extra }); } };
    automation.tick(adapter.getSnapshot(), recorder);
    for (const event of recorder.events) {
      if (event.name === 'attack') attacks += 1;
      await adapter.command(event.name, event.parameter, { pid: 777, extra: event.extra });
    }
    if (timestamp < 1000) {
      assert.equal(sim.state.creatures[0].healthPercent, 50);
      assert.equal(sim.state.targetId, 9001);
    }
  }
  assert.equal(attacks, 2, 'two attacks separated by the retry interval');
  assert.equal(automation.state.target.targetId, null);
  assert.equal(sim.state.creatures.length, 0, 'creature died');
  assert.equal(sim.state.targetId, null, 'target cleared after kill');
  await adapter.close();
});

test('a completed combo triggers the Revive hotkey (combat.revive)', async () => {
  const config = { target: { monsters: [], maxDistance: 8,
    combo: { enabled: true, sequenceText: 'm1', stepDelay: 0 },
    autoRevive: { enabled: true, hotkey: 'F5', interval: 1500 } }, healer: {}, hoenn: {} };
  const sim = createSimulation({ pid: 777, creatures: [
    { id: 9002, name: 'Wild', type: 1, is_player: false, canAttack: true, healthPercent: 100, pos: { x: 3321, y: 2264, z: 9 } }] });
  const adapter = await sim.open({ pid: 777 });
  let now = 0;
  const automation = createAutomation(config, { ...targetOnly, now: () => now });
  const seen = [];
  for (const timestamp of [0, 249, 250, 1499, 1500]) {
    now = timestamp;
    const recorder = { events: [], command(name, parameter, extra) { this.events.push({ name, parameter, extra }); } };
    automation.tick(adapter.getSnapshot(), recorder);
    for (const event of recorder.events) {
      seen.push({ ...event, at: now });
      await adapter.command(event.name, event.parameter, { pid: 777, extra: event.extra });
    }
    if (timestamp < 1500) assert.equal(seen.some(event => event.name === 'hotkey'), false);
  }
  const skill = seen.find(event => event.name === 'talk' && event.parameter === 'm1');
  const revive = seen.filter(event => event.name === 'hotkey');
  assert.ok(skill, 'exact combo skill cast');
  assert.equal(revive.length, 1);
  assert.equal(revive[0].parameter, 'F5');
  assert.equal(revive[0].at - skill.at, 1500);
  assert.equal(sim.state.creatures.length, 1, 'Revive does not wait for the map to empty');
  await adapter.close();
});

test('a heal cast is accepted by the simulation and recorded', async () => {
  const { createHealerEngine } = require('../reconstruction/engines/healer-engine.cjs');
  const sim = createSimulation({ pid: 777, health: 40 });
  const adapter = await sim.open({ pid: 777 });
  const healer = createHealerEngine({ healer: { healHpPercent: 80, healPokemonName: 'Blastoise',
    healMoveSlot: 1, healResetSlot: 1, returnPokemonName: 'Charizard' }, hoenn: {} });
  const acknowledgements = [];
  healer.step(adapter.getSnapshot().telemetry, { command: (name, parameter, extra) =>
    acknowledgements.push(adapter.command(name, parameter, { pid: 777, extra })) }, 0);
  await Promise.all(acknowledgements);
  assert.deepEqual(sim.state.lastCommand, { name: 'talk', parameter: 'm1' });
  assert.equal(sim.snapshot().telemetry.healthPercent, 40, 'command acceptance is not proof of HP recovery');
  await adapter.close();
});

test('the simulation immediately applies a Healer return command', async () => {
  const { createHealerEngine } = require('../reconstruction/engines/healer-engine.cjs');
  const sim = createSimulation({ pid: 777, activeSlot: 2 }); // Blastoise active
  const adapter = await sim.open({ pid: 777 });
  const healer = createHealerEngine({ healer: { healHpPercent: 0, healPokemonName: 'Blastoise',
    healMoveSlot: 1, healResetSlot: 1, returnPokemonName: 'Charizard' }, hoenn: {} });
  const events = [];
  const acknowledgements = [];
  const sink = { command(name, parameter, extra) {
    events.push({ name, parameter });
    acknowledgements.push(adapter.command(name, parameter, { pid: 777, extra }));
  } };
  healer.step(adapter.getSnapshot().telemetry, sink, 0);
  assert.deepEqual(events, [{ name: 'switchPokemon', parameter: 'Charizard' }]);
  await Promise.all(acknowledgements);
  assert.equal(adapter.getSnapshot().telemetry.pokemonName, 'Charizard'); // client confirmed the switch
  await adapter.close();
});
