'use strict';

const { sameTile, distance, direction, isPosition } = require('./shared.cjs');

const ACTIONS = Object.freeze(['walk', 'safespot', 'box', 'stairs', 'wait', 'say']);
const STAIRS_TIMEOUT_MS = 5000;
const STUCK_LIMIT = 3;
const STALL_LIMIT = 6;

function clockwise(directionId) {
  return directionId <= 3 ? (directionId + 1) % 4 : 4 + (directionId - 4 + 1) % 4;
}

function normalizeWaypoint(waypoint) {
  if (!waypoint || typeof waypoint !== 'object') throw new Error('Waypoint invalido.');
  if (!ACTIONS.includes(waypoint.action)) throw new Error('Acao do waypoint invalida.');
  if (!isPosition(waypoint.pos)) throw new Error('Posicao do waypoint invalida.');
  return {
    action: waypoint.action,
    pos: { x: waypoint.pos.x, y: waypoint.pos.y, z: waypoint.pos.z },
    param: waypoint.param === undefined || waypoint.param === null ? '' : waypoint.param,
    stairCheckMonsters: waypoint.stairCheckMonsters === true,
  };
}

function createWalkerEngine(config) {
  const walker = config?.walker || {};
  const waypoints = (Array.isArray(walker.waypoints) ? walker.waypoints : []).map(normalizeWaypoint);
  const loop = walker.loop !== false;
  const smart = walker.smartWalking === true;
  const startNearest = walker.startNearestWaypoint === true;
  const state = { index: 0, waitingUntil: 0, lastPosition: null, attempts: 0, stalls: 0,
    pendingStairs: null, saidIndex: -1, finished: false, started: false };

  function nearestIndex(position) {
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < waypoints.length; index += 1) {
      const current = distance(position, waypoints[index].pos);
      if (current < bestDistance) { bestDistance = current; best = index; }
    }
    return best;
  }

  function advance() {
    state.waitingUntil = 0;
    state.saidIndex = -1;
    state.attempts = 0;
    state.stalls = 0;
    if (state.index + 1 < waypoints.length) { state.index += 1; return true; }
    if (loop && waypoints.length) { state.index = 0; return true; }
    state.finished = true;
    return false;
  }

  function next(emitted, reason) {
    return advance()
      ? { action: 'advance', emitted, index: state.index, ...(reason ? { reason } : {}) }
      : { action: 'done', emitted, ...(reason ? { reason } : {}) };
  }

  function step(telemetry, sink, now) {
    if (!waypoints.length || state.finished) return { action: 'idle', emitted: [] };
    const position = telemetry.position;
    if (!state.started) {
      state.started = true;
      if (startNearest) state.index = nearestIndex(position);
    }

    if (state.pendingStairs) {
      if (position.z !== state.pendingStairs.fromZ) {
        state.pendingStairs = null;
        state.lastPosition = position;
        return next([], 'stairs');
      }
      if (now >= state.pendingStairs.deadline) {
        state.pendingStairs = null;
        state.lastPosition = position;
        return next([], 'stairs-timeout');
      }
      return { action: 'hold', emitted: [], reason: 'stairs' };
    }

    const waypoint = waypoints[state.index];
    if (waypoint.action === 'wait') {
      if (!state.waitingUntil) state.waitingUntil = now + Math.min(3600000, Math.max(0, Number(waypoint.param) || 0));
      if (now < state.waitingUntil) return { action: 'hold', emitted: [], reason: 'wait' };
      return next([], 'wait');
    }
    if (waypoint.action === 'say') {
      const emitted = [];
      if (state.saidIndex !== state.index) {
        const text = String(waypoint.param).trim();
        if (!text || Buffer.byteLength(text, 'utf8') > 255) return { action: 'idle', emitted, reason: 'say-invalid' };
        sink.command('talk', text);
        emitted.push(['talk', text]);
        state.saidIndex = state.index;
      }
      return next(emitted, 'say');
    }
    if (waypoint.action === 'stairs' && sameTile(position, waypoint.pos)) {
      state.pendingStairs = { fromZ: waypoint.pos.z, deadline: now + STAIRS_TIMEOUT_MS };
      return { action: 'hold', emitted: [], reason: 'stairs' };
    }
    if (sameTile(position, waypoint.pos)) return next([], 'arrived');

    const target = smart ? smartTarget(position, waypoint) : waypoint.pos;
    if (target.x === position.x && target.y === position.y) {
      state.stalls += 1;
      if (state.stalls >= STALL_LIMIT) return next([], 'floor-mismatch');
      return { action: 'hold', emitted: [], reason: 'floor-mismatch' };
    }
    const stuck = sameTile(position, state.lastPosition);
    state.attempts = stuck ? state.attempts + 1 : 0;
    let move = direction(position, target);
    if (state.attempts >= STUCK_LIMIT) {
      move = clockwise(move);
      if (state.attempts >= STALL_LIMIT) return next([], 'stuck');
    }
    sink.command('walk', move);
    state.lastPosition = position;
    return { action: 'move', emitted: [['walk', move]], direction: move, index: state.index };
  }

  function smartTarget(position, waypoint) {
    const dx = waypoint.pos.x - position.x;
    const dy = waypoint.pos.y - position.y;
    if (Math.abs(dx) >= Math.abs(dy)) return { x: position.x + Math.sign(dx), y: position.y, z: position.z };
    return { x: position.x, y: position.y + Math.sign(dy), z: position.z };
  }

  return {
    step,
    reset() { Object.assign(state, { index: 0, waitingUntil: 0, lastPosition: null, attempts: 0, stalls: 0,
      pendingStairs: null, saidIndex: -1, finished: false, started: false }); },
    get state() { return { index: state.index, pendingStairs: state.pendingStairs, finished: state.finished, total: waypoints.length }; },
    waypoints: () => waypoints.map(waypoint => ({ ...waypoint, pos: { ...waypoint.pos } })),
  };
}

module.exports = { createWalkerEngine, normalizeWaypoint, ACTIONS, STAIRS_TIMEOUT_MS, STUCK_LIMIT };
