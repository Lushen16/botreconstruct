'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { materialize, invoke, baseline } = require('./probe_telemetry_vectors.cjs');
const { sha256 } = require('./probe_protocol_vectors.cjs');

const ALERT_KEYS = ['chat', 'gm_message', 'pokemon_capture', 'gm_arrow', 'camera_viewers'];

function signals(value) {
  return Object.fromEntries(ALERT_KEYS.map(key => [key, value]));
}

function rows(count, make) {
  return Array.from({ length: count }, (_, index) => make(index));
}

function buildCases() {
  const cases = [];
  const add = (id, patch) => cases.push({ id, encoding: 'json', input: { ...baseline(), ...patch } });
  const put = (id, input) => cases.push({ id, encoding: 'json', input });

  put('base', baseline());
  for (const [id, patch] of [
    ['moves/100', { moves: rows(100, () => ({ spellword: '', remainingMs: 0, totalMs: 0 })) }],
    ['moves/101', { moves: rows(101, () => ({ spellword: '', remainingMs: 0, totalMs: 0 })) }],
    ['conditions/512', { conditions: rows(512, () => ({ type: '0', subId: 0 })) }],
    ['conditions/513', { conditions: rows(513, () => ({ type: '0', subId: 0 })) }],
    ['creatures/512', { creatures: rows(512, () => ({ id: 1, name: '', type: 0, healthPercent: 0, canAttack: false, pos: { x: 0, y: 0, z: 0 } })) }],
    ['creatures/513', { creatures: rows(513, () => ({ id: 1, name: '', type: 0, healthPercent: 0, canAttack: false, pos: { x: 0, y: 0, z: 0 } })) }],
    ['items/2048', { items: rows(2048, () => ({ id: 1, stack: 0, container: false, pos: { x: 0, y: 0, z: 0 } })) }],
    ['items/2049', { items: rows(2049, () => ({ id: 1, stack: 0, container: false, pos: { x: 0, y: 0, z: 0 } })) }],
    ['tiles/357', { tiles: rows(357, () => ({ pos: { x: 0, y: 0, z: 0 } })) }],
    ['tiles/358', { tiles: rows(358, () => ({ pos: { x: 0, y: 0, z: 0 } })) }],
    ['roster/6', { roster: rows(6, index => ({ slot: index + 1, uuid: 'u' + index, name: '', healthPercent: 0, moves: null })) }],
    ['roster/7', { roster: rows(7, index => ({ slot: (index % 6) + 1, uuid: 'u' + index, name: '', healthPercent: 0, moves: null })) }],
    ['roster/empty-uuid', { roster: [{ slot: 1, uuid: '', name: '', healthPercent: 0, moves: null }] }],
    ['roster/duplicate-uuid', { roster: [{ slot: 1, uuid: 'u', name: '', healthPercent: 0, moves: null }, { slot: 2, uuid: 'u', name: '', healthPercent: 0, moves: null }] }],
    ['roster/duplicate-slot', { roster: [{ slot: 1, uuid: 'a', name: '', healthPercent: 0, moves: null }, { slot: 1, uuid: 'b', name: '', healthPercent: 0, moves: null }] }],
    ['roster/moves-null', { roster: [{ slot: 1, uuid: 'u', name: '', healthPercent: 0, moves: null }] }],
    ['roster/moves-empty', { roster: [{ slot: 1, uuid: 'u', name: '', healthPercent: 0, moves: [] }] }],
    ['roster/moves-row', { roster: [{ slot: 1, uuid: 'u', name: '', healthPercent: 0, moves: [{ spellword: '', remainingMs: 0, totalMs: 0 }] }] }],
    ['roster/moves-bad', { roster: [{ slot: 1, uuid: 'u', name: '', healthPercent: 0, moves: [{}] }] }],
    ['moves/spellword-255', { moves: [{ spellword: 'x'.repeat(255), remainingMs: 0, totalMs: 0 }] }],
    ['moves/spellword-256', { moves: [{ spellword: 'x'.repeat(256), remainingMs: 0, totalMs: 0 }] }],
    ['moves/duration-max', { moves: [{ spellword: '', remainingMs: 2147483647000, totalMs: 2147483647000 }] }],
    ['moves/duration-over', { moves: [{ spellword: '', remainingMs: 2147483647001, totalMs: 0 }] }],
    ['moves/extra-key', { moves: [{ spellword: '', remainingMs: 0, totalMs: 0, extra: 1 }] }],
    ['moves/missing-total', { moves: [{ spellword: '', remainingMs: 0 }] }],
    ['moves/null-row', { moves: [null] }],
    ['sequence/100', { nativeSequence: rows(100, () => 'a') }],
    ['sequence/101', { nativeSequence: rows(101, () => 'a') }],
    ['sequence/255', { nativeSequence: ['x'.repeat(255)] }],
    ['sequence/256', { nativeSequence: ['x'.repeat(256)] }],
    ['name/255-bytes', { playerName: 'x'.repeat(255) }],
    ['name/256-bytes', { playerName: 'x'.repeat(256) }],
    ['name/127-multibyte', { playerName: '\u00e9'.repeat(127) }],
    ['name/128-multibyte', { playerName: '\u00e9'.repeat(128) }],
    ['movebar/256-bytes', { pokemonName: 'x'.repeat(256) }],
    ['guild/255-bytes', { guildName: 'x'.repeat(255) }],
    ['guild/256-bytes', { guildName: 'x'.repeat(256) }],
    ['condition/type-u64-max', { conditions: [{ type: '18446744073709551615', subId: 0 }] }],
    ['condition/type-u64-over', { conditions: [{ type: '18446744073709551616', subId: 0 }] }],
    ['condition/type-leading-zero', { conditions: [{ type: '00000000000000000000', subId: 0 }] }],
    ['condition/type-21-digits', { conditions: [{ type: '000000000000000000001', subId: 0 }] }],
    ['condition/type-empty', { conditions: [{ type: '', subId: 0 }] }],
    ['condition/type-upper', { conditions: [{ type: 'FF', subId: 0 }] }],
    ['condition/type-number', { conditions: [{ type: 0, subId: 0 }] }],
    ['condition/subId-max', { conditions: [{ type: '0', subId: 4294967295 }] }],
    ['creature/lookType-65535', { creatures: [{ id: 1, name: '', type: 0, healthPercent: 0, canAttack: false, pos: { x: 0, y: 0, z: 0 }, lookType: 65535 }] }],
    ['creature/lookType-65536', { creatures: [{ id: 1, name: '', type: 0, healthPercent: 0, canAttack: false, pos: { x: 0, y: 0, z: 0 }, lookType: 65536 }] }],
    ['creature/shinyIcon-0', { creatures: [{ id: 1, name: '', type: 0, healthPercent: 0, canAttack: false, pos: { x: 0, y: 0, z: 0 }, shinyIcon: 0 }] }],
    ['creature/shinyIcon-1', { creatures: [{ id: 1, name: '', type: 0, healthPercent: 0, canAttack: false, pos: { x: 0, y: 0, z: 0 }, shinyIcon: 1 }] }],
    ['creature/shinyIcon-bool', { creatures: [{ id: 1, name: '', type: 0, healthPercent: 0, canAttack: false, pos: { x: 0, y: 0, z: 0 }, shinyIcon: true }] }],
    ['creature/z-15', { creatures: [{ id: 1, name: '', type: 0, healthPercent: 0, canAttack: false, pos: { x: 0, y: 0, z: 15 } }] }],
    ['creature/z-16', { creatures: [{ id: 1, name: '', type: 0, healthPercent: 0, canAttack: false, pos: { x: 0, y: 0, z: 16 } }] }],
    ['item/id-65535', { items: [{ id: 65535, stack: 0, container: false, pos: { x: 0, y: 0, z: 0 } }] }],
    ['item/id-65536', { items: [{ id: 65536, stack: 0, container: false, pos: { x: 0, y: 0, z: 0 } }] }],
    ['tile/walkable-undefined', { tiles: [{ pos: { x: 0, y: 0, z: 0 } }] }],
    ['tile/walkable-ok', { tiles: [{ pos: { x: 0, y: 0, z: 0 }, walkable: true }] }],
    ['tile/walkable-null', { tiles: [{ pos: { x: 0, y: 0, z: 0 }, walkable: null }] }],
    ['pinned/256', { pinnedTexts: rows(256, index => ({ id: index + ':1:2:3', pos: { x: 0, y: 0, z: 0 }, text: '' })) }],
    ['pinned/257', { pinnedTexts: rows(257, index => ({ id: index + ':1:2:3', pos: { x: 0, y: 0, z: 0 }, text: '' })) }],
    ['pinned/duplicate-id', { pinnedTexts: [{ id: '1:2:3:4', pos: { x: 0, y: 0, z: 0 }, text: '' }, { id: '1:2:3:4', pos: { x: 1, y: 1, z: 1 }, text: 'x' }] }],
    ['pinned/id-hex', { pinnedTexts: [{ id: 'a:b:c:d', pos: { x: 0, y: 0, z: 0 }, text: '' }] }],
    ['pinned/id-upper', { pinnedTexts: [{ id: 'A:B:C:D', pos: { x: 0, y: 0, z: 0 }, text: '' }] }],
    ['pinned/id-wide', { pinnedTexts: [{ id: '1:2:3', pos: { x: 0, y: 0, z: 0 }, text: '' }] }],
    ['pinned/id-16', { pinnedTexts: [{ id: 'ffffffffffffffff:1:2:3', pos: { x: 0, y: 0, z: 0 }, text: '' }] }],
    ['pinned/id-17', { pinnedTexts: [{ id: 'fffffffffffffffff:1:2:3', pos: { x: 0, y: 0, z: 0 }, text: '' }] }],
    ['pinned/text-512', { pinnedTexts: [{ id: '1:2:3:4', pos: { x: 0, y: 0, z: 0 }, text: 'x'.repeat(512) }] }],
    ['pinned/text-513', { pinnedTexts: [{ id: '1:2:3:4', pos: { x: 0, y: 0, z: 0 }, text: 'x'.repeat(513) }] }],
    ['position/65534', { position: { x: 65534, y: 65534, z: 15 } }],
    ['position/65535', { position: { x: 65535, y: 0, z: 0 } }],
    ['position/z-16', { position: { x: 0, y: 0, z: 16 } }],
    ['position/null', { position: null }],
    ['position/extra-axis', { position: { x: 0, y: 0, z: 0, w: 5 } }],
    ['position/missing-z', { position: { x: 0, y: 0 } }],
    ['slot/6', { activeSlot: 6 }],
    ['slot/7', { activeSlot: 7 }],
    ['direction/7', { direction: 7 }],
    ['direction/8', { direction: 8 }],
    ['fightMode/3', { fightMode: 3 }],
    ['fightMode/4', { fightMode: 4 }],
    ['chaseMode/1', { chaseMode: 1 }],
    ['chaseMode/2', { chaseMode: 2 }],
    ['clock/max-safe', { clockMs: 9007199254740991 }],
    ['clock/over-safe', { clockMs: 9007199254740992 }],
    ['clientPid/0', { clientPid: 0 }],
    ['clientPid/1', { clientPid: 1 }],
    ['ownSummonId/0', { ownSummonId: 0 }],
    ['extras/preserved', { ...baseline(), syntheticExtra: { nested: 'retained' }, schema2: 9 }],
    ['passthrough/itemCounts', { itemCounts: { synthetic: 3 } }],
    ['passthrough/inspection', { inspection: [] }],
    ['passthrough/itemInspector', { itemInspectorAvailable: 1 }],
    ['capture/version-only', { captureVersion: 1 }],
    ['capture/version-boolean', { captureVersion: 1, itemInspectorAvailable: true }],
    ['capture/version-number', { captureVersion: 1, itemInspectorAvailable: 1 }],
    ['capture/version-two', { captureVersion: 2, itemInspectorAvailable: true }],
    ['capture/counts-empty', { captureVersion: 1, itemInspectorAvailable: true, itemCounts: [] }],
    ['capture/counts-row', { captureVersion: 1, itemInspectorAvailable: true, itemCounts: [{ id: 1, count: 1 }] }],
    ['capture/counts-bad', { captureVersion: 1, itemInspectorAvailable: true, itemCounts: [{}] }],
    ['alerts/all-required', { alertSignals: signals(true), alertEvents: [], alertEventRevision: 0, alertEventsDropped: 0 }],
    ['alerts/all-false', { alertSignals: signals(false), alertEvents: [], alertEventRevision: 0, alertEventsDropped: 0 }],
    ['alerts/partial-keys', { alertSignals: { chat: true }, alertEvents: [], alertEventRevision: 0, alertEventsDropped: 0 }],
    ['alerts/non-boolean', { alertSignals: { ...signals(true), chat: 1 }, alertEvents: [], alertEventRevision: 0, alertEventsDropped: 0 }],
    ['alerts/extra-key', { alertSignals: { ...signals(true), hp: true }, alertEvents: [], alertEventRevision: 0, alertEventsDropped: 0 }],
    ['alerts/missing-events', { alertSignals: signals(true) }],
    ['alerts/events-only', { alertEvents: [], alertEventRevision: 0, alertEventsDropped: 0 }],
    ['alerts/event-unknown', { alertSignals: signals(true), alertEvents: [{ kind: 'talk' }], alertEventRevision: 0, alertEventsDropped: 0 }],
    ['alerts/revision-over', { alertSignals: signals(true), alertEvents: [], alertEventRevision: 4294967296, alertEventsDropped: 0 }],
    ['guildDailies/null', { guildDailies: null }],
    ['guildDailies/empty-array', { guildDailies: [] }],
    ['guildDailies/empty-object', { guildDailies: {} }],
    ['comboVersion/1', { combatDispatchVersion: 1 }],
    ['comboVersion/2', { combatDispatchVersion: 2 }],
    ['lureVersion/1', { dynamicLureVersion: 1 }],
    ['lureVersion/2', { dynamicLureVersion: 2 }],
    ['dailyAvailable/true', { guildDailyAvailable: true }],
    ['dailyAvailable/one', { guildDailyAvailable: 1 }],
    ['dailyAuto/0', { guildDailyAutoVersion: 0 }],
    ['dailyAuto/1', { guildDailyAutoVersion: 1 }],
    ['dailyAuto/2', { guildDailyAutoVersion: 2 }],
  ]) add(id, patch);
  return cases;
}

function capture() {
  if (process.versions.electron !== '44.7.2') throw Error('Original telemetry probes require Electron 44.7.2; never load bytecode in Node 22.');
  const { telemetry, hashes, blockedCalls } = require('./probe_bridge_exports.cjs');
  const cases = buildCases().map(entry => ({ ...entry, observed: invoke(telemetry.decodeTelemetry, materialize(entry)) }));
  if (blockedCalls.length) throw Error('Probe attempted an external operation');
  const report = {
    authority: 'controlled-synthetic-original-module',
    runtime: { electron: process.versions.electron, node: process.versions.node, v8: process.versions.v8 },
    hashes, cases_sha256: sha256(JSON.stringify(cases)), cases,
    safety: { originalMainExecuted: false, sessionsAccessed: false, connectionsOpened: false, blockedCalls },
    limitations: [
      'Synthetic boundary vectors only, not global behavioral equivalence.',
      'guildDailies, item inspection and nonempty alert events accept no observed valid shape; they remain unsupported.',
      'Import harness is not an operating-system sandbox.',
    ],
  };
  fs.writeFileSync(path.resolve(__dirname, '../telemetry_edges.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ count: cases.length, accepted: cases.filter(entry => entry.observed.result).length, hashes, blockedCalls }));
  return report;
}

if (require.main === module) capture();
module.exports = { buildCases, capture };
