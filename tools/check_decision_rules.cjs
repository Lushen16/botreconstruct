'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const STATUSES = new Set(['implemented', 'partial', 'unsupported', 'native-unknown']);

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

function check() {
  const spec = loadJson('reconstruction/spec/decision-rules-v1.json');
  const manifest = loadJson('install-metadata/release-manifest.json');
  const config = loadJson('default_config.json');
  const errors = [];
  const manifestRules = manifest?.protection?.rules;
  if (!Array.isArray(manifestRules) || manifestRules.length === 0) errors.push('manifest sem protection.rules');
  const expected = new Set(manifestRules || []);
  const actual = new Set();
  for (const rule of spec.rules) {
    if (actual.has(rule.id)) errors.push('regra duplicada: ' + rule.id);
    actual.add(rule.id);
    if (!STATUSES.has(rule.status)) errors.push(rule.id + ': status invalido ' + rule.status);
    if (!rule.group || typeof rule.group !== 'string') errors.push(rule.id + ': group ausente');
    if (typeof rule.notes !== 'string' || !rule.notes.trim()) errors.push(rule.id + ': notes ausente');
    if (!Array.isArray(rule.config)) errors.push(rule.id + ': config deve ser array');
    for (const key of rule.config || []) {
      const resolved = resolveSetting(config, key);
      if (!resolved.ok) errors.push(rule.id + ': config inexistente ' + key);
    }
    if (rule.status === 'implemented' || rule.status === 'partial') {
      if (!Array.isArray(rule.evidence) || rule.evidence.length === 0) errors.push(rule.id + ': status ' + rule.status + ' sem evidence');
      for (const relative of rule.evidence || []) {
        const file = path.join(root, relative);
        if (!fs.existsSync(file)) errors.push(rule.id + ': evidence inexistente ' + relative);
      }
    }
    if (rule.status === 'unsupported' && rule.evidence?.length) errors.push(rule.id + ': unsupported nao deve listar evidence');
  }
  for (const id of expected) if (!actual.has(id)) errors.push('regra do manifesto sem mapeamento: ' + id);
  for (const id of actual) if (!expected.has(id)) errors.push('regra mapeada sem manifesto: ' + id);

  const counts = { total: spec.rules.length, implemented: 0, partial: 0, unsupported: 0, 'native-unknown': 0 };
  for (const rule of spec.rules) counts[rule.status] += 1;
  return { ok: errors.length === 0, errors, counts, rules: spec.rules, manifestRules };
}

if (require.main === module) {
  const result = check();
  for (const rule of result.rules) {
    console.log(rule.status.padEnd(13) + ' ' + rule.id.padEnd(18) + ' ' + rule.group.padEnd(8) + ' ' + rule.notes);
  }
  console.log('\n' + JSON.stringify(result.counts));
  if (result.errors.length) {
    for (const error of result.errors) console.error('FAIL ' + error);
    process.exit(1);
  }
  console.log('decision rules: ' + result.counts.total + ' mapeadas, 0 erros');
}

module.exports = { check, resolveSetting, STATUSES };
