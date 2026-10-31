const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const electron = path.join(root, 'runtime/electron-v44.7.2/electron.exe');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const tests = fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.cjs'))
  .map(name => path.join(root, 'tests', name));
const report = { generatedAt: new Date().toISOString(), node: process.version, steps: [] };
for (const step of [
  { name: 'build', executable: process.execPath, args: ['tools/build_app.cjs'], env },
  { name: 'node', executable: process.execPath, args: ['--test', '--test-reporter=tap', ...tests], env },
  { name: 'electron', executable: electron, args: ['--test', '--test-reporter=tap', ...tests], env: { ...env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ASAR: '1' } },
  { name: 'smoke', executable: process.execPath, args: ['tools/smoke_app.cjs'], env },
  { name: 'audit', executable: process.execPath, args: ['tools/ui_audit.cjs'], env },
]) {
  const result = spawnSync(step.executable, step.args, { cwd: root, env: step.env,
    encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  const log = (result.stdout || '') + (result.stderr || '');
  fs.writeFileSync(path.join(root, 'validation-' + step.name + '.txt'), log);
  const counts = {};
  for (const name of ['tests', 'pass', 'fail', 'skipped']) {
    const match = log.match(new RegExp('^# ' + name + ' (\\d+)', 'm'));
    if (match) counts[name] = Number(match[1]);
  }
  const observation = { name: step.name, exitCode: result.status, signal: result.signal,
    ...(result.error ? { error: result.error.message } : {}), ...counts };
  report.steps.push(observation);
  console.log(JSON.stringify(observation));
  if (result.error || result.status !== 0) process.exitCode = 1;
}
report.success = !process.exitCode;
fs.writeFileSync(path.join(root, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
