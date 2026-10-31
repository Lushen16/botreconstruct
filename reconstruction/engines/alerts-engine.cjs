'use strict';

const SUPPORTED_TYPES = Object.freeze(['hp', 'creature', 'hunt_pokemon', 'teleport', 'disconnected', 'chat']);
const BLOCKED_TYPES = Object.freeze(['player', 'gm_arrow', 'gm_message', 'camera_viewers', 'pokemon_capture']);
const TELEPORT_TILES = 3;
const TALK_EVENT_KIND = 'talk';
const MAX_SAFE_ID = 9007199254740991;
const within = (value, minimum, maximum) => Number.isInteger(value) && value >= minimum && value <= maximum;

const normalizeName = value => String(value ?? '').trim().toLowerCase();
const isPosition = value => Boolean(value) && [value.x, value.y, value.z].every(Number.isInteger);
const sameTile = (a, b) => isPosition(a) && isPosition(b) && a.x === b.x && a.y === b.y && a.z === b.z;
const hasHealth = value => Number.isFinite(Number(value));

function wildcardMatch(pattern, name) {
  const text = String(pattern ?? '').trim();
  if (!text) return false;
  if (text === '*') return true;
  return normalizeName(text) === normalizeName(name);
}

function normalizeRules(config) {
  const rules = Array.isArray(config?.alerts?.rules) ? config.alerts.rules : [];
  return rules.filter(rule => rule && rule.enabled === true).map((rule, index) => ({
    index,
    id: String(rule.name || rule.id || 'rule-' + (index + 1)),
    type: SUPPORTED_TYPES.includes(rule.type) ? rule.type : BLOCKED_TYPES.includes(rule.type) ? rule.type : 'unknown',
    hpThreshold: Number.isFinite(rule.hpThreshold) ? rule.hpThreshold : 0,
    hpOnce: rule.hpOnce === true,
    creatureName: String(rule.creatureName ?? ''),
    creatureRange: Number.isInteger(rule.creatureRange) ? Math.min(30, Math.max(1, rule.creatureRange)) : 1,
    huntPokemonNames: String(rule.huntPokemonNames ?? '').split(/[,;\n]/u).map(value => value.trim()).filter(Boolean),
    teleportIntervalMs: Math.max(50, Number.isInteger(rule.teleportIntervalMs) ? rule.teleportIntervalMs : 1000),
    repeat: rule.soundRepeatEnabled === true,
    repeatSeconds: Math.max(1, Number.isInteger(rule.soundRepeatSeconds) ? rule.soundRepeatSeconds : 30),
    pause: {
      walker: rule.pauseWk === true,
      target: rule.pauseTarget === true,
      looting: rule.pauseLooting === true,
    },
  }));
}

function createAlertsEngine(config) {
  const rules = normalizeRules(config);
  const state = new Map(rules.map(rule => [rule.index, {
    rule, phase: rule.type === 'disconnected' ? 'armed' : 'armed',
    lastNotifyAt: Number.NEGATIVE_INFINITY, lastCheckAt: Number.NEGATIVE_INFINITY,
    lastPosition: null, wasOnline: null, seen: new Set(), condition: false,
  }]));

  function notify(entry, now, actions) {
    entry.lastNotifyAt = now;
    actions.push({ action: 'notify', ruleId: entry.rule.id, type: entry.rule.type });
    for (const [target, enabled] of Object.entries(entry.rule.pause)) {
      if (enabled) actions.push({ action: 'pause', target, ruleId: entry.rule.id });
    }
  }

  function trigger(entry, now, actions, condition) {
    entry.condition = condition;
    if (!condition) {
      entry.phase = 'armed';
      return;
    }
    const first = entry.phase !== 'suppressed';
    if (first) {
      notify(entry, now, actions);
      entry.phase = 'suppressed';
      return;
    }
    if (entry.rule.repeat && now - entry.lastNotifyAt >= entry.rule.repeatSeconds * 1000) {
      notify(entry, now, actions);
    }
  }

  function creaturesInRange(rule, telemetry) {
    if (!isPosition(telemetry?.position)) return [];
    const position = telemetry.position;
    return (Array.isArray(telemetry.creatures) ? telemetry.creatures : []).filter(creature => {
      if (!creature || !isPosition(creature.pos)) return false;
      if (hasHealth(creature.healthPercent) && Number(creature.healthPercent) <= 0) return false;
      if (creature.pos.z !== position.z) return false;
      const range = Math.max(Math.abs(creature.pos.x - position.x), Math.abs(creature.pos.y - position.y));
      return range <= rule.creatureRange;
    });
  }

  function step(session, telemetry, now) {
    const actions = [];
    for (const entry of state.values()) {
      const rule = entry.rule;
      if (rule.type === 'unknown' || BLOCKED_TYPES.includes(rule.type)) {
        entry.phase = 'unsupported';
        continue;
      }
      if (rule.type === 'disconnected') {
        const online = Boolean(session?.online) && session?.stale !== true && !session?.error && !session?.authExpired;
        if (entry.wasOnline === null) entry.wasOnline = online;
        const dropped = entry.wasOnline === true && online === false;
        entry.wasOnline = online;
        if (dropped) notify(entry, now, actions);
        entry.condition = !online;
        entry.phase = online ? 'armed' : 'suppressed';
        continue;
      }
      if (rule.type === 'hp') {
        const health = Number(telemetry?.healthPercent);
        if (!Number.isFinite(health)) continue;
        const below = health <= rule.hpThreshold;
        if (!below) { entry.phase = 'armed'; entry.condition = false; continue; }
        const already = entry.phase === 'suppressed';
        if (!already) { notify(entry, now, actions); entry.phase = 'suppressed'; entry.condition = true; continue; }
        entry.condition = true;
        if (!rule.hpOnce && rule.repeat && now - entry.lastNotifyAt >= rule.repeatSeconds * 1000) notify(entry, now, actions);
        if (!rule.hpOnce && !rule.repeat) { entry.phase = 'armed'; }
        continue;
      }
      if (rule.type === 'creature') {
        const matches = creaturesInRange(rule, telemetry).filter(creature => wildcardMatch(rule.creatureName, creature.name));
        const ids = new Set(matches.map(creature => creature.id));
        let fresh = 0;
        for (const id of ids) if (!entry.seen.has(id)) { entry.seen.add(id); fresh += 1; }
        for (const id of [...entry.seen]) if (!ids.has(id)) entry.seen.delete(id);
        if (fresh) notify(entry, now, actions);
        else if (rule.repeat && ids.size && now - entry.lastNotifyAt >= rule.repeatSeconds * 1000) notify(entry, now, actions);
        entry.condition = ids.size > 0;
        entry.phase = entry.condition ? 'suppressed' : 'armed';
        continue;
      }
      if (rule.type === 'hunt_pokemon') {
        const expected = new Set(rule.huntPokemonNames.map(normalizeName));
        const matches = (Array.isArray(telemetry?.creatures) ? telemetry.creatures : []).filter(creature => {
          if (!creature || !isPosition(creature.pos)) return false;
          if (hasHealth(creature.healthPercent) && Number(creature.healthPercent) <= 0) return false;
          return !expected.has(normalizeName(creature.name));
        });
        const ids = new Set(matches.map(creature => creature.id));
        let fresh = 0;
        for (const id of ids) if (!entry.seen.has(id)) { entry.seen.add(id); fresh += 1; }
        for (const id of [...entry.seen]) if (!ids.has(id)) entry.seen.delete(id);
        if (fresh) notify(entry, now, actions);
        else if (rule.repeat && ids.size && now - entry.lastNotifyAt >= rule.repeatSeconds * 1000) notify(entry, now, actions);
        entry.condition = ids.size > 0;
        entry.phase = entry.condition ? 'suppressed' : 'armed';
        continue;
      }
      if (rule.type === 'teleport') {
        if (!isPosition(telemetry?.position)) continue;
        if (entry.lastCheckAt === Number.NEGATIVE_INFINITY) { entry.lastCheckAt = now; entry.lastPosition = { ...telemetry.position }; continue; }
        if (now - entry.lastCheckAt < rule.teleportIntervalMs) continue;
        const delta = entry.lastPosition ? Math.max(
          Math.abs(telemetry.position.x - entry.lastPosition.x),
          Math.abs(telemetry.position.y - entry.lastPosition.y),
          Math.abs(telemetry.position.z - entry.lastPosition.z),
        ) : 0;
        entry.lastCheckAt = now;
        entry.lastPosition = { ...telemetry.position };
        if (delta >= TELEPORT_TILES) notify(entry, now, actions);
        entry.condition = delta >= TELEPORT_TILES;
        entry.phase = entry.condition ? 'suppressed' : 'armed';
        continue;
      }
      if (rule.type === 'chat') {
        const talks = (Array.isArray(telemetry?.alertEvents) ? telemetry.alertEvents : []).filter(event =>
          event && event.kind === TALK_EVENT_KIND && within(event.id, 0, MAX_SAFE_ID),
        );
        const ids = new Set(talks.map(event => event.id));
        let fresh = 0;
        for (const id of ids) if (!entry.seen.has(id)) { entry.seen.add(id); fresh += 1; }
        for (const id of [...entry.seen]) if (!ids.has(id)) entry.seen.delete(id);
        if (fresh) notify(entry, now, actions);
        else if (rule.repeat && ids.size && now - entry.lastNotifyAt >= rule.repeatSeconds * 1000) notify(entry, now, actions);
        entry.condition = ids.size > 0;
        entry.phase = entry.condition ? 'suppressed' : 'armed';
      }
    }
    return {
      actions,
      states: rules.map(rule => {
        const entry = state.get(rule.index);
        return { ruleId: rule.id, type: rule.type, phase: entry.phase, condition: entry.condition };
      }),
    };
  }

  function reset() {
    for (const entry of state.values()) {
      entry.phase = 'armed';
      entry.lastNotifyAt = Number.NEGATIVE_INFINITY;
      entry.lastCheckAt = Number.NEGATIVE_INFINITY;
      entry.lastPosition = null;
      entry.wasOnline = null;
      entry.seen.clear();
      entry.condition = false;
    }
  }

  return { step, reset, rules, get states() { return [...state.values()].map(entry => ({ ruleId: entry.rule.id, phase: entry.phase })); } };
}

module.exports = { createAlertsEngine, normalizeRules, SUPPORTED_TYPES, BLOCKED_TYPES, TELEPORT_TILES };
