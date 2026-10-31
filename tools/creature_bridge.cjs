'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const TargetEngine = require('../target-engine.cjs');
const { isPosition } = require('../reconstruction/engines/shared.cjs');

const root = path.resolve(__dirname, '..');

function createCreatureSource(file, options = {}) {
  const absolute = path.resolve(file);
  const now = options.now || Date.now;
  const maxAgeMs = options.maxAgeMs ?? 2500;
  let previous = null;
  const fresh = snapshot => {
    const age = now() - Date.parse(snapshot?.generatedAt);
    return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
  };
  return () => {
    let snapshot;
    try {
      const stat = fs.statSync(absolute);
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw Error('Stream excede 16 MiB ou nao e arquivo.');
      if (stat.size === 0) throw Error('Aguardando stream inicial de criaturas...');
      const raw = fs.readFileSync(absolute, 'utf8');
      if (!raw || !raw.trim()) throw Error('Aguardando stream inicial de criaturas...');
      snapshot = JSON.parse(raw);
    } catch (error) {
      if ((error instanceof SyntaxError || ['ENOENT', 'EACCES', 'EPERM', 'EBUSY'].includes(error.code))
          && previous && fresh(previous)) return structuredClone(previous);
      if (error instanceof SyntaxError) throw Error('Aguardando stream inicial de criaturas...');
      throw error;
    }
    if (!snapshot || snapshot.schema !== 2 || !Array.isArray(snapshot.creatures)
        || !Number.isInteger(snapshot.pid) || snapshot.pid <= 0
        || (options.pid !== undefined && snapshot.pid !== options.pid)
        || snapshot.error || snapshot.diagnostics?.limit_reached || !fresh(snapshot)
        || (previous && (snapshot.pid !== previous.pid
          || Date.parse(snapshot.generatedAt) < Date.parse(previous.generatedAt)))) {
      previous = null;
      throw Error('Stream de criaturas invalido, parcial, expirado ou fora de ordem.');
    }
    previous = structuredClone(snapshot);
    return snapshot;
  };
}

function mergeCreatureSnapshot(session, scan, now = Date.now(), maxAgeMs = 1000) {
  if (!scan || scan.schema !== 2 || !Array.isArray(scan.creatures) || scan.error
      || !Number.isInteger(scan.pid) || scan.pid <= 0 || scan.pid !== session?.pid) {
    throw Error('Snapshot de criaturas invalido ou PID divergente.');
  }
  const generatedAt = typeof scan.generatedAt === 'string' ? Date.parse(scan.generatedAt) : NaN;
  const age = now - generatedAt;
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0
      || !Number.isFinite(age) || age < 0 || age > maxAgeMs) {
    throw Error('Snapshot de criaturas expirado ou sem timestamp valido.');
  }
  const telemetry = session.telemetry;
  if (!telemetry || !isPosition(telemetry.position)) throw Error('Telemetria sem posicao valida.');
  if (scan.player && (!isPosition(scan.player.pos)
      || scan.player.pos.z !== telemetry.position.z
      || typeof scan.player.name !== 'string' || !scan.player.name.trim()
      || (telemetry.playerName && scan.player.name.trim().toLowerCase()
        !== telemetry.playerName.trim().toLowerCase()))) {
    throw Error('Identidade ou andar do scanner diverge da telemetria.');
  }
  return { ...session, telemetry: { ...telemetry,
    playerName: telemetry.playerName || scan.player?.name,
    creaturesStale: false, creaturesGeneratedAt: scan.generatedAt,
    creaturePlayer: scan.player ? structuredClone(scan.player) : null,
    creatureIdentityProfile: scan.layout?.identityProfile ? structuredClone(scan.layout.identityProfile) : null,
    creatures: scan.creatures.map(creature => creature && typeof creature === 'object'
      ? { ...creature, pos: creature.pos ? { ...creature.pos } : creature.pos } : creature),
  } };
}

function parseArgs(argv) {
  const options = { snapshot: null, pid: null, config: path.join(root, 'default_config.json'),
    playerName: null, maxDistance: 8, priorityMode: 'nearest' };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => argv[++index];
    if (flag === '--snapshot') options.snapshot = value();
    else if (flag === '--pid') options.pid = Number(value());
    else if (flag === '--config') options.config = value();
    else if (flag === '--player-name') options.playerName = value();
    else if (flag === '--max-distance') options.maxDistance = Number(value());
    else if (flag === '--priority-mode') options.priorityMode = value();
    else if (flag === '--actuate') options.actuate = true;
  }
  return options;
}

function python() {
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const executable of candidates) {
    const probe = spawnSync(executable, ['-c', 'print(1)'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return executable;
  }
  return null;
}

function loadSnapshot(options) {
  if (options.snapshot) return JSON.parse(fs.readFileSync(options.snapshot, 'utf8'));
  if (!options.pid) throw new Error('provide --snapshot PATH or --pid N');
  const interpreter = python();
  if (!interpreter) throw new Error('python is not available');
  const args = [path.join(root, 'tools', 'scan_creatures.py'), '--pid', String(options.pid)];
  if (options.playerName) args.push('--player-name', options.playerName);
  const run = spawnSync(interpreter, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(run.stderr || run.stdout || 'scanner failed');
  return JSON.parse(run.stdout);
}

function engineConfig(options) {
  let monsters = ['*'];
  let maxDistance = options.maxDistance;
  let priorityMode = options.priorityMode;
  try {
    const settings = JSON.parse(fs.readFileSync(options.config, 'utf8'));
    const target = settings.target || {};
    if (Array.isArray(target.monsters) && target.monsters.length) monsters = target.monsters;
  } catch {
    monsters = ['*'];
  }
  return { monsters, maxDistance, priorityMode, globalCooldownMs: 250,
    skills: [
      { key: 'f1', cooldownMs: 1000, minDistance: 1, maxDistance: 5 },
      { key: 'f2', cooldownMs: 2000, maxDistance: 3, onlyIfHpBelow: 30 },
    ] };
}


function dispatchKey(pid, key) {
  if (!key) return false;
  const script = path.join(root, 'tools', 'combat_actuator.py');
  const run = spawnSync('python', [script, String(pid), String(key)], { encoding: 'utf8' });
  return run.status === 0;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const snapshot = loadSnapshot(options);
  const player = snapshot.player && snapshot.player.pos
    ? { x: snapshot.player.pos.x, y: snapshot.player.pos.y, z: snapshot.player.pos.z,
        name: snapshot.player.name }
    : null;
  if (!player) {
    console.log(JSON.stringify({ error: 'snapshot has no player; pass --player-name to the scanner',
      pid: snapshot.pid, creatures: snapshot.creatures.length }, null, 2));
    return 1;
  }
  const engine = new TargetEngine(engineConfig(options));
  const creatureList = snapshot.creatures.filter(item => item.healthPercent != null);
  const target = engine.selectTarget(player, creatureList);
  const action = engine.getCombatAction(player, engine.config);
  let dispatched = false;
  if (options.actuate && action && action.type === 'key' && action.key) {
    dispatched = dispatchKey(snapshot.pid, action.key);
  }
  console.log(JSON.stringify({ pid: snapshot.pid, target, action, dispatched,
    pauseWalker: engine.isFighting(), considered: creatureList.length }, null, 2));
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { parseArgs, loadSnapshot, engineConfig, createCreatureSource, mergeCreatureSnapshot };
