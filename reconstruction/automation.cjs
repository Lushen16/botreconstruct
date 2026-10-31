'use strict';

const { ready, runtimeMismatch, isPosition, distance, normalizeName, ignoredNames, isIgnored, activePokemon } = require('./engines/shared.cjs');
const { createWalkerEngine } = require('./engines/walker-engine.cjs');
const { createTargetEngine } = require('./engines/target-engine.cjs');
const { createHealerEngine } = require('./engines/healer-engine.cjs');
const { createLureEngine } = require('./engines/lure-engine.cjs');
const { encodeCommand } = require('./protocol.cjs');
const { mergeCreatureSnapshot } = require('../tools/creature_bridge.cjs');

function gateReason(snapshot) {
  const session = snapshot || {};
  if (session.paused || session.runtime?.paused) return 'paused';
  if (!session.online) return 'offline';
  if (session.stale) return 'stale';
  if (session.error) return 'error';
  if (session.authExpired) return 'auth-expired';
  if (Number(session.ageMs) > 1000) return 'stale-snapshot';
  const telemetry = session.telemetry;
  if (!telemetry) return 'no-telemetry';
  if (telemetry.nativeVerified !== true) return 'native-unverified';
  if (telemetry.pulseVersion !== 3) return 'pulse-version';
  if (!telemetry.position) return 'no-position';
  if (runtimeMismatch(session)) return 'runtime-pid';
  return null;
}

function createRecorder() {
  const events = [];
  return {
    events,
    command(name, parameter, extra) {
      events.push({ name, parameter, ...(extra === undefined ? {} : { extra }) });
    },
  };
}

function createProtocolSink(send, firstCommandId = 1) {
  if (typeof send !== 'function') throw Error('Envie uma funcao send(bytes) para o transporte.');
  let commandId = Number.isInteger(firstCommandId) && firstCommandId > 0 ? firstCommandId : 1;
  return {
    command(name, parameter, extra) {
      const bytes = encodeCommand(commandId, name, parameter, extra);
      commandId = (commandId + 1) >>> 0;
      if (commandId === 0) commandId = 1;
      send(bytes);
      return bytes;
    },
    get nextCommandId() { return commandId; },
  };
}

function createAutomation(config, options = {}) {
  const enabled = typeof options.isEnabled === 'function' ? options.isEnabled : () => true;
  const hunt = options.hunt;
  const healBelow = hunt?.healBelow ?? 80;
  const resumeAbove = hunt?.resumeAbove ?? healBelow;
  if (hunt && (!Number.isFinite(healBelow) || !Number.isFinite(resumeAbove)
      || healBelow < 0 || resumeAbove < healBelow || resumeAbove >= 100)) {
    throw Error('Hunt exige 0 <= healBelow <= resumeAbove < 100.');
  }
  if (hunt && (!Number.isFinite(config?.target?.maxDistance) || config.target.maxDistance < 0)) {
    throw Error('Hunt exige target.maxDistance finito e nao negativo.');
  }
  const engineSettings = hunt ? { ...config,
    target: { ...config.target, healSkill: { enabled: false }, lureSkill: { enabled: false } },
    hoenn: { ...config.hoenn, perfectLure: false },
  } : config;
  const clock = typeof options.now === 'function' ? options.now : () => Date.now();
  const walker = createWalkerEngine(config);
  const target = createTargetEngine(engineSettings);
  const healer = createHealerEngine(hunt ? { ...config,
    hoenn: { ...config.hoenn, potionHpPercent: Number(config.hoenn?.potionHpPercent) > 0 ? resumeAbove : 0 },
    healer: { ...config.healer, healHpPercent: Number(config.healer?.healHpPercent) > 0 ? resumeAbove : 0 },
  } : config, { switchBeforeHeal: Boolean(hunt) });
  const lure = createLureEngine(config, options);
  const state = { ticks: 0, last: null, lastHotkeyAt: null, recovering: false, revive: null };

  function blocked(reason, error) {
    target.clearTarget();
    state.last = { status: 'blocked', reason, emitted: [], ...(hunt ? { pauseWalker: true } : {}),
      ...(error ? { error } : {}) };
    return state.last;
  }

  function reviveStep(telemetry, output, now) {
    const revive = config.target?.autoRevive;
    if (!enabled('target') || revive?.enabled !== true || typeof revive.hotkey !== 'string' || !revive.hotkey.trim()) {
      state.revive = null;
      return null;
    }
    const rotation = target.state;
    if (!state.revive && rotation.comboCompletedAt !== null) {
      state.revive = { pokemonName: rotation.comboPokemonName, lastSkillAt: rotation.comboCompletedAt, sentAt: null };
    }
    if (!state.revive) return null;
    const pending = state.revive;
    if (pending.sentAt === null && rotation.comboCompletedAt !== null) pending.lastSkillAt = rotation.comboCompletedAt;
    const emitted = [];
    let reason = 'await-revive-interval';
    if (pending.sentAt === null) {
      const interval = Number.isFinite(revive.interval) && revive.interval >= 0 ? revive.interval : 1500;
      const hotkeysBlocked = (state.lastHotkeyAt !== null && now - state.lastHotkeyAt < 250)
        || options.hotkeysBlocked?.() === true;
      if (now - pending.lastSkillAt >= interval && !hotkeysBlocked) {
        output.command('hotkey', revive.hotkey.trim());
        emitted.push(['hotkey', revive.hotkey.trim()]);
        pending.sentAt = now;
        reason = 'revive-sent';
      }
    } else if (revive.waitForPokemon !== true || activePokemon(telemetry, pending.pokemonName)) {
      state.revive = null;
      target.restartCombo();
      return null;
    } else reason = 'await-active-pokemon';
    return { status: 'revive', pauseWalker: true, emitted, reason };
  }

  function huntStep(telemetry, output, now, hotkeysBlocked, beforeActions) {
    const health = telemetry.healthPercent;
    if (!Number.isFinite(health) || health <= 0 || health > 100) return blocked('invalid-health');
    if (!isPosition(telemetry.position) || !Array.isArray(telemetry.creatures)) return blocked('invalid-perception');
    const ignored = new Set([...ignoredNames(config.target?.ignoredCreaturesText),
      ...ignoredNames(config.hoenn?.ignoredCreaturesText)]);
    for (const creature of telemetry.creatures) {
      if (!creature || !isPosition(creature.pos)) return blocked('invalid-creature');
      if (creature.is_player === true || normalizeName(creature.name) === normalizeName(telemetry.playerName)
          || isIgnored(creature.name, ignored) || creature.canAttack === false
          || creature.healthPercent === 0 || distance(telemetry.position, creature.pos) > config.target.maxDistance) continue;
      if (typeof creature.canAttack !== 'boolean' || !Number.isFinite(creature.healthPercent)
          || creature.healthPercent < 0 || creature.healthPercent > 100
          || !Number.isInteger(creature.id) || creature.id <= 0 || creature.id > 0xffffffff
          || typeof creature.name !== 'string' || !creature.name.trim()) return blocked('unknown-creature-fields');
    }
    const pendingRevive = reviveStep(telemetry, output, now);
    if (pendingRevive) return pendingRevive;
    const detected = target.inspect(telemetry).length;
    if (detected) {
      const capture = beforeActions?.(telemetry, true);
      if (capture) return capture;
      const fight = target.step(telemetry, output, now, { hotkeysBlocked });
      const revive = reviveStep(telemetry, output, now);
      if (revive) return { ...revive, detected, fight, emitted: [...fight.emitted, ...revive.emitted] };
      return { status: 'combat', pauseWalker: true, detected, fight, emitted: fight.emitted, reason: fight.reason || null };
    }
    target.clearTarget();

    if (health <= healBelow) state.recovering = true;
    if (state.recovering && health > resumeAbove) state.recovering = false;
    const returnPending = typeof config.healer?.returnPokemonName === 'string'
      && config.healer.returnPokemonName.trim()
      && normalizeName(config.healer.returnPokemonName) !== normalizeName(telemetry.pokemonName);
    const heal = hotkeysBlocked || !(state.recovering || healer.state.healing || returnPending)
      ? { emitted: [], blocked: [] } : healer.step(telemetry, output, now);
    if (state.recovering || heal.emitted.length || heal.waiting || healer.state.healing || returnPending) {
      return { status: 'heal', pauseWalker: true, detected, emitted: heal.emitted,
        blocked: heal.blocked, reason: state.recovering ? 'await-health-recovery' : 'healer-cleanup' };
    }
    const capture = beforeActions?.(telemetry, false);
    if (capture) return capture;
    const walk = walker.step(telemetry, output, now);
    return { status: 'walking', pauseWalker: false, detected, walk, emitted: walk.emitted, reason: walk.reason || null };
  }

  function tick(snapshot, sink = createRecorder(), beforeActions) {
    const reason = gateReason(snapshot);
    if (reason) {
      return blocked(reason);
    }
    const now = clock(snapshot);
    if (!Number.isFinite(now)) {
      return blocked('invalid-clock');
    }
    try {
      const scan = typeof options.creatureSource === 'function'
        ? options.creatureSource(snapshot) : snapshot.creatureSnapshot;
      if (scan !== undefined || typeof options.creatureSource === 'function') {
        snapshot = mergeCreatureSnapshot(snapshot, scan, now, options.creatureMaxAgeMs ?? 1000);
      }
    } catch (error) {
      return blocked('creature-snapshot', error.message);
    }
    const telemetry = snapshot.telemetry;
    const hotkeysBlocked = (state.lastHotkeyAt !== null && now - state.lastHotkeyAt < 250)
      || options.hotkeysBlocked?.() === true;
    const output = { command(name, parameter, extra) {
      const result = sink.command(name, parameter, extra);
      if (name === 'hotkey') state.lastHotkeyAt = now;
      return result;
    } };
    state.ticks += 1;
    if (hunt) {
      state.last = huntStep(telemetry, output, now, hotkeysBlocked, beforeActions);
      return state.last;
    }
    const pendingRevive = reviveStep(telemetry, output, now);
    if (pendingRevive) {
      state.last = pendingRevive;
      return state.last;
    }
    const heal = hotkeysBlocked || !enabled('healer') ? { emitted: [], blocked: [] } : healer.step(telemetry, output, now);
    if (heal.emitted.length || heal.waiting || (enabled('healer') && healer.state.healing)) {
      state.last = { status: 'heal', reason: null, emitted: heal.emitted, blocked: heal.blocked };
      return state.last;
    }
    const capture = beforeActions?.(telemetry, target.inspect(telemetry).length > 0);
    if (capture) { state.last = capture; return capture; }
    if (!enabled('target')) target.clearTarget();
    const fight = !enabled('target') ? { action: 'idle', emitted: [] } : target.step(telemetry, output, now, {
      luring: config?.target?.luring?.enabled === true, hotkeysBlocked,
    });
    const revive = reviveStep(telemetry, output, now);
    if (revive) {
      state.last = { ...revive, fight, emitted: [...fight.emitted, ...revive.emitted] };
      return state.last;
    }
    let walk = { action: 'skipped', emitted: [] };
    let lureResult = { allowMovement: true, state: 'off', emitted: [] };
    if (fight.action === 'idle' || fight.action === 'luring') {
      if (enabled('target')) lureResult = lure.step(telemetry, output, now);
      if (!enabled('walker')) walk = { action: 'disabled', emitted: [] };
      else if (lureResult.allowMovement) walk = walker.step(telemetry, output, now);
      else walk = { action: 'held', emitted: [], reason: 'lure-hold' };
    }
    state.last = {
      status: fight.action === 'idle' && !enabled('walker') ? 'idle'
        : fight.action === 'luring' ? (lureResult.allowMovement ? 'luring' : 'lure-hold') : fight.action === 'idle' ? (lureResult.allowMovement ? 'walking' : 'lure-hold') : 'combat',
      fight, walk, lure: { state: lureResult.state, allowMovement: lureResult.allowMovement, range: lureResult.range ?? null },
      emitted: [...heal.emitted, ...fight.emitted, ...(lureResult.emitted || []), ...(walk.emitted || [])],
      blocked: [...new Set([...(heal.blocked || []), ...(fight.blocked || [])])],
      reason: fight.action === 'idle' || fight.action === 'luring' ? walk.reason || fight.reason || null : fight.reason || null,
    };
    return state.last;
  }

  return {
    tick,
    recordDispatch(name, parameter, timestamp) {
      if (name === 'hotkey') {
        state.lastHotkeyAt = timestamp;
        if (state.revive && state.revive.sentAt !== null && parameter === config.target?.autoRevive?.hotkey?.trim()) {
          state.revive.sentAt = timestamp;
        }
      }
      target.recordDispatch(name, parameter, timestamp);
    },
    reset() {
      walker.reset(); target.reset(); healer.reset(); lure.reset();
      state.ticks = 0; state.last = null; state.lastHotkeyAt = null; state.recovering = false; state.revive = null;
    },
    get state() { return { ticks: state.ticks, walker: walker.state, target: target.state, healer: healer.state, lure: lure.state }; },
    get last() { return state.last; },
  };
}

module.exports = { createAutomation, createRecorder, createProtocolSink, gateReason };
