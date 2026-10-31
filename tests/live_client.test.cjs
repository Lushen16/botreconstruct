'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const { parseProcesses, discoverProcesses, selectPid, providerOptions, assessReadiness, useKeyboardWalker } = require('../reconstruction/live-client.cjs');

test('normal launch selects keyboard Walker without native credentials, preserving explicit and diagnostic backends', () => {
  assert.equal(useKeyboardWalker({}), true);
  assert.equal(useKeyboardWalker({ PKA_CHANNEL_KEY: 'fixture' }), false);
  assert.equal(useKeyboardWalker({ PKA_CHANNEL_KEY_FILE: 'fixture.json' }), false);
  assert.equal(useKeyboardWalker({ PKA_WALKER_BACKEND: 'native' }), false);
  assert.equal(useKeyboardWalker({ PKA_WALKER_BACKEND: 'keyboard' }), true);
  assert.equal(useKeyboardWalker({}, true), false);
  assert.equal(useKeyboardWalker({}, false, true), false);
});

test('process discovery ignores unrelated clients and localized tasklist messages', () => {
  assert.deepEqual(parseProcesses('"PokeAlliance_dx.exe","17832","Console","1","123 K"\n"other.exe","30"\nINFO: nenhum processo'), [17832]);
});

test('multiple clients require explicit selection instead of choosing the first', () => {
  assert.throws(() => selectPid([17832, 26100]), /PKA_PID/);
  assert.equal(selectPid([17832, 26100], '26100'), 26100);
  assert.throws(() => selectPid([17832], '26100'), /nao esta aberto/);
  for (const value of ['0', '-1', '1.5', '17832x']) assert.throws(() => selectPid([17832], value), /invalido/);
  assert.equal(selectPid([17832]), 17832);
  assert.throws(() => selectPid([]), /Nenhum cliente/);
});

test('process query is bounded and fails closed on query errors', () => {
  assert.deepEqual(discoverProcesses((executable, args, options) => {
    assert.equal(executable, 'tasklist.exe');
    assert.ok(args.includes('IMAGENAME eq PokeAlliance_dx.exe'));
    assert.equal(options.timeout, 5000);
    return { status: 0, stdout: '"PokeAlliance_dx.exe","26100"' };
  }), [26100]);
  assert.throws(() => discoverProcesses(() => ({ status: 1 })), /Falha/);
  assert.throws(() => discoverProcesses(() => ({ error: Error('timeout') })), /Falha/);
});

test('provider uses explicit PID and neutral snapshot with no invented player name', () => {
  const options = providerOptions('/fixture', {}, [17832]);
  assert.equal(options.snapshotFile, path.resolve('/fixture', 'live-snapshot.json'));
  assert.deepEqual(options.args, ['--watch', '--pid', '17832', '--output', options.snapshotFile]);
  const configured = providerOptions('/fixture', { PKA_PID: '26100', PKA_PLAYER_NAME: ' Ash ', PKA_SESSION_FILE: 'custom.json' }, [17832, 26100]);
  assert.deepEqual(configured.args.slice(-2), ['--player-name', 'Ash']);
  assert.equal(configured.snapshotFile, path.resolve('/fixture', 'custom.json'));
});

test('readiness never equates pipe or credentials to authenticated telemetry', () => {
  const blocked = assessReadiness(17832, [], false);
  assert.equal(blocked.prerequisitesReady, false);
  assert.equal(blocked.blockers.length, 2);
  const ready = assessReadiness(17832, ['pka-runtime-2-17832'], true);
  assert.equal(ready.prerequisitesReady, true);
  assert.equal(ready.nativeVerified, false);
  assert.equal(assessReadiness(17832, ['pka-runtime-2-26100'], true).prerequisitesReady, false);
  assert.equal(assessReadiness(17832, ['\\\\.\\pipe\\pka-runtime-2-17832'], true).prerequisitesReady, true);
});

test('app bootstrap uses explicit provider selection and reports failures without changing native gates', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../reconstruction/app/main.cjs'), 'utf8');
  assert.ok(source.includes('providerOptions(root, process.env, discoverProcesses())'));
  assert.ok(source.includes('live-provider-status.json'));
  assert.ok(source.includes('if (raw.pid !== livePid) return []'));
  assert.ok(!source.includes('live-snapshot-27964.json'));
  assert.ok(!source.includes("|| 'Nobutdopai'"));
});
