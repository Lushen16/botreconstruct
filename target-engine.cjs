'use strict';

function validPosition(position) {
  return position != null && Number.isFinite(position.x)
    && Number.isFinite(position.y) && Number.isFinite(position.z);
}

function normalizeName(name) {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

function validId(id) {
  return (Number.isSafeInteger(id) && id >= 0)
    || (typeof id === 'string' && id.trim().length > 0);
}

function distanceBetween(player, target) {
  return Math.max(Math.abs(player.x - target.pos.x), Math.abs(player.y - target.pos.y));
}

function nonNegative(value, fallback) {
  return value === undefined ? fallback
    : Number.isFinite(value) && value >= 0 ? value : null;
}

function targetRules(config) {
  const monsters = config.monsters === undefined ? ['*'] : config.monsters;
  const rules = [];
  if (!Array.isArray(monsters)) return null;
  for (let index = 0; index < monsters.length; index += 1) {
    const entry = monsters[index];
    const name = normalizeName(typeof entry === 'string' ? entry : entry?.name);
    const priority = typeof entry === 'object' && Number.isFinite(entry?.priority) ? entry.priority : index;
    const range = typeof entry === 'object' ? nonNegative(entry?.range, Infinity) : Infinity;
    if (name && range !== null) rules.push({ name, priority, range });
  }
  return rules;
}

function candidateScore(player, creature, rules, maxDistance) {
  if (!creature || !validId(creature.id) || !validPosition(creature.pos)
      || creature.pos.z !== player.z || !Number.isFinite(creature.healthPercent)
      || creature.healthPercent <= 0 || creature.healthPercent > 100
      || creature.is_player === true || creature.canAttack === false
      || creature.is_owned === true || creature.isOwnPokemon === true
      || (creature.creatureType !== undefined && creature.creatureType !== 1)) return null;
  const name = normalizeName(creature.name);
  if (!name || name === normalizeName(player.name)) return null;
  const distance = distanceBetween(player, creature);
  if (distance > maxDistance) return null;
  let priority = Infinity;
  for (const rule of rules) {
    if (distance <= rule.range && (rule.name === name || rule.name === '*'
        || (rule.name.endsWith('*') && name.startsWith(rule.name.slice(0, -1))))) {
      priority = Math.min(priority, rule.priority);
    }
  }
  if (priority === Infinity) return null;
  return { creature, distance, priority };
}

/** Motor puro: seleciona entidades e produz acoes, sem acesso a memoria ou Win32. */
class TargetEngine {
  /** options.now permite testes deterministas; em producao usa Date.now(). */
  constructor(config = {}, options = {}) {
    this.config = config && typeof config === 'object' ? config : {};
    this._now = typeof options?.now === 'function' ? options.now : Date.now;
    this._target = null;
    this._lastActionAt = null;
    this._keyUsedAt = new Map();
    this._rotationIndex = 0;
  }

  /**
   * Chame a cada snapshot, antes de getCombatAction(). O lock usa o ID e recebe
   * HP/posicao atualizados. Empates preservam a ordem do scanner; custo O(n+m).
   * Nomes sao exatos e ignoram caixa; '*' aceita nomes nao listados. Nomes
   * explicitos mantem sua propria prioridade, mesmo apos o '*'.
   */
  selectTarget(player, creatures, config = this.config) {
    if (!validPosition(player)
        || !Array.isArray(creatures) || !config || typeof config !== 'object') {
      this._target = null;
      return null;
    }
    const maxDistance = nonNegative(config.maxDistance, 8);
    const rules = targetRules(config);
    if (maxDistance === null || !rules) {
      this._target = null;
      return null;
    }
    let best = null;
    for (const creature of creatures) {
      const score = candidateScore(player, creature, rules, maxDistance);
      if (!score) continue;
      if (this._target && creature.id === this._target.id) {
        this._rememberTarget(creature);
        return creature;
      }
      if (!best || this._isBetter(score, best, config.priorityMode)) best = score;
    }
    this._rememberTarget(best?.creature ?? null);
    return best?.creature ?? null;
  }

  filterCandidates(player, creatures, config = this.config) {
    if (!validPosition(player) || !Array.isArray(creatures)
        || !config || typeof config !== 'object') return [];
    const maximum = nonNegative(config.maxDistance, 8);
    const rules = targetRules(config);
    if (maximum === null || !rules) return [];
    return creatures.filter(creature => candidateScore(player, creature, rules, maximum) !== null);
  }

  /** Copia o alvo para impedir que alteracoes externas corrompam o estado. */
  _rememberTarget(creature) {
    this._target = creature ? { ...creature, pos: { ...creature.pos } } : null;
  }

  _isBetter(candidate, current, mode) {
    if (mode === 'lowestHp' && candidate.creature.healthPercent !== current.creature.healthPercent) {
      return candidate.creature.healthPercent < current.creature.healthPercent;
    }
    if (mode === 'highestPriorityList' && candidate.priority !== current.priority) {
      return candidate.priority < current.priority;
    }
    return candidate.distance < current.distance;
  }

  /**
   * getCombatAction(player, config) usa config.skills e config.globalCooldownMs.
   * Rotacao circular pula skills indisponiveis. Alcances sao inclusivos;
   * onlyIfHpAbove/Below usam comparacoes estritas do HP percentual do alvo.
   * Retornar uma acao reserva imediatamente GCD/cooldown: execute-a uma vez.
   * null nao consome timestamps. Cooldowns por tecla sobrevivem a troca de
   * alvo, e 'F1'/'f1' compartilham o mesmo registro.
   */
  getCombatAction(player, config = this.config) {
    if (!this._target) return null;
    const rules = config && typeof config === 'object' ? targetRules(config) : null;
    const maxDistance = config ? nonNegative(config.maxDistance, 8) : null;
    if (!validPosition(player) || !rules
        || maxDistance === null || !candidateScore(player, this._target, rules, maxDistance)) {
      this._target = null;
      return null;
    }
    const skills = config.skills;
    const gcdMs = nonNegative(config.globalCooldownMs, 250);
    if (!Array.isArray(skills) || !skills.length || gcdMs === null) return null;
    let now;
    try {
      now = this._now();
    } catch {
      return null;
    }
    if (!Number.isFinite(now)) return null;
    if (this._lastActionAt !== null && now - this._lastActionAt < gcdMs) return null;
    const distance = distanceBetween(player, this._target);
    for (let offset = 0; offset < skills.length; offset += 1) {
      const index = (this._rotationIndex + offset) % skills.length;
      const skill = skills[index];
      if (!skill || typeof skill.key !== 'string' || !skill.key.trim()) continue;
      const cooldownMs = nonNegative(skill.cooldownMs, 0);
      const minimum = nonNegative(skill.minDistance, 0);
      const maximum = nonNegative(skill.maxDistance, Infinity);
      if (cooldownMs === null || minimum === null || maximum === null
          || minimum > maximum || distance < minimum || distance > maximum) continue;
      if (!this._matchesHealth(skill)) continue;
      const key = skill.key.trim().toLowerCase();
      const usedAt = this._keyUsedAt.get(key);
      if (usedAt !== undefined && now - usedAt < cooldownMs) continue;
      this._keyUsedAt.set(key, now);
      this._lastActionAt = now;
      this._rotationIndex = (index + 1) % skills.length;
      return { type: 'key', key, targetId: this._target.id };
    }
    return null;
  }

  recordDispatch(key, timestamp) {
    const normalized = normalizeName(key);
    if (!normalized || !Number.isFinite(timestamp)) throw Error('Registro de envio invalido.');
    this._keyUsedAt.set(normalized, Math.max(this._keyUsedAt.get(normalized) ?? -Infinity, timestamp));
    this._lastActionAt = Math.max(this._lastActionAt ?? -Infinity, timestamp);
  }

  _matchesHealth(skill) {
    const health = this._target.healthPercent;
    for (const field of ['onlyIfHpAbove', 'onlyIfHpBelow']) {
      const threshold = skill[field];
      if (threshold !== undefined
          && (!Number.isFinite(threshold) || threshold < 0 || threshold > 100)) return false;
    }
    return (skill.onlyIfHpAbove === undefined || health > skill.onlyIfHpAbove)
      && (skill.onlyIfHpBelow === undefined || health < skill.onlyIfHpBelow);
  }

  /** Lock ativo, inclusive durante cooldown; atualize selectTarget por tick. */
  isFighting() {
    return this._target !== null;
  }

  /** Libera o alvo sem reiniciar cooldowns, evitando spam ao retomar combate. */
  clearTarget() {
    this._target = null;
  }
}

module.exports = TargetEngine;
module.exports.TargetEngine = TargetEngine;
