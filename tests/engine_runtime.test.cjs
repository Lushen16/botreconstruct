'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const { EngineRuntime } = require('../reconstruction/engine-runtime.cjs');
const { rpmSession } = require('../reconstruction/live-session.cjs');
const { open, channelKey } = require('../reconstruction/native-adapter.cjs');
const { Transport } = require('../reconstruction/transport.cjs');
const { RuntimeServer } = require('../reconstruction/runtime-server.cjs');
const { COMMANDS } = require('../reconstruction/protocol.cjs');
const { Controller } = require('../reconstruction/controller.cjs');
const { encodeCommand } = require('../reconstruction/protocol.cjs');

const creature = { id: 12, name: 'Wild', type: 1, pos: { x: 101, y: 100, z: 7 }, healthPercent: 70, canAttack: true };
const configuration = () => ({ target: { monsters: ['*'], skills: [
  { key: 'F1', cooldownMs: 0 }, { key: 'F2', cooldownMs: 0 }], maxDistance: 8 },
  healer: { healHpPercent: 50, healPokemonName: 'Charizard', healMoveSlot: 1, healResetSlot: 1 },
  hoenn: { potionHpPercent: 50, potionHotkey: 'F12' },
  walker: { waypoints: [{ action: 'walk', pos: { x: 105, y: 100, z: 7 } }] } });
const telemetry = () => ({ schema: 2, nativeVerified: true, pulseVersion: 3, tick: 1, playerId: 1,
  fightMode: 0, chaseMode: 0, clockMs: 1, position: { x: 100, y: 100, z: 7 }, healthPercent: 100,
  activeSlot: 1, moves: [], nativeSequence: [], pokemonName: 'Charizard', comboPokemonName: 'Charizard',
  conditionEvents: true, conditionsKnown: true, conditions: [], roster: [{ slot: 1, uuid: 'uuid', name: 'Charizard', healthPercent: 100, moves: null }],
  creatures: [structuredClone(creature)], items: [], tiles: [] });

function fixture(options = {}) {
  let timestamp = 10000;
  const commands = [];
  const pauses = [];
  let session = { pid: 10, online: true, ageMs: 0, telemetry: telemetry() };
  const adapter = Object.assign(new EventEmitter(), {
    supportedCommands: Object.keys(COMMANDS), getSnapshot: () => structuredClone(session),
    command: async (name, parameter) => { commands.push({ name, parameter, at: timestamp }); return true; },
    pauseWalker: async value => { pauses.push(value); return true; },
    close: async () => {},
  });
  const runtime = new EngineRuntime({ automatic: false, now: () => timestamp, openAdapter: async () => adapter, ...options });
  return { runtime, adapter, commands, pauses, config: configuration(),
    time(value) { timestamp = value; }, session(value) { session = value; }, get sessionValue() { return session; } };
}

test('target-only mode runs the target tick without healing or walking', async () => {
  const item = fixture();
  item.sessionValue.telemetry.healthPercent = 20;
  await item.runtime.setModules('target', true, 10, item.config);
  assert.equal(item.runtime.state.phase, 'Aguardando o jogo');
  assert.equal((await item.runtime.tick()).status, 'combat');
  assert.deepEqual(item.commands.map(value => value.name), ['attack', 'hotkey']);
  assert.equal(item.commands[1].parameter, 'f1');
  await item.runtime.close();
});

test('walker-only mode sends a real engine walk decision, not a target command', async () => {
  const item = fixture();
  await item.runtime.setModules('walker', true, 10, item.config);
  await item.runtime.tick();
  assert.deepEqual(item.commands.map(value => value.name), ['walk']);
  await item.runtime.pause();
  assert.deepEqual(item.pauses, [true]);
  assert.equal(await item.runtime.tick(), null);
});

test('the periodic runtime timer drives the engines after activation', { timeout: 2000 }, async context => {
  const item = fixture({ automatic: true, intervalMs: 10 });
  context.after(() => item.runtime.close());
  let dispatched;
  const sent = new Promise(resolve => { dispatched = resolve; });
  item.adapter.command = async (name, parameter) => {
    item.commands.push({ name, parameter });
    dispatched();
    return true;
  };
  await item.runtime.setModules('target', true, 10, item.config);
  let timer;
  try {
    await Promise.race([sent, new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error('Timer nao executou o tick.')), 1000);
    })]);
    assert.equal(item.commands[0].name, 'attack');
  } finally { clearTimeout(timer); }
});

test('healer-only mode receives actual HP in telemetry and emits the potion hotkey', async () => {
  const item = fixture();
  item.sessionValue.telemetry.healthPercent = 30;
  await item.runtime.setModules('healer', true, 10, item.config);
  await item.runtime.tick();
  assert.deepEqual(item.commands.map(value => [value.name, value.parameter]), [['hotkey', 'F12']]);
  await item.runtime.close();
});

test('null or missing HP is not treated as zero by the healer', async () => {
  for (const health of [null, undefined, '20', -1, 101]) {
    const item = fixture();
    item.sessionValue.telemetry.healthPercent = health;
    await item.runtime.setModules('healer', true, 10, item.config);
    assert.equal((await item.runtime.tick()).status, 'idle');
    assert.deepEqual(item.commands, []);
    await item.runtime.close();
  }
});

test('global cooldown survives module toggles and uses actual dispatch time', async () => {
  const item = fixture();
  item.adapter.command = async (name, parameter) => {
    item.commands.push({ name, parameter });
    if (name === 'attack') item.time(10100);
    return true;
  };
  await item.runtime.setModules('target', true, 10, item.config);
  await item.runtime.tick();
  item.time(10300);
  await item.runtime.tick();
  assert.equal(item.commands.filter(value => value.name === 'hotkey').length, 1);
  await item.runtime.setModules('target', true, 10, item.config);
  item.time(10349);
  await item.runtime.tick();
  assert.equal(item.commands.filter(value => value.name === 'hotkey').length, 1);
  item.time(10350);
  await item.runtime.tick();
  assert.equal(item.commands.filter(value => value.name === 'hotkey').length, 2);
  await item.runtime.close();
});

test('new connection waits for telemetry and stale telemetry stops the walker', async () => {
  const item = fixture();
  const session = item.sessionValue;
  item.session(null);
  await item.runtime.setModules('walker', true, 10, item.config);
  assert.equal((await item.runtime.tick()).reason, 'no-telemetry');
  item.session(session);
  await item.runtime.tick();
  session.stale = true;
  assert.equal((await item.runtime.tick()).reason, 'stale');
  assert.deepEqual(item.pauses, [true]);
  assert.equal(item.commands.length, 1);
  await item.runtime.close();
});

test('individual skill cooldown starts at dispatch, not at the earlier target decision', async () => {
  const item = fixture();
  item.config.target.skills = [{ key: 'F1', cooldownMs: 1000 }];
  let delayFirstAttack = true;
  item.adapter.command = async (name, parameter) => {
    item.commands.push({ name, parameter });
    if (name === 'attack' && delayFirstAttack) {
      delayFirstAttack = false;
      item.time(10100);
    }
    return true;
  };
  await item.runtime.setModules('target', true, 10, item.config);
  await item.runtime.tick();
  item.time(11099);
  await item.runtime.tick();
  assert.equal(item.commands.filter(value => value.name === 'hotkey').length, 1);
  item.time(11100);
  await item.runtime.tick();
  assert.equal(item.commands.filter(value => value.name === 'hotkey').length, 2);
  await item.runtime.close();
});

test('failed connection never enables modules and unsupported modules do not open a channel', async () => {
  const runtime = new EngineRuntime({ automatic: false, openAdapter: async () => { throw Error('Canal ausente'); } });
  await assert.rejects(runtime.setModules('scripts', true, 10, configuration()), /Modulo/);
  await assert.rejects(runtime.setModules('target', true, 10, configuration()), /Canal ausente/);
  assert.deepEqual(runtime.state.modules, []);
  assert.equal(runtime.state.paused, true);
  await runtime.close();
});

test('rejected command pauses, closes, and is never automatically retried', async () => {
  const item = fixture();
  let closed = 0;
  item.adapter.close = async () => { closed++; };
  item.adapter.command = async () => false;
  await item.runtime.setModules('target', true, 10, item.config);
  assert.equal((await item.runtime.tick()).status, 'error');
  assert.equal(item.runtime.state.paused, true);
  assert.equal(await item.runtime.tick(), null);
  await Promise.resolve();
  assert.equal(closed, 1);
});

test('stale target telemetry cancels the previously commanded attack once', async () => {
  const item = fixture();
  await item.runtime.setModules('target', true, 10, item.config);
  await item.runtime.tick();
  item.sessionValue.stale = true;
  await item.runtime.tick();
  await item.runtime.tick();
  assert.deepEqual(item.pauses, [true]);
  assert.equal(item.commands.length, 2);
  await item.runtime.close();
});

test('an unsupported command invalidates the entire batch before any command is sent', async () => {
  const item = fixture();
  item.adapter.supportedCommands = ['attack'];
  await item.runtime.setModules('target', true, 10, item.config);
  assert.equal((await item.runtime.tick()).status, 'error');
  assert.deepEqual(item.commands, []);
});

test('overlapping ticks do not duplicate commands and pause cancels the rest of a batch', async () => {
  const item = fixture();
  let release;
  item.adapter.command = () => new Promise(resolve => { release = resolve; });
  await item.runtime.setModules('target', true, 10, item.config);
  const pending = item.runtime.tick();
  await Promise.resolve();
  assert.equal(await item.runtime.tick(), null);
  const paused = item.runtime.pause();
  release(true);
  await pending;
  await paused;
  assert.deepEqual(item.pauses, [true]);
  assert.equal(item.runtime.state.paused, true);
});

test('command timeout stops execution without retry', async () => {
  const item = fixture({ timeoutMs: 15 });
  let calls = 0;
  item.adapter.command = () => { calls++; return new Promise(() => {}); };
  await item.runtime.setModules('target', true, 10, item.config);
  assert.match((await item.runtime.tick()).error, /Timeout/);
  assert.equal(await item.runtime.tick(), null);
  assert.equal(calls, 1);
});

test('PID changes and invalid modules are blocked before dispatch', async () => {
  const item = fixture();
  await assert.rejects(item.runtime.setModules('capture', true, 10, item.config), /Modulo/);
  await item.runtime.setModules('target', true, 10, item.config);
  item.sessionValue.pid = 99;
  assert.match((await item.runtime.tick()).error, /PID/);
  assert.deepEqual(item.commands, []);
});

test('a stale external creature source never falls back to native creatures', async () => {
  const item = fixture({ creatureSource: () => { throw Error('Stream expirado'); } });
  await item.runtime.setModules('target', true, 10, item.config);
  assert.match((await item.runtime.tick()).error, /Stream expirado/);
  assert.deepEqual(item.commands, []);
});

test('RPM session shows only observed data, with independent creature freshness', () => {
  const raw = { pid: 10, generatedAt: new Date(10000).toISOString(), player: { name: 'Player', pos: { x: 1, y: 2, z: 7 } },
    creatures: [creature], creaturesGeneratedAt: new Date(8000).toISOString() };
  const session = rpmSession(raw, 10000);
  assert.equal(session.online, true);
  assert.equal(session.healthPercent, undefined);
  assert.equal(session.telemetry.nativeVerified, false);
  assert.equal(session.telemetry.pulseVersion, undefined);
  assert.deepEqual(session.telemetry.creatures, []);
  raw.creaturesGeneratedAt = raw.generatedAt;
  assert.equal(rpmSession(raw, 10000).telemetry.creatures.length, 1);
  assert.equal(rpmSession(raw, 12000).online, false);
  assert.equal(rpmSession(raw, 9000), null);
  assert.equal(rpmSession({ ...raw, player: null }, 10000), null);
});

test('channel key is required instead of fabricated execution', () => {
  assert.throws(() => channelKey(10, {}), /Configure PKA_CHANNEL_KEY/);
});

test('controller start-all, pause, resume and stop-all control the actual engine runtime', async () => {
  const item = fixture();
  const state = { activeProfile: 'Default', profiles: [{ name: 'Default', config: item.config }] };
  const controller = new Controller({ snapshot: () => structuredClone(state) }, { runtime: item.runtime });
  const started = await controller.invoke('pka:runtime', 'all', true, 10, item.config, 1);
  assert.deepEqual(started.runtime.modules, ['target', 'walker', 'healer']);
  assert.equal(started.runtime.paused, false);
  assert.notEqual(started.runtime.phase, 'Executando');
  await item.runtime.tick();
  assert.equal(item.commands.length, 2);
  assert.equal((await controller.invoke('pka:pause')).runtime.paused, true);
  assert.equal((await controller.invoke('pka:pause')).runtime.paused, false);
  const stopped = await controller.invoke('pka:runtime', 'all', false, 10, item.config, 1);
  assert.deepEqual(stopped.runtime.modules, []);
  assert.equal(stopped.runtime.paused, true);
  await item.runtime.close();
});

test('profile changes pause execution before saving the profile', async () => {
  const item = fixture();
  const state = { activeProfile: 'Default', profiles: [{ name: 'Default', config: item.config }] };
  const store = { snapshot: () => structuredClone(state), save: async () => {
    assert.equal(item.runtime.state.paused, true);
  } };
  const controller = new Controller(store, { runtime: item.runtime });
  await controller.invoke('pka:runtime', 'target', true, 10, item.config, 1);
  await controller.invoke('pka:autosave', 'Default', item.config, 1);
  assert.equal(item.runtime.state.paused, true);
  await item.runtime.close();
});

test('stream failure stops a previously commanded walker before closing the channel', async () => {
  let fail = false;
  const item = fixture({ creatureSource: () => {
    if (fail) throw Error('Stream expirado');
    return { schema: 2, pid: 10, generatedAt: new Date(10000).toISOString(), creatures: [] };
  } });
  await item.runtime.setModules('walker', true, 10, item.config);
  await item.runtime.tick();
  fail = true;
  assert.match((await item.runtime.tick()).error, /Stream expirado/);
  assert.deepEqual(item.pauses, [true]);
});

test('native adapter combines state HP and telemetry and rejects nonzero ACK status', async () => {
  const transport = Object.assign(new EventEmitter(), {
    connect: async () => {}, close: () => {}, sendCommand: async () => ({ status: 5 }),
  });
  let now = 10000;
  const adapter = await open({ pid: 10 }, { transport, now: () => now });
  assert.equal(adapter.getSnapshot(), null);
  transport.emit('state', { online: true, healthPercent: 37 });
  transport.emit('telemetry', telemetry());
  assert.equal(adapter.getSnapshot().telemetry.healthPercent, 37);
  now = 11001;
  assert.equal(adapter.getSnapshot().stale, true);
  await assert.rejects(adapter.command('attack', 12), /status 5/);
  await assert.rejects(adapter.command('attack', 12, { pid: 20 }), /PID/);
  await adapter.close();
});

test('integrated engine exchanges actual protocol frames and positive ACKs with a local fixture server', async () => {
  const pid = 52000 + (process.pid % 1000);
  const key = 'engine-runtime-test-fixture';
  const server = new RuntimeServer({ pid, key });
  const transport = new Transport({ pid, key });
  const runtime = new EngineRuntime({ automatic: false,
    openAdapter: context => open(context, { transport }) });
  await server.start();
  try {
    await runtime.setModules('target', true, pid, configuration());
    const received = once(transport, 'telemetry');
    const state = Buffer.alloc(48);
    state.writeUInt32LE(1, 0);
    state.writeUInt32LE(1, 4);
    state.writeUInt32LE(100, 8);
    server.publishState(state);
    server.publishTelemetry(telemetry());
    await received;
    assert.equal((await runtime.tick()).status, 'combat');
    assert.deepEqual(server.commands.map(command => command.payload.readUInt32LE(4)), [COMMANDS.attack, COMMANDS.hotkey]);
    await runtime.pause();
    assert.equal(server.commands.at(-1).payload.readUInt32LE(4), COMMANDS.stop);
  } finally {
    await runtime.close();
    await server.close();
  }
});


test('runtime dispatches native fallback through the actual protocol encoder', async () => {
  const item = fixture();
  delete item.config.target.skills;
  item.config.target.combo = { enabled: true, useNativeSequence: true };
  item.adapter.command = async (name, parameter, context) => {
    encodeCommand(1, name, parameter, context.extra);
    item.commands.push({ name, parameter });
    return true;
  };
  await item.runtime.setModules('target', true, 10, item.config);
  assert.equal((await item.runtime.tick()).status, 'combat');
  assert.deepEqual(item.commands.map(event => [event.name, event.parameter]), [['attack', 12], ['combo', '!autocombo']]);
  await item.runtime.close();
});

test('runtime runs combo to revive with enemies visible and waits for roster confirmation', async () => {
  const item = fixture();
  delete item.config.target.skills;
  item.config.target.combo = { enabled: true, sequenceText: 'm1, m2', stepDelay: 250 };
  item.config.target.autoRevive = { enabled: true, hotkey: 'F9', interval: 1500, waitForPokemon: true };
  await item.runtime.setModules('all', true, 10, item.config);
  await item.runtime.tick();
  item.time(10250);
  assert.equal((await item.runtime.tick()).status, 'revive');
  item.time(11749);
  await item.runtime.tick();
  assert.ok(!item.commands.some(event => event.parameter === 'F9'));
  item.time(11750);
  await item.runtime.tick();
  assert.equal(item.commands.filter(event => event.parameter === 'F9').length, 1);
  item.time(15000);
  Object.assign(item.sessionValue.telemetry, { pokemonName: '', activeSlot: 0, roster: [], creatures: [] });
  assert.equal((await item.runtime.tick()).status, 'revive');
  item.time(15001);
  Object.assign(item.sessionValue.telemetry, { pokemonName: 'Charizard', activeSlot: 1,
    roster: [{ slot: 1, uuid: 'uuid', name: 'Charizard' }] });
  assert.equal((await item.runtime.tick()).status, 'walking');
  assert.equal(item.commands.filter(event => event.parameter === 'F9').length, 1);
  await item.runtime.close();
});
