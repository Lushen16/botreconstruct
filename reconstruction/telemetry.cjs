'use strict';

const { uint32 } = require('./protocol.cjs');

const MAX_BYTES = 1048576;
const MAX_MOVES = 100;
const MAX_CONDITIONS = 512;
const MAX_ROSTER = 6;
const MAX_CREATURES = 512;
const MAX_ITEMS = 2048;
const MAX_TILES = 357;
const MAX_PINNED_TEXTS = 256;
const MAX_SEQUENCE = 100;
const MAX_ALERT_EVENTS = 32;
const MAX_DURATION_MS = 2147483647000;
const MAX_SAFE = 9007199254740991;
const MAX_U64 = (1n << 64n) - 1n;
const ALERT_SIGNALS = Object.freeze(['chat', 'gm_message', 'pokemon_capture', 'gm_arrow', 'camera_viewers']);
const PINNED_ID = /^[0-9a-f]{1,16}(?::[0-9a-f]{1,16}){3}$/u;
const CONDITION_TYPE = /^\d{1,20}$/u;
const ALERT_KINDS = Object.freeze(['talk', 'pinned', 'effect', 'viewers']);

const fail = message => { throw new Error(message); };
const isObject = value => value !== null && typeof value === 'object';
const within = (value, minimum, maximum) => Number.isInteger(value) && value >= minimum && value <= maximum;
const byteLength = value => Buffer.byteLength(value, 'utf8');
const stringFits = (value, maximum) => typeof value === 'string' && byteLength(value) <= maximum;

function coordinate(value, message, allowNull) {
  if (value === null && allowNull) return value;
  if (!isObject(value) || Array.isArray(value)) fail(message);
  if (!within(value.x, 0, 65534) || !within(value.y, 0, 65534) || !within(value.z, 0, 15)) fail(message);
  return value;
}

function moveRow(row, message) {
  const spellword = row.spellword;
  if (!stringFits(spellword, 255)) fail(message);
  if (!within(row.remainingMs, 0, MAX_DURATION_MS)) fail(message);
  if (!within(row.totalMs, 0, MAX_DURATION_MS)) fail(message);
  return row;
}

function moveList(value, message) {
  if (value === null) return value;
  if (!Array.isArray(value) || value.length > MAX_MOVES) fail(message);
  for (const row of value) moveRow(row, message);
  return value;
}

function conditionRow(row) {
  const type = row.type;
  if (typeof type !== 'string' || !CONDITION_TYPE.test(type) || BigInt(type) > MAX_U64) fail('Condições inválidas.');
  if (!within(row.subId, 0, 0xffffffff)) fail('Condições inválidas.');
  return row;
}

function rosterList(value) {
  if (!Array.isArray(value) || value.length > MAX_ROSTER) fail('Pokebar inválida.');
  const seen = new Set();
  for (const row of value) {
    if (!within(row.slot, 1, MAX_ROSTER)) fail('Pokebar inválida.');
    if (!stringFits(row.uuid, 255)) fail('Pokebar inválida.');
    if (row.uuid.length === 0 || seen.has(row.uuid)) fail('Pokebar sem UUIDs únicos.');
    seen.add(row.uuid);
    if (!stringFits(row.name, 255)) fail('Pokebar inválida.');
    if (!within(row.healthPercent, 0, 100)) fail('Pokebar inválida.');
    moveList(row.moves, 'Pokebar inválida.');
  }
  return value;
}

function creatureRow(row) {
  const message = 'Criaturas inválidas.';
  if (!within(row.id, 1, 0xffffffff)) fail(message);
  if (!stringFits(row.name, 255)) fail(message);
  if (!within(row.type, 0, 255)) fail(message);
  if (!within(row.healthPercent, 0, 100)) fail(message);
  if (typeof row.canAttack !== 'boolean') fail(message);
  coordinate(row.pos, message, false);
  for (const key of ['shinyIcon', 'lookType', 'normalLookType', 'shinyLookType']) {
    if (row[key] !== undefined && !within(row[key], 0, 65535)) fail(message);
  }
  return row;
}

function itemRow(row) {
  const message = 'Itens inválidos.';
  if (!within(row.id, 1, 65535)) fail(message);
  if (!within(row.stack, 0, 255)) fail(message);
  if (typeof row.container !== 'boolean') fail(message);
  coordinate(row.pos, message, false);
  return row;
}

function tileRow(row) {
  const message = 'Mapa inválido.';
  coordinate(row.pos, message, false);
  if (row.walkable !== undefined && typeof row.walkable !== 'boolean') fail(message);
  return row;
}

function pinnedRow(row) {
  const message = 'Caixas de texto do mapa inválidas.';
  if (typeof row.id !== 'string' || !PINNED_ID.test(row.id)) fail(message);
  coordinate(row.pos, message, false);
  if (!stringFits(row.text, 512)) fail(message);
  return row;
}

function pinnedList(value) {
  if (value === undefined || value === null) return value;
  if (!Array.isArray(value) || value.length > MAX_PINNED_TEXTS) fail('Caixas de texto do mapa inválidas.');
  const seen = new Set();
  for (const row of value) {
    pinnedRow(row);
    if (seen.has(row.id)) fail('Caixas de texto do mapa inválidas.');
    seen.add(row.id);
  }
  return value;
}

function alertEventRow(row) {
  const message = 'Evento de alerta inválido.';
  if (!isObject(row) || Array.isArray(row)) fail(message);
  if (!within(row.id, 1, MAX_SAFE)) fail(message);
  if (typeof row.kind !== 'string' || !ALERT_KINDS.includes(row.kind)) fail(message);
  if (!within(row.mode, 0, 255)) fail(message);
  if (!within(row.value, 0, 65535)) fail(message);
  if (!stringFits(row.name, 95)) fail(message);
  if (!stringFits(row.text, 512)) fail(message);
  if (typeof row.self !== 'boolean') fail(message);
  coordinate(row.pos, message, true);
  return row;
}

function alerts(data) {
  const message = 'Sinais de alerta inválidos.';
  const { alertSignals, alertEvents, alertEventRevision, alertEventsDropped } = data;
  const declared = [alertSignals, alertEvents, alertEventRevision, alertEventsDropped].filter(value => value !== undefined).length;
  if (declared === 0) return;
  if (declared !== 4) fail(message);
  if (!isObject(alertSignals) || Array.isArray(alertSignals)) fail(message);
  for (const key of ALERT_SIGNALS) if (typeof alertSignals[key] !== 'boolean') fail(message);
  if (!Array.isArray(alertEvents) || alertEvents.length > MAX_ALERT_EVENTS) fail(message);
  if (!within(alertEventRevision, 0, MAX_SAFE) || !within(alertEventsDropped, 0, MAX_SAFE)) fail(message);
  let previousId = 0;
  for (const row of alertEvents) {
    alertEventRow(row);
    if (row.id <= previousId || row.id > alertEventRevision) fail('Evento de alerta inválido.');
    previousId = row.id;
  }
}

function inspectionBlock(data) {
  const value = data.inspection;
  if (value === undefined || value === null) return;
  const message = 'Inspeção de item inválida.';
  if (!isObject(value) || Array.isArray(value)) fail(message);
  if (!within(value.revision, 1, 0xffffffff)) fail(message);
  if (!within(value.id, 1, 65535)) fail(message);
  if (value.kind !== 'item' && value.kind !== 'creature') fail(message);
  if (typeof value.container !== 'boolean') fail(message);
  coordinate(value.pos, message, true);
}

function inspectBlock(data) {
  if (data.captureVersion === undefined) return;
  if (data.captureVersion !== 1 || typeof data.itemInspectorAvailable !== 'boolean') fail('Identificação de corpos inválida.');
  const counts = data.itemCounts;
  if (!Array.isArray(counts) || counts.length > MAX_ITEMS) fail('Contagem de itens inválida.');
  for (const row of counts) {
    if (!within(row.id, 1, 65535) || !within(row.count, 0, 65535)) fail('Contagem de itens inválida.');
  }
  if (!Object.hasOwn(data, 'inspection')) fail('Inspeção de item inválida.');
  inspectionBlock(data);
}

function decodeTelemetry(input) {
  if (input.length > MAX_BYTES) fail('Telemetria excedeu 1 MB.');
  const data = JSON.parse(input.toString('utf8'));
  if (data.schema !== 2 || typeof data.nativeVerified !== 'boolean') fail('Telemetria nativa incompatível.');
  if (data.combatDispatchVersion !== undefined && data.combatDispatchVersion !== 1) fail('Dispatcher de combo incompatível.');
  if (data.dynamicLureVersion !== undefined && data.dynamicLureVersion !== 1) fail('Dynamic Lure incompatível.');
  if (data.guildDailyAvailable !== undefined && typeof data.guildDailyAvailable !== 'boolean') fail('Disponibilidade da daily guild inválida.');
  if (data.guildDailyAutoVersion !== undefined && data.guildDailyAutoVersion !== 0 && data.guildDailyAutoVersion !== 1) fail('Automático da daily guild incompatível.');
  if (data.guildName !== undefined && !stringFits(data.guildName, 255)) fail('Nome da guild inválido.');
  if (data.guildDailies !== undefined && data.guildDailies !== null) fail('Progresso da daily guild inválido.');
  if (data.pulseVersion !== 3) fail('Reinicie o cliente e injete a DLL atualizada: o ciclo contínuo exige as correções de leitura de memória, combo e hotkeys do Target.');
  uint32(data.tick, 'tick');
  uint32(data.playerId, 'playerId');
  if (data.clientPid !== undefined && !within(data.clientPid, 1, 0xffffffff)) fail('clientPid: inteiro de 32 bits inválido.');
  if (data.playerName !== undefined && !stringFits(data.playerName, 255)) fail('Nome do personagem inválido.');
  if (data.ownSummonId !== undefined) uint32(data.ownSummonId, 'ownSummonId');
  if (!within(data.fightMode, 0, 3)) fail('Direção ou modo de combate inválido.');
  if (!within(data.chaseMode, 0, 1)) fail('Direção ou modo de combate inválido.');
  if (data.direction !== undefined && !within(data.direction, 0, 7)) fail('Direção ou modo de combate inválido.');
  if (!within(data.clockMs, 0, MAX_SAFE)) fail('Estado nativo inválido.');
  if (!within(data.activeSlot, 0, 6)) fail('Estado nativo inválido.');
  coordinate(data.position, 'Estado nativo inválido.', true);
  moveList(data.moves, 'Estado nativo inválido.');
  if (!Array.isArray(data.nativeSequence) || data.nativeSequence.length > MAX_SEQUENCE) fail('Sequência nativa inválida.');
  for (const value of data.nativeSequence) if (!stringFits(value, 255)) fail('Sequência nativa inválida.');
  if (!stringFits(data.pokemonName, 255) || !stringFits(data.comboPokemonName, 255)) fail('Identidade da movebar inválida.');
  if (typeof data.conditionEvents !== 'boolean' || typeof data.conditionsKnown !== 'boolean') fail('Condições inválidas.');
  if (!Array.isArray(data.conditions) || data.conditions.length > MAX_CONDITIONS) fail('Condições inválidas.');
  for (const row of data.conditions) conditionRow(row);
  rosterList(data.roster);
  if (!Array.isArray(data.creatures) || data.creatures.length > MAX_CREATURES) fail('Criaturas inválidas.');
  for (const row of data.creatures) creatureRow(row);
  if (!Array.isArray(data.items) || data.items.length > MAX_ITEMS) fail('Itens inválidos.');
  for (const row of data.items) itemRow(row);
  inspectBlock(data);
  if (!Array.isArray(data.tiles) || data.tiles.length > MAX_TILES) fail('Mapa inválido.');
  for (const row of data.tiles) tileRow(row);
  pinnedList(data.pinnedTexts);
  alerts(data);
  return data;
}

module.exports = {
  MAX_BYTES, MAX_MOVES, MAX_CONDITIONS, MAX_ROSTER, MAX_CREATURES, MAX_ITEMS, MAX_TILES,
  MAX_PINNED_TEXTS, MAX_SEQUENCE, MAX_DURATION_MS, ALERT_SIGNALS, decodeTelemetry,
};
