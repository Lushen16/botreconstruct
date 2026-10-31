'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, freshSession, bounded, createHuntDaemon } = require('../tools/hunt_daemon.cjs');
const { createAutomation, createRecorder } = require('../reconstruction/automation.cjs');

const config = { target: { monsters: ['*'], maxDistance: 8, skills: [{ key: 'f1', cooldownMs: 1000 }] },
  hoenn: { potionHpPercent: 80, potionHotkey: 'f12' }, healer: {},
  walker: { waypoints: [{ action: 'walk', pos: { x: 105, y: 100, z: 7 } }] } };
const options = { pid: 10, intervalMs: 200, maxAgeMs: 1000, timeoutMs: 50, healBelow: 80, resumeAbove: 80 };
const creature = { id: 7, name: 'Wild', canAttack: true, healthPercent: 100, pos: { x: 101, y: 100, z: 7 } };
const session = (healthPercent = 100, creatures = []) => ({ pid: 10, online: true, ageMs: 0,
  generatedAt: new Date(1000).toISOString(), telemetry: { nativeVerified: true, pulseVersion: 3,
    position: { x: 100, y: 100, z: 7 }, healthPercent, creatures, playerName: 'Player' } });

test('CLI validates intervals, requires explicit transport and follows healing threshold', () => {
  const args = ['--pid', '10', '--config', 'hunt.json', '--session', 'session.json'];
  assert.equal(parseArgs([...args, '--heal-below', '70']).resumeAbove, 70);
  for (const tail of [['--tick-ms', '0'], ['--tick-ms', 'NaN'], ['--actuate'], ['--wat'], ['--pid', '']]) {
    assert.throws(() => parseArgs([...args, ...tail]));
  }
  assert.throws(() => freshSession(session(), options, 2001));
  assert.throws(() => freshSession(session(), options, 999));
  assert.throws(() => freshSession({ ...session(), pid: 11 }, options, 1000));
  assert.throws(() => freshSession({ ...session(), ageMs: 500 }, options, 1600));
});

test('dry run never calls actuator and stale or missing source holds walker', async () => {
  let now = 1000;
  let snapshot = session();
  const daemon = createHuntDaemon(config, options, { now: () => now, readSession: async () => snapshot,
    log: () => {}, adapter: { command() { throw Error('dry run actuated'); } } });
  assert.equal((await daemon.tick()).status, 'walking');
  now = 2100;
  assert.equal((await daemon.tick()).pauseWalker, true);
  snapshot = null;
  assert.equal((await daemon.tick()).reason, 'snapshot-read');
});

test('actuation confirms pause before combat and preserves command order', async () => {
  const calls = [];
  const adapter = { supportedCommands: ['attack', 'hotkey', 'walk'],
    pauseWalker: async paused => { calls.push(['pause', paused]); return true; },
    command: async (name, parameter) => { calls.push([name, parameter]); return true; } };
  const daemon = createHuntDaemon(config, { ...options, actuate: true }, { now: () => 1000,
    readSession: async () => session(50, [creature]), log: () => {}, adapter });
  await daemon.tick();
  assert.deepEqual(calls, [['pause', true], ['attack', 7], ['hotkey', 'f1']]);
});

test('unsupported commands and failed ACK stop the daemon without retry', async () => {
  for (const supported of [[], ['attack', 'hotkey']]) {
    const calls = [];
    const daemon = createHuntDaemon(config, { ...options, actuate: true }, { now: () => 1000,
      readSession: async () => session(100, [creature]), log: () => {}, adapter: {
        supportedCommands: supported,
        pauseWalker: async paused => { calls.push(['pause', paused]); return true; },
        command: async name => { calls.push([name]); return false; },
      } });
    await assert.rejects(daemon.tick());
    assert.deepEqual(calls.at(-1), ['pause', true]);
    assert.ok(!calls.some(call => call[0] === 'hotkey'));
    await assert.rejects(daemon.tick(), /interrompido/);
  }
});

test('source is checked again after a slow pause ACK and timeouts abort', async () => {
  let now = 1000;
  const daemon = createHuntDaemon(config, { ...options, actuate: true }, { now: () => now,
    readSession: async () => session(100, [creature]), log: () => {}, adapter: {
      supportedCommands: ['attack', 'hotkey'], pauseWalker: async () => { now = 2100; return true; },
      command: async () => { assert.fail('stale action dispatched'); },
    } });
  await assert.rejects(daemon.tick(), /expirada/);
  let signal;
  await assert.rejects(bounded(abortSignal => { signal = abortSignal; return new Promise(() => {}); }, 5, 'test'), /Timeout/);
  assert.equal(signal.aborted, true);
});

test('partial scanner and concurrent ticks are rejected', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const daemon = createHuntDaemon(config, options, { now: () => 1000,
    readSession: async () => pending, log: () => {} });
  const first = daemon.tick();
  await assert.rejects(daemon.tick(), /concorrente/);
  release({ ...session(), creatureSnapshot: { diagnostics: { limit_reached: true } } });
  assert.equal((await first).pauseWalker, true);
});

test('healing switches first, waits for telemetry, and holds until return is confirmed', () => {
  let now = 1000;
  const settings = { ...config, hoenn: {}, healer: { healHpPercent: 80,
    healPokemonName: 'Healer', healMoveSlot: 1, healResetSlot: 1, returnPokemonName: 'Fighter' } };
  const automation = createAutomation(settings, { hunt: { healBelow: 80 }, now: () => now });
  const tick = (hp, pokemonName) => {
    const snapshot = session(hp);
    snapshot.telemetry.pokemonName = pokemonName;
    snapshot.telemetry.roster = [{ name: 'Healer', uuid: 'heal-uuid' }, { name: 'Fighter', uuid: 'fight-uuid' }];
    const recorder = createRecorder();
    const result = automation.tick(snapshot, recorder);
    now += 1000;
    return { ...result, events: recorder.events };
  };
  assert.equal(tick(50, 'Fighter').events[0].name, 'switchPokemon');
  assert.equal(tick(50, 'Healer').events[0].name, 'talk');
  assert.equal(tick(50, 'Healer').events[0].parameter, 'm1');
  assert.equal(tick(100, 'Healer').pauseWalker, true);
  assert.equal(tick(100, 'Fighter').pauseWalker, false);
});
