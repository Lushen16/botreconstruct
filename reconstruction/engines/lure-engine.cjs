'use strict';

const { distance, ignoredNames, isIgnored, Cooldown } = require('./shared.cjs');
const { nativeRandomDeadline } = require('./native-random.cjs');

const HOLD_TIMEOUT_MS = 8000;
const RELEASE_MS = 3000;

function clamp(value, minimum, maximum, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function normalizeLuring(config) {
  const source = config?.target?.luring || {};
  const luring = {
    enabled: source.enabled === true,
    maxDistance: clamp(source.maxDistance, 1, 16, 3),
    frontEnabled: source.frontEnabled === true,
    frontRegroupMargin: clamp(source.frontRegroupMargin, 4, 8, 5),
    frontRegroupSteps: clamp(source.frontRegroupSteps, 1, 4, 3),
    randomEnabled: source.randomEnabled === true,
    randomMinSeconds: clamp(source.randomMinSeconds, 5, 3600, 45),
    randomMaxSeconds: clamp(source.randomMaxSeconds, 5, 3600, 100),
  };
  if (luring.randomMaxSeconds < luring.randomMinSeconds) luring.randomMaxSeconds = luring.randomMinSeconds;
  if (luring.frontRegroupSteps >= luring.frontRegroupMargin) luring.frontRegroupSteps = luring.frontRegroupMargin - 1;
  luring.mode = luring.randomEnabled ? 'random' : luring.frontEnabled ? 'dynamic' : luring.enabled ? 'distance' : 'off';
  return luring;
}

function createLureEngine(config, options = {}) {
  const luring = normalizeLuring(config);
  const rng = typeof options.rng === 'function' ? options.rng : Math.random;
  const ignored = new Set(ignoredNames(config?.target?.ignoredCreaturesText));
  const state = {
    mode: luring.mode,
    phase: luring.mode === 'off' ? 'off' : 'idle',
    holdSince: null,
    releaseUntil: 0,
    nextCycleAt: 0,
    randomWaiting: false,
    randomUntil: 0,
    chaseState: 0,
  };

  function nearest(telemetry) {
    const position = telemetry?.position;
    let best = Infinity;
    for (const creature of Array.isArray(telemetry?.creatures) ? telemetry.creatures : []) {
      if (!creature || creature.canAttack !== true) continue;
      if (isIgnored(creature.name, ignored)) continue;
      const range = distance(position, creature.pos);
      if (range < best) best = range;
    }
    return best;
  }

  function emit(sink, name, parameter) {
    sink.command(name, parameter);
    return [[name, parameter]];
  }

  function step(telemetry, sink, now) {
    if (luring.mode === 'off') return { allowMovement: true, state: 'off', emitted: [] };
    const range = nearest(telemetry);

    if (luring.mode === 'distance') {
      if (!Number.isFinite(range)) { state.phase = 'no-monsters'; state.holdSince = null; return { allowMovement: true, state: state.phase, emitted: [] }; }
      if (now < state.releaseUntil) { state.phase = 'release'; return { allowMovement: true, state: state.phase, range, emitted: [] }; }
      if (range <= luring.maxDistance) { state.phase = 'in-range'; state.holdSince = null; return { allowMovement: true, state: state.phase, range, emitted: [] }; }
      if (state.holdSince === null) state.holdSince = now;
      if (now - state.holdSince >= HOLD_TIMEOUT_MS) {
        state.holdSince = null;
        state.releaseUntil = now + RELEASE_MS;
        state.phase = 'release';
        return { allowMovement: true, state: state.phase, range, emitted: [] };
      }
      state.phase = 'holding';
      return { allowMovement: false, state: state.phase, range, emitted: [] };
    }

    if (luring.mode === 'dynamic') {
      const accept = luring.maxDistance + luring.frontRegroupSteps;
      const hold = luring.maxDistance + luring.frontRegroupMargin;
      if (!Number.isFinite(range) || range <= accept) {
        const emitted = state.chaseState === 1 ? emit(sink, 'chase', 0) : [];
        state.chaseState = 0;
        state.phase = 'in-range';
        return { allowMovement: true, state: state.phase, range, emitted };
      }
      if (range >= hold) {
        const emitted = state.chaseState === 0 ? emit(sink, 'chase', 1) : [];
        state.chaseState = 1;
        state.phase = 'regroup';
        return { allowMovement: true, state: state.phase, range, emitted };
      }
      state.phase = 'holding-front';
      return { allowMovement: false, state: state.phase, range, emitted: [] };
    }

    // random: alternates walking and waiting windows using the configured range.
    if (now >= state.nextCycleAt) {
      state.randomWaiting = !state.randomWaiting;
      state.randomUntil = nativeRandomDeadline(luring, now, rng()).until;
      state.nextCycleAt = state.randomUntil;
      state.phase = state.randomWaiting ? 'random-wait' : 'random-walk';
    }
    const allowMovement = !state.randomWaiting || now >= state.randomUntil;
    if (allowMovement && state.randomWaiting) { state.randomWaiting = false; state.phase = 'random-walk'; }
    return { allowMovement, state: state.phase, range, emitted: [] };
  }

  return {
    step,
    reset() { Object.assign(state, { phase: luring.mode === 'off' ? 'off' : 'idle', holdSince: null,
      releaseUntil: 0, nextCycleAt: 0, randomWaiting: false, randomUntil: 0, chaseState: 0 }); },
    get state() { return { ...state, mode: luring.mode }; },
    get config() { return { ...luring }; },
    name: 'lure',
  };
}

module.exports = { createLureEngine, normalizeLuring, HOLD_TIMEOUT_MS, RELEASE_MS };
