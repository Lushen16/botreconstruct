'use strict';

const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');

const EXECUTABLE_SHA256 = '473df25c1edd23e7464ad3ba9b923a603051a8b4ae8004a95c06402f678294e6';
const LAYOUT_ID = 'pka-item-d4-v1';

function createItemSource(file) {
  return () => {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw Error('Stream de Items excede o limite.');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };
}

function mergeItemSnapshot(session, scan, now = Date.now(), maxAgeMs = 500) {
  const age = now - Date.parse(scan?.generatedAt);
  if (!session || scan?.schemaVersion !== 1 || scan.pid !== session.pid
      || scan.executableSha256 !== EXECUTABLE_SHA256 || scan.layoutId !== LAYOUT_ID
      || scan.complete !== true || scan.truncated !== false || scan.error
      || !Array.isArray(scan.readErrors) || scan.readErrors.length || !Array.isArray(scan.items)
      || !Number.isFinite(age) || age < 0 || age > maxAgeMs) {
    throw Error('Snapshot de Items invalido, parcial, expirado ou de outro processo.');
  }
  const player = scan.player;
  if (!player || !Number.isInteger(player.id) || player.creatureType !== 0
      || player.ownershipVerified !== true || typeof player.struct_va !== 'string'
      || typeof player.name !== 'string' || player.name.toLowerCase() !== session.telemetry?.playerName?.toLowerCase()
      || !isDeepStrictEqual(player.pos, session.telemetry.position)) {
    throw Error('Identidade ou posicao do jogador diverge do snapshot de Items.');
  }
  const profile = scan.itemIdentityProfile;
  if (profile?.executableSha256 !== EXECUTABLE_SHA256 || profile.layoutId !== LAYOUT_ID
      || !scan.processStartedAt || !scan.moduleBase) throw Error('Perfil de Items sem identidade comprovada.');
  for (const item of scan.items) {
    if (!item || !/^0x[0-9a-f]+$/i.test(item.struct_va) || !/^0x[0-9a-f]+$/i.test(item.tile_va)) {
      throw Error('Item sem ponteiros de identidade.');
    }
  }
  return { ...session, telemetry: { ...session.telemetry, captureVersion: 1,
    itemInspectorAvailable: true, itemsComplete: true, itemsGeneratedAt: scan.generatedAt,
    itemsInventoryComplete: false, itemDiscovery: structuredClone(scan.discovery || null),
    itemPid: scan.pid, itemIdentityProfile: { ...profile, processStartedAt: scan.processStartedAt,
      moduleBase: scan.moduleBase }, creaturePlayer: structuredClone(player), items: structuredClone(scan.items) } };
}

module.exports = { createItemSource, mergeItemSnapshot, EXECUTABLE_SHA256, LAYOUT_ID };
