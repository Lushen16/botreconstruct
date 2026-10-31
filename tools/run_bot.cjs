'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Transport } = require('../reconstruction/transport.cjs');
const { RuntimeServer } = require('../reconstruction/runtime-server.cjs');
const { createAutomation } = require('../reconstruction/automation.cjs');
const { createCreatureSource } = require('./creature_bridge.cjs');
const { DIRECTIONS } = require('../reconstruction/engines/shared.cjs');

const root = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const options = { mode: 'live', pid: null, key: process.env.PKA_CHANNEL_KEY || '', keyFile: null,
    config: null, interval: 50, maxTicks: 0, ticks: 40, dry: false, probe: false, seconds: 5 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--simulate') options.mode = 'simulate';
    else if (arg === '--pid') options.pid = Number(argv[++index]);
    else if (arg === '--key') options.key = argv[++index] || '';
    else if (arg === '--key-file') options.keyFile = argv[++index];
    else if (arg === '--probe') options.probe = true;
    else if (arg === '--seconds') options.seconds = Math.max(1, Number(argv[++index]) || 5);
    else if (arg === '--config') options.config = argv[++index];
    else if (arg === '--creatures') options.creatures = argv[++index];
    else if (arg === '--interval') options.interval = Math.max(10, Number(argv[++index]) || 50);
    else if (arg === '--ticks') options.ticks = Math.max(1, Number(argv[++index]) || 40);
    else if (arg === '--max-ticks') options.maxTicks = Math.max(0, Number(argv[++index]) || 0);
    else if (arg === '--dry') options.dry = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

function loadConfig(file) {
  const base = JSON.parse(fs.readFileSync(path.join(root, 'default_config.json'), 'utf8'));
  if (!file) return base;
  const patch = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const merge = (left, right) => {
    if (!right || typeof right !== 'object' || Array.isArray(right)) return right === undefined ? left : right;
    const output = { ...left };
    for (const [key, value] of Object.entries(right)) output[key] = merge(left?.[key], value);
    return output;
  };
  return merge(base, patch.config || patch);
}

function syntheticTelemetry(state, config) {
  const creatures = Array.from({ length: state.creatures }, (_, index) => ({
    id: 9000 + index, name: 'Wild', type: 1, healthPercent: 100, canAttack: true,
    pos: { x: state.position.x + 1 + (index % 3), y: state.position.y + 1, z: state.position.z },
  }));
  const roster = [{ slot: 1, uuid: 'synthetic-uuid', name: 'Charizard', healthPercent: 100, moves: null }];
  return {
    schema: 2, nativeVerified: true, pulseVersion: 3, tick: state.tick, playerId: 1, fightMode: 0, chaseMode: 0,
    clockMs: state.tick * 200, position: { ...state.position }, activeSlot: 1, moves: [], nativeSequence: [],
    pokemonName: 'Charizard', comboPokemonName: 'Charizard', conditionEvents: true, conditionsKnown: true,
    conditions: [], roster, creatures, items: [], tiles: [],
    healthPercent: state.health,
  };
}

async function simulate(options) {
  const config = loadConfig(options.config);
  config.walker = config.walker || {};
  if (!Array.isArray(config.walker.waypoints) || config.walker.waypoints.length === 0) {
    config.walker.waypoints = [{ action: 'walk', pos: { x: 105, y: 100, z: 7 }, param: '' }];
  }
  config.hoenn = { ...config.hoenn, perfectLure: true, minWildsToEngage: 3, potionHpPercent: 60, potionHotkey: 'F1' };
  config.target = { ...config.target, combo: { ...(config.target?.combo || {}), enabled: true, sequenceText: 'm1 m2', stepDelay: 250 } };
  const pid = 47800 + (process.pid % 200);
  const key = options.key || '00000000000000000000000000000000';
  const server = new RuntimeServer({ pid, key, nonce: Buffer.from('0123456789abcdef0123456789abcdef') });
  const transport = new Transport({ pid, key });
  const state = { tick: 0, health: 100, creatures: 3, position: { x: 100, y: 100, z: 7 } };
  const automation = createAutomation(config, { now: () => state.tick * 200 });
  const log = [];
  const sent = [];
  const sink = {
    command(name, parameter, extra) {
      if (name === 'walk') {
        const direction = Number(parameter);
        if (direction === DIRECTIONS.east) state.position.x += 1;
        else if (direction === DIRECTIONS.west) state.position.x -= 1;
        else if (direction === DIRECTIONS.south) state.position.y += 1;
        else if (direction === DIRECTIONS.north) state.position.y -= 1;
        else if (direction === DIRECTIONS.southeast) { state.position.x += 1; state.position.y += 1; }
      }
      sent.push({ name, parameter, ...(extra === undefined ? {} : { extra }) });
      transport.sendCommand(name, parameter, extra).catch(error => log.push({ error: error.message, name }));
    },
  };
  await server.start();
  await transport.connect();
  try {
    for (let step = 0; step < options.ticks; step += 1) {
      state.tick += 1;
      if (state.tick === 12) state.creatures = 4;
      if (state.tick === 20) state.health = 45;
      server.publishTelemetry(syntheticTelemetry(state, config));
      await new Promise(resolve => setTimeout(resolve, 20));
      const snapshot = {
        pid, online: true, stale: false, error: null, authExpired: false, ageMs: 40, paused: false,
        runtime: { modules: [], pid, paused: false }, telemetry: syntheticTelemetry(state, config),
      };
      const result = automation.tick(snapshot, sink);
      log.push({ tick: state.tick, status: result.status, reason: result.reason, position: { ...state.position },
        creatures: state.creatures, health: state.health, emitted: result.emitted });
    }
  } finally { transport.close(); await server.close(); }
  return { mode: 'simulate', pid, keySource: options.key ? 'argument' : 'synthetic', commands: sent, log, serverSaw: server.commands.length };
}

async function live(options) {
  if (options.keyFile) {
    const record = JSON.parse(fs.readFileSync(path.resolve(options.keyFile), 'utf8'));
    options.key = options.key || record.key;
    if (!options.pid && Number.isInteger(record.pid)) options.pid = record.pid;
  }
  if (!Number.isInteger(options.pid) || options.pid <= 0) throw Error('Use --pid <pid>, --key-file <json> ou --simulate.');
  if (!options.key) throw Error('Defina PKA_CHANNEL_KEY no ambiente, use --key ou --key-file.');
  if (options.probe) return probe(options);
  const config = loadConfig(options.config);
  const pid = options.pid;
  const transport = new Transport({ pid, key: options.key });
  const automation = createAutomation(config, {
    creatureSource: options.creatures ? createCreatureSource(options.creatures) : undefined,
  });
  const log = [];
  let lastTelemetry = null;
  transport.on('telemetry', telemetry => { lastTelemetry = { value: telemetry, at: Date.now() }; });
  transport.on('error', error => log.push({ error: error.message }));
  await transport.connect();
  const sink = options.dry ? { command(name, parameter) { log.push({ dry: true, name, parameter }); } } : {
    command(name, parameter, extra) {
      transport.sendCommand(name, parameter, extra).then(ack => log.push({ name, parameter, ack }))
        .catch(error => log.push({ error: error.message, name }));
    },
  };
  const timer = setInterval(() => {
    if (!lastTelemetry) return;
    const telemetry = lastTelemetry.value;
    const snapshot = { pid, online: true, stale: Date.now() - lastTelemetry.at > 1000, error: null,
      authExpired: false, ageMs: Date.now() - lastTelemetry.at, paused: false,
      runtime: { modules: [], pid, paused: false }, telemetry };
    const result = automation.tick(snapshot, sink);
    log.push({ status: result.status, reason: result.reason, emitted: result.emitted });
    if (options.maxTicks && log.length >= options.maxTicks) finish(0);
  }, options.interval);
  function finish(code) {
    clearInterval(timer);
    transport.close();
    console.log(JSON.stringify({ mode: 'live', pid, log: log.slice(-200) }, null, 2));
    process.exit(code);
  }
  process.on('SIGINT', () => finish(0));
}

async function probe(options) {
  const transport = new Transport({ pid: options.pid, key: options.key, startupTimeoutMs: 5000 });
  const seen = [];
  transport.on('telemetry', telemetry => {
    seen.push(telemetry);
    console.log(JSON.stringify({ event: 'telemetry', tick: telemetry.tick, position: telemetry.position,
      healthPercent: telemetry.healthPercent, creatures: telemetry.creatures?.length ?? 0,
      rosters: telemetry.roster?.length ?? 0, pulseVersion: telemetry.pulseVersion }, null, 1));
  });
  transport.on('state', state => console.log(JSON.stringify({ event: 'state', ...state }, null, 1)));
  transport.on('error', error => console.log(JSON.stringify({ event: 'error', message: error.message })));
  await transport.connect();
  console.log(JSON.stringify({ event: 'ready', pid: options.pid, authenticated: transport.authenticated }, null, 1));
  await new Promise(resolve => setTimeout(resolve, options.seconds * 1000));
  transport.close();
  console.log(JSON.stringify({ event: 'done', telemetryFrames: seen.length, authenticated: transport.authenticated }, null, 1));
  process.exit(seen.length > 0 ? 0 : 1);
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log('Uso: node tools/run_bot.cjs --simulate [--ticks 40]');
  console.log('     node tools/run_bot.cjs --probe --pid <pid> --key-file channel-key.json [--seconds 5]');
  console.log('     node tools/run_bot.cjs --pid <pid> [--key <canal>|--key-file <json>] [--config perfil.json] [--dry]');
  console.log('     Acrescente --creatures creatures.json para alimentar cada tick com o scanner.');
  process.exit(0);
}
if (options.mode === 'simulate') {
  simulate(options).then(result => {
    console.log(JSON.stringify(result, null, 2));
    const ok = result.commands.length > 0 && result.log.some(entry => entry.status === 'combat');
    process.exit(ok ? 0 : 1);
  }).catch(error => { console.error(error.stack); process.exit(2); });
} else {
  live(options).catch(error => { console.error(error.stack); process.exit(2); });
}
