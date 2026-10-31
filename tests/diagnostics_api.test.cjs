'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRendererApis } = require('../reconstruction/renderer-api.cjs');
const { createDiagnosticApis, diagnosticsEnabled } = require('../reconstruction/diagnostics-api.cjs');

test('the recovered pka namespace is not polluted by diagnostics', () => {
  const transport = { on() {}, removeListener() {}, invoke() {}, send() {} };
  const api = createRendererApis(transport);
  assert.deepEqual(Object.keys(api).sort(), ['pka', 'pkaLook']);
  assert.ok(!('simulate' in api.pka));
  assert.ok(!('pkaDiag' in api));
});

test('the diagnostic surface exposes only simulate/status and routes to its own channel', async () => {
  const calls = [];
  const transport = { invoke(channel, ...args) { calls.push({ channel, args }); return Promise.resolve({ enabled: true }); } };
  const { pkaDiag } = createDiagnosticApis(transport);
  assert.deepEqual(Object.keys(pkaDiag).sort(), ['simulate', 'status']);
  assert.deepEqual(await pkaDiag.simulate(true, { creatures: [] }), { enabled: true });
  assert.deepEqual(calls, [{ channel: 'pka-diag:simulate', args: [true, { creatures: [] }] }]);
  await pkaDiag.simulate(1);
  assert.deepEqual(calls.at(-1).args, [false, undefined]);
  await pkaDiag.status();
  assert.deepEqual(calls.at(-1), { channel: 'pka-diag:status', args: [] });
});

test('diagnostics mode is opt-in only', () => {
  assert.equal(diagnosticsEnabled({}, []), false);
  assert.equal(diagnosticsEnabled({ PKA_DIAGNOSTICS: '1' }, []), true);
  assert.equal(diagnosticsEnabled({ PKA_DIAGNOSTICS: '0' }, []), false);
  assert.equal(diagnosticsEnabled({}, ['--pka-diagnostics']), true);
  assert.equal(diagnosticsEnabled({}, ['--audit']), false);
});

test('shipped preload keeps pka exact and gates pkaDiag behind diagnostics mode', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../reconstruction/app/preload.cjs'), 'utf8');
  assert.match(preload, /exposeInMainWorld\('pka',\s*exposed\.pka\)/);
  assert.match(preload, /exposeInMainWorld\('pkaDiag',\s*createDiagnosticApis\(ipcRenderer\)\.pkaDiag\)/);
  assert.match(preload, /diagnosticsEnabled\(process\.env\|\|\{\},\s*process\.argv\)/);
  assert.match(preload, /typeof process\s*!==\s*'undefined'/);
  assert.doesNotMatch(preload, /simulate:\s*1/);
});
