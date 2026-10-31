'use strict';

// Local simulation runtime for the reconstruction menu (diagnostics only).
//
// It implements the exact adapter contract EngineRuntime expects
// (getSnapshot/command/close/pauseWalker/supportedCommands + 'fault' event) and
// exposes a session snapshot shaped like the native one, but with
// nativeVerified/pulseVersion/automationVersion set so the interface gates pass.
//
// This is a diagnostic aid, not a client: nothing talks to the game, and the
// synthetic session is not evidence that the bot works in-game. Commands only
// mutate an in-memory character.

const { EventEmitter } = require('node:events');
const { encodeCommand, COMMANDS } = require('./protocol.cjs');

const STEP = 1;
const START = Object.freeze({ x: 3320, y: 2264, z: 9 });
// walk direction -> (dx, dy); mirrors engines/shared.cjs DIRECTIONS.
const DELTA = Object.freeze({
  0: [0, -STEP], 1: [STEP, 0], 2: [0, STEP], 3: [-STEP, 0],
  4: [STEP, -STEP], 5: [STEP, STEP], 6: [-STEP, STEP], 7: [-STEP, -STEP],
});

function defaultRoster() {
  return [
    { slot: 1, uuid: 'sim-charizard', name: 'Charizard', healthPercent: 100, moves: { m1: 'Ember', m2: 'Flamethrower' } },
    { slot: 2, uuid: 'sim-blastoise', name: 'Blastoise', healthPercent: 100, moves: null },
    { slot: 3, uuid: 'sim-venusaur', name: 'Venusaur', healthPercent: 100, moves: null },
  ];
}

const normalize = value => String(value ?? '').trim().toLowerCase();

// The simulation starts with no creatures: the Target engine attacks any wild on
// screen, which would make the Walker (the primary flow to validate) never move.
// Pass options.creatures to exercise combat/target/healer instead.
function createSimulation(options = {}) {
  const pid = Number.isInteger(options.pid) && options.pid > 0 ? options.pid : 777;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const start = options.start || START;
  const state = {
    position: { ...start },
    health: Number.isFinite(options.health) ? Number(options.health) : 100,
    tick: 0,
    activeSlot: Number.isInteger(options.activeSlot) ? options.activeSlot : 1,
    pokemonName: null,
    targetId: null,
    lastCommand: null,
    creatureDamage: Number.isFinite(options.creatureDamage) ? Number(options.creatureDamage) : 0,
    moves: ['m1', 'm2'],
    roster: options.roster ? structuredClone(options.roster) : defaultRoster(),
    creatures: [],
  };

  function reseedCreatures() {
    state.creatures = options.creatures ? structuredClone(options.creatures) : [];
  }

  function syncPokemonName() {
    const active = state.roster.find(entry => entry.slot === state.activeSlot);
    state.pokemonName = active ? active.name : null;
  }

  function resolvePokemon(name) {
    const wanted = normalize(name);
    const matches = wanted ? state.roster.filter(entry => normalize(entry.name) === wanted) : [];
    if (matches.length === 0) throw Error('Pokemon desconhecido no time: ' + String(name));
    if (matches.length > 1) throw Error('Pokemon ambiguo no time: ' + String(name));
    return matches[0];
  }

  reseedCreatures();
  syncPokemonName();

  function telemetry() {
    return {
      schema: 2, nativeVerified: true, pulseVersion: 3, automationVersion: 1,
      tick: state.tick, playerId: 1, fightMode: 0, chaseMode: 0, clockMs: state.tick * 50,
      position: { ...state.position }, activeSlot: state.activeSlot,
      moves: [...state.moves], nativeSequence: [],
      pokemonName: state.pokemonName, comboPokemonName: state.pokemonName,
      targetId: state.targetId,
      conditionEvents: true, conditionsKnown: true, conditions: [],
      guildDailyAvailable: true,
      roster: structuredClone(state.roster), creatures: structuredClone(state.creatures),
      items: [], tiles: [],
      healthPercent: state.health,
    };
  }

  function snapshot() {
    return {
      pid, generatedAt: new Date(now()).toISOString(),
      online: true, stale: false, error: null, authExpired: false, ageMs: 0,
      healthPercent: state.health, targetId: state.targetId,
      telemetry: telemetry(),
    };
  }

  function applyWalk(direction) {
    const delta = DELTA[Number(direction)];
    if (delta) { state.position.x += delta[0]; state.position.y += delta[1]; }
  }

  // Validates the whole command before mutating anything, so a rejected command
  // leaves the simulated state untouched. Envelope rules (expectedUuid /
  // attackTargetId) are enforced by encodeCommand, not re-implemented here.
  function applyCommand(name, parameter) {
    if (name === 'switchPokemon') {
      const entry = resolvePokemon(parameter);
      state.tick += 1;
      state.activeSlot = entry.slot;
      state.pokemonName = entry.name;
      state.lastCommand = { name, parameter };
      return;
    }
    if (name === 'recallPokemon') {
      state.tick += 1;
      state.activeSlot = 0;
      state.pokemonName = null;
      state.lastCommand = { name, parameter };
      return;
    }
    state.tick += 1;
    state.lastCommand = { name, parameter };
    if (name === 'walk') applyWalk(parameter);
    else if (name === 'attack') {
      const id = Number(parameter) || null;
      state.targetId = id;
      // Optional model of the game damaging a creature: each attack removes
      // `creatureDamage` HP; at zero the creature is gone (the kill loop).
      if (id !== null && state.creatureDamage > 0) {
        const creature = state.creatures.find(entry => entry.id === id);
        if (creature) {
          creature.healthPercent = Math.max(0, Number(creature.healthPercent) - state.creatureDamage);
          if (creature.healthPercent <= 0) {
            state.creatures = state.creatures.filter(entry => entry.id !== id);
            state.targetId = null;
          }
        }
      }
    } else if (name === 'stop' || name === 'focus') state.targetId = null;
    // follow/talk/combo/hotkey/... are accepted no-ops.
  }

  function open({ pid: requestedPid, signal } = {}) {
    if (signal?.aborted) throw Error('Conexao cancelada.');
    const activePid = Number.isInteger(requestedPid) && requestedPid > 0 ? requestedPid : pid;
    const adapter = new EventEmitter();
    adapter.supportedCommands = Object.keys(COMMANDS);
    let closed = false;
    adapter.getSnapshot = () => (closed ? null : { ...snapshot(), pid: activePid });
    adapter.command = async (name, parameter, context = {}) => {
      if (closed) throw Error('Sessao de simulacao encerrada.');
      if (context && context.signal && context.signal.aborted) throw Error('Comando cancelado.');
      if (context && context.pid !== undefined && context.pid !== activePid) throw Error('Canal fechado, cancelado ou PID divergente.');
      if (!adapter.supportedCommands.includes(name)) throw Error('Comando sem suporte: ' + name);
      encodeCommand(1, name, parameter, context ? context.extra : undefined); // same contract as the real transport
      applyCommand(name, parameter);
      return true;
    };
    adapter.pauseWalker = async paused => {
      if (closed || !paused) return true;
      state.tick += 1;
      state.targetId = null;
      return true;
    };
    adapter.close = async () => { closed = true; };
    return Promise.resolve(adapter);
  }

  function reset() {
    state.position = { ...start };
    state.health = Number.isFinite(options.health) ? Number(options.health) : 100;
    state.tick = 0;
    state.activeSlot = Number.isInteger(options.activeSlot) ? options.activeSlot : 1;
    state.targetId = null;
    state.lastCommand = null;
    state.roster = options.roster ? structuredClone(options.roster) : defaultRoster();
    reseedCreatures();
    syncPokemonName();
  }

  return { pid, open, snapshot, reset, state, resolvePokemon };
}

module.exports = { createSimulation, START, DELTA };
