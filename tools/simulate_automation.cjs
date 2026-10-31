'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createAutomation, createRecorder } = require('../reconstruction/automation.cjs');
const { DIRECTIONS } = require('../reconstruction/engines/shared.cjs');

const root = path.resolve(__dirname, '..');
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'default_config.json'), 'utf8'));

function clone(value) { return structuredClone(value); }

function merge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch === undefined ? base : patch;
  const output = { ...base };
  for (const [key, value] of Object.entries(patch)) output[key] = merge(base?.[key], value);
  return output;
}

function telemetry(patch) {
  return {
    schema: 2, nativeVerified: true, pulseVersion: 3, tick: 1, playerId: 1, fightMode: 0, chaseMode: 0,
    clockMs: 0, position: { x: 100, y: 100, z: 7 }, activeSlot: 1, moves: [], nativeSequence: [],
    pokemonName: 'Charizard', comboPokemonName: 'Charizard', conditionEvents: true, conditionsKnown: true,
    conditions: [], roster: [{ slot: 1, uuid: 'uuid-charizard', name: 'Charizard', healthPercent: 100, moves: null }],
    creatures: [], items: [], tiles: [], healthPercent: 100,
    ...patch,
  };
}

function session(patch) {
  return {
    pid: 4242, online: true, stale: false, error: null, authExpired: false, ageMs: 40,
    paused: false, runtime: { modules: ['walker', 'target', 'healer'], pid: 4242, paused: false },
    telemetry: telemetry(patch?.telemetry),
    ...patch,
  };
}

const creatures = (count, patch = {}) => Array.from({ length: count }, (_, index) => ({
  id: 1000 + index, name: 'Wild', type: 1, healthPercent: 100, canAttack: true,
  pos: { x: 101 + (index % 3), y: 101 + Math.floor(index / 3), z: 7 }, ...patch,
}));

function walkScenario() {
  const config = merge(clone(defaults), {
    walker: {
      loop: true,
      waypoints: [
        { action: 'walk', pos: { x: 103, y: 100, z: 7 }, param: '' },
        { action: 'say', pos: { x: 103, y: 100, z: 7 }, param: 'rota ok' },
        { action: 'wait', pos: { x: 103, y: 100, z: 7 }, param: 600 },
      ],
    },
  });
  let clock = 0;
  const automation = createAutomation(config, { now: () => clock });
  const recorder = createRecorder();
  const position = { x: 100, y: 100, z: 7 };
  const log = [];
  for (let step = 0; step < 12; step += 1) {
    const before = recorder.events.length;
    const result = automation.tick(session({ telemetry: telemetry({ position: { ...position } }) }), recorder);
    for (const event of recorder.events.slice(before)) {
      if (event.name === 'walk') {
        if (event.parameter === DIRECTIONS.east) position.x += 1;
        else if (event.parameter === DIRECTIONS.west) position.x -= 1;
        else if (event.parameter === DIRECTIONS.south) position.y += 1;
        else if (event.parameter === DIRECTIONS.north) position.y -= 1;
      }
    }
    log.push({ clock, position: { ...position }, status: result.status, reason: result.reason, emitted: result.emitted });
    clock += 200;
  }
  return { scenario: 'walk', commands: recorder.events, log };
}

function lureScenario() {
  const config = merge(clone(defaults), {
    target: { combo: { enabled: true, sequenceText: 'm1 m2 m3', stepDelay: 250 } },
    hoenn: { perfectLure: true, minWildsToEngage: 11 },
    walker: { loop: true, waypoints: [{ action: 'walk', pos: { x: 110, y: 110, z: 7 }, param: '' }] },
  });
  let clock = 0;
  const automation = createAutomation(config, { now: () => clock });
  const recorder = createRecorder();
  const log = [];
  for (const count of [4, 6, 10, 11, 11, 11, 11, 11]) {
    const result = automation.tick(session({ telemetry: telemetry({ creatures: creatures(count), healthPercent: 90 }) }), recorder);
    log.push({ count, clock, status: result.status, reason: result.reason, emitted: result.emitted });
    clock += 300;
  }
  return { scenario: 'lure', commands: recorder.events, log };
}

function combatScenario() {
  const config = merge(clone(defaults), {
    target: { combo: { enabled: true, sequenceText: 'm1, m2', stepDelay: 250 } },
    hoenn: { perfectLure: false, minWildsToEngage: 0 },
  });
  let clock = 0;
  const automation = createAutomation(config, { now: () => clock });
  const recorder = createRecorder();
  const log = [];
  for (let step = 0; step < 5; step += 1) {
    const result = automation.tick(session({ telemetry: telemetry({ creatures: creatures(2), healthPercent: 80 }) }), recorder);
    log.push({ clock, status: result.status, emitted: result.emitted });
    clock += 300;
  }
  return { scenario: 'combat', commands: recorder.events, log };
}

function healScenario() {
  const config = merge(clone(defaults), {
    healer: { healHpPercent: 55, healPokemonName: 'Charizard', healMoveSlot: 1, healResetSlot: 2, returnPokemonName: 'Charizard' },
    hoenn: { potionHpPercent: 60, potionHotkey: 'F1', potionCooldownMs: 1500, useMedicine: true, medicineHotkey: 'F2' },
  });
  let clock = 0;
  const automation = createAutomation(config, { now: () => clock });
  const recorder = createRecorder();
  const log = [];
  for (const health of [70, 50, 50, 50, 90]) {
    const result = automation.tick(session({ telemetry: telemetry({ healthPercent: health, conditions: health < 60 ? [{ type: '1', subId: 0 }] : [] }) }), recorder);
    log.push({ health, clock, status: result.status, emitted: result.emitted, blocked: result.blocked });
    clock += 900;
  }
  return { scenario: 'heal', commands: recorder.events, log };
}

const scenarios = { walk: walkScenario, lure: lureScenario, combat: combatScenario, heal: healScenario };
const name = process.argv[2] || 'combat';
if (!scenarios[name]) {
  console.error('Cenarios: ' + Object.keys(scenarios).join(', '));
  process.exit(2);
}
console.log(JSON.stringify(scenarios[name](), null, 2));
