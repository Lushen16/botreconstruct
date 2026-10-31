'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tool = path.join(root, 'tools', 'pointer_scan_entities.py');

function python() {
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const executable of candidates) {
    const probe = spawnSync(executable, ['-c', 'print(1)'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return executable;
  }
  return null;
}

test('pointer_scan_entities resolves a synthetic static pointer chain', t => {
  const interpreter = python();
  if (!interpreter) {
    t.skip('python is not available');
    return;
  }
  const run = spawnSync(interpreter, [tool, '--selftest'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout.trim().split('\n').pop());
  assert.equal(result.selftest, 'ok');
  assert.equal(result.resolved, '0x200010000');
  assert.ok(Array.isArray(result.chain.offsets) && result.chain.offsets.length >= 1);
});
