'use strict';

const { normalizeName, activePokemon, Cooldown, textFits } = require('./shared.cjs');

const MEDICINE_RETRY_MS = 1500;
const HEAL_RETRY_MS = 1000;
const POTION_RETRY_MS = 1500;

function rosterMatches(telemetry, name) {
  const wanted = normalizeName(name);
  if (!wanted) return null;
  const matches = (Array.isArray(telemetry.roster) ? telemetry.roster : [])
    .filter(entry => normalizeName(entry.name) === wanted);
  return matches.length === 1 ? matches[0] : null;
}

function createHealerEngine(config, options = {}) {
  const healer = config?.healer || {};
  const hoenn = config?.hoenn || {};
  const state = { potionAt: new Cooldown(), medicineAt: new Cooldown(), healAt: new Cooldown(),
    resetAt: new Cooldown(), switchAt: new Cooldown(), blocked: new Set(), healPokemon: null, switchingTo: null };

  function hotkeyChannel(prefix, hotkey, actionBar) {
    if (typeof hotkey === 'string' && hotkey.trim()) {
      const text = hotkey.trim();
      if (Buffer.byteLength(text, 'utf8') <= 255) return { name: 'hotkey', parameter: text };
      state.blocked.add(prefix + '-hotkey-too-long');
      return null;
    }
    if (Number.isInteger(actionBar) && actionBar >= 1 && actionBar <= 50) return { name: 'action', parameter: actionBar };
    state.blocked.add(prefix + '-channel-missing');
    return null;
  }

  function step(telemetry, sink, now) {
    const emitted = [];
    const send = (name, parameter, extra) => { sink.command(name, parameter, extra); emitted.push([name, parameter]); };
    const done = action => ({ action, emitted, waiting: Boolean(state.switchingTo) || telemetry.isSwitching === true || telemetry.switchPending === true, blocked: [...state.blocked] });
    const health = telemetry.healthPercent;
    const hasHealth = Number.isFinite(health) && health >= 0 && health <= 100;

    if (hasHealth && Number(hoenn.potionHpPercent) > 0 && health <= Number(hoenn.potionHpPercent)
        && state.potionAt.ready(now, Math.max(0, Number(hoenn.potionCooldownMs) || POTION_RETRY_MS))) {
      const channel = hotkeyChannel('potion', hoenn.potionHotkey, hoenn.potionActionBar);
      if (channel) { send(channel.name, channel.parameter); state.potionAt.use(now); return done('heal'); }
    }

    const conditions = Array.isArray(telemetry.conditions) ? telemetry.conditions : [];
    const hasConditions = conditions.length > 0;
    if (hasConditions && hoenn.useMedicine === true && state.medicineAt.ready(now, MEDICINE_RETRY_MS)) {
      const channel = hotkeyChannel('medicine', hoenn.medicineHotkey, hoenn.medicineActionBar);
      if (channel) { send(channel.name, channel.parameter); state.medicineAt.use(now); return done('heal'); }
    }

    if (hasConditions) {
      state.blocked.add('combat-pokemon-debuffed');
      return done('idle');
    }

    const isSwitching = telemetry.isSwitching === true || telemetry.switchPending === true;
    if (state.switchingTo) {
      if (activePokemon(telemetry, state.switchingTo)) state.switchingTo = null;
      else return done('heal');
    }
    if (isSwitching) {
      return done('heal');
    }

    if (Number(healer.healHpPercent) > 0 && hasHealth && health <= Number(healer.healHpPercent)) {
      const pokemon = rosterMatches(telemetry, healer.healPokemonName);
      if (!pokemon) state.blocked.add('heal-pokemon-unresolved');
      else if (options.switchBeforeHeal && normalizeName(pokemon.name) !== normalizeName(telemetry.pokemonName)) {
        if (state.switchAt.ready(now, HEAL_RETRY_MS)) {
          state.switchingTo = pokemon.name;
          send('switchPokemon', textFits(pokemon.name, 255, 'Nome do Pokemon'));
          state.switchAt.use(now);
        }
        return done('heal');
      }
      else if (Number.isInteger(healer.healMoveSlot) && healer.healMoveSlot >= 1 && state.healAt.ready(now, HEAL_RETRY_MS)) {
        state.healPokemon = pokemon;
        send('talk', 'm' + healer.healMoveSlot, pokemon.uuid ? { expectedUuid: pokemon.uuid } : undefined);
        state.healAt.use(now);
        return done('heal');
      }
    }

    if (state.healPokemon && (!options.switchBeforeHeal || hasHealth && health > Number(healer.healHpPercent))
        && Number.isInteger(healer.healResetSlot)
        && healer.healResetSlot !== healer.healMoveSlot && state.resetAt.ready(now, HEAL_RETRY_MS)) {
      send('talk', 'm' + healer.healResetSlot, state.healPokemon.uuid ? { expectedUuid: state.healPokemon.uuid } : undefined);
      state.resetAt.use(now);
      state.healPokemon = null;
      return done('heal');
    }

    if (state.healPokemon && hasHealth && health > Number(healer.healHpPercent)) {
      state.healPokemon = null;
    }

    if (state.healPokemon === null && typeof healer.returnPokemonName === 'string' && healer.returnPokemonName.trim()
        && state.switchAt.ready(now, HEAL_RETRY_MS)) {
      const back = rosterMatches(telemetry, healer.returnPokemonName);
      if (back && normalizeName(back.name) !== normalizeName(telemetry.pokemonName)) {
        state.switchingTo = back.name;
        send('switchPokemon', textFits(back.name, 255, 'Nome do Pokemon'));
        state.switchAt.use(now);
        return done('heal');
      }
    }

    return done('idle');
  }

  return {
    step,
    reset() { Object.assign(state, { potionAt: new Cooldown(), medicineAt: new Cooldown(), healAt: new Cooldown(),
      resetAt: new Cooldown(), switchAt: new Cooldown(), healPokemon: null, switchingTo: null }); },
    get state() { return { blocked: [...state.blocked], healing: state.healPokemon !== null || state.switchingTo !== null }; },
  };
}

module.exports = { createHealerEngine, rosterMatches, MEDICINE_RETRY_MS, HEAL_RETRY_MS, POTION_RETRY_MS };
