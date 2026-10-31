'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { setTimeout: sleep } = require('node:timers/promises');
const { createAutomation, createRecorder } = require('../reconstruction/automation.cjs');
const { createCreatureSource } = require('./creature_bridge.cjs');

function parseArgs(argv) {
  const options = { intervalMs: 200, maxAgeMs: 1000, timeoutMs: 1000,
    healBelow: 80, resumeAbove: 80, actuate: false, once: false };
  const fields = { '--config': 'config', '--session': 'session', '--creatures': 'creatures',
    '--adapter': 'adapter', '--pid': 'pid', '--tick-ms': 'intervalMs', '--max-age-ms': 'maxAgeMs',
    '--timeout-ms': 'timeoutMs', '--heal-below': 'healBelow', '--resume-above': 'resumeAbove' };
  const numbers = new Set(['pid', 'intervalMs', 'maxAgeMs', 'timeoutMs', 'healBelow', 'resumeAbove']);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--actuate') options.actuate = true;
    else if (flag === '--once') options.once = true;
    else if (flag === '--help') options.help = true;
    else {
      const field = fields[flag];
      const value = argv[++index];
      if (!field || value === undefined || value.startsWith('--')) throw Error('Argumento invalido: ' + flag);
      options[field] = numbers.has(field) ? Number(value) : path.resolve(value);
    }
  }
  if (options.help) return options;
  if (!options.config || !options.session || !Number.isSafeInteger(options.pid) || options.pid <= 0) {
    throw Error('Exige --config PATH --session PATH --pid N. Use --help.');
  }
  for (const field of ['intervalMs', 'maxAgeMs', 'timeoutMs']) {
    if (!Number.isSafeInteger(options[field]) || options[field] < 1 || options[field] > 60000) {
      throw Error(field + ' exige inteiro entre 1 e 60000.');
    }
  }
  if (!argv.includes('--resume-above')) options.resumeAbove = options.healBelow;
  if (options.actuate && !options.adapter) throw Error('--actuate exige --adapter PATH; sem transporte implicito.');
  return options;
}

async function readJson(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw Error('JSON ausente ou maior que 16 MiB: ' + file);
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function freshSession(snapshot, options, now) {
  const age = typeof snapshot?.generatedAt === 'string' ? now - Date.parse(snapshot.generatedAt) : NaN;
  if (!Number.isFinite(age) || age < 0 || age > options.maxAgeMs) throw Error('Sessao expirada ou sem generatedAt valido.');
  if (snapshot.pid !== options.pid) throw Error('PID da sessao diverge de --pid.');
  if (!Number.isFinite(snapshot.ageMs) || snapshot.ageMs < 0) throw Error('Sessao sem ageMs valido.');
  if (snapshot.ageMs + age > Math.min(1000, options.maxAgeMs)) throw Error('Telemetria expirada.');
  return { ...snapshot, ageMs: snapshot.ageMs + age };
}

async function bounded(operation, timeoutMs, label) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Error('Timeout em ' + label + '; resultado incerto, sem retry.'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function createHuntDaemon(config, options, dependencies = {}) {
  const now = dependencies.now || Date.now;
  const log = dependencies.log || (entry => console.log(JSON.stringify({ at: new Date(now()).toISOString(), ...entry })));
  const readSession = dependencies.readSession || (() => readJson(options.session));
  const readCreatures = dependencies.readCreatures || (options.creatures
    ? createCreatureSource(options.creatures, { now, maxAgeMs: options.maxAgeMs, pid: options.pid }) : null);
  const adapter = dependencies.adapter;
  if (options.actuate && (!adapter || typeof adapter.command !== 'function'
      || typeof adapter.pauseWalker !== 'function' || !Array.isArray(adapter.supportedCommands))) {
    throw Error('Adapter exige command, pauseWalker e supportedCommands.');
  }
  const automation = createAutomation(config, { hunt: { healBelow: options.healBelow, resumeAbove: options.resumeAbove },
    now, creatureMaxAgeMs: options.maxAgeMs });
  let busy = false;
  let faulted = false;
  let lastStatus = null;
  let lastLogAt = -Infinity;

  async function pauseWalker(paused) {
    if (!options.actuate) return;
    const result = await bounded(signal => adapter.pauseWalker(paused, { pid: options.pid, signal }),
      options.timeoutMs, 'pauseWalker');
    if (result !== true) throw Error('Adapter nao confirmou pauseWalker.');
  }

  async function tick() {
    if (busy) throw Error('Tick concorrente recusado.');
    if (faulted) throw Error('Daemon interrompido por falha de transporte; recrie a sessao.');
    busy = true;
    try {
      let snapshot;
      let sourceSnapshot;
      let sourceError;
      try {
        snapshot = await readSession();
        if (readCreatures) snapshot = { ...snapshot, creatureSnapshot: await readCreatures() };
        sourceSnapshot = snapshot;
        snapshot = freshSession(snapshot, options, now());
        if (snapshot.creatureSnapshot?.diagnostics?.limit_reached) throw Error('Scanner parcial: limit_reached.');
      } catch (error) {
        sourceError = error.message;
        snapshot = { online: false };
      }
      const recorder = createRecorder();
      const result = automation.tick(snapshot, recorder);
      if (sourceError) { result.reason = 'snapshot-read'; result.error = sourceError; }
      if (options.actuate) {
        const unsupported = recorder.events.find(event => !adapter.supportedCommands.includes(event.name));
        if (unsupported) throw Error('Adapter nao suporta ' + unsupported.name + '; lote nao enviado.');
        await pauseWalker(result.pauseWalker);
        for (const event of recorder.events) {
          if (dependencies.signal?.aborted) break;
          freshSession(sourceSnapshot, options, now());
          if (snapshot.creatureSnapshot) {
            const age = now() - Date.parse(snapshot.creatureSnapshot.generatedAt);
            if (!Number.isFinite(age) || age < 0 || age > options.maxAgeMs) throw Error('Criaturas expiraram antes do envio.');
          }
          const ack = await bounded(signal => adapter.command(event.name, event.parameter,
            { pid: options.pid, extra: event.extra, signal }), options.timeoutMs, event.name);
          if (ack !== true) throw Error('Comando sem ACK positivo: ' + event.name);
        }
      }
      const signature = result.status + ':' + result.reason + ':' + result.error;
      if (signature !== lastStatus || recorder.events.length || now() - lastLogAt >= 5000) {
        log({ mode: options.actuate ? 'actuate' : 'dry-run', status: result.status,
          pauseWalker: result.pauseWalker, monsters: result.detected ?? null,
          hp: snapshot.telemetry?.healthPercent ?? null, targetId: result.fight?.targetId ?? null,
          waypoint: automation.state.walker.index, commands: recorder.events,
          reason: result.reason, error: result.error, blocked: result.blocked || [] });
        lastStatus = signature;
        lastLogAt = now();
      }
      return result;
    } catch (error) {
      faulted = true;
      try { await pauseWalker(true); }
      catch (stopError) { throw new AggregateError([error, stopError], error.message + '; parada nao confirmada: ' + stopError.message); }
      throw error;
    } finally {
      busy = false;
    }
  }

  return { tick, automation, pauseWalker };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('node tools/hunt_daemon.cjs --config hunt.json --session session.json --pid N\n'
      + '  [--creatures creatures.json] [--tick-ms 200] [--heal-below 80] [--resume-above 80]\n'
      + '  [--max-age-ms 1000] [--timeout-ms 1000] [--once] [--actuate --adapter adapter.cjs]\n'
      + 'Padrao: dry-run. A sessao deve ser verificada e renovada atomicamente pelo produtor.');
    return 0;
  }
  const config = await readJson(options.config);
  if (!config.walker?.waypoints?.length) throw Error('Configure os waypoints antes de iniciar a hunt.');
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let adapter;
  let daemon;
  try {
    if (options.actuate) adapter = await bounded(signal => require(options.adapter).open({
      pid: options.pid, config, signal }), options.timeoutMs, 'adapter.open');
    daemon = createHuntDaemon(config, options, { adapter, signal: controller.signal });
    console.log(JSON.stringify({ status: 'started', mode: options.actuate ? 'actuate' : 'dry-run',
      pid: options.pid, tickMs: options.intervalMs }));
    await daemon.pauseWalker(true);
    while (!controller.signal.aborted) {
      const started = performance.now();
      const result = await daemon.tick();
      if (options.once) return result.status === 'blocked' ? 2 : 0;
      const elapsed = performance.now() - started;
      if (elapsed > options.intervalMs) console.log(JSON.stringify({ status: 'tick-overrun', elapsedMs: Math.round(elapsed) }));
      try {
        await sleep(Math.max(1, options.intervalMs - elapsed), undefined, { signal: controller.signal });
      } catch (error) {
        if (error.name !== 'AbortError') throw error;
      }
    }
    return 0;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    try {
      if (daemon) await daemon.pauseWalker(true);
      else if (adapter?.pauseWalker) await bounded(signal => adapter.pauseWalker(true,
        { pid: options.pid, signal }), options.timeoutMs, 'shutdown.pauseWalker');
    } finally {
      if (adapter?.close) await bounded(signal => adapter.close({ signal }), options.timeoutMs, 'adapter.close');
      console.log(JSON.stringify({ status: 'stopped', pauseWalkerRequested: true }));
    }
  }
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(JSON.stringify({ status: 'fatal', pauseWalkerRequested: true, error: error.message }));
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, freshSession, bounded, createHuntDaemon, main };
