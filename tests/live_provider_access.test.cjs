'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

test('provider reports access denied separately from a missing process and probes without scanning', t => {
  if (process.platform !== 'win32') return t.skip('Windows provider');
  const script = [
    'import sys,json,ctypes',
    'from unittest.mock import patch',
    'sys.path.insert(0,"tools")',
    'import pka_live_session as provider',
    'failure=provider.process_failure(42,OSError(5,"denied"))',
    'assert failure["errorCode"]=="process-access-denied" and failure["win32Error"]==5',
    'assert provider.process_failure(42)["errorCode"]=="process-unavailable"',
    'with patch.object(provider.sc.k32,"OpenProcess",return_value=None),patch.object(provider.ctypes,"get_last_error",return_value=5):',
    '    try: provider.open_target(42,"PokeAlliance_dx.exe")',
    '    except OSError as error: assert error.errno==5',
    '    else: raise AssertionError("access error discarded")',
    'with patch.object(provider,"open_target",return_value=(42,123,"fixture")),patch.object(provider.sc.k32,"CloseHandle") as close,patch.object(provider.sc,"scan_process") as scan:',
    '    assert provider.main(["--pid","42","--probe-access"])==0',
    '    close.assert_called_once_with(123)',
    '    scan.assert_not_called()',
    'with patch.object(provider,"open_target",side_effect=OSError(5,"denied")):',
    '    assert provider.main(["--pid","42","--probe-access"])==2',
    '    assert provider.main(["--pid","42","--once","--creatures-interval-s","0"])==2',
    'print(json.dumps({"accessTests":"ok"}))',
  ].join('\n');
  const run = spawnSync(process.env.PKA_PYTHON || 'python', ['-c', script], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const records = run.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(records[0].rpmAccess, true);
  assert.equal(records[0].commandsSent, 0);
  assert.equal(records[1].win32Error, 5);
  assert.equal(records[2].win32Error, 5);
  assert.equal(records.at(-1).accessTests, 'ok');
});

test('provider UI status retains its real failure on exit and does not spam repeated notices', () => {
  const source = fs.readFileSync(path.join(root, 'reconstruction/app/main.cjs'), 'utf8');
  const reporter = source.slice(source.indexOf('function providerStatus('), source.indexOf('function startLiveProvider('));
  const writes = [];
  const notices = [];
  let loading = true;
  const context = { lastProviderState: null, livePid: 42, dataRoot: 'fixture', path,
    fs: { mkdirSync() {}, writeFileSync: (_filename, value) => writes.push(JSON.parse(value)) },
    window: { isDestroyed: () => false, webContents: { isLoading: () => loading, send: (...args) => notices.push(args) } } };
  vm.createContext(context);
  vm.runInContext(reporter, context);
  context.providerStatus({ status: 'blocked', error: 'Acesso negado Win32 5', win32Error: 5 });
  assert.equal(notices.length, 0);
  context.providerStatus({ status: 'stopped', exitCode: 2 });
  assert.equal(writes.at(-1).error, 'Acesso negado Win32 5');
  assert.equal(writes.at(-1).win32Error, 5);
  loading = false;
  context.providerStatus({ status: 'blocked', error: 'Outra falha' });
  context.providerStatus({ status: 'blocked', error: 'Outra falha' });
  assert.equal(notices.length, 1);
  context.providerStatus({ status: 'observing', error: null, win32Error: null });
  assert.equal(writes.at(-1).error, null);
});

test('launcher checks actual RPM access before opening the app and makes UAC elevation explicit', () => {
  const source = fs.readFileSync(path.join(root, 'ABRIR_WALKER_TECLADO.ps1'), 'utf8');
  assert.ok(source.includes('[switch]$Elevate'));
  assert.ok(source.includes('if ($Elevate -and -not $isAdministrator)'));
  assert.ok(source.includes('-Verb RunAs -WindowStyle Hidden'));
  assert.ok(source.includes('--probe-access'));
  assert.ok(source.indexOf('--probe-access') < source.indexOf('node tools/build_app.cjs'));
  assert.ok(source.indexOf('--probe-access') < source.indexOf('Start-Process -FilePath $electron'));
  assert.match(source, /Start-Process -FilePath \$electron[^\r\n]*-WindowStyle Normal/);
});

test('keyboard helper posts background taps and releases on interruption', t => {
  if (process.platform !== 'win32') return t.skip('Windows input helper');
  const script = [
    'import sys',
    'from unittest.mock import Mock,patch',
    'sys.path.insert(0,"tools")',
    'from walker_input import send_tap,movement_scan,key_messages',
    'assert [movement_scan(direction) for direction in range(4)] == [(0x48,True),(0x4d,True),(0x50,True),(0x4b,True)]',
    'for direction in [4,5,6,7,-1,True]:',
    '    try: movement_scan(direction)',
    '    except ValueError: pass',
    '    else: raise AssertionError("non-arrow input accepted")',
    'user=Mock()',
    'user.PostMessageW.return_value=True',
    'messages=key_messages(0x26,0x48,True)',
    'result={"eventsSent":0}',
    'with patch("walker_input.time.sleep") as sleep:',
    '    send_tap(user,42,messages,result)',
    '    sleep.assert_called_once_with(0.04)',
    'assert result["eventsSent"]==2',
    'assert user.PostMessageW.call_args_list[-1].args==(42,*messages[1])',
    'user.PostMessageW.reset_mock()',
    'result={"eventsSent":0}',
    'with patch("walker_input.time.sleep",side_effect=RuntimeError("interrupted")):',
    '    try: send_tap(user,42,messages,result)',
    '    except ValueError: pass',
    '    else: raise AssertionError("interruption lost")',
    'assert user.PostMessageW.call_args_list[-1].args==(42,*messages[1])',
    'assert result["eventsSent"]==2 and result["success"] is False',
  ].join('\n');
  const run = spawnSync(process.env.PKA_PYTHON || 'python', ['-B', '-c', script], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});
