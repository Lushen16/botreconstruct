'use strict';

const { projectTarget } = require('./keyboard-combat.cjs');
const { verifyCaptureBinding } = require('./capture-binding.cjs');
const { normalizeConfig } = require('./engines/capture-engine.cjs');

function captureRequest(transport, telemetry, candidate, plan, config) {
  const key = transport.captureHotkeys?.[String(plan.parameter.itemId)];
  if (typeof key !== 'string' || !/^(?:F(?:[1-9]|1[0-2])|[a-z0-9])$/iu.test(key)) {
    throw Error('Capture: configure captureHotkeys por ID de Pokebola no transporte local.');
  }
  if (!candidate.item.struct_va || !candidate.item.tile_va || !telemetry.itemIdentityProfile) {
    throw Error('Capture: identidade RPM do corpo nao comprovada.');
  }
  const ballGuard = verifyCaptureBinding(transport, plan.parameter.itemId, key);
  return { ...projectTarget(transport.viewport, telemetry.position, candidate.item), kind: 'useWith', key,
    itemId: plan.parameter.itemId, targetId: plan.parameter.targetId,
    playerName: telemetry.playerName, ballGuard,
    itemGuard: { pid: telemetry.itemPid, generatedAt: telemetry.itemsGeneratedAt,
      maxDistance: normalizeConfig(config).maxDistance,
      player: telemetry.creaturePlayer, item: candidate.item, profile: telemetry.itemIdentityProfile } };
}

module.exports = { captureRequest };
