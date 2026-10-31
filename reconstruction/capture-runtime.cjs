'use strict';

const { normalizeConfig, chooseBall, rankCaptureCandidates, prepareCaptureDispatch,
  recordCaptureDispatchResult } = require('./engines/capture-engine.cjs');

const validPosition = position => position && ['x', 'y', 'z'].every(axis => Number.isInteger(position[axis]))
  && position.x >= 0 && position.x <= 65534 && position.y >= 0 && position.y <= 65534
  && position.z >= 0 && position.z <= 15;
const itemKey = item => JSON.stringify([item.pos.x, item.pos.y, item.pos.z, item.id, item.stack, item.struct_va ?? null]);

class CaptureRuntime {
  constructor() { this.reset(); }

  reset() {
    this.history = new Map();
    this.accepted = new Set();
    this.nextAttemptAt = 0;
    this.last = { status: 'off', effectVerified: false };
  }

  plan(telemetry, config, now, options = {}) {
    const settings = normalizeConfig(config);
    const block = reason => {
      this.last = { status: 'blocked', reason, effectVerified: false };
      return null;
    };
    if (!settings.enabled) { this.last = { status: 'off', effectVerified: false }; return null; }
    if (!Number.isFinite(now) || !validPosition(telemetry?.position)) return block('capture-position');
    if (telemetry.captureVersion !== 1 || telemetry.itemInspectorAvailable !== true) return block('capture-source-unavailable');
    if (telemetry.itemsComplete === false || !Array.isArray(telemetry.items)) return block('capture-items-incomplete');
    if (settings.afterCombat && options.inCombat !== false) return block('capture-after-combat');
    if (now < this.nextAttemptAt) { this.last = { status: 'cooldown', effectVerified: false }; return null; }
    const keys = new Set();
    const candidates = [];
    for (const item of telemetry.items) {
      if (!item || !Number.isInteger(item.id) || item.id < 1 || item.id > 65535
          || !Number.isInteger(item.stack) || item.stack < 0 || item.stack > 255 || !validPosition(item.pos)) {
        return block('capture-item-invalid');
      }
      const key = itemKey(item);
      if (keys.has(key)) return block('capture-item-ambiguous');
      keys.add(key);
      const entry = settings.entries.find(value => value.corpseId === item.id);
      if (!entry || item.pos.z !== telemetry.position.z || settings.afterCombat && this.accepted.has(key)) continue;
      const distance = Math.max(Math.abs(item.pos.x - telemetry.position.x), Math.abs(item.pos.y - telemetry.position.y));
      if (distance > settings.maxDistance) continue;
      const ball = chooseBall(entry, telemetry.itemCounts);
      if (!ball) continue;
      const history = this.history.get(key) || { lastAttemptAt: 0, attempts: 0, failures: 0 };
      candidates.push({ key, item: structuredClone(item), distance, history, entry, ball });
    }
    if (telemetry.itemsInventoryComplete !== false) {
      for (const key of this.history.keys()) if (!keys.has(key)) { this.history.delete(key); this.accepted.delete(key); }
    }
    const candidate = rankCaptureCandidates(candidates);
    if (!candidate) { this.last = { status: 'idle', reason: 'no-configured-corpse', effectVerified: false }; return null; }
    this.last = { status: 'planned', corpseId: candidate.item.id, ballId: candidate.ball.ballId, effectVerified: false };
    return candidate;
  }

  revalidate(candidate, telemetry, config) {
    const settings = normalizeConfig(config);
    if (telemetry?.captureVersion !== 1 || telemetry.itemInspectorAvailable !== true
        || telemetry.itemsComplete === false || !Array.isArray(telemetry.items)) {
      return { state: 'BLOCKED', reason: 'capture-source-unavailable' };
    }
    if (!settings.enabled || !settings.entries.some(entry => entry.corpseId === candidate.item.id
        && entry.ballId === candidate.entry.ballId && entry.fallbackBallId === candidate.entry.fallbackBallId)) {
      return { state: 'BLOCKED', reason: 'capture-config-changed' };
    }
    const ball = chooseBall(candidate.entry, telemetry.itemCounts);
    if (!ball || ball.ballId !== candidate.ball.ballId) return { state: 'BLOCKED', reason: 'capture-ball-updated' };
    return prepareCaptureDispatch(candidate, telemetry.items, { playerPosition: telemetry.position,
      maxDistance: settings.maxDistance, ballId: ball.ballId, keyOf: itemKey });
  }

  record(candidate, config, now, accepted) {
    const result = recordCaptureDispatchResult(candidate.history, now, normalizeConfig(config).delayMs, accepted);
    this.history.set(candidate.key, result.history);
    this.nextAttemptAt = result.nextAttemptAt;
    if (accepted) this.accepted.add(candidate.key);
    this.last = { status: accepted ? 'dispatched' : 'rejected', corpseId: candidate.item.id,
      ballId: candidate.ball.ballId, inputAccepted: accepted, effectVerified: false };
    return this.last;
  }
}

module.exports = { CaptureRuntime, itemKey };
