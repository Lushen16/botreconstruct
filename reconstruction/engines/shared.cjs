'use strict';

const DIRECTIONS = Object.freeze({ north: 0, east: 1, south: 2, west: 3, northeast: 4, southeast: 5, southwest: 6, northwest: 7 });

const isPosition = value => Boolean(value) && [value.x, value.y, value.z].every(Number.isInteger);
const sameTile = (a, b) => Boolean(a) && Boolean(b) && a.x === b.x && a.y === b.y && a.z === b.z;
const distance = (a, b) => {
  if (!isPosition(a) || !isPosition(b)) return Infinity;
  if (a.z !== b.z) return Infinity;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
};
// Plane-only helpers: floor-agnostic navigation for parallel instances/floors.
const samePlane = (a, b) => Boolean(a) && Boolean(b) && a.x === b.x && a.y === b.y;
const planeDistance = (a, b) => {
  if (!isPosition(a) || !isPosition(b)) return Infinity;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
};
const adjacent = (a, b) => distance(a, b) <= 1;

function direction(from, to) {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dy < 0) return dx < 0 ? DIRECTIONS.northwest : dx > 0 ? DIRECTIONS.northeast : DIRECTIONS.north;
  if (dy > 0) return dx < 0 ? DIRECTIONS.southwest : dx > 0 ? DIRECTIONS.southeast : DIRECTIONS.south;
  return dx < 0 ? DIRECTIONS.west : DIRECTIONS.east;
}

function ignoredNames(text) {
  return new Set(String(text || '').split(/[,;\n]/u).map(value => value.trim().toLowerCase()).filter(Boolean));
}

function normalizeName(value) {
  return String(value ?? '').trim().toLowerCase();
}

function matchesName(name, pattern) {
  const normalized = normalizeName(name);
  const rule = normalizeName(pattern);
  if (!normalized || !rule) return false;
  const expression = rule.split('*').map(part => part.replace(/[.*+?^$\{\}()|[\]\\]/gu, '\\$&')).join('.*');
  return new RegExp('^' + expression + '$', 'u').test(normalized);
}

function isIgnored(name, patterns) {
  return [...patterns].some(pattern => matchesName(name, pattern));
}

function parseSequence(text) {
  return String(text || '')
    .replace(/!autocombo/giu, ' ')
    .split(/[,;\s]+/u)
    .map(value => value.trim())
    .filter(value => /^m[1-9]\d*$/u.test(value));
}

function byteLength(value) {
  return Buffer.byteLength(String(value), 'utf8');
}

function ready(snapshot) {
  const session = snapshot || {};
  const telemetry = session.telemetry;
  if (!session.online || session.stale || session.error || session.authExpired) return false;
  if (Number(session.ageMs) > 1000) return false;
  if (!telemetry || telemetry.nativeVerified !== true || telemetry.pulseVersion !== 3) return false;
  if (!isPosition(telemetry.position)) return false;
  return true;
}

function runtimeMismatch(snapshot) {
  const runtime = snapshot?.runtime;
  if (!runtime || !runtime.pid || !Array.isArray(runtime.modules) || runtime.modules.length === 0) return false;
  return runtime.pid !== snapshot.pid;
}

function activePokemon(telemetry, expectedName = telemetry.pokemonName) {
  if (telemetry.isSwitching === true || telemetry.switchPending === true) return null;
  const wanted = normalizeName(expectedName);
  if (!wanted || normalizeName(telemetry.pokemonName) !== wanted) return null;
  const matches = (Array.isArray(telemetry.roster) ? telemetry.roster : [])
    .filter(entry => entry && normalizeName(entry.name) === wanted);
  if (matches.length !== 1) return null;
  const entry = matches[0];
  if (entry.slot !== undefined && (!Number.isInteger(entry.slot) || entry.slot < 1 || entry.slot > 6
      || telemetry.activeSlot !== entry.slot)) return null;
  return entry;
}

class Cooldown {
  constructor(now = 0) { this.last = Number.NEGATIVE_INFINITY; this.now = now; }
  ready(now, interval) { return now - this.last >= interval; }
  use(now) { this.last = now; }
  reset() { this.last = Number.NEGATIVE_INFINITY; }
}

function requirePositiveInteger(value, message) {
  if (!Number.isInteger(value) || value < 1) throw new Error(message);
  return value;
}

function textFits(value, maximum, label) {
  if (typeof value !== 'string' || byteLength(value) < 1 || byteLength(value) > maximum) throw new Error(label + ' invalido.');
  return value;
}

module.exports = {
  DIRECTIONS, isPosition, sameTile, samePlane, distance, planeDistance, adjacent, direction, ignoredNames, normalizeName, matchesName, isIgnored,
  parseSequence, byteLength, activePokemon, ready, runtimeMismatch, Cooldown, requirePositiveInteger, textFits,
};
