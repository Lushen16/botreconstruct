'use strict';

const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { Transport } = require('./transport.cjs');
const { COMMANDS } = require('./protocol.cjs');

function channelKey(pid, environment = process.env) {
  if (environment.PKA_CHANNEL_KEY) return environment.PKA_CHANNEL_KEY;
  const filename = environment.PKA_CHANNEL_KEY_FILE;
  if (!filename) throw Error('Configure PKA_CHANNEL_KEY ou PKA_CHANNEL_KEY_FILE para conectar o motor.');
  const record = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (record.pid !== pid || typeof record.key !== 'string' || !record.key) {
    throw Error('Arquivo da chave ausente, invalido ou de outro PID.');
  }
  return record.key;
}

async function open({ pid, signal }, dependencies = {}) {
  if (signal?.aborted) throw Error('Conexao cancelada.');
  const now = dependencies.now || Date.now;
  const transport = dependencies.transport || new Transport({ pid, key: channelKey(pid), commandTimeoutMs: 1000 });
  const adapter = new EventEmitter();
  let state = null;
  let telemetry = null;
  let closed = false;
  let failure = null;
  const abort = () => transport.close();
  transport.on('state', value => { state = { value: structuredClone(value), at: now() }; });
  transport.on('telemetry', value => { telemetry = { value: structuredClone(value), at: now() }; });
  const fault = error => {
    failure = error.message;
    adapter.emit('fault', error);
  };
  transport.on('error', fault);
  transport.on('automation-revoked', () => fault(Error('Automacao revogada pelo runtime.')));
  transport.on('close', () => { if (!closed) fault(Error('Canal do runtime encerrado.')); });
  adapter.supportedCommands = Object.keys(COMMANDS);
  adapter.getSnapshot = () => {
    if (!state || !telemetry) return null;
    const timestamp = now();
    const ageMs = Math.max(timestamp - state.at, timestamp - telemetry.at);
    const health = state.value.healthPercent;
    return {
      generatedAt: new Date(timestamp).toISOString(), pid,
      online: !closed && !failure && state.value.online === true,
      stale: ageMs < 0 || ageMs > 1000, ageMs, error: failure,
      authExpired: state.value.authExpired === true,
      healthPercent: Number.isFinite(health) && health >= 0 && health <= 100 ? health : undefined,
      targetId: state.value.targetId,
      telemetry: { ...structuredClone(telemetry.value),
        healthPercent: Number.isFinite(health) && health >= 0 && health <= 100 ? health : undefined },
    };
  };
  adapter.command = async (name, parameter, context = {}) => {
    if (closed || failure || context.signal?.aborted || (context.pid !== undefined && context.pid !== pid)) {
      throw Error('Canal fechado, cancelado ou PID divergente.');
    }
    if (!adapter.supportedCommands.includes(name)) throw Error('Comando sem suporte: ' + name);
    const ack = await transport.sendCommand(name, parameter, context.extra);
    if (ack.status !== 0) throw Error('Comando rejeitado pelo runtime: ' + name + ' (status ' + ack.status + ').');
    if (ack.type !== COMMANDS[name]) throw Error('ACK de outro tipo de comando: ' + name);
    return true;
  };
  adapter.pauseWalker = async (paused, context) => paused ? adapter.command('stop', 0, context) : true;
  adapter.close = async () => {
    closed = true;
    signal?.removeEventListener('abort', abort);
    transport.close();
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await transport.connect();
    if (signal?.aborted || failure) throw Error('Conexao cancelada ou encerrada.');
    return adapter;
  } catch (error) {
    await adapter.close();
    throw error;
  }
}

module.exports = { open, channelKey };
