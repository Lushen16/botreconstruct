'use strict';

const { isPosition } = require('./engines/shared.cjs');

function rpmSession(raw, now = Date.now()) {
  const timestamp = Date.parse(raw?.generatedAt);
  const ageMs = now - timestamp;
  if (!raw || !Number.isInteger(raw.pid) || raw.pid <= 0 || !isPosition(raw.player?.pos)
      || typeof raw.player.name !== 'string' || !raw.player.name.trim()
      || !Number.isFinite(ageMs) || ageMs < 0) return null;
  const health = raw.player.healthPercent;
  const healthPercent = Number.isFinite(health) && health >= 0 && health <= 100 ? health : undefined;
  const creaturesAge = now - Date.parse(raw.creaturesGeneratedAt);
  const freshCreatures = Number.isFinite(creaturesAge) && creaturesAge >= 0 && creaturesAge <= 1000;
  return {
    pid: raw.pid, generatedAt: raw.generatedAt, source: 'rpm', clientWindowTitle: raw.clientWindowTitle,
    online: raw.online !== false && !raw.error && ageMs <= 1000,
    stale: ageMs > 1000, ageMs, error: raw.error || null, authExpired: false,
    healthPercent, targetId: null,
    telemetry: { nativeVerified: false, playerName: raw.player.name,
      position: { ...raw.player.pos }, healthPercent,
      creaturesGeneratedAt: freshCreatures ? raw.creaturesGeneratedAt : null,
      creaturePlayer: freshCreatures && raw.creaturePlayer?.ownershipVerified === true ? structuredClone(raw.creaturePlayer) : null,
      creatureIdentityProfile: freshCreatures && raw.creatureIdentityProfile ? structuredClone(raw.creatureIdentityProfile) : null,
      creatures: freshCreatures && Array.isArray(raw.creatures) ? structuredClone(raw.creatures) : [],
      creaturesStale: !freshCreatures },
  };
}

module.exports = { rpmSession };
