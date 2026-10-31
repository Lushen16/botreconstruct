'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pack, unpack, sha256 } = require('./probe_protocol_vectors.cjs');
const baseline = () => ({ schema: 2, nativeVerified: true, pulseVersion: 3, tick: 0,
  playerId: 0, fightMode: 0, chaseMode: 0, clockMs: 0, position: { x: 0, y: 0, z: 0 },
  activeSlot: 0, moves: [], nativeSequence: [], pokemonName: 'Synthetic',
  comboPokemonName: 'Synthetic', conditionEvents: true, conditionsKnown: false,
  conditions: [], roster: [], creatures: [], items: [], tiles: [] });
function materialize(entry) {
  if (entry.encoding === 'json') return Buffer.from(JSON.stringify(unpack(entry.input)));
  if (entry.encoding === 'text') return entry.input;
  if (entry.encoding === 'repeat') return Buffer.alloc(entry.input, 32);
  return unpack(entry.input);
}
function invoke(decoder, input) {
  try { return { result: pack(decoder(input)) }; }
  catch (error) { return { error: { name: error.name, message: error.message, ...(error.code ? { code: error.code } : {}) } }; }
}
function buildCases() {
  const cases = [];
  const add = (id, input, encoding = 'json') => cases.push({ id, encoding, input: pack(input) });
  add('baseline', baseline());
  for (const input of [undefined, null, {}, [], 0, true, '', '{}', 'null', '{']) add('input/' + cases.length, input, 'raw');
  add('string/baseline', JSON.stringify(baseline()), 'text');
  for (const input of [null, [], false, 1, 'synthetic']) add('json/' + cases.length, input);
  for (const size of [1048576, 1048577]) add('length/' + size, size, 'repeat');
  const values = [undefined, null, false, true, -1, 0, 1, 2, 3, 4, 6, 10, 16, 100, 255,
    65534, 65535, 4294967295, 4294967296, 1.5, '', '0', 'Synthetic', [], {}];
  const fields = [...Object.keys(baseline()), 'combatDispatchVersion', 'dynamicLureVersion',
    'guildDailyAvailable', 'guildDailyAutoVersion', 'guildName', 'guildDailies', 'clientPid',
    'playerName', 'ownSummonId', 'direction', 'captureVersion', 'itemInspectorAvailable',
    'itemCounts', 'inspection', 'pinnedTexts', 'alertSignals', 'alertEvents',
    'alertEventRevision', 'alertEventsDropped'];
  for (const field of fields) for (const [index, value] of values.entries()) add(field + '/' + index, { ...baseline(), [field]: value });
  for (const field of ['position', 'moves', 'nativeSequence', 'conditions', 'roster', 'creatures', 'items', 'tiles', 'pinnedTexts', 'alertEvents', 'guildDailies']) {
    for (const value of [[{}], [0], ['synthetic'], { x: 1, y: 2, z: 3 }]) add(field + '/shape/' + cases.length, { ...baseline(), [field]: value });
  }
  add('extra/preserved', { ...baseline(), syntheticExtra: { nested: 'retained' } });
  const rows = {
    moves: { spellword: '', remainingMs: 0, totalMs: 0 },
    conditions: { type: '0', subId: 0 },
    roster: { slot: 1, uuid: 'synthetic-uuid', name: '', healthPercent: 0, moves: null },
    creatures: { id: 1, name: '', type: 0, healthPercent: 0, canAttack: false, pos: { x: 0, y: 0, z: 0 } },
    items: { id: 1, stack: 0, container: false, pos: { x: 0, y: 0, z: 0 } },
    tiles: { pos: { x: 0, y: 0, z: 0 } },
    pinnedTexts: { id: '1:2:3:4', pos: { x: 0, y: 0, z: 0 }, text: '' },
  };
  for (const [field, row] of Object.entries(rows)) {
    add(field + '/valid-row', { ...baseline(), [field]: [row] });
    for (const key of [...Object.keys(row), ...(field === 'tiles' ? ['walkable'] : [])]) for (const [index, value] of values.entries()) {
      add(field + '/row/' + key + '/' + index, { ...baseline(), [field]: [{ ...row, [key]: value }] });
    }
    for (const size of [6, 7, 10, 11, 16, 17, 32, 33, 64, 65, 128, 129, 256, 257, 512, 513, 1024, 1025, 2048, 2049, 4096, 4097]) {
      const entries = Array.from({ length: size }, (_, index) => field === 'roster' ? { ...row, slot: index + 1, uuid: 'synthetic-' + index } : row);
      add(field + '/count/' + size, { ...baseline(), [field]: entries });
    }
  }
  for (const axis of ['x', 'y', 'z']) for (const [index, value] of values.entries()) add('coordinate/' + axis + '/' + index, { ...baseline(), position: { x: 0, y: 0, z: 0, [axis]: value } });
  for (const field of ['playerName', 'pokemonName', 'comboPokemonName', 'guildName']) for (const length of [64, 65, 100, 128, 129, 255, 256, 257]) {
    for (const character of ['x', '\u00e9']) add('stringLength/' + field + '/' + length + '/' + character, { ...baseline(), [field]: character.repeat(length) });
  }
  for (const nativeSequence of [[''], ['a', 'b'], Array(32).fill('a'), Array(33).fill('a')]) add('sequence/shape/' + cases.length, { ...baseline(), nativeSequence });
  return cases;
}
function capture() {
  if (process.versions.electron !== '44.7.2') throw Error('Original telemetry probes require Electron 44.7.2; never load bytecode in Node 22.');
  const { telemetry, hashes, blockedCalls } = require('./probe_bridge_exports.cjs');
  const cases = buildCases().map(entry => ({ ...entry, observed: invoke(telemetry.decodeTelemetry, materialize(entry)) }));
  if (blockedCalls.length) throw Error('Probe attempted an external operation');
  const report = { authority: 'controlled-synthetic-original-module', runtime: { electron: process.versions.electron, node: process.versions.node, v8: process.versions.v8 },
    hashes, cases_sha256: sha256(JSON.stringify(cases)), cases,
    safety: { originalMainExecuted: false, sessionsAccessed: false, connectionsOpened: false, blockedCalls },
    limitations: ['Finite synthetic vectors, not global behavioral equivalence.', 'Import harness is not an OS sandbox.', 'Nonempty collection schemas and unobserved outputs remain unknown.'] };
  fs.writeFileSync(path.resolve(__dirname, '../telemetry_vectors.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ count: cases.length, accepted: cases.filter(entry => entry.observed.result).length, hashes, blockedCalls }));
  return report;
}
if (require.main === module) capture();
module.exports = { baseline, materialize, invoke, buildCases, capture };
