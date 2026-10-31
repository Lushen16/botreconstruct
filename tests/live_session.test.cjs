'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const walkerModel = require('../reconstruction/app/ui/walker-model.js');
const { rpmSession } = require('../reconstruction/live-session.cjs');

const root = path.resolve(__dirname, '..');
const tool = path.join(root, 'tools', 'pka_live_session.py');

function python() {
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const executable of candidates) {
    const probe = spawnSync(executable, ['-c', 'print(1)'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return executable;
  }
  return null;
}

test('pka_live_session resolves the player through the static chain', t => {
  const interpreter = python();
  if (!interpreter) {
    t.skip('python is not available');
    return;
  }
  const run = spawnSync(interpreter, [tool, '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout.trim().split('\n').pop());
  assert.equal(result.selftest, 'ok');
  assert.deepEqual(result.player.pos, { x: 3299, y: 2219, z: 7 });
  assert.equal(result.player.name, 'Charizard');
});

test('a fresh RPM provider reports position without impersonating verified native telemetry', () => {
  const raw = { pid: 1234, generatedAt: new Date().toISOString(),
    player: { name: 'Nobutdopai', pos: { x: 3318, y: 2263, z: 9 } }, creatures: [] };
  const session = rpmSession(raw);
  assert.equal(session.stale, false);
  assert.deepEqual(session.telemetry.position, { x: 3318, y: 2263, z: 9 });
  assert.equal(session.telemetry.nativeVerified, false);
  assert.throws(() => walkerModel.currentPosition(session), /Aguardando posição/);
});

test('a frozen snapshot is flagged stale so the walker refuses it', () => {
  const session = { pid: 1, online: true, stale: true, ageMs: 60000,
    telemetry: { nativeVerified: true, position: { x: 3299, y: 2219, z: 7 } } };
  assert.throws(() => walkerModel.currentPosition(session), /Aguardando posição/);
});

test('a logged-out client stays offline even with fresh cached player coordinates', () => {
  const raw = { pid: 1234, online: false, generatedAt: new Date().toISOString(),
    player: { name: 'Nobutdopai', pos: { x: 3319, y: 2277, z: 9 } } };
  const session = rpmSession(raw);
  assert.equal(session.stale, false);
  assert.equal(session.online, false);
  assert.equal(session.telemetry.nativeVerified, false);
});
