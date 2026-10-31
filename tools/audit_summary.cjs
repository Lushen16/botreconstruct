'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const CONTRACTS = ['alerts-v1.json', 'capture-v1.json', 'remaining-rules-v1.json'];

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}

function summarize() {
  const verify = readJson('verify-report.json');
  const decisions = readJson('reconstruction/spec/decision-rules-v1.json');
  const contracts = CONTRACTS.flatMap(file => readJson('reconstruction/spec/' + file).rules);
  const manifest = readJson('install-metadata/release-manifest.json');
  const mockHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'tools/pka_runtime_server.py'))).digest('hex');

  const errors = [];
  const decisionCounts = { total: decisions.rules.length, implemented: 0, partial: 0, unsupported: 0, 'native-unknown': 0 };
  for (const rule of decisions.rules) {
    if (!(rule.status in decisionCounts)) errors.push('status desconhecido: ' + rule.status);
    else decisionCounts[rule.status] += 1;
  }
  const contractCounts = { total: contracts.length, implementable: 0, blocked: 0 };
  for (const rule of contracts) {
    if (!(rule.status in contractCounts)) errors.push('status de contrato desconhecido: ' + rule.status);
    else contractCounts[rule.status] += 1;
  }
  const unsupported = decisions.rules.filter(rule => rule.status === 'unsupported').map(rule => rule.id).sort();
  const blockedContracts = contracts.filter(rule => rule.status === 'blocked').map(rule => rule.id).sort();
  if (JSON.stringify(unsupported) !== JSON.stringify(blockedContracts)) errors.push('contratos blocked nao cobrem exatamente as lacunas');
  if (manifest.protection.rules.length !== decisionCounts.total) errors.push('manifesto e matriz com totais diferentes');
  if (verify.summary.fail !== 0) errors.push('verify-report.json tem falhas');
  if (verify.summary.total !== verify.verdicts.length) errors.push('verify-report.json inconsistente');

  const mockVerdict = verify.verdicts.find(verdict => verdict.id === 'claim.python-mock');
  if (!mockVerdict || !mockVerdict.pass) errors.push('claim.python-mock ausente ou falhando');
  if (mockVerdict && mockVerdict.actual !== mockHash) errors.push('hash do mock diverge do verificado');
  if (mockHash !== '605f328a9fddfb150e62ee5c00ba0d4182b8eddca395f5c1b45eb7d18eabe339') errors.push('mock canonico alterado');

  return {
    product: 'PKA Tools 3.1.9',
    generatedAt: new Date().toISOString(),
    claims: { pass: verify.summary.pass, fail: verify.summary.fail, total: verify.summary.total },
    decisions: decisionCounts,
    contracts: { ...contractCounts, closed: contracts.filter(rule => rule.status === 'implementable').length },
    mock: { path: 'tools/pka_runtime_server.py', sha256: mockHash, canonical: mockHash.startsWith('605f328a') },
    native: { status: 'MEMORY-DUMPED', reason: 'stomped .text de msftedit.dll; identidade de arquivo UNVERIFIED; binding do worker 0x8461a -> 0xc6360 -> 0xcfe40; route/TravelLure e segundos aleatorios ligados estaticamente; consumidor/hook/ACK nativos permanecem abertos', dump: 'dumps/msftedit_text_32336.bin', sha256: '7c0fd219dc24f3fa273ded518eca8ea840d3395f00d14e78beacb4ffd7c50ea4' },
    ok: errors.length === 0,
    errors,
  };
}

if (require.main === module) {
  const summary = summarize();
  console.log('PKA Tools 3.1.9 - auditoria');
  console.log('claims: ' + summary.claims.pass + '/' + summary.claims.total + ' pass, ' + summary.claims.fail + ' fail');
  console.log('decisoes: ' + JSON.stringify(summary.decisions));
  console.log('contratos: ' + JSON.stringify(summary.contracts));
  console.log('mock: ' + summary.mock.sha256);
  console.log('native: ' + summary.native.status + ' (' + summary.native.reason + ')');
  for (const error of summary.errors) console.error('FAIL ' + error);
  fs.writeFileSync(path.join(root, 'audit-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  process.exit(summary.ok ? 0 : 1);
}

module.exports = { summarize };
