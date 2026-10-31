'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { WalkerInputRuntime, positionIssue } = require('./walker-input-runtime.cjs');
const { createTargetEngine } = require('./engines/target-engine.cjs');
const { createLureEngine } = require('./engines/lure-engine.cjs');
const { mergeCreatureSnapshot } = require('../tools/creature_bridge.cjs');
const { readBindings, projectTarget, createCombatInput } = require('./keyboard-combat.cjs');
const { CaptureRuntime } = require('./capture-runtime.cjs');
const { captureRequest } = require('./capture-input.cjs');
const { mergeItemSnapshot } = require('./item-source.cjs');

class RpmCombatRuntime extends WalkerInputRuntime {
  constructor(options = {}) {
    super({ ...options, allowedActions: ['walk', 'wait', 'box', 'safespot'] });
    this.creatureSource = options.creatureSource;
    this.itemSource = options.itemSource;
    this.capture = new CaptureRuntime();
    this.loadTransport = options.loadTransport || (() => {
      const transport = JSON.parse(fs.readFileSync(options.transportFile, 'utf8'));
      const clientConfig = transport.clientConfig || (process.env.APPDATA
        && path.join(process.env.APPDATA, 'PokeAlliance', 'PokeAllianceV3', 'config.otml'));
      if (!clientConfig) throw Error('Caminho da configuracao de hotkeys do cliente ausente.');
      return { ...transport, bindings: readBindings(clientConfig) };
    });
    this.combatInput = options.combatInput || createCombatInput();
    this.combat = null;
    this.lure = null;
    this.config = null;
    this.transport = null;
    this.queue = [];
    this.targetView = null;
    this.lastCombatSnapshot = null;
    this.retryCombatSnapshot = null;
    this.dispatchLog = [];
    this.onDispatch = options.onDispatch || (() => {});
    this.keyUsedAt = new Map();
    this.maxAgeMs = options.maxAgeMs ?? (options.now ? 500 : (Number(process.env.PKA_MAX_AGE_MS) || 1500));
  }

  get sessions() {
    const maxAge = this.maxAgeMs;
    return super.sessions.map(session => {
      let merged = session;
      let issue = null;
      try {
        if (this.creatureSource) merged = mergeCreatureSnapshot(session, this.creatureSource(), this.now(), maxAge);
        else if (session.telemetry.creaturesStale !== false) throw Error('Lista RPM de criaturas desatualizada.');
        const transport = this.loadTransport();
        const age = this.now() - Date.parse(merged.telemetry.creaturesGeneratedAt);
        const playerAge = this.now() - Date.parse(merged.generatedAt);
        const profile = merged.telemetry.creatureIdentityProfile;
        if (!Number.isFinite(age) || age < 0 || age > maxAge) throw Error('Identidade de criaturas expirada (limite ' + maxAge + 'ms).');
        if (!Number.isFinite(playerAge) || playerAge < 0 || playerAge > maxAge) throw Error('Sessao RPM expirada para combate (limite ' + maxAge + 'ms).');
        if (profile?.executableSha256 !== '473df25c1edd23e7464ad3ba9b923a603051a8b4ae8004a95c06402f678294e6'
            || profile.typeOffset !== '0x186') throw Error('Leitura de posse sem perfil comprovado do cliente.');
        const player = merged.telemetry.creaturePlayer;
        if (player?.ownershipVerified !== true || player.creatureType !== 0 || !Number.isInteger(player.id)
            || player.name?.toLowerCase() !== merged.telemetry.playerName?.toLowerCase()) {
          throw Error('Identidade RPM do jogador ausente ou divergente.');
        }
        if (!isDeepStrictEqual(player.pos, merged.telemetry.position)) throw Error('Posicoes RPM divergentes; projecao de combate suspensa.');
        const entities = new Map();
        const ambiguous = new Set();
        for (const creature of merged.telemetry.creatures) {
          if (!creature || !Number.isInteger(creature.id)) continue;
          if (creature.ownershipVerified !== true || !Number.isInteger(creature.creatureType)) continue;
          const normalized = { id: creature.id, name: creature.name, pos: creature.pos,
            healthPercent: creature.healthPercent, canAttack: creature.canAttack,
            is_player: creature.is_player === true || creature.creatureType === 0
              || (creature.id >= 0x10000000 && creature.id < 0x20000000),
            creatureType: creature.creatureType, isOwnPokemon: creature.isOwnPokemon,
            is_owned: creature.is_owned, ownershipVerified: true, struct_va: creature.struct_va };
          if (entities.has(creature.id) && !isDeepStrictEqual(entities.get(creature.id), normalized)) ambiguous.add(creature.id);
          entities.set(creature.id, normalized);
        }
        const own = [...entities.values()].filter(creature => creature.creatureType === 3 && creature.healthPercent > 0);
        if (own.length !== 1 || ambiguous.has(own[0].id)) throw Error('Pokemon proprio ausente, ambiguo ou em troca; combate suspenso.');
        merged = { ...merged, telemetry: { ...merged.telemetry,
          ownPokemon: own[0],
          creatures: [...entities.values()].filter(creature => !ambiguous.has(creature.id) && creature.creatureType === 1
            && creature.is_owned !== true && creature.isOwnPokemon !== true) } };
        if (!transport.viewport) throw Error('Calibracao do viewport pendente.');
      } catch (error) { issue = error.message; }
      return { ...merged, capabilities: { ...merged.capabilities,
        targetKeyboard: !issue && merged.capabilities.walkerKeyboard === true,
        targetKeyboardIssue: issue, combatTransport: 'PostMessageW' } };
    });
  }

  get state() {
    const state = super.state;
    const target = this.targetView ? { ...this.targetView } : null;
    const walker = this.engine?.state || null;
    return { ...state, selectedTargetId: this.combat?.state.targetId ?? null,
      target, targetName: target?.name ?? null, targetDistance: target?.distance ?? null,
      targetHp: target?.healthPercent ?? null,
      walkerWaypoint: walker && Number.isInteger(walker.index) ? walker.index + 1 : null,
      walkerWaypoints: walker && Number.isInteger(walker.total) ? walker.total : null,
      phase: this.last?.error || (this.paused ? 'Teclado/RPM pausado'
        : this.modules.join(' + ') + ': ' + (this.last?.action || 'aguardando')),
      targetEffectVerified: false, lastCombatDispatch: this.dispatchLog.at(-1) || null,
      capture: { ...this.capture.last },
      phases: { target: this.modules.includes('target') ? this.last?.status || 'aguardando' : 'off' } };
  }

  updateConfig(config) {
    if (!this.combat || (isDeepStrictEqual(this.config?.target, config.target)
        && isDeepStrictEqual(this.config?.hoenn, config.hoenn))) {
      this.config = structuredClone(config); return;
    }
    this.combat = createTargetEngine(config); this.lure = createLureEngine(config);
    this.config = structuredClone(config); this.queue = []; this.lastCombatSnapshot = null; this.targetView = null;
  }

  async setModules(module, enabled, pid, config) {
    if (typeof enabled !== 'boolean') throw Error('Estado do modulo invalido.');
    if (module === 'healer') throw Error('Healer ainda exige telemetria real de HP e roster.');
    if (!enabled && module === 'all') {
      await super.setModules('all', false);
      this.combat = null; this.queue = []; this.config = null; this.targetView = null;
      return this.state;
    }
    if (module === 'walker') {
      const targetActive = this.modules.includes('target');
      const wasPaused = this.paused;
      if (enabled) {
        if (targetActive && pid !== this.pid) throw Error('Pare os modulos antes de trocar o PID.');
        const transport = this.loadTransport();
        if (pid !== this.pid) this.capture.reset();
        const state = await super.setModules(module, enabled, pid, config);
        this.config = structuredClone(config);
        this.transport = transport;
        if (targetActive) { this.modules.push('target'); this.changed(); }
        return { ...state, ...this.state };
      }
      await this.pause();
      this.engine = null;
      this.modules = targetActive ? ['target'] : [];
      if (targetActive && !wasPaused) { this.paused = false; this.startTimer(); }
      this.changed(); return this.state;
    }
    if (module !== 'target') throw Error('Modulo indisponivel no backend RPM.');
    if (!enabled) {
      const wasPaused = this.paused;
      await this.pause();
      this.combat = null; this.queue = []; this.targetView = null;
      this.modules = this.modules.filter(value => value !== 'target');
      if (this.modules.length && !wasPaused) { this.paused = false; this.startTimer(); }
      this.changed(); return this.state;
    }
    if (this.modules.length && pid !== this.pid) throw Error('Pare os modulos antes de trocar o PID.');
    const session = this.sessions.find(value => value.pid === pid);
    const issue = positionIssue(session, pid, this.playerName, this.now());
    if (issue) throw Error(issue);
    if (!session.capabilities.targetKeyboard) throw Error(session.capabilities.targetKeyboardIssue || 'Target RPM indisponivel.');
    const transport = this.loadTransport();
    const combo = config?.target?.combo;
    if (combo?.enabled && combo.useNativeSequence && !transport.bindings['!autocombo']) throw Error('AutoCombo sem hotkey simples configurada no cliente.');
    if (combo?.enabled && !combo.useNativeSequence) {
      const moves = require('./engines/shared.cjs').parseSequence(combo.sequenceText);
      if (!moves.length || moves.some(move => !transport.bindings[move])) throw Error('Sequencia sem hotkeys correspondentes no cliente.');
    }
    await this.pause();
    const epoch = this.epoch;
    await this.input(pid, null, true);
    if (epoch !== this.epoch) throw Error('Inicio do Target cancelado.');
    const refreshed = this.sessions.find(value => value.pid === pid);
    const after = positionIssue(refreshed, pid, this.playerName, this.now())
      || (!refreshed.capabilities.targetKeyboard && (refreshed.capabilities.targetKeyboardIssue || 'Criaturas RPM indisponiveis.'));
    if (after) throw Error(after);
    if (pid !== this.pid) this.capture.reset();
    this.pid = pid; this.playerName ||= session.telemetry.playerName;
    this.transport = transport; this.config = structuredClone(config);
    this.combat = createTargetEngine(config); this.lure = createLureEngine(config);
    this.queue = []; this.lastCombatSnapshot = null;
    if (!this.modules.includes('target')) this.modules.push('target');
    this.paused = false; this.last = null; this.startTimer(); this.changed();
    return this.state;
  }

  async togglePause() {
    if (this.engine || !this.paused) return super.togglePause();
    if (!this.modules.includes('target') || !this.combat) throw Error('Inicie o Target antes de continuar.');
    const session = this.sessions.find(value => value.pid === this.pid);
    const issue = positionIssue(session, this.pid, this.playerName, this.now())
      || (!session.capabilities.targetKeyboard && (session.capabilities.targetKeyboardIssue || 'Criaturas RPM indisponiveis.'));
    if (issue) throw Error(issue);
    const epoch = this.epoch;
    await this.input(this.pid, null, true);
    if (epoch !== this.epoch) return this.state;
    const refreshed = this.sessions.find(value => value.pid === this.pid);
    const after = positionIssue(refreshed, this.pid, this.playerName, this.now())
      || (!refreshed.capabilities.targetKeyboard && (refreshed.capabilities.targetKeyboardIssue || 'Criaturas RPM indisponiveis.'));
    if (after) throw Error(after);
    this.paused = false; this.last = null; this.startTimer(); this.changed(); return this.state;
  }

  async tick() {
    if (this.paused || this.inFlight || (!this.engine && !this.combat)) return null;
    const epoch = this.epoch;
    this.inFlight = this.runTick(epoch);
    try { return await this.inFlight; } finally { this.inFlight = null; }
  }

  captureTelemetry(session) {
    if (!this.itemSource) throw Error('Capture: fonte RPM de itens indisponivel.');
    const telemetry = mergeItemSnapshot(session, this.itemSource(), this.now()).telemetry;
    const identity = JSON.stringify([telemetry.itemPid, telemetry.itemIdentityProfile.processStartedAt,
      telemetry.itemIdentityProfile.moduleBase]);
    if (this.captureSession !== identity) {
      this.capture.reset(); this.captureSession = identity;
    }
    return telemetry;
  }

  async tryCapture(session, epoch, inCombat) {
    if (this.config?.looting?.captureEnabled !== true) {
      this.capture.last = { status: 'off', effectVerified: false }; return null;
    }
    let telemetry;
    try { telemetry = this.captureTelemetry(session); }
    catch (error) {
      this.capture.last = { status: 'blocked', reason: error.message, effectVerified: false }; return null;
    }
    const candidate = this.capture.plan(telemetry, this.config, this.now(), { inCombat });
    if (!candidate || this.now() - this.lastDispatch < 250) return null;
    const latest = this.getSession();
    const issue = positionIssue(latest, this.pid, this.playerName, this.now());
    if (issue) throw Error(issue);
    if (this.config.looting.captureAfterCombat === true) {
      const perception = this.sessions.find(value => value.pid === this.pid);
      if (!perception?.capabilities.targetKeyboard
          || createTargetEngine(this.config).inspect(perception.telemetry).length > 0) {
        this.capture.last = { status: 'blocked', reason: 'capture-after-combat', effectVerified: false };
        return null;
      }
    }
    const current = this.captureTelemetry(latest);
    const plan = this.capture.revalidate(candidate, current, this.config);
    if (plan.state !== 'DISPATCH_PLANNED') {
      this.capture.last = { status: 'blocked', reason: plan.reason, effectVerified: false }; return null;
    }
    const request = captureRequest(this.loadTransport(), current, candidate, plan, this.config);
    if (epoch !== this.epoch || this.paused) return null;
    let result;
    try { result = await this.combatInput(this.pid, request); }
    catch (error) {
      this.capture.last = { status: 'error', reason: error.message, effectVerified: false,
        outcome: 'unknown', retrySafe: false, transportResult: error.result };
      throw error;
    }
    this.lastDispatch = this.now();
    this.capture.record(candidate, this.config, this.lastDispatch, true);
    const record = { ...result, generatedAt: new Date(this.lastDispatch).toISOString(), command: 'useWith',
      parameter: plan.parameter, inputAccepted: true, effectVerified: false };
    this.dispatchLog.push(record); this.dispatchLog = this.dispatchLog.slice(-100);
    this.onDispatch(record);
    if (epoch !== this.epoch) return null;
    this.last = { status: 'capture', action: 'useWith', inputAccepted: true, effectVerified: false };
    this.changed(); return this.last;
  }

  async runTick(epoch) {
    let attemptedSnapshot = null;
    try {
      if (!this.modules.includes('target') || !this.combat) {
        const session = this.getSession();
        const issue = positionIssue(session, this.pid, this.playerName, this.now());
        if (issue) throw Error(issue);
        let inCombat;
        if (this.config?.looting?.captureAfterCombat === true) {
          const perception = this.sessions.find(value => value.pid === this.pid);
          if (perception?.capabilities.targetKeyboard) {
            inCombat = createTargetEngine(this.config).inspect(perception.telemetry).length > 0;
          }
        } else inCombat = false;
        const capture = await this.tryCapture(session, epoch, inCombat);
        return capture || super.runTick(epoch);
      }
      const session = this.sessions.find(value => value.pid === this.pid);
      const issue = positionIssue(session, this.pid, this.playerName, this.now());
      if (issue) throw Error(issue);
      if (!session.capabilities.targetKeyboard) throw Error(session.capabilities.targetKeyboardIssue || 'Criaturas RPM indisponiveis.');
      const telemetry = session.telemetry;
      if (this.observedOwnId !== undefined && this.observedOwnId !== telemetry.ownPokemon.id) {
        this.queue = []; this.combat.clearTarget(); this.lastCombatSnapshot = null; this.targetView = null;
      }
      this.observedOwnId = telemetry.ownPokemon.id;
      if (this.retryCombatSnapshot === telemetry.creaturesGeneratedAt) return null;
      this.retryCombatSnapshot = null;
      const candidates = this.combat.inspect(telemetry);
      const capture = await this.tryCapture(session, epoch, candidates.length > 0);
      if (capture) return capture;
      if (this.queue.length && !candidates.some(creature => creature.id === this.queue[0].targetId)) {
        this.queue = []; this.combat.clearTarget(); this.targetView = null;
      }
      if (this.now() - this.lastDispatch < 250) return null;
      if (!this.queue.length) {
        const events = [];
        const fight = this.combat.step(telemetry, { command: (name, parameter) => events.push({ name, parameter }) }, this.now(), {
          keyboardTransport: true,
          luring: this.config?.target?.luring?.enabled === true,
        });
        if (fight.action === 'idle' || fight.action === 'luring') {
          this.queue = [];
          this.lastCombatSnapshot = null;
          this.targetView = null;
          const lure = this.lure.step(telemetry, { command: () => {} }, this.now());
          if (this.modules.includes('walker') && this.engine && lure.allowMovement) {
            const result = await super.runTick(epoch);
            if (result?.status === 'done') {
              this.modules = ['target']; this.paused = false; this.startTimer(); this.changed();
            }
            return result;
          }
          this.last = { status: fight.action === 'luring' ? 'luring' : 'idle', action: fight.action, inputAccepted: false };
          this.changed(); return this.last;
        }
        if (fight.targetId) {
          const chosen = candidates.find(creature => creature.id === fight.targetId);
          if (chosen) this.targetView = { id: chosen.id, name: chosen.name,
            distance: Math.max(Math.abs(chosen.pos.x - telemetry.position.x), Math.abs(chosen.pos.y - telemetry.position.y)),
            healthPercent: chosen.healthPercent };
        }
        const stamp = telemetry.creaturesGeneratedAt || session.generatedAt;
        if (stamp === this.lastCombatSnapshot) return null;
        this.lastCombatSnapshot = stamp;
        this.queue = events.map(event => ({ ...event, targetId: fight.targetId }));
        if (!this.queue.length) { this.last = { status: 'combat', action: 'hold', inputAccepted: false }; this.changed(); return this.last; }
      }
      if (epoch !== this.epoch || this.paused) return null;
      const event = this.queue[0];
      const creature = candidates.find(value => value.id === event.targetId);
      if (!creature) { this.queue = []; return null; }
      let request;
      if (event.name === 'attack') request = projectTarget(this.transport.viewport, telemetry.position, creature);
      else {
        const key = event.name === 'hotkey' ? event.parameter : this.transport.bindings[event.parameter];
        if (!key || !['hotkey', 'talk', 'combo'].includes(event.name)) throw Error('Comando sem mapeamento de teclado: ' + event.name + ' ' + event.parameter);
        const cooldown = this.transport.cooldownsMs?.[key.toLowerCase()];
        if (cooldown !== undefined && (!Number.isFinite(cooldown) || cooldown < 0)) throw Error('Cooldown configurado invalido.');
        if (this.now() - (this.keyUsedAt.get(key.toLowerCase()) ?? -Infinity) < (cooldown ?? 0)) return null;
        request = { kind: 'key', key };
      }
      const latest = this.sessions.find(value => value.pid === this.pid);
      if (!latest?.capabilities.targetKeyboard) throw Error(latest?.capabilities.targetKeyboardIssue || 'Identidade expirou antes do envio.');
      const current = latest.telemetry.creatures.find(value => value.id === creature.id);
      if (!current || latest.telemetry.ownPokemon.id !== telemetry.ownPokemon.id) {
        this.queue = []; this.combat.clearTarget(); this.lastCombatSnapshot = null; this.targetView = null; return null;
      }
      if (event.name === 'attack') request = projectTarget(this.transport.viewport, latest.telemetry.position, current);
      this.targetView = { id: current.id, name: current.name,
        distance: Math.max(Math.abs(current.pos.x - latest.telemetry.position.x), Math.abs(current.pos.y - latest.telemetry.position.y)),
        healthPercent: current.healthPercent };
      attemptedSnapshot = latest.telemetry.creaturesGeneratedAt;
      const result = await this.combatInput(this.pid, { ...request, playerName: this.playerName,
        targetGuard: { pid: this.pid, playerName: this.playerName, generatedAt: latest.telemetry.creaturesGeneratedAt,
          player: latest.telemetry.creaturePlayer, own: latest.telemetry.ownPokemon, target: current } });
      this.lastDispatch = this.now();
      this.combat.recordDispatch(event.name, event.parameter, this.lastDispatch);
      if (request.key) this.keyUsedAt.set(request.key.toLowerCase(), this.lastDispatch);
      this.queue.shift();
      const record = { ...result, generatedAt: new Date(this.lastDispatch).toISOString(), targetId: creature.id,
        targetName: creature.name, targetHp: creature.healthPercent, command: event.name, effectVerified: false };
      this.dispatchLog.push(record); this.dispatchLog = this.dispatchLog.slice(-100);
      this.onDispatch(record);
      if (epoch !== this.epoch) return null;
      this.last = { status: 'combat', action: event.name, inputAccepted: true, effectVerified: false };
      this.changed(); return this.last;
    } catch (error) {
      if (epoch !== this.epoch) return null;
      if (error.code === 'COMBAT_TARGET_MOVED' && attemptedSnapshot && this.queue.length) {
        if (this.queue[0].name !== 'attack') this.queue.unshift({ name: 'attack', parameter: this.queue[0].targetId, targetId: this.queue[0].targetId });
        this.retryCombatSnapshot = attemptedSnapshot;
        this.last = { status: 'retrying', action: 'reproject', reason: error.message, inputAccepted: false };
        this.changed(); return this.last;
      }
      this.paused = true; this.epoch++; clearInterval(this.timer); this.timer = null; this.queue = []; this.targetView = null;
      this.last = { status: error.code === 'WALKER_FOCUS_LOST' ? 'paused' : 'error', error: error.message,
        inputAccepted: false, transportResult: error.result, effectVerified: false, retrySafe: false };
      this.changed(); return this.last;
    }
  }

  async close() { await super.close(); this.combat = null; this.queue = []; this.targetView = null; }
}

module.exports = { RpmCombatRuntime };
