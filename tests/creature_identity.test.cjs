'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('version-bound RPM identity validates recorded dumps and dispatch-time protection', t => {
  const root = path.resolve(__dirname, '..');
  const python = (process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'])
    .find(command => spawnSync(command, ['-c', 'print(1)'], { encoding: 'utf8' }).status === 0);
  if (!python) { t.skip('Python unavailable'); return; }
  const result = spawnSync(python, [path.join(root, 'tests/creature_identity_checks.py')],
    { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /Ran 16 tests/u);
});
