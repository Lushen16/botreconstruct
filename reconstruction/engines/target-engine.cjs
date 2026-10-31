'use strict';

const { ignoredNames, normalizeName, isIgnored, parseSequence, Cooldown } = require('./shared.cjs');
const TargetEngine = require('../../target-engine.cjs');

const ATTACK_RETRY_MS = 1000;
const SKILL_RETRY_MS = 1000;

function rosterUuid(telemetry, name) {
  const slot = Number(telemetry.activeSlot);
  const roster = Array.isArray(telemetry.roster) ? telemetry.roster : [];
  if (Number.isInteger(slot) && slot >= 1 && slot <= roster.length) {
    const entry = roster.find(item => item.slot === slot);
    if (entry && typeof entry.uuid === 'string' && entry.uuid) return entry.uuid;
  }
  if (name) {
    const wanted = normalizeName(name);
    const matches = roster.filter(item => normalizeName(item.name) === wanted);
    if (matches.length === 1 && typeof matches[0].uuid === 'string' && matches[0].uuid) return matches[0].uuid;
  }
  return undefined;
}

function isShiny(creature) {
  if (creature.shinyIcon === 1) return true;
  if (Number.isInteger(creature.lookType) && Number.isInteger(creature.shinyLookType) && creature.shinyLookType !== creature.normalLookType) {
    return creature.lookType === creature.shinyLookType;
  }
  return false;
}

function createTargetEngine(config, options = {}) {
  const target = config?.target || {};
  const hoenn = config?.hoenn || {};
  const combo = target.combo || {};
  const comboEnabled = combo.enabled === true;
  const ignored = new Set([...ignoredNames(target.ignoredCreaturesText), ...ignoredNames(hoenn.ignoredCreaturesText)]);
  const minWilds = Number.isInteger(hoenn.minWildsToEngage) ? hoenn.minWildsToEngage : 0;
  const perfectLure = hoenn.perfectLure === true && hoenn.forceBox !== true;
  const state = {
    targetId: null, attackAt: new Cooldown(), targetSince: 0,
    comboIndex: 0, comboAt: new Cooldown(), comboCompletedAt: null, comboPokemonName: null, lastSkillCommand: null, rotationKeys: new Set(),
    healAt: new Cooldown(), lureAt: new Cooldown(), blocked: new Set(),
  };
  let tickNow = 0;
  let engine = new TargetEngine({}, { now: () => tickNow });

  function engineConfig() {
    const gcd = target.globalCooldownMs;
    const rows = Array.isArray(target.monsters) ? target.monsters.filter(row => row && typeof row === 'object') : [];
    return {
      ...target,
      maxDistance: target.maxDistance ?? (rows.length ? Math.max(...rows.map(row => Number.isFinite(row.range) ? row.range : 8)) : 8),
      priorityMode: target.priorityMode ?? (rows.length ? 'highestPriorityList' : 'nearest'),
      monsters: Array.isArray(target.monsters) && target.monsters.length === 0 ? ['*'] : target.monsters,
      globalCooldownMs: gcd === undefined ? 250
        : Number.isFinite(gcd) && gcd >= 0 ? Math.max(250, gcd) : gcd,
      skills: Array.isArray(target.skills) ? target.skills.filter(skill => skill
        && typeof skill.key === 'string' && /^f(?:[1-9]|1[0-2])$/iu.test(skill.key.trim())) : [],
    };
  }

  function candidates(telemetry, player, settings) {
    const pool = (Array.isArray(telemetry.creatures) ? telemetry.creatures : [])
      .filter(creature => creature && creature.canAttack === true
        && Number.isInteger(creature.id) && creature.id > 0 && creature.id <= 0xffffffff)
      .filter(creature => !isIgnored(creature.name, ignored));
    return engine.filterCandidates(player, pool, settings);
  }

  function choose(player, pool, settings) {
    const shiny = target.shinyPriorityEnabled === true ? pool.filter(isShiny) : [];
    return engine.selectTarget(player, shiny.length ? shiny : pool, settings);
  }

  function restartCombo() {
    state.comboIndex = 0;
    state.comboCompletedAt = null;
    state.comboPokemonName = null;
    state.lastSkillCommand = null;
    state.rotationKeys.clear();
    state.comboAt.reset();
  }

  function clearTarget() {
    engine.clearTarget();
    state.targetId = null;
    restartCombo();
  }

  function sequence(telemetry) {
    if (combo.useNativeSequence === true) {
      return (Array.isArray(telemetry.nativeSequence) ? telemetry.nativeSequence : [])
        .filter(value => typeof value === 'string' && /^m[1-9]\d*$/u.test(value));
    }
    return parseSequence(combo.sequenceText);
  }

  function step(telemetry, sink, now, context = {}) {
    tickNow = now;
    if (!Number.isFinite(now)) {
      clearTarget();
      return { action: 'idle', emitted: [], reason: 'invalid-clock' };
    }
    const player = { ...telemetry.position, name: telemetry.playerName };
    const settings = engineConfig();
    const perception = perfectLure && target.maxDistance === undefined
      ? { ...settings, maxDistance: Number.MAX_SAFE_INTEGER } : settings;
    const pool = candidates(telemetry, player, perception);
    if (!pool.length) {
      clearTarget();
      return { action: 'idle', emitted: [], reason: 'no-creature' };
    }
    if (perfectLure && pool.length < minWilds) {
      clearTarget();
      return { action: 'luring', emitted: [], detected: pool.length, needed: minWilds };
    }
    const creature = choose(player, pool, settings);
    if (!creature) {
      clearTarget();
      return { action: 'idle', emitted: [], reason: 'no-creature' };
    }
    const position = telemetry.position;
    const health = telemetry.healthPercent;
    const activeUuid = rosterUuid(telemetry, telemetry.pokemonName);
    const emitted = [];
    const send = (name, parameter, extra) => { sink.command(name, parameter, extra); emitted.push([name, parameter]); };

    if (state.targetId !== creature.id) {
      state.targetId = creature.id;
      restartCombo();
      state.targetSince = now;
      state.attackAt.reset();
    }
    if (state.attackAt.ready(now, ATTACK_RETRY_MS)) {
      send('attack', creature.id);
      state.attackAt.use(now);
    }

    if (Array.isArray(target.skills)) {
      const action = context.hotkeysBlocked ? null : engine.getCombatAction(player, settings);
      if (action) {
        send('hotkey', action.key);
        state.rotationKeys.add(action.key.toLowerCase());
        if (settings.skills.length && settings.skills.every(skill => state.rotationKeys.has(skill.key.trim().toLowerCase()))) {
          state.comboCompletedAt = now;
          state.comboPokemonName = telemetry.pokemonName;
          state.lastSkillCommand = { name: 'hotkey', parameter: action.key };
        }
      }
      return { action: action ? 'skill' : emitted.length ? 'attack' : 'hold',
        emitted, targetId: creature.id };
    }

    if (target.healSkill?.enabled === true && Number.isFinite(health) && health <= Number(target.healSkill.hpPercent)
        && /^m[1-9]\d*$/u.test(String(target.healSkill.move)) && state.healAt.ready(now, SKILL_RETRY_MS)) {
      send('talk', target.healSkill.move, activeUuid ? { expectedUuid: activeUuid } : undefined);
      state.healAt.use(now);
    }

    if (context.luring === true && target.lureSkill?.enabled === true && Number.isFinite(health)
        && health >= Number(target.lureSkill.hpPercent) && /^m[1-9]\d*$/u.test(String(target.lureSkill.move))
        && state.lureAt.ready(now, SKILL_RETRY_MS)) {
      send('talk', target.lureSkill.move, activeUuid ? { expectedUuid: activeUuid } : undefined);
      state.lureAt.use(now);
    }

    if (!comboEnabled) return { action: emitted.length ? 'attack' : 'hold', emitted, targetId: creature.id };

    const lowHpGate = Number(combo.lowHpComboPercent);
    if (Number.isInteger(lowHpGate) && lowHpGate > 0 && !(Number.isFinite(health) && health <= lowHpGate)) {
      return { action: 'attack', emitted, targetId: creature.id, reason: 'low-hp-gate' };
    }

    if (combo.useNativeSequence === true) {
      const nativeHotkey = (typeof combo.nativeHotkey === 'string' && combo.nativeHotkey.trim())
        || (typeof combo.hotkey === 'string' && combo.hotkey.trim());
      if (nativeHotkey) {
        if (context.hotkeysBlocked) return { action: 'combat', emitted, targetId: creature.id, native: true };
        const delay = state.comboIndex === 0 ? 0 : Math.max(0, Number(combo.stepDelay) || 1000);
        if (state.comboAt.ready(now, delay)) {
          send('hotkey', nativeHotkey);
          state.comboIndex += 1;
          state.comboAt.use(now);
          return { action: 'combo', emitted, targetId: creature.id, step: state.comboIndex, native: true };
        }
        return { action: 'combat', emitted, targetId: creature.id, native: true };
      }
    }

    const steps = sequence(telemetry);
    if (!steps.length) {
      if (combo.useNativeSequence === true && !context.hotkeysBlocked) {
        const delay = state.comboIndex === 0 ? 0 : Math.max(0, Number(combo.stepDelay) || 1000);
        if (state.comboAt.ready(now, delay)) {
          send('combo', '!autocombo', activeUuid ? { expectedUuid: activeUuid } : undefined);
          state.comboIndex += 1;
          state.comboAt.use(now);
          return { action: 'combo', emitted, targetId: creature.id, step: state.comboIndex, native: true };
        }
        return { action: 'combat', emitted, targetId: creature.id, native: true };
      }
      return { action: 'attack', emitted, targetId: creature.id, reason: 'empty-combo' };
    }
    if (state.comboIndex >= steps.length) return { action: 'combat', emitted, targetId: creature.id, reason: 'combo-done' };
    const delay = state.comboIndex === 0 ? 0 : Math.max(0, Number(combo.stepDelay) || 0);
    if (!state.comboAt.ready(now, delay)) return { action: 'combat', emitted, targetId: creature.id };
    const move = steps[state.comboIndex];
    const guard = activeUuid ? { expectedUuid: activeUuid, attackTargetId: creature.id } : undefined;
    if (!guard && context.keyboardTransport !== true) {
      state.blocked.add('combo-without-uuid');
      return { action: 'combat', emitted, targetId: creature.id, reason: 'missing-uuid', blocked: [...state.blocked] };
    }
    send('talk', move, guard);
    state.comboIndex += 1;
    state.comboAt.use(now);
    if (state.comboIndex === steps.length) {
      state.comboCompletedAt = now;
      state.comboPokemonName = telemetry.pokemonName;
      state.lastSkillCommand = { name: 'talk', parameter: move };
    }
    return { action: 'combo', emitted, targetId: creature.id, step: state.comboIndex, total: steps.length };
  }

  return {
    step,
    recordDispatch(name, parameter, timestamp) {
      if (name === 'hotkey') engine.recordDispatch(parameter, timestamp);
      if (name === 'attack') state.attackAt.use(timestamp);
      if (state.comboCompletedAt !== null && state.lastSkillCommand?.name === name
          && state.lastSkillCommand.parameter === parameter) state.comboCompletedAt = timestamp;
    },
    inspect(telemetry) {
      const player = { ...telemetry.position, name: telemetry.playerName };
      return candidates(telemetry, player, engineConfig());
    },
    clearTarget,
    restartCombo,
    reset() {
      engine = new TargetEngine({}, { now: () => tickNow });
      restartCombo();
      Object.assign(state, { targetId: null, comboIndex: 0, comboAt: new Cooldown(),
        healAt: new Cooldown(), lureAt: new Cooldown(), attackAt: new Cooldown(), blocked: new Set() });
    },
    get state() { return { targetId: state.targetId, comboIndex: state.comboIndex, comboCompletedAt: state.comboCompletedAt, comboPokemonName: state.comboPokemonName, blocked: [...state.blocked] }; },
  };
}

module.exports = { createTargetEngine, ATTACK_RETRY_MS, SKILL_RETRY_MS, isShiny };
