'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { RpmCombatRuntime } = require('../reconstruction/rpm-combat-runtime.cjs');
const { createKeyboardInput } = require('../reconstruction/walker-input-runtime.cjs');
const { rpmSession } = require('../reconstruction/live-session.cjs');
const { createCreatureSource } = require('./creature_bridge.cjs');

async function main() {
  const pid = Number(process.argv[2]);
  const name = process.argv[3];
  const durationOption = process.argv.find(value => value.startsWith('--duration-ms='));
  const durationMs = durationOption ? Number(durationOption.split('=')[1]) : 3500;
  if (!Number.isInteger(durationMs) || durationMs < 1000 || durationMs > 10000) throw Error('Duracao deve estar entre 1000 e 10000ms.');
  if (!Number.isInteger(pid) || pid <= 0 || !name) throw Error('Uso: node tools/live_combat_check.cjs PID PLAYER');
  const root = path.resolve(__dirname, '..');
  const directory = path.join(root, 'captures', 'combat-live-' + pid + '-' + new Date().toISOString().replace(/[:.]/g, '-'));
  console.log(JSON.stringify({ captureDirectory: directory, pid }));
  fs.mkdirSync(directory, { recursive: true });
  const sessionFile = path.join(directory, 'session.json');
  const creatureFile = path.join(directory, 'creatures.json');
  const children = [];
  const movementDispatches = [];
  const log = record => fs.appendFileSync(path.join(directory, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n');
  const start = (script, args) => {
    const child = spawn(process.env.PKA_PYTHON || 'python', [path.join(root, 'tools', script), ...args], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', data => log({ source: script, stdout: data.toString() }));
    child.stderr.on('data', data => log({ source: script, stderr: data.toString() }));
    child.on('error', error => log({ source: script, error: error.message }));
    children.push(child);
  };
  let runtime;
  const keyboardInput = createKeyboardInput();
  try {
    start('pka_live_session.py', ['--watch', '--pid', String(pid), '--player-name', name,
      '--creatures-interval-s', '0', '--output', sessionFile]);
    start('scan_creatures.py', ['--pid', String(pid), '--player-name', name, '--stream', '--interval-ms', '300', '--output', creatureFile]);
    runtime = new RpmCombatRuntime({ automatic: false, playerName: name,
      input: async (clientPid, direction, focus) => {
        const result = await keyboardInput(clientPid, direction, focus);
        if (direction !== null) movementDispatches.push({ ...result, direction, at: Date.now() });
        log({ keyboard: { ...result, direction, focus: focus === true },
          position: runtime.sessions[0]?.telemetry.position });
        return result;
      },
      getSession: () => { try { return rpmSession(JSON.parse(fs.readFileSync(sessionFile, 'utf8'))); } catch { return null; } },
      creatureSource: createCreatureSource(creatureFile, { pid }),
      transportFile: path.join(root, 'local-data', 'keyboard-combat.json'),
      onDispatch: dispatch => log({ dispatch }),
    });
    const deadline = Date.now() + 90000;
    while (!runtime.sessions[0]?.capabilities.targetKeyboard && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    if (!runtime.sessions[0]?.capabilities.targetKeyboard) throw Error('Sessao/stream sem prontidao apos 90s: ' + JSON.stringify(runtime.sessions[0]?.capabilities));
    const settings = JSON.parse(fs.readFileSync(path.join(root, 'local-data/profiles/electron/settings.json'), 'utf8'));
    const config = settings.profiles.find(profile => profile.name === settings.activeProfile).config;
    log({ stage: 'ready', pid, session: runtime.sessions[0], profile: settings.activeProfile });
    if (process.argv.includes('--wait-for-go')) {
      const armed = Date.now();
      fs.writeFileSync(path.join(directory, 'ready.json'), JSON.stringify({ armed }));
      const signal = path.join(directory, 'go.json');
      let accepted = false;
      while (Date.now() - armed < 60000) {
        try { if (JSON.parse(fs.readFileSync(signal, 'utf8')).at >= armed) { accepted = true; break; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!accepted) throw Error('Validacao cancelada: foco nao confirmado em 60s.');
    }
    if (process.argv.includes('--single-target')) {
      config.hoenn.perfectLure = false;
      config.target.combo.useNativeSequence = false;
      config.target.combo.sequenceText = 'm5';
      config.target.maxDistance = 2;
      log({ overridesForValidationOnly: { perfectLure: false, useNativeSequence: false, sequenceText: 'm5', maxDistance: 2 } });
    }
    await runtime.setModules('target', true, pid, config);
    if (process.argv.includes('--walker')) await runtime.setModules('walker', true, pid, config);
    log({ durationMs, maxDistance: config.target.maxDistance });
    const until = Date.now() + durationMs;
    while (Date.now() < until && !runtime.paused) {
      const result = await runtime.tick();
      if (result) log({ tick: result, state: runtime.state,
        position: runtime.sessions[0]?.telemetry.position,
        creatures: runtime.sessions[0]?.telemetry.creatures });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    log({ stage: 'finished', state: runtime.state, dispatches: runtime.dispatchLog.length });
    fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ generatedAt: new Date().toISOString(),
      pid, state: runtime.state, dispatches: runtime.dispatchLog, movementDispatches, effectVerified: false }, null, 2));
    if (!runtime.dispatchLog.length && !movementDispatches.length) process.exitCode = 2;
    if (runtime.state.status === 'error') process.exitCode = 1;
  } catch (error) {
    const failure = { generatedAt: new Date().toISOString(), pid, completed: false,
      error: error.message, code: error.code || null, state: runtime?.state || null,
      dispatches: runtime?.dispatchLog || [], movementDispatches, effectVerified: false };
    log({ stage: 'failed', ...failure });
    fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(failure, null, 2));
    throw error;
  } finally {
    await runtime?.close();
    for (const child of children) child.kill();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
