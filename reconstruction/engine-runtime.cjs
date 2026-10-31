'use strict';

const { EventEmitter } = require('node:events');
const { createAutomation, createRecorder, gateReason } = require('./automation.cjs');
const { encodeCommand } = require('./protocol.cjs');
const { mergeCreatureSnapshot } = require('../tools/creature_bridge.cjs');
const nativeAdapter = require('./native-adapter.cjs');

const MODULES = Object.freeze(['target', 'walker', 'healer']);

class EngineRuntime extends EventEmitter {
  constructor(options = {}) {
    super();
    this.now = options.now || Date.now;
    this.openAdapter = options.openAdapter || nativeAdapter.open;
    this.creatureSource = options.creatureSource;
    this.intervalMs = options.intervalMs ?? 50;
    this.timeoutMs = options.timeoutMs ?? 1500;
    this.automatic = options.automatic !== false;
    this.modules = [];
    this.paused = true;
    this.pid = null;
    this.adapter = null;
    this.automation = null;
    this.configSignature = null;
    this.timer = null;
    this.inFlight = null;
    this.epoch = 0;
    this.lastHotkeyAt = null;
    this.last = null;
    this.moving = false;
    this.engaged = false;
  }

  get sessions() {
    const session = this.adapter?.getSnapshot();
    return session ? [session] : [];
  }

  get state() {
    const phase = this.last?.status === 'error' ? this.last.error
      : this.paused ? 'Pausado' : !this.last ? 'Aguardando o jogo'
        : this.last.status === 'blocked' ? 'Aguardando: ' + this.last.reason : this.last.status;
    return { modules: [...this.modules], pid: this.pid, paused: this.paused, phase,
      phases: {}, status: this.last?.status || 'idle', reason: this.last?.reason || null,
      error: this.last?.error || null };
  }

  async bounded(operation, label) {
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(operation), new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Error('Timeout em ' + label + '; resultado incerto, execucao interrompida.')), this.timeoutMs);
      })]);
    } finally {
      clearTimeout(timer);
    }
  }

  fault(error) {
    this.paused = true;
    this.epoch++;
    this.stopTimer();
    this.last = { status: 'error', error: error.message, emitted: [] };
    const adapter = this.adapter;
    this.adapter = null;
    Promise.resolve().then(() => adapter?.close()).catch(() => {});
    this.emit('change', this.state);
  }

  async setModules(module, enabled, pid, config) {
    if (!MODULES.includes(module) && module !== 'all') throw Error('Modulo sem motor implementado: ' + module);
    if (typeof enabled !== 'boolean') throw Error('Estado do modulo invalido.');
    const next = module === 'all' ? (enabled ? [...MODULES] : []) : enabled
      ? [...new Set([...this.modules, module])] : this.modules.filter(value => value !== module);
    if (!next.length) {
      await this.pause();
      this.modules = [];
      return this.state;
    }
    if (!Number.isInteger(pid) || pid <= 0) throw Error('Selecione uma sessao com PID valido.');
    const signature = JSON.stringify(config);
    const changed = signature !== this.configSignature || pid !== this.pid;
    await this.pause();
    if (this.adapter && pid !== this.pid) {
      await this.adapter.close();
      this.adapter = null;
    }
    this.pid = pid;
    if (changed || !this.automation) {
      this.automation = createAutomation(structuredClone(config), { now: this.now,
        isEnabled: name => this.modules.includes(name),
        hotkeysBlocked: () => this.lastHotkeyAt !== null && this.now() - this.lastHotkeyAt < 250 });
      this.configSignature = signature;
    }
    if (!this.adapter) {
      this.connection = new AbortController();
      try {
        this.adapter = await this.openAdapter({ pid, config, signal: this.connection.signal });
        if (!this.adapter || typeof this.adapter.getSnapshot !== 'function'
            || typeof this.adapter.command !== 'function' || typeof this.adapter.close !== 'function'
            || typeof this.adapter.pauseWalker !== 'function' || !Array.isArray(this.adapter.supportedCommands)) {
          throw Error('Adapter de execucao incompleto.');
        }
        const adapter = this.adapter;
        adapter.on?.('fault', error => { if (this.adapter === adapter) this.fault(error); });
      } catch (error) {
        this.connection.abort();
        this.fault(error);
        throw error;
      }
    }
    this.modules = next;
    this.paused = false;
    this.last = null;
    if (this.automatic) {
      this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
      this.timer.unref?.();
    }
    this.emit('change', this.state);
    return this.state;
  }

  stopTimer() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async pause() {
    const wasActive = !this.paused;
    this.paused = true;
    this.epoch++;
    this.stopTimer();
    await this.inFlight;
    if (wasActive && this.adapter) {
      try {
        if (await this.bounded(() => this.adapter.pauseWalker(true, { pid: this.pid }), 'stop') !== true) {
          throw Error('Pausa sem confirmacao do runtime.');
        }
        this.moving = false;
        this.engaged = false;
      } catch (error) {
        this.fault(error);
        throw error;
      }
    }
    this.emit('change', this.state);
    return this.state;
  }

  async togglePause() {
    if (!this.paused) return this.pause();
    if (!this.modules.length || !this.adapter) throw Error('Ative um motor conectado antes de continuar.');
    this.paused = false;
    this.last = null;
    if (this.automatic) {
      this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
      this.timer.unref?.();
    }
    return this.state;
  }

  snapshot() {
    let snapshot = this.adapter?.getSnapshot();
    if (!snapshot) return null;
    if (snapshot.pid !== this.pid) throw Error('PID da sessao divergente.');
    snapshot = { ...snapshot, paused: false, runtime: { pid: this.pid, paused: false, modules: [...this.modules] } };
    if (this.creatureSource && this.modules.some(name => name === 'target' || name === 'walker')) {
      snapshot = mergeCreatureSnapshot(snapshot, this.creatureSource(), this.now());
    }
    return snapshot;
  }

  async tick() {
    if (this.paused || !this.adapter || this.inFlight) return null;
    const epoch = this.epoch;
    this.inFlight = this.runTick(epoch);
    try { return await this.inFlight; } finally { this.inFlight = null; }
  }

  async manualCommand(pid, name, parameter, extra) {
    if (!this.adapter) throw Error('Nenhum motor conectado. Ative um modulo antes de enviar comandos.');
    if (Number.isInteger(pid) && this.pid && pid !== this.pid) throw Error('PID da sessao divergente.');
    if (!this.adapter.supportedCommands.includes(name)) throw Error('Comando sem suporte: ' + name);
    encodeCommand(1, name, parameter, extra);
    const command = this.bounded(() => this.adapter.command(name, parameter, { pid: this.pid, extra }), name);
    if (await command !== true) throw Error('Comando sem ACK positivo: ' + name);
    return true;
  }

  get connected() {
    return Boolean(this.adapter);
  }

  // Opens the transport for manual control without enabling any engine. The
  // menu's direction pad / attack / follow must work before a module is started.
  async connect(pid, config) {
    if (this.adapter && this.pid === pid) return this.adapter;
    if (!Number.isInteger(pid) || pid <= 0) throw Error('Selecione uma sessao com PID valido.');
    await this.pause();
    if (this.adapter && pid !== this.pid) { await this.adapter.close(); this.adapter = null; }
    this.pid = pid;
    if (!this.automation) {
      this.automation = createAutomation(structuredClone(config || {}), { now: this.now,
        isEnabled: name => this.modules.includes(name),
        hotkeysBlocked: () => this.lastHotkeyAt !== null && this.now() - this.lastHotkeyAt < 250 });
      this.configSignature = JSON.stringify(config);
    }
    if (!this.adapter) {
      this.connection = new AbortController();
      try {
        this.adapter = await this.openAdapter({ pid, config, signal: this.connection.signal });
        if (!this.adapter || typeof this.adapter.getSnapshot !== 'function'
            || typeof this.adapter.command !== 'function' || typeof this.adapter.close !== 'function'
            || typeof this.adapter.pauseWalker !== 'function' || !Array.isArray(this.adapter.supportedCommands)) {
          throw Error('Adapter de execucao incompleto.');
        }
        const adapter = this.adapter;
        adapter.on?.('fault', error => { if (this.adapter === adapter) this.fault(error); });
      } catch (error) {
        this.connection.abort();
        this.fault(error);
        throw error;
      }
    }
    this.emit('change', this.state);
    return this.adapter;
  }

  async runTick(epoch) {
    try {
      const snapshot = this.snapshot();
      if (!snapshot) {
        this.last = { status: 'blocked', reason: 'no-telemetry', emitted: [] };
        return this.last;
      }
      const recorder = createRecorder();
      const result = this.automation.tick(snapshot, recorder);
      for (const event of recorder.events) {
        if (!this.adapter.supportedCommands.includes(event.name)) throw Error('Comando sem suporte: ' + event.name);
        encodeCommand(1, event.name, event.parameter, event.extra);
      }
      if ((this.moving && ['blocked', 'combat', 'heal', 'revive'].includes(result.status))
          || (this.engaged && result.status !== 'combat')) {
        if (await this.bounded(() => this.adapter.pauseWalker(true, { pid: this.pid }), 'stop') !== true) {
          throw Error('Walker sem confirmacao de parada.');
        }
        this.moving = false;
        this.engaged = false;
      }
      for (const event of recorder.events) {
        if (this.paused || epoch !== this.epoch) break;
        const reason = gateReason(this.snapshot());
        if (reason) throw Error('Sessao mudou antes do envio: ' + reason);
        if (event.name === 'hotkey' && this.lastHotkeyAt !== null && this.now() - this.lastHotkeyAt < 250) {
          throw Error('Lote excedeu o Global Cooldown.');
        }
        const adapter = this.adapter;
        if (event.name === 'hotkey') this.lastHotkeyAt = this.now();
        this.automation.recordDispatch(event.name, event.parameter, this.now());
        const ack = await this.bounded(() => adapter.command(event.name, event.parameter,
          { pid: this.pid, extra: event.extra }), event.name);
        if (ack !== true) throw Error('Comando sem ACK positivo: ' + event.name);
        if (event.name === 'walk') this.moving = true;
        if (event.name === 'attack') this.engaged = true;
      }
      if (epoch === this.epoch) this.last = result;
      return result;
    } catch (error) {
      if ((this.moving || this.engaged) && this.adapter) {
        const adapter = this.adapter;
        try { await this.bounded(() => adapter.pauseWalker(true, { pid: this.pid }), 'stop-after-error'); }
        catch (stopError) { error = Error(error.message + ' Parada pendente: ' + stopError.message); }
        this.moving = false;
        this.engaged = false;
      }
      this.fault(error);
      return this.last;
    }
  }

  async close() {
    try { await this.pause(); } finally {
      this.connection?.abort();
      await this.adapter?.close();
      this.adapter = null;
      this.modules = [];
    }
  }
}

module.exports = { EngineRuntime, MODULES };
