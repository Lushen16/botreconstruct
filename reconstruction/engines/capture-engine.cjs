'use strict';

const CAPTURE_VERSION = 1;
const DEFAULT_MAX_DISTANCE = 3;

const isPos = value => value && ['x', 'y', 'z'].every(k => Number.isInteger(value[k]));
const clamp = (value, min, max, fallback) => Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
const normalizeName = value => String(value ?? '').trim();

function normalizeConfig(config) {
  const looting = config?.looting ?? {};
  const entries = Array.isArray(looting.captureEntries) ? looting.captureEntries : [];
  return {
    enabled: looting.captureEnabled === true,
    maxDistance: clamp(looting.maxCaptureDist, 1, 30, DEFAULT_MAX_DISTANCE),
    afterCombat: looting.captureAfterCombat === true,
    delayMs: clamp(looting.captureDelay, 1, 60000, 300),
    entries: entries.filter(entry => entry && Number.isInteger(entry.corpseId)).map(entry => ({
      name: normalizeName(entry.name),
      corpseId: entry.corpseId,
      ballId: Number.isInteger(entry.ballId) ? entry.ballId : 0,
      fallbackBallId: Number.isInteger(entry.fallbackBallId) ? entry.fallbackBallId : 0,
    })),
  };
}

function inspectionShape(telemetry) {
  const inspection = telemetry?.inspection;
  if (!inspection || typeof inspection !== 'object') return { ok: false, reason: 'no-inspection' };
  if (inspection.kind !== 'item') return { ok: false, reason: 'inspection-not-item' };
  if (!Number.isInteger(inspection.id)) return { ok: false, reason: 'inspection-id' };
  if (!isPos(inspection.pos)) return { ok: false, reason: 'inspection-position' };
  return { ok: true, inspection };
}

function selectCaptureCandidate(telemetry, config, context = {}) {
  const cfg = normalizeConfig(config);
  if (!cfg.enabled) return { eligible: false, reason: 'capture-disabled' };
  if (telemetry?.captureVersion !== CAPTURE_VERSION) return { eligible: false, reason: 'capture-version' };
  if (telemetry?.itemInspectorAvailable !== true) return { eligible: false, reason: 'item-inspector-unavailable' };
  if (!isPos(telemetry?.position)) return { eligible: false, reason: 'player-position' };
  const shape = inspectionShape(telemetry);
  if (!shape.ok) return { eligible: false, reason: shape.reason };
  const { inspection } = shape;
  const entry = cfg.entries.find(item => item.corpseId === inspection.id);
  if (!entry) return { eligible: false, reason: 'corpse-not-configured', inspection };
  if (cfg.afterCombat && context.afterCombat !== true) return { eligible: false, reason: 'after-combat-pending', entry, inspection };
  if (inspection.pos.z !== telemetry.position.z) return { eligible: false, reason: 'different-floor', entry, inspection };
  const distance = Math.max(
    Math.abs(inspection.pos.x - telemetry.position.x),
    Math.abs(inspection.pos.y - telemetry.position.y),
  );
  if (distance > cfg.maxDistance) return { eligible: false, reason: 'out-of-range', distance, entry, inspection };
  return { eligible: true, reason: null, distance, entry, inspection };
}

function chooseBall(entry, itemCounts) {
  if (!entry) return null;
  const counts = new Map((Array.isArray(itemCounts) ? itemCounts : []).map(item => [item?.id, Number(item?.count)]));
  const countOf = id => counts.has(id) ? counts.get(id) : null;
  const primary = entry.ballId;
  const fallback = entry.fallbackBallId;
  const primaryCount = countOf(primary);
  if (primary && (primaryCount === null || primaryCount > 0)) return { ballId: primary, source: 'primary' };
  if (fallback && (countOf(fallback) === null || countOf(fallback) > 0)) return { ballId: fallback, source: 'fallback' };
  return null;
}

function nextCaptureAt(now, delayMs) {
  if (!Number.isFinite(now)) throw new TypeError('now invalido');
  const delay = clamp(delayMs, 1, 60000, 300);
  return now + delay;
}

function validateRankCandidate(candidate) {
  const history = candidate?.history;
  if (!candidate?.item || !Number.isInteger(candidate.item.stack) || candidate.item.stack < 0 ||
      !Number.isFinite(candidate.distance) || candidate.distance < 0 ||
      !Number.isFinite(history?.lastAttemptAt) ||
      !['attempts', 'failures'].every(field => Number.isInteger(history[field]) && history[field] >= 0 && history[field] <= 0xffffffff)) {
    throw new TypeError('Candidato ou historico interno de captura invalido');
  }
}

function compareCaptureCandidates(candidate, best) {
  validateRankCandidate(candidate);
  validateRankCandidate(best);
  const fresh = history => history.attempts === 0 && history.failures < 3;
  const candidateFresh = fresh(candidate.history);
  const bestFresh = fresh(best.history);
  if (candidateFresh !== bestFresh) return candidateFresh ? -1 : 1;
  if (candidate.history.lastAttemptAt !== best.history.lastAttemptAt) {
    return candidate.history.lastAttemptAt < best.history.lastAttemptAt ? -1 : 1;
  }
  if (candidate.distance !== best.distance) return candidate.distance < best.distance ? -1 : 1;
  if (candidate.item.stack !== best.item.stack) return candidate.item.stack > best.item.stack ? -1 : 1;
  return 0;
}

function rankCaptureCandidates(candidates) {
  if (!Array.isArray(candidates)) throw new TypeError('Candidatos devem ser um array');
  let best = null;
  for (const candidate of candidates) {
    validateRankCandidate(candidate);
    if (best === null || compareCaptureCandidates(candidate, best) < 0) best = candidate;
  }
  return best;
}

function revalidateCaptureTarget(candidate, currentItems, keyOf) {
  if (!candidate?.item || typeof candidate.key !== 'string' || !isPos(candidate.item.pos) ||
      !Array.isArray(currentItems) || typeof keyOf !== 'function') {
    throw new TypeError('Revalidacao exige item, chave interna e resolvedor de chave');
  }
  const selected = candidate.item;
  return currentItems.some(item => item && item.id === selected.id && item.stack === selected.stack &&
    isPos(item.pos) && item.pos.x === selected.pos.x && item.pos.y === selected.pos.y &&
    keyOf(item) === candidate.key);
}

function prepareCaptureDispatch(candidate, currentItems, options) {
  const { playerPosition, maxDistance, ballId, keyOf } = options ?? {};
  if (!candidate?.item || !isPos(candidate.item.pos) || !isPos(playerPosition) ||
      !Number.isFinite(maxDistance) || maxDistance < 0) {
    throw new TypeError('Planejamento exige posicoes e alcance explicitos');
  }
  const item = candidate.item;
  if (![ballId, item.id].every(value => Number.isInteger(value) && value >= 1 && value <= 65535) ||
      !Number.isInteger(item.stack) || item.stack < 0 || item.stack > 255 ||
      !['x', 'y'].every(axis => item.pos[axis] >= 0 && item.pos[axis] <= 65534) || item.pos.z < 0 || item.pos.z > 15) {
    throw new TypeError('Parametros useWith invalidos');
  }
  if (item.pos.z !== playerPosition.z) return { state: 'BLOCKED', reason: 'different-floor' };
  const distance = Math.max(Math.abs(item.pos.x - playerPosition.x), Math.abs(item.pos.y - playerPosition.y));
  if (distance > maxDistance) return { state: 'BLOCKED', reason: 'out-of-range' };
  if (!revalidateCaptureTarget(candidate, currentItems, keyOf)) return { state: 'BLOCKED', reason: 'corpse-updated' };
  return { state: 'DISPATCH_PLANNED', command: 'useWith',
    parameter: { ...item.pos, itemId: ballId, targetId: item.id, stack: item.stack } };
}

function recordCaptureDispatchResult(history, now, effectiveDelay, accepted) {
  validateRankCandidate({ item: { stack: 0 }, distance: 0, history });
  if (!Number.isFinite(now) || !Number.isFinite(effectiveDelay) || effectiveDelay < 0 || typeof accepted !== 'boolean') {
    throw new TypeError('Resultado de despacho invalido');
  }
  return { state: 'COOLDOWN', nextAttemptAt: now + effectiveDelay,
    history: { ...history, lastAttemptAt: now,
      attempts: accepted ? (history.attempts + 1) >>> 0 : history.attempts,
      failures: accepted ? 0 : (history.failures + 1) >>> 0 } };
}

module.exports = { CAPTURE_VERSION, DEFAULT_MAX_DISTANCE, normalizeConfig, selectCaptureCandidate, chooseBall, nextCaptureAt,
  compareCaptureCandidates, rankCaptureCandidates, revalidateCaptureTarget, prepareCaptureDispatch, recordCaptureDispatchResult };
