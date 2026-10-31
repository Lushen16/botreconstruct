'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const CONTRACTS = ['alerts-v1.json', 'capture-v1.json', 'remaining-rules-v1.json'];
const TELEMETRY_FIELDS = new Set([
  'schema', 'nativeVerified', 'pulseVersion', 'tick', 'playerId', 'fightMode', 'chaseMode', 'clockMs',
  'position', 'activeSlot', 'moves', 'nativeSequence', 'pokemonName', 'comboPokemonName',
  'conditionEvents', 'conditionsKnown', 'conditions', 'roster', 'creatures', 'items', 'tiles',
  'healthPercent', 'direction', 'clientPid', 'playerName', 'guildName', 'guildDailies',
  'guildDailyAvailable', 'guildDailyAutoVersion', 'combatDispatchVersion', 'dynamicLureVersion',
  'itemInspectorAvailable', 'itemCounts', 'inspection', 'captureVersion', 'pinnedTexts',
  'alertSignals', 'alertEvents', 'alertEventRevision', 'alertEventsDropped',
]);
const FORBIDDEN_INPUT_TOKENS = ['isPlayer', 'isDead', 'canCapture', 'telemetry.connected'];

function loadJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}

function resolveSetting(config, dotted) {
  let node = config;
  for (const part of dotted.split('.')) {
    if (!node || typeof node !== 'object' || !(part in node)) return { ok: false, at: part };
    node = node[part];
  }
  return { ok: true, value: node };
}

function checkTelemetryInput(input, errors, ruleId) {
  if (typeof input !== 'string') { errors.push(ruleId + ': input nao textual'); return; }
  for (const token of FORBIDDEN_INPUT_TOKENS) {
    if (input.includes(token)) { errors.push(ruleId + ': input inventado ' + input); return; }
  }
  if (!input.startsWith('telemetry.')) return;
  const field = input.slice('telemetry.'.length).split('.')[0];
  if (!TELEMETRY_FIELDS.has(field)) errors.push(ruleId + ': campo de telemetria nao verificado ' + field);
}

function check() {
  const rules = loadJson('reconstruction/spec/decision-rules-v1.json').rules;
  const config = loadJson('default_config.json');
  const matrix = new Map(rules.map(rule => [rule.id, rule]));
  const unsupported = new Set(rules.filter(rule => rule.status === 'unsupported').map(rule => rule.id));
  const errors = [];
  const seen = new Set();
  const blockedIds = new Set();
  const implementableIds = new Set();
  const summary = { contracts: CONTRACTS.length, rules: 0, implementable: 0, blocked: 0, unsupported: unsupported.size, closed: 0 };

  for (const file of CONTRACTS) {
    const contract = loadJson('reconstruction/spec/' + file);
    if (Array.isArray(contract.rules) === false || contract.rules.length === 0) errors.push(file + ': rules vazio');
    for (const rule of contract.rules || []) {
      summary.rules += 1;
      if (seen.has(rule.id)) errors.push(rule.id + ': duplicada entre contratos');
      seen.add(rule.id);
      const matrixRule = matrix.get(rule.id);
      if (!matrixRule) { errors.push(rule.id + ': nao existe no decision-rules'); continue; }
      const expected = matrixRule.status === 'unsupported' ? 'blocked' : 'implementable';
      if (rule.status !== expected) errors.push(rule.id + ': contrato ' + rule.status + ' diverge da matriz ' + matrixRule.status);
      if (rule.status === 'blocked') { blockedIds.add(rule.id); summary.blocked += 1; }
      if (rule.status === 'implementable') { implementableIds.add(rule.id); summary.implementable += 1; }
      if (rule.status === 'blocked' && (!Array.isArray(rule.blockedBy) || rule.blockedBy.length === 0)) errors.push(rule.id + ': blocked sem blockedBy');
      for (const input of rule.inputs || []) checkTelemetryInput(input, errors, rule.id);
      for (const key of rule.config || []) {
        const resolved = resolveSetting(config, key);
        if (!resolved.ok) errors.push(rule.id + ': config inexistente ' + key);
      }
      for (const relative of rule.evidence || []) {
        if (!fs.existsSync(path.resolve(root, relative))) errors.push(rule.id + ': evidence inexistente ' + relative);
      }
      if (!rule.notes || !String(rule.notes).trim()) errors.push(rule.id + ': notes ausente');
    }
  }
  for (const id of unsupported) if (!blockedIds.has(id)) errors.push('lacuna sem contrato blocked: ' + id);
  for (const id of blockedIds) if (!unsupported.has(id)) errors.push('contrato blocked sem lacuna: ' + id);
  for (const id of implementableIds) {
    const matrixRule = matrix.get(id);
    if (!matrixRule || matrixRule.status === 'unsupported') errors.push('contrato implementable ainda unsupported: ' + id);
    else summary.closed += 1;
  }
  return { ok: errors.length === 0, errors, summary, ids: [...seen], unsupported: [...unsupported] };
}

if (require.main === module) {
  const result = check();
  console.log(JSON.stringify(result.summary));
  for (const error of result.errors) console.error('FAIL ' + error);
  if (!result.ok) process.exit(1);
  console.log('contracts: ' + result.summary.rules + ' regras (' + result.summary.closed + ' fechadas, ' + result.summary.blocked + ' bloqueadas), 0 erros');
}

module.exports = { check, resolveSetting, checkTelemetryInput, TELEMETRY_FIELDS };
